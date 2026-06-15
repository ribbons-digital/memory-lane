# pi Lifecycle Autosave and Tool Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic memory writes to the pi adapter through the shared `@memory-lane/lifecycle` policy, replacing the ad-hoc `input` auto-save with `handleStop`, adding `tool_result` capture with `handlePostToolUse`, and adding privacy-safe debug logging.

**Architecture:** The pi adapter currently does read-only recall in `before_agent_start` and ad-hoc auto-save in `input`. Phase 6 centralizes lifecycle writes by routing turn-end/auto-save candidates through the shared `handleStop` handler and tool outcomes through `handlePostToolUse`. A small shared `handleInput` helper may be added to the lifecycle package if the `input` event semantics differ from `StopInput`. Duplicate-save protection is added at the adapter layer using a per-session/turn dedupe set. Privacy-safe debug logging mirrors the existing hook debug log pattern (`~/.memory-lane/hooks-log.jsonl`) but writes to a separate pi debug log and never includes raw prompts or tool outputs.

**Tech Stack:** TypeScript, Node.js test runner, `@memory-lane/core`, `@memory-lane/lifecycle`, pi extension API shims in `packages/pi-adapter/src/index.ts`.

---

## Files

- Create:
  - `packages/lifecycle/src/input.ts` — shared `handleInput` helper for user-input auto-save candidates (optional, only if distinct from `handleStop`).
  - `packages/pi-adapter/src/debug.ts` — privacy-safe pi debug log writer.
- Modify:
  - `packages/lifecycle/src/index.ts` — export any new public helpers.
  - `packages/lifecycle/src/handlers.ts` — add `handleInput` if needed, otherwise leave unchanged.
  - `packages/pi-adapter/src/index.ts` — refactor `input` handler, add `agent_end`/`turn_end`/`tool_result` handlers, wire debug logging.
  - `packages/pi-adapter/test/extension.test.ts` — add tests for auto-save via turn_end, tool_result capture, meta-prompt filtering, duplicate suppression.
  - `packages/pi-adapter/package.json` — add `@memory-lane/lifecycle` dependency if not already present (check first).
  - `README.md` — document automatic pi writes, events, and how to disable/inspect.
  - `skills/memory-lane/SKILL.md` — document pi autosave behavior and `/memory` commands.

---

## Task 1: Inventory current pi adapter and lifecycle surface

**Files:**
- Read: `packages/pi-adapter/src/index.ts`
- Read: `packages/lifecycle/src/handlers.ts`
- Read: `packages/lifecycle/src/types.ts`
- Read: `packages/lifecycle/src/index.ts`
- Read: `packages/pi-adapter/package.json`

- [ ] **Step 1: Read the files above and summarize the current pi event handlers, the shared lifecycle handlers available, and whether `@memory-lane/lifecycle` is already a dependency of `@memory-lane/pi-adapter`.**

Expected return: a short note listing current events (`before_agent_start`, `input`), available lifecycle handlers (`handleUserPromptSubmit`, `handleStop`, `handlePostToolUse`, `handleSessionStart`), and dependency status.

---

## Task 2: Add shared `handleInput` lifecycle helper (if needed)

**Files:**
- Create: `packages/lifecycle/src/input.ts`
- Modify: `packages/lifecycle/src/index.ts`
- Modify: `packages/lifecycle/src/types.ts`

If pi's `input` event semantics are the same as `StopInput` (user message, optional assistant message), skip this task and use `handleStop` directly. Otherwise create a helper.

- [ ] **Step 1: Write the failing test for `handleInput`**

Create `packages/lifecycle/test/input.test.ts`:

```ts
import * as assert from "node:assert/strict"
import { test } from "node:test"
import { makeEngine } from "./helpers.js"
import { handleInput } from "../src/input.js"

test("handleInput saves an explicit memory request", async () => {
  const engine = makeEngine()
  const result = handleInput(engine, { cwd: engine.cwd, lastUserMessage: "Remember we use pnpm test" })
  assert.equal(result.saved.length, 1)
  assert.equal(result.saved[0].status, "saved")
  assert.equal(result.saved[0].memory.text, "We use pnpm test.")
})

test("handleInput filters out questions", async () => {
  const engine = makeEngine()
  const result = handleInput(engine, { cwd: engine.cwd, lastUserMessage: "How do I run tests?" })
  assert.equal(result.saved.length, 0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd packages/lifecycle
node --test --import tsx test/input.test.ts
```

Expected: FAIL with `handleInput` not found or similar.

- [ ] **Step 3: Implement `handleInput` in `packages/lifecycle/src/input.ts`**

```ts
import type { MemoryEngine } from "@memory-lane/core"
import { extractStopCandidates } from "./candidates.js"
import { persistCandidates } from "./persistence.js"
import type { LifecycleResult, StopInput } from "./types.js"

export function handleInput(engine: MemoryEngine, input: StopInput): LifecycleResult {
  engine.refreshScope(input.cwd)
  const candidates = extractStopCandidates(input)
  return persistCandidates(engine, candidates, input, "input")
}
```

Note: this requires extracting `persistCandidates` from `handlers.ts` into a new `persistence.ts` or keeping it in `handlers.ts` and exporting it. If `persistCandidates` is not exported, refactor `handlers.ts` to export it.

- [ ] **Step 4: Add `InputInput` type to `packages/lifecycle/src/types.ts` if distinct from `StopInput`**

If using `StopInput`, skip. Otherwise:

```ts
export interface InputInput extends LifecycleContext {
  lastUserMessage?: string
  lastAssistantMessage?: string
}
```

- [ ] **Step 5: Export from `packages/lifecycle/src/index.ts`**

```ts
export { handleInput } from "./input.js"
```

- [ ] **Step 6: Run lifecycle tests to verify the new helper passes and existing tests still pass**

Run:

```bash
cd packages/lifecycle
node --test --import tsx test/*.test.ts
```

Expected: all lifecycle tests pass, including the new `input.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/lifecycle/src/input.ts packages/lifecycle/src/index.ts packages/lifecycle/src/types.ts packages/lifecycle/src/handlers.ts packages/lifecycle/test/input.test.ts
git commit -m "feat(lifecycle): add handleInput helper for user-input autosave"
```

---

## Task 3: Add privacy-safe pi debug log writer

**Files:**
- Create: `packages/pi-adapter/src/debug.ts`
- Modify: `packages/pi-adapter/src/index.ts`

- [ ] **Step 1: Write the failing test for debug logging**

Create `packages/pi-adapter/test/debug.test.ts`:

```ts
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, test } from "node:test"
import { writePiDebugLog, piDebugPath } from "../src/debug.js"

let tmpDir: string | undefined

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

test("writePiDebugLog appends a privacy-safe JSONL record", () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-debug-test-"))
  const logPath = path.join(tmpDir, "pi-debug.jsonl")
  writePiDebugLog(logPath, {
    event: "tool_result",
    harness: "pi",
    sessionId: "s1",
    turnId: "t1",
    savedCount: 1,
    discardedCount: 0,
  })
  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n")
  assert.equal(lines.length, 1)
  const record = JSON.parse(lines[0])
  assert.equal(record.event, "tool_result")
  assert.equal(record.harness, "pi")
  assert.equal(record.savedCount, 1)
  assert.equal(record.hasOwnProperty("prompt"), false)
  assert.equal(record.hasOwnProperty("toolInput"), false)
  assert.equal(record.hasOwnProperty("toolResponse"), false)
})

test("piDebugPath returns default under ~/.memory-lane", () => {
  const home = process.env.HOME ?? "/tmp"
  assert.equal(piDebugPath(), path.join(home, ".memory-lane", "pi-debug.jsonl"))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd packages/pi-adapter
node --test --import tsx test/debug.test.ts
```

Expected: FAIL with `writePiDebugLog` not found.

- [ ] **Step 3: Implement `packages/pi-adapter/src/debug.ts`**

```ts
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export interface PiDebugRecord {
  event: string
  harness: "pi"
  timestamp: string
  sessionId?: string
  turnId?: string
  savedCount: number
  discardedCount: number
  error?: string
}

export function piDebugPath(): string {
  const home = process.env.HOME ?? os.homedir()
  return path.join(home, ".memory-lane", "pi-debug.jsonl")
}

export function isPiDebugEnabled(): boolean {
  const env = process.env.MEMORY_LANE_DEBUG ?? process.env.MEMORY_LANE_PI_DEBUG
  return env === "1" || env?.toLowerCase() === "true"
}

export function writePiDebugLog(logPath: string, record: Omit<PiDebugRecord, "timestamp" | "harness">): void {
  const entry: PiDebugRecord = {
    ...record,
    harness: "pi",
    timestamp: new Date().toISOString(),
  }
  try {
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8")
  } catch {
    // Debug logging is best-effort; never surface to users.
  }
}
```

- [ ] **Step 4: Run the debug test to verify it passes**

Run:

```bash
cd packages/pi-adapter
node --test --import tsx test/debug.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-adapter/src/debug.ts packages/pi-adapter/test/debug.test.ts
git commit -m "feat(pi-adapter): add privacy-safe debug log writer"
```

---

## Task 4: Refactor pi adapter to use shared lifecycle handlers

**Files:**
- Modify: `packages/pi-adapter/src/index.ts`
- Modify: `packages/pi-adapter/test/extension.test.ts`

- [ ] **Step 1: Add `@memory-lane/lifecycle` imports to `packages/pi-adapter/src/index.ts`**

At the top of the file, add:

```ts
import { handleInput, handlePostToolUse, handleStop, handleUserPromptSubmit } from "@memory-lane/lifecycle"
import type { PostToolUseInput, StopInput } from "@memory-lane/lifecycle"
import { writePiDebugLog, piDebugPath, isPiDebugEnabled } from "./debug.js"
```

If `handleInput` was not added in Task 2, use `handleStop` for both `input` and `turn_end` events.

- [ ] **Step 2: Add duplicate-save tracking state**

Add near the engine singleton:

```ts
let lastProcessedTurnId: string | undefined
let savedThisTurn = new Set<string>()

function resetTurnState(turnId?: string): void {
  if (turnId && turnId !== lastProcessedTurnId) {
    lastProcessedTurnId = turnId
    savedThisTurn = new Set<string>()
  }
}

function markSaved(text: string): void {
  savedThisTurn.add(text.trim().toLowerCase().replace(/\s+/gu, " "))
}

function wasSaved(text: string): boolean {
  return savedThisTurn.has(text.trim().toLowerCase().replace(/\s+/gu, " "))
}
```

- [ ] **Step 3: Refactor the `input` event handler to delegate classification to lifecycle**

Replace the existing `input` handler body with:

```ts
pi.on("input", async (event, ctx) => {
  if (event.source === "extension") return { action: "continue" }

  const text = typeof event.text === "string" ? event.text.trim() : ""
  if (!text) return { action: "continue" }

  // Explicit / command-like requests are handled by commands/tools.
  // Let the shared lifecycle filter decide if this ordinary input is memory-worthy.
  const turnId = event.turnId ?? piSessionId(ctx)
  resetTurnState(turnId)

  try {
    const e = getEngine(ctx.cwd)
    const result = handleInput(e, {
      cwd: ctx.cwd,
      sessionId: piSessionId(ctx),
      turnId,
      lastUserMessage: text,
    })

    const newlySaved = result.saved.filter((s) => s.status === "saved" && !wasSaved(s.memory.text))
    for (const save of newlySaved) markSaved(save.memory.text)

    if (isPiDebugEnabled()) {
      writePiDebugLog(piDebugPath(), {
        event: "input",
        sessionId: piSessionId(ctx),
        turnId,
        savedCount: newlySaved.length,
        discardedCount: result.discarded.length,
      })
    }

    for (const save of newlySaved) {
      notify(ctx, `Auto-saved memory: ${formatMemory(save.memory)}`, "info")
    }
  } catch (err) {
    notify(ctx, storageGuidance(err), "warning")
  }

  return { action: "continue" }
})
```

If `handleInput` does not exist, use `handleStop` with the same `StopInput` shape.

- [ ] **Step 4: Add `turn_end` / `agent_end` handler**

```ts
pi.on("turn_end", async (event, ctx) => {
  const turnId = event.turnId ?? piSessionId(ctx)
  resetTurnState(turnId)

  try {
    const e = getEngine(ctx.cwd)
    const result = handleStop(e, {
      cwd: ctx.cwd,
      sessionId: piSessionId(ctx),
      turnId,
      lastUserMessage: event.lastUserMessage,
      lastAssistantMessage: event.lastAssistantMessage,
    }, { adapter: "pi" })

    const newlySaved = result.saved.filter((s) => s.status === "saved" && !wasSaved(s.memory.text))
    for (const save of newlySaved) markSaved(save.memory.text)

    if (isPiDebugEnabled()) {
      writePiDebugLog(piDebugPath(), {
        event: "turn_end",
        sessionId: piSessionId(ctx),
        turnId,
        savedCount: newlySaved.length,
        discardedCount: result.discarded.length,
      })
    }

    for (const save of newlySaved) {
      notify(ctx, `Auto-saved memory: ${formatMemory(save.memory)}`, "info")
    }
  } catch (err) {
    notify(ctx, storageGuidance(err), "warning")
  }
})
```

If the pi harness uses `agent_end` instead of `turn_end`, register the same handler for `agent_end`.

- [ ] **Step 5: Add `tool_result` handler**

```ts
pi.on("tool_result", async (event, ctx) => {
  const turnId = event.turnId ?? piSessionId(ctx)
  resetTurnState(turnId)

  try {
    const e = getEngine(ctx.cwd)
    const result = handlePostToolUse(e, {
      cwd: ctx.cwd,
      sessionId: piSessionId(ctx),
      turnId,
      toolName: event.toolName,
      toolInput: event.toolInput,
      toolResponse: event.toolResponse,
    } as PostToolUseInput, { adapter: "pi" })

    const newlySaved = result.saved.filter((s) => s.status === "saved" && !wasSaved(s.memory.text))
    for (const save of newlySaved) markSaved(save.memory.text)

    if (isPiDebugEnabled()) {
      writePiDebugLog(piDebugPath(), {
        event: "tool_result",
        sessionId: piSessionId(ctx),
        turnId,
        savedCount: newlySaved.length,
        discardedCount: result.discarded.length,
      })
    }

    for (const save of newlySaved) {
      notify(ctx, `Auto-saved workflow memory: ${formatMemory(save.memory)}`, "info")
    }
  } catch (err) {
    notify(ctx, storageGuidance(err), "warning")
  }
})
```

- [ ] **Step 6: Remove the old `classifyIntent` and LLM fallback if now unused**

If `classifyIntent` is no longer called, delete the function and the `IntentResult` interface. If it is still used by commands or tools, keep it.

- [ ] **Step 7: Add tests in `packages/pi-adapter/test/extension.test.ts`**

Add helper to run events:

```ts
async function runEvent(pi: FakePi, eventName: string, event: any, ctx: ExtensionContext): Promise<any> {
  const handlers = pi.events.get(eventName) ?? []
  if (handlers.length === 0) return undefined
  return handlers[0](event, ctx)
}
```

Add tests:

```ts
test("input auto-save delegates to shared lifecycle filtering", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  await runEvent(pi, "input", { text: "Remember we use pnpm test" }, ctx)

  const mems = JSON.parse(fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n")[0])
  assert.equal(mems.text, "We use pnpm test.")
})

test("input filters questions through shared lifecycle", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  await runEvent(pi, "input", { text: "How do I run tests?" }, ctx)

  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
})

test("turn_end saves stop candidates from the last user message", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  await runEvent(pi, "turn_end", { lastUserMessage: "We use pnpm test for verification" }, ctx)

  const lines = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n")
  assert.equal(lines.length, 1)
  const mem = JSON.parse(lines[0])
  assert.equal(mem.text, "We use pnpm test for verification.")
})

test("tool_result saves successful pnpm test workflow memory", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  await runEvent(pi, "tool_result", {
    toolName: "bash",
    toolInput: { command: "pnpm test" },
    toolResponse: { exit_code: 0, stdout: "passing" },
  }, ctx)

  const lines = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n")
  assert.equal(lines.length, 1)
  const mem = JSON.parse(lines[0])
  assert.equal(mem.text, "`pnpm test` is the test command for this repo.")
})

test("duplicate saves across input and turn_end are suppressed", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  await runEvent(pi, "input", { text: "Remember we use pnpm test" }, ctx)
  await runEvent(pi, "turn_end", { lastUserMessage: "We use pnpm test", turnId: "t1" }, ctx)

  const lines = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n")
  assert.equal(lines.length, 1)
})
```

Update the first test assertion to expect three event handlers:

```ts
assert.equal(pi.events.get("input")?.length, 1)
assert.equal(pi.events.get("before_agent_start")?.length, 1)
assert.equal(pi.events.get("turn_end")?.length, 1)
assert.equal(pi.events.get("tool_result")?.length, 1)
```

- [ ] **Step 8: Run pi-adapter tests**

Run:

```bash
cd packages/pi-adapter
node --test --import tsx test/*.test.ts
```

Expected: all pi-adapter tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/pi-adapter/src/index.ts packages/pi-adapter/test/extension.test.ts
git commit -m "feat(pi-adapter): use shared lifecycle handlers for autosave and tool capture"
```

---

## Task 5: Update documentation

**Files:**
- Modify: `README.md`
- Modify: `skills/memory-lane/SKILL.md`
- Modify: `ROADMAP.md` (mark Phase 6 complete)

- [ ] **Step 1: Update `README.md` pi section**

Find the pi section. Add or update text similar to:

```markdown
### pi automatic lifecycle writes

The pi extension automatically captures durable memories from:

- `input` events — explicit user memory requests and durable statements filtered through shared lifecycle policy.
- `turn_end` / `agent_end` events — stop-candidate extraction over the last user and assistant messages.
- `tool_result` events — successful project workflow commands such as `pnpm test`, `pnpm build`, and `pnpm install`.

Automatic writes respect the same rules as Codex/Claude Code hooks: secrets are skipped, transient imperatives are skipped, reviewer/subagent meta-prompts are filtered, and duplicates within a turn are suppressed. Set `MEMORY_LANE_DEBUG=1` to append privacy-safe debug records to `~/.memory-lane/pi-debug.jsonl` (no prompts or tool outputs are logged).
```

- [ ] **Step 2: Update `skills/memory-lane/SKILL.md`**

Add a short paragraph:

```markdown
In pi, Memory Lane also writes automatically during the lifecycle: `/memory` commands and tools save explicitly, while `input`, `turn_end`, and `tool_result` events can auto-save durable project facts and workflow rules. Use `/memory review` to inspect auto-saved pending suggestions.
```

- [ ] **Step 3: Update `ROADMAP.md` Phase 6 status**

Change Phase 6 status to `**Status:** Complete and merged.` and mark todos as completed by moving them to a "Completed scope" list.

- [ ] **Step 4: Commit**

```bash
git add README.md skills/memory-lane/SKILL.md ROADMAP.md
git commit -m "docs: document pi lifecycle autosave and tool capture"
```

---

## Task 6: Full build and test verification

- [ ] **Step 1: Run full build**

```bash
pnpm build
```

Expected: all packages build without TypeScript errors.

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit if any generated changes**

If build produced changes to `dist/` files that are tracked, commit them:

```bash
git add packages/*/dist/
git commit -m "chore: rebuild dist for pi lifecycle autosave"
```

---

## Spec Coverage Checklist

- [x] Reassess pi event semantics — Task 4 registers `input`, `turn_end`/`agent_end`, and `tool_result` handlers.
- [x] Refactor pi autosave to use shared lifecycle stop-candidate filtering — Task 4 replaces ad-hoc `classifyIntent` with `handleInput`/`handleStop`.
- [x] Add pi tool-outcome capture from `tool_result` using shared `handlePostToolUse` — Task 4 adds `tool_result` handler.
- [x] Add safeguards against duplicate saves — Task 4 adds per-turn dedupe set.
- [x] Add privacy-safe pi debug/diagnostic behavior — Task 3 creates `debug.ts` and Task 4 wires it.
- [x] Update README and skill docs — Task 5.

## Placeholder Scan

No `TBD`, `TODO`, "implement later", or "write tests for the above" placeholders. Every step includes exact file paths, code, commands, and expected outputs.
