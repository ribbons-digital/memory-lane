# Conflict Update Eval Baseline

## Status

Implemented on branch `conflict-update-evals`.

This slice adds a deterministic conflict/update microbench for recall behavior.
It adds one narrow source fix: `retrieveSemanticMemories` excludes memories marked with `revision.supersededBy` from recall context.
This keeps historical superseded records reviewable elsewhere while preventing them from being recalled as active context.

## Scope

The slice adds `pnpm --filter @memory-lane/core eval:conflict-update`.
The report uses local prompt fixtures only.
The fixtures cover current-vs-superseded fact ranking and false-premise correction prompts.
The harness grades raw `retrieveSemanticMemories(...).memories.slice(0, k)` results, without lexical-overlap post-filtering.

## Satisfactory thresholds

The report is satisfactory only when every scenario passes.
Current fact first rate must be `1`.
False-premise safety rate must be `1`.
Zero-tolerance failures must be `0`.
Empty scenario reports fail instead of returning a false green result.

## Report

Command:

```bash
pnpm --filter @memory-lane/core eval:conflict-update
```

Current summary:

```json
{
  "scenarioCount": 2,
  "passCount": 2,
  "failCount": 0,
  "zeroToleranceFailures": 0,
  "currentFactFirstRate": 1,
  "falsePremiseSafetyRate": 1,
  "failureTagCounts": {}
}
```

## Verification commands

```bash
node --test --import tsx test/conflict-update-eval.test.ts
pnpm --filter @memory-lane/core eval:conflict-update
node --test --import tsx test/retrieval-continuity-eval.test.ts
pnpm --filter @memory-lane/core build
pnpm --filter @memory-lane/core test
```

## Follow-up candidates

1. Add more conflict scenarios for same-id updates and explicit correction records.
2. Add continuity-read-model conflict cases if future work changes selected slots.
3. Add LongMemEval adapter only after deterministic conflict/update coverage remains stable.
