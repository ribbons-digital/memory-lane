import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  DEFAULT_CONFIG,
  MemoryEngine,
  buildContinuityReadModel,
  containsLikelySecret,
  foldMemoryRecords,
  lexicalScore,
  type ContinuityReadModel,
  type MemoryRecord,
  type ProjectScope,
} from "../src/index.js"
import { tempDir } from "./helpers.js"
import { assertBenchmarkMetadata, isGateSatisfactory, summarizeEvalGate, type BenchmarkLane, type BenchmarkMetadata } from "./eval-report-helpers.js"

export const PROJECT_SCOPE_KEY = "eval/project"
export const GENERATED_AT = "2026-06-27T12:00:00.000Z"
export const CORPUS_ID = "retrieval-continuity-baseline-v2"
export type RetrievalFailureTag = "missing-required" | "forbidden-returned" | "wrong-slot" | "stale-over-current" | "topic-mismatch"
export const ZERO_TOLERANCE_FAILURE_TAGS = new Set<RetrievalFailureTag>(["missing-required", "forbidden-returned", "wrong-slot", "stale-over-current"])
export const KNOWN_FAILURE_TAGS = new Set<RetrievalFailureTag>([...ZERO_TOLERANCE_FAILURE_TAGS, "topic-mismatch"])

export type EvalLane = "continuity" | "recall"
export type RelevanceLabel = "required" | "acceptable" | "distractor" | "forbidden"
export type ContinuitySlot = "latestProgress" | "operatingGuidance" | "workstreamDiscovery.candidates" | "pendingContinuity"

export interface ContinuityExpectation {
  slot: ContinuitySlot
  required?: string[]
  acceptable?: string[]
  forbidden?: string[]
}

export interface EvalQuery {
  id: string
  lane: EvalLane
  query: string
  k: number
  labels: Record<string, RelevanceLabel>
  continuityExpectations?: ContinuityExpectation[]
  benchmark: BenchmarkMetadata
}

export interface EvalCorpus {
  id: string
  records: MemoryRecord[]
  queries: EvalQuery[]
}

export interface SlotResult {
  slot: ContinuitySlot
  actualIds: string[]
  missingRequired: string[]
  forbiddenPresent: string[]
}

export interface EvalQueryResult {
  id: string
  lane: EvalLane
  query: string
  k: number
  actualIds: string[]
  recallAtK?: number
  precisionAtK?: number
  ndcgAtK?: number
  slotResults?: SlotResult[]
  failureTags: RetrievalFailureTag[]
  benchmark: BenchmarkMetadata
}

export interface EvalReport {
  generatedAt: string
  corpusId: string
  mode: "default-no-embedding"
  queryResults: EvalQueryResult[]
  summary: {
    scenarioCount: number
    passCount: number
    failCount: number
    zeroToleranceFailures: number
    meanRecallAtK?: number
    meanPrecisionAtK?: number
    meanNdcgAtK?: number
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
    createdAt: overrides.createdAt ?? "2026-06-27T08:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-27T08:00:00.000Z",
    provenance: overrides.provenance,
    revision: overrides.revision,
    project: overrides.project,
    freshness: overrides.freshness,
    descriptor: overrides.descriptor,
  }
}

export const corpus: EvalCorpus = {
  id: CORPUS_ID,
  records: [
    memory({
      id: "eval-stale-v037",
      kind: "project_checkpoint",
      createdAt: "2026-06-26T08:00:00.000Z",
      updatedAt: "2026-06-26T08:00:00.000Z",
      text: "Current Memory Lane release status: v0.2.37 was released after Phase 21 handoff-free sessions validation. This older checkpoint is now stale.",
    }),
    memory({
      id: "eval-release-v038",
      kind: "project_checkpoint",
      createdAt: "2026-06-27T08:00:00.000Z",
      updatedAt: "2026-06-27T08:00:00.000Z",
      text: "Current Memory Lane release status: v0.2.38 release shipped the docs context-budget slice from PR #69; release workflow passed and assets were published.",
    }),
    memory({
      id: "eval-docs-sync-v038",
      kind: "project_fact",
      createdAt: "2026-06-27T08:30:00.000Z",
      updatedAt: "2026-06-27T08:30:00.000Z",
      text: "Docs sync checkpoint after v0.2.38: ROADMAP.md and HANDOFF.md now summarize the docs context-budget work and link archived history.",
    }),
    memory({
      id: "eval-pr-body-rule",
      kind: "correction",
      createdAt: "2026-06-27T09:00:00.000Z",
      updatedAt: "2026-06-27T09:00:00.000Z",
      text: "Workflow correction: to create GitHub PR descriptions and fix PR body formatting, write the Markdown body to a temporary file and use gh pr create --body-file or gh pr edit --body-file. See PR #70.",
    }),
    memory({
      id: "eval-pr-body-legacy-near-miss",
      kind: "project_fact",
      createdAt: "2026-06-26T09:00:00.000Z",
      updatedAt: "2026-06-26T09:00:00.000Z",
      text: "Legacy GitHub PR descriptions note: paste generated release notes directly into the PR body. This older note is a near miss for PR body formatting but is not the active rule.",
      revision: { supersededBy: "eval-pr-body-rule", reason: "PR body workflow correction", revisedAt: "2026-06-27T09:00:00.000Z", revisedBy: "manual" },
    }),
    memory({
      id: "eval-pr-process-agreement",
      kind: "workflow_rule",
      createdAt: "2026-06-27T09:30:00.000Z",
      updatedAt: "2026-06-27T09:30:00.000Z",
      text: "Project workflow rule: use a feature branch, open a GitHub PR, wait for user review and merge, then sync main before starting the next slice.",
    }),
    memory({
      id: "eval-old-hygiene-slice",
      kind: "project_checkpoint",
      createdAt: "2026-06-24T08:00:00.000Z",
      updatedAt: "2026-06-24T08:00:00.000Z",
      text: "Completed an older memory hygiene UX slice with show and get commands. This older project item is not the current retrieval evaluation work.",
    }),
    memory({
      id: "eval-current-track",
      kind: "project_checkpoint",
      createdAt: "2026-06-27T11:00:00.000Z",
      updatedAt: "2026-06-27T11:00:00.000Z",
      text: "Current Memory Lane project progress checkpoint: retrieval and continuity eval baseline design was approved. Next work is the implementation slice to add a sanitized six-scenario eval corpus, test-only helpers, baseline metrics, and findings before any retrieval ranking change.",
    }),
  ],
  queries: [
    {
      id: "continuity-broad-status",
      lane: "continuity",
      benchmark: { ability: "continuity-status", lane: "continuity" },
      query: "where are we in the project?",
      k: 3,
      labels: {
        "eval-current-track": "required",
        "eval-release-v038": "acceptable",
        "eval-pr-body-rule": "forbidden",
        "eval-stale-v037": "forbidden",
      },
      continuityExpectations: [{ slot: "latestProgress", required: ["eval-current-track"], forbidden: ["eval-pr-body-rule", "eval-stale-v037"] }],
    },
    {
      id: "continuity-next-work",
      lane: "continuity",
      benchmark: { ability: "continuity-status", lane: "continuity" },
      query: "what should we work on next?",
      k: 3,
      labels: {
        "eval-current-track": "required",
        "eval-pr-process-agreement": "acceptable",
        "eval-old-hygiene-slice": "forbidden",
      },
      continuityExpectations: [
        { slot: "latestProgress", required: ["eval-current-track"], forbidden: ["eval-old-hygiene-slice"] },
        { slot: "operatingGuidance", acceptable: ["eval-pr-process-agreement"] },
      ],
    },
    {
      id: "continuity-pr-body-workstream",
      lane: "continuity",
      benchmark: { ability: "direct-recall", lane: "continuity" },
      query: "where did we fix PR body formatting?",
      k: 1,
      labels: {
        "eval-pr-body-rule": "required",
        "eval-pr-process-agreement": "acceptable",
        "eval-release-v038": "distractor",
        "eval-pr-body-legacy-near-miss": "forbidden",
      },
      continuityExpectations: [{ slot: "workstreamDiscovery.candidates", required: ["eval-pr-body-rule"] }],
    },
    {
      id: "recall-pr-description-rule",
      lane: "recall",
      benchmark: { ability: "direct-recall", lane: "retrieval" },
      query: "how should I create GitHub PR descriptions?",
      k: 3,
      labels: {
        "eval-pr-body-rule": "required",
        "eval-pr-process-agreement": "acceptable",
        "eval-release-v038": "distractor",
      },
    },
    {
      id: "recall-docs-context-budget-release",
      lane: "recall",
      benchmark: { ability: "direct-recall", lane: "retrieval" },
      query: "what release shipped docs context-budget?",
      k: 3,
      labels: {
        "eval-release-v038": "required",
        "eval-docs-sync-v038": "acceptable",
        "eval-pr-body-rule": "distractor",
      },
    },
    {
      id: "recall-current-release-status",
      lane: "recall",
      benchmark: { ability: "temporal-currentness", lane: "retrieval" },
      query: "what is the current Memory Lane release status?",
      k: 1,
      labels: {
        "eval-release-v038": "required",
        "eval-docs-sync-v038": "acceptable",
        "eval-stale-v037": "forbidden",
      },
    },
  ],
}

export function knownRecordIds(records: MemoryRecord[]): Set<string> {
  return new Set(records.map((record) => record.id))
}

export function slotIds(model: ContinuityReadModel, slot: ContinuitySlot): string[] {
  if (slot === "latestProgress") return model.latestProgress ? [model.latestProgress.id] : []
  if (slot === "operatingGuidance") return model.operatingGuidance?.map((item) => item.id) ?? []
  if (slot === "pendingContinuity") return model.pendingContinuity.map((item) => item.id)
  return model.workstreamDiscovery?.candidates.map((item) => item.id) ?? []
}

export function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

export function labelFor(query: EvalQuery, id: string): RelevanceLabel {
  return query.labels[id] ?? "distractor"
}

export function relevanceValue(label: RelevanceLabel): number {
  if (label === "required") return 3
  if (label === "acceptable") return 2
  return 0
}

function dcg(values: number[]): number {
  return values.reduce((sum, value, index) => sum + value / Math.log2(index + 2), 0)
}

export function ndcgAtK(query: EvalQuery, actualIds: string[]): number {
  const actual = actualIds.slice(0, query.k).map((id) => relevanceValue(labelFor(query, id)))
  const ideal = Object.values(query.labels)
    .map(relevanceValue)
    .sort((a, b) => b - a)
    .slice(0, query.k)
  const idealDcg = dcg(ideal)
  return idealDcg === 0 ? 0 : dcg(actual) / idealDcg
}

export function recallAtK(labels: Record<string, RelevanceLabel>, actualIds: string[]): number {
  const required = Object.entries(labels).filter(([, label]) => label === "required").map(([id]) => id)
  return ratio(required.filter((id) => actualIds.includes(id)).length, required.length)
}

export function precisionAtK(query: EvalQuery, actualIds: string[]): number {
  const relevantCount = actualIds.filter((id) => {
    const label = labelFor(query, id)
    return label === "required" || label === "acceptable"
  }).length
  return ratio(relevantCount, actualIds.length)
}

export function failureTagsForRanked(query: EvalQuery, actualIds: string[]): RetrievalFailureTag[] {
  const tags: RetrievalFailureTag[] = []
  const required = Object.entries(query.labels).filter(([, label]) => label === "required").map(([id]) => id)
  const missing = required.filter((id) => !actualIds.includes(id))
  if (missing.length) tags.push("missing-required")
  if (actualIds.some((id) => labelFor(query, id) === "forbidden")) tags.push("forbidden-returned")
  const firstRequiredIndex = actualIds.findIndex((id) => labelFor(query, id) === "required")
  const staleBeforeCurrent = actualIds.some((id, index) => labelFor(query, id) === "forbidden" && (firstRequiredIndex === -1 || index <= firstRequiredIndex))
  if (staleBeforeCurrent) tags.push("stale-over-current")
  const distractorCount = actualIds.filter((id) => {
    const label = labelFor(query, id)
    return label === "distractor" || label === "forbidden"
  }).length
  if (actualIds.length > 0 && distractorCount > actualIds.length / 2) tags.push("topic-mismatch")
  return unique(tags)
}


export function scoreNonZeroIds(query: EvalQuery, memories: MemoryRecord[]): string[] {
  return memories
    .filter((record) => lexicalScore(query.query, record.text) > 0)
    .slice(0, query.k)
    .map((record) => record.id)
}

function writeConfig(dir: string): string {
  const configPath = path.join(dir, "config.json")
  fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG), "utf8")
  return configPath
}

function writeMemoryLog(dir: string, records: MemoryRecord[]): string {
  const memoryPath = path.join(dir, "memory.jsonl")
  fs.writeFileSync(memoryPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
  return memoryPath
}

export async function evaluateRecall(query: EvalQuery, records: MemoryRecord[]): Promise<EvalQueryResult> {
  const dir = tempDir()
  const fixtureRoot = path.join(dir, "project")
  fs.mkdirSync(fixtureRoot, { recursive: true })
  const engine = new MemoryEngine({
    memoryPath: writeMemoryLog(dir, records),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath: writeConfig(dir),
  })
  const projectScope: ProjectScope = { key: PROJECT_SCOPE_KEY, root: fixtureRoot, cwd: fixtureRoot }
  const result = await engine.recall(query.query, { projectScope })
  assert.equal(result.semantic.used, false)
  const actualIds = scoreNonZeroIds(query, result.memories)
  const failureTags = failureTagsForRanked(query, actualIds)
  return {
    id: query.id,
    lane: query.lane,
    query: query.query,
    k: query.k,
    actualIds,
    recallAtK: recallAtK(query.labels, actualIds),
    precisionAtK: precisionAtK(query, actualIds),
    ndcgAtK: ndcgAtK(query, actualIds),
    failureTags,
    benchmark: query.benchmark,
  }
}

export function evaluateContinuity(query: EvalQuery, records: MemoryRecord[]): EvalQueryResult {
  const model = buildContinuityReadModel(records, { projectScopeKey: PROJECT_SCOPE_KEY, query: query.query, generatedAt: GENERATED_AT })
  const slotResults = (query.continuityExpectations ?? []).map((expectation) => {
    const actualIds = slotIds(model, expectation.slot)
    return {
      slot: expectation.slot,
      actualIds,
      missingRequired: (expectation.required ?? []).filter((id) => !actualIds.includes(id)),
      forbiddenPresent: (expectation.forbidden ?? []).filter((id) => actualIds.includes(id)),
    }
  })

  const rankedExpectation = query.continuityExpectations?.find((expectation) => expectation.slot === "workstreamDiscovery.candidates")
  const rankedIds = rankedExpectation ? slotIds(model, "workstreamDiscovery.candidates").slice(0, query.k) : []
  const actualIds = unique(slotResults.flatMap((result) => result.actualIds))
  const latestProgressRequired = query.continuityExpectations
    ?.find((expectation) => expectation.slot === "latestProgress")
    ?.required ?? []
  const requiredProgressInOtherSlot = latestProgressRequired.some((id) =>
    slotResults.some((result) => result.slot !== "latestProgress" && result.actualIds.includes(id)),
  )
  const slotFailureTags: string[] = []
  if (slotResults.some((result) => result.missingRequired.length)) slotFailureTags.push("missing-required")
  if (slotResults.some((result) => result.forbiddenPresent.length)) slotFailureTags.push("forbidden-returned")
  if (requiredProgressInOtherSlot || slotResults.some((result) => result.slot === "latestProgress" && result.forbiddenPresent.length)) slotFailureTags.push("wrong-slot")

  const failureTags = unique([...slotFailureTags, ...(rankedExpectation ? failureTagsForRanked(query, rankedIds) : [])])
  return {
    id: query.id,
    lane: query.lane,
    query: query.query,
    k: query.k,
    actualIds,
    recallAtK: rankedExpectation ? recallAtK(query.labels, rankedIds) : undefined,
    precisionAtK: rankedExpectation ? precisionAtK(query, rankedIds) : undefined,
    ndcgAtK: rankedExpectation ? ndcgAtK(query, rankedIds) : undefined,
    slotResults,
    failureTags,
    benchmark: query.benchmark,
  }
}

export async function buildEvalReport(evalCorpus: EvalCorpus): Promise<EvalReport> {
  const queryResults: EvalQueryResult[] = []
  for (const query of evalCorpus.queries) {
    queryResults.push(query.lane === "recall"
      ? await evaluateRecall(query, evalCorpus.records)
      : evaluateContinuity(query, evalCorpus.records))
  }
  const recallValues = queryResults.flatMap((result) => result.recallAtK === undefined ? [] : [result.recallAtK])
  const precisionValues = queryResults.flatMap((result) => result.precisionAtK === undefined ? [] : [result.precisionAtK])
  const ndcgValues = queryResults.flatMap((result) => result.ndcgAtK === undefined ? [] : [result.ndcgAtK])
  const gateSummary = summarizeEvalGate(queryResults, ZERO_TOLERANCE_FAILURE_TAGS)
  const meanRecallAtK = ratio(recallValues.reduce((sum, value) => sum + value, 0), recallValues.length)
  const meanPrecisionAtK = ratio(precisionValues.reduce((sum, value) => sum + value, 0), precisionValues.length)
  const meanNdcgAtK = ratio(ndcgValues.reduce((sum, value) => sum + value, 0), ndcgValues.length)
  const satisfactory = gateSummary.satisfactory
    && Number.isFinite(meanRecallAtK)
    && Number.isFinite(meanPrecisionAtK)
    && Number.isFinite(meanNdcgAtK)
  return {
    generatedAt: GENERATED_AT,
    corpusId: evalCorpus.id,
    mode: "default-no-embedding",
    queryResults,
    summary: {
      scenarioCount: gateSummary.scenarioCount,
      passCount: gateSummary.passCount,
      failCount: gateSummary.failCount,
      zeroToleranceFailures: gateSummary.zeroToleranceFailures,
      meanRecallAtK,
      meanPrecisionAtK,
      meanNdcgAtK,
      failureTagCounts: gateSummary.failureTagCounts,
      satisfactory,
    },
  }
}

export function reportIsSatisfactory(report: EvalReport): boolean {
  return isGateSatisfactory(report.summary)
    && Number.isFinite(report.summary.meanRecallAtK)
    && Number.isFinite(report.summary.meanPrecisionAtK)
    && Number.isFinite(report.summary.meanNdcgAtK)
}

export function assertCorpusStructurallyValid(evalCorpus: EvalCorpus): void {
  const ids = knownRecordIds(evalCorpus.records)
  assert.equal(evalCorpus.id, CORPUS_ID)
  assert.equal(new Set(evalCorpus.queries.map((query) => query.id)).size, evalCorpus.queries.length)
  assert.equal(evalCorpus.queries.some((query) => query.lane === "continuity"), true)
  assert.equal(evalCorpus.queries.some((query) => query.lane === "recall"), true)

  for (const record of evalCorpus.records) {
    assert.equal(record.scope.type, "project")
    assert.equal(record.scope.key, PROJECT_SCOPE_KEY)
    assert.equal(record.status, "approved")
    assert.equal(containsLikelySecret(record.text), false, `${record.id} should not look like a secret`)
    assert.match(record.createdAt, /^2026-06-/u)
    assert.match(record.updatedAt, /^2026-06-/u)
  }

  for (const query of evalCorpus.queries) {
    assert.ok(query.k > 0)
    const expectedBenchmarkLane: BenchmarkLane = query.lane === "recall" ? "retrieval" : "continuity"
    assertBenchmarkMetadata(query.benchmark, expectedBenchmarkLane, query.id)
    for (const id of Object.keys(query.labels)) assert.equal(ids.has(id), true, `${query.id} labels unknown id ${id}`)
    assert.equal(Object.values(query.labels).some((label) => label === "required"), true, `${query.id} needs at least one required label`)
    for (const expectation of query.continuityExpectations ?? []) {
      for (const id of [...(expectation.required ?? []), ...(expectation.acceptable ?? []), ...(expectation.forbidden ?? [])]) {
        assert.equal(ids.has(id), true, `${query.id} expectation references unknown id ${id}`)
      }
    }
  }
}
