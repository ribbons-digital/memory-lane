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

function stopPayload(): string {
  return JSON.stringify({
    hook_event_name: "Stop",
    cwd: process.cwd(),
    session_id: "s",
    turn_id: "t",
    transcript_path: null,
    model: "m",
    permission_mode: "default",
    stop_hook_active: false,
    last_assistant_message: "done",
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

test("invalid JSON returns no-op", async () => {
  const output = await runCodexHookCommand("user-prompt-submit", {
    engine: engineInTemp(),
    payloadText: "{not json",
  })
  assert.equal(output, "{}")
})

test("malformed payload returns no-op", async () => {
  const output = await runCodexHookCommand("user-prompt-submit", {
    engine: engineInTemp(),
    payloadText: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
  })
  assert.equal(output, "{}")
})

test("mismatched event returns no-op", async () => {
  const output = await runCodexHookCommand("user-prompt-submit", {
    engine: engineInTemp(),
    payloadText: stopPayload(),
  })
  assert.equal(output, "{}")
})

test("handler failure returns no-op", async () => {
  const engine = engineInTemp()
  ;(engine as unknown as { recall: () => Promise<never> }).recall = async () => { throw new Error("boom") }
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
  assert.equal(output, "{}")
})

test("debug output emits concise systemMessage", async () => {
  const output = await runCodexHookCommand("stop", {
    engine: engineInTemp(),
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    payloadText: stopPayload(),
  })
  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /^Memory Lane:/)
  assert.doesNotMatch(parsed.systemMessage, /last_assistant_message|done/)
})

test("debug output honors process env by default", async () => {
  const previous = process.env.MEMORY_LANE_HOOK_DEBUG
  process.env.MEMORY_LANE_HOOK_DEBUG = "true"
  try {
    const output = await runCodexHookCommand("user-prompt-submit", {
      engine: engineInTemp(),
      payloadText: "{not json",
    })
    const parsed = JSON.parse(output)
    assert.equal(parsed.systemMessage, "Memory Lane: invalid JSON payload")
  } finally {
    if (previous === undefined) delete process.env.MEMORY_LANE_HOOK_DEBUG
    else process.env.MEMORY_LANE_HOOK_DEBUG = previous
  }
})

test("explicit env override can disable process debug", async () => {
  const previous = process.env.MEMORY_LANE_HOOK_DEBUG
  process.env.MEMORY_LANE_HOOK_DEBUG = "1"
  try {
    const output = await runCodexHookCommand("user-prompt-submit", {
      engine: engineInTemp(),
      env: {} as NodeJS.ProcessEnv,
      payloadText: "{not json",
    })
    assert.equal(output, "{}")
  } finally {
    if (previous === undefined) delete process.env.MEMORY_LANE_HOOK_DEBUG
    else process.env.MEMORY_LANE_HOOK_DEBUG = previous
  }
})
