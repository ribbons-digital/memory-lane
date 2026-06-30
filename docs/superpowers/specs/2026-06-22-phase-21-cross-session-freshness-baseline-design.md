# Phase 21 Slice 3 — Cross-Session Freshness Baseline Design

## Status

Draft for review.

Opus 4.8 planning review found that the existing newer-approved continuity machinery is mostly present but lacks a persisted cross-session baseline. SessionStart adapters currently pass the current session timestamp as `since`, so `newer-approved` usually evaluates against "now" and cannot detect approved Memory Lane state created between the prior session and this new session.

This spec proposes a tiny advisory per-project baseline marker so the existing bounded continuity notice can work across real sessions without adding handoff body injection or any new command/tool surface.

## User Decision Required Before Implementation

This slice introduces one new local advisory state file, separate from the memory JSONL source of truth:

```text
<Memory Lane storage dir>/continuity-baselines.json
```

The marker stores only project scope keys and timestamps. It is not a memory record, is safe to delete, and is used only to choose a `since` baseline for read-only continuity freshness checks.

If this new local state file is not acceptable, the fallback slice should be docs/diagnostics-only: document that harnesses must pass a prior-session timestamp for cross-session newer-approved detection and expose that no persisted baseline exists. Do not implement the marker without user approval.

## Context

Existing pieces:

- `buildFreshnessStatus()` and `buildContinuityHints()` can detect approved visible memories newer than a supplied `since` timestamp.
- `renderContinuityNotice()` already renders a bounded text-free notice when newer approved state exists.
- `handleSessionStart()` already calls `engine.continuityHints({ since: input.since })` and renders a SessionStart continuity notice.
- Claude/Codex SessionStart payload parsing sets `input.since` from `timestamp`, `started_at`, or `session_started_at`, which is generally the current session start timestamp.

Gap:

- Memory Lane does not persist a per-project "last continuity baseline" timestamp.
- Therefore real SessionStart checks usually ask "what changed after this session started?" instead of "what changed since this project was last seen?"
- Manual CLI `status --since <older-time>` works, but hands-free cross-session detection does not.

## Goals

1. Make existing newer-approved continuity notices work across sessions for the same project.
2. Keep the behavior read-only from a memory perspective: no memory records are written, approved, rejected, deleted, or mutated.
3. Store only a tiny advisory marker outside the memory log.
4. Preserve current SessionStart context policy behavior and budgets.
5. Add text-free diagnostics so users can inspect whether a persisted baseline exists.
6. Avoid new CLI commands, MCP tools, config flags, schema migrations, recall/ranking changes, refresh/consolidation, or automatic handoff-body injection.

## Non-goals

- No new CLI command.
- No new MCP tool.
- No memory JSONL writes.
- No automatic approval/reject/delete/cleanup.
- No refresh command or consolidation behavior.
- No recall/retrieval/ranking rewrite.
- No token-budget retuning.
- No raw transcript or tool-output capture.
- No handoff body injection.
- No activation of `memory.handoffMode: "automatic"`.
- No per-project/global disable flag beyond deleting the advisory marker file or setting context policy `off` for lifecycle context.

## Domain Terms

Add to `CONTEXT.md`:

**Continuity baseline marker**:
An advisory per-project timestamp recording when Memory Lane last evaluated SessionStart continuity for that project. It lets a future session ask whether approved Memory Lane state is newer than the prior baseline. It is not a memory, session summary, approval, checkpoint, or source of truth.

**Resolved continuity baseline**:
The timestamp actually used for a freshness/continuity check. For SessionStart, Memory Lane prefers the prior project baseline marker when present; otherwise it can fall back to the adapter-provided `since` timestamp. The marker is read before it is updated for the current session.

## Data Contract

### Marker file

Path:

```text
path.join(path.dirname(memoryPath), "continuity-baselines.json")
```

With default storage this is:

```text
~/.memory-lane/continuity-baselines.json
```

Suggested shape:

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

Rules:

- Key markers by existing project scope key.
- Store only timestamps and scope key.
- Do not store memory ids, memory text, prompts, transcripts, tool outputs, model names, branch names, or harness-specific payloads.
- Treat missing/corrupt/unparseable marker file as no marker.
- Treat marker timestamps as valid only when they pass the same strict ISO timestamp validation used by freshness `since` inputs.
- Write best-effort: marker failures must not break lifecycle hook output.
- Marker reads/writes must be synchronous and wrapped in `try`/`catch` because `handleSessionStart()` is synchronous.
- Use the existing sync atomic-write style (`tmp` + rename) where practical.

### Diagnostics

Add text-free diagnostics to `MemoryEngine.doctor()`:

```ts
continuityBaseline: {
  projectScope: string | "none"
  source: "marker" | "none"
  since?: string
  stateFile: string
  readable: boolean
  writable?: boolean
  warning?: string
}
```

Notes:

- `status --json`, `doctor --json`, and MCP `memory_status` inherit this through existing doctor surfaces.
- Human `doctor` may render this as generic JSON unless a compact formatter is easy; no new human block is required.
- Do not expose marker diagnostics in lifecycle injected context.

### Lifecycle decision metadata

Extend `ContinuityContextDecision` with optional resolved-baseline metadata:

```ts
continuityBaseline?: {
  source: "marker" | "payload" | "none"
  since?: string
}
```

This is metadata only. It is not rendered into user context unless already implied by the existing continuity notice text.

## Behavior Contract

### Resolving baseline on SessionStart

For `handleSessionStart()`:

1. Refresh project scope from `input.cwd` as today.
2. Resolve context policy as today.
3. Read the current project baseline marker before writing any new marker.
4. Choose `resolvedSince`:
   - If a marker exists for the active project scope and `lastSeenAt` is a strict valid ISO timestamp, use marker `lastSeenAt` with source `marker`.
   - Else if `input.since` is present and passes the same strict ISO validation as freshness `since`, use `input.since` with source `payload`.
   - Else use no baseline with source `none`.
5. Never pass an invalid `since` into `engine.continuityHints()` or `renderContinuityNotice()`.
6. Call `engine.continuityHints({ since: resolvedSince })` instead of raw `input.since`.
7. Pass `resolvedSince` into `renderContinuityNotice()` so existing notice text says the actual baseline.
8. Attach `continuityBaseline` metadata to the `ContinuityNoticeResult` before it is converted by `continuityDecision()`, so existing spread behavior carries it into `contextDecision.continuity`.
9. After computing the notice/result, best-effort write the current SessionStart marker timestamp for the active project.
10. Use read-before-write ordering so the current session does not erase the prior baseline before checking it.

This also hardens an existing latent issue: today malformed adapter timestamps can reach `buildFreshnessStatus()` and throw during SessionStart continuity hint generation.

### Marker write timestamp

Write marker timestamp as:

- `input.since` only if it passes the same strict ISO validation as freshness `since` inputs;
- otherwise `new Date().toISOString()`.

This keeps canonical adapter payload timestamps useful without persisting offset, non-canonical, or malformed timestamp strings that could later throw when used as `since`.

### Context policy interaction

- If `memory.contextPolicy.mode === "off"`, do not inject context, do not compute continuity hints, and do not write the marker. This keeps `off` as the full lifecycle-context opt-out for Slice 3.
- For `policy-only` and `selective`, use the resolved baseline for continuity hints and notice generation.
- Keep existing context budgets unchanged.

### Project scoping

- If no project scope is active, do not read/write a project marker and use `input.since` if present.
- Different project scope keys must not affect each other.
- Existing worktree-aware project scope resolution should provide stable scope keys across git worktrees.

### Handoff mode interaction

This slice is independent of `memory.handoffMode`:

- `manual`: SessionStart newer-approved notice can use the marker.
- `review`: Same as manual; review-mode handoff proposals remain explicit continuity-surface behavior only.
- `automatic`: Remains inactive; marker does not inject handoff bodies.

## Integration Points

### Core

Add a small helper module, for example:

```text
packages/core/src/continuity-baseline.ts
```

Responsibilities:

- read marker file synchronously;
- write marker file synchronously and atomically;
- get marker for project scope;
- build diagnostics;
- handle corrupt/missing file safely;
- expose or reuse a strict ISO timestamp validator compatible with freshness `since` validation.

Update `MemoryEngine`:

- derive `continuityBaselinePath` from the active storage facade, which preserves the legacy `path.dirname(memoryPath)` behavior for the single-store facade;
- expose `continuityBaselineDoctor()` through `doctor()`;
- add methods needed by lifecycle, for example:

```ts
resolveContinuityBaseline(inputSince?: string): { source: "marker" | "payload" | "none"; since?: string }
recordContinuityBaseline(observedAt?: string): void
```

These methods should use current `this.scope` and no-op without active project scope. They must catch marker I/O/parse errors and never throw from lifecycle callers.

No changes are expected in `freshness.ts` math, but the existing strict ISO validator should be exported or mirrored so invalid payload/marker timestamps are filtered before calling freshness helpers.

### Lifecycle

Update `handleSessionStart()` only:

- resolve baseline after `engine.refreshScope(input.cwd)` and before `engine.continuityHints()`;
- call `continuityHints({ since: resolved.since })`;
- pass `resolved.since` to `renderContinuityNotice()`;
- include `continuityBaseline` metadata in `contextDecision.continuity`;
- best-effort record the new marker after building result;
- ensure `off` mode still returns no additional context.

No Stop/PostToolUse/UserPromptSubmit/SessionEnd behavior changes.

### CLI/MCP

- `status --json`, `doctor --json`, and MCP `memory_status` should include `continuityBaseline` via `doctor()`.
- Human formatter changes are optional. If generic `formatDoctor()` prints the object, that is acceptable for Slice 3.
- No new commands or MCP tools.
- `memory_continuity` is unchanged.

### Adapters

No adapter code changes are required unless tests reveal payload parsing defects. Claude/Codex already pass `timestamp`/`started_at`/`session_started_at` into `SessionStartInput.since`. Pi uses shared lifecycle handlers and should benefit once its before-agent-start path calls `handleSessionStart` with cwd.

## Tests

Add or update tests for:

1. First SessionStart with no marker produces no false newer-approved notice.
2. Two simulated sessions for the same project:
   - Session A writes a marker.
   - An approved project memory is saved after marker time.
   - Session B starts and uses the marker baseline.
   - Existing continuity notice reports newer approved state.
3. Marker read-before-write ordering: Session B detects records newer than Session A marker, then updates marker to Session B timestamp.
4. Marker is project-scoped: another project marker/memory does not trigger this project.
5. Missing marker file is handled as source `payload` or `none` without throwing.
6. Present-but-invalid `input.since` is handled as source `none` without throwing when no valid marker exists.
7. Corrupt marker file is handled gracefully and diagnostics include a warning.
8. `contextPolicy.mode: "off"` injects no context and does not write the marker.
9. `policy-only` and `selective` use the same resolved baseline and preserve existing budgets/selection behavior.
10. `contextDecision.continuity.continuityBaseline` reports `marker`, `payload`, or `none` without memory text.
11. `MemoryEngine.doctor()` includes text-free `continuityBaseline` diagnostics. Doctor diagnostics use only `marker` or `none` because doctor has no payload timestamp.
12. CLI `status --json` and `doctor --json` include `continuityBaseline`.
13. MCP `memory_status` includes `continuityBaseline`.
14. No new memory record is created by SessionStart marker handling.
15. No lifecycle output includes memory ids/text from the marker.

Run at least:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
pnpm build
git diff --check
```

## Documentation

Update:

- `CONTEXT.md`
  - Add continuity baseline marker and resolved continuity baseline terms.
- `README.md`
  - Explain cross-session freshness baseline behavior.
  - Clarify marker file is advisory, text-free, safe to delete, and not a memory source of truth.
  - Clarify no handoff body injection or automatic approval is added.
- `ROADMAP.md`
  - Mark Phase 21 Todo #5 as implemented by a persisted advisory baseline marker for existing newer-approved notices.
- `HANDOFF.md`
  - Record the slice, marker path, and guardrails.

Do not edit personal/global skill files in this repository slice.

## Acceptance Criteria

The slice is complete when:

1. SessionStart can detect approved project progress newer than the prior project baseline in a two-session test.
2. First-run/no-marker behavior does not create false newer-approved notices.
3. Marker read-before-write behavior is tested.
4. Marker data is scoped by project and contains no memory text, prompts, transcripts, or tool outputs.
5. Marker corruption/missing file is non-fatal.
6. Invalid payload/marker timestamps never throw during SessionStart.
7. `status --json`, `doctor --json`, and MCP `memory_status` expose text-free baseline diagnostics.
8. No new CLI command, MCP tool, config flag, memory schema field, or adapter payload is added. The marker file is a new sidecar state artifact, not a memory schema change.
9. No memory records are written or mutated by marker handling.
10. Lifecycle context policy behavior and budgets remain unchanged except the existing newer-approved notice can now use the resolved baseline.
11. `automatic` mode remains inactive.
12. README, ROADMAP, CONTEXT, and HANDOFF are updated.
13. Required tests/build/diff-check pass.

## Risks and Mitigations

- **Risk: New local state file feels like hidden automation.** Mitigation: marker is text-free, advisory, safe to delete, documented, and not a memory record. User approval is required before implementation.
- **Risk: False positives across projects.** Mitigation: key by existing project scope key and test cross-project isolation.
- **Risk: Marker corruption breaks hooks.** Mitigation: treat corrupt marker as missing and surface diagnostic warning.
- **Risk: Concurrent sessions race marker writes.** Mitigation: best-effort last-write-wins is acceptable because notices are advisory; use atomic writes to avoid partial files.
- **Risk: Current-session payload timestamp hides prior marker.** Mitigation: prefer marker over payload when marker exists and read before writing.
- **Risk: This becomes automatic handoff.** Mitigation: only existing bounded continuity notice changes; no body injection, approval, or recall behavior changes.
