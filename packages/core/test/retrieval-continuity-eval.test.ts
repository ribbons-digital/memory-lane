import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  DEFAULT_CONFIG,
  MemoryEngine,
  buildContinuityReadModel,
  containsLikelySecret,
  foldMemoryRecords,
  isCurrentnessRecallQuery,
  lexicalScore,
  type ContinuityReadModel,
  type MemoryRecord,
  type ProjectScope,
} from "../src/index.js"
import { tempDir } from "./helpers.js"

const PROJECT_SCOPE_KEY = "eval/project"
const GENERATED_AT = "2026-06-27T12:00:00.000Z"
const CORPUS_ID = "retrieval-continuity-baseline-v1"
const KNOWN_FAILURE_TAGS = new Set(["missing-required", "forbidden-returned", "wrong-slot", "stale-over-current", "topic-mismatch"])

type EvalLane = "continuity" | "recall"
type RelevanceLabel = "required" | "acceptable" | "distractor" | "forbidden"
type ContinuitySlot = "latestProgress" | "operatingGuidance" | "workstreamDiscovery.candidates" | "pendingContinuity"

interface ContinuityExpectation {
  slot: ContinuitySlot
  required?: string[]
  acceptable?: string[]
  forbidden?: string[]
}

interface EvalQuery {
  id: string
  lane: EvalLane
  query: string
  k: number
  labels: Record<string, RelevanceLabel>
  continuityExpectations?: ContinuityExpectation[]
}

interface EvalCorpus {
  id: string
  records: MemoryRecord[]
  queries: EvalQuery[]
}

interface SlotResult {
  slot: ContinuitySlot
  actualIds: string[]
  missingRequired: string[]
  forbiddenPresent: string[]
}

interface EvalQueryResult {
  id: string
  lane: EvalLane
  query: string
  k: number
  actualIds: string[]
  recallAtK?: number
  precisionAtK?: number
  slotResults?: SlotResult[]
  failureTags: string[]
}

interface EvalReport {
  generatedAt: string
  corpusId: string
  mode: "default-no-embedding"
  queryResults: EvalQueryResult[]
  summary: {
    queryCount: number
    meanRecallAtK?: number
    meanPrecisionAtK?: number
    failureTagCounts: Record<string, number>
  }
}

function memory(overrides: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
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
  }
}

const corpus: EvalCorpus = {
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
      query: "where did we fix PR body formatting?",
      k: 3,
      labels: {
        "eval-pr-body-rule": "required",
        "eval-pr-process-agreement": "acceptable",
        "eval-release-v038": "distractor",
      },
      continuityExpectations: [{ slot: "workstreamDiscovery.candidates", required: ["eval-pr-body-rule"], forbidden: ["eval-release-v038"] }],
    },
    {
      id: "recall-pr-description-rule",
      lane: "recall",
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
      query: "what is the current Memory Lane release status?",
      k: 3,
      labels: {
        "eval-release-v038": "required",
        "eval-docs-sync-v038": "acceptable",
        "eval-stale-v037": "forbidden",
      },
    },
  ],
}

function knownRecordIds(records: MemoryRecord[]): Set<string> {
  return new Set(records.map((record) => record.id))
}

function slotIds(model: ContinuityReadModel, slot: ContinuitySlot): string[] {
  if (slot === "latestProgress") return model.latestProgress ? [model.latestProgress.id] : []
  if (slot === "operatingGuidance") return model.operatingGuidance?.map((item) => item.id) ?? []
  if (slot === "pendingContinuity") return model.pendingContinuity.map((item) => item.id)
  return model.workstreamDiscovery?.candidates.map((item) => item.id) ?? []
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function labelFor(query: EvalQuery, id: string): RelevanceLabel {
  return query.labels[id] ?? "distractor"
}

function recallAtK(labels: Record<string, RelevanceLabel>, actualIds: string[]): number {
  const required = Object.entries(labels).filter(([, label]) => label === "required").map(([id]) => id)
  return ratio(required.filter((id) => actualIds.includes(id)).length, required.length)
}

function precisionAtK(query: EvalQuery, actualIds: string[]): number {
  const relevantCount = actualIds.filter((id) => {
    const label = labelFor(query, id)
    return label === "required" || label === "acceptable"
  }).length
  return ratio(relevantCount, actualIds.length)
}

function failureTagsForRanked(query: EvalQuery, actualIds: string[]): string[] {
  const tags: string[] = []
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

function scoreNonZeroIds(query: EvalQuery, memories: MemoryRecord[]): string[] {
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

async function evaluateRecall(query: EvalQuery, records: MemoryRecord[]): Promise<EvalQueryResult> {
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
  return {
    id: query.id,
    lane: query.lane,
    query: query.query,
    k: query.k,
    actualIds,
    recallAtK: recallAtK(query.labels, actualIds),
    precisionAtK: precisionAtK(query, actualIds),
    failureTags: failureTagsForRanked(query, actualIds),
  }
}

function evaluateContinuity(query: EvalQuery, records: MemoryRecord[]): EvalQueryResult {
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

  return {
    id: query.id,
    lane: query.lane,
    query: query.query,
    k: query.k,
    actualIds,
    recallAtK: rankedExpectation ? recallAtK(query.labels, rankedIds) : undefined,
    precisionAtK: rankedExpectation ? precisionAtK(query, rankedIds) : undefined,
    slotResults,
    failureTags: unique([...slotFailureTags, ...(rankedExpectation ? failureTagsForRanked(query, rankedIds) : [])]),
  }
}

async function buildEvalReport(evalCorpus: EvalCorpus): Promise<EvalReport> {
  const queryResults: EvalQueryResult[] = []
  for (const query of evalCorpus.queries) {
    queryResults.push(query.lane === "recall"
      ? await evaluateRecall(query, evalCorpus.records)
      : evaluateContinuity(query, evalCorpus.records))
  }
  const recallValues = queryResults.flatMap((result) => result.recallAtK === undefined ? [] : [result.recallAtK])
  const precisionValues = queryResults.flatMap((result) => result.precisionAtK === undefined ? [] : [result.precisionAtK])
  const failureTagCounts: Record<string, number> = {}
  for (const result of queryResults) {
    for (const tag of result.failureTags) failureTagCounts[tag] = (failureTagCounts[tag] ?? 0) + 1
  }
  return {
    generatedAt: GENERATED_AT,
    corpusId: evalCorpus.id,
    mode: "default-no-embedding",
    queryResults,
    summary: {
      queryCount: queryResults.length,
      meanRecallAtK: ratio(recallValues.reduce((sum, value) => sum + value, 0), recallValues.length),
      meanPrecisionAtK: ratio(precisionValues.reduce((sum, value) => sum + value, 0), precisionValues.length),
      failureTagCounts,
    },
  }
}

test("retrieval/continuity eval corpus is structurally valid and sanitized", () => {
  const ids = knownRecordIds(corpus.records)
  assert.equal(corpus.id, CORPUS_ID)
  assert.equal(corpus.records.length, 7)
  assert.equal(corpus.queries.length, 6)
  assert.equal(new Set(corpus.queries.map((query) => query.id)).size, corpus.queries.length)
  assert.equal(corpus.queries.some((query) => query.lane === "continuity"), true)
  assert.equal(corpus.queries.some((query) => query.lane === "recall"), true)

  for (const record of corpus.records) {
    assert.equal(record.scope.type, "project")
    assert.equal(record.scope.key, PROJECT_SCOPE_KEY)
    assert.equal(record.status, "approved")
    assert.equal(containsLikelySecret(record.text), false, `${record.id} should not look like a secret`)
    assert.match(record.createdAt, /^2026-06-/u)
    assert.match(record.updatedAt, /^2026-06-/u)
  }

  for (const query of corpus.queries) {
    assert.ok(query.k > 0)
    for (const id of Object.keys(query.labels)) assert.equal(ids.has(id), true, `${query.id} labels unknown id ${id}`)
    assert.equal(Object.values(query.labels).some((label) => label === "required"), true, `${query.id} needs at least one required label`)
    for (const expectation of query.continuityExpectations ?? []) {
      for (const id of [...(expectation.required ?? []), ...(expectation.acceptable ?? []), ...(expectation.forbidden ?? [])]) {
        assert.equal(ids.has(id), true, `${query.id} expectation references unknown id ${id}`)
      }
    }
  }
})

test("currentness recall query detection stays narrow", () => {
  assert.equal(isCurrentnessRecallQuery("what is the current Memory Lane release status?"), true)
  assert.equal(isCurrentnessRecallQuery("latest release status"), true)
  assert.equal(isCurrentnessRecallQuery("current project checkpoint"), true)
  assert.equal(isCurrentnessRecallQuery("how should I create GitHub PR descriptions?"), false)
  assert.equal(isCurrentnessRecallQuery("what release shipped docs context-budget?"), false)
  assert.equal(isCurrentnessRecallQuery("where did we fix PR body formatting?"), false)
})

test("current release status baseline has equal lexical scores with oldest-created checkpoint first", () => {
  const query = corpus.queries.find((item) => item.id === "recall-current-release-status")
  assert.ok(query)
  const folded = foldMemoryRecords(corpus.records)
  const lexicalOnlyIds = folded
    .map((record) => ({ record, score: lexicalScore(query.query, record.text) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.record.id)

  const staleScore = lexicalScore(query.query, corpus.records.find((record) => record.id === "eval-stale-v037")?.text ?? "")
  const currentScore = lexicalScore(query.query, corpus.records.find((record) => record.id === "eval-release-v038")?.text ?? "")
  assert.equal(staleScore, 1)
  assert.equal(currentScore, 1)
  assert.deepEqual(lexicalOnlyIds.slice(0, 2), ["eval-stale-v037", "eval-release-v038"])
  assert.deepEqual(failureTagsForRanked(query, lexicalOnlyIds.slice(0, query.k)), ["forbidden-returned", "stale-over-current", "topic-mismatch"])
})

test("retrieval/continuity eval report has deterministic structural shape", async () => {
  const report = await buildEvalReport(corpus)

  assert.equal(report.generatedAt, GENERATED_AT)
  assert.equal(report.corpusId, CORPUS_ID)
  assert.equal(report.mode, "default-no-embedding")
  assert.equal(report.queryResults.length, corpus.queries.length)
  assert.equal(report.summary.queryCount, corpus.queries.length)
  assert.equal(typeof report.summary.meanRecallAtK, "number")
  assert.equal(typeof report.summary.meanPrecisionAtK, "number")

  for (const result of report.queryResults) {
    const query = corpus.queries.find((item) => item.id === result.id)
    assert.ok(query)
    assert.equal(result.lane, query.lane)
    assert.equal(result.query, query.query)
    assert.equal(result.k, query.k)
    assert.equal(result.actualIds.every((id) => corpus.records.some((record) => record.id === id)), true)
    assert.equal(result.failureTags.every((tag) => KNOWN_FAILURE_TAGS.has(tag)), true)
    if (result.lane === "continuity") {
      for (const slotResult of result.slotResults ?? []) {
        assert.notEqual(slotResult.slot, undefined)
        assert.equal(slotResult.actualIds.every((id) => corpus.records.some((record) => record.id === id)), true)
      }
      const hasRankedWorkstream = result.slotResults?.some((slot) => slot.slot === "workstreamDiscovery.candidates") ?? false
      if (!hasRankedWorkstream) {
        assert.equal(result.recallAtK, undefined)
        assert.equal(result.precisionAtK, undefined)
      }
    } else {
      assert.equal(typeof result.recallAtK, "number")
      assert.equal(typeof result.precisionAtK, "number")
    }
  }
})

test("currentness recall tie-break ranks newest release checkpoint ahead of stale checkpoint", async () => {
  const report = await buildEvalReport(corpus)
  const currentReleaseStatus = report.queryResults.find((result) => result.id === "recall-current-release-status")
  assert.ok(currentReleaseStatus)
  assert.deepEqual(currentReleaseStatus.actualIds.slice(0, 2), ["eval-release-v038", "eval-stale-v037"])
  assert.equal(currentReleaseStatus.failureTags.includes("stale-over-current"), false)
  assert.equal(currentReleaseStatus.failureTags.includes("forbidden-returned"), true)

  const prDescription = report.queryResults.find((result) => result.id === "recall-pr-description-rule")
  assert.ok(prDescription)
  assert.equal(prDescription.actualIds[0], "eval-pr-body-rule")

  const docsRelease = report.queryResults.find((result) => result.id === "recall-docs-context-budget-release")
  assert.ok(docsRelease)
  assert.equal(docsRelease.actualIds.includes("eval-release-v038"), true)
})

test("currentness tie-break preserves folded order outside checkpoint updatedAt ties", async () => {
  const currentnessQuery: EvalQuery = {
    id: "currentness-negative-gate",
    lane: "recall",
    query: "current release status",
    k: 2,
    labels: {
      "old-fact": "acceptable",
      "new-fact": "acceptable",
    },
  }
  const nonCheckpointResult = await evaluateRecall(currentnessQuery, [
    memory({ id: "old-fact", kind: "project_fact", createdAt: "2026-06-26T08:00:00.000Z", updatedAt: "2026-06-26T08:00:00.000Z", text: "Current release status note for the project." }),
    memory({ id: "new-fact", kind: "project_fact", createdAt: "2026-06-27T08:00:00.000Z", updatedAt: "2026-06-27T08:00:00.000Z", text: "Current release status note for the project." }),
  ])
  assert.deepEqual(nonCheckpointResult.actualIds, ["old-fact", "new-fact"])

  const nonCurrentnessQuery: EvalQuery = {
    id: "non-currentness-checkpoint-gate",
    lane: "recall",
    query: "release shipped docs context-budget",
    k: 2,
    labels: {
      "old-checkpoint": "acceptable",
      "new-checkpoint": "acceptable",
    },
  }
  const nonCurrentnessResult = await evaluateRecall(nonCurrentnessQuery, [
    memory({ id: "old-checkpoint", kind: "project_checkpoint", createdAt: "2026-06-26T08:00:00.000Z", updatedAt: "2026-06-26T08:00:00.000Z", text: "Release shipped docs context-budget." }),
    memory({ id: "new-checkpoint", kind: "project_checkpoint", createdAt: "2026-06-27T08:00:00.000Z", updatedAt: "2026-06-27T08:00:00.000Z", text: "Release shipped docs context-budget." }),
  ])
  assert.deepEqual(nonCurrentnessResult.actualIds, ["old-checkpoint", "new-checkpoint"])

  const allTiedResult = await evaluateRecall(currentnessQuery, [
    memory({ id: "old-checkpoint-tied", kind: "project_checkpoint", createdAt: "2026-06-26T08:00:00.000Z", updatedAt: "2026-06-28T08:00:00.000Z", text: "Current release status note for the project." }),
    memory({ id: "new-checkpoint-tied", kind: "project_checkpoint", createdAt: "2026-06-27T08:00:00.000Z", updatedAt: "2026-06-28T08:00:00.000Z", text: "Current release status note for the project." }),
  ])
  assert.deepEqual(allTiedResult.actualIds, ["old-checkpoint-tied", "new-checkpoint-tied"])
})

test("retrieval/continuity eval fixtures exercise intended continuity slots", () => {
  const broadStatus = corpus.queries.find((query) => query.id === "continuity-broad-status")
  const nextWork = corpus.queries.find((query) => query.id === "continuity-next-work")
  const workstream = corpus.queries.find((query) => query.id === "continuity-pr-body-workstream")
  assert.ok(broadStatus)
  assert.ok(nextWork)
  assert.ok(workstream)

  const broadModel = buildContinuityReadModel(corpus.records, { projectScopeKey: PROJECT_SCOPE_KEY, query: broadStatus.query, generatedAt: GENERATED_AT })
  assert.equal(broadModel.latestProgress?.id, "eval-current-track")
  assert.equal(broadModel.operatingGuidance?.some((item) => item.id === "eval-pr-body-rule"), true)
  assert.equal(broadModel.operatingGuidance?.some((item) => item.id === "eval-pr-process-agreement"), true)

  const nextModel = buildContinuityReadModel(corpus.records, { projectScopeKey: PROJECT_SCOPE_KEY, query: nextWork.query, generatedAt: GENERATED_AT })
  assert.equal(nextModel.latestProgress?.id, "eval-current-track")

  const workstreamModel = buildContinuityReadModel(corpus.records, { projectScopeKey: PROJECT_SCOPE_KEY, query: workstream.query, generatedAt: GENERATED_AT })
  assert.equal(workstreamModel.workstreamDiscovery?.candidates[0]?.id, "eval-pr-body-rule")
})
