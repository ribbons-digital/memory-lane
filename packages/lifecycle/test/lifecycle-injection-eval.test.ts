import test from "node:test"
import assert from "node:assert/strict"
import {
  CORPUS_ID,
  GENERATED_AT,
  ZERO_TOLERANCE_FAILURE_TAGS,
  buildInjectionEvalReport,
  corpus,
  evaluateScenario,
  reportIsSatisfactory,
  summarizeResults,
  type InjectionScenarioResult,
} from "./lifecycle-injection-eval-harness.ts"

function injectionResult(overrides: Partial<InjectionScenarioResult> & { id: string }): InjectionScenarioResult {
  const result: InjectionScenarioResult = {
    id: overrides.id,
    event: "prompt",
    policyMode: "selective",
    passed: true,
    actualMemoryIds: [],
    requiredMemoryIds: [],
    acceptableMemoryIds: [],
    forbiddenMemoryIds: [],
    missingRequired: [],
    forbiddenInjected: [],
    requiredTextMissing: [],
    forbiddenTextPresent: [],
    requiredTextTotal: 0,
    forbiddenTextTotal: 0,
    contextChars: 10,
    maxContextChars: 100,
    failureTags: [],
    ...overrides,
  }
  return result
}

test("lifecycle injection eval corpus is structurally valid", () => {
  assert.ok(corpus.length >= 6)
  for (const scenario of corpus) {
    assert.ok(scenario.id)
    assert.ok(scenario.records.length > 0)
    assert.ok(scenario.policy.mode)
    if (scenario.event === "prompt") assert.ok(scenario.prompt)
    assert.equal(new Set(scenario.records.map((record) => record.id)).size, scenario.records.length)
  }
})

test("lifecycle injection eval report reaches satisfactory thresholds", async () => {
  const report = await buildInjectionEvalReport()
  assert.equal(report.generatedAt, GENERATED_AT)
  assert.equal(report.corpusId, CORPUS_ID)
  assert.equal(report.mode, "local-fixtures")
  assert.equal(report.summary.scenarioCount, corpus.length)
  assert.equal(report.summary.failCount, 0)
  assert.equal(report.summary.zeroToleranceFailures, 0)
  assert.equal(report.summary.meanRequiredRecall, 1)
  assert.equal(report.summary.meanForbiddenLeakRate, 0)
  assert.equal(report.summary.maxContextBudgetOverrun, 0)
  assert.deepEqual(report.summary.failureTagCounts, {})
  assert.equal(reportIsSatisfactory(report), true)
})

test("lifecycle injection eval detects unsatisfactory forbidden injection", () => {
  const result = injectionResult({
    id: "bad-forbidden",
    passed: false,
    actualMemoryIds: ["cross-project-memory"],
    forbiddenMemoryIds: ["cross-project-memory"],
    forbiddenInjected: ["cross-project-memory"],
    failureTags: ["forbidden-injected", "cross-project-leak"],
  })
  const summary = summarizeResults([result])
  assert.equal(summary.failCount, 1)
  assert.equal(summary.zeroToleranceFailures, 2)
  assert.equal(summary.meanForbiddenLeakRate, 1)
  assert.equal(ZERO_TOLERANCE_FAILURE_TAGS.has("cross-project-leak"), true)
})

test("lifecycle injection eval summary uses full text check totals", () => {
  const summary = summarizeResults([injectionResult({
    id: "partial-text-checks",
    passed: false,
    actualMemoryIds: ["required-memory", "forbidden-memory"],
    requiredMemoryIds: ["required-memory"],
    forbiddenMemoryIds: ["forbidden-memory"],
    forbiddenInjected: ["forbidden-memory"],
    requiredTextMissing: ["missing text"],
    forbiddenTextPresent: ["leaked text"],
    requiredTextTotal: 2,
    forbiddenTextTotal: 3,
    failureTags: ["missing-required", "forbidden-injected"],
  })])

  assert.equal(summary.meanRequiredRecall, 2 / 3)
  assert.equal(summary.meanForbiddenLeakRate, 2 / 4)
})

test("individual lifecycle injection scenarios expose selected context decisions", async () => {
  const sessionStart = await evaluateScenario(corpus.find((scenario) => scenario.id === "session-start-selective-governance")!)
  assert.equal(sessionStart.contextDecision?.event, "sessionStart")
  assert.equal(sessionStart.contextDecision?.mode, "selective")
  assert.equal(sessionStart.passed, true)

  const prompt = await evaluateScenario(corpus.find((scenario) => scenario.id === "prompt-broad-next-work-continuity-only")!)
  assert.equal(prompt.contextDecision?.continuityIntent?.family, "next-work")
  assert.equal(prompt.contextDecision?.omittedReasons.includes("broad-continuity-no-recall"), true)
  assert.equal(prompt.actualMemoryIds.length, 0)
})
