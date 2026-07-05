import test from "node:test"
import assert from "node:assert/strict"
import {
  CORPUS_ID,
  GENERATED_AT,
  ZERO_TOLERANCE_FAILURE_TAGS,
  assertCorpusStructurallyValid,
  buildLongSessionEvalReport,
  corpus,
  evaluateScenario,
  memory,
  reportIsSatisfactory,
  summarizeResults,
  type LongSessionFailureTag,
  type LongSessionScenario,
  type LongSessionScenarioResult,
  type LongSessionStepResult,
} from "./long-session-synthetic-eval-harness.ts"
import { assertBenchmarkMetadata, assertBenchmarkParity } from "../../core/test/eval-report-helpers.js"

const expectedScenarioCoverage = [
  {
    id: "temporal-currentness-supersedes-stale-decision",
    ability: "temporal-currentness",
    steps: ["prompt-current-runner-decision"],
  },
  {
    id: "knowledge-update-repeated-session-corrections",
    ability: "knowledge-update",
    steps: ["prompt-current-verification-procedure"],
  },
  {
    id: "multi-session-summary-continuity",
    ability: "continuity-status",
    steps: ["continuity-current-progress", "prompt-next-work-guidance-only"],
  },
  {
    id: "false-premise-abstention-no-answer",
    ability: "false-premise-abstention",
    steps: ["prompt-false-premise-longmemeval-status"],
  },
  {
    id: "project-global-preference-conflict-safety",
    ability: "cross-scope-safety",
    steps: ["prompt-ci-preference-conflict"],
  },
  {
    id: "bounded-long-context-budget-pressure",
    ability: "lifecycle-injection",
    steps: ["prompt-budget-pressure-current-plan"],
  },
]

const expectedZeroToleranceFailureTags: LongSessionFailureTag[] = [
  "missing-required",
  "forbidden-injected",
  "stale-memory-leak",
  "false-premise-recall",
  "cross-scope-leak",
  "budget-overrun",
  "wrong-route",
  "durable-store-mutation",
  "continuity-slot-mismatch",
]

const reportKeys = ["generatedAt", "corpusId", "mode", "scenarioResults", "summary"]

const summaryKeys = [
  "scenarioCount",
  "passCount",
  "failCount",
  "zeroToleranceFailures",
  "stepCount",
  "meanRequiredRecall",
  "meanForbiddenLeakRate",
  "maxContextBudgetOverrun",
  "durableStoreMutations",
  "failureTagCounts",
  "satisfactory",
]

const scenarioResultKeys = [
  "id",
  "description",
  "passed",
  "stepResults",
  "failureTags",
  "stepCount",
  "contextChars",
  "maxContextBudgetOverrun",
  "durableStoreTouched",
  "benchmark",
]

const requiredStepResultKeys = [
  "id",
  "event",
  "passed",
  "actualMemoryIds",
  "actualContinuityIds",
  "requiredMemoryIds",
  "acceptableMemoryIds",
  "forbiddenMemoryIds",
  "requiredContinuityIds",
  "forbiddenContinuityIds",
  "missingRequired",
  "forbiddenInjected",
  "forbiddenContinuityPresent",
  "requiredTextMissing",
  "forbiddenTextPresent",
  "requiredTextTotal",
  "forbiddenTextTotal",
  "contextChars",
  "failureTags",
  "contextDecision",
]

function scenarioById(id: string): LongSessionScenario {
  const scenario = corpus.find((candidate) => candidate.id === id)
  assert.ok(scenario, `missing long-session synthetic scenario ${id}`)
  return scenario
}

function stepResultById(result: LongSessionScenarioResult, id: string): LongSessionStepResult {
  const step = result.stepResults.find((candidate) => candidate.id === id)
  assert.ok(step, `missing step result ${id}`)
  return step
}

function assertIncludesAll(actual: readonly string[], expected: readonly string[], label: string): void {
  for (const value of expected) assert.equal(actual.includes(value), true, `${label} missing ${value}`)
}

function assertIncludesNone(actual: readonly string[], forbidden: readonly string[], label: string): void {
  for (const value of forbidden) assert.equal(actual.includes(value), false, `${label} included ${value}`)
}

function assertStepPassed(step: LongSessionStepResult): void {
  assert.equal(step.passed, true, step.id)
  assert.deepEqual(step.missingRequired, [], `${step.id} missing required memories or continuity slots`)
  assert.deepEqual(step.forbiddenInjected, [], `${step.id} leaked forbidden memories`)
  assert.deepEqual(step.forbiddenContinuityPresent, [], `${step.id} leaked forbidden continuity slots`)
  assert.deepEqual(step.requiredTextMissing, [], `${step.id} missing required text`)
  assert.deepEqual(step.forbiddenTextPresent, [], `${step.id} leaked forbidden text`)
  assert.deepEqual(step.failureTags, [], `${step.id} failure tags`)
  if (step.maxContextChars !== undefined) {
    assert.ok(step.contextChars <= step.maxContextChars, `${step.id} used ${step.contextChars} chars with budget ${step.maxContextChars}`)
  }
}

function longSessionStepResult(overrides: Partial<LongSessionStepResult> & { id: string }): LongSessionStepResult {
  const result: LongSessionStepResult = {
    id: overrides.id,
    event: "prompt",
    passed: true,
    actualMemoryIds: [],
    actualContinuityIds: [],
    requiredMemoryIds: [],
    acceptableMemoryIds: [],
    forbiddenMemoryIds: [],
    requiredContinuityIds: [],
    forbiddenContinuityIds: [],
    missingRequired: [],
    forbiddenInjected: [],
    forbiddenContinuityPresent: [],
    requiredTextMissing: [],
    forbiddenTextPresent: [],
    requiredTextTotal: 0,
    forbiddenTextTotal: 0,
    contextChars: 0,
    failureTags: [],
    ...overrides,
  }
  return result
}

function longSessionScenarioResult(overrides: Partial<LongSessionScenarioResult> & { id: string }): LongSessionScenarioResult {
  const failureTags = overrides.failureTags ?? []
  const stepResults = overrides.stepResults ?? [longSessionStepResult({ id: `${overrides.id}-step` })]
  const result: LongSessionScenarioResult = {
    id: overrides.id,
    description: "synthetic long-session canary result",
    passed: failureTags.length === 0,
    stepResults,
    failureTags,
    stepCount: stepResults.length,
    contextChars: stepResults.reduce((sum, step) => sum + step.contextChars, 0),
    maxContextBudgetOverrun: 0,
    durableStoreTouched: false,
    benchmark: { ability: "lifecycle-injection", lane: "lifecycle-injection" },
    ...overrides,
  }
  return result
}

test("long-session summary keeps required recall perfect without inventing forbidden leaks", () => {
  const requiredOnlyStep = longSessionStepResult({
    id: "required-only-step",
    actualMemoryIds: ["required-memory"],
    requiredMemoryIds: ["required-memory"],
  })
  const summary = summarizeResults([longSessionScenarioResult({
    id: "required-only-result",
    stepResults: [requiredOnlyStep],
  })])

  assert.equal(summary.meanRequiredRecall, 1)
  assert.equal(summary.meanForbiddenLeakRate, 0)
  assert.equal(summary.satisfactory, true)
})

test("long-session corpus validation keeps memory ids scenario-local", () => {
  const scenarios: LongSessionScenario[] = [
    {
      id: "record-owner-scenario",
      description: "Owns a record whose id another scenario must not be allowed to reference.",
      benchmark: { ability: "lifecycle-injection", lane: "lifecycle-injection" },
      policy: { mode: "selective" },
      records: [memory({ id: "cross-scenario-record", text: "Only this scenario may reference this record." })],
      steps: [
        {
          id: "owner-step",
          event: "prompt",
          prompt: "What record belongs to this scenario?",
          requiredMemoryIds: ["cross-scenario-record"],
        },
      ],
    },
    {
      id: "invalid-borrower-scenario",
      description: "References a record id that exists only in a different scenario.",
      benchmark: { ability: "lifecycle-injection", lane: "lifecycle-injection" },
      policy: { mode: "selective" },
      records: [memory({ id: "borrower-local-record", text: "The borrower scenario has only its own local record." })],
      steps: [
        {
          id: "borrowed-reference-step",
          event: "prompt",
          prompt: "This step incorrectly references another scenario's record.",
          requiredMemoryIds: ["cross-scenario-record"],
        },
      ],
    },
  ]

  assert.throws(
    () => assertCorpusStructurallyValid(scenarios),
    /borrowed-reference-step references unknown memory id cross-scenario-record/u,
  )
})

test("session-start rendered descriptor ids do not match superseded id substrings", async () => {
  const result = await evaluateScenario({
    id: "session-start-descriptor-id-boundary",
    description: "A compact descriptor id extends a superseded id prefix without causing substring recall.",
    benchmark: { ability: "lifecycle-injection", lane: "lifecycle-injection" },
    policy: { mode: "selective", maxItems: { sessionStart: 2, prompt: 2 }, maxChars: { sessionStart: 1200, prompt: 1200 } },
    records: [
      memory({
        id: "prefix-memory",
        kind: "decision",
        text: "SUPERSEDED PREFIX MEMORY BODY: use the obsolete descriptor id.",
        updatedAt: "2026-07-05T09:10:00.000Z",
        revision: { supersededBy: "prefix-memory-extended", reason: "A later descriptor superseded the prefix id", revisedAt: "2026-07-05T09:20:00.000Z", revisedBy: "manual" },
      }),
      memory({
        id: "prefix-memory-extended",
        kind: "decision",
        text: "Current extended descriptor body should be represented by descriptor metadata at session start.",
        updatedAt: "2026-07-05T09:20:00.000Z",
        revision: { supersedes: ["prefix-memory"], reason: "Boundary-safe descriptor id", revisedAt: "2026-07-05T09:20:00.000Z", revisedBy: "manual" },
        descriptor: {
          description: "Current extended descriptor summary",
          fetchHint: "when checking descriptor id boundaries",
        },
      }),
    ],
    steps: [
      {
        id: "session-start-descriptor-boundary",
        event: "sessionStart",
        requiredMemoryIds: ["prefix-memory-extended"],
        forbiddenMemoryIds: ["prefix-memory"],
        requiredText: ["Current extended descriptor summary"],
        forbiddenText: ["SUPERSEDED PREFIX MEMORY BODY"],
        expectedDecision: { event: "sessionStart", mode: "selective" },
      },
    ],
  })
  const step = stepResultById(result, "session-start-descriptor-boundary")

  assert.equal(result.passed, true)
  assertStepPassed(step)
  assertIncludesAll(step.actualMemoryIds, ["prefix-memory-extended"], step.id)
  assertIncludesNone(step.actualMemoryIds, ["prefix-memory"], step.id)
})

test("long-session synthetic eval corpus is structurally valid and covers issue 113 behaviors", () => {
  assertCorpusStructurallyValid(corpus)
  assert.ok(corpus.length >= expectedScenarioCoverage.length)
  assert.equal(new Set(corpus.map((scenario) => scenario.id)).size, corpus.length)

  for (const tag of expectedZeroToleranceFailureTags) {
    assert.equal(ZERO_TOLERANCE_FAILURE_TAGS.has(tag), true, `${tag} must reject the eval gate`)
  }

  for (const expected of expectedScenarioCoverage) {
    const scenario = scenarioById(expected.id)
    assert.equal(scenario.description.length > 0, true, `${scenario.id} description`)
    assertBenchmarkMetadata(scenario.benchmark, "lifecycle-injection", scenario.id)
    assert.equal(scenario.benchmark.ability, expected.ability, `${scenario.id} benchmark ability`)
    assert.deepEqual(scenario.steps.map((step) => step.id), expected.steps, `${scenario.id} step coverage`)
    assert.equal(new Set(scenario.steps.map((step) => step.id)).size, scenario.steps.length, `${scenario.id} duplicate step ids`)

    const recordIds = new Set(scenario.records.map((record) => record.id))
    assert.equal(recordIds.size, scenario.records.length, `${scenario.id} duplicate record ids`)
    for (const step of scenario.steps) {
      assert.ok(step.event === "continuity" || step.prompt !== undefined, `${step.id} prompt event needs prompt text`)
      assertIncludesAll([...recordIds], step.requiredMemoryIds ?? [], `${step.id} required memory references`)
      assertIncludesAll([...recordIds], step.acceptableMemoryIds ?? [], `${step.id} acceptable memory references`)
      assertIncludesAll([...recordIds], step.forbiddenMemoryIds ?? [], `${step.id} forbidden memory references`)
      assert.ok((step.requiredText?.length ?? 0) > 0 || (step.requiredMemoryIds?.length ?? 0) > 0 || (step.requiredContinuityIds?.length ?? 0) > 0, `${step.id} defends an observable positive contract`)
      assert.ok((step.forbiddenText?.length ?? 0) > 0 || (step.forbiddenMemoryIds?.length ?? 0) > 0 || (step.forbiddenContinuityIds?.length ?? 0) > 0, `${step.id} defends an observable leak contract`)
    }
  }
})

test("long-session synthetic eval report is deterministic and preserves the JSON contract", async () => {
  const report = await buildLongSessionEvalReport()
  const repeatReport = await buildLongSessionEvalReport()

  assert.deepEqual(repeatReport, report)
  assert.deepEqual(Object.keys(report).sort(), [...reportKeys].sort())
  assert.deepEqual(Object.keys(report.summary).sort(), [...summaryKeys].sort())
  assert.equal(report.generatedAt, GENERATED_AT)
  assert.equal(report.corpusId, CORPUS_ID)
  assert.equal(report.mode, "local-fixtures")
  assert.equal(report.summary.scenarioCount, corpus.length)
  assert.equal(report.summary.stepCount, corpus.reduce((sum, scenario) => sum + scenario.steps.length, 0))
  assert.equal(report.summary.passCount, corpus.length)
  assert.equal(report.summary.failCount, 0)
  assert.equal(report.summary.zeroToleranceFailures, 0)
  assert.equal(report.summary.meanRequiredRecall, 1)
  assert.equal(report.summary.meanForbiddenLeakRate, 0)
  assert.equal(report.summary.maxContextBudgetOverrun, 0)
  assert.equal(report.summary.durableStoreMutations, 0)
  assert.deepEqual(report.summary.failureTagCounts, {})
  assert.equal(report.summary.satisfactory, true)
  assert.equal(report.summary.satisfactory, reportIsSatisfactory(report))
  assertBenchmarkParity(report.scenarioResults, corpus)

  for (const result of report.scenarioResults) {
    const scenario = scenarioById(result.id)
    assert.deepEqual(Object.keys(result).sort(), [...scenarioResultKeys].sort(), `${result.id} result fields`)
    assert.equal(result.description, scenario.description, `${result.id} description parity`)
    assert.equal(result.stepCount, scenario.steps.length, `${result.id} step count`)
    assert.equal(result.stepResults.length, scenario.steps.length, `${result.id} step result count`)
    assert.equal(result.passed, true, `${result.id} passed`)
    assert.deepEqual(result.failureTags, [], `${result.id} failure tags`)
    assert.equal(result.maxContextBudgetOverrun, 0, `${result.id} context budget`)
    assert.equal(result.durableStoreTouched, false, `${result.id} durable store isolation`)
    assert.ok(Number.isInteger(result.contextChars), `${result.id} context char count`)
    assert.ok(result.contextChars >= 0, `${result.id} non-negative context char count`)

    for (const step of result.stepResults) {
      assertIncludesAll(Object.keys(step), requiredStepResultKeys, `${step.id} result fields`)
      assertStepPassed(step)
    }
  }
})

test("temporal currentness scenario recalls the current decision without stale runner guidance", async () => {
  const result = await evaluateScenario(scenarioById("temporal-currentness-supersedes-stale-decision"))
  const step = stepResultById(result, "prompt-current-runner-decision")

  assert.equal(result.passed, true)
  assert.equal(result.benchmark.ability, "temporal-currentness")
  assertStepPassed(step)
  assertIncludesAll(step.actualMemoryIds, ["current-runner-decision"], step.id)
  assertIncludesNone(step.actualMemoryIds, ["stale-runner-decision"], step.id)
  assert.equal(step.contextDecision?.event, "prompt")
  assert.equal(step.contextDecision?.mode, "selective")
})

test("knowledge update scenario keeps the latest verification procedure and rejects superseded commands", async () => {
  const result = await evaluateScenario(scenarioById("knowledge-update-repeated-session-corrections"))
  const step = stepResultById(result, "prompt-current-verification-procedure")

  assert.equal(result.passed, true)
  assert.equal(result.benchmark.ability, "knowledge-update")
  assertStepPassed(step)
  assertIncludesAll(step.actualMemoryIds, ["verification-v3"], step.id)
  assertIncludesNone(step.actualMemoryIds, ["verification-v1", "verification-v2"], step.id)
  assert.equal(step.requiredTextTotal, 2)
  assert.equal(step.forbiddenTextTotal, 2)
})

test("multi-session continuity keeps current progress while broad next-work prompts avoid raw recall", async () => {
  const result = await evaluateScenario(scenarioById("multi-session-summary-continuity"))
  const continuityStep = stepResultById(result, "continuity-current-progress")
  const promptStep = stepResultById(result, "prompt-next-work-guidance-only")

  assert.equal(result.passed, true)
  assert.equal(result.benchmark.ability, "continuity-status")
  assertStepPassed(continuityStep)
  assertIncludesAll(continuityStep.actualContinuityIds, ["current-long-session-progress"], continuityStep.id)
  assertIncludesNone(continuityStep.actualContinuityIds, ["stale-long-session-progress"], continuityStep.id)

  assertStepPassed(promptStep)
  assertIncludesNone(promptStep.actualMemoryIds, ["summary-session-1", "summary-session-2", "current-long-session-progress"], promptStep.id)
  assert.equal(promptStep.contextDecision?.continuityIntent?.family, "next-work")
  assert.equal(promptStep.contextDecision?.omittedReasons.includes("broad-continuity-no-recall"), true)
})

test("false premise abstention gives continuity guidance without recalling local-only evidence", async () => {
  const result = await evaluateScenario(scenarioById("false-premise-abstention-no-answer"))
  const step = stepResultById(result, "prompt-false-premise-longmemeval-status")

  assert.equal(result.passed, true)
  assert.equal(result.benchmark.ability, "false-premise-abstention")
  assertStepPassed(step)
  assertIncludesNone(step.actualMemoryIds, ["local-only-scope", "workflow-continuity-rule", "global-evidence-preference"], step.id)
  assert.equal(step.contextDecision?.continuityIntent?.family, "project-position")
  assert.equal(step.contextDecision?.omittedReasons.includes("broad-continuity-no-recall"), true)
})

test("cross-scope safety prefers project-local CI guidance and suppresses other-project memory", async () => {
  const result = await evaluateScenario(scenarioById("project-global-preference-conflict-safety"))
  const step = stepResultById(result, "prompt-ci-preference-conflict")

  assert.equal(result.passed, true)
  assert.equal(result.benchmark.ability, "cross-scope-safety")
  assertStepPassed(step)
  assertIncludesAll(step.actualMemoryIds, ["project-local-ci-preference"], step.id)
  assertIncludesNone(step.actualMemoryIds, ["other-project-ci-rule"], step.id)
  assert.equal(step.contextDecision?.event, "prompt")
  assert.equal(step.contextDecision?.mode, "selective")
})

test("bounded context scenario preserves the current plan without leaking filler or stale bodies", async () => {
  const result = await evaluateScenario(scenarioById("bounded-long-context-budget-pressure"))
  const step = stepResultById(result, "prompt-budget-pressure-current-plan")

  assert.equal(result.passed, true)
  assert.equal(result.benchmark.ability, "lifecycle-injection")
  assertStepPassed(step)
  assertIncludesAll(step.actualMemoryIds, ["current-budget-plan"], step.id)
  assertIncludesNone(step.actualMemoryIds, ["stale-budget-plan"], step.id)
  assert.equal(step.actualMemoryIds.some((id) => id.startsWith("long-session-filler-")), false)
  assert.ok(step.maxContextChars !== undefined, "bounded context scenario needs an explicit context budget")
  assert.ok(step.contextChars <= step.maxContextChars, `${step.id} used ${step.contextChars} chars with budget ${step.maxContextChars}`)
})

test("long-session synthetic eval keeps every scenario isolated from durable stores", async () => {
  const report = await buildLongSessionEvalReport()

  assert.equal(report.summary.durableStoreMutations, 0)
  for (const result of report.scenarioResults) {
    assert.equal(result.durableStoreTouched, false, `${result.id} touched a durable store`)
    assert.equal(result.failureTags.includes("durable-store-mutation"), false, `${result.id} durable store failure tag`)
  }
})

test("long-session synthetic eval gate rejects no-data and unsatisfactory summaries", () => {
  const emptySummary = summarizeResults([])
  assert.equal(emptySummary.scenarioCount, 0)
  assert.equal(emptySummary.satisfactory, false)
  assert.equal(reportIsSatisfactory({
    generatedAt: GENERATED_AT,
    corpusId: CORPUS_ID,
    mode: "local-fixtures",
    scenarioResults: [],
    summary: emptySummary,
  }), false)

  const failingStep = longSessionStepResult({
    id: "bad-step",
    passed: false,
    requiredMemoryIds: ["current-memory"],
    forbiddenMemoryIds: ["stale-memory"],
    missingRequired: ["current-memory"],
    forbiddenInjected: ["stale-memory"],
    requiredTextMissing: ["Current memory body"],
    forbiddenTextPresent: ["STALE memory body"],
    requiredTextTotal: 1,
    forbiddenTextTotal: 1,
    contextChars: 104,
    maxContextChars: 100,
    failureTags: ["missing-required", "forbidden-injected", "budget-overrun"],
  })
  const failingResult = longSessionScenarioResult({
    id: "bad-long-session-report",
    passed: false,
    stepResults: [failingStep],
    stepCount: 1,
    contextChars: failingStep.contextChars,
    maxContextBudgetOverrun: 4,
    durableStoreTouched: true,
    failureTags: ["missing-required", "forbidden-injected", "budget-overrun", "durable-store-mutation"],
  })
  const summary = summarizeResults([failingResult])

  assert.equal(summary.scenarioCount, 1)
  assert.equal(summary.passCount, 0)
  assert.equal(summary.failCount, 1)
  assert.equal(summary.zeroToleranceFailures, 4)
  assert.equal(summary.stepCount, 1)
  assert.equal(summary.meanRequiredRecall, 0)
  assert.equal(summary.meanForbiddenLeakRate, 1)
  assert.equal(summary.maxContextBudgetOverrun, 4)
  assert.equal(summary.durableStoreMutations, 1)
  assert.deepEqual(summary.failureTagCounts, {
    "missing-required": 1,
    "forbidden-injected": 1,
    "budget-overrun": 1,
    "durable-store-mutation": 1,
  })
  assert.equal(summary.satisfactory, false)
  assert.equal(reportIsSatisfactory({
    generatedAt: GENERATED_AT,
    corpusId: CORPUS_ID,
    mode: "local-fixtures",
    scenarioResults: [failingResult],
    summary,
  }), false)
})
