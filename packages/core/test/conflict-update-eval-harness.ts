import assert from "node:assert/strict"
import { containsLikelySecret } from "../src/secret-detection.js"
import { retrieveSemanticMemories } from "../src/retrieval.js"
import type { MemoryRecord, SemanticMemoryConfig } from "../src/types.js"

export const GENERATED_AT = "2026-07-04T13:00:00.000Z"
export const CORPUS_ID = "conflict-update-microbench-v1"
export const MODE = "default-no-embedding"
export const PROJECT_SCOPE_KEY = "eval/project"

const BASE_SEMANTIC_CONFIG: SemanticMemoryConfig["semantic"] = {
  enabled: false,
  activeEmbeddingProfile: "local-example",
  embeddings: { profiles: {} },
  retrieval: { topK: 2, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
  privacy: { allowRemoteEmbeddings: false },
}

export type ConflictScenarioKind = "current-beats-superseded" | "false-premise-refutation"
export type ConflictFailureTag = "current-fact-not-first" | "superseded-returned" | "missing-required" | "forbidden-returned" | "stale-over-current" | "topic-mismatch"
export type RelevanceLabel = "required" | "acceptable" | "distractor" | "forbidden"

export const ZERO_TOLERANCE_FAILURE_TAGS: Record<ConflictFailureTag, true | undefined> = {
  "current-fact-not-first": true,
  "superseded-returned": true,
  "missing-required": true,
  "forbidden-returned": true,
  "stale-over-current": true,
  "topic-mismatch": undefined,
}

export interface ConflictUpdateScenario {
  id: string
  kind: ConflictScenarioKind
  lane: "recall"
  query: string
  k: number
  labels: Record<string, RelevanceLabel>
  expectedFirstId: string
  forbiddenIds: string[]
}

export interface ConflictUpdateScenarioResult {
  id: string
  kind: ConflictScenarioKind
  lane: "recall"
  query: string
  k: number
  actualIds: string[]
  recallAtK: number
  precisionAtK: number
  passed: boolean
  expectedFirstId: string
  returnedForbiddenIds: string[]
  failureTags: ConflictFailureTag[]
}

export interface ConflictUpdateReport {
  generatedAt: string
  corpusId: string
  mode: typeof MODE
  scenarioResults: ConflictUpdateScenarioResult[]
  summary: {
    scenarioCount: number
    passCount: number
    failCount: number
    zeroToleranceFailures: number
    currentFactFirstRate: number
    falsePremiseSafetyRate: number
    failureTagCounts: Record<string, number>
  }
}

export function evalMemory(overrides: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
  return {
    id: overrides.id,
    text: overrides.text,
    category: overrides.category ?? "project",
    scope: overrides.scope ?? { type: "project", key: PROJECT_SCOPE_KEY },
    status: overrides.status ?? "approved",
    source: overrides.source ?? "manual",
    kind: overrides.kind ?? "project_fact",
    createdAt: overrides.createdAt ?? "2026-07-03T08:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-03T08:00:00.000Z",
    provenance: overrides.provenance,
    revision: overrides.revision,
    project: overrides.project,
    freshness: overrides.freshness,
    descriptor: overrides.descriptor,
  }
}

export const corpus = {
  id: CORPUS_ID,
  records: [
    evalMemory({
      id: "deploy-stale-pages",
      kind: "project_fact",
      createdAt: "2026-07-02T08:00:00.000Z",
      updatedAt: "2026-07-02T08:00:00.000Z",
      text: "Current deployment status: use the legacy Pages adapter for production. This fact was superseded.",
      revision: { supersededBy: "deploy-current-workers", reason: "adapter changed", revisedAt: "2026-07-03T08:00:00.000Z", revisedBy: "manual" },
    }),
    evalMemory({
      id: "deploy-current-workers",
      kind: "project_fact",
      createdAt: "2026-07-03T08:00:00.000Z",
      updatedAt: "2026-07-03T08:00:00.000Z",
      text: "Current deployment status: use the Workers adapter for production.",
    }),
    evalMemory({
      id: "package-manager-stale-npm",
      kind: "project_fact",
      createdAt: "2026-07-02T09:00:00.000Z",
      updatedAt: "2026-07-02T09:00:00.000Z",
      text: "Project package manager switched from pnpm to npm for installs. This plan is superseded.",
      revision: { supersededBy: "package-manager-current-pnpm", reason: "false premise corrected", revisedAt: "2026-07-03T09:00:00.000Z", revisedBy: "manual" },
    }),
    evalMemory({
      id: "package-manager-current-pnpm",
      kind: "project_fact",
      createdAt: "2026-07-03T09:00:00.000Z",
      updatedAt: "2026-07-03T09:00:00.000Z",
      text: "Project package manager remains pnpm for installs; npm is not approved.",
    }),
  ],
  scenarios: [
    {
      id: "current-deployment-status",
      kind: "current-beats-superseded",
      lane: "recall",
      query: "what is the current deployment status?",
      k: 2,
      labels: {
        "deploy-current-workers": "required",
        "deploy-stale-pages": "forbidden",
      },
      expectedFirstId: "deploy-current-workers",
      forbiddenIds: ["deploy-stale-pages"],
    },
    {
      id: "false-premise-package-manager-switch",
      kind: "false-premise-refutation",
      lane: "recall",
      query: "when did project package manager switch to npm?",
      k: 2,
      labels: {
        "package-manager-current-pnpm": "required",
        "package-manager-stale-npm": "forbidden",
      },
      expectedFirstId: "package-manager-current-pnpm",
      forbiddenIds: ["package-manager-stale-npm"],
    },
  ] satisfies ConflictUpdateScenario[],
}

function countFailureTags(results: ConflictUpdateScenarioResult[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const result of results) {
    for (const tag of result.failureTags) counts[tag] = (counts[tag] ?? 0) + 1
  }
  return counts
}

export function summarizeResults(results: ConflictUpdateScenarioResult[]): ConflictUpdateReport["summary"] {
  const falsePremiseResults = results.filter((result) => result.kind === "false-premise-refutation")
  return {
    scenarioCount: results.length,
    passCount: results.filter((result) => result.passed).length,
    failCount: results.filter((result) => !result.passed).length,
    zeroToleranceFailures: results.reduce((sum, result) => sum + result.failureTags.filter((tag) => ZERO_TOLERANCE_FAILURE_TAGS[tag]).length, 0),
    currentFactFirstRate: results.length === 0 ? Number.NaN : results.filter((result) => result.actualIds[0] === result.expectedFirstId).length / results.length,
    falsePremiseSafetyRate: falsePremiseResults.length === 0 ? Number.NaN : falsePremiseResults.filter((result) => result.passed).length / falsePremiseResults.length,
    failureTagCounts: countFailureTags(results),
  }
}

export function reportIsSatisfactory(report: ConflictUpdateReport): boolean {
  return report.summary.scenarioCount > 0
    && report.summary.failCount === 0
    && report.summary.zeroToleranceFailures === 0
    && Number.isFinite(report.summary.currentFactFirstRate)
    && report.summary.currentFactFirstRate === 1
    && Number.isFinite(report.summary.falsePremiseSafetyRate)
    && report.summary.falsePremiseSafetyRate === 1
}

export function assertCorpusStructurallyValid(): void {
  const ids = new Set(corpus.records.map((record) => record.id))

  assert.equal(corpus.id, CORPUS_ID)
  assert.equal(corpus.records.length, 4)
  assert.equal(corpus.scenarios.length, 2)
  assert.equal(new Set(corpus.scenarios.map((scenario) => scenario.id)).size, corpus.scenarios.length)
  assert.equal(corpus.scenarios.some((scenario) => scenario.kind === "current-beats-superseded"), true)
  assert.equal(corpus.scenarios.some((scenario) => scenario.kind === "false-premise-refutation"), true)

  for (const record of corpus.records) {
    assert.equal(record.scope.type, "project")
    assert.equal(record.scope.key, PROJECT_SCOPE_KEY)
    assert.equal(record.status, "approved")
    assert.equal(containsLikelySecret(record.text), false, `${record.id} should not look like a secret`)
    assert.match(record.createdAt, /^2026-07-/u)
    assert.match(record.updatedAt, /^2026-07-/u)
    if (record.revision?.supersededBy) assert.equal(ids.has(record.revision.supersededBy), true, `${record.id} supersedes unknown id`)
  }

  for (const scenario of corpus.scenarios) {
    assert.equal(scenario.lane, "recall")
    assert.ok(scenario.k > 0)
    assert.equal(ids.has(scenario.expectedFirstId), true, `${scenario.id} expectedFirstId is unknown`)
    assert.equal(scenario.labels[scenario.expectedFirstId], "required")
    for (const id of scenario.forbiddenIds) assert.equal(scenario.labels[id], "forbidden", `${scenario.id} forbidden id ${id} needs a forbidden label`)
    for (const id of Object.keys(scenario.labels)) assert.equal(ids.has(id), true, `${scenario.id} labels unknown id ${id}`)
    assert.equal(Object.values(scenario.labels).some((label) => label === "required"), true, `${scenario.id} needs a required corrective fact`)
  }
}

export async function evaluateScenario(scenario: ConflictUpdateScenario): Promise<ConflictUpdateScenarioResult> {
  const recall = await retrieveSemanticMemories(
    corpus.records,
    [],
    [],
    scenario.query,
    PROJECT_SCOPE_KEY,
    { ...BASE_SEMANTIC_CONFIG, retrieval: { ...BASE_SEMANTIC_CONFIG.retrieval, topK: scenario.k } },
  )
  assert.equal(recall.semantic.used, false)

  const actualIds = recall.memories.slice(0, scenario.k).map((record) => record.id)
  const requiredIds = Object.entries(scenario.labels)
    .filter(([, label]) => label === "required")
    .map(([id]) => id)
  const missingRequired = requiredIds.filter((id) => !actualIds.includes(id))
  const returnedForbiddenIds = scenario.forbiddenIds.filter((id) => actualIds.includes(id))
  const rankedFailureTags: ConflictFailureTag[] = []
  const firstRequiredIndex = actualIds.findIndex((id) => scenario.labels[id] === "required")
  const staleBeforeCurrent = actualIds.some((id, index) => scenario.labels[id] === "forbidden" && (firstRequiredIndex === -1 || index <= firstRequiredIndex))
  const distractorCount = actualIds.filter((id) => {
    const label = scenario.labels[id] ?? "distractor"
    return label === "distractor" || label === "forbidden"
  }).length

  if (missingRequired.length) rankedFailureTags.push("missing-required")
  if (returnedForbiddenIds.length) rankedFailureTags.push("forbidden-returned")
  if (staleBeforeCurrent) rankedFailureTags.push("stale-over-current")
  if (actualIds.length > 0 && distractorCount > actualIds.length / 2) rankedFailureTags.push("topic-mismatch")

  const failureTags = [...new Set([
    ...rankedFailureTags,
    ...(actualIds[0] === scenario.expectedFirstId ? [] : ["current-fact-not-first" as const]),
    ...(returnedForbiddenIds.length ? ["superseded-returned" as const] : []),
  ])]

  return {
    id: scenario.id,
    kind: scenario.kind,
    lane: scenario.lane,
    query: scenario.query,
    k: scenario.k,
    actualIds,
    recallAtK: requiredIds.length === 0 ? Number.NaN : requiredIds.filter((id) => actualIds.includes(id)).length / requiredIds.length,
    precisionAtK: actualIds.length === 0 ? Number.NaN : actualIds.filter((id) => {
      const label = scenario.labels[id] ?? "distractor"
      return label === "required" || label === "acceptable"
    }).length / actualIds.length,
    passed: failureTags.length === 0,
    expectedFirstId: scenario.expectedFirstId,
    returnedForbiddenIds,
    failureTags,
  }
}

export async function buildConflictUpdateEvalReport(scenarios: ConflictUpdateScenario[] = corpus.scenarios): Promise<ConflictUpdateReport> {
  if (scenarios.length === 0) throw new Error("conflict/update eval requires at least one scenario")
  const scenarioResults = []
  for (const scenario of scenarios) scenarioResults.push(await evaluateScenario(scenario))
  return {
    generatedAt: GENERATED_AT,
    corpusId: CORPUS_ID,
    mode: MODE,
    scenarioResults,
    summary: summarizeResults(scenarioResults),
  }
}
