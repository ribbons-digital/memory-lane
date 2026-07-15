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

    assert.equal(await removeInstalledBinary(binaryPath, "win32", 4321, spawnStub), "scheduled")
    assert.equal(fs.existsSync(binaryPath), false)
    const pending = fs.readdirSync(dir).filter((name) => name.startsWith("memory-lane.exe.uninstall.4321."))
    assert.equal(pending.length, 1)
    assert.equal(invocation?.command, "powershell.exe")
    assert.equal(invocation?.options.detached, true)
    assert.equal(invocation?.options.env?.MEMORY_LANE_UNINSTALL_PARENT_PID, "4321")
    assert.equal(invocation?.options.env?.MEMORY_LANE_UNINSTALL_PENDING_PATH, path.join(dir, pending[0]))
  })

  it("restores the Windows binary when the cleanup helper cannot start", async () => {
    const dir = tempDir()
    const binaryPath = path.join(dir, "memory-lane.exe")
    fs.writeFileSync(binaryPath, "binary", "utf8")
    const spawnStub: BinaryRemovalSpawner = () => childThat("error")

    await assert.rejects(
      removeInstalledBinary(binaryPath, "win32", 9876, spawnStub),
      /Could not schedule Windows binary removal: helper unavailable/u,
    )
    assert.equal(fs.readFileSync(binaryPath, "utf8"), "binary")
    assert.deepEqual(fs.readdirSync(dir), ["memory-lane.exe"])
  })
})
