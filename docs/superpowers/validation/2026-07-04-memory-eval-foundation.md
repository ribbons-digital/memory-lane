# Memory Eval Foundation Baseline

## Status

Implemented in isolated worktree `/Users/shiang/.config/superpowers/worktrees/memory-lane/eval-benchmarks` on branch `eval-benchmarks`.

This slice improves the evaluation and benchmark harness only.
It does not change production retrieval, continuity, storage, lifecycle, CLI, MCP, or adapter behavior.

## Scope

The slice extracts the existing retrieval and continuity eval machinery into `packages/core/test/retrieval-eval-harness.ts`.
It keeps the original sanitized six-scenario corpus and adds reusable metric/report helpers.
It adds `NDCG@k` so rank-order improvements are visible even when `recall@k` and `precision@k` stay unchanged.
It adds a local report runner exposed through `pnpm --filter @memory-lane/core eval:retrieval`.
It adds focused governance characterization for non-approved memories, cross-project memories, global preferences, and superseded progress.

## Why this fits Memory Lane

Memory Lane is not evaluated as a generic RAG system in this slice.
The harness evaluates Memory Lane-native behavior: approved-memory visibility, project/global scope, continuity slots, stale-vs-current ordering, superseded progress filtering, and ranked recall quality.
The metrics borrowed from information retrieval are used only because Memory Lane has ranked recall and ranked workstream candidate surfaces.

## Current baseline report

Command:

```bash
pnpm --filter @memory-lane/core eval:retrieval
```

Observed summary:

```json
{
  "queryCount": 6,
  "meanRecallAtK": 1,
  "meanPrecisionAtK": 0.49999999999999994,
  "meanNdcgAtK": 0.8519590445170673,
  "failureTagCounts": {
    "forbidden-returned": 2,
    "topic-mismatch": 2
  }
}
```

Interpretation:

- Required memories are found for all ranked scenarios, so `meanRecallAtK` is `1`.
- Precision remains intentionally imperfect because the corpus still exposes distractor behavior in workstream discovery and current release-status recall.
- `stale-over-current` is absent after the prior currentness tie-break work.
- `forbidden-returned` remains where stale or topic-mismatched records are still present in top-k, which is useful benchmark signal rather than a production behavior change in this slice.
- `meanNdcgAtK` now captures rank quality and can improve or regress independently of recall.

## Added characterization

The new tests prove:

- automatic recall excludes `pending`, `rejected`, and `deleted` memories;
- automatic recall excludes same-text memories from a different project scope;
- automatic recall can still include a relevant global preference;
- continuity excludes superseded progress from `latestProgress`;
- ranked reports include `NDCG@k`;
- the report runner emits deterministic JSON for benchmark comparison.

## Verification

Commands run in the worktree:

```bash
pnpm install
pnpm build
pnpm test
node --test --import tsx test/retrieval-continuity-eval.test.ts
pnpm eval:retrieval
```

Results:

- `pnpm build` passed.
- Baseline `pnpm test` passed before changes.
- Targeted core eval test passed with 10 tests.
- `pnpm eval:retrieval` emitted the deterministic JSON report above.

## Follow-up candidates

Next useful eval-only slices:

1. Add lifecycle injection evals for `SessionStart`, `UserPromptSubmit`, selective mode, policy-only mode, and context budget behavior.
2. Add prompt routing evals proving broad continuity prompts route to continuity and targeted prompts stay bounded.
3. Add a small Memory Lane-native conflict/update microbench for supersession, current-vs-historical facts, and false-premise abstention.
4. Add a LongMemEval sample adapter after the local deterministic harness is stable.
