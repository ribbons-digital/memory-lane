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

type InjectionFailureTag = InjectionScenarioResult["failureTags"][number]

const expectedZeroToleranceFailureTags: InjectionFailureTag[] = [
  "forbidden-injected",
  "cross-project-leak",
  "non-approved-leak",
  "secret-leak",
  "policy-only-body-leak",
  "budget-overrun",
  "wrong-route",
  "superseded-progress",
]

function scenarioById(id: string) {
  const scenario = corpus.find((candidate) => candidate.id === id)
  assert.ok(scenario, `missing lifecycle injection eval scenario ${id}`)
  return scenario
}

async function evaluateScenarioById(id: string) {
  const scenario = scenarioById(id)
  return evaluateScenario(scenario)
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

test("lifecycle injection eval corpus includes issue 111 adversarial groups", () => {
  const scenarioIds = corpus.map((scenario) => scenario.id)
  const groups = [
    {
      name: "policy-only body-free",
      ids: ["session-start-policy-only-no-bodies", "prompt-policy-only-continuity-no-bodies"],
    },
    {
      name: "selective bounded useful under budget pressure",
      ids: ["prompt-selective-budget-pressure"],
    },
    {
      name: "cross-project leak suppression",
      ids: ["prompt-selective-cross-project-noise-filtered"],
    },
    {
      name: "non-approved and secret leak suppression",
      ids: ["prompt-selective-non-approved-and-secret-filtered"],
    },
    {
      name: "superseded progress leak suppression",
      ids: ["prompt-selective-superseded-progress-filtered"],
    },
    {
      name: "noisy broad-continuity context suppression",
      ids: ["prompt-broad-next-work-continuity-only", "prompt-broad-status-continuity-only"],
    },
    {
      name: "sessionStart and prompt route distinction",
      ids: ["session-start-selective-governance", "prompt-selective-targeted-recall", "session-start-off-no-context", "prompt-off-no-context"],
    },
  ]

  for (const group of groups) {
    for (const id of group.ids) {
      assert.equal(scenarioIds.includes(id), true, `missing ${group.name} scenario ${id}`)
    }
  }
})

test("lifecycle injection eval report reaches satisfactory thresholds", async () => {
  const report = await buildInjectionEvalReport()
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
  assert.equal(report.summary.meanRequiredRecall, 1)
  assert.equal(report.summary.meanForbiddenLeakRate, 0)
  assert.equal(report.summary.maxContextBudgetOverrun, 0)
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
  assert.equal(summary.scenarioCount, 1)
  assert.equal(summary.passCount, 0)
  assert.deepEqual(summary.failureTagCounts, {
    "forbidden-injected": 1,
    "cross-project-leak": 1,
  })
  assert.equal(summary.satisfactory, false)
  assert.equal(reportIsSatisfactory({
    generatedAt: GENERATED_AT,
    corpusId: CORPUS_ID,
    mode: "local-fixtures",
    scenarioResults: [result],
    summary,
  }), false)
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

test("policy-only lifecycle injection scenarios provide guidance without memory bodies", async () => {
  const cases = [
    { id: "session-start-policy-only-no-bodies", event: "sessionStart" },
    { id: "prompt-policy-only-continuity-no-bodies", event: "prompt" },
  ] as const

  for (const { id, event } of cases) {
    const result = await evaluateScenarioById(id)
    assert.equal(result.passed, true, id)
    assert.equal(result.event, event, id)
    assert.equal(result.policyMode, "policy-only", id)
    assert.equal(result.contextDecision?.event, event, id)
    assert.equal(result.contextDecision?.mode, "policy-only", id)
    assert.equal(result.contextDecision?.omittedReasons.includes("policy-only"), true, id)
    assert.deepEqual(result.actualMemoryIds, [], id)
    assert.deepEqual(result.forbiddenInjected, [], id)
    assert.deepEqual(result.forbiddenTextPresent, [], id)
    assert.deepEqual(result.requiredTextMissing, [], id)
    assert.deepEqual(result.failureTags, [], id)
  }
})

test("selective prompt injection stays bounded and useful under budget pressure", async () => {
  const scenario = scenarioById("prompt-selective-budget-pressure")
  const result = await evaluateScenario(scenario)
  const maxPromptItems = scenario.policy.maxItems?.prompt

  assert.equal(result.passed, true)
  assert.equal(result.policyMode, "selective")
  assert.equal(result.contextDecision?.event, "prompt")
  assert.equal(result.contextDecision?.mode, "selective")
  assert.equal(result.actualMemoryIds.includes("prompt-verification-procedure"), true)
  assert.deepEqual(result.missingRequired, [])
  assert.deepEqual(result.forbiddenInjected, [])
  assert.deepEqual(result.forbiddenTextPresent, [])
  assert.deepEqual(result.failureTags, [])
  assert.ok(maxPromptItems !== undefined, "budget pressure scenario must set prompt maxItems")
  assert.ok(result.actualMemoryIds.length <= maxPromptItems, `selected ${result.actualMemoryIds.length} memories with prompt maxItems ${maxPromptItems}`)
  assert.ok(result.maxContextChars !== undefined, "budget pressure scenario must set maxContextChars")
  assert.ok(result.contextChars <= result.maxContextChars, `context used ${result.contextChars} chars with max ${result.maxContextChars}`)
})

test("selective prompt injection suppresses cross-project, non-approved, secret, and superseded leaks", async () => {
  const cases: Array<{
    id: string
    requiredMemoryId: string
    forbiddenMemoryIds: string[]
    leakTags: InjectionFailureTag[]
  }> = [
    {
      id: "prompt-selective-cross-project-noise-filtered",
      requiredMemoryId: "prompt-verification-procedure",
      forbiddenMemoryIds: ["cross-project-memory", "other-project-verification"],
      leakTags: ["cross-project-leak"],
    },
    {
      id: "prompt-selective-non-approved-and-secret-filtered",
      requiredMemoryId: "prompt-verification-procedure",
      forbiddenMemoryIds: ["pending-draft", "pending-verification-secret-note", "approved-secret-verification-note", "secret-looking-memory"],
      leakTags: ["non-approved-leak", "secret-leak"],
    },
    {
      id: "prompt-selective-superseded-progress-filtered",
      requiredMemoryId: "current-progress",
      forbiddenMemoryIds: ["superseded-progress"],
      leakTags: ["superseded-progress"],
    },
  ]

  for (const { id, requiredMemoryId, forbiddenMemoryIds, leakTags } of cases) {
    const result = await evaluateScenarioById(id)
    assert.equal(result.passed, true, id)
    assert.equal(result.actualMemoryIds.includes(requiredMemoryId), true, id)
    assert.deepEqual(result.missingRequired, [], id)
    assert.deepEqual(result.forbiddenInjected, [], id)
    assert.deepEqual(result.forbiddenTextPresent, [], id)
    for (const forbiddenMemoryId of forbiddenMemoryIds) {
      assert.equal(result.actualMemoryIds.includes(forbiddenMemoryId), false, `${id} leaked ${forbiddenMemoryId}`)
    }
    for (const leakTag of leakTags) {
      assert.equal(result.failureTags.includes(leakTag), false, `${id} raised ${leakTag}`)
    }
    assert.deepEqual(result.failureTags, [], id)
  }
})

test("broad continuity prompts suppress noisy recalled context", async () => {
  const cases = [
    { id: "prompt-broad-next-work-continuity-only", family: "next-work" },
    { id: "prompt-broad-status-continuity-only", family: "project-position" },
  ] as const

  for (const { id, family } of cases) {
    const result = await evaluateScenarioById(id)
    assert.equal(result.passed, true, id)
    assert.equal(result.contextDecision?.event, "prompt", id)
    assert.equal(result.contextDecision?.mode, "selective", id)
    assert.equal(result.contextDecision?.continuityIntent?.family, family, id)
    assert.equal(result.contextDecision?.omittedReasons.includes("broad-continuity-no-recall"), true, id)
    assert.deepEqual(result.actualMemoryIds, [], id)
    assert.deepEqual(result.forbiddenInjected, [], id)
    assert.deepEqual(result.forbiddenTextPresent, [], id)
    assert.equal(result.failureTags.includes("noisy-context"), false, id)
    assert.deepEqual(result.failureTags, [], id)
  }
})

test("sessionStart and prompt scenarios preserve event-specific routing", async () => {
  const cases = [
    {
      id: "session-start-selective-governance",
      event: "sessionStart",
      mode: "selective",
      requiredMemoryId: "global-terse-preference",
    },
    {
      id: "prompt-selective-targeted-recall",
      event: "prompt",
      mode: "selective",
      requiredMemoryId: "prompt-verification-procedure",
    },
    {
      id: "session-start-off-no-context",
      event: "sessionStart",
      mode: "off",
      omittedReason: "off",
    },
    {
      id: "prompt-off-no-context",
      event: "prompt",
      mode: "off",
      omittedReason: "off",
    },
  ] as const

  for (const { id, event, mode, requiredMemoryId, omittedReason } of cases) {
    const result = await evaluateScenarioById(id)
    assert.equal(result.passed, true, id)
    assert.equal(result.event, event, id)
    assert.equal(result.policyMode, mode, id)
    assert.equal(result.contextDecision?.event, event, id)
    assert.equal(result.contextDecision?.mode, mode, id)
    if (requiredMemoryId) {
      assert.equal(result.actualMemoryIds.includes(requiredMemoryId), true, id)
    }
    if (omittedReason) {
      assert.equal(result.contextDecision?.omittedReasons.includes(omittedReason), true, id)
      assert.deepEqual(result.actualMemoryIds, [], id)
    }
    assert.deepEqual(result.failureTags, [], id)
  }
})

test("every zero-tolerance lifecycle injection failure tag fails the report gate", () => {
  assert.deepEqual([...ZERO_TOLERANCE_FAILURE_TAGS].sort(), [...expectedZeroToleranceFailureTags].sort())

  for (const tag of expectedZeroToleranceFailureTags) {
    const result = injectionResult({
      id: `zero-tolerance-${tag}`,
      passed: false,
      failureTags: [tag],
    })
    const summary = summarizeResults([result])
    assert.equal(summary.failCount, 1, tag)
    assert.equal(summary.zeroToleranceFailures, 1, tag)
    assert.deepEqual(summary.failureTagCounts, { [tag]: 1 }, tag)
    assert.equal(summary.satisfactory, false, tag)
    assert.equal(reportIsSatisfactory({
      generatedAt: GENERATED_AT,
      corpusId: CORPUS_ID,
      mode: "local-fixtures",
      scenarioResults: [result],
      summary,
    }), false, tag)
  }
})
