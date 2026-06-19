# Checkpoint Candidate Review Labeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Label reviewable high-value project progress memories as checkpoint candidates in CLI and MCP review surfaces.

**Architecture:** Add a shared deterministic classifier in `@memory-lane/core` that derives text-free checkpoint metadata from existing memory records. Reuse the existing `project_checkpoint` kind and conservative text matching instead of adding new storage fields or new kinds in this slice. CLI and MCP review surfaces call the shared classifier when formatting pending memories.

**Tech Stack:** TypeScript, Node test runner, existing Memory Lane core/CLI/MCP packages.

---

## File structure

- Create `packages/core/src/checkpoint-candidates.ts`
  - Shared classifier and metadata types.
  - No storage writes, no engine state, no config.
- Modify `packages/core/src/index.ts`
  - Export classifier/types.
- Modify `packages/core/test/checkpoint-candidates.test.ts`
  - Unit tests for release/merge/verification/docs/roadmap/major-fix/project kind and ambiguous negatives.
- Modify `packages/cli/src/formatters.ts`
  - Add checkpoint metadata to `review --json` memories.
  - Add compact human review labels for checkpoint candidates.
- Modify `packages/cli/test/cli.test.ts`
  - CLI human and JSON review coverage.
- Modify `packages/mcp-server/src/handlers.ts`
  - Add checkpoint metadata to `memory_review` memory objects.
- Modify `packages/mcp-server/test/handlers.test.ts`
  - MCP structured metadata coverage.
- Modify `README.md`, `ROADMAP.md`, `HANDOFF.md`, `skills/memory-lane/SKILL.md`
  - Document review labeling and non-goals.

---

## Design choice: no new kinds in Slice 1

The spec allowed narrower checkpoint kinds if low-risk. This plan intentionally does **not** add new `MemoryKind` values in the first implementation slice because adding kinds affects validation, imports/mirror, docs, CLI filters, MCP schemas, and downstream compatibility. Instead:

- `project_checkpoint` remains the storage-level checkpoint kind.
- Review metadata derives a subtype: `release`, `merge`, `verification`, `docs-sync`, `roadmap-decision`, `major-fix`, or `project`.
- Future capture slices can revisit narrower kinds if real use needs them.

---

### Task 1: Shared checkpoint candidate classifier

**Files:**
- Create: `packages/core/src/checkpoint-candidates.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/checkpoint-candidates.test.ts`

- [ ] **Step 1: Write failing classifier tests**

Create `packages/core/test/checkpoint-candidates.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { classifyCheckpointCandidate } from "../src/checkpoint-candidates.ts"
import type { MemoryRecord } from "../src/types.ts"

function memory(text: string, kind?: MemoryRecord["kind"]): MemoryRecord {
  return {
    id: "mem-1",
    status: "pending",
    text,
    category: "project",
    scope: { type: "project", key: "test-project" },
    source: "user-suggested",
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
    ...(kind ? { kind } : {}),
  }
}

test("classifies release checkpoint candidates", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Released v0.2.9.")), {
    detected: true,
    kind: "release",
    reason: "matched release version phrase",
  })
  assert.deepEqual(classifyCheckpointCandidate(memory("Tagged v1.0.0 after release verification."))?.kind, "release")
})

test("classifies merge checkpoint candidates", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Merged PR #13 adding prompt continuity intents.")), {
    detected: true,
    kind: "merge",
    reason: "matched merged pull request phrase",
  })
  assert.deepEqual(classifyCheckpointCandidate(memory("PR #14 merged after review."))?.kind, "merge")
})

test("classifies verification checkpoint candidates", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Tests passed and build passed for the lifecycle package.")), {
    detected: true,
    kind: "verification",
    reason: "matched verification passed phrase",
  })
})

test("classifies docs-sync checkpoint candidates", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Updated ROADMAP.md and HANDOFF.md after release docs sync.")), {
    detected: true,
    kind: "docs-sync",
    reason: "matched docs sync phrase",
  })
})

test("classifies roadmap-decision checkpoint candidates", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Roadmap decision: Phase 17 starts with checkpoint candidate review labeling.")), {
    detected: true,
    kind: "roadmap-decision",
    reason: "matched roadmap decision phrase",
  })
})

test("classifies major-fix checkpoint candidates", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Fixed blocker in prompt continuity guidance shell quoting.")), {
    detected: true,
    kind: "major-fix",
    reason: "matched major fix phrase",
  })
})

test("labels project_checkpoint kind even with simple text", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Prompt continuity checkpoint recorded.", "project_checkpoint")), {
    detected: true,
    kind: "project",
    reason: "kind is project_checkpoint",
  })
})

test("does not classify ambiguous memories", () => {
  assert.equal(classifyCheckpointCandidate(memory("Please test the release command later.")), undefined)
  assert.equal(classifyCheckpointCandidate(memory("We may merge this eventually.")), undefined)
  assert.equal(classifyCheckpointCandidate(memory("Remember to update docs sometime.")), undefined)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/checkpoint-candidates.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement classifier**

Create `packages/core/src/checkpoint-candidates.ts`:

```ts
import type { MemoryRecord } from "./types.js"

export type CheckpointCandidateKind =
  | "release"
  | "merge"
  | "verification"
  | "docs-sync"
  | "roadmap-decision"
  | "major-fix"
  | "project"

export interface CheckpointCandidateMetadata {
  detected: true
  kind: CheckpointCandidateKind
  reason: string
}

const CHECKPOINT_PATTERNS: Array<{ kind: CheckpointCandidateKind; reason: string; pattern: RegExp }> = [
  { kind: "release", reason: "matched release version phrase", pattern: /\b(?:released|tagged|published)\s+v?\d+\.\d+\.\d+(?:[-+][\w.]+)?\b/iu },
  { kind: "merge", reason: "matched merged pull request phrase", pattern: /\b(?:merged\s+(?:PR|pull request)\s*#?\d+|(?:PR|pull request)\s*#?\d+\s+merged|merged\s+pull\s+request)\b/iu },
  { kind: "verification", reason: "matched verification passed phrase", pattern: /\b(?:(?:tests?|build|verification)\s+passed|verified\s+release)\b/iu },
  { kind: "docs-sync", reason: "matched docs sync phrase", pattern: /\b(?:updated\s+(?:ROADMAP(?:\.md)?|HANDOFF(?:\.md)?)|docs?\s+synced|documentation\s+synced)\b/iu },
  { kind: "roadmap-decision", reason: "matched roadmap decision phrase", pattern: /\b(?:roadmap\s+decision|decided\s+next\s+phase|phase\s+\d+\s+starts\s+with)\b/iu },
  { kind: "major-fix", reason: "matched major fix phrase", pattern: /\b(?:fixed\s+(?:critical|blocker)|major\s+fix)\b/iu },
]

export function classifyCheckpointCandidate(memory: MemoryRecord): CheckpointCandidateMetadata | undefined {
  if (memory.kind === "project_checkpoint") {
    return { detected: true, kind: "project", reason: "kind is project_checkpoint" }
  }

  for (const candidate of CHECKPOINT_PATTERNS) {
    if (candidate.pattern.test(memory.text)) {
      return { detected: true, kind: candidate.kind, reason: candidate.reason }
    }
  }

  return undefined
}
```

- [ ] **Step 4: Export classifier from core**

Modify `packages/core/src/index.ts`:

```ts
export { classifyCheckpointCandidate, type CheckpointCandidateKind, type CheckpointCandidateMetadata } from "./checkpoint-candidates.js"
```

- [ ] **Step 5: Run core tests and build**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/checkpoint-candidates.test.ts
pnpm --filter @memory-lane/core build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add packages/core/src/checkpoint-candidates.ts packages/core/src/index.ts packages/core/test/checkpoint-candidates.test.ts
git commit -m "feat(core): classify checkpoint candidates"
```

---

### Task 2: CLI review labeling and JSON metadata

**Files:**
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Add failing CLI tests**

Append tests to the CLI integration suite in `packages/cli/test/cli.test.ts` near existing review tests:

```ts
it("review labels checkpoint candidates in human output", () => {
  const dir = tempDir()
  const env = {
    MEMORY_LANE_FILE: path.join(dir, "memory.jsonl"),
    MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"),
    MEMORY_LANE_CONFIG: path.join(dir, "config.json"),
  }
  run(["suggest", "Merged PR #13 adding prompt continuity intents.", "--category", "project"], env)
  run(["suggest", "Remember to check the release notes later.", "--category", "project"], env)

  const output = run(["review"], env)

  assert.match(output, /Checkpoint candidate: merge/u)
  assert.match(output, /matched merged pull request phrase/u)
  assert.match(output, /approve if this should become durable project continuity/u)
  const ambiguousLine = output.split(/\r?\n/u).find((line) => line.includes("Remember to check the release notes later"))
  assert.ok(ambiguousLine)
  assert.doesNotMatch(ambiguousLine, /Checkpoint candidate/u)
})

it("review --json includes structured checkpoint metadata", () => {
  const dir = tempDir()
  const env = {
    MEMORY_LANE_FILE: path.join(dir, "memory.jsonl"),
    MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"),
    MEMORY_LANE_CONFIG: path.join(dir, "config.json"),
  }
  run(["suggest", "Released v0.2.9.", "--category", "project"], env)
  run(["suggest", "Remember to test release command later.", "--category", "project"], env)

  const payload = JSON.parse(run(["review", "--json"], env))
  const release = payload.data.memories.find((memory: any) => memory.text === "Released v0.2.9.")
  const ambiguous = payload.data.memories.find((memory: any) => memory.text === "Remember to test release command later.")

  assert.deepEqual(release.checkpointCandidate, {
    detected: true,
    kind: "release",
    reason: "matched release version phrase",
  })
  assert.equal(ambiguous.checkpointCandidate, undefined)
})
```

- [ ] **Step 2: Run CLI tests to verify failure**

Run:

```bash
pnpm --filter @memory-lane/cli test -- test/cli.test.ts
```

Expected: FAIL because formatter does not add checkpoint labels/metadata yet.

- [ ] **Step 3: Add formatter enrichment helper**

Modify the import in `packages/cli/src/formatters.ts` to include classifier/types:

```ts
import { buildContinuityHints, classifyCheckpointCandidate, groupReviewMemories, isMetaTaskPromptText, revisionLabel, type CheckpointCandidateMetadata, type MemoryRecord, ... } from "@memory-lane/core"
```

Add helpers near `reviewPreview`:

```ts
type ReviewMemoryOutput = MemoryRecord & { checkpointCandidate?: CheckpointCandidateMetadata }

function withCheckpointCandidate(memory: MemoryRecord): ReviewMemoryOutput {
  const checkpointCandidate = classifyCheckpointCandidate(memory)
  return checkpointCandidate ? { ...memory, checkpointCandidate } : memory
}

function checkpointCandidateLines(memory: MemoryRecord): string[] {
  const checkpoint = classifyCheckpointCandidate(memory)
  if (!checkpoint) return []
  return [
    `    Checkpoint candidate: ${checkpoint.kind} — ${checkpoint.reason}`,
    "    Review: approve if this should become durable project continuity.",
  ]
}
```

- [ ] **Step 4: Add JSON metadata**

In `formatReviewMemories`, change the JSON branch:

```ts
  if (json) {
    return JSON.stringify({ ok: true, data: { memories: memories.map(withCheckpointCandidate), groups }, meta: meta({ count: memories.length, ...extraMeta }) }, null, 2)
  }
```

- [ ] **Step 5: Add human labels**

In the normal review loop, change memory line push to include checkpoint lines:

```ts
      lines.push(
        `  ${figures.bullet} ${reviewStatusLine(memory)}`,
        `    ${reviewPreview(memory)}  (saved ${formatDate(memory.createdAt)})`,
        ...checkpointCandidateLines(memory),
        `    Suggested: ${reviewAction(memory)}`,
      )
```

Do not add checkpoint labels to the `--suspect-meta` special view unless the existing loop is shared; suspect-meta output should stay focused on pollution cleanup.

- [ ] **Step 6: Run CLI tests and build**

Run:

```bash
pnpm --filter @memory-lane/cli test -- test/cli.test.ts
pnpm --filter @memory-lane/cli build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add packages/cli/src/formatters.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): label checkpoint candidates in review"
```

---

### Task 3: MCP review metadata

**Files:**
- Modify: `packages/mcp-server/src/handlers.ts`
- Modify: `packages/mcp-server/test/handlers.test.ts`

- [ ] **Step 1: Add failing MCP test**

Append a test near existing `memory_review` tests in `packages/mcp-server/test/handlers.test.ts`:

```ts
test("memory_review includes checkpoint candidate metadata", async () => {
  const engine = engineInTemp()
  engine.suggest("Merged PR #13 adding prompt continuity intents.", "project", "project")
  engine.suggest("Remember to check release notes later.", "project", "project")

  const result = await handleMemoryReview(engine, {})
  const payload = result.structuredContent as any
  const merge = payload.data.memories.find((memory: any) => memory.text === "Merged PR #13 adding prompt continuity intents.")
  const ambiguous = payload.data.memories.find((memory: any) => memory.text === "Remember to check release notes later.")

  assert.deepEqual(merge.checkpointCandidate, {
    detected: true,
    kind: "merge",
    reason: "matched merged pull request phrase",
  })
  assert.equal(ambiguous.checkpointCandidate, undefined)
})
```

If helper names differ, follow nearby MCP review tests exactly.

- [ ] **Step 2: Run MCP tests to verify failure**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test -- test/handlers.test.ts
```

Expected: FAIL because MCP review returns raw memories without checkpoint metadata.

- [ ] **Step 3: Enrich MCP review memories**

Modify import in `packages/mcp-server/src/handlers.ts`:

```ts
import { classifyCheckpointCandidate, groupReviewMemories, type CheckpointCandidateMetadata, type MemoryEngine, ... } from "@memory-lane/core"
```

Add helper near `filterReviewMemories`:

```ts
type ReviewMemoryOutput = MemoryRecord & { checkpointCandidate?: CheckpointCandidateMetadata }

function withCheckpointCandidate(memory: MemoryRecord): ReviewMemoryOutput {
  const checkpointCandidate = classifyCheckpointCandidate(memory)
  return checkpointCandidate ? { ...memory, checkpointCandidate } : memory
}
```

Update `handleMemoryReview` return:

```ts
    const memories = filterReviewMemories(engine.reviewPending(), filters)
    return jsonContent(envelope(engine, { memories: memories.map(withCheckpointCandidate), groups: groupReviewMemories(memories), notes: scopeNotes(engine) }, memories.length, filters))
```

Preserve group calculation from original memories so grouping remains unchanged.

- [ ] **Step 4: Run MCP tests and build**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test -- test/handlers.test.ts
pnpm --filter @memory-lane/mcp-server build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add packages/mcp-server/src/handlers.ts packages/mcp-server/test/handlers.test.ts
git commit -m "feat(mcp): expose checkpoint candidate review metadata"
```

---

### Task 4: Documentation, roadmap, and final verification

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`
- Modify: `skills/memory-lane/SKILL.md`

- [ ] **Step 1: Update README**

Add a short review/checkpoint subsection near review/dashboard docs:

```md
### Checkpoint candidate review labels

`memory-lane review` and MCP `memory_review` label pending memories that look like high-value project progress, such as merged PRs, releases, verification milestones, docs syncs, major fixes, or roadmap decisions. These labels are review-first: approve a checkpoint candidate only if it should become durable project continuity.

The labels do not create memories, approve memories, clean up duplicates, change recall ranking, or perform exact thread/workstream lookup. They only make review decisions easier.
```

- [ ] **Step 2: Update skill guidance**

Add to `skills/memory-lane/SKILL.md` near review guidance:

```md
Checkpoint candidate labels: when `memory-lane review` or MCP `memory_review` marks a pending memory as a checkpoint candidate, treat it as review-first project progress. Ask the user to approve/reject using normal review controls; do not assume it affects continuity until approved.
```

- [ ] **Step 3: Update ROADMAP**

In Phase 17, mark the first slice complete without marking capture/dedup complete:

```md
Completed Slice 1 scope:

1. Added conservative checkpoint candidate classification for pending memories that look like releases, merges, verification milestones, docs syncs, roadmap decisions, major fixes, or explicit `project_checkpoint` records.
2. Labeled checkpoint candidates in CLI `memory-lane review`, CLI `review --json`, and MCP `memory_review` with text-free structured metadata.
3. Kept Phase 17 review-first: no automatic checkpoint capture, dedup/debounce, background writes, recall ranking changes, workstream/thread ids, new config flags, MCP mutation tools, or lifecycle context changes were added.
```

Leave remaining Phase 17 todos for automatic capture, dedup/debounce, and future review improvements.

- [ ] **Step 4: Update HANDOFF**

Add a top Recent changes bullet:

```md
- Phase 17 Slice 1 checkpoint candidate review labeling is complete: pending memories that look like releases, merges, verification milestones, docs syncs, roadmap decisions, major fixes, or explicit `project_checkpoint` records are labeled in CLI review and MCP `memory_review` with text-free metadata. No automatic checkpoint capture, dedup/debounce, memory writes, recall ranking changes, workstream/thread ids, new config flags, lifecycle context changes, or MCP mutation tools were added. Next recommended Phase 17 item: review-first checkpoint capture from high-confidence evidence.
```

- [ ] **Step 5: Run full verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: all tests pass, all packages build, and no whitespace errors.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add README.md ROADMAP.md HANDOFF.md skills/memory-lane/SKILL.md
git commit -m "docs: document checkpoint candidate review labels"
```

- [ ] **Step 7: Final PR readiness check**

Run:

```bash
git status --short
git log --oneline --decorate --max-count=8
git diff --stat main..HEAD
```

Expected:

- working tree clean;
- commits include spec, plan, classifier, CLI, MCP, docs;
- diff includes only checkpoint candidate classifier/review labeling, tests, docs, and glossary/spec/plan files.

---

## Self-review checklist

- Spec coverage: Task 1 covers conservative classifier and kind convention. Task 2 covers CLI human/JSON review labels. Task 3 covers MCP `memory_review`. Task 4 covers docs/roadmap/handoff/final verification.
- Scope control: No task adds automatic checkpoint capture, dedup/debounce, writes, config flags, workstream/thread IDs, recall ranking changes, lifecycle context changes, MCP mutation tools, or bulk approval.
- Type consistency: `CheckpointCandidateKind`, `CheckpointCandidateMetadata`, `classifyCheckpointCandidate`, and `checkpointCandidate` are used consistently across core, CLI, and MCP tasks.
