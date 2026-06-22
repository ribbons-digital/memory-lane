# Phase 21 Slice 4 — Handoff Review + Cross-Session Continuity Validation Design

## Status

Draft for review.

Opus 4.8 high-effort planning review recommended this as a validation-led slice, not a behavior slice. Phase 21 Slices 2 and 3 added the first meaningful new Phase 21 behaviors:

- review-mode handoff proposals on existing continuity surfaces;
- cross-session continuity baseline marker for existing SessionStart newer-approved notices.

Both are intentionally review-first/read-only-ish, but they still need dogfooding evidence before Memory Lane proceeds to automatic mode or workstream discovery.

## Context

Phase 20.5 validated the Phase 13–20 stack and recommended exiting Phase 20. It explicitly did not exercise live MCP/lifecycle behavior because no live client/harness event was available.

Since then:

- Slice 1 added `memory.handoffMode` contract/diagnostics.
- Slice 2 made `review` mode behavior-active only through read-only handoff proposals on `memory-lane continuity` and MCP `memory_continuity`.
- Slice 3 added an advisory per-project continuity baseline marker so existing SessionStart newer-approved notices can detect state approved between sessions.

The roadmap says Memory Lane should validate the completed read-only/review-first stack through real multi-harness dogfooding before heavier automation.

## Decision

Slice 4 is a validation slice. It should produce a dated validation report and only make code/docs changes if validation exposes a concrete, evidence-backed defect or documentation gap.

Default expected output:

```text
docs/superpowers/validation/2026-06-22-phase-21-slice-4-handoff-continuity-validation.md
```

Optional docs updates are allowed only if validation confirms a user-facing doc gap. Code changes are allowed only as minimal fixes for reproduced defects.

## Goals

1. Validate Slice 2 review-mode handoff proposals with existing CLI/core/MCP surfaces.
2. Validate Slice 3 cross-session continuity baseline behavior through real CLI/lifecycle runner paths where practical, using isolated temp storage.
3. Confirm cross-mode behavior boundaries:
   - `manual` remains inspection-first;
   - `review` only adds proposal behavior on explicit continuity surfaces;
   - `automatic` remains inactive.
4. Confirm no unwanted writes/mutations occur outside documented marker sidecar writes.
5. Record evidence text-free and make a verdict on the next safe Phase 21 step.

## Non-goals

- No automatic-mode activation.
- No new CLI commands.
- No new MCP tools.
- No lifecycle handoff body injection.
- No recall/retrieval/ranking changes.
- No token retuning.
- No refresh/consolidation/cleanup behavior.
- No raw transcript/tool-output capture.
- No automatic approval/reject/delete behavior.
- No workstream discovery implementation.
- No mutation of the real memory store during lifecycle/write-capable exercises.

## Validation Environment Rules

- Use the real checkout/worktree under test.
- Use isolated temp directories for any write-capable commands or lifecycle runner exercises.
- Set handoff mode by writing `memory.handoffMode` into the isolated `MEMORY_LANE_CONFIG` file; do not add CLI flags or new config surfaces.
- Real/default Memory Lane storage may be inspected read-only only.
- Do not dump private memory bodies into the validation doc. Record ids, counts, categories, kinds, commands, and qualitative findings.
- `memory-lane continuity --json`, pending continuity previews, and `handoffProposal.items[].preview` can contain compact memory body text. Pasted preview evidence is allowed only for synthetic temp-store memories created for the validation. Do not paste real-store continuity/proposal JSON containing previews.
- If live MCP/client/harness validation is unavailable, run deterministic CLI/package-level equivalents and state the limitation.

## Validation Scenarios

### A. Cross-session baseline marker

Use isolated temp storage and real lifecycle SessionStart paths where practical.

Required checks:

1. First SessionStart for a project with no marker does not emit a false newer-approved notice.
2. Two-session sequence:
   - Session A starts with a deliberately chosen canonical `since` timestamp and writes the baseline marker.
   - An approved project memory is created after Session A's marker timestamp.
   - Session B starts for the same project with a later deliberately chosen canonical `since` timestamp.
   - Existing newer-approved continuity notice appears using the marker baseline.
   - Marker is updated after the Session B result is constructed. Note: `lastSeenAt` stores the adapter-provided `since` timestamp when valid, not necessarily wall-clock evaluation time.
3. `contextPolicy.mode: "off"` injects no context and writes no marker.
4. Malformed payload `since` does not throw.
5. Corrupt marker file does not throw and diagnostics remain text-free.
6. Cross-project isolation holds.
7. No active project scope results in no marker write.
8. Marker sidecar content contains only scope/timestamp fields.
9. No memory JSONL records are created by marker handling.

Evidence may include:

- commands run;
- JSON snippets with memory bodies redacted/omitted;
- marker file key list and field names, not private content;
- lifecycle result metadata.

### B. Review-mode handoff proposals

Use isolated temp storage.

Required checks:

1. `manual` mode continuity omits `handoffProposal`.
2. `review` mode continuity includes bounded `handoffProposal` only when active project scope and pending continuity candidates exist.
3. `automatic` mode remains inactive and omits `handoffProposal`.
4. Proposal suggested actions use existing review/approve commands only.
5. Proposal preview behavior is bounded and secret-filtered.
6. Viewing proposals does not mutate the store.
7. Doctor/status/MCP status do not include proposal previews.

### C. Diagnostics surfaces

Required checks:

1. `memory-lane status --json` includes `continuityBaseline` diagnostics without memory text.
2. `memory-lane doctor --json` includes `continuityBaseline` diagnostics without memory text.
3. MCP `memory_status` equivalent includes `continuityBaseline` diagnostics if practical.
4. `handoffMode` diagnostics match the expected matrix:
   - `manual`: behavior active true, inspection-first note.
   - `review`: behavior active true, read-only proposal note.
   - `automatic`: behavior active false, declared/inactive note.

### D. Lifecycle cross-mode boundary

Required checks:

1. For a fixed store/config apart from `memory.handoffMode`, SessionStart output remains identical across `manual`, `review`, and `automatic`, except for diagnostic surfaces outside lifecycle.
2. UserPromptSubmit output remains unaffected by handoff mode.
3. `automatic` does not inject handoff bodies.

### E. Live harness/MCP feasibility

If practical in the current environment:

- invoke actual `memory-lane claude session-start` and/or `memory-lane codex session-start` runner commands with synthetic payloads against isolated storage;
- invoke MCP handler/package-level tests or a local MCP tool path for `memory_status` / `memory_continuity` with projectPath.

If live desktop clients are unavailable, record this as a limitation and rely on deterministic runner/package-level evidence.

## Acceptance Criteria

The slice is complete when:

1. A dated validation report exists under `docs/superpowers/validation/`.
2. The report includes commands run, environment, evidence, limitations, and a final verdict.
3. Cross-session baseline behavior is demonstrated in isolated storage, including first-run/no-marker and two-session newer-approved notice cases.
4. Review-mode proposal behavior is demonstrated across `manual`, `review`, and `automatic`.
5. Diagnostics surfaces are demonstrated text-free.
6. Lifecycle cross-mode boundary is demonstrated.
7. Any discovered blocker is either fixed minimally with tests or documented as blocking the next automation slice.
8. ROADMAP/HANDOFF are updated with the validation verdict.
9. README is updated only if validation reveals a concrete user-facing docs gap.
10. Verification passes. Build before downstream package tests because lifecycle/CLI/MCP resolve workspace packages through built `dist` entrypoints:

```bash
pnpm build
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
git diff --check
```

## Verdict Options

The validation report must end with one of:

- **Proceed to automatic-mode design** — only if Slice 2/3 behavior is useful, low-noise, and no blockers remain.
- **Proceed to workstream-discovery design** — only if automatic mode is not yet justified but explicit continuity surfaces are solid enough for natural-language discovery work.
- **Do one prerequisite follow-up** — name exactly one bounded follow-up with evidence.
- **Pause Phase 21 automation** — if validation reveals unresolved safety/noise/confidence issues.

## Risks and Mitigations

- **Risk: Validation mutates real user memory.** Use temp storage for write-capable exercises; inspect real store read-only only.
- **Risk: Validation overstates live coverage.** Clearly separate deterministic runner/package-level evidence from live client evidence.
- **Risk: Scope creep into automatic behavior.** Code changes are allowed only for evidence-backed defects within existing surfaces.
- **Risk: Private memory leakage in validation docs.** Record ids/counts/kinds and redact/omit bodies.
