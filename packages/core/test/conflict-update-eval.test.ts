import test from "node:test"
import assert from "node:assert/strict"
import {
  CORPUS_ID,
  GENERATED_AT,
  MODE,
  assertCorpusStructurallyValid,
  buildConflictUpdateEvalReport,
  corpus,
  evaluateScenario,
  reportIsSatisfactory,
  summarizeResults,
} from "./conflict-update-eval-harness.js"

test("conflict/update eval corpus is structurally valid and sanitized", () => {
  assertCorpusStructurallyValid()
})

test("conflict/update eval report has deterministic satisfactory summary shape", async () => {
  const report = await buildConflictUpdateEvalReport()

  assert.equal(report.generatedAt, GENERATED_AT)
  assert.equal(report.corpusId, CORPUS_ID)
  assert.equal(report.mode, MODE)
  assert.equal(report.scenarioResults.length, corpus.scenarios.length)
  assert.equal(report.summary.scenarioCount, corpus.scenarios.length)
  assert.equal(report.summary.passCount, corpus.scenarios.length)
  assert.equal(report.summary.failCount, 0)
  assert.equal(report.summary.zeroToleranceFailures, 0)
  assert.deepEqual(report.summary.failureTagCounts, {})
  assert.equal(report.summary.satisfactory, true)
  assert.equal(report.summary.satisfactory, reportIsSatisfactory(report))
  assert.equal(report.summary.currentFactFirstRate, 1)
  assert.equal(report.summary.falsePremiseSafetyRate, 1)
  assert.equal(report.summary.staleFactLeakRate, 0)
  assert.equal(report.summary.supersededMemoryLeakRate, 0)
  for (const result of report.scenarioResults) {
    const scenario = corpus.scenarios.find((item) => item.id === result.id)
    assert.ok(scenario)
    assert.deepEqual(result.benchmark, scenario.benchmark)
  }
})

test("conflict/update eval rejects no-data and failing summaries", async () => {
  await assert.rejects(() => buildConflictUpdateEvalReport([]), /requires at least one scenario/u)

  const emptySummary = summarizeResults([])
  assert.equal(emptySummary.satisfactory, false)
  assert.equal(reportIsSatisfactory({
    generatedAt: GENERATED_AT,
    corpusId: CORPUS_ID,
    mode: MODE,
    scenarioResults: [],
    summary: emptySummary,
  }), false)

  const failingReport = {
    generatedAt: GENERATED_AT,
    corpusId: CORPUS_ID,
    mode: MODE,
    scenarioResults: [],
    summary: {
      scenarioCount: 1,
      passCount: 0,
      failCount: 1,
      zeroToleranceFailures: 1,
      currentFactFirstRate: 0,
      falsePremiseSafetyRate: 0,
      staleFactLeakRate: 1,
      supersededMemoryLeakRate: 1,
      failureTagCounts: { "current-fact-not-first": 1 },
      satisfactory: false,
    },
  }
  assert.equal(failingReport.summary.satisfactory, false)
  assert.equal(reportIsSatisfactory(failingReport), false)

  const staleSatisfactoryReport = {
    generatedAt: GENERATED_AT,
    corpusId: CORPUS_ID,
    mode: MODE,
    scenarioResults: [],
    summary: {
      scenarioCount: 2,
      passCount: 1,
      failCount: 1,
      zeroToleranceFailures: 1,
      currentFactFirstRate: 1,
      falsePremiseSafetyRate: 1,
      staleFactLeakRate: 0,
      supersededMemoryLeakRate: 0,
      failureTagCounts: { "stale-over-current": 1 },
      satisfactory: true,
    },
  }
  assert.equal(staleSatisfactoryReport.summary.satisfactory, true)
  assert.equal(reportIsSatisfactory(staleSatisfactoryReport), false)
})

const expandedScenarioContracts = [
  {
    id: "same-id-project-status-update",
    expectedFirstId: "same-id-editor-default",
    expectedFirstTextIncludes: "VS Code Insiders",
  },
  {
    id: "explicit-correction-database-choice",
    expectedFirstId: "database-choice-current-sqlite",
    expectedFirstTextIncludes: null,
  },
  {
    id: "supersession-chain-auth-provider",
    expectedFirstId: "auth-provider-current-access",
    expectedFirstTextIncludes: null,
  },
  {
    id: "cross-scope-false-premise-token-storage",
    expectedFirstId: "token-storage-current-cookie",
    expectedFirstTextIncludes: null,
  },
] as const

for (const { id, expectedFirstId, expectedFirstTextIncludes } of expandedScenarioContracts) {
  test(`conflict/update eval scenario ${id} returns the corrective fact without forbidden leaks`, async () => {
    const scenario = corpus.scenarios.find((item) => item.id === id)
    assert.ok(scenario)
    const result = await evaluateScenario(scenario)

    assert.equal(result.actualIds[0], expectedFirstId)
    if (expectedFirstTextIncludes !== null) {
      assert.ok(result.actualFirstText)
      assert.equal(result.actualFirstText.includes(expectedFirstTextIncludes), true)
    }
    assert.deepEqual(result.returnedForbiddenIds, [])
    assert.deepEqual(result.failureTags, [])
  })
}

test("current fact beats stale superseded fact with equal lexical overlap", async () => {
  const scenario = corpus.scenarios.find((item) => item.id === "current-deployment-status")
  assert.ok(scenario)
  const result = await evaluateScenario(scenario)

  assert.equal(result.actualIds[0], "deploy-current-workers")
  assert.deepEqual(result.returnedForbiddenIds, [])
  assert.deepEqual(result.failureTags, [])
})

test("false-premise update prompt returns the corrective current fact instead of superseded premise support", async () => {
  const scenario = corpus.scenarios.find((item) => item.id === "false-premise-package-manager-switch")
  assert.ok(scenario)
  const result = await evaluateScenario(scenario)

  assert.equal(result.actualIds[0], "package-manager-current-pnpm")
  assert.deepEqual(result.returnedForbiddenIds, [])
  assert.deepEqual(result.failureTags, [])
})

test("adversarial near-miss false-premise scenario returns corrective current fact without stale leaks", async () => {
  const scenario = corpus.scenarios.find((item) => item.id === "false-premise-deploy-region-near-miss")
  assert.ok(scenario)
  assert.equal(scenario.expectedFirstId, "deploy-region-current-us")
  assert.deepEqual(scenario.forbiddenIds, ["deploy-region-stale-eu"])

  const result = await evaluateScenario(scenario)

  assert.equal(result.actualIds[0], "deploy-region-current-us")
  assert.equal(result.actualIds.includes("deploy-region-stale-eu"), false)
  assert.deepEqual(result.returnedForbiddenIds, [])
  assert.deepEqual(result.failureTags, [])
})
