import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"
import {
  defaultInstalledBinaryPath,
  installerEnvironment,
  reapplyInstallManifest,
  reapplyManifestWithInstalledBinary,
  resolveUpgradeBinaryPath,
} from "../src/commands/upgrade.js"
import type { InstallManifest } from "../src/commands/upgrade.js"
import { readInstallManifest, writeInstallManifest } from "../src/installer/manifest.js"
import { VERSION } from "../src/version.js"

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
  it("reapplies harness config by invoking the freshly installed binary", () => {
    const home = tempDir()
    const binaryPath = path.join(home, ".local/bin/memory-lane")
    const calls: Array<{ command: string; args: string[]; options: unknown }> = []
    const ok = reapplyManifestWithInstalledBinary(binaryPath, true, ((command: string, args: string[], options: unknown) => {
      calls.push({ command, args, options })
      return { status: 0 }
    }) as any)

    assert.equal(ok, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].command, binaryPath)
    assert.deepEqual(calls[0].args, ["upgrade", "--reapply-install-manifest", "--yes"])
  })

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
    assert.equal(result.manifest.version, VERSION)

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
    assert.deepEqual(result.manifest.integrations.map((integration) => integration.harness), ["legacy-harness", "pi"])
    assert.equal(result.results.some((r) => r.configured === false && r.message?.includes("Unknown harness")), true)
    assert.ok(fs.readFileSync(path.join(home, ".pi/agent/extensions/memory-lane/index.ts"), "utf8").includes(binaryPath))
  })

  it("passes the recorded binary directory to the release installer", () => {
    assert.deepEqual(installerEnvironment({ KEEP_ME: "yes" }, "/custom/bin"), {
      KEEP_ME: "yes",
      INSTALL_DIR: "/custom/bin",
    })
    assert.deepEqual(installerEnvironment({ KEEP_ME: "yes" }), { KEEP_ME: "yes" })
  })

  it("uses a manifest binary path and recorded OMP config path during reapply", () => {
    const home = tempDir()
    const dataDir = path.join(home, ".memory-lane")
    const binaryPath = path.join(home, "custom-bin", "memory-lane")
    const ompConfigPath = path.join(home, "custom-agent", "extensions", "memory-lane", "index.ts")
    const environmentBinaryPath = path.join(home, "wrong-bin", "memory-lane")
    fs.mkdirSync(dataDir, { recursive: true })
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true })
    fs.writeFileSync(binaryPath, "binary sentinel", "utf8")
    writeInstallManifest(dataDir, {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath,
      dataDir,
      integrations: [{ harness: "omp", configPath: ompConfigPath }],
    })

    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/index.js")
    const result = spawnSync(process.execPath, [cli, "upgrade", "--reapply-install-manifest", "--yes"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        MEMORY_LANE_INSTALL_BINARY: environmentBinaryPath,
        PI_CODING_AGENT_DIR: undefined,
      },
    })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /omp reconfigured/u)
    assert.equal(fs.existsSync(ompConfigPath), true)
    assert.match(fs.readFileSync(ompConfigPath, "utf8"), new RegExp(binaryPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"))
    const next = readInstallManifest(dataDir)
    assert.equal(next.status, "valid")
    if (next.status !== "valid") return
    assert.equal(next.manifest.binaryPath, binaryPath)
    assert.equal(next.manifest.integrations[0].configPath, ompConfigPath)
    assert.equal(fs.existsSync(path.join(home, ".omp", "agent")), false)
    assert.equal(fs.existsSync(environmentBinaryPath), false)
  })

  it("does not write unsafe manifest-recorded OMP config paths during reapply", () => {
    const home = tempDir()
    const dataDir = path.join(home, ".memory-lane")
    const binaryPath = path.join(home, ".local", "bin", "memory-lane")
    const unsafePath = path.join(home, "arbitrary", "index.ts")
    fs.mkdirSync(dataDir, { recursive: true })

    const result = reapplyInstallManifest(
      {
        binaryPath,
        dataDir,
        projectMode: false,
        yes: true,
        homeDir: home,
      },
      {
        version: "0.1.0",
        installedAt: "2026-01-01T00:00:00.000Z",
        binaryPath: path.join(home, ".local", "bin", "old-memory-lane"),
        dataDir,
        integrations: [{ harness: "omp", configPath: unsafePath }],
      },
    )

    assert.equal(result.configuredCount, 0)
    assert.equal(fs.existsSync(unsafePath), false)
    assert.match(result.results[0].message ?? "", /Refusing to manage an unexpected OMP extension path/u)
    const next = readInstallManifest(dataDir)
    assert.equal(next.status, "valid")
    if (next.status !== "valid") return
    assert.deepEqual(next.manifest.integrations, [{ harness: "omp", configPath: unsafePath }])
  })

  it("uses the platform default only when the manifest is missing", () => {
    const home = tempDir()
    const missing = readInstallManifest(path.join(home, ".memory-lane"))
    assert.equal(resolveUpgradeBinaryPath(missing, home, false), defaultInstalledBinaryPath(home, false))
  })

  it("refuses malformed, relative, and unmanaged manifest binary paths", () => {
    const home = tempDir()
    const dataDir = path.join(home, ".memory-lane")
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, "install.json"), "{", "utf8")
    assert.throws(() => resolveUpgradeBinaryPath(readInstallManifest(dataDir), home, false), /Invalid JSON/u)

    writeInstallManifest(dataDir, {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath: "relative/memory-lane",
      dataDir,
      integrations: [],
    })
    assert.throws(() => resolveUpgradeBinaryPath(readInstallManifest(dataDir), home, false), /absolute path/u)

    writeInstallManifest(dataDir, {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath: path.join(home, "packages", "cli", "dist", "index.js"),
      dataDir,
      integrations: [],
    })
    assert.throws(() => resolveUpgradeBinaryPath(readInstallManifest(dataDir), home, false), /not managed/u)
  })

  it("accepts a mixed-case standard Windows binary path and normalizes segments", () => {
    const manifestResult = {
      status: "valid" as const,
      path: "C:\\Users\\Ryan\\.memory-lane\\install.json",
      warnings: [],
      manifest: {
        binaryPath: "C:\\Tools\\staging\\..\\Memory-Lane.EXE",
        dataDir: "C:\\Users\\Ryan\\.memory-lane",
        integrations: [],
      },
    }
    assert.equal(
      resolveUpgradeBinaryPath(manifestResult, "C:\\Users\\Ryan", true, path.win32),
      "C:\\Tools\\Memory-Lane.EXE",
    )
  })
})
