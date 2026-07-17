#!/usr/bin/env node
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  acquireUpgradeLock,
  commitWindowsUpgrade,
  runTransactionalWindowsInstaller,
  snapshotInstallManifest,
  releaseUpgradeLock,
  WINDOWS_COMMITTED_CLEANUP_TIMEOUT_MS,
  WINDOWS_INSTALLER_HANDSHAKE_TIMEOUT_MS,
} from "../packages/cli/src/commands/windows-upgrade.js"

interface ProcessResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): void {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: "inherit",
  })
  if (result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(" ")}`)
}

function waitForExit(child: ChildProcess): Promise<ProcessResult> {
  let stdout = ""
  let stderr = ""
  child.stdout?.setEncoding("utf8")
  child.stderr?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => { stdout += chunk })
  child.stderr?.on("data", (chunk: string) => { stderr += chunk })
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

async function waitUntil(predicate: () => boolean, description: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

function processStartedAt(pid: number): string {
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Console]::Out.Write((Get-Process -Id ([int]$env:TEST_PID) -ErrorAction Stop).StartTime.ToUniversalTime().Ticks)",
  ], {
    env: { ...process.env, TEST_PID: String(pid) },
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^\d+$/u)
  return result.stdout
}

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
}

function writeAtomic(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`
  fs.writeFileSync(temporaryPath, JSON.stringify(value), { encoding: "utf8", flag: "wx" })
  fs.renameSync(temporaryPath, filePath)
}

function publishOwner(
  lockPath: string,
  pid: number,
  startedAt: string,
  token: string,
  overrides: Record<string, unknown> = {},
): void {
  fs.rmSync(lockPath, { recursive: true, force: true })
  fs.mkdirSync(lockPath)
  writeAtomic(path.join(lockPath, "owner"), {
    token,
    pid,
    processStartedAt: startedAt,
    createdAt: Date.now(),
    ...overrides,
  })
}

async function runCoordinatedInstaller(options: {
  installerPath: string
  installDir: string
  replacementPath: string
  parentPid: number
  parentStartedAt: string
  manifestPath: string
  manifestExisted: boolean
  ownerToken: string
  publishTransaction: boolean
  ownerOverrides?: Record<string, unknown>
  transactionOverrides?: Record<string, unknown>
}): Promise<ProcessResult> {
  const installPath = path.join(options.installDir, "memory-lane.exe")
  const lockPath = path.join(options.installDir, ".memory-lane-upgrade.lock")
  const transactionPath = `${installPath}.upgrade.${options.parentPid}`
  const manifestBackupPath = `${options.manifestPath}.upgrade.${options.parentPid}`
  publishOwner(lockPath, options.parentPid, options.parentStartedAt, options.ownerToken, options.ownerOverrides)
  if (options.manifestExisted) fs.copyFileSync(options.manifestPath, manifestBackupPath)
  else fs.rmSync(manifestBackupPath, { force: true })
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    INSTALL_DIR: options.installDir,
    MEMORY_LANE_INSTALL_BINARY: options.replacementPath,
    MEMORY_LANE_UPGRADE_PID: String(options.parentPid),
    MEMORY_LANE_UPGRADE_MANIFEST_PATH: options.manifestPath,
    MEMORY_LANE_UPGRADE_MANIFEST_BACKUP_PATH: manifestBackupPath,
    MEMORY_LANE_UPGRADE_MANIFEST_EXISTED: String(options.manifestExisted),
    MEMORY_LANE_UPGRADE_LOCK_PATH: lockPath,
    MEMORY_LANE_UPGRADE_LOCK_OWNER: options.ownerToken,
  }
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    options.installerPath,
  ], { env, stdio: ["ignore", "pipe", "pipe"] })
  assert.ok(child.pid, "PowerShell installer must expose its PID")
  const exit = waitForExit(child)
  if (options.publishTransaction) {
    const installerStartedAt = processStartedAt(child.pid)
    writeAtomic(transactionPath, {
      State: "pending",
      BackupState: fs.existsSync(installPath) ? "not-backed-up" : "no-backup",
      ManifestState: options.manifestExisted ? "existing" : "missing",
      ManifestPath: options.manifestPath,
      ManifestBackupPath: manifestBackupPath,
      LockPath: lockPath,
      LockOwner: options.ownerToken,
      ParentPid: String(options.parentPid),
      ParentStartedAt: options.parentStartedAt,
      InstallerPid: String(child.pid),
      InstallerStartedAt: installerStartedAt,
      OriginalBinaryHash: fs.existsSync(installPath) ? sha256(installPath) : "",
      ...options.transactionOverrides,
    })
  }
  return await exit
}

async function main(): Promise<void> {
  if (process.platform !== "win32") throw new Error("Windows self-maintenance smoke must run on Windows")
  const repo = process.cwd()
  const installerPath = path.join(repo, "install.ps1")
  const syntax = spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$tokens=$null; $errors=$null; [Management.Automation.Language.Parser]::ParseFile($env:INSTALLER,[ref]$tokens,[ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }",
  ], { env: { ...process.env, INSTALLER: installerPath }, encoding: "utf8" })
  assert.equal(syntax.status, 0, `${syntax.stdout}\n${syntax.stderr}`)

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-windows-smoke-"))
  const home = path.join(root, "home")
  const installDir = path.join(home, "bin")
  const installPath = path.join(installDir, "memory-lane.exe")
  const dataDir = path.join(home, ".memory-lane")
  const manifestPath = path.join(dataDir, "install.json")
  const replacementPath = path.join(root, "replacement", "memory-lane.exe")
  const invalidReplacementPath = path.join(root, "replacement", "invalid-memory-lane.exe")
  const oldSource = path.join(root, "old.ts")
  const invalidSource = path.join(root, "invalid.ts")
  fs.mkdirSync(installDir, { recursive: true })
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(path.dirname(replacementPath), { recursive: true })
  fs.writeFileSync(oldSource, [
    "if (process.argv.includes('--smoke-test')) process.exit(0)",
    "if (process.argv.includes('--identity')) { console.log('old binary'); process.exit(0) }",
    "setInterval(() => {}, 1_000)",
  ].join("\n"), "utf8")
  fs.writeFileSync(invalidSource, "if (process.argv.includes('--smoke-test')) process.exit(7)\n", "utf8")

  let runningOldBinary: ChildProcess | undefined
  try {
    run("bun", ["build", "--compile", "--target", "bun-windows-x64", oldSource, "--outfile", installPath], { cwd: repo })
    run("bun", ["build", "--compile", "--target", "bun-windows-x64", invalidSource, "--outfile", invalidReplacementPath], { cwd: repo })
    run("bun", [
      "build", "--compile", "--target", "bun-windows-x64", "packages/cli/src/index.ts",
      "--outfile", replacementPath,
      "--define", "process.env.MEMORY_LANE_VERSION=\"0.0.0-windows-smoke\"",
    ], { cwd: repo })

    runningOldBinary = spawn(installPath, [], { stdio: "ignore" })
    await new Promise<void>((resolve, reject) => {
      runningOldBinary?.once("spawn", resolve)
      runningOldBinary?.once("error", reject)
    })
    assert.ok(runningOldBinary.pid)
    const oldPid = runningOldBinary.pid
    const oldStartedAt = processStartedAt(oldPid)
    const originalHash = sha256(installPath)

    const noTransactionStartedAt = Date.now()
    const noTransaction = await runCoordinatedInstaller({
      installerPath,
      installDir,
      replacementPath,
      parentPid: oldPid,
      parentStartedAt: oldStartedAt,
      manifestPath,
      manifestExisted: false,
      ownerToken: "no-transaction-owner",
      publishTransaction: false,
    })
    assert.equal(noTransaction.signal, null, "missing-transaction rejection must exit normally")
    assert.notEqual(noTransaction.code, 0, "installer must reject a missing parent transaction")
    assert.ok(Date.now() - noTransactionStartedAt >= WINDOWS_INSTALLER_HANDSHAKE_TIMEOUT_MS)
    assert.equal(sha256(installPath), originalHash, "startup handshake failure must not mutate the old executable")
    fs.rmSync(path.join(installDir, ".memory-lane-upgrade.lock"), { recursive: true, force: true })

    const assertPreMutationRejection = async (
      ownerToken: string,
      overrides: {
        owner?: Record<string, unknown>
        transaction?: Record<string, unknown>
        prepare?: (backupPath: string) => void
        verify?: (backupPath: string) => void
      },
    ): Promise<void> => {
      const backupPath = `${installPath}.backup.${oldPid}`
      const transactionPath = `${installPath}.upgrade.${oldPid}`
      const manifestBackupPath = `${manifestPath}.upgrade.${oldPid}`
      overrides.prepare?.(backupPath)
      const result = await runCoordinatedInstaller({
        installerPath,
        installDir,
        replacementPath,
        parentPid: oldPid,
        parentStartedAt: oldStartedAt,
        manifestPath,
        manifestExisted: false,
        ownerToken,
        publishTransaction: true,
        ownerOverrides: overrides.owner,
        transactionOverrides: overrides.transaction,
      })
      assert.equal(result.signal, null, `${ownerToken} rejection must exit normally`)
      assert.notEqual(result.code, 0, `${ownerToken} must be rejected`)
      assert.equal(sha256(installPath), originalHash, `${ownerToken} must not mutate the existing executable`)
      overrides.verify?.(backupPath)
      fs.rmSync(path.join(installDir, ".memory-lane-upgrade.lock"), { recursive: true, force: true })
      fs.rmSync(backupPath, { force: true })
      fs.rmSync(transactionPath, { force: true })
      fs.rmSync(manifestBackupPath, { force: true })
    }
    await assertPreMutationRejection("string-owner-pid", {
      owner: { pid: String(oldPid) },
    })
    await assertPreMutationRejection("wrong-original-hash", {
      transaction: { OriginalBinaryHash: "0".repeat(64) },
    })
    await assertPreMutationRejection("existing-backup-destination", {
      prepare: (backupPath) => fs.writeFileSync(backupPath, "unrelated backup", "utf8"),
      verify: (backupPath) => assert.equal(fs.readFileSync(backupPath, "utf8"), "unrelated backup"),
    })
    await assertPreMutationRejection("unexpected-no-backup-executable", {
      transaction: { BackupState: "no-backup", OriginalBinaryHash: "" },
    })

    const ownerToken = "successful-owner"
    const upgradeLock = acquireUpgradeLock(installDir, oldPid, { createToken: () => ownerToken })
    const manifestTransaction = snapshotInstallManifest(dataDir, oldPid)
    upgradeLock.manifestBackupPath = manifestTransaction.backupPath
    const previousLocalBinary = process.env.MEMORY_LANE_INSTALL_BINARY
    process.env.MEMORY_LANE_INSTALL_BINARY = replacementPath
    let installed: boolean
    try {
      installed = await runTransactionalWindowsInstaller(
        installerPath,
        installDir,
        manifestTransaction,
        upgradeLock,
      )
    } finally {
      if (previousLocalBinary === undefined) delete process.env.MEMORY_LANE_INSTALL_BINARY
      else process.env.MEMORY_LANE_INSTALL_BINARY = previousLocalBinary
    }
    assert.equal(installed, true)
    assert.equal(runningOldBinary.exitCode, null, "old executable must remain running through replacement verification")
    assert.equal(spawnSync(installPath, ["--smoke-test"]).status, 0)
    const backupPath = `${installPath}.backup.${oldPid}`
    const transactionPath = `${installPath}.upgrade.${oldPid}`
    const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    assert.equal(fs.existsSync(backupPath), true)
    assert.equal(fs.existsSync(path.join(lockPath, ".reclaim")), false)
    assert.equal(fs.existsSync(path.join(lockPath, "active-actor")), false)
    assert.equal(commitWindowsUpgrade(installDir, upgradeLock), true)

    await new Promise((resolve) => setTimeout(resolve, WINDOWS_COMMITTED_CLEANUP_TIMEOUT_MS + 1_000))
    assert.equal(fs.existsSync(transactionPath), true, "helper deadline must preserve committed residue while parent remains active")
    runningOldBinary.kill()
    await waitForExit(runningOldBinary)
    runningOldBinary = undefined
    const replacementLock = acquireUpgradeLock(installDir, process.pid)
    assert.equal(fs.existsSync(transactionPath), false, "next upgrade must reconcile committed residue")
    assert.equal(fs.existsSync(backupPath), false)
    releaseUpgradeLock(replacementLock)

    fs.writeFileSync(manifestPath, "original manifest", "utf8")
    const beforeFailedHash = sha256(installPath)
    const failedOwner = "failed-owner"
    const failed = await runCoordinatedInstaller({
      installerPath,
      installDir,
      replacementPath: invalidReplacementPath,
      parentPid: process.pid,
      parentStartedAt: processStartedAt(process.pid),
      manifestPath,
      manifestExisted: true,
      ownerToken: failedOwner,
      publishTransaction: true,
    })
    assert.equal(failed.signal, null, "installer rollback failure must exit normally")
    assert.notEqual(failed.code, 0, "failed smoke test must fail installation")
    assert.equal(sha256(installPath), beforeFailedHash, "installer-local rollback must restore the exact executable")
    assert.equal(fs.readFileSync(manifestPath, "utf8"), "original manifest")
    assert.equal(fs.existsSync(path.join(installDir, ".memory-lane-upgrade.lock")), false)

    const recoveryParentPid = 9876
    const recoveryInstallerPid = 8765
    const recoveryLockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const recoveryBackupPath = `${installPath}.backup.${recoveryParentPid}`
    const recoveryTransactionPath = `${installPath}.upgrade.${recoveryParentPid}`
    const recoveryManifestBackupPath = `${manifestPath}.upgrade.${recoveryParentPid}`
    const recoverableBinary = fs.readFileSync(installPath)
    fs.writeFileSync(recoveryBackupPath, recoverableBinary)
    fs.writeFileSync(installPath, "interrupted replacement", "utf8")
    fs.copyFileSync(manifestPath, recoveryManifestBackupPath)
    fs.writeFileSync(manifestPath, "interrupted manifest", "utf8")
    publishOwner(recoveryLockPath, recoveryParentPid, "111111111", "recovery-owner")
    writeAtomic(recoveryTransactionPath, {
      State: "pending",
      BackupState: "backed-up",
      ManifestState: "existing",
      ManifestPath: manifestPath,
      ManifestBackupPath: recoveryManifestBackupPath,
      LockPath: recoveryLockPath,
      LockOwner: "recovery-owner",
      ParentPid: String(recoveryParentPid),
      ParentStartedAt: "111111111",
      InstallerPid: String(recoveryInstallerPid),
      InstallerStartedAt: "222222222",
      OriginalBinaryHash: createHash("sha256").update(recoverableBinary).digest("hex"),
    })
    const recoveredLock = acquireUpgradeLock(installDir, process.pid)
    assert.equal(sha256(installPath), createHash("sha256").update(recoverableBinary).digest("hex"))
    assert.equal(fs.readFileSync(manifestPath, "utf8"), "original manifest")
    assert.equal(fs.existsSync(recoveryTransactionPath), false)
    releaseUpgradeLock(recoveredLock)

    const standaloneDir = path.join(root, "standalone")
    run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installerPath], {
      cwd: repo,
      env: {
        ...process.env,
        INSTALL_DIR: standaloneDir,
        MEMORY_LANE_INSTALL_BINARY: replacementPath,
        MEMORY_LANE_UPGRADE_PID: undefined,
      },
    })
    assert.equal(spawnSync(path.join(standaloneDir, "memory-lane.exe"), ["--smoke-test"]).status, 0)
    console.log("Windows self-maintenance smoke passed")
  } finally {
    if (runningOldBinary && runningOldBinary.exitCode === null && runningOldBinary.signalCode === null) {
      const exited = waitForExit(runningOldBinary)
      runningOldBinary.kill()
      await exited
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
