import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  removeWindowsSmokeRoot,
  runWithWindowsSmokeCleanup,
  WINDOWS_SMOKE_CLEANUP_MAX_RETRIES,
  WINDOWS_SMOKE_CLEANUP_RETRY_DELAY_MS,
} from "../../../scripts/windows-smoke-cleanup.js"

describe("Windows self-maintenance smoke cleanup", () => {
  it("uses bounded recursive retries for transient Windows locks", () => {
    let removedPath: unknown
    let removedOptions: unknown

    removeWindowsSmokeRoot("C:\\temp\\windows-smoke", (target, options) => {
      removedPath = target
      removedOptions = options
    })

    assert.equal(removedPath, "C:\\temp\\windows-smoke")
    assert.deepEqual(removedOptions, {
      recursive: true,
      force: true,
      maxRetries: WINDOWS_SMOKE_CLEANUP_MAX_RETRIES,
      retryDelay: WINDOWS_SMOKE_CLEANUP_RETRY_DELAY_MS,
    })
    assert.equal(WINDOWS_SMOKE_CLEANUP_MAX_RETRIES, 10)
    assert.equal(WINDOWS_SMOKE_CLEANUP_RETRY_DELAY_MS, 100)
  })

  it("does not report success before cleanup completes", async () => {
    const events: string[] = []

    const value = await runWithWindowsSmokeCleanup("root", async () => {
      events.push("smoke")
      return "passed"
    }, {
      beforeRemove: async () => { events.push("process-cleanup") },
      removeDirectory: () => { events.push("directory-cleanup") },
    })
    events.push("success")

    assert.equal(value, "passed")
    assert.deepEqual(events, ["smoke", "process-cleanup", "directory-cleanup", "success"])
  })

  it("fails when cleanup fails after a functional pass", async () => {
    const cleanupError = new Error("cleanup failed")

    await assert.rejects(
      runWithWindowsSmokeCleanup("root", async () => undefined, {
        removeDirectory: () => { throw cleanupError },
      }),
      (error) => error === cleanupError,
    )
  })

  it("treats process cleanup failure after a functional pass as the primary failure", async () => {
    const processCleanupError = new Error("process cleanup failed")
    let directoryRemoved = false

    await assert.rejects(
      runWithWindowsSmokeCleanup("root", async () => undefined, {
        beforeRemove: async () => { throw processCleanupError },
        removeDirectory: () => { directoryRemoved = true },
      }),
      (error) => error === processCleanupError,
    )
    assert.equal(directoryRemoved, true)
  })

  it("preserves the functional failure and reports a secondary cleanup failure", async () => {
    const smokeError = new Error("functional smoke failed")
    const cleanupError = new Error("cleanup failed")
    const reported: unknown[] = []

    await assert.rejects(
      runWithWindowsSmokeCleanup("root", async () => { throw smokeError }, {
        removeDirectory: () => { throw cleanupError },
        reportSecondaryCleanupError: (error) => { reported.push(error) },
      }),
      (error) => error === smokeError,
    )
    assert.deepEqual(reported, [cleanupError])
  })

  it("runs process cleanup after a functional failure and reports its error as secondary", async () => {
    const smokeError = new Error("functional smoke failed")
    const processCleanupError = new Error("process cleanup failed")
    const reported: unknown[] = []
    let directoryRemoved = false

    await assert.rejects(
      runWithWindowsSmokeCleanup("root", async () => { throw smokeError }, {
        beforeRemove: async () => { throw processCleanupError },
        removeDirectory: () => { directoryRemoved = true },
        reportSecondaryCleanupError: (error) => { reported.push(error) },
      }),
      (error) => error === smokeError,
    )
    assert.equal(directoryRemoved, true)
    assert.deepEqual(reported, [processCleanupError])
  })
})
