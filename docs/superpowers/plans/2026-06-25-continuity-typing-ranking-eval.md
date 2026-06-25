# Continuity Typing and Ranking Eval Implementation Plan

## Status

Implementation complete on `feat/continuity-typing-eval`; full validation passed and Opus 4.8 final review said “Ship it.” PR opening remains.

## Scope

Implement an eval-first continuity typing slice that prevents broad “last worked on” continuity slots from being dominated by ordinary corrections/procedures while preserving those memories as operating guidance and query-specific workstream candidates.

## Guardrails

- Harness-neutral core implementation.
- Review-safe and read-only: no memory mutation, auto-approval, cleanup, rescope, or deletion.
- No recall ranking changes.
- No LLM classifier, embeddings/reranking rewrite, external service, or raw transcript capture.
- Preserve existing public read-model fields unless compatibility is explicitly reviewed.
- Keep previews bounded and secret-filtered.

## Task 1 — Add continuity role fixtures and failing tests

- [x] Add focused tests in `packages/core/test/continuity-read-model.test.ts` or a new `continuity-typing.test.ts`.
- [x] Cover the Pi Slice D regression fixture:
  - older release/dogfood checkpoint/session summary;
  - newer PR-body-format correction (`c78cdc00`-style);
  - broad query “What were we last working on?”.
- [x] Assert broad latest progress selects the release/checkpoint memory, not the correction.
- [x] Assert correction/procedure remains visible in an operating guidance/reporting surface.
- [x] Add topic-specific query fixture showing corrections/procedures can still appear in `workstreamDiscovery.candidates`.

## Task 2 — Add deterministic continuity role classifier

- [x] Implement a pure role-classification helper in core, likely `packages/core/src/continuity-roles.ts`; core owns continuity role decisions, and adapters only render shared read-model outputs.
- [x] Export a narrow type such as `ContinuityRole` only if the read model or tests need it.
- [x] Use existing helpers where possible without making selection decide roles:
  - `classifyCheckpointCandidate()` for progress evidence;
  - field-derived workflow checks, including `kind === "workflow_rule"`, for `operating_agreement` role classification;
  - existing secret filtering remains in preview construction.
- [x] Keep classification conservative:
  - checkpoint/session-summary/checkpoint-candidate => progress;
  - correction/procedure => operating guidance unless checkpoint-like;
  - workflow rules/global workflow => operating guidance/global workflow.
- [x] Update operating-agreement selection, if needed, so `selectOperatingAgreements()` consumes the precomputed `operating_agreement` role instead of deciding that role itself. (No selector change needed in this slice; the new read-model operating-guidance surface consumes the core classifier while the existing operating-agreements summary remains compatible.)

## Task 3 — Extend the continuity read model compatibly

- [x] Add a bounded `latestProgress` preview as the progress-only field; do not redefine `latestApproved.project` in this first implementation.
- [x] Add bounded `operatingGuidance`; keep derived role labels, raw per-record diagnostics, and aggregate `roleSummary` internal/report-only for this first slice.
- [x] Ensure `latestApproved.project` remains present with existing legacy semantics for current adapters/tests while adding new expectations for `latestProgress` where appropriate.
- [x] Keep `warnings`, `operatingAgreements`, and `workstreamDiscovery` behavior intact.
- [x] Ensure no raw secret text appears in diagnostics or guidance.

## Task 4 — Update CLI/MCP/Pi expectations only if JSON shape changes

- [x] If new fields are added, update CLI human formatter to prefer `latestProgress` wording for broad prior-work/status output while preserving existing `latestApproved.project` JSON compatibility.
- [x] Update MCP handler tests only if they assert exact shape.
- [x] Update Pi adapter/generated bridge tests only if they render the latest slot directly.
- [x] Avoid harness-specific ranking rules.

## Task 5 — Docs and validation

- [x] Update `ROADMAP.md` status for the eval/typing implementation slice.
- [x] Update `HANDOFF.md` with current branch/status and next step.
- [x] Run:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm test
git diff --check
```

- [ ] Open a PR and wait for user merge; do not merge directly into `main`.

## Review Decisions

1. Ship a new `latestProgress` field first; keep `latestApproved.project` as the existing legacy compatibility slot for the first implementation.
2. Include bounded corrections/procedures in `operatingGuidance` when role classification marks them as operating guidance, even if they are not selected by `operatingAgreements`.
3. Keep role diagnostics internal/report-only for the first implementation; public continuity JSON should expose bounded previews, not raw role labels/reasons.
