#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import assert from "node:assert/strict"

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
    encoding: "utf8",
    stdio: "pipe",
  })
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(" ")}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"))
  }
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
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

async function waitUntil(predicate: () => boolean, description: string, timeoutMs: number = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function main(): Promise<void> {
  if (process.platform !== "win32") throw new Error("Windows self-maintenance smoke must run on Windows")

  const repo = process.cwd()
  const identityCheck = spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    [
      "$tokens = $null",
      "$errors = $null",
      "$ast = [Management.Automation.Language.Parser]::ParseFile($env:MEMORY_LANE_INSTALLER_PATH, [ref]$tokens, [ref]$errors)",
      "$functions = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and @('Get-Process-Start-Time-Ticks', 'Test-Upgrade-Process-Identity', 'Update-Upgrade-Lock-Lease') -contains $node.Name }, $true)",
      "$definitions = $functions | ForEach-Object { $_.Extent.Text }",
      "Invoke-Expression ($definitions -join [Environment]::NewLine)",
      "$startedAt = Get-Process-Start-Time-Ticks $PID",
      "if (-not (Test-Upgrade-Process-Identity $PID $startedAt)) { throw 'matching process identity was rejected' }",
      "$reusedStartedAt = ([Int64]$startedAt + 1).ToString()",
      "if (Test-Upgrade-Process-Identity $PID $reusedStartedAt) { throw 'reused process identity was accepted' }",
      "$leaseRoot = Join-Path ([IO.Path]::GetTempPath()) ('memory-lane-lease-' + [Guid]::NewGuid().ToString('N'))",
      "New-Item -ItemType Directory -Path $leaseRoot | Out-Null",
      "$lockOwner = [PSCustomObject]@{ pid = 1; processStartedAt = '1'; token = 'lease-owner'; createdAt = 1; heartbeatAt = 1; phase = 'starting' }",
      "[IO.File]::WriteAllText((Join-Path $leaseRoot 'owner'), ($lockOwner | ConvertTo-Json -Compress))",
      "$script:transaction = [PSCustomObject]@{ LockPath = $leaseRoot; LockOwner = 'lease-owner' }",
      "function Read-Upgrade-Transaction { return $script:transaction }",
      "$script:ownerReadAttempts = 0",
      "function Get-Content { param([string]$LiteralPath, [switch]$Raw); $script:ownerReadAttempts++; if ($script:ownerReadAttempts -lt 3) { throw 'transient owner read failure' }; return [IO.File]::ReadAllText($LiteralPath) }",
      "try { if (-not (Update-Upgrade-Lock-Lease)) { throw 'transient lease refresh was treated as lease loss' }; if ($script:ownerReadAttempts -ne 3) { throw 'lease refresh did not retry transient reads' }; $updatedOwner = [IO.File]::ReadAllText((Join-Path $leaseRoot 'owner')) | ConvertFrom-Json; if ($updatedOwner.processStartedAt -ne $startedAt) { throw 'recovery owner omitted stable process identity' } } finally { Remove-Item -LiteralPath $leaseRoot -Recurse -Force }",
    ].join("; "),
  ], {
    cwd: repo,
    env: { ...process.env, MEMORY_LANE_INSTALLER_PATH: path.join(repo, "install.ps1") },
    encoding: "utf8",
  })
  assert.equal(identityCheck.status, 0, `${identityCheck.stdout}\n${identityCheck.stderr}`)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-[paths]-"))
  const home = path.join(root, "home")
  const installDir = path.join(home, "bin")
  const installPath = path.join(installDir, "memory-lane.exe")
  const dataDir = path.join(home, ".memory-lane")
  const claudeConfigPath = path.join(home, ".claude", "settings.json")
  const replacementPath = path.join(root, "replacement", "memory-lane.exe")
  const invalidReplacementPath = path.join(root, "replacement", "invalid-memory-lane.exe")
  const holderSource = path.join(root, "running-holder.ts")
  const failingReplacementSource = path.join(root, "failing-replacement.ts")
  fs.mkdirSync(path.dirname(replacementPath), { recursive: true })
  fs.mkdirSync(installDir, { recursive: true })
  fs.writeFileSync(holderSource, "if (process.argv.includes(\"--identity\")) { console.log(\"old binary\"); process.exit(0) }\nsetInterval(() => {}, 1_000)\n", "utf8")
  fs.writeFileSync(failingReplacementSource, "if (process.argv.includes(\"--smoke-test\")) process.exit(7)\nsetInterval(() => {}, 1_000)\n", "utf8")

  let runningOldBinary: ChildProcess | undefined
  try {
    run("bun", ["build", "--compile", "--target", "bun-windows-x64", holderSource, "--outfile", installPath], { cwd: repo })
    run("bun", [
      "build",
      "--compile",
      "--target",
      "bun-windows-x64",
      failingReplacementSource,
      "--outfile",
      invalidReplacementPath,
    ], { cwd: repo })
    run("bun", [
      "build",
      "--compile",
      "--target",
      "bun-windows-x64",
      "packages/cli/src/index.ts",
      "--outfile",
      replacementPath,
      "--define",
      "process.env.MEMORY_LANE_VERSION=\"0.0.0-windows-smoke\"",
    ], { cwd: repo })

    runningOldBinary = spawn(installPath, [], { stdio: "ignore" })
    await new Promise<void>((resolve, reject) => {
      runningOldBinary?.once("spawn", resolve)
      runningOldBinary?.once("error", reject)
    })
    assert.ok(runningOldBinary.pid, "running fixture must expose its process id")

    const manifestPath = path.join(dataDir, "install.json")
    const manifestBackupPath = `${manifestPath}.upgrade.${runningOldBinary.pid}`
    const installerEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      INSTALL_DIR: installDir,
      MEMORY_LANE_INSTALL_BINARY: replacementPath,
      MEMORY_LANE_UPGRADE_PID: String(runningOldBinary.pid),
      MEMORY_LANE_UPGRADE_MANIFEST_PATH: manifestPath,
      MEMORY_LANE_UPGRADE_MANIFEST_BACKUP_PATH: manifestBackupPath,
      MEMORY_LANE_UPGRADE_MANIFEST_EXISTED: "false",
    }
    const installerArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repo, "install.ps1")]
    const backupPath = `${installPath}.backup.${runningOldBinary.pid}`
    const transactionPath = `${installPath}.upgrade.${runningOldBinary.pid}`

    fs.mkdirSync(transactionPath)
    fs.writeFileSync(path.join(transactionPath, "cleanup-blocker"), "block marker cleanup", "utf8")
    const failedMarkerWrite = spawnSync("powershell.exe", installerArgs, {
      cwd: repo,
      env: installerEnv,
      encoding: "utf8",
    })
    assert.notEqual(failedMarkerWrite.status, 0, "transaction marker write failure must fail installation")
    assert.equal(fs.existsSync(installPath), true, "marker cleanup failure must preserve the restored executable path")
    assert.equal(fs.existsSync(backupPath), false, "marker write failure must not strand a backup")
    assert.equal(fs.existsSync(transactionPath), true, "blocked marker cleanup must remain best effort")
    const blockedMarkerRetry = spawnSync("powershell.exe", [...installerArgs, "-UpgradeAction", "Rollback"], {
      cwd: repo,
      env: installerEnv,
      encoding: "utf8",
    })
    assert.notEqual(blockedMarkerRetry.status, 0, "unreadable transaction residue must not report a known rollback")
    assert.equal(fs.existsSync(installPath), true, "cross-process rollback retry must preserve the restored executable")
    const restoredAfterCleanupFailure = spawnSync(installPath, ["--identity"], { encoding: "utf8" })
    assert.equal(restoredAfterCleanupFailure.status, 0, restoredAfterCleanupFailure.stderr)
    assert.match(restoredAfterCleanupFailure.stdout, /old binary/u)
    fs.rmSync(transactionPath, { recursive: true, force: true })

    const failedInstall = spawnSync("powershell.exe", installerArgs, {
      cwd: repo,
      env: { ...installerEnv, MEMORY_LANE_INSTALL_BINARY: invalidReplacementPath },
      encoding: "utf8",
    })
    assert.notEqual(failedInstall.status, 0, "invalid replacement must fail its smoke test")
    assert.equal(runningOldBinary.exitCode, null, "failed replacement must leave the old process running")
    assert.equal(fs.existsSync(installPath), true, "failed replacement must restore the original executable path")
    assert.equal(
      fs.readdirSync(installDir).some((name) => name.startsWith("memory-lane.exe.backup.")),
      false,
      "failed replacement must not strand a backup",
    )
    assert.equal(
      fs.readdirSync(installDir).some((name) => name.startsWith("memory-lane.exe.upgrade.")),
      false,
      "failed replacement must not strand a transaction",
    )

    fs.mkdirSync(path.dirname(claudeConfigPath), { recursive: true })
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(claudeConfigPath, "{bad json", "utf8")
    const originalManifest = JSON.stringify({
      version: "0.0.0-old",
      installedAt: new Date().toISOString(),
      binaryPath: installPath,
      dataDir,
      integrations: [{ harness: "claude-code-cli", configPath: claudeConfigPath }],
    }, null, 2)
    fs.writeFileSync(manifestPath, originalManifest, "utf8")
    fs.copyFileSync(manifestPath, manifestBackupPath)
    installerEnv.MEMORY_LANE_UPGRADE_MANIFEST_EXISTED = "true"

    run("powershell.exe", installerArgs, {
      cwd: repo,
      env: installerEnv,
    })
    assert.equal(fs.existsSync(backupPath), true, "installer must retain the backup until post-install work succeeds")
    assert.equal(fs.existsSync(transactionPath), true, "installer must retain the transaction until post-install work succeeds")

    const smoke = spawnSync(installPath, ["--smoke-test"], { encoding: "utf8" })
    assert.equal(smoke.status, 0, smoke.stderr)
    assert.match(smoke.stdout, /memory-lane ok/u)
    assert.equal(runningOldBinary.exitCode, null, "old executable must still be running when replacement succeeds")
    const failedReapply = spawnSync(installPath, ["upgrade", "--reapply-install-manifest", "--yes"], {
      env: installerEnv,
      encoding: "utf8",
    })
    assert.notEqual(failedReapply.status, 0, "failed post-install reapply must return non-zero")
    assert.match(failedReapply.stdout, /Failed to reapply 1 required harness configuration/u)

    run("powershell.exe", [...installerArgs, "-UpgradeAction", "Rollback"], {
      cwd: repo,
      env: installerEnv,
    })
    assert.equal(fs.existsSync(backupPath), false, "post-install failure rollback must consume the backup")
    assert.equal(fs.existsSync(transactionPath), false, "post-install failure rollback must close the transaction")
    assert.equal(fs.readFileSync(manifestPath, "utf8"), originalManifest, "rollback must restore the original manifest")
    const restored = spawnSync(installPath, ["--identity"], { encoding: "utf8" })
    assert.equal(restored.status, 0, restored.stderr)
    assert.match(restored.stdout, /old binary/u)
    assert.equal(runningOldBinary.exitCode, null, "post-install rollback must leave the old process running")

    fs.writeFileSync(claudeConfigPath, "{}", "utf8")
    fs.copyFileSync(manifestPath, manifestBackupPath)
    run("powershell.exe", installerArgs, {
      cwd: repo,
      env: installerEnv,
    })
    assert.equal(fs.existsSync(backupPath), true, "successful replacement must remain rollbackable before commit")
    const successfulReapply = spawnSync(installPath, ["upgrade", "--reapply-install-manifest", "--yes"], {
      env: installerEnv,
      encoding: "utf8",
    })
    assert.equal(successfulReapply.status, 0, successfulReapply.stdout)
    assert.match(successfulReapply.stdout, /Reapplied 1 harness configuration/u)
    run("powershell.exe", [...installerArgs, "-UpgradeAction", "Commit"], {
      cwd: repo,
      env: installerEnv,
    })
    assert.equal(fs.existsSync(backupPath), true, "committed backup must remain while the parent is running")
    assert.equal(fs.existsSync(transactionPath), true, "committed transaction must remain recoverable until parent exit")

    const exitedUpgradePid = runningOldBinary.pid!
    const oldBinaryExit = waitForExit(runningOldBinary)
    runningOldBinary.kill()
    await oldBinaryExit
    runningOldBinary = undefined
    await waitUntil(
      () => !fs.readdirSync(installDir).some((name) => name.startsWith("memory-lane.exe.backup.")),
      "upgrade backup cleanup",
    )
    await waitUntil(() => !fs.existsSync(transactionPath), "committed transaction cleanup")
    await waitUntil(() => !fs.existsSync(manifestBackupPath), "manifest snapshot cleanup")

    const ownerRaceLockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    const staleOwner = "finished-upgrade-owner"
    const replacementOwner = "later-upgrade-owner"
    fs.mkdirSync(ownerRaceLockPath)
    fs.writeFileSync(
      path.join(ownerRaceLockPath, "owner"),
      JSON.stringify({ pid: process.pid, token: replacementOwner }),
      "utf8",
    )
    fs.writeFileSync(transactionPath, JSON.stringify({
      State: "committed",
      BackupState: "no-backup",
      ManifestState: "restored",
      ManifestPath: manifestPath,
      ManifestBackupPath: manifestBackupPath,
      LockPath: ownerRaceLockPath,
      LockOwner: staleOwner,
      ParentPid: exitedUpgradePid,
      ParentStartedAt: "1",
      InstallerPid: exitedUpgradePid,
      InstallerStartedAt: "1",
    }), "utf8")
    const staleRecovery = spawnSync("powershell.exe", [...installerArgs, "-UpgradeAction", "Recover"], {
      cwd: repo,
      env: {
        ...installerEnv,
        MEMORY_LANE_UPGRADE_PID: String(exitedUpgradePid),
        MEMORY_LANE_UPGRADE_LOCK_PATH: ownerRaceLockPath,
        MEMORY_LANE_UPGRADE_LOCK_OWNER: staleOwner,
      },
      encoding: "utf8",
    })
    assert.equal(staleRecovery.status, 0, staleRecovery.stderr)
    assert.equal(fs.existsSync(transactionPath), false, "stale recovery must clean its transaction")
    assert.equal(fs.existsSync(ownerRaceLockPath), true, "stale recovery must preserve a later upgrade lock")
    fs.rmSync(ownerRaceLockPath, { recursive: true, force: true })

    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, "memory.jsonl"), "{\"text\":\"preserve me\"}\n", "utf8")
    fs.writeFileSync(path.join(dataDir, "install.json"), JSON.stringify({
      version: "0.0.0-windows-smoke",
      installedAt: new Date().toISOString(),
      binaryPath: installPath,
      dataDir,
      integrations: [],
    }, null, 2), "utf8")

    const uninstall = spawn(installPath, ["uninstall", "--yes"], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const uninstallResult = await waitForExit(uninstall)
    assert.equal(uninstallResult.code, 0, `${uninstallResult.stdout}\n${uninstallResult.stderr}`)
    assert.match(uninstallResult.stdout, /Scheduled binary removal after exit/u)
    await waitUntil(() => !fs.existsSync(installPath), "installed binary removal")
    await waitUntil(
      () => !fs.readdirSync(installDir).some((name) => name.includes(".uninstall.")),
      "uninstall tombstone cleanup",
    )
    assert.equal(fs.existsSync(path.join(dataDir, "install.json")), false)
    assert.equal(fs.existsSync(path.join(dataDir, "memory.jsonl")), true)

    console.log("Windows self-maintenance smoke passed")
  } finally {
    if (runningOldBinary?.exitCode === null) runningOldBinary.kill()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
