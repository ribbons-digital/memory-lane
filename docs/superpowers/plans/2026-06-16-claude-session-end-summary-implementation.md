# Claude Session-End Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `memory-lane claude session-end` support for Claude Code's documented `SessionEnd` hook, saving confirmed/generated summaries as pending `session_summary` memories.

**Architecture:** Extend the existing Claude adapter in the same pattern as Codex's session-end path, but only for Claude's documented `SessionEnd` event. Parsing converts Claude hook JSON into shared `SessionEndInput`; the runner gates on opt-in config and confirmation before calling `handleSessionEnd`; CLI/docs expose only the Claude hook, while Codex docs continue warning against unsupported `SessionEnd`.

**Tech Stack:** TypeScript monorepo, Node test runner, `@memory-lane/core`, `@memory-lane/lifecycle`, `@memory-lane/claude-adapter`, `@memory-lane/cli`, pnpm.

---

## File Map

- `packages/claude-adapter/src/payloads.ts`: add `session-end` command and parse `SessionEnd` payloads.
- `packages/claude-adapter/src/transcript.ts`: add bounded full-session message extraction for fallback transcript input.
- `packages/claude-adapter/src/runner.ts`: add summary provider config loading, confirmation gating, `handleSessionEnd`, pending save, and debug-safe logging.
- `packages/claude-adapter/test/payloads.test.ts`: add parser tests for `SessionEnd`.
- `packages/claude-adapter/test/runner.test.ts`: add disabled, missing-provider, confirmation-required, confirmed-save, and raw-sentinel privacy tests.
- `packages/cli/src/index.ts`: accept `memory-lane claude session-end` and pass `configPath` to the Claude adapter.
- `packages/cli/src/formatters.ts`: update usage text.
- `packages/cli/test/cli.test.ts`: add CLI stdin acceptance test for `claude session-end`.
- `examples/harness-integrations/claude-code.md`: document Claude Code `SessionEnd` hook and confirmation/config caveats.
- `README.md`: update Claude/Codex hook docs boundaries.
- `ROADMAP.md` and `HANDOFF.md`: mark Phase 13 Slice 3 status after implementation.

---

### Task 1: Parse Claude `SessionEnd` Payloads

**Files:**
- Modify: `packages/claude-adapter/src/payloads.ts`
- Modify: `packages/claude-adapter/test/payloads.test.ts`

- [ ] **Step 1: Write the failing parser test**

Add this to `packages/claude-adapter/test/payloads.test.ts`:

```ts
test("parses SessionEnd payload with messages and confirmation", () => {
  const parsed = parseClaudePayload({
    hook_event_name: "SessionEnd",
    session_id: "session-1",
    cwd: "/tmp/memory-lane-fixture",
    transcript_path: "/tmp/transcript.jsonl",
    reason: "clear",
    confirmed: true,
    messages: [
      { role: "user", content: "remember this session" },
      { role: "assistant", content: "I will summarize it." },
      { role: "tool", content: "TOOL_MARKER", toolName: "Bash", timestamp: "2026-06-16T00:00:00.000Z" },
    ],
  })

  assert.equal(parsed.kind, "session-end")
  assert.equal(parsed.kind === "session-end" ? parsed.input.cwd : undefined, "/tmp/memory-lane-fixture")
  assert.equal(parsed.kind === "session-end" ? parsed.input.sessionId : undefined, "session-1")
  assert.equal(parsed.kind === "session-end" ? parsed.input.transcriptPath : undefined, "/tmp/transcript.jsonl")
  assert.equal(parsed.kind === "session-end" ? parsed.confirmed : undefined, true)
  assert.equal(parsed.kind === "session-end" ? parsed.reason : undefined, "clear")
  assert.deepEqual(parsed.kind === "session-end" ? parsed.input.messages : undefined, [
    { role: "user", content: "remember this session" },
    { role: "assistant", content: "I will summarize it." },
    { role: "tool", content: "TOOL_MARKER", toolName: "Bash", timestamp: "2026-06-16T00:00:00.000Z" },
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @memory-lane/claude-adapter test
```

Expected: FAIL because `session-end` is not in `ClaudeCommand` / `ParsedClaudePayload` and `SessionEnd` is unsupported.

- [ ] **Step 3: Implement minimal parser support**

In `packages/claude-adapter/src/payloads.ts`, update imports and types:

```ts
import type { PostToolUseInput, SessionEndInput, SessionMessage, SessionStartInput, StopInput, UserPromptInput } from "@memory-lane/lifecycle"

export type ClaudeCommand = "user-prompt-submit" | "stop" | "post-tool-use" | "session-start" | "session-end"

export type ParsedClaudePayload =
  | { kind: "user-prompt-submit"; hookEventName: "UserPromptSubmit"; input: UserPromptInput }
  | { kind: "stop"; hookEventName: "Stop"; input: StopInput; transcriptPath?: string }
  | { kind: "post-tool-use"; hookEventName: "PostToolUse"; input: PostToolUseInput }
  | { kind: "session-start"; hookEventName: "SessionStart"; input: SessionStartInput }
  | { kind: "session-end"; hookEventName: "SessionEnd"; input: SessionEndInput; confirmed?: boolean; reason?: string }
  | { kind: "invalid"; reason: string }
```

Add helpers after `nullableStringField`:

```ts
function booleanField(obj: Record<string, unknown>, key: string): boolean | undefined {
  return typeof obj[key] === "boolean" ? obj[key] as boolean : undefined
}

function parseSessionMessages(value: unknown): SessionMessage[] {
  if (!Array.isArray(value)) return []
  const messages: SessionMessage[] = []
  for (const item of value) {
    const obj = asRecord(item)
    if (!obj) continue
    const role = stringField(obj, "role")
    const content = stringField(obj, "content")
    if ((role !== "user" && role !== "assistant" && role !== "tool") || !content) continue
    messages.push({
      role,
      content,
      timestamp: stringField(obj, "timestamp"),
      toolName: stringField(obj, "toolName") ?? stringField(obj, "tool_name"),
    })
  }
  return messages
}
```

Add this branch before the final unsupported return:

```ts
if (event === "SessionEnd") {
  return {
    kind: "session-end",
    hookEventName: event,
    input: {
      cwd: context.cwd,
      sessionId: context.sessionId,
      transcriptPath: context.transcriptPath,
      messages: parseSessionMessages(obj.messages),
    },
    confirmed: booleanField(obj, "confirmed"),
    reason: stringField(obj, "reason"),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @memory-lane/claude-adapter test
```

Expected: all Claude adapter tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-adapter/src/payloads.ts packages/claude-adapter/test/payloads.test.ts
git commit -m "feat(claude-adapter): parse SessionEnd payloads"
```

---

### Task 2: Run Claude `SessionEnd` With Confirmation Gating

**Files:**
- Modify: `packages/claude-adapter/src/transcript.ts`
- Modify: `packages/claude-adapter/src/runner.ts`
- Modify: `packages/claude-adapter/test/runner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Add these imports at the top of `packages/claude-adapter/test/runner.test.ts` if missing:

```ts
import * as http from "node:http"
```

Add this helper near existing helpers:

```ts
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
```

Add tests:

```ts
test("session-end returns no-op when summarization is disabled", async () => {
  const output = await runClaudeHookCommand("session-end", {
    engine: engineInTemp(),
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    payloadText: sessionEndPayload({ confirmed: true }),
  })

  assert.match(JSON.parse(output).systemMessage, /Session-end summarization is not enabled/)
})

test("session-end reports missing provider config before asking for confirmation", async () => {
  const engine = engineInTemp()
  fs.writeFileSync(engine.configPath, JSON.stringify({ memory: { sessionEndSummary: { enabled: true } } }), "utf8")

  const output = await runClaudeHookCommand("session-end", {
    engine,
    env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
    configPath: engine.configPath,
    payloadText: sessionEndPayload(),
  })

  assert.match(JSON.parse(output).systemMessage, /requires memory\.sessionEndSummary\.baseUrl and model/)
  assert.equal(engine.list({ all: true }).length, 0)
})

test("session-end asks for confirmation without saving when required", async () => {
  await withMockSummaryProvider("## Session Summary\n\nSHOULD_NOT_SAVE", async (baseUrl) => {
    const engine = engineInTemp()
    fs.writeFileSync(engine.configPath, JSON.stringify({
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-model", requireConfirmation: true } },
    }), "utf8")

    const output = await runClaudeHookCommand("session-end", {
      engine,
      env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
      configPath: engine.configPath,
      payloadText: sessionEndPayload(),
    })

    assert.match(JSON.parse(output).systemMessage, /requires confirmation/)
    assert.equal(engine.list({ all: true }).length, 0)
  })
})

test("session-end saves confirmed provider summary without raw transcript", async () => {
  await withMockSummaryProvider("## Session Summary\n\nSanitized Claude summary", async (baseUrl) => {
    const engine = engineInTemp()
    fs.writeFileSync(engine.configPath, JSON.stringify({
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-model", requireConfirmation: true } },
    }), "utf8")

    const output = await runClaudeHookCommand("session-end", {
      engine,
      env: { MEMORY_LANE_HOOK_DEBUG: "1" } as NodeJS.ProcessEnv,
      configPath: engine.configPath,
      payloadText: sessionEndPayload({ confirmed: true }),
    })

    assert.match(JSON.parse(output).systemMessage, /saved 1, skipped 0, discarded 0/)
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @memory-lane/claude-adapter test
```

Expected: FAIL because `runClaudeHookCommand` has no `session-end` path and no `configPath` option.

- [ ] **Step 3: Add transcript full-session fallback**

In `packages/claude-adapter/src/transcript.ts`, import `SessionMessage` and add `readSessionMessagesFromTranscript`. Keep existing `readLatestTurnFromTranscript` behavior intact.

```ts
import type { SessionMessage } from "@memory-lane/lifecycle"
```

Add after `TranscriptTurn`:

```ts
function sessionMessageRole(role: string): SessionMessage["role"] | undefined {
  if (role.includes("user")) return "user"
  if (role.includes("assistant")) return "assistant"
  if (role.includes("tool")) return "tool"
  return undefined
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  return typeof obj[key] === "string" ? obj[key] as string : undefined
}
```

Refactor bounded file reading into a helper used by both readers:

```ts
function readBoundedTranscriptLines(filePath?: string, maxBytes = DEFAULT_MAX_BYTES): string[] {
  if (!filePath) return []
  try {
    const stat = fs.statSync(filePath)
    const safeMaxBytes = Math.max(0, maxBytes)
    const start = Math.max(0, stat.size - safeMaxBytes)
    const length = stat.size - start
    const fd = fs.openSync(filePath, "r")
    try {
      const buffer = Buffer.alloc(length)
      fs.readSync(fd, buffer, 0, length, start)
      return buffer.toString("utf8").split(/\r?\n/u).filter((line) => line.trim())
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return []
  }
}
```

Then implement:

```ts
export function readSessionMessagesFromTranscript(filePath?: string, maxBytes = DEFAULT_MAX_BYTES): SessionMessage[] {
  const messages: SessionMessage[] = []
  for (const line of readBoundedTranscriptLines(filePath, maxBytes)) {
    try {
      const parsed = JSON.parse(line) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue
      const obj = parsed as Record<string, unknown>
      const role = roleFromObject(obj)
      const messageRole = role ? sessionMessageRole(role) : undefined
      const content = textFromObject(obj)
      if (!messageRole || !content) continue
      messages.push({
        role: messageRole,
        content,
        timestamp: stringField(obj, "timestamp"),
        toolName: stringField(obj, "toolName") ?? stringField(obj, "tool_name"),
      })
    } catch {
      // Transcript formats are best-effort and may contain non-JSON lines.
    }
  }
  return messages
}
```

Update `readLatestTurnFromTranscript` to iterate over `readBoundedTranscriptLines(filePath, maxBytes)` rather than duplicating file reads.

- [ ] **Step 4: Implement runner support**

In `packages/claude-adapter/src/runner.ts`, update imports:

```ts
import {
  appendHookDebugLog, hookDebugEnabled, loadConfig, type HookDebugLogStatus, type MemoryEngine,
} from "@memory-lane/core"
import { createOpenAICompatibleProvider, handlePostToolUse, handleSessionEnd, handleSessionStart, handleStop, handleUserPromptSubmit, type LifecycleResult } from "@memory-lane/lifecycle"
import { readLatestTurnFromTranscript, readSessionMessagesFromTranscript } from "./transcript.js"
```

Add `configPath` to options:

```ts
export interface RunClaudeHookOptions {
  engine: MemoryEngine
  payloadText: string
  env?: NodeJS.ProcessEnv
  hookDebugLogPath?: string
  configPath?: string
}
```

Add helpers near `lifecycleCounts`:

```ts
function systemMessageOutput(message: string): string {
  return JSON.stringify({ systemMessage: `Memory Lane: ${message}` })
}

function createSessionEndSummaryProvider(configPath: string | undefined, env: NodeJS.ProcessEnv | undefined) {
  const config = loadConfig(configPath)
  const summaryConfig = config.memory?.sessionEndSummary
  if (!summaryConfig?.enabled) return { status: "disabled" as const }
  if (!summaryConfig.baseUrl || !summaryConfig.model) return { status: "missing-provider" as const, config: summaryConfig }
  return {
    status: "configured" as const,
    config: summaryConfig,
    provider: createOpenAICompatibleProvider({
      provider: "openai-compatible",
      baseUrl: summaryConfig.baseUrl,
      apiKeyEnv: summaryConfig.apiKeyEnv,
      model: summaryConfig.model,
    }, env),
  }
}

function saveSessionEndCandidates(engine: MemoryEngine, candidates: Awaited<ReturnType<typeof handleSessionEnd>>): LifecycleResult {
  return {
    saved: candidates.map((candidate) => engine.save({
      text: candidate.text,
      category: candidate.category,
      scopeType: candidate.scopeType,
      status: candidate.status,
      source: candidate.source,
      kind: candidate.kind,
      provenance: { ...candidate.provenance, adapter: "claude" },
    })),
    discarded: [],
  }
}
```

Add this branch after `session-start` and before `user-prompt-submit` or after `stop` as long as it is before `post-tool-use` fallback:

```ts
if (parsed.kind === "session-end") {
  const summaryProvider = createSessionEndSummaryProvider(options.configPath, options.env)
  if (summaryProvider.status === "disabled") {
    log("noop", { reason: "session-end summarization disabled" })
    return systemMessageOutput("Session-end summarization is not enabled.")
  }
  if (summaryProvider.status === "missing-provider") {
    log("noop", { reason: "session-end summary provider not configured" })
    return systemMessageOutput("Session-end summarization requires memory.sessionEndSummary.baseUrl and model.")
  }
  const requireConfirmation = summaryProvider.config.requireConfirmation !== false
  if (requireConfirmation && !parsed.confirmed) {
    log("noop", { reason: "session-end confirmation required" })
    return systemMessageOutput("Session-end summarization requires confirmation. Rerun the Claude SessionEnd payload with confirmed: true or set memory.sessionEndSummary.requireConfirmation to false.")
  }
  const transcriptMessages = parsed.input.messages.length ? parsed.input.messages : readSessionMessagesFromTranscript(parsed.input.transcriptPath)
  const candidates = await handleSessionEnd(options.engine, {
    ...parsed.input,
    messages: transcriptMessages,
  }, {
    provider: summaryProvider.provider,
    promptTemplate: summaryProvider.config.promptTemplate ?? undefined,
    maxTokens: summaryProvider.config.maxTokens,
    requireConfirmation: false,
    confirmed: true,
    includeToolOutputs: summaryProvider.config.includeToolOutputs,
  }, options.env)
  const result = saveSessionEndCandidates(options.engine, candidates)
  log("ok", lifecycleCounts(result))
  return lifecycleNoopOutput(result, true)
}
```

Note: `lifecycleNoopOutput(result, true)` gives a concise `systemMessage` even when hook debug is off, useful because this is a confirmation/save command path. If the project prefers silence, use `debug` instead and adjust tests.

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
pnpm --filter @memory-lane/claude-adapter test
```

Expected: all Claude adapter tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/claude-adapter/src/transcript.ts packages/claude-adapter/src/runner.ts packages/claude-adapter/test/runner.test.ts
git commit -m "feat(claude-adapter): summarize sessions from SessionEnd"
```

---

### Task 3: Wire CLI and Documentation

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `examples/harness-integrations/claude-code.md`
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Write failing CLI test**

In `packages/cli/test/cli.test.ts`, add a test near the existing Claude hook CLI tests:

```ts
it("claude session-end accepts hook payload on stdin", () => {
  const env = tempEnv()
  const result = runWithInput(["claude", "session-end"], JSON.stringify({
    hook_event_name: "SessionEnd",
    session_id: "session-1",
    cwd: env.cwd,
    transcript_path: null,
    permission_mode: "default",
    messages: [{ role: "user", content: "remember this session" }],
    confirmed: true,
  }), env)

  assert.equal(result.status, 0)
  assert.match(result.stdout, /\{\}|Memory Lane/u)
})
```

If `tempEnv`/`runWithInput` names differ, use the existing helper names in `cli.test.ts` exactly. Keep the assertion broad because config is disabled by default and the command should no-op rather than save.

- [ ] **Step 2: Run CLI tests to verify failure**

Run:

```bash
pnpm --filter @memory-lane/cli test
```

Expected: FAIL because `claude session-end` is not accepted.

- [ ] **Step 3: Update CLI command set and pass config path**

In `packages/cli/src/index.ts`:

```ts
const claudeHookCommands = new Set<string>(["user-prompt-submit", "stop", "post-tool-use", "session-start", "session-end"])
```

Update the usage error:

```ts
console.log(formatError("Unknown Claude hook event. Usage: memory-lane claude user-prompt-submit|stop|post-tool-use|session-start|session-end", ctx.json))
```

Pass `configPath` to the runner:

```ts
const output = await runClaudeHookCommand(event as ClaudeCommand, {
  engine: ctx.engine,
  payloadText,
  env: process.env,
  configPath: ctx.configPath,
})
```

In `packages/cli/src/formatters.ts`, update usage:

```text
claude <user-prompt-submit|stop|post-tool-use|session-start|session-end>
```

- [ ] **Step 4: Update Claude docs only**

In `examples/harness-integrations/claude-code.md`, add a `SessionEnd` hook block:

```json
"SessionEnd": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "memory-lane claude session-end",
        "timeoutSec": 20,
        "statusMessage": "Summarizing session memory"
      }
    ]
  }
]
```

Add text below the hook JSON:

```md
`SessionEnd` is supported by Claude Code and can generate pending `session_summary` memories when `memory.sessionEndSummary.enabled` is configured. By default, Memory Lane still requires confirmation; a bare hook will not save unless `memory.sessionEndSummary.requireConfirmation` is set to `false` or the payload is invoked with `confirmed: true` for manual testing.
```

In `README.md`, update Claude hook docs with the same boundary and keep Codex text explicitly saying not to configure unsupported Codex `SessionEnd`.

- [ ] **Step 5: Update roadmap and handoff**

In `ROADMAP.md`, under Phase 13, add `Completed Slice 3 scope` after Slice 2:

```md
Completed Slice 3 scope:

1. Added Claude Code `SessionEnd` adapter support through `memory-lane claude session-end`.
2. Kept summarization opt-in and confirmation-gated unless `requireConfirmation: false` is explicitly configured.
3. Saved confirmed summaries as pending `session_summary` memories with Claude provenance.
4. Added parser, runner, CLI, privacy, and docs tests for the Claude path.
```

Move Claude from remaining follow-up scope to completed. Keep pi follow-up.

In `HANDOFF.md`, add a short current-state bullet with the commit hash after implementation.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @memory-lane/cli test
pnpm build
```

Expected: CLI tests and build pass.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/formatters.ts packages/cli/test/cli.test.ts examples/harness-integrations/claude-code.md README.md ROADMAP.md HANDOFF.md
git commit -m "docs(cli): wire Claude session-end command"
```

---

### Task 4: Final Verification and Merge Prep

**Files:**
- Verify all changed files
- No new files expected unless test fixtures are added during implementation

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm build
pnpm test
```

Expected: build succeeds and all tests pass.

- [ ] **Step 2: Run manual disabled-config smoke**

Run:

```bash
echo '{"hook_event_name":"SessionEnd","session_id":"s1","cwd":"'"$(pwd)"'","transcript_path":null,"messages":[{"role":"user","content":"remember this session"}],"confirmed":true}' \
  | MEMORY_LANE_FILE=/tmp/ml-claude-session-end-memory.jsonl \
    MEMORY_LANE_EMBEDDINGS_FILE=/tmp/ml-claude-session-end-embeddings.jsonl \
    node packages/cli/dist/index.js claude session-end
rm -f /tmp/ml-claude-session-end-memory.jsonl /tmp/ml-claude-session-end-embeddings.jsonl
```

Expected: JSON output with `systemMessage` explaining session-end summarization is not enabled. No real memory is touched.

- [ ] **Step 3: Check unsupported Codex docs**

Run:

```bash
rg -n 'SessionEnd|session-end' README.md examples/harness-integrations docs/superpowers/specs packages/cli/src/formatters.ts
```

Expected:

- Claude docs may show `memory-lane claude session-end` and `SessionEnd`.
- Codex docs continue saying Codex does not support `SessionEnd` and must not configure it.
- CLI usage may mention `codex session-end` only as the future-compatible/manual payload path if existing docs already do; do not add `.codex/hooks.json` `SessionEnd` examples.

- [ ] **Step 4: Review diff**

Run:

```bash
git diff --stat HEAD~3..HEAD
git diff HEAD~3..HEAD -- packages/claude-adapter packages/cli README.md examples/harness-integrations/claude-code.md ROADMAP.md HANDOFF.md
```

Expected: diff only covers Slice 3 parser/runner/CLI/docs changes.

- [ ] **Step 5: Merge and push after review approval**

From main checkout:

```bash
cd /Users/shiang/projects/ribbons-digital/memory-lane
git merge --ff-only <slice-3-branch>
pnpm build
pnpm test
GH_TOKEN="$(gh auth token --user ribbons-digital)" git -c credential.helper='!gh auth git-credential' push https://github.com/ribbons-digital/memory-lane.git main
```

Expected: main fast-forwards, verification passes on main, push succeeds.

---

## Self-Review Checklist

- Spec coverage: parser, runner, confirmation, provider config, pending save, privacy, CLI, docs, and verification are covered.
- TDD: each behavior task starts with failing tests before implementation.
- Scope: pi and Phase 14 dashboard/review remain out of scope.
- Codex boundary: plan does not add any real `.codex/hooks.json` `SessionEnd` configuration.
- Risk: exact Claude Code `SessionEnd` payload shape should still be manually captured in a later smoke, but this plan accepts documented/common hook fields and explicit test payloads.
