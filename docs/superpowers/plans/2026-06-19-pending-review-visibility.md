# Pending Review Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make automatic review-first pending memory suggestions visible in hook-based harnesses with compact, privacy-safe review reminders.

**Architecture:** Add shared lifecycle helpers that derive pending-review counts and messages from existing `LifecycleResult.saved`. Update Claude and Codex adapter output helpers to prefer the pending-review notice over generic debug counts when pending memories were saved, while preserving quiet no-op behavior when nothing pending was saved.

**Tech Stack:** TypeScript, Node test runner, pnpm workspaces, `@memory-lane/lifecycle`, Claude/Codex adapter JSON hook outputs.

---

## File structure

- Create: `packages/lifecycle/src/review-notices.ts`
  - Shared helpers for counting pending saved memories and rendering a text-free review notice.
- Modify: `packages/lifecycle/src/index.ts`
  - Export review notice helpers.
- Create: `packages/lifecycle/test/review-notices.test.ts`
  - Unit tests for count, pluralization, privacy, and no-pending behavior.
- Modify: `packages/claude-adapter/src/outputs.ts`
  - Use shared notice helper in `lifecycleNoopOutput`.
- Modify: `packages/codex-adapter/src/outputs.ts`
  - Use shared notice helper in `lifecycleNoopOutput`.
- Modify: `packages/claude-adapter/test/runner.test.ts`
  - Assert Stop/PostToolUse or SessionEnd pending saves emit visible review notice without debug.
- Modify: `packages/codex-adapter/test/runner.test.ts`
  - Assert Stop, PostToolUse, and supported Stop+summary pending saves emit visible review notice without debug.
- Modify: `README.md`
  - Document compact pending review reminders in write hooks.

## Task 1: Add shared pending-review notice helper with tests

**Files:**
- Create: `packages/lifecycle/src/review-notices.ts`
- Modify: `packages/lifecycle/src/index.ts`
- Create: `packages/lifecycle/test/review-notices.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `packages/lifecycle/test/review-notices.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import type { LifecycleResult } from "../src/types.ts"
import { pendingReviewCount, renderPendingReviewNotice } from "../src/review-notices.ts"

function lifecycleResult(statuses: Array<"pending" | "approved">): LifecycleResult {
  return {
    saved: statuses.map((status, index) => ({
      status: "saved" as const,
      memory: {
        id: `secret-id-${index}`,
        status,
        text: `PRIVATE MEMORY BODY ${index}`,
        category: "project" as const,
        scope: { type: "project" as const, key: "/tmp/project" },
        source: "agent-suggested" as const,
        createdAt: "2026-06-19T00:00:00.000Z",
        updatedAt: "2026-06-19T00:00:00.000Z",
        kind: "project_fact" as const,
      },
    })),
    discarded: [],
  }
}

test("pendingReviewCount counts only saved pending memories", () => {
  assert.equal(pendingReviewCount(lifecycleResult(["pending", "approved", "pending"])), 2)
  assert.equal(pendingReviewCount({ saved: [{ status: "skipped", reason: "duplicate" }], discarded: [] }), 0)
})

test("renderPendingReviewNotice returns undefined when nothing pending was saved", () => {
  assert.equal(renderPendingReviewNotice(lifecycleResult(["approved"])), undefined)
})

test("renderPendingReviewNotice renders singular and plural review guidance", () => {
  assert.equal(
    renderPendingReviewNotice(lifecycleResult(["pending"])),
    "suggested 1 pending memory for review. Run `memory-lane review` to approve or reject it.",
  )
  assert.equal(
    renderPendingReviewNotice(lifecycleResult(["pending", "pending"])),
    "suggested 2 pending memories for review. Run `memory-lane review` to approve or reject them.",
  )
})

test("renderPendingReviewNotice is text-free", () => {
  const notice = renderPendingReviewNotice(lifecycleResult(["pending"])) ?? ""
  assert.doesNotMatch(notice, /PRIVATE MEMORY BODY/u)
  assert.doesNotMatch(notice, /secret-id/u)
  assert.match(notice, /memory-lane review/u)
})
```

- [ ] **Step 2: Run focused test and verify failure**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- review-notices.test.ts
```

Expected: FAIL because `review-notices.ts` does not exist.

- [ ] **Step 3: Implement shared helper**

Create `packages/lifecycle/src/review-notices.ts`:

```ts
import type { LifecycleResult } from "./types.js"

export function pendingReviewCount(result: LifecycleResult): number {
  return result.saved.filter((saveResult) => saveResult.status === "saved" && saveResult.memory.status === "pending").length
}

export function renderPendingReviewNotice(result: LifecycleResult): string | undefined {
  const count = pendingReviewCount(result)
  if (count <= 0) return undefined

  const memoryWord = count === 1 ? "memory" : "memories"
  const pronoun = count === 1 ? "it" : "them"
  return `suggested ${count} pending ${memoryWord} for review. Run \`memory-lane review\` to approve or reject ${pronoun}.`
}
```

- [ ] **Step 4: Export helper**

In `packages/lifecycle/src/index.ts`, add:

```ts
export * from "./review-notices.js"
```

- [ ] **Step 5: Run focused lifecycle tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- review-notices.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add packages/lifecycle/src/review-notices.ts packages/lifecycle/src/index.ts packages/lifecycle/test/review-notices.test.ts
git commit -m "feat(lifecycle): render pending review notices"
```

## Task 2: Wire pending-review notice into Claude and Codex outputs

**Files:**
- Modify: `packages/claude-adapter/src/outputs.ts`
- Modify: `packages/codex-adapter/src/outputs.ts`

- [ ] **Step 1: Update Claude output helper**

In `packages/claude-adapter/src/outputs.ts`, change the import:

```ts
import type { LifecycleResult } from "@memory-lane/lifecycle"
```

to:

```ts
import { renderPendingReviewNotice, type LifecycleResult } from "@memory-lane/lifecycle"
```

Then replace `lifecycleNoopOutput` with:

```ts
export function lifecycleNoopOutput(result: LifecycleResult, debug = debugEnabled()): string {
  const pendingReviewNotice = renderPendingReviewNotice(result)
  if (pendingReviewNotice) return noopOutput(pendingReviewNotice, true)

  const saved = result.saved.filter((saveResult) => saveResult.status === "saved").length
  const skipped = result.saved.filter((saveResult) => saveResult.status === "skipped").length
  const discarded = result.discarded.length
  return noopOutput(`saved ${saved}, skipped ${skipped}, discarded ${discarded}.`, debug)
}
```

- [ ] **Step 2: Update Codex output helper**

Apply the same import and `lifecycleNoopOutput` replacement in `packages/codex-adapter/src/outputs.ts`.

- [ ] **Step 3: Run TypeScript build for affected packages**

Run:

```bash
pnpm --filter @memory-lane/claude-adapter build
pnpm --filter @memory-lane/codex-adapter build
```

Expected: PASS.

- [ ] **Step 4: Commit Task 2**

Run:

```bash
git add packages/claude-adapter/src/outputs.ts packages/codex-adapter/src/outputs.ts
git commit -m "feat(adapters): show pending review reminders"
```

## Task 3: Add adapter tests for visible notices and quiet no-op behavior

**Files:**
- Modify: `packages/claude-adapter/test/runner.test.ts`
- Modify: `packages/codex-adapter/test/runner.test.ts`

- [ ] **Step 1: Update Claude Stop test to assert visible notice without debug**

In `packages/claude-adapter/test/runner.test.ts`, add a new test near `stop saves with claude provenance`:

```ts
test("stop shows pending review notice without debug when pending memory is saved", async () => {
  const engine = engineInTemp()

  const output = await runClaudeHookCommand("stop", {
    engine,
    env: {} as NodeJS.ProcessEnv,
    payloadText: stopPayload(),
  })

  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /Memory Lane: suggested 1 pending memory for review/u)
  assert.match(parsed.systemMessage, /memory-lane review/u)
  assert.match(parsed.systemMessage, /approve or reject it/u)
  assert.doesNotMatch(parsed.systemMessage, /remember that|PRIVATE|secret-id/u)
})
```

- [ ] **Step 2: Add Claude quiet approved-save test for PostToolUse**

Add:

```ts
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
```

- [ ] **Step 3: Add Codex Stop visible notice test**

In `packages/codex-adapter/test/runner.test.ts`, add near existing stop tests:

```ts
test("stop shows pending review notice without debug when pending memory is saved", async () => {
  const engine = engineInTemp()

  const output = await runCodexHookCommand("stop", {
    engine,
    env: {} as NodeJS.ProcessEnv,
    payloadText: stopPayload(),
  })

  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /Memory Lane: suggested 1 pending memory for review/u)
  assert.match(parsed.systemMessage, /memory-lane review/u)
  assert.match(parsed.systemMessage, /approve or reject it/u)
})
```

- [ ] **Step 4: Add Codex PostToolUse pending notice test**

Use an npm-install failure payload so `summarizeToolOutcome` queues a pending memory:

```ts
test("post-tool-use shows pending review notice for pending tool outcome", async () => {
  const engine = engineInTemp()

  const output = await runCodexHookCommand("post-tool-use", {
    engine,
    env: {} as NodeJS.ProcessEnv,
    payloadText: postToolUsePayload({ output: "pnpm-lock.yaml exists; npm install would update package-lock", exit_code: 1 }, { command: "npm install left-pad" }),
  })

  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /Memory Lane: suggested 1 pending memory for review/u)
  assert.match(parsed.systemMessage, /memory-lane review/u)
  assert.doesNotMatch(parsed.systemMessage, /pnpm-lock|left-pad|package-lock/u)
})
```

If the local helper signature differs, adapt only the test payload construction; preserve the assertions.

- [ ] **Step 5: Update Codex explicit Stop summary test expectation**

Find the test for explicit Stop session-summary intent with enabled provider. Change its assertion from generic `saved 1, skipped 0, discarded 0` to pending-review notice:

```ts
assert.match(parsed.systemMessage, /suggested 1 pending memory for review/u)
assert.match(parsed.systemMessage, /memory-lane review/u)
```

Keep existing assertions that saved memory is pending `session_summary`, provenance is Codex, and raw transcript is not saved.

- [ ] **Step 6: Run adapter tests**

Run:

```bash
pnpm --filter @memory-lane/claude-adapter test -- runner.test.ts
pnpm --filter @memory-lane/codex-adapter test -- runner.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add packages/claude-adapter/test/runner.test.ts packages/codex-adapter/test/runner.test.ts
git commit -m "test(adapters): cover pending review reminders"
```

## Task 4: Document pending review visibility

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md` if the active roadmap needs a slice note.

- [ ] **Step 1: Update README hook docs**

Under the Claude Code hooks and Codex hooks sections, add a concise sentence where `Stop`/`PostToolUse` behavior is described:

```md
When a write hook suggests pending memories, Memory Lane may emit a compact system message such as `Memory Lane: suggested 1 pending memory for review. Run memory-lane review to approve or reject it.` The notice is count-only and does not include memory text, prompts, transcripts, or tool output.
```

For Codex, also ensure the explicit Stop session-summary description says pending summaries are reviewable through `memory-lane review`.

- [ ] **Step 2: Optionally update ROADMAP**

If Phase 17 or continuity follow-ups track this work, add a short in-progress/completed slice note. Do not introduce broader Phase B/project-first selection work in this doc update.

- [ ] **Step 3: Run docs whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Commit docs**

Run:

```bash
git add README.md ROADMAP.md
git commit -m "docs: document pending review reminders"
```

If `ROADMAP.md` was not changed, omit it.

## Task 5: Final verification and review packet

**Files:**
- No source edits expected unless verification finds an issue.

- [ ] **Step 1: Run full tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Run diff check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Inspect diff and commits**

Run:

```bash
git diff --stat main...HEAD
git log --oneline --decorate main..HEAD
```

Expected: spec, plan, shared helper, adapter output wiring, adapter tests, and docs.

- [ ] **Step 5: Prepare review summary**

Return:

```md
Changed:
- Added shared pending-review notice helper.
- Claude/Codex write hooks now show a compact review reminder only when pending memories are saved.
- Quiet no-op behavior remains for no pending saves.
- Docs updated.

Verified:
- `pnpm test`
- `pnpm build`
- `git diff --check`

Out of scope:
- Candidate extraction/save heuristics
- Recall ranking/selection
- Dedup/debounce
- MCP lifecycle behavior
```

## Self-review

- Spec coverage: tasks cover visible pending notices, quiet no-op behavior, debug preservation, privacy, Codex/Claude, explicit summary path, and docs.
- Placeholder scan: no `TBD`, `TODO`, vague “add tests”, or unspecified commands remain.
- Type consistency: helper functions are `pendingReviewCount` and `renderPendingReviewNotice`; adapters import them from `@memory-lane/lifecycle`.
