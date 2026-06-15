import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, test } from "node:test"
import { piDebugPath, writePiDebugLog } from "../src/debug.js"

let tmpDir: string | undefined

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

test("writePiDebugLog appends a privacy-safe JSONL record", () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-debug-test-"))
  const logPath = path.join(tmpDir, "pi-debug.jsonl")
  writePiDebugLog(logPath, {
    event: "tool_result",
    sessionId: "s1",
    turnId: "t1",
    savedCount: 1,
    discardedCount: 0,
  })
  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n")
  assert.equal(lines.length, 1)
  const record = JSON.parse(lines[0])
  assert.equal(record.event, "tool_result")
  assert.equal(record.harness, "pi")
  assert.equal(record.savedCount, 1)
  assert.equal(record.hasOwnProperty("prompt"), false)
  assert.equal(record.hasOwnProperty("toolInput"), false)
  assert.equal(record.hasOwnProperty("toolResponse"), false)
})

test("piDebugPath returns default under ~/.memory-lane", () => {
  const home = process.env.HOME ?? "/tmp"
  assert.equal(piDebugPath(), path.join(home, ".memory-lane", "pi-debug.jsonl"))
})
