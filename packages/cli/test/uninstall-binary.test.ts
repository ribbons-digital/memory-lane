import { spawn, spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { ChildProcess, SpawnOptions } from "node:child_process"
import { tempDir } from "../../core/test/helpers.js"
import { removeInstalledBinary } from "../src/commands/uninstall.js"
import type { BinaryRemovalSpawner } from "../src/commands/uninstall.js"

function childThat(event: "spawn" | "error"): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  child.unref = () => child
  queueMicrotask(() => child.emit(event, event === "error" ? new Error("helper unavailable") : undefined))
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
      return childThat("spawn")
    }

    assert.equal(await removeInstalledBinary(binaryPath, "win32", 4321, spawnStub, () => "638500000000000000"), "scheduled")
    assert.equal(fs.existsSync(binaryPath), false)
    const pending = fs.readdirSync(dir).filter((name) => name.startsWith("memory-lane.exe.uninstall.4321."))
    assert.equal(pending.length, 1)
    assert.equal(invocation?.command, "powershell.exe")
    assert.equal(invocation?.options.detached, true)
    assert.equal(invocation?.options.env?.MEMORY_LANE_UNINSTALL_PARENT_PID, "4321")
    assert.equal(invocation?.options.env?.MEMORY_LANE_UNINSTALL_PARENT_STARTED_AT, "638500000000000000")
    assert.equal(invocation?.options.env?.MEMORY_LANE_UNINSTALL_PENDING_PATH, path.join(dir, pending[0]))
    const encodedCommand = invocation?.args.at(-1)
    assert.equal(typeof encodedCommand, "string")
    const helperCommand = Buffer.from(encodedCommand ?? "", "base64").toString("utf16le")
    assert.match(helperCommand, /StartTime\.ToUniversalTime\(\)\.Ticks/u)
    assert.match(helperCommand, /\$identity = 'unknown'/u)
    assert.match(helperCommand, /NoProcessFoundForGivenId/u)
    assert.match(helperCommand, /if \(\$identity -eq 'inactive'\) \{ break \}/u)
    assert.match(helperCommand, /for \(\$attempt = 0; \$attempt -lt 10; \$attempt\+\+\)/u)
    assert.match(helperCommand, /Remove-Item -LiteralPath .* -ErrorAction Stop/u)
  })

  it("distinguishes matching and reused Windows process identities", { skip: process.platform !== "win32" }, async () => {
    const dir = tempDir()
    const binaryPath = path.join(dir, "memory-lane.exe")
    fs.writeFileSync(binaryPath, "binary", "utf8")
    let invocation: { args: readonly string[]; options: SpawnOptions } | undefined
    const spawnStub: BinaryRemovalSpawner = (_command, args, options) => {
      invocation = { args, options }
      return childThat("spawn")
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

    const matchingPath = path.join(dir, "matching.exe")
    fs.writeFileSync(matchingPath, "pending", "utf8")
    const matching = spawn("powershell.exe", invocation?.args ?? [], {
      ...invocation?.options,
      detached: false,
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
    matching.kill()

    const reusedPath = path.join(dir, "reused.exe")
    fs.writeFileSync(reusedPath, "pending", "utf8")
    const reused = spawnSync("powershell.exe", invocation?.args ?? [], {
      encoding: "utf8",
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
    const helperCommand = Buffer.from(String(invocation?.args.at(-1)), "base64").toString("utf16le")
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
    const spawnStub: BinaryRemovalSpawner = () => childThat("error")

    await assert.rejects(
      removeInstalledBinary(binaryPath, "win32", 9876, spawnStub, () => "638500000000000000"),
      /Could not schedule Windows binary removal: helper unavailable/u,
    )
    assert.equal(fs.readFileSync(binaryPath, "utf8"), "binary")
    assert.deepEqual(fs.readdirSync(dir), ["memory-lane.exe"])
  })
})
