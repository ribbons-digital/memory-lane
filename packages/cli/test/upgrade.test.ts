import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { tempDir } from "../../core/test/helpers.js"
import { reapplyInstallManifest, type InstallManifest } from "../src/commands/upgrade.js"

function createFakeMemoryLaneSourceRoot(): { root: string; skillDir: string; skillPath: string; sentinel: string } {
  const root = tempDir()
  const skillDir = path.join(root, "skills", "memory-lane")
  const skillPath = path.join(skillDir, "SKILL.md")
  const sentinel = "SOURCE SKILL SENTINEL\n"
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "memory-lane" }), "utf8")
  fs.writeFileSync(skillPath, sentinel, "utf8")
  return { root, skillDir, skillPath, sentinel }
}

describe("upgrade", () => {
  it("reapplies unique manifest integrations and migrates old Claude Desktop config paths", () => {
    const home = tempDir()
    const dataDir = path.join(home, ".memory-lane")
    const binaryPath = path.join(home, ".local/bin/memory-lane")
    const oldBinaryPath = path.join(home, ".local/bin/old-memory-lane")
    fs.mkdirSync(dataDir, { recursive: true })

    const correctClaudeDesktopConfig =
      process.platform === "darwin"
        ? path.join(home, "Library/Application Support/Claude/claude_desktop_config.json")
        : path.join(home, ".config/Claude/claude_desktop_config.json")
    fs.mkdirSync(path.dirname(correctClaudeDesktopConfig), { recursive: true })
    fs.writeFileSync(correctClaudeDesktopConfig, JSON.stringify({ theme: "dark" }), "utf8")

    const manifest: InstallManifest = {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath: oldBinaryPath,
      dataDir,
      integrations: [
        {
          harness: "claude-desktop",
          configPath: path.join(home, "Library/Application Support/Claude/settings.json"),
        },
        {
          harness: "claude-desktop",
          configPath: path.join(home, "Library/Application Support/Claude/settings.json"),
        },
        {
          harness: "pi",
          configPath: path.join(home, ".pi/agent/extensions/memory-lane/index.ts"),
        },
      ],
    }

    const result = reapplyInstallManifest(
      {
        binaryPath,
        dataDir,
        projectMode: false,
        yes: true,
        homeDir: home,
      },
      manifest,
    )

    assert.equal(result.configuredCount, 2)
    assert.deepEqual(result.manifest.integrations.map((i) => i.harness), ["claude-desktop", "pi"])
    assert.equal(result.manifest.binaryPath, binaryPath)

    const claudeConfig = JSON.parse(fs.readFileSync(correctClaudeDesktopConfig, "utf8"))
    assert.equal(claudeConfig.theme, "dark")
    assert.equal(claudeConfig.mcpServers["memory-lane"].command, binaryPath)
    assert.deepEqual(claudeConfig.mcpServers["memory-lane"].args, ["mcp"])

    const piConfig = fs.readFileSync(path.join(home, ".pi/agent/extensions/memory-lane/index.ts"), "utf8")
    assert.ok(piConfig.includes(binaryPath))
  })

  it("reapplies Codex hooks but skips skill write when destination resolves into Memory Lane source", () => {
    const home = tempDir()
    const dataDir = path.join(home, ".memory-lane")
    const binaryPath = path.join(home, ".local/bin/memory-lane")
    const source = createFakeMemoryLaneSourceRoot()
    fs.mkdirSync(dataDir, { recursive: true })
    fs.mkdirSync(path.join(home, ".agents", "skills"), { recursive: true })
    fs.symlinkSync(source.skillDir, path.join(home, ".agents", "skills", "memory-lane"), "dir")

    const manifest: InstallManifest = {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath: path.join(home, ".local/bin/old-memory-lane"),
      dataDir,
      integrations: [{ harness: "codex-cli", configPath: path.join(home, ".codex/hooks.json") }],
    }

    const result = reapplyInstallManifest(
      {
        binaryPath,
        dataDir,
        projectMode: false,
        yes: true,
        homeDir: home,
      },
      manifest,
    )

    assert.equal(result.configuredCount, 1)
    assert.equal(fs.readFileSync(source.skillPath, "utf8"), source.sentinel)
    assert.ok(fs.readFileSync(path.join(home, ".codex/hooks.json"), "utf8").includes(`${binaryPath} codex session-start`))
    assert.match(result.results[0].message ?? "", /skipped Memory Lane skill write/u)
    assert.match(result.results[0].message ?? "", /source checkout/u)
  })

  it("skips unknown manifest harnesses without aborting valid reconfiguration", () => {
    const home = tempDir()
    const dataDir = path.join(home, ".memory-lane")
    const binaryPath = path.join(home, ".local/bin/memory-lane")
    fs.mkdirSync(dataDir, { recursive: true })

    const manifest = {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath: path.join(home, ".local/bin/old-memory-lane"),
      dataDir,
      integrations: [
        { harness: "legacy-harness", configPath: path.join(home, "legacy.json") },
        { harness: "pi", configPath: path.join(home, ".pi/agent/extensions/memory-lane/index.ts") },
      ],
    } as InstallManifest

    const result = reapplyInstallManifest(
      {
        binaryPath,
        dataDir,
        projectMode: false,
        yes: true,
        homeDir: home,
      },
      manifest,
    )

    assert.equal(result.configuredCount, 1)
    assert.deepEqual(result.manifest.integrations.map((i) => i.harness), ["pi"])
    assert.equal(result.results.some((r) => r.configured === false && r.message?.includes("Unknown harness")), true)
    assert.ok(fs.readFileSync(path.join(home, ".pi/agent/extensions/memory-lane/index.ts"), "utf8").includes(binaryPath))
  })
})
