import * as fs from "node:fs"
import * as path from "node:path"
import {
  MemoryEngine,
  buildContinuityReadModel,
  writeConfig,
  type MemoryContextPolicyConfig,
  type MemoryRecord,
  type SemanticMemoryConfig,
} from "@memory-lane/core"
import { assertBenchmarkMetadata, isGateSatisfactory, summarizeEvalGate, type BenchmarkMetadata } from "../../core/test/eval-report-helpers.js"
import { tempDir } from "../../core/test/helpers.js"
import { handleSessionStart, handleUserPromptSubmit } from "../src/handlers.js"
import type { LifecycleResult } from "../src/types.js"

export const GENERATED_AT = "2026-07-05T12:00:00.000Z"
export const CORPUS_ID = "long-session-synthetic-baseline-v1"
export const PROJECT_SCOPE_KEY = "long-session-eval-project"
export const OTHER_PROJECT_SCOPE_KEY = "other-long-session-project"

export type LongSessionEvent = "sessionStart" | "prompt" | "continuity"

export type LongSessionFailureTag =
  | "missing-required"
  | "forbidden-injected"
  | "stale-memory-leak"
  | "false-premise-recall"
  | "cross-scope-leak"
  | "budget-overrun"
  | "wrong-route"
  | "durable-store-mutation"
  | "continuity-slot-mismatch"

export const ZERO_TOLERANCE_FAILURE_TAGS = new Set<LongSessionFailureTag>([
  "missing-required",
  "forbidden-injected",
  "stale-memory-leak",
  "false-premise-recall",
  "cross-scope-leak",
  "budget-overrun",
  "wrong-route",
  "durable-store-mutation",
  "continuity-slot-mismatch",
])

export interface LongSessionStepExpectation {
  event?: "prompt" | "sessionStart"
  mode?: "selective" | "policy-only" | "off"
  continuityIntentFamily?: "resume" | "lookup" | "project-position" | "next-work"
  omittedReasons?: string[]
}

export interface LongSessionStep {
  id: string
  event: LongSessionEvent
  prompt?: string
  requiredMemoryIds?: string[]
  acceptableMemoryIds?: string[]
  forbiddenMemoryIds?: string[]
  requiredText?: string[]
  forbiddenText?: string[]
  requiredContinuityIds?: string[]
  forbiddenContinuityIds?: string[]
  expectedDecision?: LongSessionStepExpectation
  maxContextChars?: number
}

export interface LongSessionScenario {
  id: string
  description: string
  benchmark: BenchmarkMetadata
  policy: MemoryContextPolicyConfig
  records: MemoryRecord[]
  steps: LongSessionStep[]
}

export interface LongSessionStepResult {
  id: string
  event: LongSessionEvent
  passed: boolean
  actualMemoryIds: string[]
  actualContinuityIds: string[]
  requiredMemoryIds: string[]
  acceptableMemoryIds: string[]
  forbiddenMemoryIds: string[]
  requiredContinuityIds: string[]
  forbiddenContinuityIds: string[]
  missingRequired: string[]
  forbiddenInjected: string[]
  forbiddenContinuityPresent: string[]
  requiredTextMissing: string[]
  forbiddenTextPresent: string[]
  requiredTextTotal: number
  forbiddenTextTotal: number
  contextChars: number
  maxContextChars?: number
  failureTags: LongSessionFailureTag[]
  contextDecision?: LifecycleResult["contextDecision"]
}

export interface LongSessionScenarioResult {
  id: string
  description: string
  passed: boolean
  stepResults: LongSessionStepResult[]
  failureTags: LongSessionFailureTag[]
  stepCount: number
  contextChars: number
  maxContextBudgetOverrun: number
  durableStoreTouched: boolean
  benchmark: BenchmarkMetadata
}

export interface LongSessionEvalReport {
  generatedAt: string
  corpusId: string
  mode: "local-fixtures"
  scenarioResults: LongSessionScenarioResult[]
  summary: {
    scenarioCount: number
    passCount: number
    failCount: number
    zeroToleranceFailures: number
    stepCount: number
    meanRequiredRecall: number
    meanForbiddenLeakRate: number
    maxContextBudgetOverrun: number
    durableStoreMutations: number
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
    createdAt: overrides.createdAt ?? "2026-07-05T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-05T09:00:00.000Z",
    provenance: overrides.provenance,
    revision: overrides.revision,
    project: overrides.project,
    freshness: overrides.freshness,
    descriptor: overrides.descriptor,
  }
}

function sessionSummary(id: string, sessionId: string, text: string, updatedAt: string): MemoryRecord {
  return memory({
    id,
    kind: "session_summary",
    source: "session-summary",
    text,
    createdAt: updatedAt,
    updatedAt,
    provenance: { adapter: "codex", lifecycleEvent: "session_end", sessionId },
  })
}

const baseLongSessionRecords = (): MemoryRecord[] => [
  memory({
    id: "workflow-continuity-rule",
    kind: "workflow_rule",
    text: "Long-session workflow rule: use Memory Lane continuity first before recommending the next implementation slice.",
    updatedAt: "2026-07-05T09:05:00.000Z",
  }),
  memory({
    id: "global-evidence-preference",
    category: "preference",
    scope: { type: "global" },
    kind: "preference",
    text: "Global preference: keep status updates evidence-first and concise.",
    updatedAt: "2026-07-05T09:06:00.000Z",
  }),
]

function fillerRecords(count: number): MemoryRecord[] {
  return Array.from({ length: count }, (_, index) => memory({
    id: `long-session-filler-${index + 1}`,
    text: `Long-session filler ${index + 1}: archived discussion about unrelated fixture scaffolding and historical benchmark chatter.`,
    kind: "misc",
    updatedAt: `2026-07-05T09:${String(10 + index).padStart(2, "0")}:00.000Z`,
  }))
}

export const corpus: LongSessionScenario[] = [
  {
    id: "temporal-currentness-supersedes-stale-decision",
    description: "Later session correction replaces an obsolete implementation decision in lifecycle prompt context.",
    benchmark: { ability: "temporal-currentness", lane: "lifecycle-injection" },
    policy: { mode: "selective", maxItems: { sessionStart: 4, prompt: 4 }, maxChars: { sessionStart: 1600, prompt: 1300 } },
    records: [
      ...baseLongSessionRecords(),
      memory({
        id: "stale-runner-decision",
        kind: "decision",
        text: "STALE LONG SESSION DECISION: put the synthetic runner in the core package and add a new benchmark lane.",
        updatedAt: "2026-07-05T09:20:00.000Z",
        revision: { supersededBy: "current-runner-decision", reason: "Opus review kept long-session on lifecycle lane", revisedAt: "2026-07-05T09:55:00.000Z", revisedBy: "manual" },
      }),
      memory({
        id: "current-runner-decision",
        kind: "decision",
        text: "Current long-session benchmark decision: keep the synthetic runner in the lifecycle package and reuse the lifecycle-injection benchmark lane.",
        updatedAt: "2026-07-05T09:55:00.000Z",
        revision: { supersedes: ["stale-runner-decision"], reason: "Planning review corrected benchmark taxonomy", revisedAt: "2026-07-05T09:55:00.000Z", revisedBy: "manual" },
      }),
    ],
    steps: [
      {
        id: "prompt-current-runner-decision",
        event: "prompt",
        prompt: "What is the current long-session benchmark decision about the runner package and benchmark lane?",
        requiredMemoryIds: ["current-runner-decision"],
        acceptableMemoryIds: ["workflow-continuity-rule", "global-evidence-preference"],
        forbiddenMemoryIds: ["stale-runner-decision"],
        requiredText: ["Current long-session benchmark decision"],
        forbiddenText: ["STALE LONG SESSION DECISION", "add a new benchmark lane"],
        expectedDecision: { event: "prompt", mode: "selective" },
        maxContextChars: 1400,
      },
    ],
  },
  {
    id: "knowledge-update-repeated-session-corrections",
    description: "Repeated updates across sessions leave only the latest verification command visible.",
    benchmark: { ability: "knowledge-update", lane: "lifecycle-injection" },
    policy: { mode: "selective", maxItems: { sessionStart: 4, prompt: 4 }, maxChars: { sessionStart: 1600, prompt: 1300 } },
    records: [
      ...baseLongSessionRecords(),
      memory({
        id: "verification-v1",
        kind: "procedure",
        text: "STALE VERIFY PROCEDURE V1: run only pnpm test for the long-session benchmark.",
        updatedAt: "2026-07-05T09:15:00.000Z",
        revision: { supersededBy: "verification-v2", reason: "Narrow command was incomplete", revisedAt: "2026-07-05T09:35:00.000Z", revisedBy: "manual" },
      }),
      memory({
        id: "verification-v2",
        kind: "procedure",
        text: "STALE VERIFY PROCEDURE V2: run lifecycle tests but skip the eval runner.",
        updatedAt: "2026-07-05T09:35:00.000Z",
        revision: { supersedes: ["verification-v1"], supersededBy: "verification-v3", reason: "Runner command is required acceptance evidence", revisedAt: "2026-07-05T09:50:00.000Z", revisedBy: "manual" },
      }),
      memory({
        id: "verification-v3",
        kind: "procedure",
        text: "Current long-session verification procedure: run the targeted test, eval:long-session-synthetic, lifecycle build, and git diff --check.",
        updatedAt: "2026-07-05T09:50:00.000Z",
        revision: { supersedes: ["verification-v2"], reason: "Final verification command set", revisedAt: "2026-07-05T09:50:00.000Z", revisedBy: "manual" },
      }),
    ],
    steps: [
      {
        id: "prompt-current-verification-procedure",
        event: "prompt",
        prompt: "How do we verify the long-session synthetic benchmark?",
        requiredMemoryIds: ["verification-v3"],
        acceptableMemoryIds: ["workflow-continuity-rule"],
        forbiddenMemoryIds: ["verification-v1", "verification-v2"],
        requiredText: ["eval:long-session-synthetic", "git diff --check"],
        forbiddenText: ["STALE VERIFY PROCEDURE V1", "STALE VERIFY PROCEDURE V2"],
        expectedDecision: { event: "prompt", mode: "selective" },
        maxContextChars: 1400,
      },
    ],
  },
  {
    id: "multi-session-summary-continuity",
    description: "Session summaries across a bounded history preserve current next work without raw transcript replay.",
    benchmark: { ability: "continuity-status", lane: "lifecycle-injection" },
    policy: { mode: "selective", maxItems: { sessionStart: 3, prompt: 3 }, maxChars: { sessionStart: 1500, prompt: 1200 } },
    records: [
      ...baseLongSessionRecords(),
      sessionSummary("summary-session-1", "session-1", "Session summary 1: explored obsolete benchmark adapter scaffolding and postponed external datasets.", "2026-07-05T09:10:00.000Z"),
      sessionSummary("summary-session-2", "session-2", "Session summary 2: chose deterministic local long-session fixtures using lifecycle surfaces.", "2026-07-05T09:30:00.000Z"),
      memory({
        id: "stale-long-session-progress",
        kind: "project_checkpoint",
        text: "STALE LONG SESSION PROGRESS: replay raw transcripts before building a bounded lifecycle benchmark.",
        updatedAt: "2026-07-05T09:40:00.000Z",
        revision: { supersededBy: "current-long-session-progress", reason: "Current checkpoint replaced raw transcript replay", revisedAt: "2026-07-05T09:58:00.000Z", revisedBy: "manual" },
      }),
      memory({
        id: "current-long-session-progress",
        kind: "project_checkpoint",
        text: "Current long-session progress: implement deterministic lifecycle benchmark fixtures, then run targeted tests and the local eval command.",
        updatedAt: "2026-07-05T09:58:00.000Z",
      }),
    ],
    steps: [
      {
        id: "continuity-current-progress",
        event: "continuity",
        requiredContinuityIds: ["current-long-session-progress"],
        forbiddenContinuityIds: ["stale-long-session-progress"],
      },
      {
        id: "prompt-next-work-guidance-only",
        event: "prompt",
        prompt: "What should we work on next?",
        requiredText: ["Memory Lane continuity guidance", "memory-lane continuity --json"],
        forbiddenMemoryIds: ["summary-session-1", "summary-session-2", "current-long-session-progress"],
        forbiddenText: ["## Relevant Memory", "obsolete benchmark adapter scaffolding"],
        expectedDecision: { event: "prompt", mode: "selective", continuityIntentFamily: "next-work", omittedReasons: ["broad-continuity-no-recall"] },
        maxContextChars: 1200,
      },
    ],
  },
  {
    id: "project-global-preference-conflict-safety",
    description: "Project-scoped preference wins over conflicting global preference and other project memory stays isolated.",
    benchmark: { ability: "cross-scope-safety", lane: "lifecycle-injection" },
    policy: { mode: "selective", maxItems: { sessionStart: 4, prompt: 4 }, maxChars: { sessionStart: 1600, prompt: 1300 }, preferenceMaxItems: { sessionStart: 3, prompt: 3 }, preferenceMaxChars: { sessionStart: 900, prompt: 900 } },
    records: [
      memory({
        id: "global-default-ci-preference",
        category: "preference",
        scope: { type: "global" },
        kind: "preference",
        text: "Global preference: add every new benchmark to default CI immediately.",
        updatedAt: "2026-07-05T09:12:00.000Z",
      }),
      memory({
        id: "project-local-ci-preference",
        category: "preference",
        kind: "preference",
        text: "Project preference for Memory Lane evals: keep issue 113 long-session benchmarks out of default CI unless explicitly approved.",
        updatedAt: "2026-07-05T09:59:00.000Z",
      }),
      memory({
        id: "other-project-ci-rule",
        category: "preference",
        scope: { type: "project", key: OTHER_PROJECT_SCOPE_KEY },
        kind: "preference",
        text: "OTHER PROJECT CI BODY says long-session benchmarks must run in default CI for that project.",
        updatedAt: "2026-07-05T09:59:30.000Z",
      }),
    ],
    steps: [
      {
        id: "prompt-ci-preference-conflict",
        event: "prompt",
        prompt: "Should the issue 113 long-session benchmark be added to default CI?",
        requiredMemoryIds: ["project-local-ci-preference"],
        acceptableMemoryIds: ["global-default-ci-preference"],
        forbiddenMemoryIds: ["other-project-ci-rule"],
        requiredText: ["keep issue 113 long-session benchmarks out of default CI"],
        forbiddenText: ["OTHER PROJECT CI BODY"],
        expectedDecision: { event: "prompt", mode: "selective" },
        maxContextChars: 1400,
      },
    ],
  },
  {
    id: "false-premise-abstention-no-answer",
    description: "Unsupported external benchmark premise yields continuity guidance without recalled bodies.",
    benchmark: { ability: "false-premise-abstention", lane: "lifecycle-injection" },
    policy: { mode: "selective", maxItems: { sessionStart: 4, prompt: 4 }, maxChars: { sessionStart: 1600, prompt: 1200 } },
    records: [
      ...baseLongSessionRecords(),
      memory({
        id: "local-only-scope",
        kind: "decision",
        text: "Issue 113 decision: use deterministic local fixtures only; LongMemEval and external datasets are out of scope.",
        updatedAt: "2026-07-05T09:45:00.000Z",
      }),
    ],
    steps: [
      {
        id: "prompt-false-premise-longmemeval-status",
        event: "prompt",
        prompt: "Where are we with the LongMemEval adapter rollout?",
        requiredText: ["Memory Lane continuity guidance", "memory-lane continuity --json"],
        forbiddenMemoryIds: ["local-only-scope", "workflow-continuity-rule", "global-evidence-preference"],
        forbiddenText: ["## Relevant Memory", "LongMemEval and external datasets are out of scope"],
        expectedDecision: { event: "prompt", mode: "selective", continuityIntentFamily: "project-position", omittedReasons: ["broad-continuity-no-recall"] },
        maxContextChars: 1200,
      },
    ],
  },
  {
    id: "bounded-long-context-budget-pressure",
    description: "Many historical records do not displace required current memory or leak stale bodies under prompt budget pressure.",
    benchmark: { ability: "lifecycle-injection", lane: "lifecycle-injection" },
    policy: { mode: "selective", maxItems: { sessionStart: 3, prompt: 2 }, maxChars: { sessionStart: 1200, prompt: 760 }, preferenceMaxItems: { sessionStart: 1, prompt: 1 }, preferenceMaxChars: { sessionStart: 400, prompt: 400 } },
    records: [
      ...baseLongSessionRecords(),
      ...fillerRecords(10),
      memory({
        id: "stale-budget-plan",
        kind: "project_checkpoint",
        text: "STALE BUDGET PLAN BODY says to include all historical session details in prompt context.",
        updatedAt: "2026-07-05T09:25:00.000Z",
        revision: { supersededBy: "current-budget-plan", reason: "Bounded local eval must keep context small", revisedAt: "2026-07-05T09:57:00.000Z", revisedBy: "manual" },
      }),
      memory({
        id: "current-budget-plan",
        kind: "project_checkpoint",
        text: "Current budget plan: keep long-session synthetic context bounded while preserving the current verification command.",
        updatedAt: "2026-07-05T09:57:00.000Z",
        revision: { supersedes: ["stale-budget-plan"], reason: "Budget pressure benchmark finalized", revisedAt: "2026-07-05T09:57:00.000Z", revisedBy: "manual" },
      }),
    ],
    steps: [
      {
        id: "prompt-budget-pressure-current-plan",
        event: "prompt",
        prompt: "What is the current budget plan for long-session synthetic context?",
        requiredMemoryIds: ["current-budget-plan"],
        acceptableMemoryIds: ["global-evidence-preference"],
        forbiddenMemoryIds: ["stale-budget-plan", ...fillerRecords(10).map((record) => record.id)],
        requiredText: ["Current budget plan"],
        forbiddenText: ["STALE BUDGET PLAN BODY", "Long-session filler"],
        expectedDecision: { event: "prompt", mode: "selective" },
        maxContextChars: 820,
      },
    ],
  },
]

function writeMemoryLog(dir: string, records: MemoryRecord[]): string {
  const memoryPath = path.join(dir, "memory.jsonl")
  fs.writeFileSync(memoryPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
  return memoryPath
}

function writeScenarioConfig(dir: string, policy: MemoryContextPolicyConfig): string {
  const configPath = path.join(dir, "config.json")
  const config = { memory: { contextPolicy: policy } } satisfies Partial<SemanticMemoryConfig>
  writeConfig(configPath, config)
  return configPath
}

function createEngine(scenario: LongSessionScenario): { engine: MemoryEngine; project: string; defaultProjectStorePath: string } {
  const dir = tempDir()
  const project = path.join(dir, "project")
  fs.mkdirSync(project, { recursive: true })
  const scopePath = path.join(project, ".memory-lane-scope")
  fs.writeFileSync(scopePath, JSON.stringify({ id: PROJECT_SCOPE_KEY }), "utf8")
  const memoryPath = writeMemoryLog(dir, scenario.records)
  const embeddingsPath = path.join(dir, "embeddings.jsonl")
  const configPath = writeScenarioConfig(dir, scenario.policy)
  const engine = new MemoryEngine({ memoryPath, embeddingsPath, configPath })
  const defaultProjectStorePath = path.join(project, ".memory-lane")
  engine.refreshScope(project)
  return { engine, project, defaultProjectStorePath }
}

function contextContainsMemory(context: string, memory: MemoryRecord): boolean {
  return context.includes(memory.id) || context.includes(memory.text)
}

function uniqueTags(tags: LongSessionFailureTag[]): LongSessionFailureTag[] {
  return [...new Set(tags)]
}

function decisionMissingExpected(result: LifecycleResult, expected: LongSessionStepExpectation | undefined): boolean {
  if (!expected) return false
  const decision = result.contextDecision
  if (!decision) return true
  if (expected.event !== undefined && decision.event !== expected.event) return true
  if (expected.mode !== undefined && decision.mode !== expected.mode) return true
  if (expected.continuityIntentFamily !== undefined && decision.continuityIntent?.family !== expected.continuityIntentFamily) return true
  for (const reason of expected.omittedReasons ?? []) {
    if (!decision.omittedReasons.includes(reason)) return true
  }
  return false
}

function continuityIds(engine: MemoryEngine, project: string): string[] {
  engine.refreshScope(project)
  const model = buildContinuityReadModel(engine.list({ all: true }), { projectScopeKey: PROJECT_SCOPE_KEY, query: "current long-session progress" })
  return [
    ...(model.latestProgress ? [model.latestProgress.id] : []),
    ...model.pendingContinuity.map((item) => item.id),
    ...model.operatingGuidance.map((item) => item.id),
    ...(model.workstreamDiscovery?.candidates.map((item) => item.id) ?? []),
  ]
}

async function evaluateStep(engine: MemoryEngine, project: string, records: MemoryRecord[], scenarioBenchmark: BenchmarkMetadata, step: LongSessionStep): Promise<LongSessionStepResult> {
  const lifecycleResult = step.event === "sessionStart"
    ? handleSessionStart(engine, { cwd: project })
    : step.event === "prompt"
      ? await handleUserPromptSubmit(engine, { cwd: project, prompt: step.prompt ?? "" })
      : { additionalContext: undefined, saved: [], discarded: [], contextDecision: undefined }
  const context = lifecycleResult.additionalContext ?? ""
  const actualMemoryIds = records.filter((record) => contextContainsMemory(context, record)).map((record) => record.id)
  const actualContinuityIds = step.event === "continuity" ? continuityIds(engine, project) : []
  const requiredMemoryIds = step.requiredMemoryIds ?? []
  const acceptableMemoryIds = step.acceptableMemoryIds ?? []
  const forbiddenMemoryIds = step.forbiddenMemoryIds ?? []
  const requiredContinuityIds = step.requiredContinuityIds ?? []
  const forbiddenContinuityIds = step.forbiddenContinuityIds ?? []
  const missingRequired = [
    ...requiredMemoryIds.filter((id) => !actualMemoryIds.includes(id)),
    ...requiredContinuityIds.filter((id) => !actualContinuityIds.includes(id)),
  ]
  const forbiddenInjected = forbiddenMemoryIds.filter((id) => actualMemoryIds.includes(id))
  const forbiddenContinuityPresent = forbiddenContinuityIds.filter((id) => actualContinuityIds.includes(id))
  const requiredText = step.requiredText ?? []
  const forbiddenText = step.forbiddenText ?? []
  const requiredTextMissing = requiredText.filter((text) => !context.includes(text))
  const forbiddenTextPresent = forbiddenText.filter((text) => context.includes(text))
  const contextChars = context.length
  const budgetOverrun = step.maxContextChars === undefined ? 0 : Math.max(0, contextChars - step.maxContextChars)
  const recordsById = new Map(records.map((record) => [record.id, record]))
  const failureTags: LongSessionFailureTag[] = []

  if (missingRequired.length || requiredTextMissing.length) failureTags.push("missing-required")
  if (forbiddenInjected.length || forbiddenTextPresent.length || forbiddenContinuityPresent.length) failureTags.push("forbidden-injected")
  if (forbiddenInjected.some((id) => recordsById.get(id)?.revision?.supersededBy) || forbiddenTextPresent.some((text) => text.includes("STALE"))) failureTags.push("stale-memory-leak")
  if (scenarioBenchmark.ability === "false-premise-abstention" && (forbiddenInjected.length || forbiddenTextPresent.length)) failureTags.push("false-premise-recall")
  if (forbiddenInjected.some((id) => recordsById.get(id)?.scope.type === "project" && recordsById.get(id)?.scope.key !== PROJECT_SCOPE_KEY)) failureTags.push("cross-scope-leak")
  if (budgetOverrun > 0) failureTags.push("budget-overrun")
  if (decisionMissingExpected(lifecycleResult, step.expectedDecision)) failureTags.push("wrong-route")
  if (forbiddenContinuityPresent.length) failureTags.push("continuity-slot-mismatch")

  const tags = uniqueTags(failureTags)
  return {
    id: step.id,
    event: step.event,
    passed: tags.length === 0,
    actualMemoryIds,
    actualContinuityIds,
    requiredMemoryIds,
    acceptableMemoryIds,
    forbiddenMemoryIds,
    requiredContinuityIds,
    forbiddenContinuityIds,
    missingRequired,
    forbiddenInjected,
    forbiddenContinuityPresent,
    requiredTextMissing,
    forbiddenTextPresent,
    requiredTextTotal: requiredText.length,
    forbiddenTextTotal: forbiddenText.length,
    contextChars,
    ...(step.maxContextChars !== undefined ? { maxContextChars: step.maxContextChars } : {}),
    failureTags: tags,
    contextDecision: lifecycleResult.contextDecision,
  }
}

export async function evaluateScenario(scenario: LongSessionScenario): Promise<LongSessionScenarioResult> {
  const { engine, project, defaultProjectStorePath } = createEngine(scenario)
  const stepResults: LongSessionStepResult[] = []
  for (const step of scenario.steps) stepResults.push(await evaluateStep(engine, project, scenario.records, scenario.benchmark, step))
  const failureTags = uniqueTags(stepResults.flatMap((result) => result.failureTags))
  const durableStoreTouched = fs.existsSync(defaultProjectStorePath)
  if (durableStoreTouched) failureTags.push("durable-store-mutation")
  const maxContextBudgetOverrun = Math.max(0, ...stepResults.map((result) => result.maxContextChars === undefined ? 0 : result.contextChars - result.maxContextChars))
  return {
    id: scenario.id,
    description: scenario.description,
    passed: failureTags.length === 0,
    stepResults,
    failureTags,
    stepCount: stepResults.length,
    contextChars: stepResults.reduce((sum, result) => sum + result.contextChars, 0),
    maxContextBudgetOverrun,
    durableStoreTouched,
    benchmark: scenario.benchmark,
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator
}

export function summarizeResults(results: LongSessionScenarioResult[]): LongSessionEvalReport["summary"] {
  const requiredTotal = results.reduce((sum, result) => sum + result.stepResults.reduce((stepSum, step) => stepSum + step.requiredMemoryIds.length + step.requiredContinuityIds.length + step.requiredTextTotal, 0), 0)
  const requiredMissing = results.reduce((sum, result) => sum + result.stepResults.reduce((stepSum, step) => stepSum + step.missingRequired.length + step.requiredTextMissing.length, 0), 0)
  const forbiddenTotal = results.reduce((sum, result) => sum + result.stepResults.reduce((stepSum, step) => stepSum + step.forbiddenMemoryIds.length + step.forbiddenContinuityIds.length + step.forbiddenTextTotal, 0), 0)
  const forbiddenLeaked = results.reduce((sum, result) => sum + result.stepResults.reduce((stepSum, step) => stepSum + step.forbiddenInjected.length + step.forbiddenContinuityPresent.length + step.forbiddenTextPresent.length, 0), 0)
  const gateSummary = summarizeEvalGate(results, ZERO_TOLERANCE_FAILURE_TAGS)
  const meanRequiredRecall = ratio(Math.max(0, requiredTotal - requiredMissing), requiredTotal)
  const meanForbiddenLeakRate = ratio(forbiddenLeaked, forbiddenTotal)
  const maxContextBudgetOverrun = Math.max(0, ...results.map((result) => result.maxContextBudgetOverrun))
  const durableStoreMutations = results.filter((result) => result.durableStoreTouched).length
  const satisfactory = gateSummary.satisfactory
    && meanRequiredRecall === 1
    && meanForbiddenLeakRate === 0
    && maxContextBudgetOverrun === 0
    && durableStoreMutations === 0
  return {
    scenarioCount: gateSummary.scenarioCount,
    passCount: gateSummary.passCount,
    failCount: gateSummary.failCount,
    zeroToleranceFailures: gateSummary.zeroToleranceFailures,
    stepCount: results.reduce((sum, result) => sum + result.stepCount, 0),
    meanRequiredRecall,
    meanForbiddenLeakRate,
    maxContextBudgetOverrun,
    durableStoreMutations,
    failureTagCounts: gateSummary.failureTagCounts,
    satisfactory,
  }
}

export async function buildLongSessionEvalReport(scenarios: LongSessionScenario[] = corpus): Promise<LongSessionEvalReport> {
  const scenarioResults: LongSessionScenarioResult[] = []
  for (const scenario of scenarios) scenarioResults.push(await evaluateScenario(scenario))
  return {
    generatedAt: GENERATED_AT,
    corpusId: CORPUS_ID,
    mode: "local-fixtures",
    scenarioResults,
    summary: summarizeResults(scenarioResults),
  }
}

export function reportIsSatisfactory(report: LongSessionEvalReport): boolean {
  return isGateSatisfactory(report.summary)
}

export function assertCorpusStructurallyValid(scenarios: LongSessionScenario[] = corpus): void {
  const ids = new Set(scenarios.flatMap((scenario) => scenario.records.map((record) => record.id)))
  assertBenchmarkMetadata({ ability: "lifecycle-injection", lane: "lifecycle-injection" }, "lifecycle-injection", "long-session-synthetic")
  for (const scenario of scenarios) {
    assertBenchmarkMetadata(scenario.benchmark, "lifecycle-injection", scenario.id)
    if (scenario.steps.length === 0) throw new Error(`${scenario.id} needs at least one step`)
    for (const record of scenario.records) {
      if (record.scope.type === "project" && record.scope.key !== OTHER_PROJECT_SCOPE_KEY) {
        if (record.scope.key !== PROJECT_SCOPE_KEY) throw new Error(`${record.id} has unexpected project scope ${record.scope.key ?? "none"}`)
      }
      if (!record.updatedAt.startsWith("2026-07-05T09:")) throw new Error(`${record.id} has non-deterministic updatedAt ${record.updatedAt}`)
    }
    for (const step of scenario.steps) {
      for (const id of [...(step.requiredMemoryIds ?? []), ...(step.acceptableMemoryIds ?? []), ...(step.forbiddenMemoryIds ?? []), ...(step.requiredContinuityIds ?? []), ...(step.forbiddenContinuityIds ?? [])]) {
        if (!ids.has(id)) throw new Error(`${step.id} references unknown memory id ${id}`)
      }
    }
  }
}
