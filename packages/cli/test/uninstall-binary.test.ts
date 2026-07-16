import { spawn, spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { ChildProcess, SpawnOptions } from "node:child_process"
import { tempDir } from "../../core/test/helpers.js"
import { removeInstalledBinary, sweepPendingBinaryRemoval } from "../src/commands/uninstall.js"
import type { BinaryRemovalSpawner, ProcessIdentityInspector } from "../src/commands/uninstall.js"

function childThat(event: "close" | "error", exitCode: number = 0): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  queueMicrotask(() => {
    if (event === "error") child.emit("error", new Error("helper unavailable"))
    else child.emit("close", exitCode, null)
  })
  return child
}

describe("installed binary removal", () => {
  it("directly removes non-Windows binaries", async () => {
    const dir = tempDir()
    const binaryPath = path.join(dir, "memory-lane")
    fs.writeFileSync(binaryPath, "binary", "utf8")

    assert.equal(await removeInstalledBinary(binaryPath, "darwin"), "removed")
    assert.equal(fs.existsSync(binaryPath), false)
  })

  it("renames a Windows binary and starts a detached post-exit cleanup", async () => {
    const dir = tempDir()
    const binaryPath = path.join(dir, "memory-lane.exe")
    fs.writeFileSync(binaryPath, "binary", "utf8")
    let invocation: { command: string; args: readonly string[]; options: SpawnOptions } | undefined
    const spawnStub: BinaryRemovalSpawner = (command, args, options) => {
      invocation = { command, args, options }
      return childThat("close")
    }

    const recoveryPath = path.join(dir, "pending-uninstall.json")
    assert.equal(
      await removeInstalledBinary(binaryPath, "win32", 4321, spawnStub, () => "638500000000000000", recoveryPath),
      "scheduled",
    )
    assert.equal(fs.existsSync(binaryPath), false)
    const pending = fs.readdirSync(dir).filter((name) => name.startsWith("memory-lane.exe.uninstall."))
    assert.deepEqual(pending, ["memory-lane.exe.uninstall.4321.638500000000000000"])
    assert.equal(invocation?.command, "powershell.exe")
    assert.equal(invocation?.options.detached, undefined)
    assert.equal(invocation?.options.env?.MEMORY_LANE_UNINSTALL_PARENT_PID, "4321")
    assert.equal(invocation?.options.env?.MEMORY_LANE_UNINSTALL_PARENT_STARTED_AT, "638500000000000000")
    assert.equal(invocation?.options.env?.MEMORY_LANE_UNINSTALL_PENDING_PATH, path.join(dir, pending[0]))
    assert.equal(invocation?.options.env?.MEMORY_LANE_UNINSTALL_RECOVERY_PATH, recoveryPath)
    assert.equal(fs.existsSync(recoveryPath), true)
    const encodedLauncherCommand = invocation?.args.at(-1)
    assert.equal(typeof encodedLauncherCommand, "string")
    const launcherCommand = Buffer.from(encodedLauncherCommand ?? "", "base64").toString("utf16le")
    assert.match(launcherCommand, /Start-Process -FilePath 'powershell\.exe'/u)
    assert.match(launcherCommand, /MEMORY_LANE_UNINSTALL_HELPER_COMMAND/u)
    const encodedHelperCommand = invocation?.options.env?.MEMORY_LANE_UNINSTALL_HELPER_COMMAND
    assert.equal(typeof encodedHelperCommand, "string")
    const helperCommand = Buffer.from(encodedHelperCommand ?? "", "base64").toString("utf16le")
    assert.match(helperCommand, /StartTime\.ToUniversalTime\(\)\.Ticks/u)
    assert.match(helperCommand, /\$identity = 'unknown'/u)
    assert.match(helperCommand, /NoProcessFoundForGivenId/u)
    assert.match(helperCommand, /if \(\$identity -eq 'inactive'\) \{ \$inactive = \$true; break \}/u)
    assert.match(helperCommand, /\$identityDeadline = \[DateTime\]::UtcNow\.AddSeconds\(30\)/u)
    assert.match(helperCommand, /if \(-not \$inactive\) \{ exit 0 \}/u)
    const retryDelays = helperCommand.match(/\$retryDelays = @\(([^)]+)\)/u)?.[1]
      .split(",")
      .map((delay) => Number(delay.trim()))
    assert.deepEqual(retryDelays, [100, 200, 400, 800, 1600, 3200, 5000, 5000, 5000, 5000, 5000])
    assert.equal(retryDelays?.reduce((total, delay) => total + delay, 0), 31_300)
    assert.match(helperCommand, /for \(\$attempt = 0; \$attempt -le \$retryDelays\.Count; \$attempt\+\+\)/u)
    assert.match(helperCommand, /Remove-Item -LiteralPath .* -ErrorAction Stop/u)
    assert.match(helperCommand, /System\.IO\.IOException/u)
    assert.match(helperCommand, /System\.UnauthorizedAccessException/u)
    assert.match(helperCommand, /if \(-not \$retryable -or \$attempt -ge \$retryDelays\.Count\) \{ exit 1 \}/u)
  })

  it("safely sweeps a durable Windows uninstall recovery record", () => {
    const dir = tempDir()
    const binaryPath = path.join(dir, "memory-lane.exe")
    const recoveryPath = path.join(dir, "pending-uninstall.json")
    const parentPid = 4321
    const parentStartedAt = "638500000000000000"
    const pendingPath = `${binaryPath}.uninstall.${parentPid}.${parentStartedAt}`
    const writeRecovery = (): void => {
      fs.writeFileSync(pendingPath, "pending", "utf8")
      fs.writeFileSync(recoveryPath, JSON.stringify({ binaryPath, pendingPath, parentPid, parentStartedAt }), "utf8")
    }

    writeRecovery()
    const inactive: ProcessIdentityInspector = () => "inactive"
    assert.equal(sweepPendingBinaryRemoval(recoveryPath, "win32", inactive), "removed")
    assert.equal(fs.existsSync(pendingPath), false)
    assert.equal(fs.existsSync(recoveryPath), false)

    writeRecovery()
    const active: ProcessIdentityInspector = () => "active"
    assert.equal(sweepPendingBinaryRemoval(recoveryPath, "win32", active), "retained")
    assert.equal(fs.existsSync(pendingPath), true)
    assert.equal(fs.existsSync(recoveryPath), true)

    const unknown: ProcessIdentityInspector = () => "unknown"
    assert.equal(sweepPendingBinaryRemoval(recoveryPath, "win32", unknown), "retained")
    assert.equal(fs.existsSync(pendingPath), true)
    assert.equal(fs.existsSync(recoveryPath), true)

    fs.rmSync(pendingPath)
    assert.equal(sweepPendingBinaryRemoval(recoveryPath, "win32", unknown), "retained")
    assert.equal(fs.existsSync(recoveryPath), true)
    assert.equal(sweepPendingBinaryRemoval(recoveryPath, "win32", active), "retained")
    assert.equal(fs.existsSync(recoveryPath), true)
    assert.equal(sweepPendingBinaryRemoval(recoveryPath, "win32", inactive), "removed")
    assert.equal(fs.existsSync(recoveryPath), false)

    fs.writeFileSync(recoveryPath, "{}", "utf8")
    assert.equal(sweepPendingBinaryRemoval(recoveryPath, "win32", inactive), "retained")
    assert.equal(fs.existsSync(recoveryPath), true)
  })

  it("distinguishes matching and reused Windows process identities", { skip: process.platform !== "win32" }, async () => {
    const dir = tempDir()
    const binaryPath = path.join(dir, "memory-lane.exe")
    fs.writeFileSync(binaryPath, "binary", "utf8")
    let invocation: { args: readonly string[]; options: SpawnOptions } | undefined
    const spawnStub: BinaryRemovalSpawner = (_command, args, options) => {
      invocation = { args, options }
      return childThat("close")
    }
    await removeInstalledBinary(binaryPath, "win32", process.pid, spawnStub, () => "1")

    const identity = spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$process = Get-Process -Id ([int]$env:TEST_PARENT_PID) -ErrorAction Stop; [Console]::Out.Write($process.StartTime.ToUniversalTime().Ticks)",
    ], {
      encoding: "utf8",
      env: { ...process.env, TEST_PARENT_PID: String(process.pid) },
    }).stdout.trim()
    assert.match(identity, /^\d+$/u)

    const helperCommand = Buffer.from(
      String(invocation?.options.env?.MEMORY_LANE_UNINSTALL_HELPER_COMMAND),
      "base64",
    ).toString("utf16le")
    const helperArgs = [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(helperCommand, "utf16le").toString("base64"),
    ]

    const matchingPath = path.join(dir, "matching.exe")
    fs.writeFileSync(matchingPath, "pending", "utf8")
    const matching = spawn("powershell.exe", helperArgs, {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...invocation?.options.env,
        MEMORY_LANE_UNINSTALL_PARENT_PID: String(process.pid),
        MEMORY_LANE_UNINSTALL_PARENT_STARTED_AT: identity,
        MEMORY_LANE_UNINSTALL_PENDING_PATH: matchingPath,
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal(fs.existsSync(matchingPath), true)
    await new Promise<void>((resolve, reject) => {
      matching.once("close", () => resolve())
      matching.once("error", reject)
      if (!matching.kill()) reject(new Error("could not stop matching-identity helper"))
    })

    const reusedPath = path.join(dir, "reused.exe")
    fs.writeFileSync(reusedPath, "pending", "utf8")
    const reused = spawnSync("powershell.exe", helperArgs, {
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...invocation?.options.env,
        MEMORY_LANE_UNINSTALL_PARENT_PID: String(process.pid),
        MEMORY_LANE_UNINSTALL_PARENT_STARTED_AT: (BigInt(identity) + 1n).toString(),
        MEMORY_LANE_UNINSTALL_PENDING_PATH: reusedPath,
      },
    })
    assert.equal(reused.status, 0, `${reused.stdout}\n${reused.stderr}`)
    assert.equal(fs.existsSync(reusedPath), false)

    const transientPath = path.join(dir, "transient.exe")
    const attemptsPath = path.join(dir, "inspection-attempts.txt")
    fs.writeFileSync(transientPath, "pending", "utf8")
    const transientCommand = [
      "$script:inspectionAttempts = 0",
      "function Get-Process {",
      "  param([int]$Id, $ErrorAction)",
      "  $script:inspectionAttempts++",
      "  if ($script:inspectionAttempts -lt 3) { throw [InvalidOperationException]::new('transient inspection failure') }",
      "  Microsoft.PowerShell.Management\\Get-Process -Id $Id -ErrorAction Stop",
      "}",
      helperCommand,
      "[IO.File]::WriteAllText($env:TEST_ATTEMPTS_PATH, \"$script:inspectionAttempts\")",
    ].join("\n")
    const transient = spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(transientCommand, "utf16le").toString("base64"),
    ], {
      encoding: "utf8",
      env: {
        ...invocation?.options.env,
        MEMORY_LANE_UNINSTALL_PARENT_PID: String(process.pid),
        MEMORY_LANE_UNINSTALL_PARENT_STARTED_AT: (BigInt(identity) + 1n).toString(),
        MEMORY_LANE_UNINSTALL_PENDING_PATH: transientPath,
        TEST_ATTEMPTS_PATH: attemptsPath,
      },
    })
    assert.equal(transient.status, 0, `${transient.stdout}\n${transient.stderr}`)
    assert.equal(fs.readFileSync(attemptsPath, "utf8"), "3")
    assert.equal(fs.existsSync(transientPath), false)
  })

  it("keeps the Windows binary when parent identity capture fails", async () => {
    const dir = tempDir()
    const binaryPath = path.join(dir, "memory-lane.exe")
    fs.writeFileSync(binaryPath, "binary", "utf8")

    await assert.rejects(
      removeInstalledBinary(binaryPath, "win32", 9876, undefined, () => {
        throw new Error("identity unavailable")
      }),
      /identity unavailable/u,
    )
    assert.deepEqual(fs.readdirSync(dir), ["memory-lane.exe"])
  })

  it("restores the Windows binary when the cleanup helper cannot start", async () => {
    const dir = tempDir()
    const binaryPath = path.join(dir, "memory-lane.exe")
    fs.writeFileSync(binaryPath, "binary", "utf8")
    const recoveryPath = path.join(dir, "pending-uninstall.json")
    const spawnStub: BinaryRemovalSpawner = () => childThat("error")

    await assert.rejects(
      removeInstalledBinary(binaryPath, "win32", 9876, spawnStub, () => "638500000000000000", recoveryPath),
      /Could not schedule Windows binary removal: helper unavailable/u,
    )
    assert.equal(fs.readFileSync(binaryPath, "utf8"), "binary")
    assert.deepEqual(fs.readdirSync(dir), ["memory-lane.exe"])
  })

  it("restores the Windows binary when the durable helper launcher fails", async () => {
    const dir = tempDir()
    const binaryPath = path.join(dir, "memory-lane.exe")
    fs.writeFileSync(binaryPath, "binary", "utf8")
    const recoveryPath = path.join(dir, "pending-uninstall.json")
    const spawnStub: BinaryRemovalSpawner = () => childThat("close", 1)

    await assert.rejects(
      removeInstalledBinary(binaryPath, "win32", 9876, spawnStub, () => "638500000000000000", recoveryPath),
      /Could not schedule Windows binary removal: cleanup helper launcher exited with code 1/u,
    )
    assert.equal(fs.readFileSync(binaryPath, "utf8"), "binary")
    assert.deepEqual(fs.readdirSync(dir), ["memory-lane.exe"])
  })
})
