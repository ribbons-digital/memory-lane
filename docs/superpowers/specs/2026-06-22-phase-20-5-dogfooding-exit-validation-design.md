# Phase 20.5 — Dogfooding and Exit Validation Design

## Status

Draft for user approval.

## Context

Memory Lane has completed the Phase 13-20 continuity foundation:

- opt-in session summaries saved as pending `session_summary` memories;
- review/status/dashboard/MCP review surfaces;
- canonical continuity read model through CLI/MCP/lifecycle guidance;
- global preference layering and context-policy diagnostics;
- review-first checkpoint, correction, and procedure candidates;
- freshness metadata, stale/expired advisories, and manual dry-run revision suggestions.

The roadmap now requires a validation gate before adding heavier automation such as `memory-lane refresh`, recall/injection filtering, consolidation apply paths, retrieval rewrites, or Phase 21 handoff-free sessions. This spec defines that gate as a no-code product validation slice.

## Problem

Memory Lane has many review-first signals, but their combined real-world usefulness is not yet proven:

- The review queue may still become noisy even if each individual capture rule is conservative.
- Freshness advisories may be technically correct but not useful enough to justify a refresh workflow.
- Continuity output may be helpful in one harness but confusing in MCP clients without project context.
- Context-policy character budgets may be adequate, or they may need token-aware reporting; this should be decided from evidence rather than guessing.
- Phase 21 handoff-free work is risky unless current review, continuity, and freshness surfaces are trusted.

## Goals

1. Validate the completed Phase 13-20 stack against real Memory Lane usage before adding new behavior.
2. Measure review-queue health across generated memory kinds and harness/provenance sources.
3. Confirm whether `continuity`, `status --since`, `doctor --since`, and dashboard output are understandable and actionable.
4. Determine whether freshness advisories are useful enough to justify a future refresh workflow.
5. Determine whether context-policy diagnostics need token-accounting follow-up.
6. Produce an explicit exit verdict: proceed to Phase 21, run one evidence-backed Phase 20 follow-up, or pause for hardening.

## Non-goals

This slice does not add or change product behavior.

Out of scope:

- No new CLI commands, MCP tools, config flags, schema fields, lifecycle events, or adapter payloads.
- No `memory-lane refresh` command.
- No recall/injection filtering or stale-memory downranking.
- No token-budget retuning or token-based budget enforcement.
- No retrieval rewrites, RRF, reranking, graph expansion, or embedding default changes.
- No consolidation command or consolidation apply path.
- No raw transcript or raw tool-output capture.
- No automatic approval, deletion, rejection, cleanup, or silent memory mutation.
- No native skill/rule export for procedure memories.

## Canonical terms

Use existing project language:

- **Continuity read model**: the canonical source for resumption/status questions.
- **Checkpoint candidate**, **correction candidate**, and **recovery-backed procedure candidate**: pending review-first generated memories.
- **Freshness advisory**: read-only stale/expired/current classification for approved memories with explicit freshness metadata.
- **Context policy**: existing `off` / `policy-only` / `selective` behavior and item/character budgets.
- **Validation note**: the human-written evidence artifact produced by this slice. It is not a memory record, not product data, and not a schema contract.

## Validation artifact

Create one Markdown validation note under:

```text
docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md
```

The note should be a structured evidence report, not an implementation plan. It should include:

1. **Environment**
   - Memory Lane version/commit under test.
   - Harnesses tested: CLI, Claude Code hooks where available, Codex hooks where available, pi where available, and MCP clients where available.
   - Whether a summarization provider was configured.
   - Project paths/scopes used.

2. **Commands and surfaces exercised**
   - `memory-lane review` and targeted review filters.
   - `memory-lane dashboard`.
   - `memory-lane continuity`.
   - `memory-lane status --since <timestamp>`.
   - `memory-lane doctor --since <timestamp>`.
   - MCP `memory_review`, `memory_status`, and `memory_continuity` where practical.
   - Existing lifecycle/session-summary flows where practical.

3. **Review queue health**
   - Counts by status, kind, source, and provenance.
   - Duplicates or near-duplicates observed.
   - False positives and false negatives, described without dumping memory bodies.
   - Whether generated candidates are understandable enough to approve/reject.
   - Any candidates generated during the validation run itself, so pre-existing noise is not confused with validation side effects.

4. **Continuity usefulness**
   - Whether `memory-lane continuity` answers last-work/current-status/next-step questions without relying on recall alone.
   - Whether pending continuity candidates are visible but not overbearing.
   - Whether MCP clients need clearer `projectPath` guidance.

5. **Freshness advisory usefulness**
   - Whether stale/expired advisory blocks are noticeable.
   - Whether suggested dry-run commands are copy-pasteable.
   - Whether advisories are too noisy, too sparse, or missing obvious stale state.
   - Count basis for the judgment, such as stale/expired advisory counts across visible approved memories, without dumping memory bodies.
   - Whether a future refresh workflow is justified.

6. **Context-policy observations**
   - Context policy mode and budgets in use.
   - Selected/omitted counts available from status/doctor/debug metadata.
   - Any evidence that character budgets are insufficient.
   - Whether token-accounting reporting should be the next code slice.

7. **Exit verdict**
   Choose exactly one:
   - `Exit Phase 20`: current surfaces are useful enough to start Phase 21 design.
   - `One Phase 20 follow-up`: name the single next code slice and cite evidence.
   - `Hardening pause`: do not start Phase 21; fix a concrete reliability or UX issue first.

8. **Recommended next slice**
   - One sentence naming the next slice.
   - Why it is next.
   - What is explicitly out of scope.

## Validation procedure

The validator should use current product surfaces only.

Suggested command sequence:

```bash
git status --short
git rev-parse HEAD
memory-lane status --json
memory-lane dashboard
memory-lane review
memory-lane review --json
memory-lane continuity
memory-lane status --since <ISO>
memory-lane status --json --since <ISO>
memory-lane doctor --since <ISO>
memory-lane doctor --json --since <ISO>
```

Choose `<ISO>` from a real continuity boundary, such as the current session start time, a prior session start time, or a real checkpoint/release timestamp. Record which timestamp was used and why. Do not choose an arbitrary timestamp just to force stale/newer-memory output.

Where an MCP client is available, exercise equivalent MCP calls:

- `memory_status({ projectPath })`
- `memory_review({ projectPath })`
- `memory_continuity({ projectPath })`

Where lifecycle hooks are available and safe to run, exercise existing supported paths without changing configuration:

- Claude Code `SessionStart`, `UserPromptSubmit`, `Stop`, `PostToolUse`, and `SessionEnd` only if already configured and appropriate.
- Codex `SessionStart`, `UserPromptSubmit`, `Stop`, and `PostToolUse`; do not add unsupported Codex `SessionEnd`, and do not treat the test/future-compatible Codex-shaped session-end adapter path as a user-facing hook.
- pi existing memory tools and explicit `/memory session-summary`; do not add automatic pi compaction/agent-end behavior.

Running lifecycle paths may create pending candidates. If that happens, record those candidates as validation-generated side effects so review-queue health findings distinguish pre-existing queue noise from newly generated evidence.

## Privacy and safety rules

- Do not paste full memory bodies into the validation note.
- Use ids, counts, kinds, sources, provenance, and short paraphrases only where needed.
- Do not run destructive commands unless they are already part of a separate user-approved cleanup.
- Do not approve/reject/delete memories as part of validation unless the user explicitly asks.
- Do not alter hook/MCP/client configuration as part of this slice.
- Do not create synthetic product behavior just to make the validation pass.

## Acceptance criteria

The slice is complete when:

1. A validation note exists at the path above.
2. The note records the Memory Lane commit/version and commands/surfaces exercised.
3. The note includes review-queue, continuity, freshness, and context-policy findings.
4. The note includes an explicit exit verdict with evidence.
5. The note recommends exactly one next slice, or explicitly recommends stopping.
6. `ROADMAP.md` and `HANDOFF.md` are updated only if the validation produces a new decision or next-slice recommendation that should survive handoff.
7. Any `ROADMAP.md` or `HANDOFF.md` updates restate the validation note's verdict; they do not introduce a separate decision that is absent from the note.
8. `git diff --check` passes.

## Decision rules

Use these rules to avoid subjective drift:

- Recommend `Exit Phase 20` only if review candidates are understandable, continuity output is useful, freshness advisories are not noisy, and no blocking harness-specific confusion is found.
- Recommend a token-accounting slice only if validation shows character budgets or selected/omitted counts are insufficient to reason about context-window risk.
- Recommend a refresh slice only if stale/expired advisories are both useful and common enough that manual dry-run command lists are insufficient.
- Recommend retrieval-eval work only if continuity/recall failures are due to not finding known relevant approved memories, not missing memory capture.
- Recommend onboarding/doctor hardening only if validation is blocked or confused by setup/project-scope problems.
- Recommend viewer/dashboard work only if CLI/MCP surfaces have enough signal but are too cumbersome to inspect repeatedly.

## Risks

- **Risk: validation becomes open-ended.** Mitigation: one validation note, one exit verdict, one next-slice recommendation.
- **Risk: dogfooding changes the memory base.** Mitigation: default to inspection; mutations require separate user approval.
- **Risk: evidence leaks private memory content.** Mitigation: record metadata, ids, counts, and paraphrased findings, not memory bodies.
- **Risk: harness availability varies.** Mitigation: record what was tested and what was not; do not block the slice on unavailable clients.

## Open questions

None for implementation. If a harness is unavailable during validation, document it as not tested rather than expanding scope.
