# pi Session Summary Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit `/memory session-summary` command to the pi adapter that summarizes the current pi session into a pending Memory Lane `session_summary` memory after interactive confirmation.

**Architecture:** Keep the feature inside `@memory-lane/pi-adapter`. The command reuses the existing Memory Lane config/storage resolution, `createOpenAICompatibleProvider`, and lifecycle `handleSessionEnd`; pi-specific code only extracts text from `ctx.sessionManager.getBranch()`, handles pi UI confirmation/notifications, and saves generated candidates with `adapter: "pi"` provenance. No automatic `agent_end`, `session_shutdown`, or compaction event handlers are added.

**Tech Stack:** TypeScript, Node test runner, `@memory-lane/core`, `@memory-lane/lifecycle`, pi extension API shim in `packages/pi-adapter/src/index.ts`.

---

## File map

- Modify `packages/pi-adapter/src/index.ts`
  - Extend the local `ExtensionContext` shim for `ctx.ui.confirm` and `ctx.sessionManager.getBranch`.
  - Add pi session-branch text extraction helpers.
  - Add `runPiSessionSummaryCommand(...)` helper for disabled/missing-provider/confirmation/save behavior.
  - Add `/memory session-summary` handling inside the existing `/memory` command.
- Modify `packages/pi-adapter/test/extension.test.ts`
  - Add fake UI notifications/confirm support.
  - Add fake branch fixtures.
  - Add tests for disabled, missing provider, empty branch, cancellation, confirmed save, and raw-sentinel non-persistence.
- Modify `README.md`
  - Update pi adapter docs to mention `/memory session-summary` and its opt-in/confirmation behavior.
- Modify `skills/memory-lane/SKILL.md`
  - Add the pi command as an explicit session-summary path.
- Modify `ROADMAP.md`
  - Mark Phase 13 pi explicit command slice complete after implementation.
- Modify `HANDOFF.md`
  - Record implementation, verification, and next step.

---

### Task 1: Add failing pi command tests for no-save paths

**Files:**
- Modify: `packages/pi-adapter/test/extension.test.ts`

- [ ] **Step 1: Extend test helpers for notifications, confirmation, and branch data**

Add these helper types/functions near `baseCtx`:

```ts
type FakeNotification = { message: string; level?: "info" | "warning" | "error" }

type FakeBranchEntry = {
  type: string
  message?: {
    role?: string
    content?: unknown
  }
}

function ctxWithUi(cwd: string, options: {
  confirmResult?: boolean
  branch?: FakeBranchEntry[]
  notifications?: FakeNotification[]
} = {}): ExtensionContext {
  const notifications = options.notifications ?? []
  return {
    cwd,
    ui: {
      notify(message: string, level?: "info" | "warning" | "error") {
        notifications.push({ message, level })
      },
      confirm: async () => options.confirmResult ?? false,
    },
    sessionManager: {
      getSessionFile: () => path.join(cwd, ".pi-session.jsonl"),
      getBranch: () => options.branch ?? [],
    },
  }
}

async function runMemoryCommand(pi: FakePi, args: string, ctx: ExtensionContext): Promise<void> {
  const command = pi.commands.get("memory")
  assert.ok(command)
  await command.handler(args, ctx)
}
```

Keep `baseCtx` for existing tests or change it to delegate to `ctxWithUi(cwd)` if that avoids duplication.

- [ ] **Step 2: Add disabled/missing/empty/cancel tests**

Append these tests to `packages/pi-adapter/test/extension.test.ts`:

```ts
test("memory session-summary reports disabled summarization without saving", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, {
    confirmResult: true,
    notifications,
    branch: [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "Summarize this later" }] } },
    ],
  })

  await runMemoryCommand(pi, "session-summary", ctx)

  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
  assert.ok(notifications.some((n) => n.message.includes("Session-end summarization is not enabled")))
})

test("memory session-summary reports missing provider before confirmation", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
    semantic: { enabled: false },
    memory: { sessionEndSummary: { enabled: true, requireConfirmation: false } },
  }))
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  let confirmCalled = false
  const ctx: ExtensionContext = {
    ...ctxWithUi(env.dir, {
      notifications,
      branch: [{ type: "message", message: { role: "user", content: [{ type: "text", text: "Important decision" }] } }],
    }),
    ui: {
      notify(message: string, level?: "info" | "warning" | "error") { notifications.push({ message, level }) },
      confirm: async () => { confirmCalled = true; return true },
    },
  }

  await runMemoryCommand(pi, "session-summary", ctx)

  assert.equal(confirmCalled, false)
  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
  assert.ok(notifications.some((n) => n.message.includes("baseUrl") && n.message.includes("model")))
})

test("memory session-summary reports empty branch without saving", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
    semantic: { enabled: false },
    memory: { sessionEndSummary: { enabled: true, baseUrl: "http://127.0.0.1:9/v1", model: "mock" } },
  }))
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, { confirmResult: true, notifications, branch: [] })

  await runMemoryCommand(pi, "session-summary", ctx)

  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
  assert.ok(notifications.some((n) => n.message.includes("No conversation text found")))
})

test("memory session-summary cancellation saves nothing", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
    semantic: { enabled: false },
    memory: { sessionEndSummary: { enabled: true, baseUrl: "http://127.0.0.1:9/v1", model: "mock" } },
  }))
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, {
    confirmResult: false,
    notifications,
    branch: [{ type: "message", message: { role: "user", content: [{ type: "text", text: "Important decision" }] } }],
  })

  await runMemoryCommand(pi, "session-summary", ctx)

  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
  assert.ok(notifications.some((n) => n.message.includes("cancelled")))
})
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
pnpm --filter @memory-lane/pi-adapter test
```

Expected: FAIL because `ExtensionContext` does not include `confirm`/`getBranch` and `/memory session-summary` is not implemented.

- [ ] **Step 4: Commit failing tests only**

Do not commit failing tests unless the project convention allows red commits. If using subagent-driven development, report the failing output and continue to Task 2 before committing. If committing per task is required by the orchestrator, use:

```bash
git add packages/pi-adapter/test/extension.test.ts
git commit -m "test(pi-adapter): cover session summary no-save paths"
```

---

### Task 2: Implement no-save command behavior

**Files:**
- Modify: `packages/pi-adapter/src/index.ts`

- [ ] **Step 1: Extend pi shims**

Update `ExtensionContext` near the top of `packages/pi-adapter/src/index.ts`:

```ts
export interface ExtensionContext {
  cwd: string
  ui?: {
    notify(message: string, level?: "info" | "warning" | "error"): void
    confirm?(title: string, message?: string): Promise<boolean> | boolean
  }
  sessionManager?: {
    getSessionFile?(): string | undefined
    getBranch?(): Array<{
      type: string
      message?: {
        role?: string
        content?: unknown
      }
    }>
  }
}
```

- [ ] **Step 2: Import session-end dependencies**

Change the lifecycle import at the top from:

```ts
import { handlePostToolUse, handleStop, handleUserPromptSubmit } from "@memory-lane/lifecycle"
import type { PostToolUseInput } from "@memory-lane/lifecycle"
```

to:

```ts
import { createOpenAICompatibleProvider, handlePostToolUse, handleSessionEnd, handleStop, handleUserPromptSubmit } from "@memory-lane/lifecycle"
import type { PostToolUseInput, SessionMessage } from "@memory-lane/lifecycle"
```

Also add `loadConfig` to the core import:

```ts
import {
  MemoryEngine, inferMemoryKind, initProjectLocalStorage, loadConfig, resolveWritableMemoryPaths, type SaveResult,
} from "@memory-lane/core"
```

- [ ] **Step 3: Add branch extraction helpers above `export default function memoryLaneExtension`**

```ts
type PiBranchEntry = NonNullable<ExtensionContext["sessionManager"]> extends { getBranch?: () => infer Entries } ? Entries extends Array<infer Entry> ? Entry : never : never

function textPartsFromContent(content: unknown): string[] {
  if (typeof content === "string") return [content]
  if (!Array.isArray(content)) return []
  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== "object") continue
    const block = part as { type?: string; text?: unknown }
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text)
  }
  return parts
}

function sessionMessagesFromPiBranch(branch: PiBranchEntry[]): SessionMessage[] {
  const messages: SessionMessage[] = []
  for (const entry of branch) {
    if (!entry || entry.type !== "message") continue
    const role = entry.message?.role
    if (role !== "user" && role !== "assistant") continue
    const content = textPartsFromContent(entry.message?.content).join("\n").trim()
    if (!content) continue
    messages.push({ role, content })
  }
  return messages
}
```

- [ ] **Step 4: Add save helper above command registration**

Inside `memoryLaneExtension`, before `pi.registerCommand("remember", ...)`, add:

```ts
function savePiSessionEndCandidates(e: MemoryEngine, candidates: Awaited<ReturnType<typeof handleSessionEnd>>) {
  return candidates.map((candidate) => e.save({
    text: candidate.text,
    category: candidate.category,
    scopeType: candidate.scopeType,
    status: candidate.status,
    source: candidate.source,
    kind: candidate.kind,
    provenance: { ...candidate.provenance, adapter: "pi" },
  }))
}

async function runPiSessionSummaryCommand(ctx: ExtensionContext): Promise<void> {
  const e = getEngine(ctx.cwd)
  const config = loadConfig(process.env.PI_MEMORY_CONFIG_FILE ?? process.env.MEMORY_LANE_CONFIG)
  const summaryConfig = config.memory?.sessionEndSummary

  if (!summaryConfig?.enabled) {
    notify(ctx, "Session-end summarization is not enabled. Configure memory.sessionEndSummary.enabled first.", "warning")
    return
  }
  if (!summaryConfig.baseUrl || !summaryConfig.model) {
    notify(ctx, "Session-end summarization requires memory.sessionEndSummary.baseUrl and model.", "warning")
    return
  }
  if (!ctx.ui?.confirm) {
    notify(ctx, "/memory session-summary requires interactive confirmation in pi.", "warning")
    return
  }

  const branch = ctx.sessionManager?.getBranch?.() ?? []
  const messages = sessionMessagesFromPiBranch(branch as PiBranchEntry[])
  if (!messages.length) {
    notify(ctx, "No conversation text found to summarize.", "warning")
    return
  }

  const ok = await ctx.ui.confirm("Summarize this pi session?", "Memory Lane will send a compact transcript to your configured session summary provider and save the result as a pending memory.")
  if (!ok) {
    notify(ctx, "Session summary cancelled.", "info")
    return
  }

  notify(ctx, "Generating session summary...", "info")
  const provider = createOpenAICompatibleProvider({
    provider: "openai-compatible",
    baseUrl: summaryConfig.baseUrl,
    apiKeyEnv: summaryConfig.apiKeyEnv,
    model: summaryConfig.model,
  }, memoryEnv())
  const candidates = await handleSessionEnd(e, {
    cwd: ctx.cwd,
    sessionId: piSessionId(ctx),
    messages,
  }, {
    provider,
    promptTemplate: summaryConfig.promptTemplate ?? undefined,
    maxTokens: summaryConfig.maxTokens,
    requireConfirmation: false,
    confirmed: true,
    includeToolOutputs: summaryConfig.includeToolOutputs,
  }, memoryEnv())

  const saved = savePiSessionEndCandidates(e, candidates).filter(isSaved)
  if (!saved.length) {
    notify(ctx, "No durable session summary was generated.", "info")
    return
  }
  notify(ctx, `Saved ${saved.length} pending session summary${saved.length === 1 ? "" : "ies"}. Run /memory review to inspect.`, "info")
}
```

- [ ] **Step 5: Wire `/memory session-summary` inside the existing memory command**

In the `pi.registerCommand("memory", ...)` handler, after the `init-project-local` block and before `try { const e = getEngine(ctx.cwd)`, add:

```ts
if (cmd === "session-summary" || cmd === "summarize-session") {
  try {
    await runPiSessionSummaryCommand(ctx)
  } catch (err) {
    notify(ctx, err instanceof Error ? `Session summary failed: ${err.message}` : "Session summary failed", "warning")
  }
  return
}
```

Update the usage string at the bottom of the command to include the new subcommand:

```ts
notify(ctx, "Usage: /memory list [--all] | search <q> | delete <id> | use [q] | review | compact | status | session-summary | init-project-local")
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @memory-lane/pi-adapter test
```

Expected: PASS for Task 1 tests and existing pi adapter tests.

- [ ] **Step 7: Commit implementation**

```bash
git add packages/pi-adapter/src/index.ts packages/pi-adapter/test/extension.test.ts
git commit -m "feat(pi-adapter): add explicit session summary command"
```

---

### Task 3: Add confirmed save and privacy tests

**Files:**
- Modify: `packages/pi-adapter/test/extension.test.ts`

- [ ] **Step 1: Add a local mock OpenAI-compatible server helper**

Add imports at the top:

```ts
import * as http from "node:http"
```

Add helper near other test helpers:

```ts
async function withMockSummaryServer(summary: string, fn: (baseUrl: string, prompts: string[]) => Promise<void>): Promise<void> {
  const prompts: string[] = []
  const server = http.createServer((req, res) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      prompts.push(body)
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ choices: [{ message: { content: summary } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  try {
    await fn(`http://127.0.0.1:${address.port}/v1`, prompts)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  }
}
```

- [ ] **Step 2: Add confirmed save/privacy test**

Append:

```ts
test("memory session-summary saves pending pi session summary without raw branch text", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  await withMockSummaryServer("## Decisions made\n- Provider summary survived.", async (baseUrl, prompts) => {
    fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
      semantic: { enabled: false },
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-summary" } },
    }))
    const pi = createFakePi()
    memoryLaneExtension(pi)
    const notifications: FakeNotification[] = []
    const ctx = ctxWithUi(env.dir, {
      confirmResult: true,
      notifications,
      branch: [
        { type: "message", message: { role: "user", content: [{ type: "text", text: "RAW_USER_SENTINEL remember this" }] } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "RAW_ASSISTANT_SENTINEL acknowledged" }] } },
        { type: "message", message: { role: "tool", content: [{ type: "text", text: "RAW_TOOL_SENTINEL" }] } },
      ],
    })

    await runMemoryCommand(pi, "session-summary", ctx)

    assert.equal(prompts.length, 1)
    const rawMemory = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8")
    assert.doesNotMatch(rawMemory, /RAW_USER_SENTINEL|RAW_ASSISTANT_SENTINEL|RAW_TOOL_SENTINEL/)
    const lines = rawMemory.trim().split("\n")
    assert.equal(lines.length, 1)
    const mem = JSON.parse(lines[0])
    assert.equal(mem.status, "pending")
    assert.equal(mem.source, "session-summary")
    assert.equal(mem.kind, "session_summary")
    assert.equal(mem.provenance.adapter, "pi")
    assert.equal(mem.provenance.lifecycleEvent, "session_end")
    assert.equal(mem.provenance.sessionId, path.join(env.dir, ".pi-session.jsonl"))
    assert.match(mem.text, /Provider summary survived/)
    assert.ok(notifications.some((n) => n.message.includes("Saved 1 pending session summary")))
  })
})
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm --filter @memory-lane/pi-adapter test
```

Expected: PASS. The mock server receives one local request; no real provider network is used.

- [ ] **Step 4: Commit tests/repairs**

If Task 2 already made the test pass without further code changes, commit the test addition:

```bash
git add packages/pi-adapter/test/extension.test.ts packages/pi-adapter/src/index.ts
git commit -m "test(pi-adapter): verify session summary save privacy"
```

---

### Task 4: Update docs and roadmap/handoff

**Files:**
- Modify: `README.md`
- Modify: `skills/memory-lane/SKILL.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update README pi adapter section**

In `README.md`, update the pi adapter paragraph to mention the command:

```md
The pi adapter also provides an explicit `/memory session-summary` command. It reads the current pi branch through pi's session manager, asks for interactive confirmation, sends a compact transcript to the configured `memory.sessionEndSummary` provider, and saves any result as a pending `session_summary` memory with pi `session_end` provenance. It does not run automatically on `agent_end`, `session_shutdown`, or compaction.
```

Also update the session-end summarization paragraph that currently says pi session-end automation remains follow-up work so it says pi has an explicit command, while automatic pi hooks remain deferred.

- [ ] **Step 2: Update skill docs**

In `skills/memory-lane/SKILL.md`, add this command near the session-end command section:

```bash
/memory session-summary # pi only: explicitly summarize the current pi session after confirmation
```

Add one sentence:

```md
In pi, use `/memory session-summary` for the supported explicit session-summary path; Memory Lane does not automatically summarize pi sessions on shutdown or compaction.
```

- [ ] **Step 3: Update ROADMAP Phase 13**

In `ROADMAP.md`, add a completed Slice 4 scope under Phase 13:

```md
Completed Slice 4 scope:

1. Added explicit pi `/memory session-summary` command using pi's documented command, session manager, and UI APIs.
2. Kept pi summarization interactive and confirmation-gated; no automatic `agent_end`, `session_shutdown`, or compaction summarization was added.
3. Reused `handleSessionEnd` and existing `memory.sessionEndSummary` config/provider behavior.
4. Saved generated summaries as pending `session_summary` memories with pi `session_end` provenance.
5. Added tests for disabled config, missing provider, empty branch, cancellation, confirmed save, and raw branch sentinel non-persistence.
```

Update remaining follow-up scope so pi explicit command is no longer listed as the next supported automation slice.

- [ ] **Step 4: Update HANDOFF**

In `HANDOFF.md`, add a recent completed work bullet:

```md
- Added pi explicit session-summary command `/memory session-summary`; it uses `ctx.sessionManager.getBranch()` plus `ctx.ui.confirm`, saves pending `session_summary` memories with pi provenance, and deliberately does not add automatic shutdown/compaction summarization.
```

Update suggested next steps to continue quality smoke/evaluation before Phase 14.

- [ ] **Step 5: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 6: Commit docs**

```bash
git add README.md skills/memory-lane/SKILL.md ROADMAP.md HANDOFF.md
git commit -m "docs: document pi session summary command"
```

---

### Task 5: Final verification and manual smoke

**Files:**
- No intended source changes unless verification reveals a bug.

- [ ] **Step 1: Run focused tests**

```bash
pnpm --filter @memory-lane/pi-adapter test
```

Expected: all pi adapter tests pass.

- [ ] **Step 2: Run full build and test**

```bash
pnpm build
pnpm test
```

Expected: full monorepo build and tests pass.

- [ ] **Step 3: Manual pi smoke with temp storage**

Use a local checkout with the pi extension loaded from `packages/pi-adapter/dist/index.js`. Configure temp files before launching pi:

```bash
tmp="$(mktemp -d /tmp/ml-pi-session-summary.XXXXXX)"
cp ~/.memory-lane/config.json "$tmp/config.json"
node -e '
const fs = require("fs");
const p = process.argv[1];
const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
cfg.semantic = { ...(cfg.semantic || {}), enabled: false };
cfg.memory = cfg.memory || {};
cfg.memory.sessionEndSummary = {
  ...(cfg.memory.sessionEndSummary || {}),
  enabled: true,
  requireConfirmation: true
};
fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
' "$tmp/config.json"
PI_MEMORY_FILE="$tmp/memory.jsonl" PI_MEMORY_EMBEDDINGS_FILE="$tmp/embeddings.jsonl" PI_MEMORY_CONFIG_FILE="$tmp/config.json" pi
```

Inside pi, run a short test conversation, then run:

```text
/memory session-summary
```

Confirm the prompt. After pi exits, inspect:

```bash
cat "$tmp/memory.jsonl" | jq 'select(.source == "session-summary")'
rm -rf "$tmp"
```

Expected: pending `session_summary` with `provenance.adapter == "pi"` and `provenance.lifecycleEvent == "session_end"`. If the provider returns `NO_DURABLE_MEMORY`, the command should notify that no durable summary was generated and no memory file entry is expected.

- [ ] **Step 4: Final review against spec**

Verify:

- `/memory session-summary` exists and is documented.
- The feature uses only explicit command/UI APIs.
- No `agent_end`, `session_shutdown`, `session_before_compact`, or `session_compact` handlers were added.
- Tests use temp storage and a mock/local provider only.
- Raw sentinel strings are not persisted.

- [ ] **Step 5: Commit any final fixes**

If any verification fix was required:

```bash
git add <changed-files>
git commit -m "fix(pi-adapter): finalize session summary command"
```

---

## Self-review checklist

- Spec coverage: Tasks cover command registration, branch extraction, disabled/missing-provider behavior, confirmation, pending save with pi provenance, privacy, docs, and final verification.
- Placeholder scan: No implementation step uses placeholder code; all commands and expected outcomes are explicit.
- Type consistency: The plan uses `SessionMessage`, `handleSessionEnd`, `createOpenAICompatibleProvider`, `loadConfig`, and `SaveResult` from existing packages; provenance is overwritten with `adapter: "pi"` at save time, matching Claude/Codex adapter patterns.
- Scope check: No task adds automatic pi lifecycle summarization or Phase 14 review/dashboard work.
