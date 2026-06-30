# Retrieval Currentness Eval Scope Design

## Status

Draft for Opus review and user approval.

## Entry gate

Planning/spec only.
Do not implement until the user approves this spec.

## Background

The retrieval/continuity eval baseline from PR #70 established a small internal test-only corpus and findings report before any retrieval/ranking changes.
It found that continuity slotting behaved well on the small corpus, but explicit recall had a concrete weakness:

- Query: `what is the current Memory Lane release status?`
- Required: newest release checkpoint.
- Forbidden: older stale release checkpoint ranking at or above the newest checkpoint.
- Observed: lexical-only fallback recall retrieved the required current record, but an older release-status checkpoint ranked at or above it.

This is expected for default no-embedding lexical fallback because it currently sorts by lexical score only.
When stale and current records have similar lexical overlap, folded-store order can decide the ranking.

The SessionStart descriptor track is now paused after Slice A/B shipped and dogfooded.
The user explicitly asked to continue with Retrieval Quality / Continuity Evaluation.

## Problem

Memory Lane has two intended lanes for prior-work questions:

1. **Continuity lane** for broad project-status, latest-progress, and next-work prompts.
2. **Recall lane** for explicit topic-specific memory lookup.

The eval baseline shows a boundary problem:

- Broad/current-status questions should usually route to continuity.
- Explicit recall still exists and can be invoked directly by users or tools.
- If explicit recall returns stale project checkpoints ahead of current checkpoints for current-status wording, agents may trust the wrong memory unless they know to call continuity first.

We need decide whether to improve explicit recall with a bounded currentness treatment, or document that current-status questions remain continuity-first and recall should stay lexical-only unless topic-specific.

## Goals

- Reuse the existing internal/test-only eval corpus and findings language.
- Decide whether currentness in explicit recall is user-visible enough to justify a small behavior change.
- If justified, define a bounded production change that improves stale-vs-current ordering for checkpoint-like project records without a retrieval rewrite.
- Preserve continuity-first guidance for broad project-status prompts.
- Keep the slice small, deterministic, and non-breaking.

## Non-goals

- No RRF, reranker, embedding-default change, semantic provider work, or graph expansion.
- No public `memory-lane eval` command.
- No production eval API.
- No raw transcript indexing.
- No memory schema expansion or migration.
- No auto-consolidation, deletion, approval, or mutation.
- No lifecycle injection budget changes.
- No harness-specific generated bridge changes.
- No LLM classifier or LLM evaluator.

## Decision options

### Option A: Keep explicit recall lexical-only and reinforce continuity-first routing

Under this option, no production retrieval behavior changes.
The follow-up would update docs/tests only:

- Keep the baseline finding as accepted behavior.
- Clarify that broad/current-status questions should use `memory-lane continuity` or `memory_continuity` first.
- Possibly add a small regression test proving continuity answers current-status prompts correctly.

Pros:

- Zero behavior risk.
- Preserves recall as simple topic search.
- Avoids ranking changes based on a small corpus.

Cons:

- Direct `memory-lane recall "current release status"` remains capable of stale-over-current ordering.
- Agents or users that invoke recall directly can still see misleading order.
- Does not reduce the baseline failure tag.

### Option B: Add bounded currentness tie-break to lexical fallback recall

Under this option, production recall gets a narrow deterministic tie-break only in the default lexical fallback path.
The goal is not to make recall a continuity engine.
It only prevents stale checkpoint-like records from outranking newer checkpoint-like records when lexical relevance is similar.

Candidate behavior:

1. Keep lexical score as the primary score.
2. Apply currentness ordering only when records are already lexically relevant.
3. Limit the treatment to project-visible records that are checkpoint-like:
   - `kind === "project_checkpoint"`;
   - or optionally `kind === "session_summary"` if the eval shows it is needed;
   - do not apply to workflow rules, preferences, corrections, or procedures.
4. For current-status/release-status query families, sort by:
   - lexical score descending;
   - checkpoint-like currentness/updatedAt descending within a narrow lexical-score band;
   - existing order as final tie-break.
5. Keep topic-specific recall mostly unchanged.

The lexical-score band is the key guardrail.
A newer weakly relevant checkpoint should not jump above a strongly relevant older topic memory.
A concrete first implementation could only reorder when lexical scores are equal, then evaluate whether that is enough.
If equality-only is too weak, a later spec can justify a small threshold.

Pros:

- Directly targets the observed stale-over-current failure.
- Deterministic and small.
- Keeps lexical relevance primary.
- Does not require embeddings or a ranking rewrite.

Cons:

- Any production ranking change can have side effects.
- UpdatedAt is not always semantic currentness.
- Query-family detection must stay conservative.
- The small eval corpus may be insufficient to tune thresholds.

### Option C: Add eval-only characterization first, defer production behavior

Under this option, the next implementation adds more characterization around the existing baseline but still avoids production behavior changes.
It would add one or two focused eval scenarios that separate:

- broad current-status recall wording;
- topic-specific release lookup;
- PR-body/topic recall with reference-bearing status checkpoint distractors.

Pros:

- Highest confidence before behavior changes.
- Avoids overfitting to one baseline row.

Cons:

- Does not improve user-visible behavior yet.
- May feel like another baseline slice without product payoff.

## Recommendation

Recommend **Option B with an equality-only first slice**, gated by tests and a findings update.

Rationale:

- The baseline already found a concrete stale-over-current failure.
- For the existing baseline fixture, the stale and current release-status records both begin with `Current Memory Lane release status`, so the known query gives them equal lexical scores. With the current tokenizer, the query tokens are `current`, `memory`, `lane`, `release`, and `status`; both records hit all five tokens, and `lexicalScore()` caps the result at `1.0`.
- Equality-only tie-breaking is therefore sufficient for the known failure by construction.
- Equality-only is also the safest first behavior change because it cannot let recency swamp stronger lexical relevance.

Threshold-based currentness boosts are explicitly out of scope.
If future evidence shows stale records can outrank current records with strictly higher lexical scores, stop and design a separate threshold proposal rather than broadening this slice silently.

## Proposed first implementation slice

Definition of done:

1. Add an explicit red-baseline assertion that `recall-current-release-status` currently has the `stale-over-current` failure tag. This assertion does not exist today; the failure is currently recorded in the findings doc but not enforced by the eval test.
2. Implement equality-only currentness tie-break in the bottom lexical fallback sort path in `packages/core/src/retrieval.ts`, the default no-embedding path exercised by `MemoryEngine.recall()` and the eval recall lane.
3. Apply the same shared lexical fallback comparator to the semantic-path `fallbackToAllVisibleOnMiss` lexical fallback in `packages/core/src/retrieval.ts` to avoid inconsistent fallback behavior, while keeping semantic vector ranking otherwise unchanged.
4. Flip the `recall-current-release-status` assertion so `stale-over-current` is absent after the behavior change and the newest release checkpoint ranks ahead of the stale checkpoint.
5. Keep non-current topic recall behavior unchanged with regression coverage.
6. Update the eval findings doc with before/after interpretation.
7. Update ROADMAP/HANDOFF with status and next decision.

Expected code touch points:

- `packages/core/src/retrieval.ts`
- `packages/core/src/search.ts`, adding a new helper near existing checkpoint query detection
- `packages/core/test/retrieval-continuity-eval.test.ts`
- `packages/core/test/scoring.test.ts` or `engine.test.ts` only if helper behavior needs direct tests
- `docs/superpowers/validation/2026-06-27-retrieval-continuity-eval-baseline.md` or a new follow-up validation doc
- `ROADMAP.md`
- `HANDOFF.md`

## Query detection guardrail

Do not reuse broad continuity intent detection wholesale.
This recall tie-break should be narrower than lifecycle continuity routing.

There is already a checkpoint-like query detector, `isCheckpointRecallQuery()`, used for the semantic-path checkpoint boost.
It intentionally matches resume/left-off/current-progress phrasing, and it does **not** match this slice's target queries such as `current release status`, `latest release status`, or `current project checkpoint`.

Slice implementation should add a separate adjacent helper such as `isCurrentnessRecallQuery()`.
Do not broaden `isCheckpointRecallQuery()` in this slice, because that would also change the existing semantic-path checkpoint boost semantics.

Candidate currentness query family:

- contains `current` or `latest`; or contains the exact phrase `release status`;
- and contains project/status-ish terms such as `release`, `status`, `progress`, or `checkpoint`.

The exact phrase requirement matters: a query with only `release` should not match unless it also says `current`, `latest`, or `release status`.

Examples expected to match:

- `what is the current Memory Lane release status?`
- `latest release status`
- `current project checkpoint`

Examples expected not to match:

- `how should I create GitHub PR descriptions?`
- `what release shipped docs context-budget?`
- `where did we fix PR body formatting?`

## Ranking guardrail

For lexical fallback recall only:

1. Compute lexical scores exactly as today.
2. Filter remains unchanged.
3. Sort primarily by lexical score descending.
4. If lexical scores are equal and the query is currentness-like:
   - checkpoint-like records sort before non-checkpoint-like records only when both are project progress/status-like candidates;
   - among checkpoint-like records, newer `updatedAt` sorts first.
5. Preserve existing stable behavior otherwise.

The current final tie-break before this slice is `foldMemoryRecords()` order plus V8 stable `Array.sort` behavior.
`foldMemoryRecords()` sorts by `createdAt` ascending, so exact lexical ties currently keep oldest-created records first.
That oldest-first tie behavior is the root cause of the stale-over-current baseline failure.
After the new currentness tie-break runs, createdAt-ascending folded-store order should remain only the final fallback when lexical score, currentness eligibility, and `updatedAt` are all tied.
Tests should name this so `existing order` is not ambiguous.

This intentionally does not add a numeric recency score to all lexical fallback results.

Use `updatedAt` for this equality-only tie-break.
`freshness.capturedAt` exists, but it is optional advisory metadata and many historical checkpoint records do not have it.
A later slice can revisit captured-at semantics if freshness adoption grows.

## Tests

Minimum tests:

1. Current release-status recall has an explicit pre-change characterization showing `stale-over-current` on the existing baseline fixture.
2. Current release-status recall ranks the newest checkpoint ahead of the stale checkpoint after the equality-only lexical fallback tie-break.
3. The eval report for `recall-current-release-status` no longer includes `stale-over-current` after the behavior change. The implementation should inspect and document any other failure-tag changes instead of assuming only one tag changes.
4. PR-description recall still ranks the PR-body rule first and does not get recency-promoted release checkpoints.
5. Docs context-budget release recall still retrieves the correct release checkpoint and does not demote it unexpectedly.
6. Query detection helper matches only the intended currentness-like examples.
7. CreatedAt-ascending folded-store order remains the final tie-break when lexical scores, currentness eligibility, and `updatedAt` are all tied.

## Validation

Run at minimum:

```bash
pnpm --filter @memory-lane/core test
pnpm test
git diff --check
```

## Risks and mitigations

- **Overfitting to one fixture:** Start equality-only and stop if that is insufficient.
- **Recency becomes false authority:** Keep lexical score primary and only tie-break checkpoint-like records.
- **Recall duplicates continuity:** Keep the query family narrow and preserve continuity-first guidance for broad status prompts.
- **Topic recall regression:** Add explicit PR-description and docs context-budget regression tests.
- **Semantic path divergence:** Do not change semantic retrieval in this slice; revisit only with separate eval evidence.

## Approval question

Should the first implementation slice attempt the equality-only lexical fallback currentness tie-break, or should we add more eval-only characterization before changing production recall behavior?
