# Phase 21 Slice 7 Summary Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent obvious orchestrator/subagent operational session summaries from becoming new pending memories, and add read-only review hints for existing pending operational chatter.

**Architecture:** Add one shared deterministic hygiene helper in `@memory-lane/core`, export it, and consume it from lifecycle session-end generation plus CLI/MCP review surfaces. Keep all behavior schema-light and review-first: suppression only applies before writing new generated summaries, while existing memories receive metadata/human hints only.

**Tech Stack:** TypeScript, Node test runner, pnpm workspace, `@memory-lane/core`, `@memory-lane/lifecycle`, CLI formatters, MCP handlers.

---

## File map

- Create: `packages/core/src/summary-hygiene.ts`
  - Owns deterministic operational-chatter and durable-outcome analysis.
  - Exports `analyzeSummaryHygiene`, `withReviewHygiene`, and related types.
- Create: `packages/core/test/summary-hygiene.test.ts`
  - Focused helper tests.
- Modify: `packages/core/src/index.ts`
  - Export helper/types for lifecycle, CLI, and MCP.
- Modify: `packages/lifecycle/src/session-end.ts`
  - Suppress operational-only generated summaries before candidate construction/dedup.
- Modify: `packages/lifecycle/test/session-end.test.ts`
  - Add session-end suppression and keep-durable tests.
- Modify: `packages/cli/src/formatters.ts`
  - Add `reviewHygiene` metadata to JSON review output and compact human hints.
- Modify: `packages/cli/test/cli.test.ts`
  - Add CLI human/JSON review hint tests.
- Modify: `packages/mcp-server/src/handlers.ts`
  - Add `reviewHygiene` metadata to `memory_review` memories.
- Modify: `packages/mcp-server/test/handlers.test.ts`
  - Add MCP review metadata test.
- Modify: `ROADMAP.md`, `HANDOFF.md`
  - Mark Slice 7 implementation progress once code lands.

---

### Task 1: Add shared summary hygiene helper

**Files:**
- Create: `packages/core/src/summary-hygiene.ts`
- Create: `packages/core/test/summary-hygiene.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing helper tests**

Create `packages/core/test/summary-hygiene.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { analyzeSummaryHygiene, withReviewHygiene } from "../src/summary-hygiene.ts"
import type { MemoryRecord } from "../src/types.ts"

function memory(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "m1",
    text: "Summary text",
    category: "project",
    scope: { type: "project", key: "repo" },
    status: "pending",
    source: "session-summary",
    kind: "session_summary",
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
    ...overrides,
  }
}

test("summary hygiene suppresses operational-only delegated subagent summary", () => {
  const result = analyzeSummaryHygiene(`## Session Summary

- Delegated subagent completed task 3 only.
- Acceptance finalization compared the current work to the acceptance contract.
- Reviewer returned APPROVED.`, { kind: "session_summary", source: "session-summary" })

  assert.equal(result.operationalChatter, true)
  assert.equal(result.durableOutcome, false)
  assert.equal(result.action, "suppress")
  assert.ok(result.reasons.includes("delegated-subagent"))
  assert.ok(result.reasons.includes("acceptance-finalization"))
})

test("summary hygiene keeps subagent summary with durable project outcome", () => {
  const result = analyzeSummaryHygiene(`## Session Summary

- Subagent reviewed the implementation.
- Merged PR #62 and released v0.2.33 after tests passed.
- Next step: design Phase 21 Slice 7 summary hygiene.`, { kind: "session_summary", source: "session-summary" })

  assert.equal(result.operationalChatter, true)
  assert.equal(result.durableOutcome, true)
  assert.equal(result.action, "keep")
  assert.ok(result.reasons.includes("durable-outcome"))
})

test("summary hygiene hints memory-review-management summaries", () => {
  const result = analyzeSummaryHygiene(`## Session Summary

- Reviewed pending Memory Lane memories.
- Next steps: approve memory IDs 33428846, 44dfe8a5, and reject 7d2a32a9.
- Run memory-lane review.`, { kind: "session_summary", source: "session-summary" })

  assert.equal(result.operationalChatter, true)
  assert.equal(result.action, "suppress")
  assert.ok(result.reasons.includes("memory-review-management"))
})

test("summary hygiene ignores ordinary project summary", () => {
  const result = analyzeSummaryHygiene(`## Session Summary

- Implemented continuity read-model fields.
- Tests and build passed.
- Next step: cut release.`, { kind: "session_summary", source: "session-summary" })

  assert.equal(result.operationalChatter, false)
  assert.equal(result.durableOutcome, true)
  assert.equal(result.action, "keep")
})

test("withReviewHygiene adds read-only metadata only for suspect pending memories", () => {
  const suspect = withReviewHygiene(memory({ text: "## Session Summary\nDelegated subagent completed task 2 only. Report status as APPROVED." }))
  assert.equal(suspect.reviewHygiene?.operationalChatter, true)
  assert.equal(suspect.reviewHygiene?.suggestedAction, "consider-rejecting")

  const normal = withReviewHygiene(memory({ id: "m2", text: "## Session Summary\nReleased v0.2.33 and verified the release workflow." }))
  assert.equal(normal.reviewHygiene, undefined)

  const approved = withReviewHygiene(memory({ id: "m3", status: "approved", text: "Delegated subagent completed task only." }))
  assert.equal(approved.reviewHygiene, undefined)
})
```

- [ ] **Step 2: Run helper tests and verify failure**

Run:

```bash
pnpm --filter @memory-lane/core test -- --test-name-pattern "summary hygiene"
```

Expected: FAIL because `packages/core/src/summary-hygiene.ts` does not exist and exports are missing.

- [ ] **Step 3: Implement helper**

Create `packages/core/src/summary-hygiene.ts`:

```ts
import type { MemoryKind, MemoryRecord, MemorySource } from "./types.js"

export interface SummaryHygieneAnalysis {
  operationalChatter: boolean
  durableOutcome: boolean
  action: "keep" | "suppress" | "hint"
  reasons: string[]
}

export interface ReviewHygieneMetadata {
  operationalChatter: true
  reasons: string[]
  suggestedAction: "inspect" | "consider-rejecting"
}

export type MemoryRecordWithReviewHygiene = MemoryRecord & { reviewHygiene?: ReviewHygieneMetadata }

const OPERATIONAL_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "delegated-subagent", pattern: /\b(?:delegated\s+subagent|subagent\s+session|subagent\s+(?:reported|completed|reviewed)|worker\s+\d+|agent\s+\d+)\b/iu },
  { reason: "acceptance-finalization", pattern: /\b(?:acceptance\s+finalization|acceptance\s+contract|compare\s+the\s+current\s+work\s+to\s+the\s+acceptance\s+contract)\b/iu },
  { reason: "review-status-label", pattern: /\b(?:APPROVED|CHANGES_REQUESTED|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED)\b/u },
  { reason: "memory-review-management", pattern: /\b(?:approve|reject|review)\s+(?:these\s+)?(?:memory\s+)?(?:ids?|memories|pending\s+memories)\b|\bmemory-lane\s+review\b|\b\/memory\s+review\b/iu },
  { reason: "orchestration-status", pattern: /\b(?:task\s+\d+\s+only|coordinator\s+should\s+collect|collect\s+(?:the\s+)?results|reported\s+status)\b/iu },
]

const DURABLE_OUTCOME_PATTERNS: RegExp[] = [
  /\b(?:merged|released|tagged|published|shipped|implemented|fixed|landed|completed|validated|verified)\b/iu,
  /\b(?:PR|pull\s+request)\s*#?\d+\b/iu,
  /\bv\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?\b/u,
  /\b(?:root\s+cause|blocker|decision|decided|next\s+step|next\s+action|user\s+prefers|preference)\b/iu,
  /\b(?:Procedure|When|Steps|Pitfall|Verify):\b/u,
]

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function isSessionSummaryLike(options?: { kind?: MemoryKind; source?: MemorySource }): boolean {
  return options?.kind === "session_summary" || options?.source === "session-summary"
}

export function analyzeSummaryHygiene(text: string, options?: { kind?: MemoryKind; source?: MemorySource }): SummaryHygieneAnalysis {
  const reasons = unique(OPERATIONAL_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ reason }) => reason))
  const operationalChatter = reasons.length > 0
  const durableOutcome = DURABLE_OUTCOME_PATTERNS.some((pattern) => pattern.test(text))
  if (durableOutcome) reasons.push("durable-outcome")

  const action: SummaryHygieneAnalysis["action"] = operationalChatter && !durableOutcome && isSessionSummaryLike(options)
    ? "suppress"
    : operationalChatter && !durableOutcome
      ? "hint"
      : "keep"

  return { operationalChatter, durableOutcome, action, reasons: unique(reasons) }
}

export function withReviewHygiene(memory: MemoryRecord): MemoryRecordWithReviewHygiene {
  if (memory.status !== "pending") return memory
  const analysis = analyzeSummaryHygiene(memory.text, { kind: memory.kind, source: memory.source })
  if (!analysis.operationalChatter || analysis.durableOutcome) return memory
  return {
    ...memory,
    reviewHygiene: {
      operationalChatter: true,
      reasons: analysis.reasons,
      suggestedAction: analysis.action === "suppress" ? "consider-rejecting" : "inspect",
    },
  }
}
```

- [ ] **Step 4: Export helper**

Modify `packages/core/src/index.ts` by adding:

```ts
export {
  analyzeSummaryHygiene,
  withReviewHygiene,
  type SummaryHygieneAnalysis,
  type ReviewHygieneMetadata,
  type MemoryRecordWithReviewHygiene,
} from "./summary-hygiene.js"
```

- [ ] **Step 5: Run helper tests and core build**

Run:

```bash
pnpm --filter @memory-lane/core test -- --test-name-pattern "summary hygiene"
pnpm --filter @memory-lane/core build
```

Expected: both commands pass.

- [ ] **Step 6: Commit helper**

```bash
git add packages/core/src/summary-hygiene.ts packages/core/src/index.ts packages/core/test/summary-hygiene.test.ts
git commit -m "feat: add summary hygiene analysis"
```

---

### Task 2: Suppress operational-only generated session summaries

**Files:**
- Modify: `packages/lifecycle/src/session-end.ts`
- Modify: `packages/lifecycle/test/session-end.test.ts`

- [ ] **Step 1: Inspect current session-end tests**

Run:

```bash
rg -n "handleSessionEnd|NO_DURABLE_MEMORY|duplicate|session-summary" packages/lifecycle/test/session-end.test.ts
```

Expected: existing tests show provider mock patterns and duplicate debounce coverage.

- [ ] **Step 2: Add failing lifecycle tests**

Append to `packages/lifecycle/test/session-end.test.ts` near existing `handleSessionEnd` tests:

```ts
test("session-end suppresses operational-only subagent summary", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-session-hygiene-"))
  const engine = new MemoryEngine({ memoryPath: path.join(dir, "memory.jsonl"), configPath: path.join(dir, "config.json") })
  const provider = providerReturning(`## Session Summary

- Delegated subagent completed task 3 only.
- Acceptance finalization compared the current work to the acceptance contract.
- Reviewer returned APPROVED.`)

  const candidates = await handleSessionEnd(engine, {
    cwd: dir,
    sessionId: "session-subagent-only",
    messages: [{ role: "user", content: "remember this session" }, { role: "assistant", content: "Subagent review completed." }],
  }, { provider, confirmed: true, requireConfirmation: true, adapter: "test" })

  assert.deepEqual(candidates, [])
})

test("session-end keeps subagent summary with durable project outcome", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-session-hygiene-"))
  const engine = new MemoryEngine({ memoryPath: path.join(dir, "memory.jsonl"), configPath: path.join(dir, "config.json") })
  const provider = providerReturning(`## Session Summary

- Subagent reviewed the implementation.
- Merged PR #62 and released v0.2.33 after tests passed.
- Next step: design Phase 21 Slice 7 summary hygiene.`)

  const candidates = await handleSessionEnd(engine, {
    cwd: dir,
    sessionId: "session-subagent-durable",
    messages: [{ role: "user", content: "remember this session" }, { role: "assistant", content: "Release completed." }],
  }, { provider, confirmed: true, requireConfirmation: true, adapter: "test" })

  assert.equal(candidates.length, 1)
  assert.match(candidates[0]!.text, /released v0\.2\.33/iu)
})
```

If the file uses a different mock helper name than `providerReturning`, adapt these tests to the existing helper by returning the same string from the mock provider. Keep the test names and assertions unchanged.

- [ ] **Step 3: Run lifecycle test and verify failure**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- --test-name-pattern "session-end suppresses operational-only subagent summary|session-end keeps subagent summary with durable project outcome"
```

Expected: first test FAILS because `handleSessionEnd` still returns an operational-only candidate.

- [ ] **Step 4: Integrate helper into session-end**

Modify `packages/lifecycle/src/session-end.ts` import:

```ts
import { analyzeSummaryHygiene, containsLikelySecret, normalizeMemoryText, type MemoryEngine, type MemoryFreshness, type MemoryRecord } from "@memory-lane/core"
```

Then after:

```ts
const cleaned = cleanGeneratedSummary(raw)
if (!sessionSummaryContentKey(cleaned)) return []
```

add:

```ts
const hygiene = analyzeSummaryHygiene(cleaned, { kind: "session_summary", source: "session-summary" })
if (hygiene.action === "suppress") return []
```

- [ ] **Step 5: Run lifecycle tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- --test-name-pattern "session-end suppresses operational-only subagent summary|session-end keeps subagent summary with durable project outcome"
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/lifecycle build
```

Expected: all pass.

- [ ] **Step 6: Commit lifecycle integration**

```bash
git add packages/lifecycle/src/session-end.ts packages/lifecycle/test/session-end.test.ts
git commit -m "feat: suppress operational session summaries"
```

---

### Task 3: Add CLI review hygiene hints

**Files:**
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Add failing CLI tests**

Append near existing review tests in `packages/cli/test/cli.test.ts`:

```ts
it("review human output marks likely operational summary chatter", () => {
  const env = makeEnv()
  const engine = new MemoryEngine(env)
  engine.save({
    text: "## Session Summary\n\n- Delegated subagent completed task 3 only.\n- Acceptance finalization compared the current work to the acceptance contract.",
    category: "project",
    scopeType: "project",
    status: "pending",
    source: "session-summary",
    kind: "session_summary",
  })

  const output = run(["review"], env)

  assert.match(output, /review hint: likely operational chatter/iu)
  assert.match(output, /delegated-subagent/iu)
  assert.match(output, /consider rejecting/iu)
})

it("review json includes reviewHygiene metadata for likely operational summary chatter", () => {
  const env = makeEnv()
  const engine = new MemoryEngine(env)
  engine.save({
    text: "## Session Summary\n\n- Delegated subagent completed task 3 only.\n- Report status as APPROVED.",
    category: "project",
    scopeType: "project",
    status: "pending",
    source: "session-summary",
    kind: "session_summary",
  })

  const payload = JSON.parse(run(["review", "--json"], env))
  const memory = payload.data.memories[0]

  assert.equal(memory.reviewHygiene.operationalChatter, true)
  assert.deepEqual(memory.reviewHygiene.suggestedAction, "consider-rejecting")
  assert.ok(memory.reviewHygiene.reasons.includes("delegated-subagent"))
})
```

If the local CLI test helpers instantiate env differently, copy the existing nearby review test setup exactly and keep the inserted memory text/assertions.

- [ ] **Step 2: Run CLI tests and verify failure**

Run:

```bash
pnpm --filter @memory-lane/cli test -- --test-name-pattern "review human output marks likely operational summary chatter|review json includes reviewHygiene metadata"
```

Expected: FAIL because CLI review does not yet add `reviewHygiene` metadata or human hint lines.

- [ ] **Step 3: Update formatter imports and types**

Modify the import from `@memory-lane/core` in `packages/cli/src/formatters.ts` to include:

```ts
withReviewHygiene, type MemoryRecordWithReviewHygiene,
```

Change:

```ts
type ReviewMemoryOutput = MemoryRecord & { checkpointCandidate?: CheckpointCandidateMetadata }
```

to:

```ts
type ReviewMemoryOutput = MemoryRecordWithReviewHygiene & { checkpointCandidate?: CheckpointCandidateMetadata }
```

- [ ] **Step 4: Add review hygiene helpers to formatter**

Add below `correctionCandidateLines`:

```ts
function reviewHygieneLines(memory: MemoryRecord): string[] {
  const analyzed = withReviewHygiene(memory)
  if (!analyzed.reviewHygiene) return []
  const action = analyzed.reviewHygiene.suggestedAction === "consider-rejecting" ? "consider rejecting after inspection" : "inspect"
  return [
    `    review hint: likely operational chatter — ${analyzed.reviewHygiene.reasons.join(", ")}`,
    `    Review: ${action}; do not approve unless this contains durable project continuity.`,
  ]
}
```

Change `withCheckpointCandidate` to apply hygiene first:

```ts
function withCheckpointCandidate(memory: MemoryRecord): ReviewMemoryOutput {
  const withHygiene = withReviewHygiene(memory)
  const checkpointCandidate = classifyCheckpointCandidate(memory)
  return checkpointCandidate ? { ...withHygiene, checkpointCandidate } : withHygiene
}
```

Add `...reviewHygieneLines(memory),` in human review output between correction candidate lines and `Suggested`:

```ts
        ...checkpointCandidateLines(memory),
        ...correctionCandidateLines(memory),
        ...reviewHygieneLines(memory),
        `    Suggested: ${reviewAction(memory)}`,
```

- [ ] **Step 5: Run targeted and full CLI tests**

Run:

```bash
pnpm --filter @memory-lane/cli test -- --test-name-pattern "review human output marks likely operational summary chatter|review json includes reviewHygiene metadata"
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/cli build
```

Expected: all pass.

- [ ] **Step 6: Commit CLI review hints**

```bash
git add packages/cli/src/formatters.ts packages/cli/test/cli.test.ts
git commit -m "feat: show review hints for operational summaries"
```

---

### Task 4: Add MCP review hygiene metadata

**Files:**
- Modify: `packages/mcp-server/src/handlers.ts`
- Modify: `packages/mcp-server/test/handlers.test.ts`

- [ ] **Step 1: Add failing MCP test**

Append near existing `memory_review` tests in `packages/mcp-server/test/handlers.test.ts`:

```ts
test("memory_review includes review hygiene metadata for operational summary chatter", async () => {
  const { engine } = makeHarness()
  engine.save({
    text: "## Session Summary\n\n- Delegated subagent completed task 3 only.\n- Report status as APPROVED.",
    category: "project",
    scopeType: "project",
    status: "pending",
    source: "session-summary",
    kind: "session_summary",
  })

  const result = await handleMemoryReview(engine, {})
  const memory = result.structuredContent.data.memories[0]

  assert.equal(memory.reviewHygiene.operationalChatter, true)
  assert.equal(memory.reviewHygiene.suggestedAction, "consider-rejecting")
  assert.ok(memory.reviewHygiene.reasons.includes("delegated-subagent"))
})
```

If the test harness helper is not named `makeHarness`, use the existing helper at the top of `handlers.test.ts` that returns an engine. Keep the memory text and assertions.

- [ ] **Step 2: Run MCP test and verify failure**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test -- --test-name-pattern "memory_review includes review hygiene metadata"
```

Expected: FAIL because MCP review output does not include `reviewHygiene`.

- [ ] **Step 3: Update MCP handler**

Modify `packages/mcp-server/src/handlers.ts` import from `@memory-lane/core` to include:

```ts
withReviewHygiene, type MemoryRecordWithReviewHygiene,
```

Change:

```ts
type ReviewMemoryOutput = MemoryRecord & { checkpointCandidate?: CheckpointCandidateMetadata }
```

to:

```ts
type ReviewMemoryOutput = MemoryRecordWithReviewHygiene & { checkpointCandidate?: CheckpointCandidateMetadata }
```

Change `withCheckpointCandidate` to:

```ts
function withCheckpointCandidate(memory: MemoryRecord): ReviewMemoryOutput {
  const withHygiene = withReviewHygiene(memory)
  const checkpointCandidate = classifyCheckpointCandidate(memory)
  return checkpointCandidate ? { ...withHygiene, checkpointCandidate } : withHygiene
}
```

- [ ] **Step 4: Run MCP tests**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test -- --test-name-pattern "memory_review includes review hygiene metadata"
pnpm --filter @memory-lane/mcp-server test
pnpm --filter @memory-lane/mcp-server build
```

Expected: all pass.

- [ ] **Step 5: Commit MCP metadata**

```bash
git add packages/mcp-server/src/handlers.ts packages/mcp-server/test/handlers.test.ts
git commit -m "feat: expose review hygiene over mcp"
```

---

### Task 5: Update docs and final validation

**Files:**
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`
- Optional Modify: `README.md` if review output documentation exists near review command docs.

- [ ] **Step 1: Update roadmap status**

In `ROADMAP.md`, in the Phase 21 status paragraph and item 7 area, add a concise note:

```md
Slice 7 design (`docs/superpowers/specs/2026-06-26-phase-21-slice-7-summary-hygiene-design.md`) and implementation add deterministic generated-summary hygiene: operational-only subagent/orchestrator session summaries are suppressed before writing, while existing pending suspect summaries get read-only review hints on CLI/MCP review surfaces. No schema expansion, cleanup mutation, recall ranking, lifecycle injection, or workstream IDs were added.
```

- [ ] **Step 2: Update handoff current state**

In `HANDOFF.md`, add a recent-change bullet:

```md
- Phase 21 Slice 7 summary hygiene is implemented on `<branch-name>`: `handleSessionEnd` suppresses generated session summaries dominated by operational subagent/orchestrator chatter when no durable project outcome is present, and CLI/MCP review surfaces expose read-only `reviewHygiene` hints for existing pending suspect summaries. The slice remains review-first and non-mutating: no auto-reject/delete/supersede, no schema expansion, no retrieval/ranking changes, and no raw transcript indexing.
```

Use the actual branch name from `git branch --show-current`.

- [ ] **Step 3: Run full validation**

Run:

```bash
pnpm build
pnpm test
git diff --check
```

Expected: all pass.

- [ ] **Step 4: Review changed files**

Run:

```bash
git status --short
git diff --stat
git diff -- ROADMAP.md HANDOFF.md packages/core/src/summary-hygiene.ts packages/lifecycle/src/session-end.ts packages/cli/src/formatters.ts packages/mcp-server/src/handlers.ts
```

Expected: only intended files changed; no generated build artifacts committed.

- [ ] **Step 5: Commit docs**

```bash
git add ROADMAP.md HANDOFF.md README.md
git commit -m "docs: document phase 21 summary hygiene"
```

If `README.md` was not changed, run:

```bash
git add ROADMAP.md HANDOFF.md
git commit -m "docs: document phase 21 summary hygiene"
```

- [ ] **Step 6: Request code review**

Use the project’s direct Opus review workflow, not subagents:

```bash
git diff main...HEAD > /tmp/phase-21-slice-7-summary-hygiene.diff
claude -p --model=claude-opus-4-8 < /tmp/phase-21-slice-7-summary-hygiene.diff
```

Prompt Opus to review correctness, false-positive risk, scope compliance, and test coverage. Address only verified issues.

- [ ] **Step 7: Open PR for user merge**

```bash
git push -u origin docs/phase-21-slice-7-summary-hygiene
gh pr create --base main --head docs/phase-21-slice-7-summary-hygiene --title "feat: add phase 21 summary hygiene" --body "## Summary
- suppress operational-only generated session summaries before writing pending memories
- add read-only review hygiene hints to CLI and MCP review outputs
- document Phase 21 Slice 7 summary hygiene

## Verification
- pnpm build
- pnpm test
- git diff --check
- Opus 4.8 direct review"
```

Stop after PR creation for user merge.

---

## Self-review notes

- Spec coverage: Tasks cover future prevention, read-only review hints, CLI and MCP parity, no mutation, no schema expansion, and docs/verification.
- Placeholder scan: The plan contains no `TBD`, `TODO`, or unspecified edge-case instructions. Where current test helper names may vary, the plan gives exact fallback behavior and requires preserving test text/assertions.
- Type consistency: `SummaryHygieneAnalysis`, `ReviewHygieneMetadata`, and `MemoryRecordWithReviewHygiene` are defined in Task 1 and used consistently in CLI/MCP tasks.
