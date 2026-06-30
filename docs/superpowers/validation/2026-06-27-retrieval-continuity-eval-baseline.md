# Retrieval and Continuity Eval Baseline

## Status

Baseline captured for the approved retrieval/continuity eval slice.

Follow-up: the narrow currentness tie-break slice is tracked in `docs/superpowers/specs/2026-06-30-retrieval-currentness-eval-scope-design.md` and validated in `docs/superpowers/validation/2026-06-30-retrieval-currentness-tie-break-validation.md`.

Implementation file: `packages/core/test/retrieval-continuity-eval.test.ts`

Design reference: `docs/superpowers/specs/2026-06-27-retrieval-continuity-eval-baseline-design.md`

## Scope

This baseline is intentionally internal/test-only and report-oriented. It adds a sanitized, real-shaped corpus and structural evaluation helpers for two lanes:

- **continuity lane**: slot correctness for `latestProgress`, `operatingGuidance`, and `workstreamDiscovery.candidates`;
- **recall lane**: default no-embedding `MemoryEngine.recall()` behavior, evaluated with helper-owned top-k slicing and lexical-score zero-padding excluded from precision denominators.

No retrieval/ranking behavior, public CLI/MCP/API surface, lifecycle injection budget, schema, or memory mutation behavior changed.

## Corpus

Corpus id: `retrieval-continuity-baseline-v1`

Synthetic project scope: `eval/project`

Fixture records: 7 sanitized approved project memories modeled after dogfood classes:

- `eval-stale-v037` — older release/status checkpoint.
- `eval-release-v038` — current `v0.2.38` docs/context-budget release checkpoint.
- `eval-docs-sync-v038` — post-release docs-sync checkpoint.
- `eval-pr-body-rule` — GitHub PR body-file workflow correction.
- `eval-pr-process-agreement` — PR-protected workflow agreement.
- `eval-old-hygiene-slice` — unrelated older completed slice.
- `eval-current-track` — current retrieval/continuity eval baseline design approval and next implementation slice.

Queries: 6 total.

Continuity lane:

1. `where are we in the project?`
2. `what should we work on next?`
3. `where did we fix PR body formatting?`

Recall lane:

4. `how should I create GitHub PR descriptions?`
5. `what release shipped docs context-budget?`
6. `what is the current Memory Lane release status?`

## Baseline results

Ranked metrics apply only to explicit recall queries and the ranked continuity workstream candidate query. Set-shaped continuity slots are evaluated with membership checks only.

Aggregate ranked metrics:

- Ranked query count: 4
- Mean recall@k: 1.00
- Mean precision@k: 0.54

Per-query summary:

| Query id | Lane | Target | Baseline result |
|---|---|---|---|
| `continuity-broad-status` | continuity | `latestProgress` | Required `eval-current-track` selected; forbidden stale/correction records absent from `latestProgress`. |
| `continuity-next-work` | continuity | `latestProgress` + `operatingGuidance` | Required `eval-current-track` selected; PR workflow guidance remains in operating guidance. |
| `continuity-pr-body-workstream` | continuity | `workstreamDiscovery.candidates` | Required `eval-pr-body-rule` appears first in ranked workstream candidates; `eval-release-v038` also appears via PR-reference matching, so recall@3 is 1.00 and precision@3 is 0.50 with `forbidden-returned`. |
| `recall-pr-description-rule` | recall | explicit recall top-k | Required `eval-pr-body-rule` retrieved and acceptable PR-process agreement is also relevant; `eval-release-v038` enters as a third scored distractor through its `PR #69` token, so recall@3 is 1.00 and precision@3 is 0.67. |
| `recall-docs-context-budget-release` | recall | explicit recall top-k | Required `eval-release-v038` retrieved with acceptable docs-sync context; one older release/status distractor remains in scored top-k; recall@3 1.00, precision@3 0.67. |
| `recall-current-release-status` | recall | explicit recall top-k | Required `eval-release-v038` retrieved, but older `eval-stale-v037` ranks at or above it under lexical-only fallback; recall@3 1.00, precision@3 0.33. |

Observed failure tags:

- `forbidden-returned`: 2
- `stale-over-current`: 1
- `topic-mismatch`: 1

The `stale-over-current` and `topic-mismatch` tags came from the explicit recall stale-vs-current release-status query in the baseline. One `forbidden-returned` tag also came from the topic-specific continuity workstream query because `eval-release-v038` has a PR reference and therefore appears as a lower-ranked candidate even though it is not the intended PR-body-formatting memory.

The currentness follow-up intentionally removes the `stale-over-current` ordering failure for exact lexical-score ties, while leaving top-k filtering and broader precision findings unchanged.

The release-status recall failure is expected baseline behavior for the current no-embedding recall path: fallback ranking is lexical-only and does not apply recency or checkpoint-currentness logic. The PR-description and workstream precision findings are also useful baseline evidence: reference-bearing status checkpoints can appear in topic-specific recall/workstream results through generic `PR` token/reference overlap even when the topical correction is correctly ranked first.

## Interpretation

Continuity slotting currently behaves well on this small corpus:

- broad project-status and next-work prompts select the current progress checkpoint in `latestProgress`;
- workflow corrections/agreements remain operating guidance rather than latest progress;
- topic-specific workstream discovery can surface a correction/procedure when the query asks for that topic, though reference-bearing status checkpoints may still appear as lower-ranked candidates.

Explicit recall retrieves required records in all three recall scenarios, but currentness remains ambiguous when multiple release-status records have similar lexical overlap. The `current release status` query demonstrates the main baseline weakness: default no-embedding recall has no recency-aware or continuity-role-aware tie-break for stale-vs-current project checkpoints.

This baseline does **not** by itself justify a retrieval rewrite. It provides evidence for a narrower follow-up question: whether explicit recall should gain a bounded, deterministic currentness/recency treatment for checkpoint-like project records, or whether agents should continue routing broad/current-status questions to continuity first and use recall only for topic-specific follow-up.

## Verification

Commands run:

```bash
node --test --import tsx packages/core/test/retrieval-continuity-eval.test.ts
pnpm --filter @memory-lane/core test -- retrieval-continuity-eval.test.ts
```

Both passed. The second command currently runs the full core test script because the package script does not narrow to the filename; it passed with 304 tests.
