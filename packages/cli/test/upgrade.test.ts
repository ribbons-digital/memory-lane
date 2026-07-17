import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
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
import {
  commitWindowsUpgrade,
  handleCommittedCleanup,
  removeMatchingUpgradeLock,
  rollbackWindowsUpgrade,
  runTransactionalWindowsInstaller,
  WINDOWS_COMMITTED_CLEANUP_FLAG,
  WINDOWS_COMMITTED_CLEANUP_TIMEOUT_MS,
} from "../src/commands/windows-upgrade.js"
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

function createStaleUpgradeTransaction(
  state: "pending" | "committed" | "restored" = "pending",
  legacyOwner = false,
) {
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
  fs.writeFileSync(path.join(lockPath, "owner"), JSON.stringify(legacyOwner
    ? {
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
      }
    : {
        pid: 9876,
        processStartedAt: "111111111",
        token: "stale-owner",
        createdAt: 1_000_000,
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
function committedCleanupArgs(fixture: ReturnType<typeof createStaleUpgradeTransaction>): string[] {
  return [
    WINDOWS_COMMITTED_CLEANUP_FLAG,
    "--transaction", fixture.transactionPath,
    "--install", fixture.installPath,
    "--manifest", fixture.manifestPath,
    "--manifest-backup", fixture.manifestBackupPath,
    "--lock", fixture.lockPath,
    "--owner", "stale-owner",
    "--parent-pid", "9876",
    "--parent-started-at", "111111111",
  ]
}
function fakeChildProcess(pid: number, exitWithoutKill: boolean): {
  child: ReturnType<typeof import("node:child_process").spawn>
  wasKilled: () => boolean
} {
  const events = new EventEmitter()
  let killed = false
  const child = Object.assign(events, {
    pid,
    kill: () => {
      killed = true
      queueMicrotask(() => events.emit("exit", null))
      return true
    },
    unref: () => {},
  }) as unknown as ReturnType<typeof import("node:child_process").spawn>
  if (exitWithoutKill) queueMicrotask(() => events.emit("exit", 0))
  return { child, wasKilled: () => killed }
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
  it("publishes the installer identity in the parent-owned durable transaction", async () => {
    const installDir = tempDir()
    const dataDir = tempDir()
    const installPath = path.join(installDir, "memory-lane.exe")
    fs.writeFileSync(installPath, "original binary", "utf8")
    const manifestTransaction = snapshotInstallManifest(dataDir, process.pid)
    const lock = acquireUpgradeLock(installDir, process.pid)
    lock.manifestBackupPath = manifestTransaction.backupPath
    const fake = fakeChildProcess(7777, true)
    const installed = await runTransactionalWindowsInstaller(
      "install.ps1",
      installDir,
      manifestTransaction,
      lock,
      (pid) => pid === 7777
        ? { status: "found", startedAt: "777777777" }
        : { status: "missing" },
      { launch: (() => fake.child) as any },
    )
    assert.equal(installed, true)
    const transaction = JSON.parse(fs.readFileSync(`${installPath}.upgrade.${process.pid}`, "utf8"))
    assert.equal(transaction.ParentPid, String(process.pid))
    assert.equal(transaction.InstallerPid, "7777")
    assert.equal(transaction.InstallerStartedAt, "777777777")
    assert.equal(transaction.OriginalBinaryHash, createHash("sha256").update("original binary").digest("hex"))
    fs.rmSync(lock.path, { recursive: true, force: true })
    fs.rmSync(`${installPath}.upgrade.${process.pid}`, { force: true })
  })

  it("terminates a non-mutating installer when child identity inspection is unknown", async () => {
    const installDir = tempDir()
    const dataDir = tempDir()
    const manifestTransaction = snapshotInstallManifest(dataDir, process.pid)
    fs.writeFileSync(manifestTransaction.backupPath, "manifest backup", "utf8")
    const lock = acquireUpgradeLock(installDir, process.pid)
    lock.manifestBackupPath = manifestTransaction.backupPath
    const fake = fakeChildProcess(7777, false)
    const installed = await runTransactionalWindowsInstaller(
      "install.ps1",
      installDir,
      manifestTransaction,
      lock,
      () => ({ status: "unknown" }),
      { launch: (() => fake.child) as any },
    )
    assert.equal(installed, false)
    assert.equal(fake.wasKilled(), true)
    assert.equal(fs.existsSync(path.join(installDir, `memory-lane.exe.upgrade.${process.pid}`)), false)
    assert.equal(rollbackWindowsUpgrade(installDir, lock), true)
    assert.equal(fs.existsSync(manifestTransaction.backupPath), false)
    assert.equal(fs.existsSync(lock.path), false)
  })

  it("enforces the 10-second parent transaction publication deadline", async () => {
    const installDir = tempDir()
    const dataDir = tempDir()
    const manifestTransaction = snapshotInstallManifest(dataDir, process.pid)
    const lock = acquireUpgradeLock(installDir, process.pid)
    lock.manifestBackupPath = manifestTransaction.backupPath
    const fake = fakeChildProcess(7777, false)
    let clock = 0
    const installed = await runTransactionalWindowsInstaller(
      "install.ps1",
      installDir,
      manifestTransaction,
      lock,
      () => ({ status: "missing" }),
      {
        launch: (() => fake.child) as any,
        now: () => clock,
        delay: async (milliseconds) => {
          clock += milliseconds
        },
      },
    )
    assert.equal(installed, false)
    assert.equal(clock, 10_000)
    assert.equal(fake.wasKilled(), true)
    assert.equal(rollbackWindowsUpgrade(installDir, lock), true)
    assert.equal(fs.existsSync(lock.path), false)
  })


  it("publishes an immutable minimal lock owner and serializes active upgrades", () => {
    const installDir = tempDir()
    const lock = acquireUpgradeLock(installDir, process.pid)
    const owner = JSON.parse(fs.readFileSync(path.join(lock.path, "owner"), "utf8"))
    assert.deepEqual(Object.keys(owner).sort(), ["createdAt", "pid", "processStartedAt", "token"])
    assert.equal(owner.pid, process.pid)
    assert.match(owner.processStartedAt, /^\d+$/u)
    assert.equal(owner.token, lock.owner)
    assert.throws(() => acquireUpgradeLock(installDir, process.pid), /already in progress/u)
    releaseUpgradeLock(lock)
    assert.equal(fs.existsSync(lock.path), false)
  })

  for (const [field, value] of [
    ["pid", String(process.pid)],
    ["pid", 0],
    ["processStartedAt", "0"],
    ["createdAt", "1000000"],
  ] as const) {
    it(`rejects a lock owner with invalid ${field} value ${JSON.stringify(value)}`, () => {
      const installDir = tempDir()
      const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
      fs.mkdirSync(lockPath)
      fs.writeFileSync(path.join(lockPath, "owner"), JSON.stringify({
        token: "malformed-owner",
        pid: process.pid,
        processStartedAt: "111111111",
        createdAt: 1_000_000,
        [field]: value,
      }), "utf8")
      assert.throws(
        () => acquireUpgradeLock(installDir, process.pid, {
          inspectProcessStartTime: () => ({ status: "found", startedAt: "111111111" }),
        }),
        /owner metadata is not yet available/u,
      )
    })
  }

  it("rejects zero and unsafe installer identities in durable transactions", () => {
    for (const [field, value] of [
      ["InstallerPid", "0"],
      ["InstallerPid", String(Number.MAX_SAFE_INTEGER + 1)],
      ["InstallerStartedAt", "0"],
    ] as const) {
      const fixture = createStaleUpgradeTransaction()
      const transaction = JSON.parse(fs.readFileSync(fixture.transactionPath, "utf8"))
      transaction[field] = value
      fs.writeFileSync(fixture.transactionPath, JSON.stringify(transaction), "utf8")
      assert.throws(
        () => acquireUpgradeLock(fixture.installDir, process.pid, {
          inspectProcessStartTime: (pid) => pid === process.pid
            ? { status: "found", startedAt: "444444444" }
            : { status: "missing" },
        }),
        /failed state validation/u,
      )
    }
  })

  it("rejects a zero process start time for the acquiring process", () => {
    assert.throws(
      () => acquireUpgradeLock(tempDir(), process.pid, {
        inspectProcessStartTime: () => ({ status: "found", startedAt: "0" }),
      }),
      /Could not identify the running upgrade process/u,
    )
  })

  it("keeps an inactive owner during the 30-second transaction publication guard", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    fs.mkdirSync(lockPath)
    fs.writeFileSync(path.join(lockPath, "owner"), JSON.stringify({
      token: "waiting-owner",
      pid: 9876,
      processStartedAt: "111111111",
      createdAt: 1_000_000,
    }), "utf8")
    assert.throws(
      () => acquireUpgradeLock(installDir, process.pid, {
        now: () => 1_029_999,
        inspectProcessStartTime: (pid) => pid === process.pid
          ? { status: "found", startedAt: "444444444" }
          : { status: "missing" },
      }),
      /transaction publication is still in progress/u,
    )
    assert.equal(fs.existsSync(lockPath), true)
  })

  it("reclaims an inactive owner only after a stable double observation", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    fs.mkdirSync(lockPath)
    fs.writeFileSync(path.join(lockPath, "owner"), JSON.stringify({
      token: "stale-owner",
      pid: 9876,
      processStartedAt: "111111111",
      createdAt: 1_000_000,
    }), "utf8")
    let sleeps = 0
    const lock = acquireUpgradeLock(installDir, process.pid, {
      now: () => 1_030_000,
      createToken: () => "replacement-owner",
      sleep: (milliseconds) => {
        assert.equal(milliseconds, 100)
        sleeps += 1
      },
      inspectProcessStartTime: (pid) => pid === process.pid
        ? { status: "found", startedAt: "444444444" }
        : { status: "missing" },
    })
    assert.equal(sleeps, 1)
    assert.equal(lock.owner, "replacement-owner")
    assert.equal(fs.existsSync(path.join(lock.path, ".reclaim")), false)
    assert.equal(fs.existsSync(path.join(lock.path, "active-actor")), false)
    releaseUpgradeLock(lock)
  })

  it("aborts reclaim when the stable lock snapshot changes", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const ownerPath = path.join(lockPath, "owner")
    fs.mkdirSync(lockPath)
    fs.writeFileSync(ownerPath, JSON.stringify({
      token: "stale-owner",
      pid: 9876,
      processStartedAt: "111111111",
      createdAt: 1_000_000,
    }), "utf8")
    assert.throws(
      () => acquireUpgradeLock(installDir, process.pid, {
        now: () => 1_030_000,
        onReclaimClaimed: () => {
          fs.writeFileSync(ownerPath, JSON.stringify({
            token: "successor-owner",
            pid: 7654,
            processStartedAt: "222222222",
            createdAt: 1_030_000,
          }), "utf8")
        },
        sleep: () => {},
        inspectProcessStartTime: (pid) => pid === process.pid
          ? { status: "found", startedAt: "444444444" }
          : { status: "missing" },
      }),
      /state changed/u,
    )
    assert.equal(fs.existsSync(lockPath), true)
  })
  it("restores a successor lock captured during the quarantine race window", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const ownerPath = path.join(lockPath, "owner")
    fs.mkdirSync(lockPath)
    fs.writeFileSync(ownerPath, JSON.stringify({
      token: "stale-owner",
      pid: 9876,
      processStartedAt: "111111111",
      createdAt: 1_000_000,
    }), "utf8")
    assert.throws(
      () => acquireUpgradeLock(installDir, process.pid, {
        now: () => 1_030_000,
        onBeforeQuarantine: () => {
          fs.rmSync(lockPath, { recursive: true, force: true })
          fs.mkdirSync(lockPath)
          fs.writeFileSync(ownerPath, JSON.stringify({
            token: "successor-owner",
            pid: 7654,
            processStartedAt: "222222222",
            createdAt: 1_030_000,
          }), "utf8")
        },
        sleep: () => {},
        inspectProcessStartTime: (pid) => pid === process.pid
          ? { status: "found", startedAt: "444444444" }
          : { status: "missing" },
      }),
      /changed during quarantine and was restored/u,
    )
    assert.equal(JSON.parse(fs.readFileSync(ownerPath, "utf8")).token, "successor-owner")
  })


  it("uses one hour and residue checks for malformed owner metadata", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    fs.mkdirSync(lockPath)
    fs.writeFileSync(path.join(lockPath, "owner"), "{", "utf8")
    const modifiedAt = fs.statSync(lockPath).mtimeMs
    const inspect = (pid: number) => pid === process.pid
      ? { status: "found" as const, startedAt: "444444444" }
      : { status: "missing" as const }
    assert.throws(
      () => acquireUpgradeLock(installDir, process.pid, {
        now: () => modifiedAt + 3_599_999,
        inspectProcessStartTime: inspect,
      }),
      /owner metadata is not yet available/u,
    )
    fs.writeFileSync(path.join(installDir, "memory-lane.exe.backup.9876"), "residue", "utf8")
    assert.throws(
      () => acquireUpgradeLock(installDir, process.pid, {
        now: () => modifiedAt + 3_600_000,
        inspectProcessStartTime: inspect,
      }),
      /recovery residue remains/u,
    )
  })

  it("fails closed when process identity inspection is unknown", () => {
    const fixture = createStaleUpgradeTransaction()
    assert.throws(
      () => acquireUpgradeLock(fixture.installDir, process.pid, {
        inspectProcessStartTime: (pid) => pid === process.pid
          ? { status: "found", startedAt: "444444444" }
          : { status: "unknown" },
      }),
      /Cannot safely inspect.+PID 9876/u,
    )
    assert.equal(fs.existsSync(fixture.transactionPath), true)
    assert.equal(fs.existsSync(fixture.lockPath), true)
  })

  it("distinguishes PID reuse by process start time", () => {
    const installDir = tempDir()
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    fs.mkdirSync(lockPath)
    fs.writeFileSync(path.join(lockPath, "owner"), JSON.stringify({
      token: "stale-owner",
      pid: 9876,
      processStartedAt: "111111111",
      createdAt: 1_000_000,
    }), "utf8")
    const lock = acquireUpgradeLock(installDir, process.pid, {
      now: () => 1_030_000,
      createToken: () => "replacement-owner",
      sleep: () => {},
      inspectProcessStartTime: (pid) => pid === 9876
        ? { status: "found", startedAt: "999999999" }
        : { status: "found", startedAt: "444444444" },
    })
    assert.equal(lock.owner, "replacement-owner")
    releaseUpgradeLock(lock)
  })

  it("preserves a pending transaction while its installer remains active", () => {
    const fixture = createStaleUpgradeTransaction()
    assert.throws(
      () => acquireUpgradeLock(fixture.installDir, process.pid, {
        inspectProcessStartTime: (pid) => pid === process.pid
          ? { status: "found", startedAt: "444444444" }
          : pid === 8765
            ? { status: "found", startedAt: "222222222" }
            : { status: "missing" },
      }),
      /already in progress/u,
    )
    assert.equal(fs.existsSync(fixture.transactionPath), true)
  })
  it("preserves a legacy starting transaction during the recovery handoff grace", () => {
    const fixture = createStaleUpgradeTransaction("pending", true)
    const ownerPath = path.join(fixture.lockPath, "owner")
    const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"))
    owner.phase = "starting"
    owner.heartbeatAt = 2_000_000
    delete owner.recoveryPid
    delete owner.recoveryProcessStartedAt
    fs.writeFileSync(ownerPath, JSON.stringify(owner), "utf8")
    assert.throws(
      () => acquireUpgradeLock(fixture.installDir, process.pid, {
        now: () => 2_005_000,
        inspectProcessStartTime: (pid) => pid === process.pid
          ? { status: "found", startedAt: "555555555" }
          : { status: "missing" },
      }),
      /legacy recovery handoff is still in progress/u,
    )
    assert.equal(fs.existsSync(fixture.transactionPath), true)
    assert.equal(fs.readFileSync(fixture.installPath, "utf8"), "replacement binary")
  })


  it("reads legacy PR 210 owner and actor identities without writing legacy files", () => {
    const fixture = createStaleUpgradeTransaction("pending", true)
    fs.writeFileSync(path.join(fixture.lockPath, "active-actor"), JSON.stringify({
      token: "stale-owner",
      pid: 6543,
      processStartedAt: "444444444",
      action: "Recover",
    }), "utf8")
    assert.throws(
      () => acquireUpgradeLock(fixture.installDir, process.pid, {
        inspectProcessStartTime: (pid) => pid === process.pid
          ? { status: "found", startedAt: "555555555" }
          : pid === 6543
            ? { status: "found", startedAt: "444444444" }
            : { status: "missing" },
      }),
      /already in progress/u,
    )
    fs.rmSync(path.join(fixture.lockPath, "active-actor"))
    fs.writeFileSync(path.join(fixture.lockPath, ".reclaim"), JSON.stringify({
      token: "foreign-claimant",
      pid: 6432,
      processStartedAt: "333333333",
      createdAt: 1_500_000,
    }), "utf8")
    const lock = acquireUpgradeLock(fixture.installDir, process.pid, {
      createToken: () => "replacement-owner",
      sleep: () => {},
      inspectProcessStartTime: (pid) => pid === process.pid
        ? { status: "found", startedAt: "555555555" }
        : { status: "missing" },
    })
    assert.equal(fs.readFileSync(fixture.installPath, "utf8"), "original binary")
    assert.equal(fs.existsSync(path.join(lock.path, ".reclaim")), false)
    assert.equal(fs.existsSync(path.join(lock.path, "active-actor")), false)
    releaseUpgradeLock(lock)
  })

  it("does not release a lock while its manifest backup remains", () => {
    const installDir = tempDir()
    const manifestBackupPath = path.join(tempDir(), "install.json.upgrade.1234")
    fs.writeFileSync(manifestBackupPath, "manifest", "utf8")
    const lock = acquireUpgradeLock(installDir, process.pid)
    lock.manifestBackupPath = manifestBackupPath
    releaseUpgradeLock(lock)
    assert.equal(fs.existsSync(lock.path), true)
    fs.rmSync(manifestBackupPath)
    releaseUpgradeLock(lock)
    assert.equal(fs.existsSync(lock.path), false)
  })

  it("preserves a successor lock created after atomic removal claims the old lock", () => {
    const installDir = tempDir()
    const lock = acquireUpgradeLock(installDir, process.pid)
    const owner = JSON.parse(fs.readFileSync(path.join(lock.path, "owner"), "utf8"))
    removeMatchingUpgradeLock(lock.path, {
      token: owner.token,
      pid: owner.pid,
      processStartedAt: owner.processStartedAt,
      parentPid: owner.pid,
      parentProcessStartedAt: owner.processStartedAt,
    }, () => {
      fs.mkdirSync(lock.path)
      fs.writeFileSync(path.join(lock.path, "owner"), JSON.stringify({
        token: "successor-owner",
        pid: 9876,
        processStartedAt: "999999999",
        createdAt: 2_000_000,
      }), "utf8")
    })
    assert.equal(JSON.parse(fs.readFileSync(path.join(lock.path, "owner"), "utf8")).token, "successor-owner")
    assert.equal(
      fs.readdirSync(installDir).some((entry) => entry.includes(".remove.")),
      false,
    )
  })

  it("sweeps only stale lock-removal tombstones during acquisition", () => {
    const installDir = tempDir()
    const stalePath = path.join(installDir, ".memory-lane-upgrade.lock.remove.1.1000.stale")
    const freshPath = path.join(installDir, ".memory-lane-upgrade.lock.remove.1.3000.fresh")
    fs.mkdirSync(stalePath)
    fs.mkdirSync(freshPath)
    const lock = acquireUpgradeLock(installDir, process.pid, {
      now: () => 4_000,
      staleAfterMs: 2_000,
    })
    assert.equal(fs.existsSync(stalePath), false)
    assert.equal(fs.existsSync(freshPath), true)
    releaseUpgradeLock(lock)
  })

  it("preserves malformed transaction state without masking the primary error", () => {
    const installDir = tempDir()
    const lock = acquireUpgradeLock(installDir, process.pid)
    fs.writeFileSync(path.join(installDir, `memory-lane.exe.upgrade.${process.pid}`), "{", "utf8")
    const warnings: unknown[][] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      assert.doesNotThrow(() => releaseUpgradeLock(lock))
      assert.equal(fs.existsSync(lock.path), true)
      assert.match(String(warnings[0]?.[0]), /lock was preserved/u)
    } finally {
      console.warn = originalWarn
      fs.rmSync(lock.path, { recursive: true, force: true })
    }
  })


  it("cleans a committed transaction after the parent becomes inactive", async () => {
    const fixture = createStaleUpgradeTransaction("committed")
    await handleCommittedCleanup(committedCleanupArgs(fixture), () => ({ status: "missing" }))
    assert.equal(fs.existsSync(fixture.backupPath), false)
    assert.equal(fs.existsSync(fixture.manifestBackupPath), false)
    assert.equal(fs.existsSync(fixture.transactionPath), false)
    assert.equal(fs.existsSync(fixture.lockPath), false)
    await handleCommittedCleanup(committedCleanupArgs(fixture), () => ({ status: "missing" }))
  })

  for (const [argument, value] of [
    ["--parent-pid", "0"],
    ["--parent-started-at", "0"],
  ] as const) {
    it(`rejects committed cleanup with ${argument} ${value} before process inspection`, async () => {
      const fixture = createStaleUpgradeTransaction("committed")
      const args = committedCleanupArgs(fixture)
      args[args.indexOf(argument) + 1] = value
      let inspected = false
      await handleCommittedCleanup(args, () => {
        inspected = true
        return { status: "missing" }
      })
      assert.equal(inspected, false)
      assert.equal(fs.existsSync(fixture.transactionPath), true)
      assert.equal(fs.existsSync(fixture.lockPath), true)
    })
  }

  it("leaves committed residue when the 30-second helper deadline expires", async () => {
    const fixture = createStaleUpgradeTransaction("committed")
    let clock = 0
    await handleCommittedCleanup(
      committedCleanupArgs(fixture),
      () => ({ status: "found", startedAt: "111111111" }),
      () => clock,
      async (milliseconds) => {
        clock += milliseconds
      },
    )
    assert.equal(clock, WINDOWS_COMMITTED_CLEANUP_TIMEOUT_MS)
    assert.equal(fs.existsSync(fixture.transactionPath), true)
    assert.equal(fs.existsSync(fixture.lockPath), true)
  })

  it("leaves committed residue when helper process inspection is unknown", async () => {
    const fixture = createStaleUpgradeTransaction("committed")
    await handleCommittedCleanup(committedCleanupArgs(fixture), () => ({ status: "unknown" }))
    assert.equal(fs.existsSync(fixture.transactionPath), true)
    assert.equal(fs.existsSync(fixture.lockPath), true)
  })

  it("does not let a stale helper delete a successor owner's artifacts", async () => {
    const fixture = createStaleUpgradeTransaction("committed")
    fs.writeFileSync(path.join(fixture.lockPath, "owner"), JSON.stringify({
      token: "successor-owner",
      pid: 9876,
      processStartedAt: "999999999",
      createdAt: 2_000_000,
    }), "utf8")
    await handleCommittedCleanup(committedCleanupArgs(fixture), () => ({ status: "missing" }))
    assert.equal(fs.existsSync(fixture.transactionPath), true)
    assert.equal(fs.existsSync(fixture.lockPath), true)
  })

  it("keeps a committed upgrade successful when cleanup launch fails", () => {
    const fixture = createStaleUpgradeTransaction()
    const warnings: unknown[][] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      const committed = commitWindowsUpgrade(
        fixture.installDir,
        { path: fixture.lockPath, owner: "stale-owner" },
        (() => {
          throw new Error("launch failed")
        }) as any,
      )
      assert.equal(committed, true)
      assert.equal(JSON.parse(fs.readFileSync(fixture.transactionPath, "utf8")).State, "committed")
      assert.match(String(warnings[0]?.[0]), /launch failed/u)
    } finally {
      console.warn = originalWarn
    }
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
  it("recovers when backup rename completed before its checkpoint was persisted", () => {
    const fixture = createStaleUpgradeTransaction()
    const transaction = JSON.parse(fs.readFileSync(fixture.transactionPath, "utf8"))
    transaction.BackupState = "not-backed-up"
    fs.writeFileSync(fixture.transactionPath, JSON.stringify(transaction), "utf8")
    const lock = acquireUpgradeLock(fixture.installDir, process.pid, {
      createToken: () => "replacement-owner",
      inspectProcessStartTime: (pid) => pid === process.pid
        ? { status: "found", startedAt: "444444444" }
        : { status: "missing" },
    })
    assert.equal(fs.readFileSync(fixture.installPath, "utf8"), "original binary")
    assert.equal(fs.readFileSync(fixture.manifestPath, "utf8"), "original manifest")
    assert.equal(fs.existsSync(fixture.backupPath), false)
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

  for (const executableState of ["missing", "tampered"] as const) {
    it(`retains restored transaction artifacts when the executable is ${executableState}`, () => {
      const fixture = createStaleUpgradeTransaction("restored")
      if (executableState === "missing") fs.rmSync(fixture.installPath)
      else fs.writeFileSync(fixture.installPath, "tampered binary", "utf8")

      assert.throws(
        () => acquireUpgradeLock(fixture.installDir, process.pid, {
          createToken: () => "replacement-owner",
          inspectProcessStartTime: (processId) => processId === process.pid
            ? { status: "found", startedAt: "444444444" }
            : { status: "missing" },
        }),
        /restored executable cannot be verified/u,
      )
      assert.equal(fs.existsSync(fixture.transactionPath), true)
      assert.equal(fs.existsSync(fixture.backupPath), true)
      assert.equal(fs.existsSync(fixture.manifestBackupPath), true)
      assert.equal(fs.existsSync(fixture.lockPath), true)
      assert.equal(fs.existsSync(path.join(fixture.lockPath, ".reclaim")), false)
    })
  }

  for (const executableState of ["missing", "tampered"] as const) {
    it(`retains a pending not-backed-up transaction when the executable is ${executableState}`, () => {
      const fixture = createStaleUpgradeTransaction()
      const transaction = JSON.parse(fs.readFileSync(fixture.transactionPath, "utf8"))
      transaction.BackupState = "not-backed-up"
      fs.writeFileSync(fixture.transactionPath, JSON.stringify(transaction), "utf8")
      fs.rmSync(fixture.backupPath)
      if (executableState === "missing") fs.rmSync(fixture.installPath)
      else fs.writeFileSync(fixture.installPath, "tampered binary", "utf8")

      assert.throws(
        () => acquireUpgradeLock(fixture.installDir, process.pid, {
          createToken: () => "replacement-owner",
          inspectProcessStartTime: (processId) => processId === process.pid
            ? { status: "found", startedAt: "444444444" }
            : { status: "missing" },
        }),
        /backup is missing/u,
      )
      assert.equal(fs.existsSync(fixture.transactionPath), true)
      assert.equal(fs.existsSync(fixture.manifestBackupPath), true)
      assert.equal(fs.existsSync(fixture.lockPath), true)
    })
  }

  it("finishes a no-backup rollback after the executable was already removed", () => {
    const fixture = createStaleUpgradeTransaction()
    const transaction = JSON.parse(fs.readFileSync(fixture.transactionPath, "utf8"))
    transaction.BackupState = "no-backup"
    transaction.OriginalBinaryHash = ""
    fs.writeFileSync(fixture.transactionPath, JSON.stringify(transaction), "utf8")
    fs.rmSync(fixture.installPath)
    fs.rmSync(fixture.backupPath)

    const lock = acquireUpgradeLock(fixture.installDir, process.pid, {
      createToken: () => "replacement-owner",
      inspectProcessStartTime: (processId) => processId === process.pid
        ? { status: "found", startedAt: "444444444" }
        : { status: "missing" },
    })

    assert.equal(lock.owner, "replacement-owner")
    assert.equal(fs.existsSync(fixture.installPath), false)
    assert.equal(fs.readFileSync(fixture.manifestPath, "utf8"), "original manifest")
    assert.equal(fs.existsSync(fixture.transactionPath), false)
    assert.equal(fs.existsSync(fixture.manifestBackupPath), false)
    releaseUpgradeLock(lock)
  })

  for (const executableState of ["missing", "tampered"] as const) {
    it(`retains pending restored checkpoint artifacts when the executable is ${executableState}`, () => {
      const fixture = createStaleUpgradeTransaction()
      const transaction = JSON.parse(fs.readFileSync(fixture.transactionPath, "utf8"))
      transaction.BackupState = "restored"
      fs.writeFileSync(fixture.transactionPath, JSON.stringify(transaction), "utf8")
      if (executableState === "missing") fs.rmSync(fixture.installPath)
      else fs.writeFileSync(fixture.installPath, "tampered binary", "utf8")

      assert.throws(
        () => acquireUpgradeLock(fixture.installDir, process.pid, {
          createToken: () => "replacement-owner",
          inspectProcessStartTime: (processId) => processId === process.pid
            ? { status: "found", startedAt: "444444444" }
            : { status: "missing" },
        }),
        /restored executable cannot be verified/u,
      )
      assert.equal(fs.readFileSync(fixture.manifestPath, "utf8"), "replacement manifest")
      assert.equal(fs.existsSync(fixture.transactionPath), true)
      assert.equal(fs.existsSync(fixture.backupPath), true)
      assert.equal(fs.existsSync(fixture.manifestBackupPath), true)
      assert.equal(fs.existsSync(fixture.lockPath), true)

      fs.writeFileSync(fixture.installPath, "original binary", "utf8")
      const retry = acquireUpgradeLock(fixture.installDir, process.pid, {
        createToken: () => "retry-owner",
        inspectProcessStartTime: (processId) => processId === process.pid
          ? { status: "found", startedAt: "444444444" }
          : { status: "missing" },
      })
      assert.equal(fs.readFileSync(fixture.manifestPath, "utf8"), "original manifest")
      assert.equal(fs.existsSync(fixture.transactionPath), false)
      assert.equal(fs.existsSync(fixture.backupPath), false)
      assert.equal(fs.existsSync(fixture.manifestBackupPath), false)
      releaseUpgradeLock(retry)
    })
  }

  it("retains a pending no-original checkpoint when an executable is unexpectedly present", () => {
    const fixture = createStaleUpgradeTransaction()
    const transaction = JSON.parse(fs.readFileSync(fixture.transactionPath, "utf8"))
    transaction.BackupState = "no-original-restored"
    transaction.OriginalBinaryHash = ""
    fs.writeFileSync(fixture.transactionPath, JSON.stringify(transaction), "utf8")
    fs.rmSync(fixture.backupPath)

    assert.throws(
      () => acquireUpgradeLock(fixture.installDir, process.pid, {
        createToken: () => "replacement-owner",
        inspectProcessStartTime: (processId) => processId === process.pid
          ? { status: "found", startedAt: "444444444" }
          : { status: "missing" },
      }),
      /restored executable cannot be verified/u,
    )
    assert.equal(fs.readFileSync(fixture.manifestPath, "utf8"), "replacement manifest")
    assert.equal(fs.existsSync(fixture.transactionPath), true)
    assert.equal(fs.existsSync(fixture.manifestBackupPath), true)
    assert.equal(fs.existsSync(fixture.lockPath), true)

    fs.rmSync(fixture.installPath)
    const retry = acquireUpgradeLock(fixture.installDir, process.pid, {
      createToken: () => "retry-owner",
      inspectProcessStartTime: (processId) => processId === process.pid
        ? { status: "found", startedAt: "444444444" }
        : { status: "missing" },
    })
    assert.equal(fs.existsSync(fixture.installPath), false)
    assert.equal(fs.readFileSync(fixture.manifestPath, "utf8"), "original manifest")
    assert.equal(fs.existsSync(fixture.transactionPath), false)
    assert.equal(fs.existsSync(fixture.manifestBackupPath), false)
    releaseUpgradeLock(retry)
  })

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
      /cannot safely reconcile.+malformed/iu,
    )
    assert.equal(fs.existsSync(fixture.lockPath), true)
    assert.equal(fs.existsSync(path.join(fixture.lockPath, ".reclaim")), false)
    assert.equal(fs.existsSync(fixture.backupPath), true)
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
