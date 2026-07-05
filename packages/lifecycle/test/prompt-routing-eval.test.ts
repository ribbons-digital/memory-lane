import test from "node:test"
import assert from "node:assert/strict"
import {
  CORPUS_ID,
  GENERATED_AT,
  buildPromptRoutingEvalReport,
  corpus,
  evaluateScenario,
  reportIsSatisfactory,
  summarizeResults,
} from "./prompt-routing-eval-harness.ts"

test("prompt routing eval corpus is structurally valid", () => {
  assert.ok(corpus.length >= 10)
  for (const scenario of corpus) {
    assert.ok(scenario.id)
    assert.ok(scenario.prompt)
    assert.ok(scenario.expectedRoute)
  }
})

test("prompt routing eval report reaches satisfactory thresholds", () => {
  const report = buildPromptRoutingEvalReport()
  assert.equal(report.generatedAt, GENERATED_AT)
  assert.equal(report.corpusId, CORPUS_ID)
  assert.equal(report.mode, "local-fixtures")
  assert.equal(report.summary.scenarioCount, corpus.length)
  assert.equal(report.summary.passCount, corpus.length)
  assert.equal(report.summary.failCount, 0)
  assert.equal(report.summary.zeroToleranceFailures, 0)
  assert.deepEqual(report.summary.failureTagCounts, {})
  assert.equal(report.summary.satisfactory, true)
  assert.equal(report.summary.satisfactory, reportIsSatisfactory(report))
  assert.equal(report.summary.routeAccuracy, 1)
  assert.equal(report.summary.intentFamilyAccuracy, 1)
  assert.equal(report.summary.meanRequiredReasonRecall, 1)
})

test("prompt routing eval report rejects no-data and failing summaries", () => {
  assert.throws(() => buildPromptRoutingEvalReport([]), /requires at least one scenario/)

  const emptySummary = summarizeResults([])
  assert.equal(emptySummary.satisfactory, false)
  assert.equal(reportIsSatisfactory({
    generatedAt: GENERATED_AT,
    corpusId: CORPUS_ID,
    mode: "local-fixtures",
    scenarioResults: [],
    summary: emptySummary,
  }), false)

  const report = buildPromptRoutingEvalReport()
  const failingReport = {
    ...report,
    summary: {
      ...report.summary,
      failCount: 1,
      zeroToleranceFailures: 1,
      routeAccuracy: 10 / 11,
      satisfactory: false,
    },
  }
  assert.equal(failingReport.summary.satisfactory, false)
  assert.equal(reportIsSatisfactory(failingReport), false)
})

test("prompt routing eval detects wrong route and missing reason failures", () => {
  const summary = summarizeResults([{
    id: "bad-route",
    prompt: "what should we work on next?",
    passed: false,
    expectedRoute: "continuity",
    actualRoute: "ordinary",
    expectedIntentFamily: "next-work",
    actualIntentFamily: undefined,
    requiredReasons: ["next-work"],
    missingReasons: ["next-work"],
    unexpectedReasons: [],
    failureTags: ["wrong-route", "wrong-intent-family", "missing-reason"],
  }])

  assert.equal(summary.scenarioCount, 1)
  assert.equal(summary.passCount, 0)
  assert.equal(summary.failCount, 1)
  assert.equal(summary.zeroToleranceFailures, 2)
  assert.equal(summary.routeAccuracy, 0)
  assert.equal(summary.intentFamilyAccuracy, 0)
  assert.equal(summary.meanRequiredReasonRecall, 0)
  assert.deepEqual(summary.failureTagCounts, {
    "wrong-route": 1,
    "wrong-intent-family": 1,
    "missing-reason": 1,
  })
  assert.equal(summary.satisfactory, false)
})

test("individual prompt routing scenarios expose route decisions", () => {
  const nextWork = evaluateScenario(corpus.find((scenario) => scenario.id === "continuity-next-work")!)
  assert.equal(nextWork.actualRoute, "continuity")
  assert.equal(nextWork.actualIntentFamily, "next-work")

  const lowSignal = evaluateScenario(corpus.find((scenario) => scenario.id === "low-signal-thanks")!)
  assert.equal(lowSignal.actualRoute, "low-signal")

  const memoryList = evaluateScenario(corpus.find((scenario) => scenario.id === "memory-management-list")!)
  assert.equal(memoryList.actualRoute, "memory-management")
})
