import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import { MemoryEngine } from "@memory-lane/core"
import { runClaudeHookCommand } from "../src/runner.ts"

function engineInTemp(): MemoryEngine {
  return engineWithConfigInTemp().engine
}

function engineWithConfigInTemp(): { engine: MemoryEngine; configPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-claude-"))
  const configPath = path.join(dir, "config.json")
  return {
    engine: new MemoryEngine({
      memoryPath: path.join(dir, "memory.jsonl"),
      embeddingsPath: path.join(dir, "embeddings.jsonl"),
      configPath,
    }),
    configPath,
  }
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

function stopPayload(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: "Stop",
    session_id: "session-1",
    cwd: process.cwd(),
    transcript_path: null,
    permission_mode: "default",
    last_user_message: "remember that this repo uses pnpm",
    last_assistant_message: "I'll remember that this repo uses pnpm.",
    ...fields,
  })
}

function postToolUsePayload(
  toolResponse: unknown = { exit_code: 0, stdout: "pass" },
  toolInput: unknown = { command: "pnpm test" },
): string {
  return JSON.stringify({
    hook_event_name: "PostToolUse",
    session_id: "session-1",
    cwd: process.cwd(),
    transcript_path: null,
    permission_mode: "default",
    tool_name: "Bash",
    tool_input: toolInput,
    tool_response: toolResponse,
  })
}

function sessionStartPayload(): string {
  return JSON.stringify({
    hook_event_name: "SessionStart",
    session_id: "session-1",
    cwd: process.cwd(),
    transcript_path: null,
    permission_mode: "default",
    source: "startup",
    model: "claude-sonnet-4-6",
  })
}

async function withMockSummaryProvider<T>(summary: string, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = http.createServer((req, res) => {
    req.resume()
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ choices: [{ message: { content: summary } }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.equal(typeof address, "object")
  assert.ok(address)
  const baseUrl = `http://127.0.0.1:${address.port}/v1`
  try {
    return await fn(baseUrl)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function sessionEndPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: "SessionEnd",
    session_id: "session-1",
    cwd: process.cwd(),
    transcript_path: null,
    permission_mode: "default",
    messages: [
      { role: "user", content: "RAW_USER_SENTINEL remember this session" },
      { role: "assistant", content: "RAW_ASSISTANT_SENTINEL I will summarize it." },
      { role: "tool", content: "RAW_TOOL_SENTINEL", toolName: "Bash" },
    ],
    ...overrides,
  })
}

function preCompactPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: "PreCompact",
    session_id: "session-1",
    turn_id: "turn-1",
    cwd: process.cwd(),
    transcript_path: null,
    permission_mode: "default",
    trigger: "auto",
    messages: [
      { role: "user", content: "RAW_PRECOMPACT_USER" },
      { role: "assistant", content: "Durable pre-compact outcome." },
    ],
    ...overrides,
  })
}

test("session-start emits Claude additionalContext output", async () => {
  const engine = engineInTemp()
  engine.save({ text: "User likes concise replies", category: "preference", scopeType: "global", status: "approved", kind: "preference" })

  const output = await runClaudeHookCommand("session-start", {
    engine,
    payloadText: sessionStartPayload(),
  })

  const parsed = JSON.parse(output)
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart")
  assert.match(parsed.hookSpecificOutput.additionalContext, /<memory-context mode="selective" event="sessionStart">/)
  assert.match(parsed.hookSpecificOutput.additionalContext, /### Global preferences and workflow rules/u)
  assert.match(parsed.hookSpecificOutput.additionalContext, /\*\*Preference\*\*/u)
})

test("user-prompt-submit emits Claude additionalContext output", async () => {
  const engine = engineInTemp()
  engine.save({ text: "User likes concise replies", category: "preference", scopeType: "global", status: "approved", kind: "preference" })

  const output = await runClaudeHookCommand("user-prompt-submit", {
    engine,
    payloadText: userPromptPayload("concise replies"),
  })

  const parsed = JSON.parse(output)
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit")
  assert.match(parsed.hookSpecificOutput.additionalContext, /<memory-context mode="selective" event="prompt">/)
  assert.match(parsed.hookSpecificOutput.additionalContext, /### Global preferences and workflow rules/u)
  assert.match(parsed.hookSpecificOutput.additionalContext, /User likes concise replies/u)
})

test("user-prompt-submit routes natural next-item scope prompt to continuity guidance", async () => {
  const engine = engineInTemp()
  engine.save({ text: "STALE NEXT ITEM BODY should not be recalled", category: "project", scopeType: "project", status: "approved", kind: "project_fact" })
  engine.recall = async () => {
    throw new Error("Claude broad next-action prompts should not run ordinary recall")
  }

  const output = await runClaudeHookCommand("user-prompt-submit", {
    engine,
    payloadText: userPromptPayload("what's the next item we should work on and what's its scope?"),
  })

  const parsed = JSON.parse(output)
  assert.match(parsed.hookSpecificOutput.additionalContext, /Memory Lane continuity guidance/u)
  assert.match(parsed.hookSpecificOutput.additionalContext, /memory-lane continuity --json/u)
  assert.doesNotMatch(parsed.hookSpecificOutput.additionalContext, /## Relevant Memory/u)
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

test("stop shows pending review notice without debug when pending memory is saved", async () => {
  const engine = engineInTemp()

  const output = await runClaudeHookCommand("stop", {
    engine,
    env: {} as NodeJS.ProcessEnv,
    payloadText: stopPayload({
      last_user_message: "I prefer review-first memory suggestions in Claude hooks",
      last_assistant_message: "Understood.",
    }),
  })

  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /Memory Lane: suggested 1 pending memory for review/u)
  assert.match(parsed.systemMessage, /memory-lane review/u)
  assert.match(parsed.systemMessage, /approve or reject it/u)
  assert.doesNotMatch(parsed.systemMessage, /review-first memory suggestions|PRIVATE|secret-id/u)
})

test("stop shows pending review notice for checkpoint capture without leaking checkpoint text", async () => {
  const engine = engineInTemp()

  const output = await runClaudeHookCommand("stop", {
    engine,
    env: {} as NodeJS.ProcessEnv,
    payloadText: stopPayload({
      last_user_message: "Released v0.2.12 and verified the release workflow.",
      last_assistant_message: "Done.",
    }),
  })

  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /Memory Lane: suggested 1 pending memory for review/u)
  assert.match(parsed.systemMessage, /memory-lane review/u)
  assert.doesNotMatch(parsed.systemMessage, /v0\.2\.12|release workflow/u)

  const saved = engine.list({ all: true })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].status, "pending")
  assert.equal(saved[0].kind, "project_checkpoint")
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

test("post-tool-use remains quiet without debug when only approved memory is saved", async () => {
  const engine = engineInTemp()

  const output = await runClaudeHookCommand("post-tool-use", {
    engine,
    env: {} as NodeJS.ProcessEnv,
    payloadText: postToolUsePayload(),
  })

  assert.equal(output, "{}")
  const saved = engine.list({ all: true })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].status, "approved")
})

test("session-end returns no-op when summarization is disabled", async () => {
  const { engine, configPath } = engineWithConfigInTemp()

  const output = await runClaudeHookCommand("session-end", {
    engine,
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    configPath,
    payloadText: sessionEndPayload({ confirmed: true }),
  })

  assert.match(JSON.parse(output).systemMessage, /Session-end summarization is not enabled/)
  assert.equal(engine.list({ all: true }).length, 0)
})

test("session-end reports missing provider config before asking for confirmation", async () => {
  const { engine, configPath } = engineWithConfigInTemp()
  fs.writeFileSync(configPath, JSON.stringify({ memory: { sessionEndSummary: { enabled: true } } }), "utf8")

  const output = await runClaudeHookCommand("session-end", {
    engine,
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    configPath,
    payloadText: sessionEndPayload(),
  })

  assert.match(JSON.parse(output).systemMessage, /requires memory\.sessionEndSummary\.baseUrl and model/)
  assert.equal(engine.list({ all: true }).length, 0)
})

test("session-end asks for confirmation without saving when required", async () => {
  await withMockSummaryProvider("## Session Summary\n\nSHOULD_NOT_SAVE", async (baseUrl) => {
    const { engine, configPath } = engineWithConfigInTemp()
    fs.writeFileSync(configPath, JSON.stringify({
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-model", requireConfirmation: true } },
    }), "utf8")

    const output = await runClaudeHookCommand("session-end", {
      engine,
      env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
      configPath,
      payloadText: sessionEndPayload(),
    })

    assert.match(JSON.parse(output).systemMessage, /requires confirmation/)
    assert.equal(engine.list({ all: true }).length, 0)
  })
})

test("session-end saves confirmed provider summary without raw transcript", async () => {
  await withMockSummaryProvider("## Session Summary\n\nSanitized Claude summary", async (baseUrl) => {
    const { engine, configPath } = engineWithConfigInTemp()
    fs.writeFileSync(configPath, JSON.stringify({
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-model", requireConfirmation: true } },
    }), "utf8")

    const output = await runClaudeHookCommand("session-end", {
      engine,
      env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
      configPath,
      payloadText: sessionEndPayload({ confirmed: true }),
    })

    const parsed = JSON.parse(output)
    assert.match(parsed.systemMessage, /suggested 1 pending memory for review/u)
    assert.match(parsed.systemMessage, /memory-lane review/u)
    const saved = engine.list({ all: true })
    assert.equal(saved.length, 1)
    assert.equal(saved[0].status, "pending")
    assert.equal(saved[0].source, "session-summary")
    assert.equal(saved[0].kind, "session_summary")
    assert.equal(saved[0].provenance?.adapter, "claude")
    assert.equal(saved[0].provenance?.lifecycleEvent, "session_end")
    assert.match(saved[0].text, /Sanitized Claude summary/)
    assert.doesNotMatch(saved[0].text, /RAW_USER_SENTINEL|RAW_ASSISTANT_SENTINEL|RAW_TOOL_SENTINEL/)
  })
})

test("pre-compact auto trigger with missing provider remains quiet", async () => {
  const { engine, configPath } = engineWithConfigInTemp()
  fs.writeFileSync(configPath, JSON.stringify({
    memory: { sessionEndSummary: { enabled: true, model: "mock-model" } },
  }), "utf8")

  const output = await runClaudeHookCommand("pre-compact", {
    engine,
    configPath,
    payloadText: preCompactPayload(),
  })

  assert.equal(output, "{}")
  assert.equal(engine.list({ all: true }).length, 0)
})

test("pre-compact does not summarize when confirmation is required", async () => {
  await withMockSummaryProvider("- Decisions made: SHOULD_NOT_SAVE.", async (baseUrl) => {
    const { engine, configPath } = engineWithConfigInTemp()
    fs.writeFileSync(configPath, JSON.stringify({
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-model", requireConfirmation: true } },
    }), "utf8")

    const output = await runClaudeHookCommand("pre-compact", {
      engine,
      env: {} as NodeJS.ProcessEnv,
      configPath,
      payloadText: preCompactPayload(),
    })

    assert.equal(output, "{}")
    assert.equal(engine.list({ all: true }).length, 0)
  })
})

test("pre-compact saves pending provider summary without raw transcript", async () => {
  await withMockSummaryProvider("- Decisions made: preserve Claude compaction continuity.", async (baseUrl) => {
    const { engine, configPath } = engineWithConfigInTemp()
    fs.writeFileSync(configPath, JSON.stringify({
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-model", requireConfirmation: false } },
    }), "utf8")

    const output = await runClaudeHookCommand("pre-compact", {
      engine,
      env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
      configPath,
      payloadText: preCompactPayload(),
    })

    const parsed = JSON.parse(output)
    assert.match(parsed.systemMessage, /suggested 1 pending memory for review/u)
    const saved = engine.list({ all: true })
    assert.equal(saved.length, 1)
    assert.equal(saved[0].status, "pending")
    assert.equal(saved[0].source, "session-summary")
    assert.equal(saved[0].kind, "session_summary")
    assert.equal(saved[0].provenance?.adapter, "claude")
    assert.equal(saved[0].provenance?.lifecycleEvent, "pre_compact")
    assert.equal(saved[0].provenance?.turnId, "turn-1")
    assert.match(saved[0].text, /preserve Claude compaction continuity/u)
    assert.doesNotMatch(saved[0].text, /RAW_PRECOMPACT_USER/u)
  })
})

test("session-end no-durable provider result remains quiet without debug", async () => {
  await withMockSummaryProvider("NO_DURABLE_MEMORY", async (baseUrl) => {
    const { engine, configPath } = engineWithConfigInTemp()
    fs.writeFileSync(configPath, JSON.stringify({
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-model", requireConfirmation: false } },
    }), "utf8")

    const output = await runClaudeHookCommand("session-end", {
      engine,
      env: {} as NodeJS.ProcessEnv,
      configPath,
      payloadText: sessionEndPayload({ confirmed: true }),
    })

    assert.equal(output, "{}")
    assert.equal(engine.list({ all: true }).length, 0)
  })
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

test("debug-enabled user-prompt logs safe context decision fields", async () => {
  const logPath = debugLogPath()
  const engine = engineInTemp()
  engine.save({ text: "This repo runs tests with pnpm test", category: "project", scopeType: "global", status: "approved" })

  await runClaudeHookCommand("user-prompt-submit", {
    engine,
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    hookDebugLogPath: logPath,
    payloadText: userPromptPayload(),
  })

  const logText = fs.readFileSync(logPath, "utf8")
  const records = readDebugRecords(logPath)

  assert.equal(records.length, 1)
  assert.equal(records[0].contextPolicyMode, "selective")
  assert.equal(records[0].contextEvent, "prompt")
  assert.equal(records[0].contextSelected, 1)
  assert.equal(records[0].contextOmitted, 0)
  assert.equal(records[0].contextMaxItems, 6)
  assert.equal(records[0].contextMaxChars, 3000)
  assert.deepEqual(records[0].contextOmittedReasons, [])
  assert.doesNotMatch(logText, /This repo runs tests with pnpm test/u)
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
