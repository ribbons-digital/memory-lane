import test from "node:test"
import assert from "node:assert/strict"
import {
  countFailureTags,
  isEvalResultPassed,
  isGateSatisfactory,
  ratio,
  summarizeEvalGate,
  type EvalResultWithFailureTags,
} from "./eval-report-helpers.js"

test("ratio returns a finite fraction and NaN for empty denominators", () => {
  assert.equal(ratio(3, 4), 0.75)
  assert.equal(Number.isNaN(ratio(1, 0)), true)
})

test("countFailureTags aggregates repeated tags and keeps empty results empty", () => {
  assert.deepEqual(countFailureTags([]), {})
  assert.deepEqual(countFailureTags([
    { failureTags: ["retrieval-miss", "stale-leak"] },
    { passed: true, failureTags: ["stale-leak"] },
    { failureTags: [] },
  ]), {
    "retrieval-miss": 1,
    "stale-leak": 2,
  })
})

test("isEvalResultPassed gives explicit passed values precedence over failure tags", () => {
  assert.equal(isEvalResultPassed({ passed: true, failureTags: ["stale-leak"] }), true)
  assert.equal(isEvalResultPassed({ passed: false, failureTags: [] }), false)
  assert.equal(isEvalResultPassed({ failureTags: [] }), true)
  assert.equal(isEvalResultPassed({ failureTags: ["retrieval-miss"] }), false)
})

test("isGateSatisfactory accepts only internally consistent clean summaries", () => {
  const cases = [
    {
      name: "clean summary",
      summary: {
        scenarioCount: 1,
        passCount: 1,
        failCount: 0,
        zeroToleranceFailures: 0,
        satisfactory: true,
      },
      expected: true,
    },
    {
      name: "stale true with failCount non-zero",
      summary: {
        scenarioCount: 1,
        passCount: 0,
        failCount: 1,
        zeroToleranceFailures: 0,
        satisfactory: true,
      },
      expected: false,
    },
    {
      name: "count mismatch",
      summary: {
        scenarioCount: 2,
        passCount: 1,
        failCount: 0,
        zeroToleranceFailures: 0,
        satisfactory: true,
      },
      expected: false,
    },
    {
      name: "stale false with clean counters",
      summary: {
        scenarioCount: 1,
        passCount: 1,
        failCount: 0,
        zeroToleranceFailures: 0,
        satisfactory: false,
      },
      expected: false,
    },
  ]

  for (const { name, summary, expected } of cases) {
    assert.equal(isGateSatisfactory(summary), expected, name)
  }
})

test("summarizeEvalGate reports an unsatisfactory empty gate", () => {
  assert.deepEqual(summarizeEvalGate([], new Set()), {
    scenarioCount: 0,
    passCount: 0,
    failCount: 0,
    zeroToleranceFailures: 0,
    failureTagCounts: {},
    satisfactory: false,
  })
})

test("summarizeEvalGate counts explicit passes separately from zero-tolerance failures", () => {
  type FailureTag = "zero-tolerance" | "warning"
  const results: EvalResultWithFailureTags<FailureTag>[] = [
    { passed: true, failureTags: ["zero-tolerance", "warning"] },
    { failureTags: [] },
  ]

  assert.deepEqual(summarizeEvalGate(results, new Set<FailureTag>(["zero-tolerance"])), {
    scenarioCount: 2,
    passCount: 2,
    failCount: 0,
    zeroToleranceFailures: 1,
    failureTagCounts: {
      "zero-tolerance": 1,
      warning: 1,
    },
    satisfactory: false,
  })
})

test("summarizeEvalGate accepts sparse zero-tolerance records", () => {
  type FailureTag = "zero-tolerance" | "warning"
  const results: EvalResultWithFailureTags<FailureTag>[] = [
    { failureTags: ["zero-tolerance"] },
    { passed: true, failureTags: ["warning"] },
  ]
  const zeroToleranceTags: Partial<Record<FailureTag, true>> = { "zero-tolerance": true }

  assert.deepEqual(summarizeEvalGate(results, zeroToleranceTags), {
    scenarioCount: 2,
    passCount: 1,
    failCount: 1,
    zeroToleranceFailures: 1,
    failureTagCounts: {
      "zero-tolerance": 1,
      warning: 1,
    },
    satisfactory: false,
  })
})

test("summarizeEvalGate marks a non-empty clean gate satisfactory", () => {
  assert.deepEqual(summarizeEvalGate([
    { failureTags: [] },
    { passed: true, failureTags: [] },
  ], {}), {
    scenarioCount: 2,
    passCount: 2,
    failCount: 0,
    zeroToleranceFailures: 0,
    failureTagCounts: {},
    satisfactory: true,
  })
})
