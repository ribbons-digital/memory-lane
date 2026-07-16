import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"
import {
  acquireUpgradeLock,
  defaultInstalledBinaryPath,
  installerEnvironment,
  reapplyInstallManifest,
  reapplyManifestWithInstalledBinary,
  releaseUpgradeLock,
  resolveInstallerDirectory,
  resolveUpgradeBinaryPath,
  snapshotInstallManifest,
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
    assert.equal(readInstallManifest(dataDir).status, "missing")
  })

  it("passes the Windows executable and manifest transaction to the release installer", () => {
    const manifestTransaction = {
      path: "C:\\Homes\\Ryan\\.memory-lane\\install.json",
      backupPath: "C:\\Homes\\Ryan\\.memory-lane\\install.json.upgrade.1234",
      existed: true,
    }
    const upgradeLock = { path: "C:\\custom\\bin\\.memory-lane-upgrade.lock", owner: "1234" }
    assert.deepEqual(installerEnvironment({ KEEP_ME: "yes" }, "C:\\custom\\bin", 1234, manifestTransaction, upgradeLock), {
      KEEP_ME: "yes",
      INSTALL_DIR: "C:\\custom\\bin",
      MEMORY_LANE_UPGRADE_PID: "1234",
      MEMORY_LANE_UPGRADE_MANIFEST_PATH: manifestTransaction.path,
      MEMORY_LANE_UPGRADE_MANIFEST_BACKUP_PATH: manifestTransaction.backupPath,
      MEMORY_LANE_UPGRADE_MANIFEST_EXISTED: "true",
      MEMORY_LANE_UPGRADE_LOCK_PATH: upgradeLock.path,
    })
    assert.deepEqual(installerEnvironment({ KEEP_ME: "yes" }), { KEEP_ME: "yes" })
  })

  it("serializes Windows upgrades with an owner-checked lock", () => {
    const installDir = tempDir()
    const lock = acquireUpgradeLock(installDir, process.pid)

    assert.throws(() => acquireUpgradeLock(installDir, process.pid), /already in progress/u)
    fs.writeFileSync(path.join(lock.path, "owner"), "different-owner", "utf8")
    releaseUpgradeLock(lock)
    assert.equal(fs.existsSync(lock.path), true)
    fs.rmSync(lock.path, { recursive: true, force: true })
  })

  it("uses the HOME-based Windows binary directory when the manifest is missing", () => {
    const binaryPath = defaultInstalledBinaryPath("C:\\Homes\\Ryan", true, path.win32)
    const installDir = resolveInstallerDirectory(binaryPath, true, false, path.win32)

    assert.equal(installDir, "C:\\Homes\\Ryan\\bin")
    assert.equal(installerEnvironment({ USERPROFILE: "C:\\Users\\Ryan" }, installDir).INSTALL_DIR, installDir)
  })

  it("preserves the non-Windows installer default when the manifest is missing", () => {
    const binaryPath = defaultInstalledBinaryPath("/home/ryan", false, path.posix)

    assert.equal(resolveInstallerDirectory(binaryPath, false, false, path.posix), undefined)
  })

  it("snapshots existing and absent manifests for the Windows upgrade transaction", () => {
    const existingDataDir = tempDir()
    const existingManifestPath = path.join(existingDataDir, "install.json")
    fs.writeFileSync(existingManifestPath, "original manifest", "utf8")

    const existing = snapshotInstallManifest(existingDataDir, 1234)
    assert.equal(existing.existed, true)
    assert.equal(existing.path, existingManifestPath)
    assert.equal(fs.readFileSync(existing.backupPath, "utf8"), "original manifest")

    const missingDataDir = tempDir()
    const missing = snapshotInstallManifest(missingDataDir, 5678)
    assert.equal(missing.existed, false)
    assert.equal(fs.existsSync(missing.backupPath), false)
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

  it("returns non-zero when no required manifest integration can be reapplied", () => {
    const home = tempDir()
    const dataDir = path.join(home, ".memory-lane")
    const binaryPath = path.join(home, ".local", "bin", "memory-lane")
    fs.mkdirSync(dataDir, { recursive: true })
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true })
    fs.writeFileSync(binaryPath, "binary sentinel", "utf8")
    writeInstallManifest(dataDir, {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath,
      dataDir,
      integrations: [{ harness: "unknown-required", configPath: path.join(home, "unknown.json") }],
    })
    const manifestPath = path.join(dataDir, "install.json")
    const originalManifest = fs.readFileSync(manifestPath, "utf8")

    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/index.js")
    const result = spawnSync(process.execPath, [cli, "upgrade", "--reapply-install-manifest", "--yes"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: undefined },
    })

    assert.equal(result.status, 1)
    assert.match(result.stdout, /No previous harness configs were reapplied/u)
    assert.equal(fs.readFileSync(manifestPath, "utf8"), originalManifest)
  })

  it("returns non-zero when any required manifest integration fails", () => {
    const home = tempDir()
    const dataDir = path.join(home, ".memory-lane")
    const binaryPath = path.join(home, ".local", "bin", "memory-lane")
    fs.mkdirSync(dataDir, { recursive: true })
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true })
    fs.writeFileSync(binaryPath, "binary sentinel", "utf8")
    writeInstallManifest(dataDir, {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath,
      dataDir,
      integrations: [
        { harness: "pi", configPath: path.join(home, ".pi", "agent", "extensions", "memory-lane", "index.ts") },
        { harness: "unknown-required", configPath: path.join(home, "unknown.json") },
      ],
    })
    const manifestPath = path.join(dataDir, "install.json")
    const originalManifest = fs.readFileSync(manifestPath, "utf8")

    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/index.js")
    const result = spawnSync(process.execPath, [cli, "upgrade", "--reapply-install-manifest", "--yes"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: undefined },
    })

    assert.equal(result.status, 1)
    assert.match(result.stdout, /Failed to reapply 1 required harness configuration/u)
    assert.equal(fs.readFileSync(manifestPath, "utf8"), originalManifest)
  })

  it("rejects unsafe manifest-recorded OMP config paths before reapply writes", () => {
    const home = tempDir()
    const dataDir = path.join(home, ".memory-lane")
    const binaryPath = path.join(home, ".local", "bin", "memory-lane")
    const unsafePath = path.join(home, "arbitrary", "index.ts")
    fs.mkdirSync(dataDir, { recursive: true })

    assert.throws(() => reapplyInstallManifest(
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
    ), /Refusing to manage an unexpected OMP extension path/u)

    assert.equal(fs.existsSync(unsafePath), false)
    assert.equal(readInstallManifest(dataDir).status, "missing")
  })

  it("unsafe OMP paths stop CLI reapply without changing manifest or target", () => {
    const home = tempDir()
    const dataDir = path.join(home, ".memory-lane")
    const binaryPath = path.join(home, ".local", "bin", "memory-lane")
    const unsafePath = path.join(home, "arbitrary", "index.ts")
    fs.mkdirSync(dataDir, { recursive: true })
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true })
    fs.writeFileSync(binaryPath, "binary sentinel", "utf8")
    fs.mkdirSync(path.dirname(unsafePath), { recursive: true })
    fs.writeFileSync(unsafePath, "target sentinel", "utf8")
    writeInstallManifest(dataDir, {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath,
      dataDir,
      integrations: [{ harness: "omp", configPath: unsafePath }],
    })
    const manifestPath = path.join(dataDir, "install.json")
    const originalManifest = fs.readFileSync(manifestPath, "utf8")

    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/index.js")
    const result = spawnSync(process.execPath, [cli, "upgrade", "--reapply-install-manifest", "--yes"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: undefined },
    })

    assert.equal(result.status, 1)
    assert.match(result.stdout, /Refusing to manage an unexpected OMP extension path/u)
    assert.equal(fs.readFileSync(manifestPath, "utf8"), originalManifest)
    assert.equal(fs.readFileSync(unsafePath, "utf8"), "target sentinel")
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
