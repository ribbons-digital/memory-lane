import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  appendHookDebugLog, defaultHookDebugLogPath, hookDebugEnabled,
} from "../src/hook-debug-log.js"
import { tempDir } from "./helpers.js"

describe("hook debug log", () => {
  it("detects enabled hook debug values", () => {
    assert.equal(hookDebugEnabled({ MEMORY_LANE_HOOK_DEBUG: "1" }), true)
    assert.equal(hookDebugEnabled({ MEMORY_LANE_HOOK_DEBUG: "true" }), true)
    assert.equal(hookDebugEnabled({ MEMORY_LANE_HOOK_DEBUG: "0" }), false)
    assert.equal(hookDebugEnabled({ MEMORY_LANE_HOOK_DEBUG: "false" }), false)
    assert.equal(hookDebugEnabled({ MEMORY_LANE_HOOK_DEBUG: "TRUE" }), false)
    assert.equal(hookDebugEnabled({}), false)
  })

  it("uses the default hooks-log.jsonl path under .memory-lane", () => {
    assert.equal(
      defaultHookDebugLogPath().endsWith(path.join(".memory-lane", "hooks-log.jsonl")),
      true,
    )
  })

  it("appends exactly one JSONL record to a supplied path", () => {
    const file = path.join(tempDir(), "nested", "hooks-log.jsonl")

    appendHookDebugLog({
      timestamp: "2026-06-07T00:00:00.000Z",
      adapter: "codex",
      event: "stop",
      cwd: "/tmp/project",
      status: "ok",
      saved: 1,
      skipped: 2,
      discarded: 3,
      additionalContext: false,
      warningCount: 4,
      contextPolicyMode: "selective",
      contextEvent: "prompt",
      contextSelected: 1,
      contextOmitted: 2,
      contextMaxItems: 6,
      contextMaxChars: 3000,
      contextOmittedReasons: ["budget-or-filter"],
      durationMs: 5,
    }, { filePath: file })

    const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n")
    assert.equal(lines.length, 1)
    assert.deepEqual(JSON.parse(lines[0]), {
      timestamp: "2026-06-07T00:00:00.000Z",
      adapter: "codex",
      event: "stop",
      cwd: "/tmp/project",
      status: "ok",
      saved: 1,
      skipped: 2,
      discarded: 3,
      additionalContext: false,
      warningCount: 4,
      contextPolicyMode: "selective",
      contextEvent: "prompt",
      contextSelected: 1,
      contextOmitted: 2,
      contextMaxItems: 6,
      contextMaxChars: 3000,
      contextOmittedReasons: ["budget-or-filter"],
      durationMs: 5,
    })
  })

  it("swallows write errors", () => {
    const dir = tempDir()

    assert.doesNotThrow(() => {
      appendHookDebugLog({
        timestamp: "2026-06-07T00:00:00.000Z",
        adapter: "codex",
        event: "stop",
        status: "noop",
        reason: "invalid JSON payload",
        durationMs: 1,
      }, { filePath: dir })
    })
  })

  it("writes only safe hook metadata fields", () => {
    const file = path.join(tempDir(), "hooks-log.jsonl")

    appendHookDebugLog({
      timestamp: "2026-06-07T00:00:00.000Z",
      adapter: "claude",
      event: "post-tool-use",
      status: "error",
      reason: "hook handling failed",
      durationMs: 9,
      prompt: "do not log this prompt",
      transcript: "do not log this transcript",
      toolOutput: "do not log this tool output",
      memoryText: "do not log this memory",
      additionalContextText: "do not log injected context",
    } as any, { filePath: file })

    const text = fs.readFileSync(file, "utf8")
    assert.equal(text.includes("do not log"), false)
    assert.deepEqual(Object.keys(JSON.parse(text)).sort(), [
      "adapter",
      "durationMs",
      "event",
      "reason",
      "status",
      "timestamp",
    ])
  })
})
