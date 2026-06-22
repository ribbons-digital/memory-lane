# Phase 21 Slice 4 — Handoff Review + Cross-Session Continuity Validation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development. This is a validation slice. Do not implement new behavior unless a concrete blocker is reproduced and the fix is minimal/test-backed.

**Goal:** Validate Phase 21 Slices 2–3 before automatic mode or workstream discovery: review-mode handoff proposals and cross-session continuity baseline marker behavior.

**Primary output:** `docs/superpowers/validation/2026-06-22-phase-21-slice-4-handoff-continuity-validation.md`

**Approved spec:** `docs/superpowers/specs/2026-06-22-phase-21-handoff-continuity-validation-design.md`

## Rules

- Use isolated temp directories for all write-capable commands.
- Do not mutate real/default Memory Lane storage.
- Do not paste real memory bodies or real continuity/proposal previews into the validation doc.
- Pasted previews are allowed only for synthetic temp-store memories created during validation.
- Set handoff mode via isolated `MEMORY_LANE_CONFIG` JSON.
- Build before downstream tests.
- No new commands/tools/features unless a reproduced blocker requires a minimal fix.

## Task 1: Prepare validation environment

- [ ] Create a temp validation root, e.g. `/tmp/memory-lane-phase21-validation-<timestamp>`.
- [ ] Create at least two synthetic project directories under the temp root.
- [ ] Create isolated paths for:
  - `MEMORY_LANE_FILE`
  - `MEMORY_LANE_EMBEDDINGS_FILE`
  - `MEMORY_LANE_CONFIG`
- [ ] Use synthetic memory text only, e.g. `Synthetic validation checkpoint alpha`.
- [ ] Record environment in the validation doc:
  - branch/commit;
  - temp root;
  - Node/pnpm if useful;
  - whether live MCP/client/harness validation was available.

## Task 2: Cross-session baseline validation

Use real CLI/lifecycle runner path where practical, preferably `pnpm --filter @memory-lane/cli exec memory-lane ...` or the package CLI command with env vars.

Scenarios:

- [ ] First SessionStart with no marker:
  - Use canonical timestamp `T1`, e.g. `2026-01-01T00:00:00.000Z`.
  - Assert no false newer-approved continuity notice.
  - Assert marker is created for policy-only/selective mode.
- [ ] Two-session sequence:
  - Session A writes marker at `T1`.
  - Save an approved project memory with timestamp after `T1` (normal save may use current time; choose `T1` sufficiently old).
  - Session B starts with canonical timestamp `T2` later than `T1`.
  - Assert existing newer-approved continuity notice appears and references `T1` baseline.
  - Assert marker updates to `T2` after result construction.
- [ ] `contextPolicy.mode: "off"`:
  - Assert no additional context.
  - Assert no marker write.
- [ ] Invalid payload `since`:
  - Assert no throw.
  - Assert baseline source is `none` when no marker exists.
- [ ] Corrupt marker file:
  - Write invalid JSON to sidecar.
  - Assert no throw.
  - Assert diagnostics include warning/readable false.
- [ ] Cross-project isolation:
  - Project A and Project B should not share marker notices incorrectly.
- [ ] No active project scope:
  - Run from a directory without `.memory-lane-scope`/git if practical.
  - Assert no marker write.
- [ ] Marker sidecar content:
  - Record field names only: `projectScope`, `lastSeenAt`, `updatedAt`.
  - Assert no text/id/prompt/transcript/tool fields.
- [ ] No memory JSONL records created by SessionStart marker handling.

## Task 3: Review-mode handoff proposal validation

Use isolated temp storage and synthetic pending continuity candidates.

Scenarios:

- [ ] `manual` mode continuity omits `handoffProposal`.
- [ ] `review` mode with active project scope and pending candidate includes `handoffProposal`.
- [ ] `automatic` mode omits `handoffProposal` and remains inactive.
- [ ] Proposal actions use only existing `memory-lane review --json` and `memory-lane approve <id>` commands.
- [ ] Proposal previews are bounded and secret-filtered.
- [ ] Viewing continuity/proposal does not mutate the store.
- [ ] Doctor/status/MCP status do not include proposal previews.

## Task 4: Diagnostics validation

Scenarios:

- [ ] `memory-lane status --json` includes text-free `continuityBaseline`.
- [ ] `memory-lane doctor --json` includes text-free `continuityBaseline`.
- [ ] MCP `memory_status` equivalent includes `continuityBaseline` if practical; package-level handler evidence is acceptable if live MCP is unavailable.
- [ ] Handoff mode diagnostics matrix is correct for `manual`, `review`, and `automatic`.

## Task 5: Lifecycle cross-mode boundary

Scenarios:

- [ ] With fixed synthetic store/config except for `memory.handoffMode`, SessionStart output is identical across `manual`, `review`, and `automatic`.
- [ ] UserPromptSubmit output is unaffected by handoff mode.
- [ ] `automatic` does not inject handoff bodies.

## Task 6: Verification

Run in this order:

```bash
pnpm build
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
git diff --check
```

Record results in the validation doc.

## Task 7: Verdict and docs

- [ ] Write the dated validation report with:
  - Summary;
  - Environment;
  - Commands run;
  - Scenario evidence;
  - Limitations;
  - Defects/fixes if any;
  - Final verdict.
- [ ] Verdict must be one of:
  - Proceed to automatic-mode design;
  - Proceed to workstream-discovery design;
  - Do one prerequisite follow-up;
  - Pause Phase 21 automation.
- [ ] Update `ROADMAP.md` with Slice 4 validation verdict.
- [ ] Update `HANDOFF.md` recent changes/current branch notes.
- [ ] Update `README.md` only if validation reveals a concrete docs gap.
- [ ] Commit validation/doc changes.

## Task 8: Review

- [ ] Request independent review focused on validation sufficiency, evidence, and verdict.
- [ ] Request Opus 4.8 high-effort review of the validation report/verdict.
- [ ] Fix documentation gaps or evidence errors if found.
- [ ] Rerun `git diff --check` and any affected verification.
