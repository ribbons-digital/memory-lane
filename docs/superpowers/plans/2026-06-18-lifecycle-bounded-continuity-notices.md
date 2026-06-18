# Lifecycle Bounded Continuity Notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded, plain-language SessionStart continuity notices that surface newer approved state, operating agreements, and continuity hints without injecting memory text or changing recall behavior.

**Architecture:** Extend lifecycle types with optional `SessionStartInput.since` and `MemoryContextDecision.continuity`, add a deterministic `renderContinuityNotice` helper in lifecycle injection code, and wire `handleSessionStart` to render notices before baseline memory bodies within the existing SessionStart character budget. Adapters only pass through existing timestamp fields when present; no adapter state or new config.

**Tech Stack:** TypeScript, Node test runner, pnpm workspaces, existing `@memory-lane/core` continuity hint and operating agreement APIs, existing lifecycle context policy.

---

## Acceptance Criteria

- SessionStart lifecycle context can include a separate `Continuity notice` section inside the existing `<memory-context>` block.
- Notice is SessionStart-only; UserPromptSubmit behavior is unchanged.
- `contextPolicy.mode` controls notices: `off` injects none; `policy-only` and `selective` may inject notices.
- Notice text is plain-language, inspection-first, and contains no memory ids, memory text, transcript text, or tool output.
- Notice shares the existing SessionStart character budget and is rendered before baseline memory bodies.
- `contextDecision.continuity` reports text-free structured metadata: generated/injected flags, omitted reasons, hint count/codes, newer-approved count, operating-agreement primary count, and suggested actions.
- `SessionStartInput` accepts optional `since?: string`; Codex and Claude SessionStart payload parsers pass through timestamp fields opportunistically if present.
- No new config flags, memory fields, lifecycle writes, automatic cleanup, recall/retrieval filtering, UserPromptSubmit notices, or MCP mutation tools.
- Tests and docs cover behavior.

## File Map

Modify:
- `packages/lifecycle/src/types.ts` — add `SessionStartInput.since` and continuity decision metadata types.
- `packages/lifecycle/src/injection.ts` — add `renderContinuityNotice` helper and budget composition helper.
- `packages/lifecycle/src/handlers.ts` — wire SessionStart notices into policy-only/selective modes and contextDecision.
- `packages/lifecycle/test/injection.test.ts` — unit tests for notice rendering/budget/privacy.
- `packages/lifecycle/test/handlers.test.ts` — SessionStart behavior tests.
- `packages/codex-adapter/src/payloads.ts` — opportunistic timestamp pass-through.
- `packages/codex-adapter/test/payloads.test.ts` — timestamp parse test.
- `packages/claude-adapter/src/payloads.ts` — opportunistic timestamp pass-through.
- `packages/claude-adapter/test/payloads.test.ts` — timestamp parse test if present; otherwise add to existing runner/payload tests.
- `README.md`, `skills/memory-lane/SKILL.md`, `ROADMAP.md`, `HANDOFF.md` — docs/status after implementation.

Do not modify adapter runner debug output in this slice; lifecycle `contextDecision.continuity` is already available to runner outputs that serialize the full lifecycle result, and debug-log metadata expansion can wait for real diagnostic need.

Do not modify:
- `packages/core/src/types.ts` memory record shape.
- recall/retrieval/scoring modules.
- MCP tool definitions.
- storage/compaction/Obsidian behavior.

---

## Task 1: Lifecycle types and notice renderer

**Files:**
- Modify: `packages/lifecycle/src/types.ts`
- Modify: `packages/lifecycle/src/injection.ts`
- Test: `packages/lifecycle/test/injection.test.ts`

- [ ] **Step 1: Add failing injection tests**

Add imports to `packages/lifecycle/test/injection.test.ts`:

```ts
import type { ContinuityHintSummary, OperatingAgreementSummary } from "@memory-lane/core"
import { renderContinuityNotice } from "../src/injection.ts"
```

Add helpers near existing test helpers:

```ts
function continuityHints(overrides: Partial<ContinuityHintSummary> = {}): ContinuityHintSummary {
  return {
    projectScope: "repo",
    hintCount: 2,
    hints: [
      {
        code: "newer-approved",
        severity: "info",
        message: "PRIVATE MESSAGE SHOULD NOT RENDER",
        count: 2,
        memoryIds: ["newer-secret-id"],
        suggestedActions: ["memory-lane status --json --since 2026-06-18T00:00:00.000Z"],
      },
      {
        code: "superseded-visible",
        severity: "review",
        message: "PRIVATE SUPERSEDED MESSAGE SHOULD NOT RENDER",
        count: 1,
        memoryIds: ["old-secret-id"],
        suggestedActions: ["memory-lane dashboard"],
      },
    ],
    supersededVisible: [{
      id: "old-secret-id",
      status: "approved",
      category: "project",
      scope: { type: "project", key: "repo" },
      source: "manual",
      createdAt: "2026-06-17T00:00:00.000Z",
      updatedAt: "2026-06-17T00:00:00.000Z",
      kind: "workflow_rule",
      supersededBy: "new-secret-id",
    }],
    operatingAgreementOverlaps: [],
    projectGlobalPreferenceOverlaps: [],
    newerApproved: {
      referenceTime: "2026-06-18T00:00:00.000Z",
      count: 2,
      newestIds: ["newer-secret-id"],
    },
    suggestedActions: [
      "memory-lane status --json --since 2026-06-18T00:00:00.000Z",
      "memory-lane dashboard",
    ],
    notes: ["PRIVATE NOTE SHOULD NOT RENDER"],
    ...overrides,
  }
}

function operatingAgreements(overrides: Partial<OperatingAgreementSummary> = {}): OperatingAgreementSummary {
  return {
    projectScope: "repo",
    primaryCount: 1,
    relatedCandidateCount: 0,
    omittedPrimaryCount: 0,
    omittedRelatedCandidateCount: 0,
    workflowAreas: ["project-loop"],
    primary: [{
      id: "agreement-secret-id",
      category: "project",
      scope: { type: "project", key: "repo" },
      source: "manual",
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
      kind: "workflow_rule",
      workflowArea: "project-loop",
      matchReason: "explicit-kind",
    }],
    relatedCandidates: [],
    notes: [],
    ...overrides,
  }
}
```

Add tests:

```ts
test("renderContinuityNotice renders plain-language notice without ids or private text", () => {
  const result = renderContinuityNotice({
    hints: continuityHints(),
    operatingAgreements: operatingAgreements(),
    since: "2026-06-18T00:00:00.000Z",
    maxChars: 900,
  })

  assert.equal(result.generated, true)
  assert.equal(result.injected, true)
  assert.match(result.text, /^Continuity notice:/u)
  assert.match(result.text, /There is newer approved Memory Lane state/u)
  assert.match(result.text, /Current workflow agreements are available/u)
  assert.match(result.text, /Some approved memories are superseded historical guidance/u)
  assert.match(result.text, /If relevant, inspect before proceeding:/u)
  assert.match(result.text, /memory-lane dashboard/u)
  assert.match(result.text, /memory-lane agreements/u)
  assert.doesNotMatch(result.text, /secret-id|PRIVATE/u)
  assert.deepEqual(result.suggestedActions, [
    "memory-lane status --json --since 2026-06-18T00:00:00.000Z",
    "memory-lane dashboard",
    "memory-lane agreements",
  ])
})

test("renderContinuityNotice returns not generated when there are no signals", () => {
  const result = renderContinuityNotice({
    hints: continuityHints({ hintCount: 0, hints: [], supersededVisible: [], newerApproved: undefined, suggestedActions: [] }),
    operatingAgreements: operatingAgreements({ primaryCount: 0, workflowAreas: [], primary: [] }),
    maxChars: 900,
  })

  assert.equal(result.generated, false)
  assert.equal(result.injected, false)
  assert.equal(result.text, "")
})

test("renderContinuityNotice respects tight budget", () => {
  const result = renderContinuityNotice({
    hints: continuityHints(),
    operatingAgreements: operatingAgreements(),
    since: "2026-06-18T00:00:00.000Z",
    maxChars: 40,
  })

  assert.equal(result.generated, true)
  assert.equal(result.injected, false)
  assert.equal(result.text, "")
  assert.deepEqual(result.omittedReasons, ["continuity-budget"])
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- test/injection.test.ts
```

Expected: FAIL because `renderContinuityNotice` does not exist and continuity metadata types are not defined.

- [ ] **Step 3: Extend lifecycle types**

Modify `packages/lifecycle/src/types.ts` imports:

```ts
import type { ContinuityHintCode, MemoryRecord, MemorySource, SaveResult } from "@memory-lane/core"
```

Change `SessionStartInput`:

```ts
export interface SessionStartInput extends LifecycleContext {
  since?: string
}
```

Add before `MemoryContextDecision`:

```ts
export interface ContinuityContextDecision {
  generated: boolean
  injected: boolean
  omittedReasons: string[]
  hintCount: number
  hintCodes: ContinuityHintCode[]
  newerApprovedCount?: number
  operatingAgreementPrimaryCount?: number
  suggestedActions: string[]
}
```

Add optional field to `MemoryContextDecision`:

```ts
  continuity?: ContinuityContextDecision
```

- [ ] **Step 4: Implement renderer**

Modify `packages/lifecycle/src/injection.ts` import from core:

```ts
  type ContinuityHintCode,
  type ContinuityHintSummary,
  type OperatingAgreementSummary,
```

Add exported interface and helper before `renderMemoryBlock`:

```ts
export interface RenderContinuityNoticeInput {
  hints: ContinuityHintSummary
  operatingAgreements: OperatingAgreementSummary
  since?: string
  maxChars: number
}

export interface RenderContinuityNoticeResult {
  text: string
  generated: boolean
  injected: boolean
  omittedReasons: string[]
  hintCount: number
  hintCodes: ContinuityHintCode[]
  newerApprovedCount?: number
  operatingAgreementPrimaryCount?: number
  suggestedActions: string[]
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function continuityLines(input: RenderContinuityNoticeInput): string[] {
  const lines: string[] = []
  if (input.hints.newerApproved && input.hints.newerApproved.count > 0) {
    lines.push("- There is newer approved Memory Lane state for this project.")
  }
  if (input.operatingAgreements.primaryCount > 0) {
    lines.push("- Current workflow agreements are available.")
  }
  if (input.hints.supersededVisible.length > 0) {
    lines.push("- Some approved memories are superseded historical guidance.")
  }
  if (input.hints.operatingAgreementOverlaps.length > 0 || input.hints.projectGlobalPreferenceOverlaps.length > 0) {
    lines.push("- Multiple workflow guidance candidates may need review.")
  }
  return lines
}

function continuityActions(input: RenderContinuityNoticeInput): string[] {
  const actions = [...input.hints.suggestedActions]
  if (input.operatingAgreements.primaryCount > 0) actions.push("memory-lane agreements")
  if (input.hints.hintCount > 0) actions.push("memory-lane dashboard")
  return uniqueStrings(actions)
}

export function renderContinuityNotice(input: RenderContinuityNoticeInput): RenderContinuityNoticeResult {
  const hintCodes = input.hints.hints.map((hint) => hint.code)
  const suggestedActions = continuityActions(input)
  const signalLines = continuityLines(input)
  const generated = signalLines.length > 0
  const base = {
    generated,
    injected: false,
    omittedReasons: generated ? [] : ["no-continuity-signals"],
    hintCount: input.hints.hintCount,
    hintCodes,
    newerApprovedCount: input.hints.newerApproved?.count,
    operatingAgreementPrimaryCount: input.operatingAgreements.primaryCount,
    suggestedActions,
  }

  if (!generated) return { text: "", ...base }

  const actionLines = suggestedActions.map((action) => `- \`${action}\``)
  const full = [
    "Continuity notice:",
    ...signalLines,
    "",
    "If relevant, inspect before proceeding:",
    ...actionLines,
  ].join("\n")

  if (full.length <= input.maxChars) return { text: full, ...base, injected: true }

  const minimal = ["Continuity notice:", signalLines[0], "", "If relevant, inspect before proceeding:", "- `memory-lane dashboard`"].join("\n")
  if (minimal.length <= input.maxChars) return { text: minimal, ...base, injected: true, omittedReasons: ["continuity-budget"] }

  return { text: "", ...base, injected: false, omittedReasons: ["continuity-budget"] }
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- test/injection.test.ts
pnpm --filter @memory-lane/lifecycle build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/lifecycle/src/types.ts packages/lifecycle/src/injection.ts packages/lifecycle/test/injection.test.ts
git commit -m "feat(lifecycle): render continuity notices"
```

---

## Task 2: Wire SessionStart lifecycle notices

**Files:**
- Modify: `packages/lifecycle/src/handlers.ts`
- Modify: `packages/lifecycle/src/injection.ts` if composition helper needs adjustment
- Test: `packages/lifecycle/test/handlers.test.ts`

- [ ] **Step 1: Add failing handler tests**

Add this helper in `packages/lifecycle/test/handlers.test.ts` after `engineInTemp`:

```ts
function saveWorkflowAgreement(engine: MemoryEngine): void {
  engine.save({
    text: "PRIVATE WORKFLOW AGREEMENT TEXT Project workflow loop: inspect roadmap before implementation.",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "workflow_rule",
  })
}
```

Add tests:

```ts
test("session-start policy-only injects continuity notice without memory bodies", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only" } })
  saveWorkflowAgreement(engine)

  const result = handleSessionStart(engine, { cwd: project })

  assert.match(result.additionalContext ?? "", /mode="policy-only"/u)
  assert.match(result.additionalContext ?? "", /Continuity notice:/u)
  assert.match(result.additionalContext ?? "", /Current workflow agreements are available/u)
  assert.match(result.additionalContext ?? "", /memory-lane agreements/u)
  assert.doesNotMatch(result.additionalContext ?? "", /PRIVATE WORKFLOW AGREEMENT TEXT/u)
  assert.equal(result.contextDecision?.continuity?.generated, true)
  assert.equal(result.contextDecision?.continuity?.injected, true)
  assert.equal(result.contextDecision?.continuity?.operatingAgreementPrimaryCount, 1)
})

test("session-start selective injects continuity notice before relevant memory", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective", maxItems: { sessionStart: 1 } } })
  saveWorkflowAgreement(engine)
  engine.save({ text: "Baseline memory body", status: "approved", category: "project", scopeType: "project" })

  const result = handleSessionStart(engine, { cwd: project })
  const context = result.additionalContext ?? ""

  assert.match(context, /Continuity notice:/u)
  assert.match(context, /## Relevant Memory/u)
  assert.ok(context.indexOf("Continuity notice:") < context.indexOf("## Relevant Memory"))
  assert.match(context, /Baseline memory body/u)
  assert.doesNotMatch(context, /PRIVATE WORKFLOW AGREEMENT TEXT/u)
  assert.equal(result.contextDecision?.continuity?.injected, true)
})

test("session-start continuity notice reports newer approved state from since", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only" } })
  engine.save({ text: "PRIVATE NEW CHECKPOINT TEXT", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })

  const result = handleSessionStart(engine, { cwd: project, since: "2000-01-01T00:00:00.000Z" })

  assert.match(result.additionalContext ?? "", /There is newer approved Memory Lane state/u)
  assert.match(result.additionalContext ?? "", /memory-lane status --json --since 2000-01-01T00:00:00.000Z/u)
  assert.doesNotMatch(result.additionalContext ?? "", /PRIVATE NEW CHECKPOINT TEXT/u)
  assert.equal(result.contextDecision?.continuity?.newerApprovedCount, 1)
  assert.deepEqual(result.contextDecision?.continuity?.hintCodes.includes("newer-approved"), true)
})

test("session-start off policy injects no continuity notice", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "off" } })
  saveWorkflowAgreement(engine)

  const result = handleSessionStart(engine, { cwd: project })

  assert.equal(result.additionalContext, undefined)
  assert.equal(result.contextDecision?.continuity, undefined)
})

test("session-start tight budget records continuity budget omission", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only", maxChars: { sessionStart: 20 } } })
  saveWorkflowAgreement(engine)

  const result = handleSessionStart(engine, { cwd: project })

  assert.doesNotMatch(result.additionalContext ?? "", /Continuity notice:/u)
  assert.equal(result.contextDecision?.continuity?.generated, true)
  assert.equal(result.contextDecision?.continuity?.injected, false)
  assert.deepEqual(result.contextDecision?.continuity?.omittedReasons, ["continuity-budget"])
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- test/handlers.test.ts
```

Expected: FAIL because `handleSessionStart` does not render continuity notices or decision metadata.

- [ ] **Step 3: Import renderer in handlers**

Modify the `packages/lifecycle/src/handlers.ts` injection import to include `renderContinuityNotice`:

```ts
import { isMemoryManagementListIntent, limitsFromContextPolicy, renderContinuityNotice, renderMemoryContext, renderMemoryManagementListGuidance, resolveContextPolicy, selectBaselineMemories, selectMemoriesForInjection, type MemoryInjectionLimits } from "./injection.js"
```

- [ ] **Step 4: Add context composition helper**

In `packages/lifecycle/src/handlers.ts`, add helper near `contextBudget`:

```ts
function composeSessionStartContext(input: {
  noticeText: string
  memoryContext: string
  policy: ReturnType<typeof resolveContextPolicy>
}): string {
  const parts = [input.noticeText, input.memoryContext].filter((part) => part.trim().length > 0)
  if (!parts.length) return ""
  if (input.memoryContext.trim().startsWith("<memory-context")) {
    const inner = input.memoryContext
      .replace(/^<memory-context[^>]*>\n?/u, "")
      .replace(/\n?<\/memory-context>$/u, "")
    const header = `<memory-context mode="${input.policy.mode}" event="sessionStart">`
    return [header, [input.noticeText, inner].filter(Boolean).join("\n\n"), "</memory-context>"].join("\n")
  }
  return renderMemoryContext({ event: "sessionStart", memories: [], policy: input.policy }).replace(/<\/memory-context>$/u, `${parts.join("\n\n")}\n</memory-context>`)
}
```

- [ ] **Step 5: Wire policy-only and selective paths**

Replace the policy-only branch in `handleSessionStart` with logic that computes hints/agreements and renders notice:

```ts
  const hints = engine.continuityHints({ since: input.since })
  const operatingAgreements = engine.operatingAgreementSummary()
  const notice = renderContinuityNotice({ hints, operatingAgreements, since: input.since, maxChars: budget.maxChars })
```

For `policy.mode === "off"`, keep current no-context behavior and do not compute/render notice.

For `policy-only`:

```ts
  const guidance = renderMemoryContext({ event: "sessionStart", memories: [], policy })
  const rendered = composeSessionStartContext({ noticeText: notice.text, memoryContext: guidance, policy })
  return createResult(rendered || undefined, contextDecision({ event: "sessionStart", mode: policy.mode, ...budget, selected: 0, omitted: 0, omittedReasons: ["policy-only", ...notice.omittedReasons], continuity: notice }))
```

For `selective`:

- render notice first with `budget.maxChars`;
- reduce memory body budget by `notice.text.length` plus separator cost;
- select baseline memories using the reduced hard max chars;
- compose notice before memory context.

Example:

```ts
  const noticeBudget = budget.maxChars
  const notice = renderContinuityNotice({ hints, operatingAgreements, since: input.since, maxChars: noticeBudget })
  const remainingChars = Math.max(0, budget.maxChars - (notice.injected ? notice.text.length + 2 : 0))
  const approved = engine.list({ status: "approved" })
  const selected = selectBaselineMemories(approved, limitsFromContextPolicy("sessionStart", policy, { ...options, hardMaxChars: remainingChars, targetChars: remainingChars, absoluteMaxChars: remainingChars }))
  const memoryContext = renderMemoryContext({ event: "sessionStart", memories: selected, policy })
  const rendered = composeSessionStartContext({ noticeText: notice.text, memoryContext, policy })
  return createResult(rendered || undefined, contextDecision({ event: "sessionStart", mode: policy.mode, ...budget, selected: selected.length, omitted: Math.max(0, approved.length - selected.length), continuity: notice }))
```

- [ ] **Step 6: Ensure type compatibility**

If `contextDecision()` helper currently does not accept `continuity`, update its type to preserve extra fields:

```ts
function contextDecision(input: Omit<MemoryContextDecision, "omittedReasons"> & { omittedReasons?: string[] }): MemoryContextDecision {
  return { ...input, omittedReasons: input.omittedReasons ?? (input.omitted > 0 ? ["budget-or-filter"] : []) }
}
```

This should already allow `continuity` because `MemoryContextDecision` now includes it.

- [ ] **Step 7: Run focused lifecycle tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- test/handlers.test.ts
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/lifecycle build
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add packages/lifecycle/src/handlers.ts packages/lifecycle/src/injection.ts packages/lifecycle/test/handlers.test.ts
git commit -m "feat(lifecycle): inject session continuity notices"
```

---

## Task 3: Adapter timestamp pass-through and debug metadata

**Files:**
- Modify: `packages/codex-adapter/src/payloads.ts`
- Modify: `packages/codex-adapter/test/payloads.test.ts`
- Modify: `packages/claude-adapter/src/payloads.ts`
- Modify: `packages/claude-adapter/test/payloads.test.ts`

- [ ] **Step 1: Add failing payload tests**

In `packages/codex-adapter/test/payloads.test.ts`, extend or add SessionStart payload test:

```ts
test("parses SessionStart since timestamp when present", () => {
  const parsed = parseCodexPayload({
    hook_event_name: "SessionStart",
    cwd: "/tmp/memory-lane-fixture",
    session_id: "session-1",
    timestamp: "2026-06-18T12:00:00.000Z",
  })

  assert.equal(parsed.kind, "session-start")
  assert.equal(parsed.kind === "session-start" ? parsed.input.since : undefined, "2026-06-18T12:00:00.000Z")
})
```

In `packages/claude-adapter/test/payloads.test.ts`, add equivalent test:

```ts
test("parses SessionStart since timestamp when present", () => {
  const parsed = parseClaudePayload({
    hook_event_name: "SessionStart",
    cwd: "/tmp/memory-lane-fixture",
    session_id: "session-1",
    timestamp: "2026-06-18T12:00:00.000Z",
  })

  assert.equal(parsed.kind, "session-start")
  assert.equal(parsed.kind === "session-start" ? parsed.input.since : undefined, "2026-06-18T12:00:00.000Z")
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @memory-lane/codex-adapter test -- test/payloads.test.ts
pnpm --filter @memory-lane/claude-adapter test -- test/payloads.test.ts
```

Expected: FAIL because `since` is not parsed.

- [ ] **Step 3: Add timestamp pass-through**

In both `packages/codex-adapter/src/payloads.ts` and `packages/claude-adapter/src/payloads.ts`, modify `baseContext`:

```ts
function baseContext(obj: Record<string, unknown>) {
  return {
    cwd: stringField(obj, "cwd") ?? "",
    sessionId: stringField(obj, "session_id"),
    turnId: stringField(obj, "turn_id"),
    model: stringField(obj, "model"),
    transcriptPath: nullableStringField(obj, "transcript_path"),
    since: stringField(obj, "timestamp") ?? stringField(obj, "started_at") ?? stringField(obj, "session_started_at"),
  }
}
```

This is opportunistic pass-through only. Do not synthesize timestamps or store anything.

- [ ] **Step 4: Run adapter tests/builds**

Run:

```bash
pnpm --filter @memory-lane/codex-adapter test
pnpm --filter @memory-lane/claude-adapter test
pnpm --filter @memory-lane/codex-adapter build
pnpm --filter @memory-lane/claude-adapter build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

If only payloads/tests changed:

```bash
git add packages/codex-adapter/src/payloads.ts packages/codex-adapter/test/payloads.test.ts packages/claude-adapter/src/payloads.ts packages/claude-adapter/test/payloads.test.ts
git commit -m "feat(adapters): pass session start timestamps"
```

If runner debug metadata changed too, add runner files to the same commit.

---

## Task 4: Docs and roadmap/handoff

**Files:**
- Modify: `README.md`
- Modify: `skills/memory-lane/SKILL.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update README**

In the lifecycle/context policy area, add:

```md
### Lifecycle continuity notices

SessionStart lifecycle context may include a compact `Continuity notice` section when `memory.contextPolicy.mode` is `policy-only` or `selective`. The notice is plain-language and inspection-first: it may say that newer approved state exists, current workflow agreements are available, or continuity hints should be inspected.

Continuity notices share the existing SessionStart context budget. They do not include memory ids, memory text, transcripts, or tool outputs. They do not mutate memory, clean up superseded records, change recall ranking, or run on every UserPromptSubmit turn. Set `memory.contextPolicy.mode` to `off` to disable all lifecycle context, including continuity notices.
```

- [ ] **Step 2: Update skill docs**

In `skills/memory-lane/SKILL.md`, add:

```md
### Lifecycle continuity notices

At SessionStart, Memory Lane may inject a compact `Continuity notice` when context policy is `policy-only` or `selective`. Treat it as a prompt to inspect authoritative surfaces such as `memory-lane dashboard`, `memory-lane agreements`, or `memory-lane status --json --since <timestamp>`; it is not a memory body and does not mean cleanup or recall filtering happened.
```

- [ ] **Step 3: Update ROADMAP**

Change Phase 16 status sentence to:

```md
**Status:** Slice 1 complete: read-only freshness/status detection is implemented. Slice 2 complete: read-only canonical workflow/operating-agreement discovery is implemented. Slice 3 complete: CLI-first update/replace/supersede revision primitives are implemented. Slice 4 complete: read-only continuity/status hints for superseded-visible memories, operating-agreement overlaps, project/global overlaps, and newer approved state are implemented. Slice 5 complete: SessionStart lifecycle bounded continuity notices are implemented. Phase 17 review-first progress/checkpoint capture is the next incomplete continuity item.
```

Change extension slice 5 bullet to:

```md
5. **Complete — lifecycle bounded notices:** SessionStart lifecycle context routes through freshness/operating-agreement/continuity hint helpers to surface compact plain-language notices when newer approved progress, current operating agreements, or continuity hints exist, with project/global scope, context budget, and privacy boundaries tested.
```

- [ ] **Step 4: Update HANDOFF**

Add top entry:

```md
- Phase 16 Slice 5 complete: added bounded SessionStart continuity notices governed by existing contextPolicy modes. Notices are plain-language, inspection-first, share the SessionStart budget, and report text-free metadata in contextDecision.continuity. No UserPromptSubmit notices, new config flags, lifecycle writes, recall filtering, cleanup, workstream ids, or memory text/ids in notice text were added. Next recommended continuity item: Phase 17 review-first progress/checkpoint capture.
```

- [ ] **Step 5: Run docs check**

Run:

```bash
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add README.md skills/memory-lane/SKILL.md ROADMAP.md HANDOFF.md
git commit -m "docs: document lifecycle continuity notices"
```

---

## Task 5: Final verification and PR

**Files:**
- No planned changes unless review finds a defect.

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
git status --short
```

Expected:

- tests pass;
- build passes;
- diff check passes;
- worktree clean after commits.

- [ ] **Step 2: Scope audit**

Run:

```bash
rg -n "UserPromptSubmit notices|workstreamId|threadId|memory_update|memory_replace|memory_supersede|depriorit|filtering|automatic cleanup|continuityNotices|memory\.continuity" packages README.md ROADMAP.md HANDOFF.md CONTEXT.md docs/superpowers/specs/2026-06-18-lifecycle-bounded-continuity-notices-design.md
```

Expected:

- `UserPromptSubmit notices`, `workstreamId`, `threadId`, and automatic cleanup appear only in spec/docs as explicit non-goals.
- No new config flag names appear in code.
- No MCP mutation tools appear as implemented tools.
- No recall/retrieval filtering/deprioritization implementation exists.

- [ ] **Step 3: Review against spec**

Check `docs/superpowers/specs/2026-06-18-lifecycle-bounded-continuity-notices-design.md`:

- SessionStart only;
- continuity notice separate from Relevant Memory;
- plain-language text + inspection commands;
- `policy-only` and `selective` supported, `off` disabled;
- shared budget respected;
- optional `since` supported;
- adapter timestamp pass-through only;
- `contextDecision.continuity` text-free;
- docs updated.

- [ ] **Step 4: Open PR**

Push branch and open PR:

```bash
git push -u origin feature/phase-16-slice-5-lifecycle-notices
gh pr create --base main --head feature/phase-16-slice-5-lifecycle-notices --title "feat: add lifecycle continuity notices" --body "## Summary
- add bounded SessionStart continuity notices governed by existing context policy
- add text-free contextDecision continuity metadata and optional SessionStart since timestamp support
- document Slice 5 behavior and mark Phase 16 complete

## Verification
- pnpm test
- pnpm build
- git diff --check

## Scope boundaries
- no UserPromptSubmit notices
- no new config flags or memory fields
- no lifecycle writes, cleanup, recall filtering, or workstream ids
- no memory ids/text in continuity notice text
"
```

- [ ] **Step 5: Stop for user merge**

After opening the PR, stop and wait for user review/merge. Do not clean up branch/worktree until the user says PR merged.
