#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
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
      "$functions = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and @('Get-Process-Start-Time-Ticks', 'Test-Upgrade-Process-Identity', 'Read-Upgrade-Transaction', 'Read-Upgrade-Transaction-After-Actor', 'Release-Upgrade-Actor', 'Write-Upgrade-Lock-Owner', 'Acquire-Upgrade-Lock-Owner-Gate', 'Release-Upgrade-Lock-Owner-Gate', 'Update-Upgrade-Lock-Lease', 'Wait-For-Upgrade-Process', 'Wait-For-Upgrade-Recovery-Lease') -contains $node.Name }, $true)",
      "$definitions = $functions | ForEach-Object { $_.Extent.Text }",
      "Invoke-Expression ($definitions -join [Environment]::NewLine)",
      "$startedAt = Get-Process-Start-Time-Ticks $PID",
      "if ((Test-Upgrade-Process-Identity $PID $startedAt) -ne 'active') { throw 'matching process identity was rejected' }",
      "$reusedStartedAt = ([Int64]$startedAt + 1).ToString()",
      "if ((Test-Upgrade-Process-Identity $PID $reusedStartedAt) -ne 'inactive') { throw 'reused process identity was accepted' }",
      "$interleaveRoot = Join-Path ([IO.Path]::GetTempPath()) ('memory-lane-interleave-' + [Guid]::NewGuid().ToString('N'))",
      "New-Item -ItemType Directory -Path $interleaveRoot | Out-Null",
      "$script:transactionPath = Join-Path $interleaveRoot 'transaction'",
      "$interleavedTransaction = [PSCustomObject]@{ State = 'pending'; BackupState = 'no-backup'; ManifestState = 'missing'; ManifestPath = (Join-Path $interleaveRoot 'manifest'); ManifestBackupPath = (Join-Path $interleaveRoot 'manifest-backup'); LockPath = $interleaveRoot; LockOwner = 'interleave-owner'; ParentPid = '1'; ParentStartedAt = '1'; InstallerPid = '1'; InstallerStartedAt = '1'; OriginalBinaryHash = '' }",
      "[IO.File]::WriteAllText($script:transactionPath, ($interleavedTransaction | ConvertTo-Json -Compress))",
      "$script:transaction = Read-Upgrade-Transaction",
      "$interleavedTransaction.State = 'committed'",
      "[IO.File]::WriteAllText($script:transactionPath, ($interleavedTransaction | ConvertTo-Json -Compress))",
      "$interleaveActor = [PSCustomObject]@{ pid = $PID; processStartedAt = $startedAt; token = 'interleave-owner'; action = 'Recover'; lockPath = $interleaveRoot }",
      "$freshTransaction = Read-Upgrade-Transaction-After-Actor $interleaveActor",
      "if (-not $freshTransaction -or $freshTransaction.State -ne 'committed') { throw 'recovery reused the transaction cached before actor acquisition' }",
      "$interleavedTransaction.LockOwner = 'changed-owner'",
      "[IO.File]::WriteAllText($script:transactionPath, ($interleavedTransaction | ConvertTo-Json -Compress))",
      "if ($null -ne (Read-Upgrade-Transaction-After-Actor $interleaveActor)) { throw 'recovery accepted a changed transaction owner' }",
      "[IO.File]::WriteAllText((Join-Path $interleaveRoot 'active-actor'), ($interleaveActor | ConvertTo-Json -Compress))",
      "[IO.File]::WriteAllText($script:transactionPath, '{')",
      "Release-Upgrade-Actor $interleaveActor",
      "if (Test-Path -LiteralPath (Join-Path $interleaveRoot 'active-actor')) { throw 'owned actor was not released after transaction reread failure' }",
      "Remove-Item -LiteralPath $interleaveRoot -Recurse -Force",
      "$handshakeRoot = Join-Path ([IO.Path]::GetTempPath()) ('memory-lane-handshake-' + [Guid]::NewGuid().ToString('N'))",
      "New-Item -ItemType Directory -Path $handshakeRoot | Out-Null",
      "$handshakeOwner = [PSCustomObject]@{ pid = $PID; processStartedAt = $startedAt; token = 'handshake-owner'; createdAt = 1; heartbeatAt = 1; phase = 'recovery' }",
      "[IO.File]::WriteAllText((Join-Path $handshakeRoot 'owner'), ($handshakeOwner | ConvertTo-Json -Compress))",
      "$script:transaction = [PSCustomObject]@{ LockPath = $handshakeRoot; LockOwner = 'handshake-owner' }",
      "function Read-Upgrade-Transaction { return $script:transaction }",
      "try { if (-not (Wait-For-Upgrade-Recovery-Lease 500)) { throw 'durable recovery lease handshake was rejected' }; $handshakeOwner.phase = 'starting'; [IO.File]::WriteAllText((Join-Path $handshakeRoot 'owner'), ($handshakeOwner | ConvertTo-Json -Compress)); if (Wait-For-Upgrade-Recovery-Lease 200) { throw 'starting lease was accepted as recovery handoff' } } finally { Remove-Item -LiteralPath $handshakeRoot -Recurse -Force }",
      "function Get-Process { throw [InvalidOperationException]::new('transient process inspection failure') }",
      "if ((Test-Upgrade-Process-Identity $PID $startedAt) -ne 'unknown') { throw 'process inspection failure was treated as exit' }",
      "Remove-Item -LiteralPath Function:\\Get-Process -Force",
      "$script:identityChecks = 0",
      "$script:leaseRefreshes = 0",
      "function Test-Upgrade-Process-Identity { $script:identityChecks++; if ($script:identityChecks -lt 3) { return 'unknown' }; return 'inactive' }",
      "function Update-Upgrade-Lock-Lease { $script:leaseRefreshes++; return $true }",
      "function Start-Sleep {}",
      "if (-not (Wait-For-Upgrade-Process 1 '1')) { throw 'unknown process identity lost recovery lease' }",
      "if ($script:identityChecks -ne 3 -or $script:leaseRefreshes -ne 2) { throw 'unknown process identity was not retried' }",
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
    const parentStartedAt = spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Console]::Out.Write((Get-Process -Id ([int]$env:TEST_PARENT_PID) -ErrorAction Stop).StartTime.ToUniversalTime().Ticks)",
    ], {
      env: { ...process.env, TEST_PARENT_PID: String(runningOldBinary.pid) },
      encoding: "utf8",
    }).stdout.trim()
    assert.match(parentStartedAt, /^\d+$/u)
    const upgradeLockPath = path.join(installDir, ".memory-lane-upgrade.lock")
    let lockSequence = 0
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
      MEMORY_LANE_UPGRADE_LOCK_PATH: upgradeLockPath,
    }
    const prepareUpgradeLock = (): void => {
      lockSequence++
      fs.rmSync(upgradeLockPath, { recursive: true, force: true })
      fs.mkdirSync(upgradeLockPath)
      const now = Date.now()
      const owner = `windows-smoke-owner-${lockSequence}`
      installerEnv.MEMORY_LANE_UPGRADE_LOCK_OWNER = owner
      fs.writeFileSync(path.join(upgradeLockPath, "owner"), JSON.stringify({
        pid: runningOldBinary?.pid,
        processStartedAt: parentStartedAt,
        token: owner,
        createdAt: now,
        heartbeatAt: now,
        phase: "starting",
        parentPid: runningOldBinary?.pid,
        parentProcessStartedAt: parentStartedAt,
      }), "utf8")
    }
    const installerArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repo, "install.ps1")]
    const backupPath = `${installPath}.backup.${runningOldBinary.pid}`
    const transactionPath = `${installPath}.upgrade.${runningOldBinary.pid}`

    prepareUpgradeLock()
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

    prepareUpgradeLock()
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

    prepareUpgradeLock()
    run("powershell.exe", installerArgs, {
      cwd: repo,
      env: installerEnv,
    })
    assert.equal(fs.existsSync(backupPath), true, "installer must retain the backup until post-install work succeeds")
    assert.equal(fs.existsSync(transactionPath), true, "installer must retain the transaction until post-install work succeeds")
    const recoveryOwner = JSON.parse(fs.readFileSync(path.join(upgradeLockPath, "owner"), "utf8"))
    assert.equal(recoveryOwner.phase, "recovery", "installer success must wait for durable recovery lease handoff")
    assert.equal(recoveryOwner.token, installerEnv.MEMORY_LANE_UPGRADE_LOCK_OWNER)
    assert.match(recoveryOwner.processStartedAt, /^\d+$/u)
    assert.equal(recoveryOwner.parentPid, String(runningOldBinary.pid))
    assert.equal(recoveryOwner.parentProcessStartedAt, parentStartedAt)
    assert.equal(recoveryOwner.recoveryPid, recoveryOwner.pid)
    assert.equal(recoveryOwner.recoveryProcessStartedAt, recoveryOwner.processStartedAt)

    const smoke = spawnSync(installPath, ["--smoke-test"], { encoding: "utf8" })
    assert.equal(smoke.status, 0, smoke.stderr)
    assert.match(smoke.stdout, /memory-lane ok/u)
    assert.equal(runningOldBinary.exitCode, null, "old executable must still be running when replacement succeeds")
    const failedReapply = spawnSync(installPath, [
      "upgrade",
      "--reapply-install-manifest",
      "--transactional-windows-upgrade",
      "--yes",
    ], {
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

    fs.copyFileSync(manifestPath, manifestBackupPath)
    prepareUpgradeLock()
    run("powershell.exe", installerArgs, {
      cwd: repo,
      env: installerEnv,
    })
    fs.rmSync(installPath, { force: true })
    fs.renameSync(backupPath, installPath)
    fs.writeFileSync(manifestPath, "upgraded manifest must be rolled back", "utf8")
    run("powershell.exe", [...installerArgs, "-UpgradeAction", "Rollback"], {
      cwd: repo,
      env: installerEnv,
    })
    assert.equal(fs.readFileSync(manifestPath, "utf8"), originalManifest, "checkpoint retry must restore the manifest")
    assert.equal(fs.existsSync(backupPath), false, "checkpoint retry must accept a previously consumed backup")
    const checkpointRestored = spawnSync(installPath, ["--identity"], { encoding: "utf8" })
    assert.match(checkpointRestored.stdout, /old binary/u)

    fs.writeFileSync(claudeConfigPath, "{}", "utf8")
    fs.copyFileSync(manifestPath, manifestBackupPath)
    prepareUpgradeLock()
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
    await waitUntil(() => !fs.existsSync(upgradeLockPath), "upgrade lock cleanup")

    const noOriginalInstallDir = path.join(root, "no-original-bin")
    const noOriginalInstallPath = path.join(noOriginalInstallDir, "memory-lane.exe")
    const noOriginalManifestPath = path.join(root, "no-original-data", "install.json")
    const noOriginalManifestBackupPath = `${noOriginalManifestPath}.upgrade-backup.${exitedUpgradePid}`
    const noOriginalTransactionPath = `${noOriginalInstallPath}.upgrade.${exitedUpgradePid}`
    const noOriginalLockPath = path.join(noOriginalInstallDir, ".memory-lane-upgrade.lock")
    const noOriginalLockOwner = "no-original-owner"
    fs.mkdirSync(noOriginalLockPath, { recursive: true })
    fs.mkdirSync(path.dirname(noOriginalManifestPath), { recursive: true })
    fs.writeFileSync(
      path.join(noOriginalLockPath, "owner"),
      JSON.stringify({ pid: process.pid, token: noOriginalLockOwner }),
      "utf8",
    )
    fs.writeFileSync(noOriginalManifestPath, "new manifest must be removed", "utf8")
    fs.writeFileSync(noOriginalTransactionPath, JSON.stringify({
      State: "pending",
      BackupState: "no-original-restored",
      ManifestState: "missing",
      ManifestPath: noOriginalManifestPath,
      ManifestBackupPath: noOriginalManifestBackupPath,
      LockPath: noOriginalLockPath,
      LockOwner: noOriginalLockOwner,
      ParentPid: exitedUpgradePid,
      ParentStartedAt: "1",
      InstallerPid: exitedUpgradePid,
      InstallerStartedAt: "1",
      OriginalBinaryHash: "",
    }), "utf8")
    run("powershell.exe", [...installerArgs, "-UpgradeAction", "Rollback"], {
      cwd: repo,
      env: {
        ...installerEnv,
        INSTALL_DIR: noOriginalInstallDir,
        MEMORY_LANE_UPGRADE_PID: String(exitedUpgradePid),
        MEMORY_LANE_UPGRADE_LOCK_PATH: noOriginalLockPath,
        MEMORY_LANE_UPGRADE_LOCK_OWNER: noOriginalLockOwner,
      },
    })
    assert.equal(fs.existsSync(noOriginalInstallPath), false, "no-original retry must preserve the absent binary")
    assert.equal(fs.existsSync(noOriginalManifestPath), false, "no-original retry must restore the absent manifest")
    assert.equal(fs.existsSync(noOriginalTransactionPath), false, "no-original retry must close the transaction")
    assert.equal(fs.existsSync(noOriginalLockPath), false, "no-original retry must release its upgrade lock")

    const verifiedExecutable = fs.readFileSync(installPath)
    const verifiedExecutableHash = createHash("sha256").update(verifiedExecutable).digest("hex")
    for (const executableState of ["missing", "tampered"] as const) {
      const restoreOwner = `restore-verification-${executableState}`
      fs.mkdirSync(upgradeLockPath)
      fs.writeFileSync(path.join(upgradeLockPath, "owner"), JSON.stringify({
        pid: process.pid,
        token: restoreOwner,
      }), "utf8")
      fs.writeFileSync(backupPath, "retained backup artifact", "utf8")
      fs.writeFileSync(manifestBackupPath, "retained manifest artifact", "utf8")
      fs.writeFileSync(transactionPath, JSON.stringify({
        State: "restored",
        BackupState: "restored",
        ManifestState: "restored",
        ManifestPath: manifestPath,
        ManifestBackupPath: manifestBackupPath,
        LockPath: upgradeLockPath,
        LockOwner: restoreOwner,
        ParentPid: exitedUpgradePid,
        ParentStartedAt: "1",
        InstallerPid: exitedUpgradePid,
        InstallerStartedAt: "1",
        OriginalBinaryHash: verifiedExecutableHash,
      }), "utf8")
      if (executableState === "missing") fs.rmSync(installPath)
      else fs.writeFileSync(installPath, "tampered executable", "utf8")

      const rejectedRestore = spawnSync("powershell.exe", [...installerArgs, "-UpgradeAction", "Rollback"], {
        cwd: repo,
        env: {
          ...installerEnv,
          MEMORY_LANE_UPGRADE_PID: String(exitedUpgradePid),
          MEMORY_LANE_UPGRADE_LOCK_PATH: upgradeLockPath,
          MEMORY_LANE_UPGRADE_LOCK_OWNER: restoreOwner,
        },
        encoding: "utf8",
      })
      assert.notEqual(rejectedRestore.status, 0, `${executableState} restored executable must reject cleanup`)
      assert.equal(fs.existsSync(transactionPath), true, "failed restore verification must retain the transaction")
      assert.equal(fs.existsSync(backupPath), true, "failed restore verification must retain the backup")
      assert.equal(fs.existsSync(manifestBackupPath), true, "failed restore verification must retain the manifest backup")
      assert.equal(fs.existsSync(upgradeLockPath), true, "failed restore verification must retain the upgrade lock")

      fs.writeFileSync(installPath, verifiedExecutable)
      run("powershell.exe", [...installerArgs, "-UpgradeAction", "Rollback"], {
        cwd: repo,
        env: {
          ...installerEnv,
          MEMORY_LANE_UPGRADE_PID: String(exitedUpgradePid),
          MEMORY_LANE_UPGRADE_LOCK_PATH: upgradeLockPath,
          MEMORY_LANE_UPGRADE_LOCK_OWNER: restoreOwner,
        },
      })
      assert.equal(fs.existsSync(transactionPath), false, "verified restore retry must close the transaction")
      assert.equal(fs.existsSync(backupPath), false, "verified restore retry must clean the backup")
      assert.equal(fs.existsSync(manifestBackupPath), false, "verified restore retry must clean the manifest backup")
      assert.equal(fs.existsSync(upgradeLockPath), false, "verified restore retry must release the upgrade lock")
    }

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
    if (runningOldBinary && runningOldBinary.exitCode === null && runningOldBinary.signalCode === null) {
      const exit = waitForExit(runningOldBinary)
      runningOldBinary.kill()
      await exit
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
