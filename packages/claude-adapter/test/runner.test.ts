import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { MemoryEngine } from "@memory-lane/core"
import { runClaudeHookCommand } from "../src/runner.ts"

function engineInTemp(): MemoryEngine {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-claude-"))
  return new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath: path.join(dir, "config.json"),
  })
}

test("user-prompt-submit emits Claude additionalContext output", async () => {
  const engine = engineInTemp()
  engine.save({ text: "This repo runs tests with pnpm test", category: "project", scopeType: "global", status: "approved" })

  const output = await runClaudeHookCommand("user-prompt-submit", {
    engine,
    payloadText: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      cwd: process.cwd(),
      transcript_path: null,
      permission_mode: "default",
      prompt: "How do tests run?",
    }),
  })

  const parsed = JSON.parse(output)
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit")
  assert.match(parsed.hookSpecificOutput.additionalContext, /Relevant Memory/)
})

test("stop saves with claude provenance", async () => {
  const engine = engineInTemp()

  const output = await runClaudeHookCommand("stop", {
    engine,
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    payloadText: JSON.stringify({
      hook_event_name: "Stop",
      session_id: "session-1",
      cwd: process.cwd(),
      transcript_path: null,
      permission_mode: "default",
      last_user_message: "remember that this repo uses pnpm",
      last_assistant_message: "I'll remember that this repo uses pnpm.",
    }),
  })

  assert.match(JSON.parse(output).systemMessage, /Memory Lane:/)
  const saved = engine.list({ all: true })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].provenance?.adapter, "claude")
  assert.equal(saved[0].provenance?.lifecycleEvent, "turn_stop")
})

test("stop reads latest turn from transcript", async () => {
  const engine = engineInTemp()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-claude-transcript-"))
  const transcriptPath = path.join(dir, "transcript.jsonl")
  fs.writeFileSync(transcriptPath, [
    JSON.stringify({ role: "user", content: "hello" }),
    JSON.stringify({ role: "assistant", content: "hello back" }),
    JSON.stringify({ role: "user", content: "remember that Claude transcript tests use jsonl" }),
    JSON.stringify({ role: "assistant", content: "I'll remember that Claude transcript tests use jsonl." }),
  ].join("\n"))

  await runClaudeHookCommand("stop", {
    engine,
    payloadText: JSON.stringify({
      hook_event_name: "Stop",
      session_id: "session-1",
      cwd: process.cwd(),
      transcript_path: transcriptPath,
      permission_mode: "default",
    }),
  })

  const saved = engine.list({ all: true })
  assert.equal(saved.length, 1)
  assert.match(saved[0].text, /Claude transcript tests use jsonl/)
  assert.equal(saved[0].provenance?.adapter, "claude")
  assert.equal(saved[0].provenance?.lifecycleEvent, "turn_stop")
})

test("post-tool-use saves with claude tool provenance", async () => {
  const engine = engineInTemp()

  await runClaudeHookCommand("post-tool-use", {
    engine,
    payloadText: JSON.stringify({
      hook_event_name: "PostToolUse",
      session_id: "session-1",
      cwd: process.cwd(),
      transcript_path: null,
      permission_mode: "default",
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_response: { exit_code: 0, stdout: "pass" },
    }),
  })

  const saved = engine.list({ all: true })
  assert.equal(saved[0].provenance?.adapter, "claude")
  assert.equal(saved[0].provenance?.lifecycleEvent, "post_tool_use")
  assert.equal(saved[0].provenance?.toolName, "Bash")
})

test("invalid payload returns debug no-op", async () => {
  const output = await runClaudeHookCommand("user-prompt-submit", {
    engine: engineInTemp(),
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    payloadText: "{not json",
  })

  assert.equal(JSON.parse(output).systemMessage, "Memory Lane: invalid JSON payload")
})
