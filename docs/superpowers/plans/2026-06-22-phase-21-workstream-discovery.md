# Phase 21 Workstream Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 21 Slice 6a: read-only, query-specific workstream discovery on existing continuity surfaces.

**Architecture:** Add a deterministic core discovery helper that scores approved current-project memories as workstream pointers. Thread optional `query` through `MemoryEngine.continuity()`, CLI `memory-lane continuity --query`, and MCP `memory_continuity({ query })`. Keep no-query continuity behavior unchanged and perform no writes or lifecycle injection.

**Tech Stack:** TypeScript, Node test runner, existing `@memory-lane/core`, `@memory-lane/cli`, and `@memory-lane/mcp-server` packages.

---

## Scope

Implement only the approved Slice 6a boundary from `docs/superpowers/specs/2026-06-22-phase-21-workstream-discovery-design.md`:

- core `workstreamDiscovery` helper;
- optional `workstreamDiscovery` on `ContinuityReadModel`;
- CLI `memory-lane continuity --query` in human and JSON output;
- MCP `memory_continuity` optional `query`;
- tests and docs updates.

Do not implement workstream ids/schema, raw transcript indexing, retrieval rewrites, lifecycle injection, new MCP tool families, GitHub/git lookups, or mutation behavior.

## File Map

- Create `packages/core/src/workstream-discovery.ts`
  - Intent/topic parsing, candidate eligibility, deterministic scoring, reference extraction, result shaping.
- Modify `packages/core/src/types.ts`
  - Add `WorkstreamDiscoveryResult`, `WorkstreamCandidate`, reference/warning types, `ContinuityReadModel.workstreamDiscovery`, and `ContinuityReadModelOptions.query`.
- Modify `packages/core/src/continuity-read-model.ts`
  - Invoke discovery only when `options.query` is a non-empty string.
- Modify `packages/core/src/engine.ts`
  - Extend `continuity()` options with `query` and pass to read model builder.
- Modify `packages/core/src/index.ts`
  - Export discovery helper/types if needed.
- Add/modify tests in `packages/core/test/workstream-discovery.test.ts` and `packages/core/test/continuity-read-model.test.ts`.
- Modify `packages/cli/src/index.ts`
  - Parse `--query` for `continuity`.
- Modify `packages/cli/src/formatters.ts`
  - Render compact human `Workstream discovery` section.
- Modify `packages/cli/test/cli.test.ts`
  - CLI JSON/human coverage.
- Modify `packages/mcp-server/src/types.ts`, `packages/mcp-server/src/server.ts`, `packages/mcp-server/src/handlers.ts`, and `packages/mcp-server/test/handlers.test.ts`
  - Optional query schema and handler path.
- Modify `README.md`, `ROADMAP.md`, `HANDOFF.md`, and `skills/memory-lane/SKILL.md` if needed.

## Definition of Done

- `memory-lane continuity` output is unchanged without `--query`.
- `memory-lane continuity --query "resume building X" --json` includes bounded `workstreamDiscovery` candidates.
- `memory-lane continuity --query "where did we implement X"` human output is compact and text-safe.
- MCP `memory_continuity({ projectPath, query })` returns equivalent structured data.
- Discovery is approved-only, current-project-only, secret-filtered, expired-filtered, non-mutating, and deterministic.
- Tests cover core scoring/eligibility/references, CLI, MCP, no-query regression, and no-write behavior.

---

### Task 1: Core discovery helper and types

**Files:**
- Create: `packages/core/src/workstream-discovery.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/workstream-discovery.test.ts`

- [ ] **Step 1: Write failing tests for query parsing and candidate selection**

Add tests for:

```ts
test("discovers approved current-project checkpoint for resume query", () => {})
test("extracts PR branch commit and release references", () => {})
test("returns no-project-scope warning without broadening to globals", () => {})
```

Expected RED: imports/functions/types do not exist.

- [ ] **Step 2: Run RED test**

Run:

```bash
pnpm --filter @memory-lane/core test -- workstream-discovery
```

Expected: fail because `workstream-discovery` module/types do not exist.

- [ ] **Step 3: Add core types**

In `packages/core/src/types.ts`, add:

- `WorkstreamDiscoveryIntent = "resume" | "lookup" | "status" | "unknown"`
- `WorkstreamReferences`
- `WorkstreamCandidate`
- `WorkstreamDiscoveryWarning`
- `WorkstreamDiscoveryResult`

Use existing `MemoryRecord`, `MemoryKind`, `MemorySource`, `MemoryCategory`, `MemoryScope`, `MemoryProvenance`, and `MemoryRevision` shapes.

- [ ] **Step 4: Implement minimal helper**

Create `packages/core/src/workstream-discovery.ts` with:

- `discoverWorkstreams(memories, options)`;
- deterministic intent/topic extraction;
- current-project approved-only filtering;
- existing `containsLikelySecret` filtering;
- expired freshness filtering using exported freshness classifier if available, or a local narrow expiry check for `freshness.expiresAt` only;
- conservative references extraction;
- bounded previews;
- score/reasons;
- no-project-scope/no-topic/no-match warnings.

- [ ] **Step 5: Export helper**

Export from `packages/core/src/index.ts`.

- [ ] **Step 6: Run GREEN test**

Run:

```bash
pnpm --filter @memory-lane/core test -- workstream-discovery
```

Expected: new core helper tests pass.

---

### Task 2: Integrate discovery into continuity read model

**Files:**
- Modify: `packages/core/src/continuity-read-model.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/test/continuity-read-model.test.ts`

- [ ] **Step 1: Write failing continuity tests**

Add tests:

- no-query continuity has no `workstreamDiscovery`;
- query continuity includes `workstreamDiscovery`;
- no-write behavior through `MemoryEngine.continuity({ query })` by comparing JSONL row count before/after.

- [ ] **Step 2: Run RED tests**

Run:

```bash
pnpm --filter @memory-lane/core test -- continuity-read-model
```

Expected: fail because `query` option is not implemented.

- [ ] **Step 3: Thread `query` option**

- Add `query?: string` to `ContinuityReadModelOptions`.
- In `buildContinuityReadModel`, call `discoverWorkstreams` only for non-empty query.
- Add `workstreamDiscovery` to return object only when query passed.
- Extend `MemoryEngine.continuity(opts)` with `query?: string`.

- [ ] **Step 4: Run GREEN tests**

Run:

```bash
pnpm --filter @memory-lane/core test -- continuity-read-model
```

Expected: core continuity tests pass.

---

### Task 3: CLI query flag and human formatting

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Add tests for:

- `continuity --query "resume building automatic handoff" --json` includes `workstreamDiscovery` and candidate references.
- human `continuity --query` includes `Workstream discovery`, candidate id/preview/reasons/references, and does not dump long body.
- `continuity` without `--query` remains unchanged/no `workstreamDiscovery`.

- [ ] **Step 2: Run RED CLI tests**

Run focused CLI test command if possible:

```bash
pnpm --filter @memory-lane/cli test -- cli
```

Expected: fail because `--query` is not parsed/rendered.

- [ ] **Step 3: Implement CLI query parsing**

In continuity command handling, read `flag(ctx.argv, "query")`; reject `--query` without value using the existing error pattern; pass query to `engine.continuity({ caller: "cli", query })`.

- [ ] **Step 4: Render human section**

In `formatContinuityReadModel`, add `Workstream discovery` section before warnings/suggested actions:

- Query/topic.
- Up to returned candidates.
- Candidate metadata: id, kind, compact references, preview, reasons.
- Warnings and suggested actions.

Keep output bounded and avoid memory body dumps.

- [ ] **Step 5: Run GREEN CLI tests**

Run:

```bash
pnpm --filter @memory-lane/cli test
```

Expected: CLI tests pass.

---

### Task 4: MCP continuity query support

**Files:**
- Modify: `packages/mcp-server/src/types.ts`
- Modify: `packages/mcp-server/src/server.ts`
- Modify: `packages/mcp-server/src/handlers.ts`
- Modify: `packages/mcp-server/test/handlers.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Add tests for:

- `handleMemoryContinuity(engine, { projectPath, query })` includes `workstreamDiscovery`.
- Existing `handleMemoryContinuity(engine, { projectPath })` unchanged/no `workstreamDiscovery`.

- [ ] **Step 2: Run RED MCP tests**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test
```

Expected: fail because input type/schema/handler does not accept/pass query.

- [ ] **Step 3: Extend MCP input**

- Add `query?: string` to `ContinuityToolInput`.
- Add zod optional `query` string to `memory_continuity` schema description.
- Pass `input.query` to `engine.continuity({ caller: "mcp", query: input.query })`.

- [ ] **Step 4: Run GREEN MCP tests**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test
```

Expected: MCP tests pass.

---

### Task 5: Docs, roadmap, handoff, and final verification

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`
- Modify: `skills/memory-lane/SKILL.md` if useful

- [ ] **Step 1: Update docs**

Document:

- `memory-lane continuity --query "..."`;
- MCP `memory_continuity({ projectPath, query })`;
- read-only pointer semantics;
- no raw transcript search / no mutations / no lifecycle injection.

- [ ] **Step 2: Update roadmap/handoff**

Record Slice 6a implemented locally on the branch and next expected PR/review gate.

- [ ] **Step 3: Run final verification**

Run:

```bash
pnpm build
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
git diff --check
```

- [ ] **Step 4: Request review**

Use Opus 4.8 via `claude --model claude-opus-4-8 -p` for high-thinking review of spec alignment and implementation diff, plus the normal code-review pass if useful.

- [ ] **Step 5: Fix review findings or document none**

Address blockers/important findings before PR.

- [ ] **Step 6: Commit and open PR**

Commit with an implementation message such as:

```bash
git commit -m "feat: add workstream discovery to continuity"
```

Push branch and open PR. Include summary, verification, review findings, and explicit non-goals.
