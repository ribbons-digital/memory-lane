# Prompt Routing Eval Baseline

## Status

Implemented on branch `prompt-routing-evals`.

This slice adds a deterministic prompt routing eval harness and report runner.
It does not change production routing behavior.
It measures whether prompt classification sends user prompts to continuity, memory-management, low-signal, or ordinary routes before lifecycle memory rendering.

## Scope

The slice adds `pnpm --filter @memory-lane/lifecycle eval:prompt-routing`.
The report uses local prompt fixtures only.
The fixtures cover resume continuity, lookup continuity, project-position continuity, next-work continuity, memory-management list/review requests, low-signal prompts, and ordinary task prompts.

## Satisfactory thresholds

The report is satisfactory only when every scenario passes.
Route accuracy must be `1`.
Intent family accuracy must be `1` for scenarios that expect a continuity family.
Required reason recall must be `1`.
Zero-tolerance failures must be `0`.

## Report

Command:

```bash
pnpm --filter @memory-lane/lifecycle eval:prompt-routing
```

Current summary:

```json
{
  "scenarioCount": 11,
  "passCount": 11,
  "failCount": 0,
  "zeroToleranceFailures": 0,
  "routeAccuracy": 1,
  "intentFamilyAccuracy": 1,
  "meanRequiredReasonRecall": 1,
  "failureTagCounts": {}
}
```

## Verification commands

```bash
node --test --import tsx test/prompt-routing-eval.test.ts
pnpm --filter @memory-lane/lifecycle eval:prompt-routing
pnpm --filter @memory-lane/lifecycle build
```

## Follow-up candidates

1. Add a conflict/update microbench for current-vs-historical facts and false-premise abstention.
2. Add a small LongMemEval adapter after deterministic lifecycle, retrieval, and routing reports are stable.
3. Consider routing report trend storage only after multiple eval reports need comparison across releases.
