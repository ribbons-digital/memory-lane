import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { MemoryEngine } from "@memory-lane/core"
import { runCodexHookCommand } from "../src/runner.ts"

function engineInTemp(): MemoryEngine {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-codex-"))
  return new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath: path.join(dir, "config.json"),
  })
}

test("user-prompt-submit emits additionalContext", async () => {
  const engine = engineInTemp()
  engine.save({ text: "This repo runs tests with pnpm test", category: "project", scopeType: "global", status: "approved" })
  const output = await runCodexHookCommand("user-prompt-submit", {
    engine,
    payloadText: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      turn_id: "turn-1",
      cwd: process.cwd(),
      transcript_path: null,
      model: "gpt-5-codex",
      permission_mode: "default",
      prompt: "How do tests run?",
    }),
  })
  const parsed = JSON.parse(output)
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit")
  assert.match(parsed.hookSpecificOutput.additionalContext, /Relevant Memory/)
})

test("mismatched event returns no-op", async () => {
  const output = await runCodexHookCommand("user-prompt-submit", {
    engine: engineInTemp(),
    payloadText: JSON.stringify({
      hook_event_name: "Stop",
      cwd: process.cwd(),
      session_id: "s",
      turn_id: "t",
      transcript_path: null,
      model: "m",
      permission_mode: "default",
      stop_hook_active: false,
      last_assistant_message: "done",
    }),
  })
  assert.equal(output, "{}")
})

test("debug output emits concise systemMessage", async () => {
  const output = await runCodexHookCommand("stop", {
    engine: engineInTemp(),
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    payloadText: JSON.stringify({
      hook_event_name: "Stop",
      cwd: process.cwd(),
      session_id: "s",
      turn_id: "t",
      transcript_path: null,
      model: "m",
      permission_mode: "default",
      stop_hook_active: false,
      last_assistant_message: "done",
    }),
  })
  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /^Memory Lane:/)
  assert.doesNotMatch(parsed.systemMessage, /last_assistant_message|done/)
})
