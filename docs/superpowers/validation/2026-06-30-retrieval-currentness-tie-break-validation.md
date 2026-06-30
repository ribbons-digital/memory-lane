# Retrieval Currentness Tie-break Validation

## Status

Implemented locally on `docs/retrieval-quality-currentness-scope` after user approval of the eval-first currentness scope.

Design reference: `docs/superpowers/specs/2026-06-30-retrieval-currentness-eval-scope-design.md`

Baseline reference: `docs/superpowers/validation/2026-06-27-retrieval-continuity-eval-baseline.md`

## Scope

This slice adds a narrow production ranking guardrail for lexical fallback recall.
It does not add a public eval command, change schemas, enable embeddings, add RRF/reranking, mutate memories, change lifecycle budgets, or make broad project-status prompts recall-first.

The change applies only when lexical fallback recall has an exact lexical-score tie and the raw query is currentness-like.
For those ties, `project_checkpoint` records sort by newer `updatedAt` before falling back to the existing folded-store order.
Lexical score remains primary.

## Behavior covered

The existing baseline showed this failure shape:

- query: `what is the current Memory Lane release status?`
- required: `eval-release-v038`
- forbidden stale record: `eval-stale-v037`
- root cause: both records score `1.0` lexically, and the old stable lexical sort preserved `foldMemoryRecords()` order, which sorts `createdAt` ascending and therefore kept the stale checkpoint first.

The follow-up tests now characterize that old lexical-only ordering and assert the production recall path ranks the newer release checkpoint first.

## Current eval outcome

For `recall-current-release-status` after the tie-break:

- `actualIds` starts with `eval-release-v038`, then `eval-stale-v037`.
- `stale-over-current` is absent.
- `forbidden-returned` remains because the stale checkpoint is still lexically relevant and still appears in the top-k set.

This is intentional.
The slice only fixes stale-over-current ordering, not broad recall filtering or deduplication.

Regression coverage also confirms:

- PR-description recall still ranks `eval-pr-body-rule` first.
- Docs context-budget release recall still retrieves `eval-release-v038`.
- Currentness query detection matches `current` / `latest` / exact `release status` phrasing and does not match topic-specific release or PR-body queries.

## Verification

Command run:

```bash
pnpm --filter @memory-lane/core test
```

Result: passed with 316 tests after adding guardrail coverage for non-checkpoint ties, non-currentness checkpoint ties, and all-tied folded-order fallback.

One initial test expectation was corrected during implementation: the old lexical-only baseline also has `topic-mismatch` because one forbidden item out of two scored top-k items is more than half the returned set after zero-score padding is excluded.
