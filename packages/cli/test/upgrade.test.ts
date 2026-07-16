import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
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
  validateReapplyManifestAvailability,
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

function createStaleUpgradeTransaction(state: "pending" | "committed" | "restored" = "pending") {
  const installDir = tempDir()
  const dataDir = tempDir()
  const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
  const installPath = path.join(installDir, "memory-lane.exe")
  const backupPath = `${installPath}.backup.9876`
  const transactionPath = `${installPath}.upgrade.9876`
  const manifestPath = path.join(dataDir, "install.json")
  const manifestBackupPath = `${manifestPath}.upgrade.9876`
  const originalBinary = "original binary"
  fs.mkdirSync(lockPath)
  fs.writeFileSync(path.join(lockPath, "owner"), JSON.stringify({
    pid: 7654,
    processStartedAt: "333333333",
    token: "stale-owner",
    createdAt: 1_000_000,
    heartbeatAt: 1_000_000,
    phase: "recovery",
    parentPid: 9876,
    parentProcessStartedAt: "111111111",
    installerPid: 8765,
    installerProcessStartedAt: "222222222",
    recoveryPid: 7654,
    recoveryProcessStartedAt: "333333333",
  }), "utf8")
  fs.writeFileSync(installPath, "replacement binary", "utf8")
  fs.writeFileSync(backupPath, originalBinary, "utf8")
  fs.writeFileSync(manifestPath, "replacement manifest", "utf8")
  fs.writeFileSync(manifestBackupPath, "original manifest", "utf8")
  if (state === "restored") fs.writeFileSync(installPath, originalBinary, "utf8")
  fs.writeFileSync(transactionPath, JSON.stringify({
    State: state,
    BackupState: state === "restored" ? "restored" : "backed-up",
    ManifestState: state === "restored" ? "restored" : "existing",
    ManifestPath: manifestPath,
    ManifestBackupPath: manifestBackupPath,
    LockPath: lockPath,
    LockOwner: "stale-owner",
    ParentPid: "9876",
    ParentStartedAt: "111111111",
    InstallerPid: "8765",
    InstallerStartedAt: "222222222",
    OriginalBinaryHash: createHash("sha256").update(originalBinary).digest("hex"),
  }), "utf8")
  return { installDir, lockPath, installPath, backupPath, transactionPath, manifestPath, manifestBackupPath }
}

describe("upgrade", () => {
  it("reapplies harness config by invoking the freshly installed binary", () => {
    const home = tempDir()
    const binaryPath = path.join(home, ".local/bin/memory-lane")
    const calls: Array<{ command: string; args: string[]; options: unknown }> = []
    const spawn = ((command: string, args: string[], options: unknown) => {
      calls.push({ command, args, options })
      return { status: 0 }
    }) as any

    assert.equal(reapplyManifestWithInstalledBinary(binaryPath, true, false, spawn), true)
    assert.equal(reapplyManifestWithInstalledBinary(binaryPath, true, true, spawn), true)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].command, binaryPath)
    assert.deepEqual(calls[0].args, ["upgrade", "--reapply-install-manifest", "--yes"])
    assert.deepEqual(calls[1].args, [
      "upgrade",
      "--reapply-install-manifest",
      "--transactional-windows-upgrade",
      "--yes",
    ])
  })

  it("rejects missing and empty manifests only for transactional Windows reapply", () => {
    assert.equal(validateReapplyManifestAvailability(undefined, false), "missing")
    assert.throws(
      () => validateReapplyManifestAvailability(undefined, true),
      /required install manifest is missing/u,
    )

    const emptyManifest = {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath: "C:\\Users\\Ryan\\bin\\memory-lane.exe",
      dataDir: "C:\\Users\\Ryan\\.memory-lane",
      integrations: [],
    } as InstallManifest
    assert.equal(validateReapplyManifestAvailability(emptyManifest, false), "empty")
    assert.throws(
      () => validateReapplyManifestAvailability(emptyManifest, true),
      /required install manifest contains no integrations/u,
    )
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

  it("records successful non-Windows reconfiguration when another integration fails", () => {
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
      false,
    )

    assert.equal(result.configuredCount, 1)
    assert.deepEqual(result.manifest.integrations.map((integration) => integration.harness), ["legacy-harness", "pi"])
    assert.equal(result.results.some((r) => r.configured === false && r.message?.includes("Unknown harness")), true)
    assert.ok(fs.readFileSync(path.join(home, ".pi/agent/extensions/memory-lane/index.ts"), "utf8").includes(binaryPath))
    const persisted = readInstallManifest(dataDir)
    assert.equal(persisted.status, "valid")
    if (persisted.status !== "valid") return
    assert.equal(persisted.manifest.binaryPath, binaryPath)
    assert.deepEqual(persisted.manifest.integrations.map((integration) => integration.harness), ["legacy-harness", "pi"])
  })

  it("rejects malformed integrations before transactional Windows reconfiguration", () => {
    const home = tempDir()
    const dataDir = path.join(home, ".memory-lane")
    const binaryPath = path.join(home, ".local/bin/memory-lane")
    const piConfigPath = path.join(home, ".pi/agent/extensions/memory-lane/index.ts")
    fs.mkdirSync(dataDir, { recursive: true })

    const manifest = {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath: path.join(home, ".local/bin/old-memory-lane"),
      dataDir,
      integrations: [
        { harness: "pi", configPath: piConfigPath },
        { configPath: path.join(home, "malformed.json") },
      ],
    } as InstallManifest
    writeInstallManifest(dataDir, manifest)
    const manifestPath = path.join(dataDir, "install.json")
    const originalManifest = fs.readFileSync(manifestPath, "utf8")

    assert.throws(
      () => reapplyInstallManifest(
        {
          binaryPath,
          dataDir,
          projectMode: false,
          yes: true,
          homeDir: home,
        },
        manifest,
        true,
      ),
      /integration 2 has no usable harness during transactional reapply/u,
    )

    assert.equal(fs.existsSync(piConfigPath), false)
    assert.equal(fs.readFileSync(manifestPath, "utf8"), originalManifest)
  })

  it("rejects unknown integrations before transactional Windows reconfiguration", () => {
    const home = tempDir()
    const dataDir = path.join(home, ".memory-lane")
    const binaryPath = path.join(home, ".local/bin/memory-lane")
    const piConfigPath = path.join(home, ".pi/agent/extensions/memory-lane/index.ts")
    fs.mkdirSync(dataDir, { recursive: true })

    assert.throws(
      () => reapplyInstallManifest(
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
          binaryPath: path.join(home, ".local/bin/old-memory-lane"),
          dataDir,
          integrations: [
            { harness: "pi", configPath: piConfigPath },
            { harness: "legacy-harness", configPath: path.join(home, "legacy.json") },
          ],
        } as InstallManifest,
        true,
      ),
      /integration 2 has unknown harness legacy-harness during transactional reapply/u,
    )

    assert.equal(fs.existsSync(piConfigPath), false)
    assert.equal(readInstallManifest(dataDir).status, "missing")
  })

  it("rejects duplicate OMP integrations before transactional Windows reconfiguration", () => {
    const home = tempDir()
    const dataDir = path.join(home, ".memory-lane")
    const binaryPath = path.join(home, ".local/bin/memory-lane")
    const firstConfigPath = path.join(home, "first-agent/extensions/memory-lane/index.ts")
    const secondConfigPath = path.join(home, "second-agent/extensions/memory-lane/index.ts")
    fs.mkdirSync(dataDir, { recursive: true })

    const manifest: InstallManifest = {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath: path.join(home, ".local/bin/old-memory-lane"),
      dataDir,
      integrations: [
        { harness: "omp", configPath: firstConfigPath },
        { harness: "omp", configPath: secondConfigPath },
      ],
    }
    writeInstallManifest(dataDir, manifest)
    const manifestPath = path.join(dataDir, "install.json")
    const originalManifest = fs.readFileSync(manifestPath, "utf8")

    assert.throws(
      () => reapplyInstallManifest(
        {
          binaryPath,
          dataDir,
          projectMode: false,
          yes: true,
          homeDir: home,
        },
        manifest,
        true,
      ),
      /integration 2 has duplicate harness omp during transactional reapply/u,
    )

    assert.equal(fs.existsSync(firstConfigPath), false)
    assert.equal(fs.existsSync(secondConfigPath), false)
    assert.equal(fs.readFileSync(manifestPath, "utf8"), originalManifest)
  })

  it("passes the Windows executable and manifest transaction to the release installer", () => {
    const manifestTransaction = {
      path: "C:\\Homes\\Ryan\\.memory-lane\\install.json",
      backupPath: "C:\\Homes\\Ryan\\.memory-lane\\install.json.upgrade.1234",
      existed: true,
    }
    const upgradeLock = { path: "C:\\custom\\bin\\.memory-lane-upgrade.lock", owner: "owner-token" }
    assert.deepEqual(installerEnvironment({ KEEP_ME: "yes" }, "C:\\custom\\bin", 1234, manifestTransaction, upgradeLock), {
      KEEP_ME: "yes",
      INSTALL_DIR: "C:\\custom\\bin",
      MEMORY_LANE_UPGRADE_PID: "1234",
      MEMORY_LANE_UPGRADE_MANIFEST_PATH: manifestTransaction.path,
      MEMORY_LANE_UPGRADE_MANIFEST_BACKUP_PATH: manifestTransaction.backupPath,
      MEMORY_LANE_UPGRADE_MANIFEST_EXISTED: "true",
      MEMORY_LANE_UPGRADE_LOCK_PATH: upgradeLock.path,
      MEMORY_LANE_UPGRADE_LOCK_OWNER: upgradeLock.owner,
    })
    assert.deepEqual(installerEnvironment({ KEEP_ME: "yes" }), { KEEP_ME: "yes" })
  })

  it("serializes Windows upgrades with an owner-checked lock", () => {
    const installDir = tempDir()
    const lock = acquireUpgradeLock(installDir, process.pid)
    const owner = JSON.parse(fs.readFileSync(path.join(lock.path, "owner"), "utf8"))

    assert.equal(owner.pid, process.pid)
    assert.match(owner.processStartedAt, /^\d+$/u)
    assert.equal(owner.token, lock.owner)
    assert.equal(typeof owner.createdAt, "number")
    assert.equal(owner.heartbeatAt, owner.createdAt)
    assert.equal(owner.phase, "starting")
    assert.equal(owner.parentPid, process.pid)
    assert.equal(owner.parentProcessStartedAt, owner.processStartedAt)
    assert.throws(() => acquireUpgradeLock(installDir, process.pid), /already in progress/u)
    fs.writeFileSync(
      path.join(lock.path, "owner"),
      JSON.stringify({
        pid: process.pid,
        token: "different-owner",
        createdAt: Date.now(),
        heartbeatAt: Date.now(),
        phase: "starting",
      }),
      "utf8",
    )
    releaseUpgradeLock(lock)
    assert.equal(fs.existsSync(lock.path), true)
    fs.rmSync(lock.path, { recursive: true, force: true })

    const releasable = acquireUpgradeLock(installDir, process.pid)
    releaseUpgradeLock(releasable)
    assert.equal(fs.existsSync(releasable.path), false)
  })

  it("preserves a long-running starting lock while its process identity matches", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const now = 10_000_000
    fs.mkdirSync(lockPath)
    fs.writeFileSync(
      path.join(lockPath, "owner"),
      JSON.stringify({
        pid: 9876,
        processStartedAt: "123456789",
        token: "active-owner",
        createdAt: now - 5_000_000,
        heartbeatAt: now - 5_000_000,
        phase: "starting",
        parentPid: 9876,
        parentProcessStartedAt: "123456789",
      }),
      "utf8",
    )

    assert.throws(
      () => acquireUpgradeLock(installDir, process.pid, {
        now: () => now,
        staleAfterMs: 1_000,
        inspectProcessStartTime: (processId) => processId === 9876
          ? { status: "found", startedAt: "123456789" }
          : { status: "found", startedAt: "987654321" },
      }),
      /already in progress/u,
    )
    assert.equal(fs.existsSync(lockPath), true)
  })

  it("preserves a starting lock while its registered installer remains active", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const now = 2_000_000
    fs.mkdirSync(lockPath)
    fs.writeFileSync(path.join(lockPath, "owner"), JSON.stringify({
      pid: 9876,
      processStartedAt: "111111111",
      token: "starting-owner",
      createdAt: now,
      heartbeatAt: now,
      phase: "starting",
      parentPid: 9876,
      parentProcessStartedAt: "111111111",
      installerPid: 8765,
      installerProcessStartedAt: "222222222",
    }), "utf8")

    assert.throws(
      () => acquireUpgradeLock(installDir, process.pid, {
        now: () => now,
        inspectProcessStartTime: (processId) => processId === 8765
          ? { status: "found", startedAt: "222222222" }
          : processId === process.pid
            ? { status: "found", startedAt: "333333333" }
            : { status: "missing" },
      }),
      /already in progress/u,
    )
    assert.equal(fs.existsSync(lockPath), true)
  })

  it("excludes recovery handoff while quarantining a stale starting lock", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const now = 2_000_000
    let handoffWasExcluded = false
    fs.mkdirSync(lockPath)
    fs.writeFileSync(path.join(lockPath, "owner"), JSON.stringify({
      pid: 9876,
      processStartedAt: "111111111",
      token: "stale-owner",
      createdAt: now,
      heartbeatAt: now,
      phase: "starting",
      parentPid: 9876,
      parentProcessStartedAt: "111111111",
    }), "utf8")

    const lock = acquireUpgradeLock(installDir, process.pid, {
      now: () => now,
      createToken: () => "replacement-owner",
      inspectProcessStartTime: (processId) => processId === process.pid
        ? { status: "found", startedAt: "333333333" }
        : { status: "missing" },
      onReclaimClaimed: (claimPath) => {
        assert.deepEqual(JSON.parse(fs.readFileSync(claimPath, "utf8")), {
          pid: process.pid,
          processStartedAt: "333333333",
          token: "replacement-owner",
          createdAt: now,
        })
        assert.equal(fs.existsSync(`${claimPath}.replacement-owner.${process.pid}.tmp`), false)
        assert.throws(
          () => fs.writeFileSync(claimPath, "recovery handoff", { flag: "wx" }),
          (error: NodeJS.ErrnoException) => error.code === "EEXIST",
        )
        handoffWasExcluded = true
      },
    })

    assert.equal(handoffWasExcluded, true)
    assert.equal(lock.owner, "replacement-owner")
    releaseUpgradeLock(lock)
  })

  it("never replaces an active reclaim claim during atomic publication", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const reclaimPath = path.join(lockPath, ".reclaim")
    const now = 2_000_000
    const activeClaim = {
      pid: 7654,
      processStartedAt: "444444444",
      token: "active-claim",
      createdAt: now,
    }
    fs.mkdirSync(lockPath)
    fs.writeFileSync(path.join(lockPath, "owner"), JSON.stringify({
      pid: 9876,
      processStartedAt: "111111111",
      token: "stale-owner",
      createdAt: now,
      heartbeatAt: now,
      phase: "starting",
      parentPid: 9876,
      parentProcessStartedAt: "111111111",
    }), "utf8")
    fs.writeFileSync(reclaimPath, JSON.stringify(activeClaim), "utf8")

    assert.throws(
      () => acquireUpgradeLock(installDir, process.pid, {
        now: () => now,
        createToken: () => "replacement-owner",
        inspectProcessStartTime: (processId) => processId === process.pid
          ? { status: "found", startedAt: "333333333" }
          : processId === activeClaim.pid
            ? { status: "found", startedAt: activeClaim.processStartedAt }
            : { status: "missing" },
      }),
      /Could not acquire/u,
    )
    assert.deepEqual(JSON.parse(fs.readFileSync(reclaimPath, "utf8")), activeClaim)
    assert.equal(fs.existsSync(`${reclaimPath}.replacement-owner.${process.pid}.tmp`), false)
  })

  it("reclaims a starting lock after its PID is reused", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const now = 2_000_000
    fs.mkdirSync(lockPath)
    fs.writeFileSync(
      path.join(lockPath, "owner"),
      JSON.stringify({
        pid: 9876,
        processStartedAt: "123456789",
        token: "old-owner",
        createdAt: now,
        heartbeatAt: now,
        phase: "starting",
        parentPid: 9876,
        parentProcessStartedAt: "123456789",
      }),
      "utf8",
    )

    const lock = acquireUpgradeLock(installDir, process.pid, {
      now: () => now,
      createToken: () => "replacement-owner",
      inspectProcessStartTime: (processId) => processId === 9876
        ? { status: "found", startedAt: "999999999" }
        : { status: "found", startedAt: "987654321" },
    })

    assert.equal(lock.owner, "replacement-owner")
    releaseUpgradeLock(lock)
    assert.equal(fs.existsSync(lockPath), false)
  })

  it("preserves a fresh lock with malformed owner metadata", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const now = 2_000_000
    fs.mkdirSync(lockPath)
    fs.writeFileSync(path.join(lockPath, "owner"), "{", "utf8")
    fs.utimesSync(lockPath, new Date(now), new Date(now))

    assert.throws(
      () => acquireUpgradeLock(installDir, process.pid, { now: () => now, staleAfterMs: 1_000 }),
      /metadata is not yet available/u,
    )
    assert.equal(fs.existsSync(lockPath), true)
  })

  it("reclaims a stale lock with missing owner metadata", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const now = 2_000_000
    fs.mkdirSync(lockPath)
    fs.utimesSync(lockPath, new Date(now - 1_001), new Date(now - 1_001))

    const lock = acquireUpgradeLock(installDir, process.pid, {
      now: () => now,
      createToken: () => "replacement-owner",
      staleAfterMs: 1_000,
    })

    assert.equal(lock.owner, "replacement-owner")
    releaseUpgradeLock(lock)
    assert.equal(fs.existsSync(lockPath), false)
  })

  it("preserves an expired recovery lease while its process identity matches", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const now = 2_000_000
    const recoveryOwner = {
      pid: 9876,
      processStartedAt: "123456789",
      token: "recovery-owner",
      createdAt: now - 10_000,
      heartbeatAt: now - 5_000,
      phase: "recovery",
      parentPid: 8765,
      parentProcessStartedAt: "222222222",
      recoveryPid: 9876,
      recoveryProcessStartedAt: "123456789",
    }
    fs.mkdirSync(lockPath)
    fs.writeFileSync(path.join(lockPath, "owner"), JSON.stringify(recoveryOwner), "utf8")

    assert.throws(
      () => acquireUpgradeLock(installDir, process.pid, {
        now: () => now,
        staleAfterMs: 1_000,
        inspectProcessStartTime: (processId) => processId === 9876
          ? { status: "found", startedAt: "123456789" }
          : processId === 8765
            ? { status: "missing" }
            : { status: "found", startedAt: "987654321" },
      }),
      /already in progress/u,
    )
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(lockPath, "owner"), "utf8")), recoveryOwner)
  })

  it("preserves a recovery lock while its original parent remains active", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const now = 2_000_000
    fs.mkdirSync(lockPath)
    fs.writeFileSync(path.join(lockPath, "owner"), JSON.stringify({
      pid: 9876,
      processStartedAt: "111111111",
      token: "recovery-owner",
      createdAt: now - 10_000,
      heartbeatAt: now - 5_000,
      phase: "recovery",
      parentPid: 8765,
      parentProcessStartedAt: "222222222",
      recoveryPid: 9876,
      recoveryProcessStartedAt: "111111111",
    }), "utf8")

    assert.throws(
      () => acquireUpgradeLock(installDir, process.pid, {
        now: () => now,
        inspectProcessStartTime: (processId) => processId === 8765
          ? { status: "found", startedAt: "222222222" }
          : processId === 9876
            ? { status: "missing" }
            : { status: "found", startedAt: "333333333" },
      }),
      /already in progress/u,
    )
    assert.equal(fs.existsSync(lockPath), true)
  })

  it("preserves a lock while a registered finalizer remains active", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const now = 2_000_000
    fs.mkdirSync(lockPath)
    fs.writeFileSync(path.join(lockPath, "owner"), JSON.stringify({
      pid: 9876,
      processStartedAt: "111111111",
      token: "recovery-owner",
      createdAt: now - 10_000,
      heartbeatAt: now - 5_000,
      phase: "recovery",
      parentPid: 8765,
      parentProcessStartedAt: "222222222",
      recoveryPid: 9876,
      recoveryProcessStartedAt: "111111111",
    }), "utf8")
    fs.writeFileSync(path.join(lockPath, "active-actor"), JSON.stringify({
      pid: 7654,
      processStartedAt: "444444444",
      token: "recovery-owner",
      action: "Commit",
    }), "utf8")

    assert.throws(
      () => acquireUpgradeLock(installDir, process.pid, {
        now: () => now,
        inspectProcessStartTime: (processId) => processId === 7654
          ? { status: "found", startedAt: "444444444" }
          : processId === process.pid
            ? { status: "found", startedAt: "333333333" }
            : { status: "missing" },
      }),
      /already in progress/u,
    )
    assert.equal(fs.existsSync(lockPath), true)

    const replacement = acquireUpgradeLock(installDir, process.pid, {
      now: () => now,
      createToken: () => "replacement-owner",
      inspectProcessStartTime: (processId) => processId === process.pid
        ? { status: "found", startedAt: "333333333" }
        : { status: "missing" },
    })
    assert.equal(replacement.owner, "replacement-owner")
    releaseUpgradeLock(replacement)
    assert.equal(fs.existsSync(lockPath), false)
  })

  it("preserves a starting lock when process inspection is unavailable", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const now = 2_000_000
    fs.mkdirSync(lockPath)
    fs.writeFileSync(
      path.join(lockPath, "owner"),
      JSON.stringify({
        pid: 9876,
        processStartedAt: "123456789",
        token: "starting-owner",
        createdAt: now - 10_000,
        heartbeatAt: now - 5_000,
        phase: "starting",
        parentPid: 9876,
        parentProcessStartedAt: "123456789",
      }),
      "utf8",
    )

    assert.throws(
      () => acquireUpgradeLock(installDir, process.pid, {
        now: () => now,
        staleAfterMs: 1_000,
        inspectProcessStartTime: (processId) => processId === 9876
          ? { status: "unknown" }
          : { status: "found", startedAt: "987654321" },
      }),
      /already in progress/u,
    )
    assert.equal(fs.existsSync(lockPath), true)
  })

  it("rolls back a pending transaction before reclaiming a crashed recovery lock", () => {
    const fixture = createStaleUpgradeTransaction()

    const lock = acquireUpgradeLock(fixture.installDir, process.pid, {
      createToken: () => "replacement-owner",
      inspectProcessStartTime: (processId) => processId === process.pid
        ? { status: "found", startedAt: "444444444" }
        : { status: "missing" },
    })

    assert.equal(fs.readFileSync(fixture.installPath, "utf8"), "original binary")
    assert.equal(fs.readFileSync(fixture.manifestPath, "utf8"), "original manifest")
    assert.equal(fs.existsSync(fixture.backupPath), false)
    assert.equal(fs.existsSync(fixture.manifestBackupPath), false)
    assert.equal(fs.existsSync(fixture.transactionPath), false)
    releaseUpgradeLock(lock)
  })

  for (const state of ["committed", "restored"] as const) {
    it(`finishes ${state} transaction cleanup before reclaiming a crashed recovery lock`, () => {
      const fixture = createStaleUpgradeTransaction(state)

      const lock = acquireUpgradeLock(fixture.installDir, process.pid, {
        createToken: () => "replacement-owner",
        inspectProcessStartTime: (processId) => processId === process.pid
          ? { status: "found", startedAt: "444444444" }
          : { status: "missing" },
      })

      assert.equal(
        fs.readFileSync(fixture.installPath, "utf8"),
        state === "committed" ? "replacement binary" : "original binary",
      )
      assert.equal(fs.readFileSync(fixture.manifestPath, "utf8"), "replacement manifest")
      assert.equal(fs.existsSync(fixture.backupPath), false)
      assert.equal(fs.existsSync(fixture.manifestBackupPath), false)
      assert.equal(fs.existsSync(fixture.transactionPath), false)
      releaseUpgradeLock(lock)
    })
  }

  it("refuses to reclaim a crashed recovery lock with malformed transaction state", () => {
    const fixture = createStaleUpgradeTransaction()
    fs.writeFileSync(fixture.transactionPath, "{", "utf8")

    assert.throws(
      () => acquireUpgradeLock(fixture.installDir, process.pid, {
        createToken: () => "replacement-owner",
        inspectProcessStartTime: (processId) => processId === process.pid
          ? { status: "found", startedAt: "444444444" }
          : { status: "missing" },
      }),
      /cannot safely reclaim.+malformed/iu,
    )
    assert.equal(fs.existsSync(fixture.lockPath), true)
    assert.equal(fs.existsSync(path.join(fixture.lockPath, ".reclaim")), false)
    assert.equal(fs.existsSync(fixture.backupPath), true)
  })

  it("reclaims a recovery lock only after confirmed process identity mismatch", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const now = 2_000_000
    fs.mkdirSync(lockPath)
    fs.writeFileSync(
      path.join(lockPath, "owner"),
      JSON.stringify({
        pid: 9876,
        processStartedAt: "123456789",
        token: "stale-owner",
        createdAt: now - 10_000,
        heartbeatAt: now,
        phase: "recovery",
        parentPid: 8765,
        parentProcessStartedAt: "222222222",
        recoveryPid: 9876,
        recoveryProcessStartedAt: "123456789",
      }),
      "utf8",
    )

    const lock = acquireUpgradeLock(installDir, process.pid, {
      now: () => now,
      createToken: () => "replacement-owner",
      inspectProcessStartTime: (processId) => processId === 9876
        ? { status: "found", startedAt: "999999999" }
        : processId === 8765
          ? { status: "missing" }
          : { status: "found", startedAt: "987654321" },
    })

    assert.equal(lock.owner, "replacement-owner")
    releaseUpgradeLock(lock)
  })

  it("does not let the parent release a recovery-owned lock", () => {
    const installDir = tempDir()
    const lock = acquireUpgradeLock(installDir, process.pid)
    const ownerPath = path.join(lock.path, "owner")
    const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"))
    fs.writeFileSync(ownerPath, JSON.stringify({
      ...owner,
      pid: 9876,
      processStartedAt: "123456789",
      phase: "recovery",
      recoveryPid: 9876,
      recoveryProcessStartedAt: "123456789",
    }), "utf8")

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

  it("preserves ordinary reapply success when no manifest integration can be reapplied", () => {
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

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /No previous harness configs were reapplied/u)
    assert.notEqual(fs.readFileSync(manifestPath, "utf8"), originalManifest)
    const persisted = readInstallManifest(dataDir)
    assert.equal(persisted.status, "valid")
    if (persisted.status !== "valid") return
    assert.equal(persisted.manifest.version, VERSION)
    assert.equal(persisted.manifest.binaryPath, binaryPath)
  })

  it("enforces strict failures only for transactional Windows reapply", () => {
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
    const result = spawnSync(process.execPath, [
      cli,
      "upgrade",
      "--reapply-install-manifest",
      "--transactional-windows-upgrade",
      "--yes",
    ], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: undefined },
    })

    assert.equal(result.status, process.platform === "win32" ? 1 : 0, result.stderr)
    if (process.platform === "win32") {
      assert.match(result.stdout, /Failed to reapply 1 required harness configuration/u)
      assert.equal(fs.readFileSync(manifestPath, "utf8"), originalManifest)
    } else {
      assert.doesNotMatch(result.stdout, /Failed to reapply 1 required harness configuration/u)
      const persisted = readInstallManifest(dataDir)
      assert.equal(persisted.status, "valid")
      if (persisted.status !== "valid") return
      assert.equal(persisted.manifest.version, VERSION)
      assert.equal(persisted.manifest.binaryPath, binaryPath)
    }
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
