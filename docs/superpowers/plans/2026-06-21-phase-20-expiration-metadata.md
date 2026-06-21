# Phase 20 Expiration Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional, validated memory freshness metadata (`expiresAt`, `staleAfterDays`, `capturedAt`) across core, CLI, MCP, and human rendering without changing recall, lifecycle injection, refresh, consolidation, or cleanup behavior.

**Architecture:** Freshness metadata is a nested optional object on `MemoryRecord` and `SaveInput`. Core owns validation and persistence; CLI/MCP only parse optional inputs and pass them through. Human formatting renders compact labels, while JSON naturally includes the stored object.

**Tech Stack:** TypeScript, Node test runner, pnpm workspace, Memory Lane core/CLI/MCP packages.

---

## Files

- Modify `packages/core/src/types.ts`: add `MemoryFreshness`, attach it to `MemoryRecord` and `SaveInput`.
- Modify `packages/core/src/storage-validation.ts`: validate and normalize optional `freshness` metadata.
- Modify `packages/core/src/engine-helpers.ts`: ensure new records persist freshness from save context/input.
- Modify `packages/core/src/engine.ts`: extend `suggest` with optional freshness and ensure saves persist it.
- Modify `packages/core/test/engine.test.ts`: cover valid/invalid metadata and historical records.
- Modify `packages/cli/src/index.ts`: parse `--expires-at`, `--stale-after-days`, `--captured-at` for save/suggest.
- Modify `packages/cli/src/formatters.ts`: add compact human freshness labels for list/review output.
- Modify `packages/cli/test/cli.test.ts`: cover CLI save/suggest freshness flags and invalid input.
- Modify `packages/mcp-server/src/types.ts`: add optional freshness fields to save/suggest inputs.
- Modify `packages/mcp-server/src/handlers.ts`: pass freshness metadata to core save/suggest.
- Modify `packages/mcp-server/src/server.ts`: update tool schemas for new fields.
- Modify `packages/mcp-server/test/handlers.test.ts`: cover MCP freshness inputs and invalid values.
- Modify docs: `README.md`, `ROADMAP.md`, `HANDOFF.md`, `CONTEXT.md` if terminology/status needs final polish.

## Task 1: Core type and validation foundation

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/storage-validation.ts`
- Test: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Add failing core tests for valid freshness metadata**

Add tests to `packages/core/test/engine.test.ts` near existing save/list validation tests:

```ts
test("save persists optional freshness metadata", () => {
  const engine = engineInTemp()
  const result = engine.save({
    text: "Temporary project status expires soon",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "project_fact",
    freshness: {
      expiresAt: "2026-07-01T00:00:00.000Z",
      staleAfterDays: 30,
      capturedAt: "2026-06-21T00:00:00.000Z",
    },
  })

  assert.equal(result.status, "saved")
  if (result.status !== "saved") throw new Error("expected saved")
  assert.deepEqual(result.memory.freshness, {
    expiresAt: "2026-07-01T00:00:00.000Z",
    staleAfterDays: 30,
    capturedAt: "2026-06-21T00:00:00.000Z",
  })
  assert.deepEqual(engine.list()[0].freshness, result.memory.freshness)
})
```

- [ ] **Step 2: Add failing core tests for invalid freshness metadata**

Add tests to `packages/core/test/engine.test.ts`:

```ts
test("save rejects invalid freshness metadata", () => {
  const engine = engineInTemp()

  assert.throws(() => engine.save({
    text: "Bad expires timestamp",
    status: "approved",
    freshness: { expiresAt: "tomorrow" },
  }), /Invalid freshness\.expiresAt/u)

  assert.throws(() => engine.save({
    text: "Bad captured timestamp",
    status: "approved",
    freshness: { capturedAt: "2026-06-21" },
  }), /Invalid freshness\.capturedAt/u)

  assert.throws(() => engine.save({
    text: "Bad stale days",
    status: "approved",
    freshness: { staleAfterDays: 0 },
  }), /Invalid freshness\.staleAfterDays/u)

  assert.throws(() => engine.save({
    text: "Empty freshness",
    status: "approved",
    freshness: {},
  }), /Invalid freshness/u)
})
```

- [ ] **Step 3: Add failing normalization test for historical records without freshness**

Add this test to `packages/core/test/engine.test.ts` or an existing storage-validation-focused block:

```ts
test("historical records without freshness remain valid", () => {
  const engine = engineInTemp()
  const result = engine.save({ text: "Historical shape remains valid", status: "approved" })
  assert.equal(result.status, "saved")
  const memory = engine.list()[0]
  assert.equal(memory.freshness, undefined)
})
```

- [ ] **Step 4: Run core tests and verify they fail**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: TypeScript/test failure because `freshness` is not defined or not persisted/validated.

- [ ] **Step 5: Add core types**

In `packages/core/src/types.ts`, add after `MemoryRevision`:

```ts
export interface MemoryFreshness {
  expiresAt?: string
  staleAfterDays?: number
  capturedAt?: string
}
```

Then add to `MemoryRecord`:

```ts
  freshness?: MemoryFreshness
```

And add to `SaveInput`:

```ts
  freshness?: MemoryFreshness
```

- [ ] **Step 6: Add validation helpers**

In `packages/core/src/storage-validation.ts`, import `MemoryFreshness` in the type import block:

```ts
MemoryLifecycleEvent, MemoryKind, MemoryRevisionActor, MemoryFreshness, SaveInput,
```

Add helper functions after `hasValidRevision`:

```ts
function hasAnyFreshnessField(freshness: MemoryFreshness): boolean {
  return freshness.expiresAt !== undefined
    || freshness.staleAfterDays !== undefined
    || freshness.capturedAt !== undefined
}

function hasValidFreshness(value: Record<string, unknown>): boolean {
  const freshness = value.freshness
  if (freshness === undefined) return true
  if (!isPlainObject(freshness)) return false
  const candidate = freshness as MemoryFreshness
  return hasAnyFreshnessField(candidate)
    && (candidate.expiresAt === undefined || isValidIsoTimestamp(candidate.expiresAt))
    && (candidate.capturedAt === undefined || isValidIsoTimestamp(candidate.capturedAt))
    && (candidate.staleAfterDays === undefined || (Number.isInteger(candidate.staleAfterDays) && candidate.staleAfterDays >= 1))
}
```

In `validateSaveInput`, add:

```ts
  if (input.freshness !== undefined && !hasValidFreshness({ freshness: input.freshness })) {
    if (input.freshness.expiresAt !== undefined && !isValidIsoTimestamp(input.freshness.expiresAt)) {
      throw new Error("Invalid freshness.expiresAt. Expected an ISO timestamp")
    }
    if (input.freshness.capturedAt !== undefined && !isValidIsoTimestamp(input.freshness.capturedAt)) {
      throw new Error("Invalid freshness.capturedAt. Expected an ISO timestamp")
    }
    if (input.freshness.staleAfterDays !== undefined && (!Number.isInteger(input.freshness.staleAfterDays) || input.freshness.staleAfterDays < 1)) {
      throw new Error("Invalid freshness.staleAfterDays. Expected a positive integer")
    }
    throw new Error("Invalid freshness. Expected at least one freshness field")
  }
```

In `normalizeMemoryRecord`, update the final validation condition:

```ts
  if (!hasValidProject(value) || !hasValidKind(value) || !hasValidProvenance(value) || !hasValidRevision(value) || !hasValidFreshness(value)) return undefined
```

- [ ] **Step 7: Ensure record creation persists freshness**

In `packages/core/src/engine-helpers.ts`, update the new-record object returned by `createNewMemory` so `input.freshness` is copied into the created memory only when defined:

```ts
...(input.freshness ? { freshness: input.freshness } : {}),
```

- [ ] **Step 8: Extend `MemoryEngine.suggest` with freshness**

In `packages/core/src/engine.ts`, change the `suggest` signature to accept optional freshness:

```ts
suggest(text: string, category?: MemoryCategory, scopeType?: MemoryScopeType, kind?: MemoryKind, status?: MemoryStatus, freshness?: MemoryFreshness): SaveResult {
  const nextStatus = status ?? "pending"
  if (nextStatus === "pending" && isMetaTaskPromptText(text)) return { status: "skipped", reason: "meta task prompt" }
  return this.save({ text, category, scopeType, source: "user-suggested", status: nextStatus, kind, freshness })
}
```

Add `MemoryFreshness` to the type import list at the top of `engine.ts`.

- [ ] **Step 9: Run core tests and build**

Run:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/core build
```

Expected: PASS.

## Task 2: CLI save/suggest parsing and formatting

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/formatters.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Add failing CLI tests**

Add CLI tests near existing save/suggest tests in `packages/cli/test/cli.test.ts`. Use the existing `run`, `runProcess`, and temp environment helpers from the file:

```ts
it("save accepts freshness flags", () => {
  const dir = tempDir()
  const env = { MEMORY_LANE_HOME: dir }
  const output = run([
    "save",
    "Temporary status",
    "--expires-at", "2026-07-01T00:00:00.000Z",
    "--stale-after-days", "30",
    "--captured-at", "2026-06-21T00:00:00.000Z",
    "--json",
  ], env)

  const payload = JSON.parse(output)
  assert.equal(payload.memory.freshness.expiresAt, "2026-07-01T00:00:00.000Z")
  assert.equal(payload.memory.freshness.staleAfterDays, 30)
  assert.equal(payload.memory.freshness.capturedAt, "2026-06-21T00:00:00.000Z")
})

it("suggest accepts freshness flags", () => {
  const dir = tempDir()
  const env = { MEMORY_LANE_HOME: dir }
  const output = run([
    "suggest",
    "Review this temporary fact later",
    "--stale-after-days", "14",
    "--json",
  ], env)

  const payload = JSON.parse(output)
  assert.equal(payload.memory.status, "pending")
  assert.equal(payload.memory.freshness.staleAfterDays, 14)
})

it("save rejects invalid stale-after-days", () => {
  const dir = tempDir()
  const result = runProcess(["save", "Bad stale days", "--stale-after-days", "0", "--json"], { env: { MEMORY_LANE_HOME: dir } })

  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /Invalid --stale-after-days/u)
})
```

- [ ] **Step 2: Run CLI tests and verify they fail**

Run:

```bash
pnpm --filter @memory-lane/cli test
```

Expected: FAIL because flags are not parsed/persisted.

- [ ] **Step 3: Add freshness parsing helpers**

In `packages/cli/src/index.ts`, add after `optionalNonNegativeInteger`:

```ts
function optionalPositiveInteger(argv: string[], name: string): number | undefined {
  const value = flag(argv, name)
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid --${name}: ${value}. Expected a positive integer.`)
  }
  return parsed
}

function optionalFreshness(argv: string[]) {
  const expiresAt = flag(argv, "expires-at")
  const capturedAt = flag(argv, "captured-at")
  const staleAfterDays = optionalPositiveInteger(argv, "stale-after-days")
  const freshness = {
    ...(expiresAt && expiresAt !== "true" ? { expiresAt } : {}),
    ...(capturedAt && capturedAt !== "true" ? { capturedAt } : {}),
    ...(staleAfterDays !== undefined ? { staleAfterDays } : {}),
  }
  return Object.keys(freshness).length ? freshness : undefined
}
```

- [ ] **Step 4: Pass freshness in save/suggest handlers**

In `handleSave`, add:

```ts
    freshness: optionalFreshness(ctx.argv),
```

In `handleSuggest`, pass `optionalFreshness(ctx.argv)` as the sixth `ctx.engine.suggest` argument:

```ts
  const result = ctx.engine.suggest(
    text,
    flag(ctx.argv, "category") as any,
    flag(ctx.argv, "scope") as any,
    undefined,
    flag(ctx.argv, "status") as any,
    optionalFreshness(ctx.argv),
  )
```

- [ ] **Step 5: Add compact human freshness formatting**

In `packages/cli/src/formatters.ts`, add a helper near `revisionSuffix`:

```ts
function freshnessSuffix(memory: MemoryRecord): string {
  const parts: string[] = []
  if (memory.freshness?.expiresAt) parts.push(`expires ${memory.freshness.expiresAt.slice(0, 10)}`)
  if (memory.freshness?.staleAfterDays) parts.push(`stale after ${memory.freshness.staleAfterDays}d`)
  if (memory.freshness?.capturedAt) parts.push(`captured ${memory.freshness.capturedAt.slice(0, 10)}`)
  return parts.length ? ` [${parts.join("; ")}]` : ""
}
```

Add `${freshnessSuffix(m)}` to human list/review lines next to `revisionSuffix(m)`.

- [ ] **Step 6: Run CLI tests**

Run:

```bash
pnpm --filter @memory-lane/cli test
```

Expected: PASS.

## Task 3: MCP save/suggest schema and handlers

**Files:**
- Modify: `packages/mcp-server/src/types.ts`
- Modify: `packages/mcp-server/src/handlers.ts`
- Modify: `packages/mcp-server/src/server.ts`
- Test: `packages/mcp-server/test/handlers.test.ts`

- [ ] **Step 1: Add failing MCP handler tests**

Add to `packages/mcp-server/test/handlers.test.ts` near save/suggest tests:

```ts
test("memory_save accepts freshness metadata", async () => {
  const engine = engineInTemp()
  const result = await handleMemorySave(engine, {
    text: "Temporary MCP fact",
    expiresAt: "2026-07-01T00:00:00.000Z",
    staleAfterDays: 30,
    capturedAt: "2026-06-21T00:00:00.000Z",
  })

  assert.equal(result.structuredContent.ok, true)
  if (!result.structuredContent.ok) throw new Error("expected ok")
  const memory = (result.structuredContent.data as any).memory
  assert.equal(memory.freshness.expiresAt, "2026-07-01T00:00:00.000Z")
  assert.equal(memory.freshness.staleAfterDays, 30)
  assert.equal(memory.freshness.capturedAt, "2026-06-21T00:00:00.000Z")
})

test("memory_suggest rejects invalid freshness metadata", async () => {
  const engine = engineInTemp()
  const result = await handleMemorySuggest(engine, {
    text: "Bad MCP freshness",
    staleAfterDays: 0,
  })

  assert.equal(result.structuredContent.ok, false)
  if (result.structuredContent.ok) throw new Error("expected error")
  assert.match(result.structuredContent.error, /Invalid freshness\.staleAfterDays/u)
})
```

- [ ] **Step 2: Run MCP tests and verify they fail**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test
```

Expected: FAIL because input types/handlers do not pass freshness.

- [ ] **Step 3: Extend MCP types**

In `packages/mcp-server/src/types.ts`, add to `SaveToolInput`:

```ts
  expiresAt?: string
  staleAfterDays?: number
  capturedAt?: string
```

- [ ] **Step 4: Pass freshness through handlers**

In `packages/mcp-server/src/handlers.ts`, add helper:

```ts
function inputFreshness(input: { expiresAt?: string; staleAfterDays?: number; capturedAt?: string }) {
  const freshness = {
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    ...(input.staleAfterDays !== undefined ? { staleAfterDays: input.staleAfterDays } : {}),
    ...(input.capturedAt ? { capturedAt: input.capturedAt } : {}),
  }
  return Object.keys(freshness).length ? freshness : undefined
}
```

In `handleMemorySave`, pass:

```ts
      freshness: inputFreshness(input),
```

In `handleMemorySuggest`, pass `inputFreshness(input)` as the sixth `engine.suggest` argument:

```ts
    const result = engine.suggest(input.text, input.category, input.scope, input.kind, input.status, inputFreshness(input))
```

- [ ] **Step 5: Update MCP server schemas**

In `packages/mcp-server/src/server.ts`, add optional schema properties to both `memory_save` and `memory_suggest` input schemas:

```ts
expiresAt: z.string().optional().describe("Optional ISO timestamp after which the memory content should be considered expired by future refresh behavior."),
staleAfterDays: z.number().int().positive().optional().describe("Optional positive day count after which the memory should be reconsidered as stale by future refresh behavior."),
capturedAt: z.string().optional().describe("Optional ISO timestamp for the event/session time represented by the memory."),
```

Use the existing schema style in the file.

- [ ] **Step 6: Run MCP tests**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test
```

Expected: PASS.

## Task 4: Docs and final verification

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`
- Already modified: `CONTEXT.md`

- [ ] **Step 1: Update README**

Add a short subsection near save/suggest documentation:

```md
### Freshness metadata

`memory-lane save` and `memory-lane suggest` accept optional time-awareness metadata:

```bash
memory-lane save "Temporary project status" --expires-at 2026-07-01T00:00:00.000Z
memory-lane suggest "Recheck this after launch" --stale-after-days 30
memory-lane save "Release note" --captured-at 2026-06-21T00:00:00.000Z
```

Freshness metadata is advisory in Phase 20 Slice 1. Memory Lane stores and displays it, but does not yet automatically delete, hide, refresh, or deprioritize memories.
```

- [ ] **Step 2: Update ROADMAP**

In Phase 20 todos, mark item 1 as implemented locally and note that refresh/consolidation behavior remains deferred:

```md
**Status:** Slice 1 implemented locally on `feature/phase-20-expiration-metadata`: optional `freshness` metadata adds `expiresAt`, `staleAfterDays`, and `capturedAt` to memory records/save surfaces with validation and compact rendering. No refresh, consolidation, recall/injection filtering, or cleanup behavior is added in this slice.
```

- [ ] **Step 3: Update HANDOFF**

Add a top recent-change bullet describing the local branch and verification state.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm build
pnpm test
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Review and PR**

Run a reviewer subagent focused on compatibility/privacy/no behavior drift. Then commit and open PR:

```bash
git status --short
git add CONTEXT.md README.md ROADMAP.md HANDOFF.md docs/superpowers/specs/2026-06-21-phase-20-expiration-metadata-design.md docs/superpowers/plans/2026-06-21-phase-20-expiration-metadata.md packages/core/src/types.ts packages/core/src/storage-validation.ts packages/core/src/engine-helpers.ts packages/core/src/engine.ts packages/core/test/engine.test.ts packages/cli/src/index.ts packages/cli/src/formatters.ts packages/cli/test/cli.test.ts packages/mcp-server/src/types.ts packages/mcp-server/src/handlers.ts packages/mcp-server/src/server.ts packages/mcp-server/test/handlers.test.ts
git commit -m "feat: add memory freshness metadata"
git push -u origin feature/phase-20-expiration-metadata
gh pr create --base main --head feature/phase-20-expiration-metadata --title "feat: add memory freshness metadata" --body "## Summary
- add optional freshness metadata to memory records and save inputs
- expose expiresAt/staleAfterDays/capturedAt through CLI and MCP save/suggest
- render compact freshness labels in human output

## Verification
- pnpm build
- pnpm test
- git diff --check
"
```

Stop for user merge after PR creation.

## Self-review notes

- Spec coverage: Tasks cover core type/validation/persistence, CLI flags/rendering, MCP inputs/schema/handlers, docs, and verification.
- Scope control: Plan explicitly avoids refresh, consolidation, automatic cleanup, and recall/injection filtering.
- Compatibility: Existing records without `freshness` remain valid; existing save/suggest callers do not need new fields.
