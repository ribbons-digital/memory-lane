# Phase 16 Slice 1 Freshness Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only freshness/status detection so Memory Lane can report approved visible-memory changes since a session/checkpoint timestamp without returning memory text.

**Architecture:** Add a core freshness helper that derives privacy-safe metadata from approved memories visible to the active project scope plus global scope. Surface the helper through `MemoryEngine.doctor()`, CLI `status`/`doctor --json --since`, and MCP `memory_status({ since })`. Keep lifecycle injection and memory mutation out of scope for this slice.

**Tech Stack:** TypeScript, Node test runner, existing `@memory-lane/core`, `@memory-lane/cli`, and `@memory-lane/mcp-server` packages.

---

## File Structure

- Create: `packages/core/src/freshness.ts`
  - Owns `FreshnessStatus`, `FreshnessMemoryMetadata`, ISO timestamp validation, visible approved-memory filtering, and grouped newer-memory counts.
- Modify: `packages/core/src/types.ts`
  - Exports freshness option/result types if keeping public core types centralized.
- Modify: `packages/core/src/index.ts`
  - Exports freshness helper/types.
- Modify: `packages/core/src/engine.ts`
  - Adds `freshnessStatus(opts?: { since?: string })` and includes `freshness` in `doctor(opts?: { freshnessSince?: string })`.
- Modify: `packages/cli/src/index.ts`
  - Parses `--since <ISO>` for `doctor` and `status`, passes it into `engine.doctor()`.
- Modify: `packages/cli/src/formatters.ts`
  - Adds compact human freshness output and preserves JSON structure.
- Modify: `packages/mcp-server/src/types.ts`
  - Extends `StatusToolInput` with `since?: string`.
- Modify: `packages/mcp-server/src/server.ts`
  - Adds optional `since` input schema to `memory_status`.
- Modify: `packages/mcp-server/src/handlers.ts`
  - Passes `since` into `engine.doctor({ freshnessSince: input.since })`.
- Test: `packages/core/test/freshness.test.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp-server/test/handlers.test.ts`
- Docs: `README.md`, `skills/memory-lane/SKILL.md`, `ROADMAP.md`, `HANDOFF.md`

---

### Task 1: Core Freshness Helper

**Files:**
- Create: `packages/core/src/freshness.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/freshness.test.ts`

- [ ] **Step 1: Write failing core tests**

Create `packages/core/test/freshness.test.ts`:

```ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildFreshnessStatus } from "../src/freshness.js"
import type { MemoryRecord } from "../src/types.js"

function memory(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: overrides.id ?? "mem-1",
    status: overrides.status ?? "approved",
    text: overrides.text ?? "Private memory body that must never be returned",
    category: overrides.category ?? "project",
    scope: overrides.scope ?? { type: "project", key: "project-a" },
    source: overrides.source ?? "manual",
    createdAt: overrides.createdAt ?? "2026-06-18T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-18T00:00:00.000Z",
    kind: overrides.kind ?? "project_fact",
    project: overrides.project,
    provenance: overrides.provenance,
  }
}

describe("buildFreshnessStatus", () => {
  it("reports visible approved freshness metadata without memory text", () => {
    const memories = [
      memory({ id: "project-new", updatedAt: "2026-06-18T10:00:00.000Z", scope: { type: "project", key: "project-a" }, kind: "project_checkpoint", source: "session-summary", provenance: { adapter: "pi", lifecycleEvent: "session_end" } }),
      memory({ id: "global-pref", updatedAt: "2026-06-18T09:00:00.000Z", scope: { type: "global" }, category: "preference", kind: "preference" }),
      memory({ id: "old", updatedAt: "2026-06-17T09:00:00.000Z", scope: { type: "project", key: "project-a" } }),
      memory({ id: "other-project", updatedAt: "2026-06-18T11:00:00.000Z", scope: { type: "project", key: "project-b" } }),
      memory({ id: "pending", status: "pending", updatedAt: "2026-06-18T12:00:00.000Z", scope: { type: "project", key: "project-a" } }),
    ]

    const status = buildFreshnessStatus(memories, { projectScopeKey: "project-a", since: "2026-06-18T08:00:00.000Z" })
    const serialized = JSON.stringify(status)

    assert.equal(status.projectScope, "project-a")
    assert.equal(status.visibleApprovedCount, 3)
    assert.equal(status.newerApprovedCount, 2)
    assert.equal(status.newerProjectApprovedCount, 1)
    assert.equal(status.newerGlobalApprovedCount, 1)
    assert.equal(status.newerGlobalPreferenceCount, 1)
    assert.equal(status.latestApproved?.id, "project-new")
    assert.equal(status.latestProjectApproved?.id, "project-new")
    assert.equal(status.latestGlobalApproved?.id, "global-pref")
    assert.deepEqual(status.newerByKind, { project_checkpoint: 1, preference: 1 })
    assert.deepEqual(status.newerBySource, { "session-summary": 1, manual: 1 })
    assert.deepEqual(status.newerByProvenance, { "pi/session_end": 1, none: 1 })
    assert.deepEqual(status.newestNewerApproved.map((m) => m.id), ["project-new", "global-pref"])
    assert.doesNotMatch(serialized, /Private memory body/u)
    assert.doesNotMatch(serialized, /other-project/u)
    assert.doesNotMatch(serialized, /pending/u)
  })

  it("reports no-project scope as global-only visibility", () => {
    const status = buildFreshnessStatus([
      memory({ id: "global", scope: { type: "global" }, updatedAt: "2026-06-18T01:00:00.000Z" }),
      memory({ id: "project", scope: { type: "project", key: "project-a" }, updatedAt: "2026-06-18T02:00:00.000Z" }),
    ], { projectScopeKey: undefined, since: "2026-06-18T00:00:00.000Z" })

    assert.equal(status.projectScope, "none")
    assert.equal(status.visibleApprovedCount, 1)
    assert.equal(status.newerApprovedCount, 1)
    assert.equal(status.newestNewerApproved[0]?.id, "global")
  })

  it("rejects invalid since timestamps", () => {
    assert.throws(
      () => buildFreshnessStatus([], { projectScopeKey: "project-a", since: "not-a-date" }),
      /Invalid since timestamp/u,
    )
  })
})
```

- [ ] **Step 2: Run the core freshness test to verify it fails**

Run:

```bash
pnpm --filter @memory-lane/core test -- freshness.test.ts
```

Expected: FAIL because `packages/core/src/freshness.ts` does not exist.

- [ ] **Step 3: Add freshness types**

Modify `packages/core/src/types.ts` after `MemoryRecord`:

```ts
export interface FreshnessMemoryMetadata {
  id: string
  status: Extract<MemoryStatus, "approved">
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  kind?: MemoryKind
  provenance?: MemoryProvenance
}

export interface FreshnessStatus {
  projectScope: string | "none"
  referenceTime?: string
  visibleApprovedCount: number
  latestApproved?: FreshnessMemoryMetadata
  latestProjectApproved?: FreshnessMemoryMetadata
  latestGlobalApproved?: FreshnessMemoryMetadata
  newerApprovedCount: number
  newerProjectApprovedCount: number
  newerGlobalApprovedCount: number
  newerGlobalPreferenceCount: number
  newerByKind: Record<string, number>
  newerBySource: Record<string, number>
  newerByProvenance: Record<string, number>
  newestNewerApproved: FreshnessMemoryMetadata[]
  notice?: string
}

export interface FreshnessStatusOptions {
  projectScopeKey?: string
  since?: string
  maxNewerMetadata?: number
}
```

- [ ] **Step 4: Implement `packages/core/src/freshness.ts`**

```ts
import type { FreshnessMemoryMetadata, FreshnessStatus, FreshnessStatusOptions, MemoryRecord } from "./types.js"

function isValidIsoTimestamp(value: string): boolean {
  const ms = Date.parse(value)
  return Number.isFinite(ms) && new Date(ms).toISOString() === value
}

function assertValidSince(since?: string): void {
  if (since !== undefined && !isValidIsoTimestamp(since)) {
    throw new Error(`Invalid since timestamp: ${since}. Expected an ISO timestamp such as 2026-06-18T00:00:00.000Z`)
  }
}

function visibleApproved(memory: MemoryRecord, projectScopeKey?: string): boolean {
  if (memory.status !== "approved") return false
  if (memory.scope.type === "global") return true
  return Boolean(projectScopeKey) && memory.scope.key === projectScopeKey
}

function metadata(memory: MemoryRecord): FreshnessMemoryMetadata {
  return {
    id: memory.id,
    status: "approved",
    category: memory.category,
    scope: memory.scope,
    source: memory.source,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    kind: memory.kind,
    provenance: memory.provenance,
  }
}

function provenanceKey(memory: MemoryRecord): string {
  return memory.provenance ? `${memory.provenance.adapter}/${memory.provenance.lifecycleEvent}` : "none"
}

function increment(counts: Record<string, number>, key: string | undefined): void {
  counts[key ?? "misc"] = (counts[key ?? "misc"] ?? 0) + 1
}

function latest(memories: MemoryRecord[]): FreshnessMemoryMetadata | undefined {
  const [first] = [...memories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return first ? metadata(first) : undefined
}

export function buildFreshnessStatus(memories: MemoryRecord[], options: FreshnessStatusOptions = {}): FreshnessStatus {
  assertValidSince(options.since)

  const maxNewerMetadata = options.maxNewerMetadata ?? 5
  const visible = memories.filter((memory) => visibleApproved(memory, options.projectScopeKey))
  const newer = options.since ? visible.filter((memory) => memory.updatedAt > options.since!) : []
  const newerSorted = [...newer].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const newerByKind: Record<string, number> = {}
  const newerBySource: Record<string, number> = {}
  const newerByProvenance: Record<string, number> = {}
  for (const memory of newer) {
    increment(newerByKind, memory.kind)
    increment(newerBySource, memory.source)
    increment(newerByProvenance, provenanceKey(memory))
  }

  const newerProjectApprovedCount = newer.filter((memory) => memory.scope.type === "project").length
  const newerGlobalApprovedCount = newer.filter((memory) => memory.scope.type === "global").length
  const newerGlobalPreferenceCount = newer.filter((memory) => memory.scope.type === "global" && memory.category === "preference").length

  return {
    projectScope: options.projectScopeKey ?? "none",
    referenceTime: options.since,
    visibleApprovedCount: visible.length,
    latestApproved: latest(visible),
    latestProjectApproved: latest(visible.filter((memory) => memory.scope.type === "project")),
    latestGlobalApproved: latest(visible.filter((memory) => memory.scope.type === "global")),
    newerApprovedCount: newer.length,
    newerProjectApprovedCount,
    newerGlobalApprovedCount,
    newerGlobalPreferenceCount,
    newerByKind,
    newerBySource,
    newerByProvenance,
    newestNewerApproved: newerSorted.slice(0, maxNewerMetadata).map(metadata),
    notice: options.since && newer.length > 0
      ? `${newer.length} approved Memory Lane ${newer.length === 1 ? "memory has" : "memories have"} changed since ${options.since}. Use memory-lane list/recall for details if relevant.`
      : undefined,
  }
}
```

- [ ] **Step 5: Export freshness helper**

Modify `packages/core/src/index.ts`:

```ts
export { buildFreshnessStatus } from "./freshness.js"
```

- [ ] **Step 6: Run the core freshness test to verify it passes**

Run:

```bash
pnpm --filter @memory-lane/core test -- freshness.test.ts
```

Expected: PASS for `freshness.test.ts`.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/core/src/freshness.ts packages/core/src/types.ts packages/core/src/index.ts packages/core/test/freshness.test.ts
git commit -m "feat(core): add read-only memory freshness helper"
```

---

### Task 2: Engine Doctor/Status Integration

**Files:**
- Modify: `packages/core/src/engine.ts`
- Test: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Write failing engine tests**

Append to `packages/core/test/engine.test.ts` inside the existing `describe("MemoryEngine", () => { ... })` block:

```ts
  it("doctor includes freshness metadata without memory text", () => {
    const e = engine()
    e.save({ text: "Fresh private body must not leak", status: "approved", category: "project", scopeType: "global", kind: "project_checkpoint" })
    e.save({ text: "Pending private body must not leak", status: "pending", category: "project", scopeType: "global" })

    const report = e.doctor({ freshnessSince: "2026-01-01T00:00:00.000Z" }) as any
    const serialized = JSON.stringify(report)

    assert.equal(report.freshness.projectScope, e.getProjectScope()?.key ?? "none")
    assert.equal(report.freshness.visibleApprovedCount, 1)
    assert.equal(report.freshness.newerApprovedCount, 1)
    assert.equal(report.freshness.newestNewerApproved.length, 1)
    assert.equal(report.freshness.newestNewerApproved[0].status, "approved")
    assert.doesNotMatch(serialized, /Fresh private body/u)
    assert.doesNotMatch(serialized, /Pending private body/u)
  })

  it("freshnessStatus rejects invalid since timestamps", () => {
    const e = engine()
    assert.throws(() => e.freshnessStatus({ since: "yesterday" }), /Invalid since timestamp/u)
  })
```

- [ ] **Step 2: Run engine tests to verify failure**

Run:

```bash
pnpm --filter @memory-lane/core test -- engine.test.ts
```

Expected: FAIL because `doctor` does not accept options and `freshnessStatus` does not exist.

- [ ] **Step 3: Implement engine method and doctor option**

Modify imports in `packages/core/src/engine.ts`:

```ts
import { buildFreshnessStatus } from "./freshness.js"
```

Add `FreshnessStatus` / `FreshnessStatusOptions` to the type import from `./types.js`.

Add a method before `doctor()`:

```ts
  freshnessStatus(opts?: { since?: string }): FreshnessStatus {
    return buildFreshnessStatus(this.store.list(), {
      projectScopeKey: this.scope?.key,
      since: opts?.since,
    })
  }
```

Change the doctor signature and return object:

```ts
  /** Generate a diagnostic report. */
  doctor(opts?: { freshnessSince?: string }): Record<string, unknown> {
```

Add this field near `projectScope`:

```ts
      freshness: this.freshnessStatus({ since: opts?.freshnessSince }),
```

- [ ] **Step 4: Run engine tests to verify pass**

Run:

```bash
pnpm --filter @memory-lane/core test -- engine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/core/src/engine.ts packages/core/test/engine.test.ts
git commit -m "feat(core): expose freshness in doctor status"
```

---

### Task 3: CLI `--since` Surface

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/formatters.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Append near existing doctor/status tests in `packages/cli/test/cli.test.ts`:

```ts
  it("status --json --since reports freshness without memory text", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    run(["save", "Fresh CLI private body must not leak", "--status", "approved", "--scope", "global"], env)
    run(["save", "Pending CLI private body must not leak", "--status", "pending", "--scope", "global"], env)

    const output = run(["status", "--json", "--since", "2026-01-01T00:00:00.000Z"], env)
    const parsed = JSON.parse(output)
    const serialized = JSON.stringify(parsed)

    assert.equal(parsed.ok, true)
    assert.equal(parsed.data.freshness.newerApprovedCount, 1)
    assert.equal(parsed.data.freshness.newestNewerApproved.length, 1)
    assert.doesNotMatch(serialized, /Fresh CLI private body/u)
    assert.doesNotMatch(serialized, /Pending CLI private body/u)
  })

  it("doctor human output renders freshness summary", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    run(["save", "Fresh human private body must not leak", "--status", "approved", "--scope", "global"], env)

    const output = run(["doctor", "--since", "2026-01-01T00:00:00.000Z"], env)

    assert.match(output, /Freshness:/u)
    assert.match(output, /newer approved: 1/u)
    assert.doesNotMatch(output, /Fresh human private body/u)
  })

  it("status --json rejects invalid since", () => {
    const result = runProcess(["status", "--json", "--since", "not-a-date"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
    })

    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /Invalid since timestamp/u)
  })
```

- [ ] **Step 2: Run CLI tests to verify failure**

Run:

```bash
pnpm --filter @memory-lane/cli test -- cli.test.ts
```

Expected: FAIL because `--since` is ignored or not passed to doctor/status.

- [ ] **Step 3: Parse `--since` and pass to doctor/status**

In `packages/cli/src/index.ts`, update `handleDoctor`:

```ts
function handleDoctor(ctx: CliContext): void {
  const since = flag(ctx.argv, "since")
  console.log(formatDoctor(ctx.engine.doctor({ freshnessSince: since }), ctx.json))
  printInitPrompt(ctx.json)
}
```

Update `handleStatus`:

```ts
function handleStatus(ctx: CliContext): void {
  const since = flag(ctx.argv, "since")
  const report = ctx.engine.doctor({ freshnessSince: since })
  if (ctx.json) {
    console.log(formatDoctor(report, true))
    return
  }
  const r = report as any
  console.log(`Total: ${r.totalMemories}, Approved: ${r.approvedMemories}, Pending: ${r.pendingMemories}, Embeddings: ${r.embeddingCount}`)
  if (r.freshness?.referenceTime) {
    console.log(`Freshness since ${r.freshness.referenceTime}: newer approved ${r.freshness.newerApprovedCount}`)
  }
}
```

- [ ] **Step 4: Render freshness in human doctor output**

In `packages/cli/src/formatters.ts`, add a helper:

```ts
function formatFreshnessDoctor(report: Record<string, unknown>): string[] {
  const freshness = report.freshness as any
  if (!freshness) return []
  const lines = [
    "Freshness:",
    `  project scope: ${freshness.projectScope}`,
    `  visible approved: ${freshness.visibleApprovedCount}`,
  ]
  if (freshness.referenceTime) {
    lines.push(`  since: ${freshness.referenceTime}`)
    lines.push(`  newer approved: ${freshness.newerApprovedCount}`)
    lines.push(`  newer project approved: ${freshness.newerProjectApprovedCount}`)
    lines.push(`  newer global approved: ${freshness.newerGlobalApprovedCount}`)
    lines.push(`  newer global preferences: ${freshness.newerGlobalPreferenceCount}`)
  }
  if (freshness.latestApproved?.updatedAt) {
    lines.push(`  latest approved update: ${freshness.latestApproved.updatedAt}`)
  }
  return lines
}
```

Then include it in `formatDoctor` human output before generic object rendering, and add `"freshness"` to any existing set of keys excluded from generic rendering so it does not print as `[object Object]`.

- [ ] **Step 5: Run CLI tests to verify pass**

Run:

```bash
pnpm --filter @memory-lane/cli test -- cli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add packages/cli/src/index.ts packages/cli/src/formatters.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): report memory freshness in status"
```

---

### Task 4: MCP `memory_status({ since })` Surface

**Files:**
- Modify: `packages/mcp-server/src/types.ts`
- Modify: `packages/mcp-server/src/server.ts`
- Modify: `packages/mcp-server/src/handlers.ts`
- Test: `packages/mcp-server/test/handlers.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Append near existing `memory_status` tests in `packages/mcp-server/test/handlers.test.ts`:

```ts
test("memory_status reports freshness since timestamp without memory text", async () => {
  const engine = engineInTemp(tempDir())
  engine.save({ text: "Fresh MCP private body must not leak", status: "approved", category: "project", scopeType: "global", kind: "project_checkpoint" })
  engine.save({ text: "Pending MCP private body must not leak", status: "pending", category: "project", scopeType: "global" })

  const result = parseToolResult(await handleMemoryStatus(engine, { since: "2026-01-01T00:00:00.000Z" }))
  const serialized = JSON.stringify(result)

  assert.equal(result.ok, true)
  assert.equal(result.data.status.freshness.newerApprovedCount, 1)
  assert.equal(result.data.status.freshness.newestNewerApproved.length, 1)
  assert.doesNotMatch(serialized, /Fresh MCP private body/u)
  assert.doesNotMatch(serialized, /Pending MCP private body/u)
})

test("memory_status rejects invalid since timestamp", async () => {
  const engine = engineInTemp(tempDir())

  const result = parseToolResult(await handleMemoryStatus(engine, { since: "invalid-date" }))

  assert.equal(result.ok, false)
  assert.match(result.error, /Invalid since timestamp/u)
})
```

- [ ] **Step 2: Run MCP tests to verify failure**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test -- handlers.test.ts
```

Expected: FAIL because `StatusToolInput` does not accept/use `since`.

- [ ] **Step 3: Extend MCP status input type**

Modify `packages/mcp-server/src/types.ts`:

```ts
export interface StatusToolInput extends ProjectPathInput {
  since?: string
}
```

- [ ] **Step 4: Extend MCP server schema**

In `packages/mcp-server/src/server.ts`, update the `memory_status` input schema to include:

```ts
since: z.string().optional().describe("Optional ISO timestamp. When provided, status includes approved visible-memory freshness counts since this checkpoint."),
```

- [ ] **Step 5: Pass `since` to doctor**

Modify `statusData` in `packages/mcp-server/src/handlers.ts`:

```ts
function statusData(engine: MemoryEngine, since?: string): { status: Record<string, unknown>; notes: string[] } {
  return { status: engine.doctor({ freshnessSince: since }), notes: [...STATUS_NOTES, ...scopeNotes(engine)] }
}
```

Modify `handleMemoryStatus`:

```ts
return jsonContent(envelope(engine, statusData(engine, input.since)))
```

- [ ] **Step 6: Run MCP tests to verify pass**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test -- handlers.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add packages/mcp-server/src/types.ts packages/mcp-server/src/server.ts packages/mcp-server/src/handlers.ts packages/mcp-server/test/handlers.test.ts
git commit -m "feat(mcp): expose memory freshness status"
```

---

### Task 5: Docs, Roadmap/Handoff, and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `skills/memory-lane/SKILL.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update README status docs**

Add a short subsection near status/doctor docs:

```md
### Freshness status

`memory-lane status --json --since <ISO timestamp>` and `memory-lane doctor --json --since <ISO timestamp>` include a read-only `freshness` object. It reports counts and metadata for approved memories visible to the current project scope plus global memories that were updated after the timestamp. Freshness output intentionally excludes memory text; use `memory-lane list --json` or targeted recall when you need the actual memory bodies.
```

- [ ] **Step 2: Update skill docs**

In `skills/memory-lane/SKILL.md`, add under CLI commands:

```md
memory-lane status --json --since 2026-06-18T00:00:00.000Z
memory-lane doctor --json --since 2026-06-18T00:00:00.000Z
```

And note:

```md
Freshness status is read-only and memory-text-free. It reports approved visible-memory changes since a checkpoint timestamp so agents can notice possible newer continuity without injecting large memory bodies.
```

- [ ] **Step 3: Update ROADMAP.md**

In Phase 16, mark Slice 1 complete once implementation is verified:

```md
Completed Slice 1 scope:

1. Added read-only freshness helper for approved memories visible to the current project plus global scope.
2. Exposed freshness metadata through `memory-lane status --json --since`, `memory-lane doctor --json --since`, and MCP `memory_status({ since })`.
3. Kept freshness output memory-text-free: only counts and metadata such as ids, timestamps, scope, source, kind, and provenance are returned.
4. Kept lifecycle notices, canonical selection, revision/supersede operations, duplicate hints, and memory writes out of this slice.
```

- [ ] **Step 4: Update HANDOFF.md**

Add recent-change notes:

```md
- Phase 16 Slice 1 read-only freshness/status detection is implemented: core freshness metadata helper, CLI `status`/`doctor --json --since`, and MCP `memory_status({ since })` now report approved visible-memory changes since a checkpoint timestamp without returning memory text.
```

Add suggested next step:

```md
- Next Phase 16 slice: canonical workflow / operating-agreement memories, keeping revision/supersede operations and lifecycle notices for later slices unless explicitly approved.
```

- [ ] **Step 5: Run focused package tests**

Run:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
```

Expected: all pass.

- [ ] **Step 6: Run full verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: all pass, no whitespace errors.

- [ ] **Step 7: Self-review against scope**

Check these conditions manually:

```md
- Freshness is read-only and writes no memories.
- No lifecycle injection changes were made.
- No memory text is included in freshness output.
- Pending/rejected/deleted memories are excluded.
- Other-project memories are excluded when a project scope is active.
- Global approved memories remain visible.
- Invalid `--since`/`since` inputs fail clearly.
- ROADMAP.md and HANDOFF.md reflect completed slice and next slice.
```

- [ ] **Step 8: Commit Task 5**

```bash
git add README.md skills/memory-lane/SKILL.md ROADMAP.md HANDOFF.md
git commit -m "docs: document memory freshness status"
```

---

## Out of Scope for This Slice

- Lifecycle bounded notices during `SessionStart` or `UserPromptSubmit`.
- Canonical workflow / operating-agreement selection.
- Update, replace, supersede, or revision commands.
- Duplicate/stale guidance hints.
- Memory body injection or session-summary promotion.
- Any automatic writes, consolidation, or cleanup.

## Final Acceptance Criteria

- `memory-lane status --json --since <ISO>` returns `data.freshness` with approved visible-memory counts and metadata.
- `memory-lane doctor --json --since <ISO>` returns the same freshness object.
- MCP `memory_status` accepts optional `since` and returns freshness through `data.status.freshness`.
- Freshness output contains no memory `text` fields or previews.
- Tests cover project/global scope, pending exclusion, invalid timestamps, CLI output, and MCP output.
- `pnpm test`, `pnpm build`, and `git diff --check` pass.
