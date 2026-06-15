import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function run(args: string[], env?: NodeJS.ProcessEnv) {
  const cli = path.resolve(__dirname, "../dist/index.js")
  return execFileSync("node", [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim()
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
})
