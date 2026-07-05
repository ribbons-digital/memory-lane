import assert from "node:assert/strict"
import { containsLikelySecret } from "../src/secret-detection.js"
import { retrieveSemanticMemories } from "../src/retrieval.js"
import { foldMemoryRecords } from "../src/storage.js"
import type { MemoryRecord, SemanticMemoryConfig } from "../src/types.js"

export const GENERATED_AT = "2026-07-04T13:00:00.000Z"
export const CORPUS_ID = "conflict-update-microbench-v2"
export const MODE = "default-no-embedding"
export const PROJECT_SCOPE_KEY = "eval/project"
export const OTHER_PROJECT_SCOPE_KEY = "eval/other-project"

const INTENTIONAL_DUPLICATE_IDS: Record<string, true | undefined> = { "same-id-editor-default": true }

const BASE_SEMANTIC_CONFIG: SemanticMemoryConfig["semantic"] = {
  enabled: false,
  activeEmbeddingProfile: "local-example",
  embeddings: { profiles: {} },
  retrieval: { topK: 2, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
  privacy: { allowRemoteEmbeddings: false },
}

const SCENARIO_KINDS = [
  "current-beats-superseded",
  "false-premise-refutation",
  "same-id-update",
  "explicit-correction",
  "multiple-supersession-chain",
  "cross-scope-false-premise",
] as const

export type ConflictScenarioKind = typeof SCENARIO_KINDS[number]
export type ConflictFailureTag = "current-fact-not-first" | "superseded-returned" | "missing-required" | "forbidden-returned" | "stale-over-current" | "stale-version-returned" | "topic-mismatch"
export type RelevanceLabel = "required" | "acceptable" | "distractor" | "forbidden"

export const ZERO_TOLERANCE_FAILURE_TAGS: Record<ConflictFailureTag, true | undefined> = {
  "current-fact-not-first": true,
  "superseded-returned": true,
  "missing-required": true,
  "forbidden-returned": true,
  "stale-over-current": true,
  "stale-version-returned": true,
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
  expectedFirstTextIncludes?: string
  forbiddenIds: string[]
}

export interface ConflictUpdateScenarioResult {
  id: string
  kind: ConflictScenarioKind
  lane: "recall"
  query: string
  k: number
  actualIds: string[]
  actualFirstText?: string
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
    staleFactLeakRate: number
    supersededMemoryLeakRate: number
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
    evalMemory({
      id: "same-id-editor-default",
      kind: "project_checkpoint",
      createdAt: "2026-07-02T10:00:00.000Z",
      updatedAt: "2026-07-02T10:00:00.000Z",
      text: "Current editor default: Cursor is required for slice implementation.",
    }),
    evalMemory({
      id: "same-id-editor-default",
      kind: "project_checkpoint",
      createdAt: "2026-07-03T10:00:00.000Z",
      updatedAt: "2026-07-03T10:00:00.000Z",
      text: "Current editor default: VS Code Insiders is required for slice implementation; Cursor guidance is stale.",
      revision: { reason: "same-id update", revisedAt: "2026-07-03T10:00:00.000Z", revisedBy: "manual" },
    }),
    evalMemory({
      id: "database-choice-stale-postgres",
      kind: "project_fact",
      createdAt: "2026-07-02T11:00:00.000Z",
      updatedAt: "2026-07-02T11:00:00.000Z",
      text: "Database choice switched to Postgres for local development. This false premise is superseded.",
      revision: { supersededBy: "database-choice-current-sqlite", reason: "correction recorded", revisedAt: "2026-07-03T11:00:00.000Z", revisedBy: "manual" },
    }),
    evalMemory({
      id: "database-choice-current-sqlite",
      kind: "correction",
      createdAt: "2026-07-03T11:00:00.000Z",
      updatedAt: "2026-07-03T11:00:00.000Z",
      text: "Correction: database choice remains SQLite for local development; Postgres migration was rejected.",
      revision: { supersedes: ["database-choice-stale-postgres"], reason: "correction recorded", revisedAt: "2026-07-03T11:00:00.000Z", revisedBy: "manual" },
    }),
    evalMemory({
      id: "auth-provider-old-password",
      kind: "project_fact",
      createdAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-07-01T12:00:00.000Z",
      text: "Current auth provider: password login for the dashboard.",
      revision: { supersededBy: "auth-provider-middle-oauth", reason: "first auth migration", revisedAt: "2026-07-02T12:00:00.000Z", revisedBy: "manual" },
    }),
    evalMemory({
      id: "auth-provider-middle-oauth",
      kind: "project_fact",
      createdAt: "2026-07-02T12:00:00.000Z",
      updatedAt: "2026-07-02T12:00:00.000Z",
      text: "Current auth provider: GitHub OAuth for the dashboard.",
      revision: { supersededBy: "auth-provider-current-access", supersedes: ["auth-provider-old-password"], reason: "second auth migration", revisedAt: "2026-07-03T12:00:00.000Z", revisedBy: "manual" },
    }),
    evalMemory({
      id: "auth-provider-current-access",
      kind: "project_fact",
      createdAt: "2026-07-03T12:00:00.000Z",
      updatedAt: "2026-07-03T12:00:00.000Z",
      text: "Current auth provider: Cloudflare Access for the dashboard.",
      revision: { supersedes: ["auth-provider-middle-oauth"], reason: "second auth migration", revisedAt: "2026-07-03T12:00:00.000Z", revisedBy: "manual" },
    }),
    evalMemory({
      id: "token-storage-other-localstorage",
      kind: "project_fact",
      scope: { type: "project", key: OTHER_PROJECT_SCOPE_KEY },
      createdAt: "2026-07-02T13:00:00.000Z",
      updatedAt: "2026-07-02T13:00:00.000Z",
      text: "Current token storage: use localStorage for the unrelated project.",
    }),
    evalMemory({
      id: "token-storage-current-cookie",
      kind: "project_fact",
      createdAt: "2026-07-03T13:00:00.000Z",
      updatedAt: "2026-07-03T13:00:00.000Z",
      text: "Current token storage: use HttpOnly cookies; localStorage is not approved for this project.",
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
    {
      id: "same-id-project-status-update",
      kind: "same-id-update",
      lane: "recall",
      query: "what is the current editor default for slice implementation?",
      k: 2,
      labels: {
        "same-id-editor-default": "required",
      },
      expectedFirstId: "same-id-editor-default",
      expectedFirstTextIncludes: "VS Code Insiders",
      forbiddenIds: [],
    },
    {
      id: "explicit-correction-database-choice",
      kind: "explicit-correction",
      lane: "recall",
      query: "when did database choice switch to postgres?",
      k: 2,
      labels: {
        "database-choice-current-sqlite": "required",
        "database-choice-stale-postgres": "forbidden",
      },
      expectedFirstId: "database-choice-current-sqlite",
      forbiddenIds: ["database-choice-stale-postgres"],
    },
    {
      id: "supersession-chain-auth-provider",
      kind: "multiple-supersession-chain",
      lane: "recall",
      query: "what is the current auth provider for the dashboard?",
      k: 2,
      labels: {
        "auth-provider-current-access": "required",
        "auth-provider-old-password": "forbidden",
        "auth-provider-middle-oauth": "forbidden",
      },
      expectedFirstId: "auth-provider-current-access",
      forbiddenIds: ["auth-provider-old-password", "auth-provider-middle-oauth"],
    },
    {
      id: "cross-scope-false-premise-token-storage",
      kind: "cross-scope-false-premise",
      lane: "recall",
      query: "did token storage switch to localStorage?",
      k: 2,
      labels: {
        "token-storage-current-cookie": "required",
        "token-storage-other-localstorage": "forbidden",
      },
      expectedFirstId: "token-storage-current-cookie",
      forbiddenIds: ["token-storage-other-localstorage"],
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
  const falsePremiseResults = results.filter((result) => result.kind === "false-premise-refutation" || result.kind === "cross-scope-false-premise")
  return {
    scenarioCount: results.length,
    passCount: results.filter((result) => result.passed).length,
    failCount: results.filter((result) => !result.passed).length,
    zeroToleranceFailures: results.reduce((sum, result) => sum + result.failureTags.filter((tag) => ZERO_TOLERANCE_FAILURE_TAGS[tag]).length, 0),
    currentFactFirstRate: results.length === 0 ? Number.NaN : results.filter((result) => result.actualIds[0] === result.expectedFirstId).length / results.length,
    falsePremiseSafetyRate: falsePremiseResults.length === 0 ? Number.NaN : falsePremiseResults.filter((result) => result.passed).length / falsePremiseResults.length,
    staleFactLeakRate: results.length === 0 ? Number.NaN : results.filter((result) => result.failureTags.includes("stale-over-current")).length / results.length,
    supersededMemoryLeakRate: results.length === 0 ? Number.NaN : results.filter((result) => result.failureTags.includes("superseded-returned")).length / results.length,
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
    && Number.isFinite(report.summary.staleFactLeakRate)
    && report.summary.staleFactLeakRate === 0
    && Number.isFinite(report.summary.supersededMemoryLeakRate)
    && report.summary.supersededMemoryLeakRate === 0
}

export function assertCorpusStructurallyValid(): void {
  const ids = new Set(corpus.records.map((record) => record.id))
  const idCounts = new Map<string, number>()
  for (const record of corpus.records) idCounts.set(record.id, (idCounts.get(record.id) ?? 0) + 1)

  assert.equal(corpus.id, CORPUS_ID)
  assert.equal(corpus.records.length, 13)
  assert.equal(corpus.scenarios.length, 6)
  assert.equal(idCounts.get("same-id-editor-default"), 2)
  const foldedSameIdRecord = foldMemoryRecords(corpus.records).find((record) => record.id === "same-id-editor-default")
  assert.ok(foldedSameIdRecord)
  assert.equal(foldedSameIdRecord.text.includes("VS Code Insiders"), true)
  assert.equal(new Set(corpus.scenarios.map((scenario) => scenario.id)).size, corpus.scenarios.length)
  for (const kind of SCENARIO_KINDS) assert.equal(corpus.scenarios.some((scenario) => scenario.kind === kind), true, `missing ${kind} scenario`)
  for (const [id, count] of idCounts) {
    if (count > 1) assert.equal(INTENTIONAL_DUPLICATE_IDS[id], true, `${id} is an unexpected duplicate fixture id`)
  }

  for (const record of corpus.records) {
    assert.equal(record.scope.type, "project")
    assert.ok(record.scope.key === PROJECT_SCOPE_KEY || record.scope.key === OTHER_PROJECT_SCOPE_KEY)
    assert.equal(record.status, "approved")
    assert.equal(containsLikelySecret(record.text), false, `${record.id} should not look like a secret`)
    assert.match(record.createdAt, /^2026-07-/u)
    assert.match(record.updatedAt, /^2026-07-/u)
    if (record.revision?.supersededBy) assert.equal(ids.has(record.revision.supersededBy), true, `${record.id} supersedes unknown id`)
    for (const supersededId of record.revision?.supersedes ?? []) assert.equal(ids.has(supersededId), true, `${record.id} references unknown superseded id`)
  }

  for (const scenario of corpus.scenarios) {
    assert.equal(scenario.lane, "recall")
    assert.ok(scenario.k > 0)
    assert.equal(ids.has(scenario.expectedFirstId), true, `${scenario.id} expectedFirstId is unknown`)
    assert.equal(scenario.labels[scenario.expectedFirstId], "required")
    for (const id of scenario.forbiddenIds) assert.equal(scenario.labels[id], "forbidden", `${scenario.id} forbidden id ${id} needs a forbidden label`)
    for (const id of Object.keys(scenario.labels)) assert.equal(ids.has(id), true, `${scenario.id} labels unknown id ${id}`)
    assert.equal(Object.values(scenario.labels).some((label) => label === "required"), true, `${scenario.id} needs a required corrective fact`)
    if (scenario.expectedFirstTextIncludes) assert.equal(scenario.expectedFirstId, "same-id-editor-default")
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
  const actualFirstText = recall.memories[0]?.text
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
  if (scenario.expectedFirstTextIncludes && !actualFirstText?.includes(scenario.expectedFirstTextIncludes)) rankedFailureTags.push("stale-version-returned")
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
    actualFirstText,
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
