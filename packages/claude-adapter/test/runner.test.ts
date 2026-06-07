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

function debugLogPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-claude-debug-log-"))
  return path.join(dir, "hooks-log.jsonl")
}

function readDebugRecords(filePath: string): Array<Record<string, unknown>> {
  return fs.readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function userPromptPayload(prompt = "How do tests run?"): string {
  return JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    session_id: "session-1",
    cwd: process.cwd(),
    transcript_path: null,
    permission_mode: "default",
    prompt,
  })
}

function stopPayload(): string {
  return JSON.stringify({
    hook_event_name: "Stop",
    session_id: "session-1",
    cwd: process.cwd(),
    transcript_path: null,
    permission_mode: "default",
    last_user_message: "remember that this repo uses pnpm",
    last_assistant_message: "I'll remember that this repo uses pnpm.",
  })
}

function postToolUsePayload(toolResponse: unknown = { exit_code: 0, stdout: "pass" }): string {
  return JSON.stringify({
    hook_event_name: "PostToolUse",
    session_id: "session-1",
    cwd: process.cwd(),
    transcript_path: null,
    permission_mode: "default",
    tool_name: "Bash",
    tool_input: { command: "pnpm test" },
    tool_response: toolResponse,
  })
}

test("user-prompt-submit emits Claude additionalContext output", async () => {
  const engine = engineInTemp()
  engine.save({ text: "This repo runs tests with pnpm test", category: "project", scopeType: "global", status: "approved" })

  const output = await runClaudeHookCommand("user-prompt-submit", {
    engine,
    payloadText: userPromptPayload(),
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
    payloadText: stopPayload(),
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
    payloadText: postToolUsePayload(),
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

test("debug-enabled hook writes one JSONL record with safe counts", async () => {
  const logPath = debugLogPath()
  await runClaudeHookCommand("post-tool-use", {
    engine: engineInTemp(),
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    hookDebugLogPath: logPath,
    payloadText: postToolUsePayload(),
  })

  const records = readDebugRecords(logPath)

  assert.equal(records.length, 1)
  assert.equal(records[0].adapter, "claude")
  assert.equal(records[0].event, "post-tool-use")
  assert.equal(records[0].cwd, process.cwd())
  assert.equal(records[0].status, "ok")
  assert.equal(records[0].saved, 1)
  assert.equal(records[0].skipped, 0)
  assert.equal(records[0].discarded, 0)
  assert.equal(records[0].additionalContext, false)
  assert.equal(records[0].warningCount, 0)
  assert.equal(typeof records[0].durationMs, "number")
})

test("invalid JSON debug hook writes noop log record", async () => {
  const logPath = debugLogPath()
  await runClaudeHookCommand("user-prompt-submit", {
    engine: engineInTemp(),
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    hookDebugLogPath: logPath,
    payloadText: "{not json",
  })

  const records = readDebugRecords(logPath)

  assert.equal(records.length, 1)
  assert.equal(records[0].adapter, "claude")
  assert.equal(records[0].event, "user-prompt-submit")
  assert.equal(records[0].status, "noop")
  assert.equal(records[0].reason, "invalid JSON payload")
  assert.equal(typeof records[0].durationMs, "number")
})

test("handler exception debug hook writes error log record", async () => {
  const engine = engineInTemp()
  ;(engine as unknown as { recall: () => Promise<never> }).recall = async () => { throw new Error("PRIVATE_ERROR_DETAIL") }
  const logPath = debugLogPath()

  await runClaudeHookCommand("user-prompt-submit", {
    engine,
    env: { MEMORY_LANE_HOOK_DEBUG: "true" } as NodeJS.ProcessEnv,
    hookDebugLogPath: logPath,
    payloadText: userPromptPayload("PROMPT_TEXT_NOT_IN_LOG"),
  })

  const logText = fs.readFileSync(logPath, "utf8")
  const records = readDebugRecords(logPath)

  assert.equal(records.length, 1)
  assert.equal(records[0].adapter, "claude")
  assert.equal(records[0].event, "user-prompt-submit")
  assert.equal(records[0].status, "error")
  assert.equal(records[0].reason, "hook handling failed")
  assert.doesNotMatch(logText, /PRIVATE_ERROR_DETAIL|PROMPT_TEXT_NOT_IN_LOG/)
})

test("debug-disabled hook writes no log record", async () => {
  const logPath = debugLogPath()
  await runClaudeHookCommand("post-tool-use", {
    engine: engineInTemp(),
    env: {} as NodeJS.ProcessEnv,
    hookDebugLogPath: logPath,
    payloadText: postToolUsePayload(),
  })

  assert.equal(fs.existsSync(logPath), false)
})

test("debug log omits raw prompt transcript tool memory and injected context text", async () => {
  const logPath = debugLogPath()
  const engine = engineInTemp()
  const memoryText = "MEMORY_TEXT_NOT_IN_LOG"
  const promptText = "PROMPT_TEXT_NOT_IN_LOG"
  const transcriptUserText = "TRANSCRIPT_USER_TEXT_NOT_IN_LOG"
  const transcriptAssistantText = "remember that MEMORY_FROM_TRANSCRIPT_NOT_IN_LOG"
  const toolOutputText = "TOOL_OUTPUT_BODY_NOT_IN_LOG"
  engine.save({ text: memoryText, category: "project", scopeType: "global", status: "approved" })

  await runClaudeHookCommand("user-prompt-submit", {
    engine,
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    hookDebugLogPath: logPath,
    payloadText: userPromptPayload(promptText),
  })

  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-claude-debug-transcript-"))
  const transcriptPath = path.join(transcriptDir, "transcript.jsonl")
  fs.writeFileSync(transcriptPath, [
    JSON.stringify({ role: "user", content: transcriptUserText }),
    JSON.stringify({ role: "assistant", content: transcriptAssistantText }),
  ].join("\n"), "utf8")
  await runClaudeHookCommand("stop", {
    engine,
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    hookDebugLogPath: logPath,
    payloadText: JSON.stringify({
      hook_event_name: "Stop",
      session_id: "session-1",
      cwd: process.cwd(),
      transcript_path: transcriptPath,
      permission_mode: "default",
    }),
  })

  await runClaudeHookCommand("post-tool-use", {
    engine,
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    hookDebugLogPath: logPath,
    payloadText: postToolUsePayload({ exit_code: 0, stdout: toolOutputText }),
  })

  const logText = fs.readFileSync(logPath, "utf8")
  const records = readDebugRecords(logPath)

  assert.equal(records.length, 3)
  assert.equal(records[0].additionalContext, true)
  assert.doesNotMatch(logText, new RegExp([
    memoryText,
    promptText,
    transcriptUserText,
    transcriptAssistantText,
    "MEMORY_FROM_TRANSCRIPT_NOT_IN_LOG",
    toolOutputText,
    "Relevant Memory",
  ].join("|")))
})
