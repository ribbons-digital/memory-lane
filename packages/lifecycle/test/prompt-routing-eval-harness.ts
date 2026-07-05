import { summarizeEvalGate } from "../../core/test/eval-report-helpers.js"
import {
  classifyPromptRoute,
  renderContinuityIntentGuidance,
  type ContinuityIntentFamily,
  type PromptRoute,
} from "../src/injection.ts"

export const GENERATED_AT = "2026-07-04T12:30:00.000Z"
export const CORPUS_ID = "prompt-routing-baseline-v1"

export type PromptRoutingFailureTag = "wrong-route" | "wrong-intent-family" | "missing-reason" | "unexpected-reason" | "wrong-guidance"

export const ZERO_TOLERANCE_FAILURE_TAGS: Record<PromptRoutingFailureTag, true | undefined> = {
  "wrong-route": true,
  "wrong-intent-family": true,
  "wrong-guidance": true,
  "missing-reason": undefined,
  "unexpected-reason": undefined,
}

export interface PromptRoutingEvalScenario {
  id: string
  prompt: string
  expectedRoute: PromptRoute
  expectedIntentFamily?: ContinuityIntentFamily
  requiredReasons?: string[]
  forbiddenReasons?: string[]
  expectsContinuityGuidance?: boolean
}

export interface PromptRoutingScenarioResult {
  id: string
  prompt: string
  passed: boolean
  expectedRoute: PromptRoute
  actualRoute: PromptRoute
  expectedIntentFamily?: ContinuityIntentFamily
  actualIntentFamily?: ContinuityIntentFamily
  requiredReasons: string[]
  missingReasons: string[]
  unexpectedReasons: string[]
  failureTags: PromptRoutingFailureTag[]
}

export interface PromptRoutingEvalReport {
  generatedAt: string
  corpusId: string
  mode: "local-fixtures"
  scenarioResults: PromptRoutingScenarioResult[]
  summary: {
    scenarioCount: number
    passCount: number
    failCount: number
    zeroToleranceFailures: number
    routeAccuracy: number
    intentFamilyAccuracy: number
    meanRequiredReasonRecall: number
    failureTagCounts: Record<string, number>
    satisfactory: boolean
  }
}

export const corpus: PromptRoutingEvalScenario[] = [
  {
    id: "continuity-resume",
    prompt: "Let's resume building prompt continuity intents",
    expectedRoute: "continuity",
    expectedIntentFamily: "resume",
    requiredReasons: ["resume"],
    expectsContinuityGuidance: true,
  },
  {
    id: "continuity-lookup",
    prompt: "Where was lifecycle continuity implemented?",
    expectedRoute: "continuity",
    expectedIntentFamily: "lookup",
    requiredReasons: ["lookup"],
    expectsContinuityGuidance: true,
  },
  {
    id: "continuity-project-position",
    prompt: "Where are we in the project?",
    expectedRoute: "continuity",
    expectedIntentFamily: "project-position",
    requiredReasons: ["project-position"],
    expectsContinuityGuidance: true,
  },
  {
    id: "continuity-next-work",
    prompt: "What should we work on next?",
    expectedRoute: "continuity",
    expectedIntentFamily: "next-work",
    requiredReasons: ["next-work"],
    expectsContinuityGuidance: true,
  },
  {
    id: "continuity-next-scope",
    prompt: "what's the next item we should work on and what's its scope?",
    expectedRoute: "continuity",
    expectedIntentFamily: "next-work",
    requiredReasons: ["scope-next-work"],
    expectsContinuityGuidance: true,
  },
  {
    id: "memory-management-list",
    prompt: "show my memories",
    expectedRoute: "memory-management",
    requiredReasons: ["memory-management"],
    expectsContinuityGuidance: false,
  },
  {
    id: "memory-management-review",
    prompt: "what memory is pending review?",
    expectedRoute: "memory-management",
    requiredReasons: ["memory-management"],
    expectsContinuityGuidance: false,
  },
  {
    id: "low-signal-thanks",
    prompt: "thank you",
    expectedRoute: "low-signal",
    requiredReasons: ["low-signal"],
    expectsContinuityGuidance: false,
  },
  {
    id: "low-signal-greeting",
    prompt: "hi",
    expectedRoute: "low-signal",
    requiredReasons: ["low-signal"],
    expectsContinuityGuidance: false,
  },
  {
    id: "ordinary-task",
    prompt: "implement the eval runner",
    expectedRoute: "ordinary",
    expectsContinuityGuidance: false,
  },
  {
    id: "ordinary-technical-question",
    prompt: "How do I run tests?",
    expectedRoute: "ordinary",
    expectsContinuityGuidance: false,
  },
]

function uniqueTags(tags: PromptRoutingFailureTag[]): PromptRoutingFailureTag[] {
  return [...new Set(tags)]
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? Number.NaN : numerator / denominator
}


export function evaluateScenario(scenario: PromptRoutingEvalScenario): PromptRoutingScenarioResult {
  const decision = classifyPromptRoute(scenario.prompt)
  const actualIntentFamily = decision.intent.detected ? decision.intent.family : undefined
  const requiredReasons = scenario.requiredReasons ?? []
  const forbiddenReasons = scenario.forbiddenReasons ?? []
  const missingReasons = requiredReasons.filter((reason) => !decision.reasons.includes(reason))
  const unexpectedReasons = forbiddenReasons.filter((reason) => decision.reasons.includes(reason))
  const guidance = renderContinuityIntentGuidance(decision.intent)
  const guidanceGenerated = guidance.length > 0
  const failureTags: PromptRoutingFailureTag[] = []

  if (decision.route !== scenario.expectedRoute) failureTags.push("wrong-route")
  if (actualIntentFamily !== scenario.expectedIntentFamily) failureTags.push("wrong-intent-family")
  if (missingReasons.length) failureTags.push("missing-reason")
  if (unexpectedReasons.length) failureTags.push("unexpected-reason")
  if (guidanceGenerated !== Boolean(scenario.expectsContinuityGuidance)) failureTags.push("wrong-guidance")

  const tags = uniqueTags(failureTags)
  return {
    id: scenario.id,
    prompt: scenario.prompt,
    passed: tags.length === 0,
    expectedRoute: scenario.expectedRoute,
    actualRoute: decision.route,
    ...(scenario.expectedIntentFamily ? { expectedIntentFamily: scenario.expectedIntentFamily } : {}),
    ...(actualIntentFamily ? { actualIntentFamily } : {}),
    requiredReasons,
    missingReasons,
    unexpectedReasons,
    failureTags: tags,
  }
}

export function summarizeResults(results: PromptRoutingScenarioResult[]): PromptRoutingEvalReport["summary"] {
  const requiredReasonTotal = results.reduce((sum, result) => sum + result.requiredReasons.length, 0)
  const requiredReasonFound = results.reduce((sum, result) => sum + result.requiredReasons.length - result.missingReasons.length, 0)
  const expectedIntentTotal = results.filter((result) => result.expectedIntentFamily !== undefined).length
  const correctIntentTotal = results.filter((result) => result.expectedIntentFamily !== undefined && result.expectedIntentFamily === result.actualIntentFamily).length
  const gateSummary = summarizeEvalGate(results, ZERO_TOLERANCE_FAILURE_TAGS)
  const routeAccuracy = ratio(results.filter((result) => result.expectedRoute === result.actualRoute).length, results.length)
  const intentFamilyAccuracy = ratio(correctIntentTotal, expectedIntentTotal)
  const meanRequiredReasonRecall = ratio(requiredReasonFound, requiredReasonTotal)
  const satisfactory = gateSummary.satisfactory
    && Number.isFinite(routeAccuracy)
    && routeAccuracy === 1
    && Number.isFinite(intentFamilyAccuracy)
    && intentFamilyAccuracy === 1
    && Number.isFinite(meanRequiredReasonRecall)
    && meanRequiredReasonRecall === 1
  return {
    scenarioCount: gateSummary.scenarioCount,
    passCount: gateSummary.passCount,
    failCount: gateSummary.failCount,
    zeroToleranceFailures: gateSummary.zeroToleranceFailures,
    routeAccuracy,
    intentFamilyAccuracy,
    meanRequiredReasonRecall,
    failureTagCounts: gateSummary.failureTagCounts,
    satisfactory,
  }
}

export function buildPromptRoutingEvalReport(scenarios: PromptRoutingEvalScenario[] = corpus): PromptRoutingEvalReport {
  if (scenarios.length === 0) throw new Error("prompt routing eval requires at least one scenario")
  const scenarioResults = scenarios.map(evaluateScenario)
  return {
    generatedAt: GENERATED_AT,
    corpusId: CORPUS_ID,
    mode: "local-fixtures",
    scenarioResults,
    summary: summarizeResults(scenarioResults),
  }
}

export function reportIsSatisfactory(report: PromptRoutingEvalReport): boolean {
  return report.summary.scenarioCount > 0
    && report.summary.passCount + report.summary.failCount === report.summary.scenarioCount
    && report.summary.failCount === 0
    && report.summary.zeroToleranceFailures === 0
    && report.summary.satisfactory === true
    && Number.isFinite(report.summary.routeAccuracy)
    && report.summary.routeAccuracy === 1
    && Number.isFinite(report.summary.intentFamilyAccuracy)
    && report.summary.intentFamilyAccuracy === 1
    && Number.isFinite(report.summary.meanRequiredReasonRecall)
    && report.summary.meanRequiredReasonRecall === 1
}
