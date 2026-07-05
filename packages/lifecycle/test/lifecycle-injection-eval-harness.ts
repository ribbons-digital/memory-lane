import { isGateSatisfactory, summarizeEvalGate, type BenchmarkMetadata } from "../../core/test/eval-report-helpers.js"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  MemoryEngine,
  writeConfig,
  type MemoryContextPolicyConfig,
  type MemoryRecord,
} from "@memory-lane/core"
import { tempDir } from "../../core/test/helpers.js"
import { handleSessionStart, handleUserPromptSubmit } from "../src/handlers.ts"
import type { LifecycleResult } from "../src/types.ts"

export const GENERATED_AT = "2026-07-04T12:00:00.000Z"
export const CORPUS_ID = "lifecycle-injection-baseline-v1"
export const PROJECT_SCOPE_KEY = "lifecycle-eval-project"
export const OTHER_PROJECT_SCOPE_KEY = "other-lifecycle-project"

export type InjectionEvent = "sessionStart" | "prompt"
export type InjectionPolicyMode = "selective" | "policy-only" | "off"

export type InjectionFailureTag =
  | "missing-required"
  | "forbidden-injected"
  | "cross-project-leak"
  | "non-approved-leak"
  | "secret-leak"
  | "policy-only-body-leak"
  | "budget-overrun"
  | "wrong-route"
  | "noisy-context"
  | "superseded-progress"

export const ZERO_TOLERANCE_FAILURE_TAGS = new Set<InjectionFailureTag>([
  "forbidden-injected",
  "cross-project-leak",
  "non-approved-leak",
  "secret-leak",
  "policy-only-body-leak",
  "budget-overrun",
  "wrong-route",
  "superseded-progress",
])

export interface InjectionEvalScenario {
  id: string
  event: InjectionEvent
  policy: MemoryContextPolicyConfig
  prompt?: string
  records: MemoryRecord[]
  requiredMemoryIds?: string[]
  acceptableMemoryIds?: string[]
  forbiddenMemoryIds?: string[]
  requiredText?: string[]
  forbiddenText?: string[]
  expectedDecision?: {
    event?: "prompt" | "sessionStart"
    mode?: InjectionPolicyMode
    continuityIntentFamily?: "resume" | "lookup" | "project-position" | "next-work"
    omittedReasons?: string[]
  }
  maxContextChars?: number
  benchmark: BenchmarkMetadata
}

export interface InjectionScenarioResult {
  id: string
  event: InjectionEvent
  policyMode: InjectionPolicyMode
  passed: boolean
  actualMemoryIds: string[]
  requiredMemoryIds: string[]
  acceptableMemoryIds: string[]
  forbiddenMemoryIds: string[]
  missingRequired: string[]
  forbiddenInjected: string[]
  requiredTextMissing: string[]
  forbiddenTextPresent: string[]
  requiredTextTotal: number
  forbiddenTextTotal: number
  contextChars: number
  maxContextChars?: number
  failureTags: InjectionFailureTag[]
  contextDecision?: LifecycleResult["contextDecision"]
  benchmark: BenchmarkMetadata
}

export interface InjectionEvalReport {
  generatedAt: string
  corpusId: string
  mode: "local-fixtures"
  scenarioResults: InjectionScenarioResult[]
  summary: {
    scenarioCount: number
    passCount: number
    failCount: number
    zeroToleranceFailures: number
    meanRequiredRecall: number
    meanForbiddenLeakRate: number
    maxContextBudgetOverrun: number
    failureTagCounts: Record<string, number>
    satisfactory: boolean
  }
}

export function memory(overrides: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
  return {
    id: overrides.id,
    text: overrides.text,
    category: overrides.category ?? "project",
    scope: overrides.scope ?? { type: "project", key: PROJECT_SCOPE_KEY },
    status: overrides.status ?? "approved",
    source: overrides.source ?? "manual",
    kind: overrides.kind ?? "project_fact",
    createdAt: overrides.createdAt ?? "2026-07-04T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-04T10:00:00.000Z",
    provenance: overrides.provenance,
    revision: overrides.revision,
    project: overrides.project,
    freshness: overrides.freshness,
    descriptor: overrides.descriptor,
  }
}

export function baseRecords(): MemoryRecord[] {
  return [
    memory({
      id: "project-workflow-rule",
      kind: "workflow_rule",
      text: "Lifecycle eval workflow rule: inspect Memory Lane continuity before answering project status or next-work prompts.",
      updatedAt: "2026-07-04T10:10:00.000Z",
    }),
    memory({
      id: "current-progress",
      kind: "project_checkpoint",
      text: "Current lifecycle injection eval progress: build a report runner, enforce thresholds, and remediate failures before opening a PR.",
      updatedAt: "2026-07-04T10:20:00.000Z",
    }),
    memory({
      id: "prompt-verification-procedure",
      kind: "procedure",
      text: "Procedure: run lifecycle eval verification with pnpm --filter @memory-lane/lifecycle test before claiming lifecycle injection changes pass.",
      updatedAt: "2026-07-04T10:30:00.000Z",
    }),
    memory({
      id: "global-terse-preference",
      category: "preference",
      scope: { type: "global" },
      kind: "preference",
      text: "Global preference: keep engineering updates terse, concrete, and evidence-based.",
      updatedAt: "2026-07-04T10:40:00.000Z",
    }),
    memory({
      id: "pending-draft",
      status: "pending",
      source: "agent-suggested",
      text: "PENDING MEMORY BODY should never be injected as approved lifecycle context.",
      updatedAt: "2026-07-04T10:50:00.000Z",
    }),
    memory({
      id: "rejected-draft",
      status: "rejected",
      text: "REJECTED MEMORY BODY should never be injected as approved lifecycle context.",
      updatedAt: "2026-07-04T10:51:00.000Z",
    }),
    memory({
      id: "deleted-draft",
      status: "deleted",
      text: "DELETED MEMORY BODY should never be injected as approved lifecycle context.",
      updatedAt: "2026-07-04T10:52:00.000Z",
    }),
    memory({
      id: "cross-project-memory",
      scope: { type: "project", key: OTHER_PROJECT_SCOPE_KEY },
      text: "CROSS PROJECT MEMORY BODY should never be injected into this project lifecycle context.",
      updatedAt: "2026-07-04T10:53:00.000Z",
    }),
    memory({
      id: "secret-looking-memory",
      text: "SECRET MEMORY BODY contains OPENAI_API_KEY=sk-testshouldnotappearincontext1234567890 and must stay out of lifecycle context.",
      updatedAt: "2026-07-04T10:54:00.000Z",
    }),
    memory({
      id: "superseded-progress",
      kind: "project_checkpoint",
      text: "SUPERSEDED PROGRESS BODY says to continue the obsolete lifecycle eval prototype.",
      updatedAt: "2026-07-04T10:55:00.000Z",
      revision: { supersededBy: "current-progress", reason: "current eval plan replaced old prototype", revisedAt: "2026-07-04T10:56:00.000Z", revisedBy: "manual" },
    }),
  ]
}

export const corpus: InjectionEvalScenario[] = [
  {
    id: "session-start-selective-governance",
    benchmark: { ability: "lifecycle-injection", lane: "lifecycle-injection" },
    event: "sessionStart",
    policy: { mode: "selective", maxChars: { sessionStart: 1600, prompt: 3000 } },
    records: baseRecords(),
    requiredMemoryIds: ["global-terse-preference"],
    acceptableMemoryIds: ["current-progress", "prompt-verification-procedure", "project-workflow-rule"],
    forbiddenMemoryIds: ["pending-draft", "rejected-draft", "deleted-draft", "cross-project-memory", "secret-looking-memory", "superseded-progress"],
    requiredText: ["<memory-context mode=\"selective\" event=\"sessionStart\">", "Some approved memories are superseded historical guidance"],
    forbiddenText: ["PENDING MEMORY BODY", "REJECTED MEMORY BODY", "DELETED MEMORY BODY", "CROSS PROJECT MEMORY BODY", "SECRET MEMORY BODY", "SUPERSEDED PROGRESS BODY"],
    expectedDecision: { event: "sessionStart", mode: "selective" },
    maxContextChars: 1700,
  },
  {
    id: "session-start-policy-only-no-bodies",
    benchmark: { ability: "lifecycle-injection", lane: "lifecycle-injection" },
    event: "sessionStart",
    policy: { mode: "policy-only" },
    records: baseRecords(),
    requiredText: ["<memory-context mode=\"policy-only\" event=\"sessionStart\">", "Use Memory Lane recall/list tools"],
    forbiddenMemoryIds: baseRecords().map((record) => record.id),
    forbiddenText: ["Lifecycle eval workflow rule", "Current lifecycle injection eval progress", "Global preference: keep engineering updates", "PENDING MEMORY BODY", "CROSS PROJECT MEMORY BODY"],
    expectedDecision: { event: "sessionStart", mode: "policy-only", omittedReasons: ["policy-only"] },
    maxContextChars: 1800,
  },
  {
    id: "session-start-off-no-context",
    benchmark: { ability: "lifecycle-injection", lane: "lifecycle-injection" },
    event: "sessionStart",
    policy: { mode: "off" },
    records: baseRecords(),
    forbiddenMemoryIds: baseRecords().map((record) => record.id),
    forbiddenText: ["<memory-context", "Lifecycle eval workflow rule", "Use Memory Lane recall/list tools"],
    expectedDecision: { event: "sessionStart", mode: "off", omittedReasons: ["off"] },
    maxContextChars: 0,
  },
  {
    id: "prompt-selective-targeted-recall",
    benchmark: { ability: "direct-recall", lane: "lifecycle-injection" },
    event: "prompt",
    policy: { mode: "selective", maxChars: { sessionStart: 1600, prompt: 1400 } },
    prompt: "How do we run lifecycle eval verification?",
    records: baseRecords(),
    requiredMemoryIds: ["prompt-verification-procedure"],
    acceptableMemoryIds: ["global-terse-preference"],
    forbiddenMemoryIds: ["pending-draft", "rejected-draft", "deleted-draft", "cross-project-memory", "secret-looking-memory", "superseded-progress"],
    requiredText: ["<memory-context mode=\"selective\" event=\"prompt\">", "## Relevant Memory"],
    forbiddenText: ["PENDING MEMORY BODY", "REJECTED MEMORY BODY", "DELETED MEMORY BODY", "CROSS PROJECT MEMORY BODY", "SECRET MEMORY BODY", "SUPERSEDED PROGRESS BODY"],
    expectedDecision: { event: "prompt", mode: "selective" },
    maxContextChars: 1500,
  },
  {
    id: "prompt-broad-next-work-continuity-only",
    benchmark: { ability: "continuity-status", lane: "lifecycle-injection" },
    event: "prompt",
    policy: { mode: "selective" },
    prompt: "What should we work on next?",
    records: baseRecords(),
    requiredText: ["Memory Lane continuity guidance", "memory-lane continuity --json"],
    forbiddenMemoryIds: baseRecords().map((record) => record.id),
    forbiddenText: ["## Relevant Memory", "Lifecycle eval workflow rule", "Current lifecycle injection eval progress", "SUPERSEDED PROGRESS BODY"],
    expectedDecision: { event: "prompt", mode: "selective", continuityIntentFamily: "next-work", omittedReasons: ["broad-continuity-no-recall"] },
    maxContextChars: 1800,
  },
  {
    id: "prompt-policy-only-continuity-no-bodies",
    benchmark: { ability: "lifecycle-injection", lane: "lifecycle-injection" },
    event: "prompt",
    policy: { mode: "policy-only" },
    prompt: "Where are we in the project?",
    records: baseRecords(),
    requiredText: ["<memory-context mode=\"policy-only\" event=\"prompt\">", "Memory Lane continuity guidance", "Use Memory Lane recall/list tools"],
    forbiddenMemoryIds: baseRecords().map((record) => record.id),
    forbiddenText: ["Lifecycle eval workflow rule", "Current lifecycle injection eval progress", "PENDING MEMORY BODY", "CROSS PROJECT MEMORY BODY"],
    expectedDecision: { event: "prompt", mode: "policy-only", continuityIntentFamily: "project-position", omittedReasons: ["policy-only"] },
    maxContextChars: 2200,
  },
  {
    id: "prompt-off-no-context",
    benchmark: { ability: "lifecycle-injection", lane: "lifecycle-injection" },
    event: "prompt",
    policy: { mode: "off" },
    prompt: "How do we run lifecycle eval verification?",
    records: baseRecords(),
    forbiddenMemoryIds: baseRecords().map((record) => record.id),
    forbiddenText: ["<memory-context", "Lifecycle eval workflow rule", "Use Memory Lane recall/list tools"],
    expectedDecision: { event: "prompt", mode: "off", omittedReasons: ["off"] },
    maxContextChars: 0,
  },
  {
    id: "prompt-selective-budget-pressure",
    benchmark: { ability: "lifecycle-injection", lane: "lifecycle-injection" },
    event: "prompt",
    policy: { mode: "selective", maxItems: { sessionStart: 4, prompt: 2 }, maxChars: { sessionStart: 1600, prompt: 760 } },
    prompt: "How do we run lifecycle eval verification?",
    records: [
      ...baseRecords(),
      memory({
        id: "noisy-verification-note",
        kind: "project_fact",
        text: "Noisy lifecycle eval verification note: verification verification verification verification verification verification verification verification verification verification.",
        updatedAt: "2026-07-04T10:31:00.000Z",
      }),
    ],
    requiredMemoryIds: ["prompt-verification-procedure"],
    acceptableMemoryIds: ["current-progress", "project-workflow-rule"],
    forbiddenMemoryIds: ["noisy-verification-note", "pending-draft", "rejected-draft", "deleted-draft", "cross-project-memory", "secret-looking-memory", "superseded-progress"],
    requiredText: ["<memory-context mode=\"selective\" event=\"prompt\">", "## Relevant Memory"],
    forbiddenText: ["Noisy lifecycle eval verification note", "PENDING MEMORY BODY", "REJECTED MEMORY BODY", "DELETED MEMORY BODY", "CROSS PROJECT MEMORY BODY", "SECRET MEMORY BODY", "SUPERSEDED PROGRESS BODY"],
    expectedDecision: { event: "prompt", mode: "selective" },
    maxContextChars: 820,
  },
  {
    id: "prompt-selective-cross-project-noise-filtered",
    benchmark: { ability: "cross-scope-safety", lane: "lifecycle-injection" },
    event: "prompt",
    policy: { mode: "selective", maxItems: { sessionStart: 4, prompt: 4 }, maxChars: { sessionStart: 1600, prompt: 1300 } },
    prompt: "How do we run lifecycle eval verification for this project?",
    records: [
      ...baseRecords(),
      memory({
        id: "other-project-verification",
        scope: { type: "project", key: OTHER_PROJECT_SCOPE_KEY },
        text: "OTHER PROJECT VERIFICATION BODY says the other project runs lifecycle eval verification differently.",
        updatedAt: "2026-07-04T10:59:00.000Z",
      }),
    ],
    requiredMemoryIds: ["prompt-verification-procedure"],
    acceptableMemoryIds: ["project-workflow-rule", "current-progress", "global-terse-preference"],
    forbiddenMemoryIds: ["cross-project-memory", "other-project-verification", "pending-draft", "rejected-draft", "deleted-draft", "secret-looking-memory", "superseded-progress"],
    requiredText: ["## Relevant Memory"],
    forbiddenText: ["OTHER PROJECT VERIFICATION BODY", "CROSS PROJECT MEMORY BODY", "PENDING MEMORY BODY", "REJECTED MEMORY BODY", "DELETED MEMORY BODY", "SECRET MEMORY BODY", "SUPERSEDED PROGRESS BODY"],
    expectedDecision: { event: "prompt", mode: "selective" },
    maxContextChars: 1400,
  },
  {
    id: "prompt-selective-non-approved-and-secret-filtered",
    benchmark: { ability: "privacy-secret-suppression", lane: "lifecycle-injection" },
    event: "prompt",
    policy: { mode: "selective", maxItems: { sessionStart: 4, prompt: 5 }, maxChars: { sessionStart: 1600, prompt: 1600 } },
    prompt: "How do we run lifecycle eval verification without leaking pending or secret records?",
    records: [
      ...baseRecords(),
      memory({
        id: "pending-verification-secret-note",
        status: "pending",
        source: "agent-suggested",
        text: "PENDING VERIFICATION SECRET BODY contains lifecycle eval verification guidance that is not approved.",
        updatedAt: "2026-07-04T11:00:00.000Z",
      }),
      memory({
        id: "approved-secret-verification-note",
        text: "APPROVED SECRET VERIFICATION BODY contains lifecycle eval verification key sk-lifecycleevalsecret1234567890.",
        updatedAt: "2026-07-04T11:01:00.000Z",
      }),
    ],
    requiredMemoryIds: ["prompt-verification-procedure"],
    acceptableMemoryIds: ["project-workflow-rule", "current-progress", "global-terse-preference"],
    forbiddenMemoryIds: ["pending-draft", "pending-verification-secret-note", "rejected-draft", "deleted-draft", "secret-looking-memory", "approved-secret-verification-note", "superseded-progress"],
    requiredText: ["## Relevant Memory"],
    forbiddenText: ["PENDING MEMORY BODY", "PENDING VERIFICATION SECRET BODY", "REJECTED MEMORY BODY", "DELETED MEMORY BODY", "SECRET MEMORY BODY", "APPROVED SECRET VERIFICATION BODY", "SUPERSEDED PROGRESS BODY"],
    expectedDecision: { event: "prompt", mode: "selective" },
    maxContextChars: 1700,
  },
  {
    id: "prompt-selective-superseded-progress-filtered",
    benchmark: { ability: "temporal-currentness", lane: "lifecycle-injection" },
    event: "prompt",
    policy: { mode: "selective", maxItems: { sessionStart: 4, prompt: 5 }, maxChars: { sessionStart: 1600, prompt: 1500 } },
    prompt: "What is the current lifecycle injection eval progress?",
    records: baseRecords(),
    requiredMemoryIds: ["current-progress"],
    acceptableMemoryIds: ["project-workflow-rule", "prompt-verification-procedure", "global-terse-preference"],
    forbiddenMemoryIds: ["superseded-progress", "pending-draft", "rejected-draft", "deleted-draft", "cross-project-memory", "secret-looking-memory"],
    requiredText: ["Current lifecycle injection eval progress"],
    forbiddenText: ["SUPERSEDED PROGRESS BODY", "PENDING MEMORY BODY", "REJECTED MEMORY BODY", "DELETED MEMORY BODY", "CROSS PROJECT MEMORY BODY", "SECRET MEMORY BODY"],
    expectedDecision: { event: "prompt", mode: "selective" },
    maxContextChars: 1600,
  },
  {
    id: "prompt-broad-status-continuity-only",
    benchmark: { ability: "continuity-status", lane: "lifecycle-injection" },
    event: "prompt",
    policy: { mode: "selective" },
    prompt: "Where are we in the project?",
    records: baseRecords(),
    requiredText: ["Memory Lane continuity guidance", "memory-lane continuity --json"],
    forbiddenMemoryIds: baseRecords().map((record) => record.id),
    forbiddenText: ["## Relevant Memory", "Lifecycle eval workflow rule", "Current lifecycle injection eval progress", "SUPERSEDED PROGRESS BODY"],
    expectedDecision: { event: "prompt", mode: "selective", continuityIntentFamily: "project-position", omittedReasons: ["broad-continuity-no-recall"] },
    maxContextChars: 1800,
  },
]

function writeMemoryLog(dir: string, records: MemoryRecord[]): string {
  const memoryPath = path.join(dir, "memory.jsonl")
  fs.writeFileSync(memoryPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
  return memoryPath
}

function createEngine(scenario: InjectionEvalScenario): { engine: MemoryEngine; project: string } {
  const dir = tempDir()
  const project = path.join(dir, "project")
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: PROJECT_SCOPE_KEY }), "utf8")
  const configPath = path.join(dir, "config.json")
  writeConfig(configPath, { memory: { contextPolicy: scenario.policy } } as any)
  const engine = new MemoryEngine({
    memoryPath: writeMemoryLog(dir, scenario.records),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath,
  })
  engine.refreshScope(project)
  return { engine, project }
}

function contextContainsMemory(context: string, memory: MemoryRecord): boolean {
  return context.includes(memory.id) || context.includes(memory.text)
}

function uniqueTags(tags: InjectionFailureTag[]): InjectionFailureTag[] {
  return [...new Set(tags)]
}

function decisionMissingExpected(result: LifecycleResult, scenario: InjectionEvalScenario): boolean {
  const expected = scenario.expectedDecision
  if (!expected) return false
  const decision = result.contextDecision
  if (!decision) return true
  if (expected.event && decision.event !== expected.event) return true
  if (expected.mode && decision.mode !== expected.mode) return true
  if (expected.continuityIntentFamily && decision.continuityIntent?.family !== expected.continuityIntentFamily) return true
  if (expected.omittedReasons?.some((reason) => !decision.omittedReasons.includes(reason))) return true
  return false
}

export async function evaluateScenario(scenario: InjectionEvalScenario): Promise<InjectionScenarioResult> {
  const { engine, project } = createEngine(scenario)
  const lifecycleResult = scenario.event === "sessionStart"
    ? handleSessionStart(engine, { cwd: project })
    : await handleUserPromptSubmit(engine, { cwd: project, prompt: scenario.prompt ?? "" })
  const context = lifecycleResult.additionalContext ?? ""
  const recordsById = new Map(scenario.records.map((record) => [record.id, record]))
  const actualMemoryIds = scenario.records.filter((record) => contextContainsMemory(context, record)).map((record) => record.id)
  const requiredMemoryIds = scenario.requiredMemoryIds ?? []
  const acceptableMemoryIds = scenario.acceptableMemoryIds ?? []
  const forbiddenMemoryIds = scenario.forbiddenMemoryIds ?? []
  const missingRequired = requiredMemoryIds.filter((id) => !actualMemoryIds.includes(id))
  const forbiddenInjected = forbiddenMemoryIds.filter((id) => actualMemoryIds.includes(id))
  const requiredText = scenario.requiredText ?? []
  const forbiddenText = scenario.forbiddenText ?? []
  const requiredTextMissing = requiredText.filter((text) => !context.includes(text))
  const forbiddenTextPresent = forbiddenText.filter((text) => context.includes(text))
  const contextChars = context.length
  const budgetOverrun = scenario.maxContextChars !== undefined ? Math.max(0, contextChars - scenario.maxContextChars) : 0
  const failureTags: InjectionFailureTag[] = []

  if (missingRequired.length || requiredTextMissing.length) failureTags.push("missing-required")
  if (forbiddenInjected.length || forbiddenTextPresent.length) failureTags.push("forbidden-injected")
  if (forbiddenInjected.some((id) => recordsById.get(id)?.scope.type === "project" && recordsById.get(id)?.scope.key !== PROJECT_SCOPE_KEY)) failureTags.push("cross-project-leak")
  if (forbiddenInjected.some((id) => ["pending", "rejected", "deleted"].includes(recordsById.get(id)?.status ?? ""))) failureTags.push("non-approved-leak")
  if (forbiddenInjected.some((id) => id === "secret-looking-memory") || forbiddenTextPresent.some((text) => text.includes("SECRET"))) failureTags.push("secret-leak")
  if (scenario.policy.mode === "policy-only" && (actualMemoryIds.length > 0 || forbiddenTextPresent.length > 0)) failureTags.push("policy-only-body-leak")
  if (budgetOverrun > 0) failureTags.push("budget-overrun")
  if (decisionMissingExpected(lifecycleResult, scenario)) failureTags.push("wrong-route")
  if (scenario.event === "prompt" && scenario.expectedDecision?.continuityIntentFamily && actualMemoryIds.length > 0 && scenario.id.includes("broad")) failureTags.push("noisy-context")
  if (forbiddenInjected.includes("superseded-progress") || forbiddenTextPresent.some((text) => text.includes("SUPERSEDED"))) failureTags.push("superseded-progress")

  const tags = uniqueTags(failureTags)
  return {
    id: scenario.id,
    event: scenario.event,
    policyMode: scenario.policy.mode ?? "selective",
    passed: tags.length === 0,
    actualMemoryIds,
    requiredMemoryIds,
    acceptableMemoryIds,
    forbiddenMemoryIds,
    missingRequired,
    forbiddenInjected,
    requiredTextMissing,
    forbiddenTextPresent,
    requiredTextTotal: requiredText.length,
    forbiddenTextTotal: forbiddenText.length,
    contextChars,
    ...(scenario.maxContextChars !== undefined ? { maxContextChars: scenario.maxContextChars } : {}),
    failureTags: tags,
    contextDecision: lifecycleResult.contextDecision,
    benchmark: scenario.benchmark,
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator
}


export function summarizeResults(results: InjectionScenarioResult[]): InjectionEvalReport["summary"] {
  const requiredTotal = results.reduce((sum, result) => sum + result.requiredMemoryIds.length + result.requiredTextTotal, 0)
  const requiredFound = results.reduce((sum, result) => sum + result.requiredMemoryIds.length - result.missingRequired.length + result.requiredTextTotal - result.requiredTextMissing.length, 0)
  const forbiddenTotal = results.reduce((sum, result) => sum + result.forbiddenMemoryIds.length + result.forbiddenTextTotal, 0)
  const forbiddenLeaked = results.reduce((sum, result) => sum + result.forbiddenInjected.length + result.forbiddenTextPresent.length, 0)
  const gateSummary = summarizeEvalGate(results, ZERO_TOLERANCE_FAILURE_TAGS)
  const meanRequiredRecall = ratio(requiredFound, requiredTotal)
  const meanForbiddenLeakRate = ratio(forbiddenLeaked, forbiddenTotal)
  const maxContextBudgetOverrun = Math.max(0, ...results.map((result) => result.maxContextChars === undefined ? 0 : result.contextChars - result.maxContextChars))
  const satisfactory = gateSummary.satisfactory
    && meanRequiredRecall === 1
    && meanForbiddenLeakRate === 0
    && maxContextBudgetOverrun === 0
  return {
    scenarioCount: gateSummary.scenarioCount,
    passCount: gateSummary.passCount,
    failCount: gateSummary.failCount,
    zeroToleranceFailures: gateSummary.zeroToleranceFailures,
    meanRequiredRecall,
    meanForbiddenLeakRate,
    maxContextBudgetOverrun,
    failureTagCounts: gateSummary.failureTagCounts,
    satisfactory,
  }
}

export async function buildInjectionEvalReport(scenarios: InjectionEvalScenario[] = corpus): Promise<InjectionEvalReport> {
  const scenarioResults = []
  for (const scenario of scenarios) scenarioResults.push(await evaluateScenario(scenario))
  return {
    generatedAt: GENERATED_AT,
    corpusId: CORPUS_ID,
    mode: "local-fixtures",
    scenarioResults,
    summary: summarizeResults(scenarioResults),
  }
}

export function reportIsSatisfactory(report: InjectionEvalReport): boolean {
  return isGateSatisfactory(report.summary)
    && report.summary.meanRequiredRecall === 1
    && report.summary.meanForbiddenLeakRate === 0
    && report.summary.maxContextBudgetOverrun === 0
}
