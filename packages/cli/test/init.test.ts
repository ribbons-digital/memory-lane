import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createFakeBinDir(): string {
  const dir = tempDir()
  for (const cmd of ["claude", "codex"]) {
    const file = path.join(dir, cmd)
    fs.writeFileSync(file, "#!/bin/sh\necho fake\n", "utf8")
    fs.chmodSync(file, 0o755)
  }
  return dir
}

describe("init wizard", () => {
  let home: string
  let binaryPath: string
  let fakeBinDir: string

  function run(args: string[], env?: NodeJS.ProcessEnv, cwd?: string) {
    const cli = path.resolve(__dirname, "../dist/index.js")
    return execFileSync("node", [cli, ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`, ...env },
      cwd,
    }).trim()
  }

  beforeEach(() => {
    home = tempDir()
    fakeBinDir = createFakeBinDir()
    binaryPath = path.resolve(__dirname, "../dist/index.js")
    fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true })
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true })
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true })
    fs.mkdirSync(path.join(home, ".config", "claude"), { recursive: true })
    fs.writeFileSync(path.join(home, ".config", "claude", "settings.json"), "{}", "utf8")
    fs.mkdirSync(path.join(home, "Library", "Application Support", "Claude"), { recursive: true })
    fs.writeFileSync(path.join(home, "Library", "Application Support", "Claude", "settings.json"), "{}", "utf8")
  })

  afterEach(() => {
    fs.rmSync(fakeBinDir, { recursive: true, force: true })
  })

  it("writes pi extension in --yes mode", () => {
    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const piExt = path.join(home, ".pi/agent/extensions/memory-lane/index.ts")
    assert.ok(fs.existsSync(piExt))
    const content = fs.readFileSync(piExt, "utf8")
    assert.ok(content.includes("memoryLaneExtension"))
    assert.ok(content.includes(binaryPath))
  })

  it("writes install manifest", () => {
    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const manifest = JSON.parse(fs.readFileSync(path.join(home, ".memory-lane/install.json"), "utf8"))
    assert.equal(manifest.binaryPath, binaryPath)
    assert.ok(Array.isArray(manifest.integrations))
    assert.ok(manifest.integrations.some((i: any) => i.harness === "pi"))
  })

  it("writes Claude Desktop MCP config in --yes mode", () => {
    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const configPath =
      process.platform === "darwin"
        ? path.join(home, "Library/Application Support/Claude/settings.json")
        : path.join(home, ".config/claude/settings.json")
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.ok(config.mcpServers["memory-lane"])
    assert.equal(config.mcpServers["memory-lane"].command, binaryPath)
    assert.deepEqual(config.mcpServers["memory-lane"].args, ["mcp"])
  })

  it("preserves existing unrelated settings when adding MCP server", () => {
    const configPath =
      process.platform === "darwin"
        ? path.join(home, "Library/Application Support/Claude/settings.json")
        : path.join(home, ".config/claude/settings.json")
    fs.writeFileSync(configPath, JSON.stringify({ theme: "dark" }), "utf8")

    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.equal(config.theme, "dark")
    assert.ok(config.mcpServers["memory-lane"])
  })

  it("overwrites existing config in --yes mode", () => {
    const configPath = path.join(home, ".claude/settings.json")
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: `${binaryPath} claude session-start` }] }],
        },
      }),
      "utf8",
    )

    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.ok(config.hooks.UserPromptSubmit)
  })

  it("writes project-level Claude Code hooks with --project", () => {
    const project = tempDir()
    run(["init", "--yes", "--project", project], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const configPath = path.join(project, ".claude/settings.local.json")
    assert.ok(fs.existsSync(configPath))
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.ok(config.hooks.SessionStart)
    assert.ok(config.hooks.UserPromptSubmit)
    assert.ok(config.hooks.Stop)
    assert.ok(config.hooks.PostToolUse)
    assert.ok(config.hooks.SessionStart[0].hooks[0].command.includes(`${binaryPath} claude session-start`))
  })
})
