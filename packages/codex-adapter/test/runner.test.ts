import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import { MemoryEngine, writeConfig } from "@memory-lane/core"
import { runCodexHookCommand } from "../src/runner.ts"

function engineInTemp(): MemoryEngine {
  return engineFixture().engine
}

function engineFixture(): { engine: MemoryEngine; configPath: string; memoryPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-codex-"))
  const memoryPath = path.join(dir, "memory.jsonl")
  const configPath = path.join(dir, "config.json")
  return {
    engine: new MemoryEngine({
      memoryPath,
      embeddingsPath: path.join(dir, "embeddings.jsonl"),
      configPath,
    }),
    configPath,
    memoryPath,
  }
}

function stopPayload(fields: Record<string, unknown> = {}): string {
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
    ...fields,
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

function postToolUsePayload(
  toolResponse: unknown = { exit_code: 0, stdout: "tests passed" },
  toolInput: unknown = { command: "pnpm test" },
): string {
  return JSON.stringify({
    hook_event_name: "PostToolUse",
    session_id: "session-1",
    turn_id: "turn-1",
    cwd: process.cwd(),
    transcript_path: null,
    model: "gpt-5-codex",
    permission_mode: "default",
    tool_name: "Bash",
    tool_input: toolInput,
    tool_response: toolResponse,
  })
}

function sessionEndPayload(confirmed?: boolean): string {
  return JSON.stringify({
    hook_event_name: "SessionEnd",
    session_id: "session-1",
    cwd: process.cwd(),
    transcript_path: null,
    model: "gpt-5-codex",
    confirmed,
    messages: [
      { role: "user", content: "RAW_TRANSCRIPT_SHOULD_NOT_BE_SAVED" },
      { role: "assistant", content: "I will summarize the durable outcome." },
    ],
  })
}

async function withMockSummaryServer<T>(summary: string, fn: (baseUrl: string, requests: unknown[]) => Promise<T>): Promise<T> {
  const requests: unknown[] = []
  const server = http.createServer((req, res) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      requests.push(JSON.parse(body))
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ choices: [{ message: { content: summary } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  try {
    return await fn(`http://127.0.0.1:${address.port}/v1`, requests)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function enableSessionEndSummary(configPath: string, baseUrl: string, requireConfirmation = true): void {
  writeConfig(configPath, {
    memory: {
      sessionEndSummary: {
        enabled: true,
        provider: "openai-compatible",
        baseUrl,
        model: "summary-model",
        requireConfirmation,
        includeToolOutputs: false,
        maxTokens: 200,
      },
    },
  } as any)
}

test("user-prompt-submit emits additionalContext", async () => {
  const engine = engineInTemp()
  engine.save({ text: "User likes concise replies", category: "preference", scopeType: "global", status: "approved", kind: "preference" })
  const output = await runCodexHookCommand("user-prompt-submit", {
    engine,
    payloadText: userPromptPayload("concise replies"),
  })
  const parsed = JSON.parse(output)
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit")
  assert.match(parsed.hookSpecificOutput.additionalContext, /<memory-context mode="selective" event="prompt">/)
  assert.match(parsed.hookSpecificOutput.additionalContext, /### Global preferences and workflow rules/u)
  assert.match(parsed.hookSpecificOutput.additionalContext, /User likes concise replies/u)
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

test("session-end returns no-op when summarization is disabled", async () => {
  const { engine, configPath } = engineFixture()
  const output = await runCodexHookCommand("session-end", {
    engine,
    configPath,
    payloadText: sessionEndPayload(true),
  })
  assert.equal(output, "{}")
  assert.equal(engine.list({ all: true }).length, 0)
})

test("session-end asks for confirmation without saving when required", async () => {
  const { engine, configPath } = engineFixture()
  enableSessionEndSummary(configPath, "http://127.0.0.1:1/v1", true)
  const output = await runCodexHookCommand("session-end", {
    engine,
    configPath,
    payloadText: sessionEndPayload(false),
  })
  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /requires confirmation/i)
  assert.match(parsed.systemMessage, /confirmed: true/i)
  assert.equal(engine.list({ all: true }).length, 0)
})

test("session-end reports missing provider config before asking for confirmation", async () => {
  const { engine, configPath } = engineFixture()
  writeConfig(configPath, {
    memory: {
      sessionEndSummary: {
        enabled: true,
        provider: "openai-compatible",
        model: "summary-model",
        requireConfirmation: true,
      },
    },
  } as any)
  const output = await runCodexHookCommand("session-end", {
    engine,
    configPath,
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    payloadText: sessionEndPayload(false),
  })
  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /requires memory\.sessionEndSummary\.baseUrl and model/i)
  assert.doesNotMatch(parsed.systemMessage, /requires confirmation/i)
  assert.equal(engine.list({ all: true }).length, 0)
})

test("session-end saves confirmed provider summary without raw transcript", async () => {
  await withMockSummaryServer("- Decisions made: use pnpm.", async (baseUrl, requests) => {
    const { engine, configPath, memoryPath } = engineFixture()
    enableSessionEndSummary(configPath, baseUrl, true)

    const output = await runCodexHookCommand("session-end", {
      engine,
      configPath,
      env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
      payloadText: sessionEndPayload(true),
    })

    const parsed = JSON.parse(output)
    assert.match(parsed.systemMessage, /suggested 1 pending memory for review/u)
    assert.match(parsed.systemMessage, /memory-lane review/u)
    assert.equal(requests.length, 1)
    const saved = engine.list({ all: true })
    assert.equal(saved.length, 1)
    assert.equal(saved[0].status, "pending")
    assert.equal(saved[0].source, "session-summary")
    assert.equal(saved[0].kind, "session_summary")
    assert.equal(saved[0].provenance?.adapter, "codex")
    assert.equal(saved[0].provenance?.lifecycleEvent, "session_end")
    assert.match(saved[0].text, /use pnpm/)
    assert.doesNotMatch(saved[0].text, /RAW_TRANSCRIPT_SHOULD_NOT_BE_SAVED/)
    assert.doesNotMatch(fs.readFileSync(memoryPath, "utf8"), /RAW_TRANSCRIPT_SHOULD_NOT_BE_SAVED/)
  })
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

test("stop without session-summary intent preserves autosave behavior", async () => {
  const engine = engineInTemp()
  const output = await runCodexHookCommand("stop", {
    engine,
    payloadText: stopPayload({
      last_user_message: "remember that Codex Stop autosave still saves explicit memory facts",
      last_assistant_message: "Got it.",
    }),
  })

  assert.equal(output, "{}")
  const saved = engine.list({ all: true })
  assert.equal(saved.length, 1)
  assert.match(saved[0].text, /Codex Stop autosave still saves explicit memory facts/)
  assert.equal(saved[0].source, "user-suggested")
  assert.equal(saved[0].provenance?.lifecycleEvent, "turn_stop")
})

test("stop shows pending review notice without debug when pending memory is saved", async () => {
  const engine = engineInTemp()

  const output = await runCodexHookCommand("stop", {
    engine,
    env: {} as NodeJS.ProcessEnv,
    payloadText: stopPayload({
      last_user_message: "I prefer Codex hooks to surface pending review suggestions",
      last_assistant_message: "Understood.",
    }),
  })

  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /Memory Lane: suggested 1 pending memory for review/u)
  assert.match(parsed.systemMessage, /memory-lane review/u)
  assert.match(parsed.systemMessage, /approve or reject it/u)
  assert.doesNotMatch(parsed.systemMessage, /Codex hooks to surface|secret-id/u)
})

test("stop shows pending review notice for checkpoint capture without leaking checkpoint text", async () => {
  const engine = engineInTemp()

  const output = await runCodexHookCommand("stop", {
    engine,
    env: {} as NodeJS.ProcessEnv,
    payloadText: stopPayload({
      last_user_message: "PR #19 merged after review.",
      last_assistant_message: "Done.",
    }),
  })

  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /Memory Lane: suggested 1 pending memory for review/u)
  assert.match(parsed.systemMessage, /memory-lane review/u)
  assert.doesNotMatch(parsed.systemMessage, /PR #19|merged after review/u)

  const saved = engine.list({ all: true })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].status, "pending")
  assert.equal(saved[0].kind, "project_checkpoint")
  assert.equal(saved[0].provenance?.adapter, "codex")
  assert.equal(saved[0].provenance?.lifecycleEvent, "turn_stop")
})

test("post-tool-use shows pending review notice for pending tool outcome", async () => {
  const engine = engineInTemp()

  const output = await runCodexHookCommand("post-tool-use", {
    engine,
    env: {} as NodeJS.ProcessEnv,
    payloadText: postToolUsePayload(
      { output: "pnpm-lock.yaml exists; npm install would update package-lock", exit_code: 1 },
      { command: "npm install left-pad" },
    ),
  })

  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /Memory Lane: suggested 1 pending memory for review/u)
  assert.match(parsed.systemMessage, /memory-lane review/u)
  assert.doesNotMatch(parsed.systemMessage, /pnpm-lock|left-pad|package-lock/u)
})

test("stop session-summary intent does not trigger from assistant text", async () => {
  const { engine, configPath } = engineFixture()
  enableSessionEndSummary(configPath, "http://127.0.0.1:1/v1", true)
  const output = await runCodexHookCommand("stop", {
    engine,
    configPath,
    payloadText: stopPayload({
      last_user_message: "thanks",
      last_assistant_message: "I can remember this session if asked.",
    }),
  })

  assert.equal(output, "{}")
  assert.equal(engine.list({ all: true }).length, 0)
})

test("stop session-summary intent returns disabled no-save message", async () => {
  const { engine, configPath } = engineFixture()
  const output = await runCodexHookCommand("stop", {
    engine,
    configPath,
    payloadText: stopPayload({
      last_user_message: "please remember this session",
      last_assistant_message: "I will save a summary.",
    }),
  })

  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /Session summary was requested/i)
  assert.match(parsed.systemMessage, /not enabled/i)
  assert.equal(engine.list({ all: true }).length, 0)
})

test("stop session-summary intent reports missing provider without saving", async () => {
  const { engine, configPath } = engineFixture()
  writeConfig(configPath, {
    memory: {
      sessionEndSummary: {
        enabled: true,
        provider: "openai-compatible",
        model: "summary-model",
        requireConfirmation: true,
      },
    },
  } as any)

  const output = await runCodexHookCommand("stop", {
    engine,
    configPath,
    payloadText: stopPayload({ last_user_message: "save a session summary" }),
  })

  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /requires memory\.sessionEndSummary\.baseUrl and model/i)
  assert.equal(engine.list({ all: true }).length, 0)
})

test("stop session-summary intent saves provider summary without raw transcript", async () => {
  await withMockSummaryServer("- Decisions made: keep Codex summaries explicit.", async (baseUrl, requests) => {
    const { engine, configPath, memoryPath } = engineFixture()
    enableSessionEndSummary(configPath, baseUrl, true)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-codex-session-summary-"))
    const transcriptPath = path.join(dir, "transcript.jsonl")
    fs.writeFileSync(transcriptPath, [
      JSON.stringify({ role: "user", content: "We decided Codex summaries require explicit intent." }),
      JSON.stringify({ role: "assistant", content: "RAW_TRANSCRIPT_MARKER_SHOULD_NOT_BE_SAVED" }),
      JSON.stringify({ role: "user", content: "summarize this session to memory" }),
      JSON.stringify({ role: "assistant", content: "I'll create a concise summary." }),
    ].join("\n"), "utf8")

    const output = await runCodexHookCommand("stop", {
      engine,
      configPath,
      payloadText: stopPayload({
        transcript_path: transcriptPath,
        last_assistant_message: undefined,
      }),
    })

    const parsed = JSON.parse(output)
    assert.match(parsed.systemMessage, /suggested 1 pending memory for review/u)
    assert.match(parsed.systemMessage, /memory-lane review/u)
    assert.equal(requests.length, 1)
    const saved = engine.list({ all: true })
    assert.equal(saved.length, 1)
    assert.equal(saved[0].status, "pending")
    assert.equal(saved[0].source, "session-summary")
    assert.equal(saved[0].kind, "session_summary")
    assert.equal(saved[0].provenance?.adapter, "codex")
    assert.equal(saved[0].provenance?.lifecycleEvent, "session_end")
    assert.match(saved[0].text, /Codex summaries explicit/)
    assert.doesNotMatch(saved[0].text, /RAW_TRANSCRIPT_MARKER_SHOULD_NOT_BE_SAVED/)
    assert.doesNotMatch(fs.readFileSync(memoryPath, "utf8"), /RAW_TRANSCRIPT_MARKER_SHOULD_NOT_BE_SAVED/)
  })
})

test("stop session-summary duplicate remains quiet without saving another memory", async () => {
  await withMockSummaryServer("- Decisions made: keep Codex summaries explicit.", async (baseUrl, requests) => {
    const { engine, configPath } = engineFixture()
    enableSessionEndSummary(configPath, baseUrl, false)
    engine.save({
      text: "## Session Summary (2026-06-20)\n\n- Decisions made: keep Codex summaries explicit.",
      category: "project",
      scopeType: "project",
      status: "pending",
      source: "session-summary",
      kind: "session_summary",
      provenance: { adapter: "codex", lifecycleEvent: "session_end", sessionId: "s" },
    })

    const output = await runCodexHookCommand("stop", {
      engine,
      configPath,
      env: {} as NodeJS.ProcessEnv,
      payloadText: stopPayload({ last_user_message: "summarize this session to memory" }),
    })

    assert.equal(output, "{}")
    assert.equal(requests.length, 1)
    const saved = engine.list({ all: true })
    assert.equal(saved.length, 1)
    assert.equal(saved[0].provenance?.sessionId, "s")
  })
})

test("stop session-summary no-durable provider result remains quiet without debug", async () => {
  await withMockSummaryServer("NO_DURABLE_MEMORY", async (baseUrl) => {
    const { engine, configPath } = engineFixture()
    enableSessionEndSummary(configPath, baseUrl, false)

    const output = await runCodexHookCommand("stop", {
      engine,
      configPath,
      env: {} as NodeJS.ProcessEnv,
      payloadText: stopPayload({ last_user_message: "summarize this session to memory" }),
    })

    assert.equal(output, "{}")
    assert.equal(engine.list({ all: true }).length, 0)
  })
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

test("debug-enabled user-prompt logs safe context decision fields", async () => {
  const logPath = debugLogPath()
  const engine = engineInTemp()
  engine.save({ text: "This repo runs tests with pnpm test", category: "project", scopeType: "global", status: "approved" })

  await runCodexHookCommand("user-prompt-submit", {
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
  engine.save({ text: "User likes concise replies", category: "preference", scopeType: "global", status: "approved", kind: "preference" })
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
  assert.match(parsed.hookSpecificOutput.additionalContext, /<memory-context mode="selective" event="sessionStart">/)
  assert.match(parsed.hookSpecificOutput.additionalContext, /### Global preferences and workflow rules/u)
  assert.match(parsed.hookSpecificOutput.additionalContext, /\*\*Preference\*\*/u)
})
