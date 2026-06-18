# Memory Revision Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit CLI-first, append-only update/replace/supersede primitives for Memory Lane records.

**Architecture:** Extend the core `MemoryRecord` model with compact latest revision metadata, keep all writes append-only through `MemoryEngine`, and expose three CLI commands (`update`, `replace`, `supersede`) with dry-run and safe validation. Do not change MCP mutation surface, lifecycle injection, compaction, or recall/agreement selection behavior.

**Tech Stack:** TypeScript, Node test runner, pnpm workspace, existing Memory Lane core/CLI packages.

---

## Spec and scope

Implement approved spec: `docs/superpowers/specs/2026-06-18-memory-revision-primitives-design.md`.

Hard non-goals:

- No MCP mutation tools for update/replace/supersede.
- No lifecycle injection changes.
- No filtering/deprioritizing superseded memories in recall/context/agreements.
- No history command.
- No compaction changes.
- No Obsidian-specific behavior changes beyond existing mutation mirror sync.
- No `--force`.
- No scope/source/provenance migration.
- No `replace --from`.

## File map

- Modify: `packages/core/src/types.ts`
  - Add `MemoryRevisionActor`, `MemoryRevision`, revision result/preview types, and extend `MemoryRecord`, `UpdateInput`, `SaveInput` as needed.
- Modify: `packages/core/src/storage-validation.ts`
  - Validate/normalize optional `revision` metadata.
- Create: `packages/core/src/revisions.ts`
  - Pure helpers for revision labels, warnings, preview validation, and result shaping.
- Modify: `packages/core/src/engine.ts`
  - Extend `update`, add `previewUpdate`, `supersede`, `replace`, and append-only all-or-nothing mutation helpers.
- Modify: `packages/core/src/index.ts`
  - Export revision helpers/types.
- Modify: `packages/core/test/engine.test.ts`
  - Core mutation, dry-run, validation, embedding, and mirror-warning tests.
- Modify: `packages/core/test/storage.test.ts`
  - Storage normalization tests for revision metadata.
- Modify: `packages/cli/src/index.ts`
  - Add `update`, `supersede`, and `replace` command handlers and arg parsing.
- Modify: `packages/cli/src/formatters.ts`
  - Add revision labels and format update/replace/supersede result output.
- Modify: `packages/cli/test/cli.test.ts`
  - CLI behavior tests for commands, dry-run, `--yes`, stdin, labels, JSON output.
- Modify: `README.md`
  - Document commands and safety boundaries.
- Modify: `skills/memory-lane/SKILL.md`
  - Guide agents to prefer update/replace/supersede over duplicate saves.
- Modify: `ROADMAP.md`
  - Mark Phase 16 Slice 3 complete after implementation.
- Modify: `HANDOFF.md`
  - Record completion and next recommended Slice 4.

---

### Task 1: Core revision metadata types and storage validation

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/storage-validation.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/storage.test.ts`

- [ ] **Step 1: Add failing storage tests for revision metadata**

Append tests to `packages/core/test/storage.test.ts` inside the existing `MemoryStore` suite:

```ts
  it("storage preserves valid revision metadata", () => {
    const file = path.join(dir, "memories.jsonl")
    const store = createMemoryStore(file)
    const record: MemoryRecord = {
      id: "revision-valid",
      text: "Refined workflow rule",
      category: "project",
      scope: { type: "project", key: "project-a" },
      status: "approved",
      source: "manual",
      kind: "workflow_rule",
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T01:00:00.000Z",
      revision: {
        supersedes: ["old-a", "old-b"],
        reason: "merged duplicate workflow memories",
        revisedAt: "2026-06-18T01:00:00.000Z",
        revisedBy: "cli",
      },
    }

    store.append(record)

    assert.deepEqual(store.list()[0].revision, record.revision)
  })

  it("storage skips records with invalid revision metadata", () => {
    const file = path.join(dir, "memories.jsonl")
    fs.writeFileSync(file, JSON.stringify({
      id: "revision-invalid",
      text: "Bad revision",
      category: "project",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
      revision: { supersededBy: "new-id", revisedAt: "not-an-iso-date", revisedBy: "robot" },
    }) + "\n", "utf8")

    const store = createMemoryStore(file)

    assert.equal(store.list().length, 0)
    assert.equal(store.diagnostics().invalidRows, 1)
  })
```

If `storage.test.ts` does not currently import `MemoryRecord`, add:

```ts
import type { MemoryRecord } from "../src/types.js"
```

- [ ] **Step 2: Run storage tests and verify they fail**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/storage.test.ts
```

Expected: FAIL because `MemoryRecord.revision` and revision validation do not exist.

- [ ] **Step 3: Add revision types to `types.ts`**

In `packages/core/src/types.ts`, after `MemoryProvenance`, add:

```ts
export type MemoryRevisionActor = "manual" | "cli" | "mcp"

export interface MemoryRevision {
  supersedes?: string[]
  supersededBy?: string
  reason?: string
  revisedAt: string
  revisedBy: MemoryRevisionActor
}
```

Add `revision?: MemoryRevision` to `MemoryRecord` after `provenance?: MemoryProvenance`.

Extend `SaveInput` with optional revision support because `replace --status pending` and successor creation need to create a memory with forward revision intent:

```ts
  revision?: MemoryRevision
```

Extend `UpdateInput` with:

```ts
  reason?: string
  revisedBy?: MemoryRevisionActor
```

Add result types near `MemoryMutationResult`:

```ts
export interface RevisionWarning {
  code: "cross-scope" | "cross-category"
  message: string
  memoryId?: string
}

export interface UpdatePreview {
  dryRun: true
  current: MemoryRecord
  proposed: MemoryRecord
  warnings: string[]
}

export interface SupersedeResult {
  dryRun: boolean
  successor: MemoryRecord
  superseded: MemoryRecord[]
  warnings: RevisionWarning[]
  mirrorWarnings?: string[]
}

export interface ReplaceResult extends SupersedeResult {
  successorCreated: boolean
}
```

- [ ] **Step 4: Validate optional revision metadata**

In `packages/core/src/storage-validation.ts`, update the type import to include `MemoryRevisionActor`.

Add constants after `VALID_LIFECYCLE_EVENTS`:

```ts
export const VALID_REVISION_ACTORS = new Set<MemoryRevisionActor>(["manual", "cli", "mcp"])
```

Add helpers near `hasValidProvenance()`:

```ts
function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function hasValidRevision(value: Record<string, unknown>): boolean {
  const revision = value.revision
  if (revision === undefined) return true
  if (!isPlainObject(revision)) return false
  const supersedes = revision.supersedes
  return (supersedes === undefined || (Array.isArray(supersedes) && supersedes.every(isNonEmptyString)))
    && isOptionalString(revision.supersededBy)
    && isOptionalString(revision.reason)
    && isValidIsoTimestamp(revision.revisedAt)
    && isEnumValue(revision.revisedBy, VALID_REVISION_ACTORS)
}
```

Update `normalizeMemoryRecord()` validation condition:

```ts
  if (!hasValidProject(value) || !hasValidKind(value) || !hasValidProvenance(value) || !hasValidRevision(value)) return undefined
```

Update `validateSaveInput()` to validate revision if present:

```ts
  if (input.revision !== undefined && !hasValidRevision({ revision: input.revision })) {
    throw new Error("Invalid revision. Expected optional supersedes/supersededBy/reason, ISO revisedAt, and revisedBy manual|cli|mcp")
  }
```

- [ ] **Step 5: Export revision validation constant if needed**

No index export is required unless implementation needs `VALID_REVISION_ACTORS`. If it is used outside `storage-validation.ts`, export from `packages/core/src/index.ts`.

- [ ] **Step 6: Run storage/core tests**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/storage.test.ts
pnpm --filter @memory-lane/core test
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add packages/core/src/types.ts packages/core/src/storage-validation.ts packages/core/src/index.ts packages/core/test/storage.test.ts
git commit -m "feat(core): add memory revision metadata"
```

---

### Task 2: Core same-id update preview and revision metadata

**Files:**
- Create: `packages/core/src/revisions.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Add failing update tests**

Append tests inside the `MemoryEngine` suite in `packages/core/test/engine.test.ts` near existing update tests:

```ts
  it("update records revision metadata when reason is provided", () => {
    const e = engine()
    const saved = e.save({ text: "Old workflow wording", status: "approved", category: "project", kind: "workflow_rule" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    const updated = e.update(saved.memory.id, {
      text: "New workflow wording",
      reason: "clarified operating agreement",
      revisedBy: "cli",
    })

    assert.equal(updated?.id, saved.memory.id)
    assert.equal(updated?.text, "New workflow wording")
    assert.equal(updated?.revision?.reason, "clarified operating agreement")
    assert.equal(updated?.revision?.revisedBy, "cli")
    assert.match(updated?.revision?.revisedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u)
    assert.equal(updated?.revision?.supersedes, undefined)
    assert.equal(updated?.revision?.supersededBy, undefined)
  })

  it("update rejects metadata-only and no-op patches", () => {
    const e = engine()
    const saved = e.save({ text: "Stable memory", status: "approved", category: "project", kind: "project_fact" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    assert.throws(() => e.update(saved.memory.id, { reason: "reviewed", revisedBy: "cli" }), /No changes to apply/u)
    assert.throws(() => e.update(saved.memory.id, { text: "Stable memory" }), /No changes to apply/u)
  })

  it("previewUpdate returns proposed memory without writing or invalidating embeddings", () => {
    const e = engine()
    const saved = e.save({ text: "Preview source", status: "approved", category: "project", kind: "project_fact" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return
    const logBefore = readJsonl(path.join(dir, "mem.jsonl")).length

    const preview = e.previewUpdate(saved.memory.id, { text: "Preview target", reason: "dry run", revisedBy: "cli" })

    assert.equal(preview?.dryRun, true)
    assert.equal(preview?.current.text, "Preview source")
    assert.equal(preview?.proposed.text, "Preview target")
    assert.equal(preview?.proposed.revision?.reason, "dry run")
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, logBefore)
    assert.equal(readJsonl(path.join(dir, "emb.jsonl")).length, 0)
  })
```

- [ ] **Step 2: Run engine tests and verify failures**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/engine.test.ts
```

Expected: FAIL for missing `previewUpdate` and no-op/revision behavior.

- [ ] **Step 3: Create revision helper module**

Create `packages/core/src/revisions.ts`:

```ts
import type { MemoryRecord, MemoryRevision, MemoryRevisionActor, UpdateInput } from "./types.js"

export function revisionNow(reason?: string, revisedBy: MemoryRevisionActor = "manual"): MemoryRevision {
  return {
    ...(reason ? { reason: reason.trim() } : {}),
    revisedAt: new Date().toISOString(),
    revisedBy,
  }
}

export function sameIdRevision(input: Pick<UpdateInput, "reason" | "revisedBy">): MemoryRevision | undefined {
  const reason = input.reason?.trim()
  if (!reason && !input.revisedBy) return undefined
  return revisionNow(reason, input.revisedBy ?? "manual")
}

export function revisionLabel(memory: MemoryRecord): string | undefined {
  const revision = memory.revision
  if (!revision) return undefined
  const parts: string[] = []
  if (revision.supersedes?.length) parts.push(`supersedes: ${revision.supersedes.join(", ")}`)
  if (revision.supersededBy) parts.push(`superseded by: ${revision.supersededBy}`)
  return parts.length ? `[${parts.join("; ")}]` : undefined
}

export function hasRealUpdateChange(current: MemoryRecord, proposed: Pick<MemoryRecord, "text" | "category" | "status"> & { kind?: MemoryRecord["kind"] }): boolean {
  return current.text !== proposed.text
    || current.category !== proposed.category
    || current.status !== proposed.status
    || (current.kind ?? "misc") !== (proposed.kind ?? "misc")
}
```

- [ ] **Step 4: Extend update validation and preview in engine**

In `packages/core/src/engine.ts`:

1. Import helpers:

```ts
import { hasRealUpdateChange, sameIdRevision } from "./revisions.js"
```

2. Extend type imports with `UpdatePreview`.

3. Replace the body of `update()` with shared preview logic. Add a private helper before `update()`:

```ts
  private buildUpdatePreview(id: string, patch: UpdateInput): UpdatePreview | undefined {
    const mem = this.store.list().find((m) => m.id === id && (m.status === "approved" || m.status === "pending"))
    if (!mem) return undefined
    validateUpdateInput(patch)

    const proposed: MemoryRecord = {
      ...mem,
      text: patch.text === undefined ? mem.text : patch.text.trim(),
      category: patch.category ?? mem.category,
      status: patch.status ?? mem.status,
      kind: patch.kind ?? mem.kind,
      revision: sameIdRevision(patch) ?? mem.revision,
      updatedAt: timestamp(),
    }
    if (!proposed.text) throw new Error("Invalid text: memory text cannot be empty")
    if (containsLikelySecret(proposed.text)) throw new Error("Invalid text: memory text contains a likely secret")
    if (!hasRealUpdateChange(mem, proposed)) throw new Error("No changes to apply")

    return { dryRun: true, current: mem, proposed, warnings: [] }
  }
```

4. Add public preview:

```ts
  previewUpdate(id: string, patch: UpdateInput): UpdatePreview | undefined {
    return this.buildUpdatePreview(id, patch)
  }
```

5. Update public `update()`:

```ts
  update(id: string, patch: UpdateInput): MemoryMutationResult | undefined {
    const preview = this.buildUpdatePreview(id, patch)
    if (!preview) return undefined
    const updated = preview.proposed
    this.store.append(updated)
    this.invalidateEmbedding(id, "updated")
    if (shouldAutoEmbed(updated, this.config.semantic, this.embProvider)) {
      this._embedMemory(updated).catch(() => { /* swallowed */ })
    }
    return this.mutationResultWithMirrorWarnings(updated)
  }
```

- [ ] **Step 5: Export revision helpers**

In `packages/core/src/index.ts`, add:

```ts
export { revisionNow, sameIdRevision, revisionLabel, hasRealUpdateChange } from "./revisions.js"
```

- [ ] **Step 6: Run core tests**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/engine.test.ts
pnpm --filter @memory-lane/core test
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add packages/core/src/revisions.ts packages/core/src/engine.ts packages/core/src/index.ts packages/core/test/engine.test.ts
git commit -m "feat(core): preview and annotate memory updates"
```

---

### Task 3: Core supersede and replace primitives

**Files:**
- Modify: `packages/core/src/revisions.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Add failing supersede and replace tests**

Append these tests inside the `MemoryEngine` suite in `packages/core/test/engine.test.ts`:

```ts
  it("supersede links one approved successor to many approved old memories", () => {
    const e = engine()
    const oldA = e.save({ text: "Old A", status: "approved", category: "project", kind: "workflow_rule" })
    const oldB = e.save({ text: "Old B", status: "approved", category: "project", kind: "workflow_rule" })
    const newer = e.save({ text: "New canonical", status: "approved", category: "project", kind: "workflow_rule" })
    assert.equal(oldA.status, "saved"); assert.equal(oldB.status, "saved"); assert.equal(newer.status, "saved")
    if (oldA.status !== "saved" || oldB.status !== "saved" || newer.status !== "saved") return

    const result = e.supersede(newer.memory.id, [oldA.memory.id, oldB.memory.id], { reason: "merged duplicates", revisedBy: "cli" })

    assert.equal(result.dryRun, false)
    assert.deepEqual(result.successor.revision?.supersedes, [oldA.memory.id, oldB.memory.id])
    assert.equal(result.successor.revision?.reason, "merged duplicates")
    assert.deepEqual(result.superseded.map((m) => m.revision?.supersededBy), [newer.memory.id, newer.memory.id])
    assert.equal(e.list({ all: true }).find((m) => m.id === oldA.memory.id)?.status, "approved")
  })

  it("supersede validates all inputs before writing", () => {
    const e = engine()
    const old = e.save({ text: "Old", status: "approved" })
    const pendingSuccessor = e.save({ text: "Pending successor", status: "pending" })
    assert.equal(old.status, "saved"); assert.equal(pendingSuccessor.status, "saved")
    if (old.status !== "saved" || pendingSuccessor.status !== "saved") return
    const logBefore = readJsonl(path.join(dir, "mem.jsonl")).length

    assert.throws(() => e.supersede("missing", [old.memory.id]), /Successor memory not found/u)
    assert.throws(() => e.supersede(pendingSuccessor.memory.id, [old.memory.id]), /Successor must be approved/u)
    assert.throws(() => e.supersede(old.memory.id, [old.memory.id]), /cannot supersede itself/u)
    assert.throws(() => e.supersede(old.memory.id, ["missing-old"]), /Old memory not found/u)
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, logBefore)
  })

  it("supersede dry-run returns proposed records without writing", () => {
    const e = engine()
    const old = e.save({ text: "Old dry", status: "approved" })
    const newer = e.save({ text: "New dry", status: "approved" })
    assert.equal(old.status, "saved"); assert.equal(newer.status, "saved")
    if (old.status !== "saved" || newer.status !== "saved") return
    const logBefore = readJsonl(path.join(dir, "mem.jsonl")).length

    const result = e.supersede(newer.memory.id, [old.memory.id], { reason: "preview", revisedBy: "cli", dryRun: true })

    assert.equal(result.dryRun, true)
    assert.equal(result.successor.revision?.reason, "preview")
    assert.equal(result.superseded[0].revision?.supersededBy, newer.memory.id)
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, logBefore)
  })

  it("replace approved creates successor and marks old memories superseded", () => {
    const e = engine()
    const old = e.save({ text: "Old replacement source", status: "approved", category: "project", kind: "project_fact" })
    assert.equal(old.status, "saved")
    if (old.status !== "saved") return

    const result = e.replace([old.memory.id], { text: "New replacement", status: "approved", kind: "workflow_rule", reason: "refined", revisedBy: "cli" })

    assert.equal(result.successorCreated, true)
    assert.equal(result.successor.text, "New replacement")
    assert.equal(result.successor.status, "approved")
    assert.equal(result.successor.kind, "workflow_rule")
    assert.deepEqual(result.successor.revision?.supersedes, [old.memory.id])
    assert.equal(result.superseded[0].revision?.supersededBy, result.successor.id)
  })

  it("replace pending creates successor intent without mutating old memory", () => {
    const e = engine()
    const old = e.save({ text: "Old pending replace", status: "approved", category: "project", kind: "project_fact" })
    assert.equal(old.status, "saved")
    if (old.status !== "saved") return
    const logBefore = readJsonl(path.join(dir, "mem.jsonl")).length

    const result = e.replace([old.memory.id], { text: "Pending replacement", status: "pending", reason: "draft", revisedBy: "cli" })

    assert.equal(result.successor.status, "pending")
    assert.deepEqual(result.successor.revision?.supersedes, [old.memory.id])
    assert.deepEqual(result.superseded, [])
    assert.equal(e.list({ all: true }).find((m) => m.id === old.memory.id)?.revision, undefined)
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, logBefore + 1)
  })

  it("replace warns on cross-scope and cross-category relationships", () => {
    const e = engine()
    const old = e.save({ text: "Global pref", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
    assert.equal(old.status, "saved")
    if (old.status !== "saved") return

    const result = e.replace([old.memory.id], { text: "Project successor", category: "project", kind: "workflow_rule", status: "approved", reason: "cross category", revisedBy: "cli" })

    assert.ok(result.warnings.some((warning) => warning.code === "cross-category"))
  })
```

- [ ] **Step 2: Run engine tests and verify failures**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/engine.test.ts
```

Expected: FAIL for missing `supersede` and `replace`.

- [ ] **Step 3: Add relationship helper functions**

In `packages/core/src/revisions.ts`, add:

```ts
import { createMemoryId } from "./storage.js"
import type { MemoryCategory, MemoryKind, MemoryStatus, ReplaceResult, RevisionWarning, SupersedeResult } from "./types.js"

export function revisionForSuccessor(oldIds: string[], reason?: string, revisedBy: MemoryRevisionActor = "manual"): MemoryRevision {
  return { ...revisionNow(reason, revisedBy), supersedes: oldIds }
}

export function revisionForSuperseded(newId: string, reason?: string, revisedBy: MemoryRevisionActor = "manual"): MemoryRevision {
  return { ...revisionNow(reason, revisedBy), supersededBy: newId }
}

export function revisionWarnings(successor: MemoryRecord, oldRecords: MemoryRecord[]): RevisionWarning[] {
  const warnings: RevisionWarning[] = []
  for (const old of oldRecords) {
    if (successor.scope.type !== old.scope.type || successor.scope.key !== old.scope.key) {
      warnings.push({ code: "cross-scope", memoryId: old.id, message: `Successor ${successor.id} and old memory ${old.id} have different scopes.` })
    }
    if (successor.category !== old.category) {
      warnings.push({ code: "cross-category", memoryId: old.id, message: `Successor ${successor.id} and old memory ${old.id} have different categories.` })
    }
  }
  return warnings
}
```

Do not keep `createMemoryId` imported if it is unused.

- [ ] **Step 4: Implement all-or-nothing helpers in engine**

In `packages/core/src/engine.ts`, import:

```ts
import { revisionForSuccessor, revisionForSuperseded, revisionWarnings } from "./revisions.js"
```

Update the storage import so `replace()` can allocate a new successor id:

```ts
import { createMemoryId, createMemoryStore, type MemoryStore } from "./storage.js"
```

Extend type imports with `ReplaceResult`, `RevisionWarning`, `SupersedeResult`, `MemoryRevisionActor`.

Add a helper near update methods:

```ts
  private requireApprovedMemory(id: string, label: "Successor" | "Old"): MemoryRecord {
    const memory = this.store.list().find((m) => m.id === id && m.status !== "deleted" && m.status !== "rejected")
    if (!memory) throw new Error(`${label} memory not found: ${id}`)
    if (memory.status !== "approved") throw new Error(`${label} must be approved: ${id}`)
    return memory
  }

  private buildSupersedePreview(newId: string, oldIds: string[], opts?: { reason?: string; revisedBy?: MemoryRevisionActor; dryRun?: boolean }): SupersedeResult {
    if (!oldIds.length) throw new Error("At least one old memory id is required")
    if (new Set(oldIds).size !== oldIds.length) throw new Error("Old memory ids must be unique")
    if (oldIds.includes(newId)) throw new Error("A memory cannot supersede itself")

    const successor = this.requireApprovedMemory(newId, "Successor")
    const oldRecords = oldIds.map((id) => this.requireApprovedMemory(id, "Old"))
    const already = oldRecords.find((memory) => memory.revision?.supersededBy)
    if (already) throw new Error(`Old memory is already superseded: ${already.id}`)

    const revisedBy = opts?.revisedBy ?? "manual"
    const revisedSuccessor: MemoryRecord = {
      ...successor,
      revision: revisionForSuccessor(oldIds, opts?.reason, revisedBy),
      updatedAt: timestamp(),
    }
    const superseded = oldRecords.map((memory) => ({
      ...memory,
      revision: revisionForSuperseded(newId, opts?.reason, revisedBy),
      updatedAt: timestamp(),
    }))
    return {
      dryRun: opts?.dryRun ?? false,
      successor: revisedSuccessor,
      superseded,
      warnings: revisionWarnings(revisedSuccessor, oldRecords),
    }
  }
```

Add public `supersede()`:

```ts
  supersede(newId: string, oldIds: string[], opts?: { reason?: string; revisedBy?: MemoryRevisionActor; dryRun?: boolean }): SupersedeResult {
    const preview = this.buildSupersedePreview(newId, oldIds, opts)
    if (opts?.dryRun) return preview
    this.store.append(preview.successor)
    this.invalidateEmbedding(preview.successor.id, "updated")
    for (const memory of preview.superseded) {
      this.store.append(memory)
      this.invalidateEmbedding(memory.id, "updated")
    }
    const mirrorWarnings = this.syncMirrorAndCollectWarnings()
    return mirrorWarnings.length ? { ...preview, mirrorWarnings } : preview
  }
```

Add public `replace()` after `supersede()`:

```ts
  replace(oldIds: string[], input: {
    text: string
    category?: MemoryCategory
    kind?: MemoryKind
    status?: Extract<MemoryStatus, "pending" | "approved">
    reason?: string
    revisedBy?: MemoryRevisionActor
    dryRun?: boolean
  }): ReplaceResult {
    if (!oldIds.length) throw new Error("At least one old memory id is required")
    if (new Set(oldIds).size !== oldIds.length) throw new Error("Old memory ids must be unique")
    validateSaveInput({ text: input.text, category: input.category, kind: input.kind, status: input.status ?? "approved" })
    const oldRecords = oldIds.map((id) => this.requireApprovedMemory(id, "Old"))
    const already = oldRecords.find((memory) => memory.revision?.supersededBy)
    if (already) throw new Error(`Old memory is already superseded: ${already.id}`)
    const text = input.text.trim()
    if (!text) throw new Error("Invalid text: memory text cannot be empty")
    if (containsLikelySecret(text)) throw new Error("Invalid text: memory text contains a likely secret")

    const first = oldRecords[0]
    const status = input.status ?? "approved"
    const now = timestamp()
    const successor: MemoryRecord = {
      id: createMemoryId(),
      text,
      category: input.category ?? first.category,
      scope: first.scope,
      source: "manual",
      status,
      kind: input.kind ?? first.kind,
      createdAt: now,
      updatedAt: now,
      project: first.project,
      revision: revisionForSuccessor(oldIds, input.reason, input.revisedBy ?? "manual"),
    }
    const warnings = revisionWarnings(successor, oldRecords)
    const superseded = status === "approved"
      ? oldRecords.map((memory) => ({ ...memory, revision: revisionForSuperseded(successor.id, input.reason, input.revisedBy ?? "manual"), updatedAt: timestamp() }))
      : []
    const result: ReplaceResult = { dryRun: input.dryRun ?? false, successor, superseded, warnings, successorCreated: true }
    if (input.dryRun) return result

    this.store.append(successor)
    if (shouldAutoEmbed(successor, this.config.semantic, this.embProvider)) {
      this._embedMemory(successor).catch(() => { /* swallowed */ })
    }
    for (const memory of superseded) {
      this.store.append(memory)
      this.invalidateEmbedding(memory.id, "updated")
    }
    const mirrorWarnings = this.syncMirrorAndCollectWarnings()
    return mirrorWarnings.length ? { ...result, mirrorWarnings } : result
  }
```

- [ ] **Step 5: Run core tests**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/engine.test.ts
pnpm --filter @memory-lane/core test
```

Expected: PASS. If TypeScript complains that `validateSaveInput` does not accept `revision`, use only normal save fields in validation and validate revision through helper construction.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add packages/core/src/revisions.ts packages/core/src/engine.ts packages/core/test/engine.test.ts
git commit -m "feat(core): add replace and supersede primitives"
```

---

### Task 4: CLI update command and revision labels

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Add failing CLI update tests**

Append tests near existing CLI mutation tests in `packages/cli/test/cli.test.ts`:

```ts
it("update changes a memory and records revision metadata", () => {
  const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
  run(["save", "old update text", "--status", "approved", "--category", "project"], env)
  const before = JSON.parse(run(["list", "--json"], env))
  const id = before.data.memories[0].id

  const output = JSON.parse(run(["update", id, "--text", "new update text", "--kind", "workflow_rule", "--reason", "clarified", "--json"], env))
  const after = JSON.parse(run(["list", "--json"], env))

  assert.equal(output.ok, true)
  assert.equal(output.data.updated.text, "new update text")
  assert.equal(output.data.updated.kind, "workflow_rule")
  assert.equal(output.data.updated.revision.reason, "clarified")
  assert.equal(output.data.updated.revision.revisedBy, "cli")
  assert.equal(after.data.memories[0].revision.reason, "clarified")
})

it("update supports stdin dry-run without writing", () => {
  const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
  run(["save", "old stdin text", "--status", "approved"], env)
  const id = JSON.parse(run(["list", "--json"], env)).data.memories[0].id

  const result = runProcess(["update", id, "--stdin", "--dry-run", "--json"], { env, stdin: "new stdin text" })
  const list = JSON.parse(run(["list", "--json"], env))
  const payload = JSON.parse(result.stdout)

  assert.equal(result.status, 0)
  assert.equal(payload.data.dryRun, true)
  assert.equal(payload.data.proposed.text, "new stdin text")
  assert.equal(list.data.memories[0].text, "old stdin text")
})

it("update rejects missing changes and no-op patches", () => {
  const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
  run(["save", "same text", "--status", "approved"], env)
  const id = JSON.parse(run(["list", "--json"], env)).data.memories[0].id

  const metadataOnly = runProcess(["update", id, "--reason", "reviewed"], { env })
  const noOp = runProcess(["update", id, "--text", "same text"], { env })

  assert.notEqual(metadataOnly.status, 0)
  assert.match(metadataOnly.stdout + metadataOnly.stderr, /No changes to apply|At least one update field/u)
  assert.notEqual(noOp.status, 0)
  assert.match(noOp.stdout + noOp.stderr, /No changes to apply/u)
})
```

- [ ] **Step 2: Run CLI tests and verify failures**

Run:

```bash
pnpm --filter @memory-lane/cli test
```

Expected: FAIL because `update` command is not wired.

- [ ] **Step 3: Add formatter helpers for revision labels and update output**

In `packages/cli/src/formatters.ts`, update imports to include `UpdatePreview` and `revisionLabel`:

```ts
import { ..., revisionLabel, type UpdatePreview } from "@memory-lane/core"
```

Add helper near `formatMemories()`:

```ts
function revisionSuffix(memory: MemoryRecord): string {
  const label = revisionLabel(memory)
  return label ? ` ${label}` : ""
}
```

Update `formatMemories()` human line to include `revisionSuffix(m)` after kind/status metadata:

```ts
`[${m.id}] (${m.scope.type}/${m.category}/${m.kind ?? "?"})${revisionSuffix(m)} ${m.status !== "approved" ? `[${m.status}] ` : ""}${m.text}  (saved ${formatDate(m.createdAt)})`
```

Update `reviewStatusLine()` to append `revisionSuffix(memory)`.

Update `formatOperatingAgreements()` primary/related header lines to include `revisionSuffix(item.memory)`.

Add update preview formatter:

```ts
export function formatUpdatePreview(result: UpdatePreview, json: boolean): string {
  if (json) return JSON.stringify({ ok: true, data: result, meta: meta() }, null, 2)
  return [
    "Update dry run:",
    `Current: [${result.current.id}] ${compactPreview(result.current.text)}`,
    `Proposed: [${result.proposed.id}] ${compactPreview(result.proposed.text)}`,
    ...result.warnings.map((warning) => `Warning: ${warning}`),
  ].join("\n")
}
```

- [ ] **Step 4: Add CLI update handler**

In `packages/cli/src/index.ts`, import `formatUpdatePreview`.

Add helper near `requireId()`:

```ts
function optionalTextArg(ctx: CliContext): string | undefined {
  const value = flag(ctx.argv, "text")
  if (value && value !== "true") return value
  return undefined
}
```

Add async handler:

```ts
async function handleUpdate(ctx: CliContext): Promise<void> {
  const id = requireId(ctx, "update")
  const fromStdin = hasFlag(ctx.argv, "stdin")
  const textFromFlag = optionalTextArg(ctx)
  const text = fromStdin ? await readStdin() : textFromFlag
  const patch = {
    ...(text !== undefined ? { text } : {}),
    ...(flag(ctx.argv, "category") ? { category: flag(ctx.argv, "category") as any } : {}),
    ...(flag(ctx.argv, "kind") ? { kind: flag(ctx.argv, "kind") as any } : {}),
    ...(flag(ctx.argv, "status") ? { status: flag(ctx.argv, "status") as any } : {}),
    ...(flag(ctx.argv, "reason") ? { reason: flag(ctx.argv, "reason") } : {}),
    revisedBy: "cli" as const,
  }
  const hasPatch = text !== undefined || flag(ctx.argv, "category") || flag(ctx.argv, "kind") || flag(ctx.argv, "status")
  if (!hasPatch) {
    console.log(formatError("At least one update field is required: --text/--stdin, --category, --kind, or --status", ctx.json))
    process.exit(1)
  }
  if (hasFlag(ctx.argv, "dry-run")) {
    const preview = ctx.engine.previewUpdate(id, patch)
    if (!preview) {
      console.log(formatError(`Memory not found: ${id}`, ctx.json))
      process.exit(1)
    }
    console.log(formatUpdatePreview(preview, ctx.json))
    return
  }
  const mem = ctx.engine.update(id, patch)
  if (!mem) {
    console.log(formatError(`Memory not found: ${id}`, ctx.json))
    process.exit(1)
  }
  console.log(formatMutationResult("Updated", mem, ctx.json))
}
```

Register:

```ts
  update: handleUpdate,
```

- [ ] **Step 5: Update usage text**

In `packages/cli/src/formatters.ts`, add:

```text
  update <id> --text <text>|--stdin [--category <category>] [--kind <kind>] [--status pending|approved] [--reason <reason>] [--dry-run]
                  Revise an active memory with the same id
```

- [ ] **Step 6: Run CLI tests**

Run:

```bash
pnpm --filter @memory-lane/cli test
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add packages/cli/src/index.ts packages/cli/src/formatters.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): add memory update command"
```

---

### Task 5: CLI supersede and replace commands

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Add failing CLI supersede/replace tests**

Append tests to `packages/cli/test/cli.test.ts`:

```ts
it("supersede links an approved successor to an old memory", () => {
  const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
  run(["save", "old supersede", "--status", "approved"], env)
  run(["save", "new supersede", "--status", "approved"], env)
  const memories = JSON.parse(run(["list", "--json"], env)).data.memories
  const oldId = memories.find((m: any) => m.text === "old supersede").id
  const newId = memories.find((m: any) => m.text === "new supersede").id

  const output = JSON.parse(run(["supersede", newId, oldId, "--reason", "newer", "--json"], env))
  const after = JSON.parse(run(["list", "--json"], env)).data.memories

  assert.equal(output.ok, true)
  assert.equal(output.data.successor.revision.supersedes[0], oldId)
  assert.equal(after.find((m: any) => m.id === oldId).revision.supersededBy, newId)
})

it("supersede multi-old requires --yes unless dry-run", () => {
  const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
  run(["save", "old one", "--status", "approved"], env)
  run(["save", "old two", "--status", "approved"], env)
  run(["save", "new many", "--status", "approved"], env)
  const memories = JSON.parse(run(["list", "--json"], env)).data.memories
  const oldIds = memories.filter((m: any) => m.text.startsWith("old ")).map((m: any) => m.id)
  const newId = memories.find((m: any) => m.text === "new many").id

  const missingYes = runProcess(["supersede", newId, ...oldIds], { env })
  const dryRun = runProcess(["supersede", newId, ...oldIds, "--dry-run", "--json"], { env })

  assert.notEqual(missingYes.status, 0)
  assert.match(missingYes.stdout + missingYes.stderr, /--yes/u)
  assert.equal(dryRun.status, 0)
  assert.equal(JSON.parse(dryRun.stdout).data.dryRun, true)
})

it("replace approved creates successor and supersedes old memory", () => {
  const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
  run(["save", "old replace", "--status", "approved", "--category", "project"], env)
  const oldId = JSON.parse(run(["list", "--json"], env)).data.memories[0].id

  const output = JSON.parse(run(["replace", oldId, "--text", "new replace", "--kind", "workflow_rule", "--reason", "refined", "--json"], env))
  const after = JSON.parse(run(["list", "--json"], env)).data.memories

  assert.equal(output.data.successor.text, "new replace")
  assert.equal(output.data.successor.revision.supersedes[0], oldId)
  assert.equal(after.find((m: any) => m.id === oldId).revision.supersededBy, output.data.successor.id)
})

it("replace pending leaves old memory unchanged", () => {
  const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
  run(["save", "old pending replacement", "--status", "approved"], env)
  const oldId = JSON.parse(run(["list", "--json"], env)).data.memories[0].id

  const output = JSON.parse(run(["replace", oldId, "--text", "draft replacement", "--status", "pending", "--json"], env))
  const after = JSON.parse(run(["list", "--json", "--all"], env)).data.memories

  assert.equal(output.data.successor.status, "pending")
  assert.equal(output.data.superseded.length, 0)
  assert.equal(after.find((m: any) => m.id === oldId).revision, undefined)
})

it("replace supports stdin dry-run without writing", () => {
  const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
  run(["save", "old dry replace", "--status", "approved"], env)
  const oldId = JSON.parse(run(["list", "--json"], env)).data.memories[0].id

  const result = runProcess(["replace", oldId, "--stdin", "--dry-run", "--json"], { env, stdin: "new dry replacement" })
  const after = JSON.parse(run(["list", "--json"], env)).data.memories

  assert.equal(result.status, 0)
  assert.equal(JSON.parse(result.stdout).data.dryRun, true)
  assert.equal(after.length, 1)
  assert.equal(after[0].text, "old dry replace")
})
```

- [ ] **Step 2: Run CLI tests and verify failures**

Run:

```bash
pnpm --filter @memory-lane/cli test
```

Expected: FAIL for missing commands/formatters.

- [ ] **Step 3: Add result formatters**

In `packages/cli/src/formatters.ts`, import `ReplaceResult`, `SupersedeResult`.

Add helpers:

```ts
function formatRevisionWarnings(warnings: Array<{ message: string }>): string[] {
  return warnings.map((warning) => `Warning: ${warning.message}`)
}

export function formatSupersedeResult(result: SupersedeResult, json: boolean): string {
  if (json) return JSON.stringify({ ok: true, data: result, meta: meta({ count: result.superseded.length }) }, null, 2)
  return [
    result.dryRun ? "Supersede dry run:" : "Superseded memories:",
    `Successor: ${result.successor.id}`,
    `Old memories: ${result.superseded.map((m) => m.id).join(", ") || "none"}`,
    ...formatRevisionWarnings(result.warnings),
    ...(result.mirrorWarnings ?? []).map((warning) => `Warning: ${warning}`),
  ].join("\n")
}

export function formatReplaceResult(result: ReplaceResult, json: boolean): string {
  if (json) return JSON.stringify({ ok: true, data: result, meta: meta({ count: result.superseded.length }) }, null, 2)
  return [
    result.dryRun ? "Replace dry run:" : "Replaced memory:",
    `Successor: [${result.successor.id}] ${compactPreview(result.successor.text)}`,
    `Superseded old memories: ${result.superseded.map((m) => m.id).join(", ") || "none"}`,
    ...formatRevisionWarnings(result.warnings),
    ...(result.mirrorWarnings ?? []).map((warning) => `Warning: ${warning}`),
  ].join("\n")
}
```

- [ ] **Step 4: Add CLI command handlers**

In `packages/cli/src/index.ts`, import `formatSupersedeResult` and `formatReplaceResult`.

Add helper:

```ts
function requireYesForMultiple(ctx: CliContext, ids: string[], action: string): void {
  if (ids.length <= 1 || hasFlag(ctx.argv, "yes") || hasFlag(ctx.argv, "dry-run")) return
  console.log(formatError(`${action} with multiple old memories requires --yes or --dry-run`, ctx.json))
  process.exit(1)
}
```

Add handlers:

```ts
function handleSupersede(ctx: CliContext): void {
  const [newId, ...oldIds] = ctx.rest
  if (!newId || !oldIds.length) {
    console.log(formatError("Usage: memory-lane supersede <new-id> <old-id...>", ctx.json))
    process.exit(1)
  }
  requireYesForMultiple(ctx, oldIds, "supersede")
  const result = ctx.engine.supersede(newId, oldIds, {
    reason: flag(ctx.argv, "reason"),
    revisedBy: "cli",
    dryRun: hasFlag(ctx.argv, "dry-run"),
  })
  console.log(formatSupersedeResult(result, ctx.json))
}

async function handleReplace(ctx: CliContext): Promise<void> {
  const oldIds = ctx.rest
  if (!oldIds.length) {
    console.log(formatError("Usage: memory-lane replace <old-id...> --text <text>|--stdin", ctx.json))
    process.exit(1)
  }
  requireYesForMultiple(ctx, oldIds, "replace")
  const fromStdin = hasFlag(ctx.argv, "stdin")
  const textFromFlag = optionalTextArg(ctx)
  const text = fromStdin ? await readStdin() : textFromFlag
  if (text === undefined) {
    console.log(formatError("Replacement text required: use --text <text> or --stdin", ctx.json))
    process.exit(1)
  }
  const result = ctx.engine.replace(oldIds, {
    text,
    category: flag(ctx.argv, "category") as any,
    kind: flag(ctx.argv, "kind") as any,
    status: flag(ctx.argv, "status") as any,
    reason: flag(ctx.argv, "reason"),
    revisedBy: "cli",
    dryRun: hasFlag(ctx.argv, "dry-run"),
  })
  console.log(formatReplaceResult(result, ctx.json))
}
```

Register:

```ts
  supersede: handleSupersede,
  replace: handleReplace,
```

- [ ] **Step 5: Update usage text**

In `packages/cli/src/formatters.ts`, add:

```text
  supersede <new-id> <old-id...> [--reason <reason>] [--dry-run] [--yes]
                  Mark approved old memories as superseded by an approved successor
  replace <old-id...> --text <text>|--stdin [--category <category>] [--kind <kind>] [--status pending|approved] [--reason <reason>] [--dry-run] [--yes]
                  Create a successor memory and optionally supersede old memories
```

- [ ] **Step 6: Run CLI tests**

Run:

```bash
pnpm --filter @memory-lane/cli test
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
git add packages/cli/src/index.ts packages/cli/src/formatters.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): add replace and supersede commands"
```

---

### Task 6: Documentation and roadmap/handoff updates

**Files:**
- Modify: `README.md`
- Modify: `skills/memory-lane/SKILL.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update README**

Add a section near CLI command docs:

```md
### Memory revision commands

Use explicit revision commands when an approved memory needs correction or replacement. These commands are append-only: they write newer rows instead of silently deleting history.

```bash
memory-lane update <id> --text "refined memory" --reason "clarified wording"
cat refined.md | memory-lane update <id> --stdin --kind workflow_rule --dry-run

memory-lane supersede <new-id> <old-id> --reason "newer workflow agreement"
memory-lane supersede <new-id> <old1> <old2> --reason "merged duplicates" --yes

memory-lane replace <old-id> --text "new successor memory" --kind workflow_rule
cat replacement.md | memory-lane replace <old1> <old2> --stdin --yes
```

`update` keeps the same memory id and can change text, category, kind, or approved/pending status. `replace` creates a new successor memory. `supersede` links an existing approved successor to approved older memories. Superseded memories remain approved historical records; Memory Lane does not delete or hide them automatically in this slice.

Use `--dry-run` to preview any revision command. Multi-old `replace` and `supersede` require `--yes` unless `--dry-run` is used. MCP mutation tools are not added for these operations yet.
```

- [ ] **Step 2: Update skill docs**

In `skills/memory-lane/SKILL.md`, add guidance:

```md
### Revising memories

When a durable memory is wrong, stale, duplicated, or superseded, prefer explicit revision commands instead of saving another near-duplicate memory:

```bash
memory-lane update <id> --text "refined memory" --reason "clarified"
memory-lane replace <old-id> --text "new successor memory" --kind workflow_rule
memory-lane supersede <new-id> <old-id> --reason "newer version"
```

Use `--dry-run` before relationship changes. Use `--yes` for multi-old `replace` or `supersede`. Do not assume superseded memories are hidden from recall/context yet; Slice 3 records relationships only.
```

- [ ] **Step 3: Update ROADMAP**

In Phase 16, change status to mark Slice 3 complete and Slice 4 next. Replace extension slice 3 with:

```md
3. **Complete — update / replace / supersede primitives:** added explicit CLI-first append-only revision operations for same-id updates, new successor replacements, and approved successor supersede relationships, with dry-run/confirmation safety and revision metadata. MCP mutation parity, duplicate/stale hints, and retrieval filtering remain later work.
```

Keep Slice 4 as the next incomplete item.

- [ ] **Step 4: Update HANDOFF**

At the top of recent changes, add:

```md
- Phase 16 Slice 3 memory revision primitives are implemented: CLI `update`, `replace`, and `supersede` provide append-only same-id updates and explicit successor relationships with dry-run/`--yes` safety and revision metadata. Superseded memories remain approved and are not hidden from recall/context/agreements yet. No MCP mutation tools, lifecycle injection changes, history command, compaction changes, or automatic cleanup were added. Next recommended Phase 16 slice: continuity/status hints for duplicates and stale guidance.
```

- [ ] **Step 5: Run docs check**

Run:

```bash
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add README.md skills/memory-lane/SKILL.md ROADMAP.md HANDOFF.md
git commit -m "docs: document memory revision primitives"
```

---

### Task 7: Whole-slice verification and PR preparation

**Files:**
- No source files required unless verification reveals a defect.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
```

Expected: all pass. MCP should pass unchanged.

- [ ] **Step 2: Run full tests and build**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: all pass and no whitespace errors.

- [ ] **Step 3: Manual CLI smoke tests in a temp storage file**

Run:

```bash
TMPDIR=$(mktemp -d)
export MEMORY_LANE_FILE="$TMPDIR/memory.jsonl"
export MEMORY_LANE_EMBEDDINGS_FILE="$TMPDIR/embeddings.jsonl"
export MEMORY_LANE_CONFIG="$TMPDIR/config.json"
node packages/cli/dist/index.js save "old workflow" --status approved --category project
OLD_ID=$(node packages/cli/dist/index.js list --json | jq -r '.data.memories[0].id')
node packages/cli/dist/index.js update "$OLD_ID" --text "updated workflow" --kind workflow_rule --reason "manual smoke" --json | jq '{ok, revision:.data.updated.revision}'
node packages/cli/dist/index.js replace "$OLD_ID" --text "replacement workflow" --kind workflow_rule --dry-run --json | jq '{dryRun:.data.dryRun, successor:.data.successor.text, superseded:(.data.superseded|length)}'
node packages/cli/dist/index.js replace "$OLD_ID" --text "replacement workflow" --kind workflow_rule --reason "manual smoke" --json | jq '{successor:.data.successor.id, superseded:(.data.superseded|map(.id))}'
node packages/cli/dist/index.js list --json | jq '[.data.memories[] | {id,text,revision}]'
```

Expected:

- update JSON includes revision metadata.
- replace dry-run writes nothing.
- replace applied creates a successor and old memory revision shows `supersededBy`.
- list JSON includes revision fields.

- [ ] **Step 4: Scope boundary grep**

Run:

```bash
git diff --name-only main...HEAD
rg -n "memory_update|memory_replace|memory_supersede|memory_agreements|handleSessionStart|handleUserPromptSubmit|SessionStart|UserPromptSubmit|history <id>|--force" packages docs README.md skills/memory-lane/SKILL.md || true
```

Expected:

- No MCP mutation tools named `memory_update`, `memory_replace`, or `memory_supersede`.
- No lifecycle adapter changes beyond pre-existing references.
- No `history` command.
- No `--force` revision command.

- [ ] **Step 5: Final whole-slice review**

Dispatch final reviewer to inspect `main...HEAD` against:

- `docs/superpowers/specs/2026-06-18-memory-revision-primitives-design.md`
- this plan

Reviewer must verify:

- update/replace/supersede semantics match spec
- all-or-nothing validation
- dry-run/no-write behavior
- no MCP/lifecycle/compaction/history scope creep
- docs and roadmap accuracy

- [ ] **Step 6: Open PR and wait**

Push branch and open PR with:

- Summary of core revision metadata and engine operations
- CLI command summary
- Safety boundaries
- Verification commands and manual smoke output

Do not merge locally. Wait for user merge. After user says merged, sync main, delete local/remote feature branch and worktree, recommend Phase 16 Slice 4, and stop until user approves.
