import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"
import { readInstallManifest, validateOmpExtensionConfigPath } from "../src/installer/manifest.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function run(args: string[], env?: NodeJS.ProcessEnv) {
  const cli = path.resolve(__dirname, "../dist/index.js")
  return execFileSync("node", [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim()
}

function runWithStatus(args: string[], env?: NodeJS.ProcessEnv, input?: string) {
  const cli = path.resolve(__dirname, "../dist/index.js")
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    input,
  })
}

describe("uninstall", () => {
  let home: string
  let binaryPath: string
  let dataDir: string

  beforeEach(() => {
    home = tempDir()
    binaryPath = path.join(home, ".local/bin/memory-lane")
    dataDir = path.join(home, ".memory-lane")
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true })
    fs.writeFileSync(binaryPath, "#!/bin/sh\necho ok\n", "utf8")
    fs.mkdirSync(dataDir, { recursive: true })
  })

  function writeManifest(integrations: Array<{ harness: string; configPath: string }>): void {
    fs.writeFileSync(
      path.join(dataDir, "install.json"),
      JSON.stringify({ version: "0.1.0", installedAt: new Date().toISOString(), binaryPath, dataDir, integrations }, null, 2),
      "utf8",
    )
  }

  it("removes pi extension", () => {
    const piPath = path.join(home, ".pi/agent/extensions/memory-lane/index.ts")
    fs.mkdirSync(path.dirname(piPath), { recursive: true })
    fs.writeFileSync(piPath, "export default async () => {}", "utf8")
    writeManifest([{ harness: "pi", configPath: piPath }])

    run(["uninstall", "--yes"], { HOME: home })

    assert.equal(fs.existsSync(piPath), false)
    assert.equal(fs.existsSync(binaryPath), false)
  })

  it("removes Memory Lane hooks from Claude Code config", () => {
    const configPath = path.join(home, ".claude/settings.json")
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        theme: "dark",
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: `${binaryPath} claude session-start` }] }],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: `${binaryPath} claude user-prompt-submit` }] }],
        },
      }),
      "utf8",
    )
    const skillPath = path.join(home, ".claude/skills/memory-lane/SKILL.md")
    fs.mkdirSync(path.dirname(skillPath), { recursive: true })
    fs.writeFileSync(skillPath, "---\nname: memory-lane\n---\n", "utf8")
    writeManifest([{ harness: "claude-code-cli", configPath }])

    run(["uninstall", "--yes"], { HOME: home })

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.equal(config.theme, "dark")
    assert.equal(config.hooks, undefined)
    assert.equal(fs.existsSync(skillPath), false)
  })

  it("removes memory-lane MCP server while preserving others", () => {
    const configPath = path.join(home, ".config/claude/settings.json")
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          "memory-lane": { command: binaryPath, args: ["mcp"] },
          "other-server": { command: "other", args: [] },
        },
      }),
      "utf8",
    )
    writeManifest([{ harness: "claude-desktop", configPath }])

    run(["uninstall", "--yes"], { HOME: home })

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.equal(config.mcpServers["memory-lane"], undefined)
    assert.ok(config.mcpServers["other-server"])
  })

  it("removes memory-lane MCP server from Codex Desktop TOML while preserving others", () => {
    const configPath = path.join(home, ".codex/config.toml")
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(
      configPath,
      [
        'model = "gpt-5.5"',
        "",
        "[mcp_servers.memory-lane]",
        "enabled = true",
        `command = "${binaryPath}"`,
        'args = ["mcp"]',
        "",
        "[mcp_servers.other-server]",
        'command = "other"',
        "args = []",
        "",
      ].join("\n"),
      "utf8",
    )
    writeManifest([{ harness: "codex-desktop", configPath }])

    run(["uninstall", "--yes"], { HOME: home })

    const content = fs.readFileSync(configPath, "utf8")
    assert.equal(content.includes("[mcp_servers.memory-lane]"), false)
    assert.ok(content.includes("[mcp_servers.other-server]"))
    assert.ok(content.includes('model = "gpt-5.5"'))
  })

  it("preserves data by default", () => {
    const memFile = path.join(dataDir, "memory.jsonl")
    fs.writeFileSync(memFile, '{"text":"keep me"}\n', "utf8")
    writeManifest([])

    run(["uninstall", "--yes"], { HOME: home })

    assert.equal(fs.existsSync(memFile), true)
    assert.equal(fs.existsSync(binaryPath), false)
  })

  it("selectively removes manifest-recorded OMP while preserving Pi and unrelated files", () => {
    const piPath = path.join(home, ".pi", "agent", "extensions", "memory-lane", "index.ts")
    const ompAgent = path.join(home, "custom-omp-agent")
    const ompPath = path.join(ompAgent, "extensions", "memory-lane", "index.ts")
    const unrelated = path.join(ompAgent, "extensions", "other-extension.ts")
    const defaultOmp = path.join(home, ".omp", "agent", "extensions", "memory-lane", "index.ts")
    const memoryFile = path.join(dataDir, "memory.jsonl")
    for (const file of [piPath, ompPath, unrelated, defaultOmp]) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, `sentinel:${file}`, "utf8")
    }
    fs.writeFileSync(memoryFile, "{\"text\":\"keep\"}\n", "utf8")
    writeManifest([
      { harness: "pi", configPath: piPath },
      { harness: "omp", configPath: ompPath },
    ])

    run(["uninstall", "--only", "omp", "--yes"], { HOME: home, PI_CODING_AGENT_DIR: undefined })

    assert.equal(fs.existsSync(ompPath), false)
    assert.equal(fs.existsSync(piPath), true)
    assert.equal(fs.existsSync(unrelated), true)
    assert.equal(fs.existsSync(defaultOmp), true)
    assert.equal(fs.existsSync(binaryPath), true)
    assert.equal(fs.existsSync(memoryFile), true)
    const manifest = readInstallManifest(dataDir)
    assert.equal(manifest.status, "valid")
    if (manifest.status !== "valid") return
    assert.deepEqual(manifest.manifest.integrations, [{ harness: "pi", configPath: piPath }])
  })

  it("preflights every selected OMP entry before selective uninstall deletes anything", () => {
    const firstOmpPath = path.join(home, "custom-omp-agent", "extensions", "memory-lane", "index.ts")
    const unsafeOmpPath = path.join(home, "custom-omp-agent", "index.ts")
    fs.mkdirSync(path.dirname(firstOmpPath), { recursive: true })
    fs.mkdirSync(path.dirname(unsafeOmpPath), { recursive: true })
    fs.writeFileSync(firstOmpPath, "keep first omp", "utf8")
    fs.writeFileSync(unsafeOmpPath, "keep unsafe omp", "utf8")
    writeManifest([
      { harness: "omp", configPath: firstOmpPath },
      { harness: "omp", configPath: unsafeOmpPath },
    ])
    const originalManifest = fs.readFileSync(path.join(dataDir, "install.json"), "utf8")

    const result = runWithStatus(["uninstall", "--only", "omp", "--yes"], { HOME: home })

    assert.equal(result.status, 1)
    assert.match(result.stdout, /Refusing to manage an unexpected OMP extension path/u)
    assert.equal(fs.readFileSync(firstOmpPath, "utf8"), "keep first omp")
    assert.equal(fs.readFileSync(unsafeOmpPath, "utf8"), "keep unsafe omp")
    assert.equal(fs.readFileSync(path.join(dataDir, "install.json"), "utf8"), originalManifest)
    assert.equal(fs.existsSync(binaryPath), true)
  })

  it("rejects malformed selective uninstall flags before removing anything", () => {
    const piPath = path.join(home, ".pi", "agent", "extensions", "memory-lane", "index.ts")
    fs.mkdirSync(path.dirname(piPath), { recursive: true })
    fs.writeFileSync(piPath, "keep pi", "utf8")
    writeManifest([{ harness: "pi", configPath: piPath }])
    const originalManifest = fs.readFileSync(path.join(dataDir, "install.json"), "utf8")

    for (const args of [
      ["uninstall", "--only=", "--yes"],
      ["uninstall", "--only", "--yes"],
      ["uninstall", "--only", "--yes", "omp"],
      ["uninstall", "--onlyomp", "--yes"],
    ]) {
      const result = runWithStatus(args, { HOME: home })
      assert.equal(result.status, 1, args.join(" "))
      assert.match(result.stdout, /Usage: memory-lane uninstall --only omp|selective uninstall supports only/u)
      assert.equal(fs.readFileSync(piPath, "utf8"), "keep pi")
      assert.equal(fs.existsSync(binaryPath), true)
      assert.equal(fs.readFileSync(path.join(dataDir, "install.json"), "utf8"), originalManifest)
    }
  })

  it("selective OMP uninstall is idempotent when the recorded extension is already missing", () => {
    const ompPath = path.join(home, "custom-omp-agent", "extensions", "memory-lane", "index.ts")
    writeManifest([{ harness: "omp", configPath: ompPath }])
    const output = run(["uninstall", "--only=omp", "--yes"], { HOME: home })
    assert.match(output, /already removed/u)
    const manifest = readInstallManifest(dataDir)
    assert.equal(manifest.status, "valid")
    if (manifest.status !== "valid") return
    assert.deepEqual(manifest.manifest.integrations, [])
    assert.equal(fs.existsSync(binaryPath), true)
  })

  it("validates normalized absolute OMP extension paths before recursive removal", () => {
    assert.deepEqual(
      validateOmpExtensionConfigPath("/custom/extensions/other/../memory-lane/index.ts", path.posix),
      { ok: true, value: "/custom/extensions/memory-lane/index.ts" },
    )
    assert.equal(validateOmpExtensionConfigPath("extensions/memory-lane/index.ts", path.posix).ok, false)
    assert.equal(validateOmpExtensionConfigPath("/custom/extensions/memory-lane/index.ts/", path.posix).ok, false)
    assert.equal(validateOmpExtensionConfigPath("/custom/memory-lane/index.ts", path.posix).ok, false)
    assert.deepEqual(
      validateOmpExtensionConfigPath("C:\\Agent\\extensions\\other\\..\\memory-lane\\index.ts", path.win32),
      { ok: true, value: "C:\\Agent\\extensions\\memory-lane\\index.ts" },
    )
    assert.equal(validateOmpExtensionConfigPath("Agent\\extensions\\memory-lane\\index.ts", path.win32).ok, false)
    assert.equal(validateOmpExtensionConfigPath("C:\\Agent\\extensions\\memory-lane\\index.ts\\", path.win32).ok, false)
    assert.equal(validateOmpExtensionConfigPath("C:\\Agent\\extensions\\memory-lane\\index.ts/", path.win32).ok, false)
  })


  it("full uninstall removes a valid manifest-recorded OMP extension", () => {
    const ompPath = path.join(home, "custom-omp-agent", "extensions", "memory-lane", "index.ts")
    fs.mkdirSync(path.dirname(ompPath), { recursive: true })
    fs.writeFileSync(ompPath, "export default async function memoryLaneExtension() {}", "utf8")
    writeManifest([{ harness: "omp", configPath: ompPath }])
    run(["uninstall", "--yes"], { HOME: home, PI_CODING_AGENT_DIR: undefined })
    assert.equal(fs.existsSync(ompPath), false)
    assert.equal(fs.existsSync(binaryPath), false)
  })

  it("preflights every integration before full uninstall deletes anything", () => {
    const piPath = path.join(home, ".pi", "agent", "extensions", "memory-lane", "index.ts")
    const unsafeOmpPath = path.join(home, "custom-omp-agent", "index.ts")
    fs.mkdirSync(path.dirname(piPath), { recursive: true })
    fs.mkdirSync(path.dirname(unsafeOmpPath), { recursive: true })
    fs.writeFileSync(piPath, "keep pi", "utf8")
    fs.writeFileSync(unsafeOmpPath, "keep omp", "utf8")
    writeManifest([
      { harness: "pi", configPath: piPath },
      { harness: "omp", configPath: unsafeOmpPath },
    ])
    const result = runWithStatus(["uninstall", "--yes"], { HOME: home })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /Refusing to manage an unexpected OMP extension path/u)
    assert.equal(fs.readFileSync(piPath, "utf8"), "keep pi")
    assert.equal(fs.readFileSync(unsafeOmpPath, "utf8"), "keep omp")
    assert.equal(fs.existsSync(binaryPath), true)
  })

  it("preserves the binary and manifest when integrations are retained", () => {
    const piPath = path.join(home, ".pi", "agent", "extensions", "memory-lane", "index.ts")
    fs.mkdirSync(path.dirname(piPath), { recursive: true })
    fs.writeFileSync(piPath, "keep pi", "utf8")
    writeManifest([{ harness: "pi", configPath: piPath }])
    const result = runWithStatus(["uninstall"], { HOME: home }, "n\nn\n")
    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.readFileSync(piPath, "utf8"), "keep pi")
    assert.equal(fs.existsSync(binaryPath), true)
    const manifest = readInstallManifest(dataDir)
    assert.equal(manifest.status, "valid")
    if (manifest.status !== "valid") return
    assert.deepEqual(manifest.manifest.integrations, [{ harness: "pi", configPath: piPath }])
  })

  it("refuses malformed manifests and tampered OMP paths without deleting", () => {
    const manifestPath = path.join(dataDir, "install.json")
    fs.writeFileSync(manifestPath, "{", "utf8")
    const malformed = runWithStatus(["uninstall", "--only", "omp", "--yes"], { HOME: home })
    assert.equal(malformed.status, 1)
    assert.match(malformed.stdout, /Invalid JSON in install manifest/u)
    assert.equal(fs.existsSync(binaryPath), true)
    assert.equal(fs.readFileSync(manifestPath, "utf8"), "{")

    const unsafePath = path.join(home, "custom-omp-agent", "index.ts")
    writeManifest([{ harness: "omp", configPath: unsafePath }])
    fs.mkdirSync(path.dirname(unsafePath), { recursive: true })
    fs.writeFileSync(unsafePath, "keep", "utf8")
    const unsafe = runWithStatus(["uninstall", "--only", "omp", "--yes"], { HOME: home })
    assert.equal(unsafe.status, 1)
    assert.match(unsafe.stdout, /Refusing to manage an unexpected OMP extension path/u)
    assert.equal(fs.readFileSync(unsafePath, "utf8"), "keep")
    assert.equal(fs.existsSync(binaryPath), true)
  })
})
