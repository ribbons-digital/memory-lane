# Phase 21 Slice 3 — Cross-Session Freshness Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make existing SessionStart newer-approved continuity notices work across real sessions by persisting a tiny per-project advisory continuity baseline marker.

**User approval:** User approved Option A — implement the marker slice as specified.

**Architecture:** Add a small text-free sidecar state file (`continuity-baselines.json`) next to the Memory Lane JSONL memory store. Read the project marker before SessionStart notice generation, use it as the resolved `since` baseline when valid, then best-effort write the current SessionStart timestamp after result construction. The marker is not a memory record and never stores memory text, prompts, transcripts, tool outputs, ids, branches, model names, or harness payloads.

**Guardrails:** No new CLI commands, MCP tools, config flags, memory schema fields, adapter payloads, recall/retrieval/token changes, refresh/consolidation, automatic approvals/rejections/deletions/cleanup, handoff body injection, or automatic-mode activation.

---

## File Structure

- Add: `packages/core/src/continuity-baseline.ts`
  - Sidecar marker read/write/diagnostics/strict timestamp helpers.
- Modify: `packages/core/src/freshness.ts`
  - Export strict ISO timestamp validator or equivalent helper.
- Modify: `packages/core/src/types.ts`
  - Add continuity baseline diagnostic/decision types if useful.
- Modify: `packages/core/src/engine.ts`
  - Add baseline path, resolve/record/doctor methods, and doctor diagnostics.
- Modify: `packages/lifecycle/src/types.ts`
  - Add optional `continuityBaseline` metadata to `ContinuityContextDecision`.
- Modify: `packages/lifecycle/src/handlers.ts`
  - Resolve baseline in `handleSessionStart`, use it for continuity hints/notice, attach metadata, record marker best-effort after result construction.
- Tests:
  - `packages/core/test/engine.test.ts`
  - `packages/lifecycle/test/handlers.test.ts`
  - `packages/cli/test/cli.test.ts`
  - `packages/mcp-server/test/handlers.test.ts`
- Docs:
  - `CONTEXT.md`
  - `README.md`
  - `ROADMAP.md`
  - `HANDOFF.md`

## Task 1: Core Baseline Marker

**Files:**
- Add: `packages/core/src/continuity-baseline.ts`
- Modify: `packages/core/src/freshness.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Export strict ISO validation**

In `packages/core/src/freshness.ts`, export a reusable strict validator matching existing `assertValidIsoOption` behavior:

```ts
export function isStrictIsoTimestamp(value: string | undefined): value is string {
  if (!value) return false
  const ms = Date.parse(value)
  return Number.isFinite(ms) && new Date(ms).toISOString() === value
}
```

Update `assertValidIsoOption` to call this helper so freshness validation and baseline validation stay in sync.

- [ ] **Step 2: Add marker types**

In `packages/core/src/types.ts`, add:

```ts
export type ContinuityBaselineSource = "marker" | "payload" | "none"

export interface ResolvedContinuityBaseline {
  source: ContinuityBaselineSource
  since?: string
}

export interface ContinuityBaselineDiagnostic {
  projectScope: string | "none"
  source: "marker" | "none"
  stateFile: string
  readable: boolean
  since?: string
  warning?: string
}
```

Lifecycle decision metadata will reuse `ResolvedContinuityBaseline`.

- [ ] **Step 3: Add sidecar marker helper**

Create `packages/core/src/continuity-baseline.ts`.

Implement:

```ts
interface ContinuityBaselineFile {
  version: 1
  projects: Record<string, ContinuityBaselineMarker>
}

interface ContinuityBaselineMarker {
  projectScope: string
  lastSeenAt: string
  updatedAt: string
}
```

Export functions:

```ts
export function defaultContinuityBaselinePath(memoryPath: string): string
export function readContinuityBaseline(path: string, projectScope?: string): { marker?: ContinuityBaselineMarker; warning?: string; readable: boolean }
export function writeContinuityBaseline(path: string, projectScope: string, observedAt: string): { ok: boolean; warning?: string }
export function continuityBaselineDiagnostic(path: string, projectScope?: string): ContinuityBaselineDiagnostic
```

Rules:

- `defaultContinuityBaselinePath(memoryPath) = path.join(path.dirname(memoryPath), "continuity-baselines.json")`.
- Missing file returns `{ readable: true }` and no marker.
- Corrupt/unparseable file returns `{ readable: false, warning: "Continuity baseline marker file is unreadable; treating it as absent." }` or similar deterministic warning.
- Marker with invalid `lastSeenAt` is treated as absent with warning.
- Writes are synchronous and atomic: `mkdirSync`, write temp file, `renameSync`.
- All read/write functions catch errors and never throw.
- `writeContinuityBaseline` should preserve other projects when file is readable; if file is corrupt, replace with a fresh file containing only the current project.
- Do not store memory ids/text/prompts/transcripts/tool outputs/branches/model names.

- [ ] **Step 4: Wire engine methods**

In `packages/core/src/engine.ts`:

- Add private `continuityBaselinePath` derived from `this.memPath`.
- Add public methods:

```ts
resolveContinuityBaseline(inputSince?: string): ResolvedContinuityBaseline
recordContinuityBaseline(observedAt?: string): void
continuityBaselineDoctor(): ContinuityBaselineDiagnostic
```

Behavior:

- If no `this.scope?.key`, `resolveContinuityBaseline()` returns valid payload baseline if `inputSince` is strict ISO, otherwise `{ source: "none" }`.
- If scoped marker exists and strict valid, return `{ source: "marker", since: marker.lastSeenAt }`.
- Else if payload `inputSince` is strict valid, return `{ source: "payload", since: inputSince }`.
- Else `{ source: "none" }`.
- `recordContinuityBaseline()` no-ops without scope.
- `recordContinuityBaseline()` writes `observedAt` only if strict ISO; otherwise writes `new Date().toISOString()`.
- All marker I/O is caught/non-throwing.
- Spread `continuityBaseline: this.continuityBaselineDoctor()` into `doctor()`.

- [ ] **Step 5: Add core tests**

In `packages/core/test/engine.test.ts`, add tests for:

1. `resolveContinuityBaseline()` returns `none` with no scope and no valid payload.
2. `resolveContinuityBaseline()` returns `payload` for strict valid payload when no marker exists.
3. Invalid payload since returns `none` and does not throw.
4. `recordContinuityBaseline()` writes sidecar marker with only project scope/timestamps.
5. Marker read wins over payload when both exist.
6. Corrupt marker file is non-fatal and doctor reports warning/readable false.
7. Doctor includes text-free `continuityBaseline` and no memory text.

Use temp memory paths so marker sidecar stays inside the test temp directory.

- [ ] **Step 6: Run core tests**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: all core tests pass.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add packages/core/src/continuity-baseline.ts packages/core/src/freshness.ts packages/core/src/types.ts packages/core/src/engine.ts packages/core/test/engine.test.ts
git commit -m "feat(core): add continuity baseline marker"
```

## Task 2: Lifecycle SessionStart Baseline Resolution

**Files:**
- Modify: `packages/lifecycle/src/types.ts`
- Modify: `packages/lifecycle/src/handlers.ts`
- Modify: `packages/lifecycle/test/handlers.test.ts`

- [ ] **Step 1: Add lifecycle decision metadata**

In `packages/lifecycle/src/types.ts`, import/use `ResolvedContinuityBaseline` or define equivalent shape:

```ts
continuityBaseline?: ResolvedContinuityBaseline
```

on `ContinuityContextDecision`.

- [ ] **Step 2: Update `handleSessionStart()`**

In `packages/lifecycle/src/handlers.ts`:

- After `engine.refreshScope(input.cwd)` and policy resolution, handle `off` mode first exactly as documented:
  - no context;
  - no continuity hints;
  - no marker write.
- For `policy-only` and `selective`:
  - resolve baseline with `engine.resolveContinuityBaseline(input.since)`;
  - use `baseline.since` in `engine.continuityHints({ since: baseline.since })`;
  - pass `baseline.since` to `renderContinuityNotice()`;
  - attach `notice.continuityBaseline = baseline` before `continuityDecision(notice)`;
  - construct result as today;
  - best-effort call `engine.recordContinuityBaseline(input.since)` before returning result.

Because `handleSessionStart()` is synchronous, do not introduce async I/O.

- [ ] **Step 3: Add lifecycle tests**

In `packages/lifecycle/test/handlers.test.ts`, add tests for:

1. First SessionStart with no marker produces no false newer-approved notice.
2. Two simulated sessions same project:
   - Session A starts with strict timestamp `T1` and records marker.
   - Save/approve project memory after `T1`.
   - Session B starts with strict timestamp `T2` and uses marker `T1`, producing existing newer-approved notice.
   - Marker is updated to `T2` after Session B.
3. Read-before-write ordering: Session B detects memory newer than old marker, then marker becomes new timestamp.
4. Cross-project isolation: Project B marker/memory does not trigger Project A notice.
5. Invalid `input.since` does not throw and reports `source: "none"` when no marker exists.
6. `contextPolicy.mode: "off"` injects no context and does not write marker.
7. `policy-only` and `selective` include `contextDecision.continuity.continuityBaseline` and preserve existing selection/budget behavior.
8. No new memory record is created by SessionStart marker handling.

- [ ] **Step 4: Run lifecycle tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test
```

Expected: lifecycle tests pass.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add packages/lifecycle/src/types.ts packages/lifecycle/src/handlers.ts packages/lifecycle/test/handlers.test.ts
git commit -m "feat(lifecycle): use continuity baseline on session start"
```

## Task 3: CLI/MCP Diagnostics

**Files:**
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `packages/mcp-server/test/handlers.test.ts`
- Modify only if needed: `packages/cli/src/formatters.ts`

- [ ] **Step 1: Verify formatter behavior**

`formatDoctor()` already JSON-renders unknown object keys in human output and JSON output carries `doctor()` data directly. Do not add a custom human block unless tests reveal unreadable or broken output.

- [ ] **Step 2: Add CLI tests**

In `packages/cli/test/cli.test.ts`, add/extend tests to assert:

- `status --json` includes `data.continuityBaseline` with project scope, source, state file, and readable boolean.
- `doctor --json` includes the same.
- Serialized status/doctor JSON does not include saved memory text inside `continuityBaseline`.

- [ ] **Step 3: Add MCP tests**

In `packages/mcp-server/test/handlers.test.ts`, add/extend tests to assert:

- `memory_status` includes `status.continuityBaseline`.
- It contains no memory text.
- Missing/corrupt marker warning is represented text-free if practical.

- [ ] **Step 4: Run CLI/MCP tests**

Run:

```bash
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
```

Expected: all pass.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add packages/cli/test/cli.test.ts packages/mcp-server/test/handlers.test.ts packages/cli/src/formatters.ts
git commit -m "test: cover continuity baseline diagnostics"
```

If `formatters.ts` did not change, omit it from `git add`.

## Task 4: Documentation

**Files:**
- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update CONTEXT**

Add glossary terms:

- Continuity baseline marker
- Resolved continuity baseline

Keep them domain-level, not implementation-heavy.

- [ ] **Step 2: Update README**

Add docs near freshness/continuity/handoff sections:

- The baseline marker file path defaults to `~/.memory-lane/continuity-baselines.json`.
- It stores project scope keys and timestamps only.
- It is advisory, safe to delete, and separate from memory JSONL.
- It lets SessionStart notice newer approved project state since the prior baseline.
- It does not inject handoff bodies, approve memories, mutate records, run cleanup, or activate automatic mode.
- `status --json`, `doctor --json`, and MCP `memory_status` expose text-free `continuityBaseline` diagnostics.

- [ ] **Step 3: Update ROADMAP**

In Phase 21:

- Status: Slice 3 implements cross-session freshness baseline marker.
- Todo #5: mark complete with advisory marker enabling existing newer-approved notices across sessions.
- Keep automatic mode future/inactive.

- [ ] **Step 4: Update HANDOFF**

Add recent-changes bullet for Slice 3 and update current branch/worktree note.

- [ ] **Step 5: Run diff check**

Run:

```bash
git diff --check
```

Expected: pass.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add CONTEXT.md README.md ROADMAP.md HANDOFF.md
git commit -m "docs: document continuity baseline marker"
```

## Task 5: Final Verification and Review

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
pnpm build
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Inspect diff**

Run:

```bash
git status --short
git log --oneline -8
git diff --stat main...HEAD
```

Expected: clean worktree; diff matches marker slice scope.

- [ ] **Step 3: Independent review**

Request a reviewer focused on blockers:

- strict ISO validation;
- invalid payload since does not throw;
- marker read-before-write;
- marker sidecar stores only project/timestamps;
- off mode does not write/inject;
- no memory record writes/mutations;
- no new commands/tools/config/schema/adapter payloads;
- diagnostics text-free;
- docs adequate.

- [ ] **Step 4: Opus review loop**

Ask Opus 4.8 to review code only. You execute fixes. Loop until both agree or 10 minutes passes.

- [ ] **Step 5: Repair if needed**

If reviewers find blockers, fix them, rerun affected tests and `git diff --check`, commit fixes, and re-review.

- [ ] **Step 6: Push/open PR**

After approval:

```bash
git push -u origin feature/phase-21-cross-session-freshness
```

Open PR title:

```text
feat: add cross-session continuity baseline
```

PR body should include:

- summary;
- marker path/contents;
- guardrails;
- verification commands;
- review results.
