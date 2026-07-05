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
import type { PromptRoutingEvalScenario, PromptRoutingScenarioResult } from "./prompt-routing-eval-harness.ts"
import { assertBenchmarkMetadata, assertBenchmarkParity } from "../../core/test/eval-report-helpers.js"

type ScenarioRoute = PromptRoutingEvalScenario["expectedRoute"]
type ScenarioIntentFamily = NonNullable<PromptRoutingEvalScenario["expectedIntentFamily"]>

interface AdversarialGroup {
  name: string
  ids: string[]
  expectedRoute: ScenarioRoute
  expectedIntentFamily?: ScenarioIntentFamily
}

const adversarialGroups: AdversarialGroup[] = [
  {
    name: "broad project-position prompts stay on continuity routing",
    ids: [
      "continuity-project-position",
      "continuity-project-position-leave-off",
      "continuity-project-position-progress",
      "continuity-current-status",
    ],
    expectedRoute: "continuity",
    expectedIntentFamily: "project-position",
  },
  {
    name: "broad next-work prompts stay on continuity routing",
    ids: [
      "continuity-next-work",
      "continuity-next-scope",
      "continuity-next-slice",
    ],
    expectedRoute: "continuity",
    expectedIntentFamily: "next-work",
  },
  {
    name: "explicit recall lookup prompts keep lookup intent",
    ids: [
      "continuity-lookup",
      "continuity-lookup-thread",
      "continuity-lookup-previous-decision",
    ],
    expectedRoute: "continuity",
    expectedIntentFamily: "lookup",
  },
  {
    name: "low-signal prompts stay suppressed",
    ids: [
      "low-signal-thanks",
      "low-signal-greeting",
      "low-signal-greeting-expanded",
      "low-signal-ack",
    ],
    expectedRoute: "low-signal",
  },
  {
    name: "technical prompts stay ordinary",
    ids: [
      "ordinary-technical-question",
      "ordinary-technical-nextjs",
      "ordinary-technical-current-time",
    ],
    expectedRoute: "ordinary",
  },
  {
    name: "false-friend reminder and recall prompts stay ordinary",
    ids: [
      "ordinary-false-friend-reminder",
      "ordinary-false-friend-remind-me",
      "ordinary-false-friend-recall-memory",
    ],
    expectedRoute: "ordinary",
  },
]

function scenarioById(id: string): PromptRoutingEvalScenario {
  const scenario = corpus.find((candidate) => candidate.id === id)
  assert.ok(scenario, `expected corpus scenario ${id}`)
  return scenario
}

function assertScenarioResult(group: AdversarialGroup, result: PromptRoutingScenarioResult): void {
  assert.equal(result.actualRoute, group.expectedRoute, `${result.id} routed to ${result.actualRoute}`)
  assert.equal(result.expectedRoute, group.expectedRoute, `${result.id} corpus route changed`)
  assert.equal(result.actualIntentFamily, group.expectedIntentFamily, `${result.id} intent family`)
  assert.equal(result.expectedIntentFamily, group.expectedIntentFamily, `${result.id} corpus intent family changed`)
  assert.deepEqual(result.failureTags, [], `${result.id} failure tags`)
  assert.equal(result.passed, true, `${result.id} passed`)
}

test("prompt routing eval corpus is structurally valid", () => {
  assert.ok(corpus.length >= 25)
  assert.equal(new Set(corpus.map((scenario) => scenario.id)).size, corpus.length)
  for (const scenario of corpus) {
    assert.ok(scenario.id)
    assert.ok(scenario.prompt)
    assert.ok(scenario.expectedRoute)
    assertBenchmarkMetadata(scenario.benchmark, "prompt-routing", scenario.id)
    assert.equal(scenario.benchmark.ability, "prompt-routing")
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
  assertBenchmarkParity(report.scenarioResults, corpus)
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
      routeAccuracy: (report.summary.scenarioCount - 1) / report.summary.scenarioCount,
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

test("adversarial prompt routing groups are present and route correctly", () => {
  for (const group of adversarialGroups) {
    assert.ok(group.ids.length > 0, `${group.name} has scenarios`)
    for (const id of group.ids) {
      const scenario = scenarioById(id)
      assertScenarioResult(group, evaluateScenario(scenario))
    }
  }
})
