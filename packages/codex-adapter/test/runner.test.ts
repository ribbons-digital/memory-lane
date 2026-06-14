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

function debugLogPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-codex-debug-log-"))
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
    turn_id: "turn-1",
    cwd: process.cwd(),
    transcript_path: null,
    model: "gpt-5-codex",
    permission_mode: "default",
    prompt,
  })
}

function postToolUsePayload(toolResponse: unknown = { exit_code: 0, stdout: "tests passed" }): string {
  return JSON.stringify({
    hook_event_name: "PostToolUse",
    session_id: "session-1",
    turn_id: "turn-1",
    cwd: process.cwd(),
    transcript_path: null,
    model: "gpt-5-codex",
    permission_mode: "default",
    tool_name: "Bash",
    tool_input: { command: "pnpm test" },
    tool_response: toolResponse,
  })
}

test("user-prompt-submit emits additionalContext", async () => {
  const engine = engineInTemp()
  engine.save({ text: "This repo runs tests with pnpm test", category: "project", scopeType: "global", status: "approved" })
  const output = await runCodexHookCommand("user-prompt-submit", {
    engine,
    payloadText: userPromptPayload(),
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
    payloadText: userPromptPayload(),
  })
  assert.equal(output, "{}")
})

test("stop reads latest turn from transcript", async () => {
  const engine = engineInTemp()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-codex-transcript-"))
  const transcriptPath = path.join(dir, "transcript.jsonl")
  fs.writeFileSync(transcriptPath, [
    JSON.stringify({ role: "user", content: "hello" }),
    JSON.stringify({ role: "assistant", content: "hello back" }),
    JSON.stringify({ role: "user", content: "remember that Codex transcript tests use jsonl" }),
    JSON.stringify({ role: "assistant", content: "I'll remember that Codex transcript tests use jsonl." }),
  ].join("\n"))

  await runCodexHookCommand("stop", {
    engine,
    payloadText: JSON.stringify({
      hook_event_name: "Stop",
      session_id: "session-1",
      turn_id: "turn-1",
      cwd: process.cwd(),
      transcript_path: transcriptPath,
      permission_mode: "default",
      stop_hook_active: false,
    }),
  })

  const saved = engine.list({ all: true })
  assert.equal(saved.length, 1)
  assert.match(saved[0].text, /Codex transcript tests use jsonl/)
  assert.equal(saved[0].provenance?.adapter, "codex")
  assert.equal(saved[0].provenance?.lifecycleEvent, "turn_stop")
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

test("debug-enabled hook writes one JSONL record with safe counts", async () => {
  const logPath = debugLogPath()
  await runCodexHookCommand("post-tool-use", {
    engine: engineInTemp(),
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    hookDebugLogPath: logPath,
    payloadText: postToolUsePayload(),
  })

  const records = readDebugRecords(logPath)

  assert.equal(records.length, 1)
  assert.equal(records[0].adapter, "codex")
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
  await runCodexHookCommand("user-prompt-submit", {
    engine: engineInTemp(),
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    hookDebugLogPath: logPath,
    payloadText: "{not json",
  })

  const records = readDebugRecords(logPath)

  assert.equal(records.length, 1)
  assert.equal(records[0].adapter, "codex")
  assert.equal(records[0].event, "user-prompt-submit")
  assert.equal(records[0].status, "noop")
  assert.equal(records[0].reason, "invalid JSON payload")
  assert.equal(typeof records[0].durationMs, "number")
})

test("handler exception debug hook writes error log record", async () => {
  const engine = engineInTemp()
  ;(engine as unknown as { recall: () => Promise<never> }).recall = async () => { throw new Error("PRIVATE_ERROR_DETAIL") }
  const logPath = debugLogPath()

  await runCodexHookCommand("user-prompt-submit", {
    engine,
    env: { MEMORY_LANE_HOOK_DEBUG: "true" } as NodeJS.ProcessEnv,
    hookDebugLogPath: logPath,
    payloadText: userPromptPayload("PROMPT_TEXT_NOT_IN_LOG"),
  })

  const logText = fs.readFileSync(logPath, "utf8")
  const records = readDebugRecords(logPath)

  assert.equal(records.length, 1)
  assert.equal(records[0].adapter, "codex")
  assert.equal(records[0].event, "user-prompt-submit")
  assert.equal(records[0].status, "error")
  assert.equal(records[0].reason, "hook handling failed")
  assert.doesNotMatch(logText, /PRIVATE_ERROR_DETAIL|PROMPT_TEXT_NOT_IN_LOG/)
})

test("debug-disabled hook writes no log record", async () => {
  const logPath = debugLogPath()
  await runCodexHookCommand("post-tool-use", {
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

  await runCodexHookCommand("user-prompt-submit", {
    engine,
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    hookDebugLogPath: logPath,
    payloadText: userPromptPayload(promptText),
  })

  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-codex-debug-transcript-"))
  const transcriptPath = path.join(transcriptDir, "transcript.jsonl")
  fs.writeFileSync(transcriptPath, [
    JSON.stringify({ role: "user", content: transcriptUserText }),
    JSON.stringify({ role: "assistant", content: transcriptAssistantText }),
  ].join("\n"), "utf8")
  await runCodexHookCommand("stop", {
    engine,
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    hookDebugLogPath: logPath,
    payloadText: JSON.stringify({
      hook_event_name: "Stop",
      session_id: "session-1",
      turn_id: "turn-1",
      cwd: process.cwd(),
      transcript_path: transcriptPath,
      permission_mode: "default",
      stop_hook_active: false,
    }),
  })

  await runCodexHookCommand("post-tool-use", {
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

test("session-start emits baseline additionalContext", async () => {
  const engine = engineInTemp()
  engine.save({ text: "This repo runs tests with pnpm test", category: "project", scopeType: "global", status: "approved" })
  const output = await runCodexHookCommand("session-start", {
    engine,
    payloadText: JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "session-1",
      cwd: process.cwd(),
      transcript_path: null,
      model: "gpt-5-codex",
      permission_mode: "default",
    }),
  })
  const parsed = JSON.parse(output)
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart")
  assert.match(parsed.hookSpecificOutput.additionalContext, /Relevant Memory/)
})
