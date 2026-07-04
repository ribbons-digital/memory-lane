import test from "node:test"
import assert from "node:assert/strict"
import {
  buildContinuityReadModel,
  foldMemoryRecords,
  isCurrentnessRecallQuery,
  lexicalScore,
} from "../src/index.js"
import {
  CORPUS_ID,
  GENERATED_AT,
  KNOWN_FAILURE_TAGS,
  PROJECT_SCOPE_KEY,
  assertCorpusStructurallyValid,
  buildEvalReport,
  corpus,
  evaluateContinuity,
  evaluateRecall,
  failureTagsForRanked,
  memory,
  ndcgAtK,
  type EvalQuery,
} from "./retrieval-eval-harness.js"

test("retrieval/continuity eval corpus is structurally valid and sanitized", () => {
  assert.equal(corpus.records.length, 7)
  assert.equal(corpus.queries.length, 6)
  assertCorpusStructurallyValid(corpus)
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

test("ranked eval metrics include NDCG so ordering improvements are visible", () => {
  const query: EvalQuery = {
    id: "metric-ordering",
    lane: "recall",
    query: "current release status",
    k: 3,
    labels: {
      required: "required",
      acceptable: "acceptable",
      distractor: "distractor",
    },
  }
  assert.equal(ndcgAtK(query, ["required", "acceptable", "distractor"]), 1)
  assert.ok(ndcgAtK(query, ["distractor", "acceptable", "required"]) < 1)
  assert.ok(ndcgAtK(query, ["required"]) < 1)
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
  assert.equal(typeof report.summary.meanNdcgAtK, "number")

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
        assert.equal(result.ndcgAtK, undefined)
      }
    } else {
      assert.equal(typeof result.recallAtK, "number")
      assert.equal(typeof result.precisionAtK, "number")
      assert.equal(typeof result.ndcgAtK, "number")
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

test("recall eval excludes non-approved and cross-project memories from automatic context", async () => {
  const query: EvalQuery = {
    id: "visibility-governance",
    lane: "recall",
    query: "current deployment runbook",
    k: 5,
    labels: {
      approved: "required",
      global: "acceptable",
      pending: "forbidden",
      rejected: "forbidden",
      deleted: "forbidden",
      otherProject: "forbidden",
    },
  }
  const result = await evaluateRecall(query, [
    memory({ id: "approved", text: "Current deployment runbook: use the reviewed release checklist." }),
    memory({ id: "global", category: "preference", scope: { type: "global" }, text: "Current deployment runbook preference: keep verification evidence terse." }),
    memory({ id: "pending", status: "pending", text: "Current deployment runbook: pending candidate must not influence automatic recall." }),
    memory({ id: "rejected", status: "rejected", text: "Current deployment runbook: rejected candidate must not influence automatic recall." }),
    memory({ id: "deleted", status: "deleted", text: "Current deployment runbook: deleted candidate must not influence automatic recall." }),
    memory({ id: "otherProject", scope: { type: "project", key: "eval/other-project" }, text: "Current deployment runbook: other project candidate must not influence automatic recall." }),
  ])
  assert.deepEqual(result.actualIds, ["approved", "global"])
  assert.equal(result.recallAtK, 1)
  assert.equal(result.precisionAtK, 1)
  assert.equal(result.failureTags.length, 0)
})

test("continuity eval excludes superseded progress from latest progress", () => {
  const query: EvalQuery = {
    id: "superseded-progress",
    lane: "continuity",
    query: "where are we in the project?",
    k: 3,
    labels: {
      currentProgress: "required",
      oldProgress: "forbidden",
    },
    continuityExpectations: [{ slot: "latestProgress", required: ["currentProgress"], forbidden: ["oldProgress"] }],
  }
  const result = evaluateContinuity(query, [
    memory({
      id: "oldProgress",
      kind: "project_checkpoint",
      updatedAt: "2026-06-28T08:00:00.000Z",
      text: "Current Memory Lane project progress checkpoint: old eval plan was superseded.",
      revision: { supersededBy: "currentProgress", reason: "newer approved checkpoint", revisedAt: "2026-06-28T09:00:00.000Z", revisedBy: "manual" },
    }),
    memory({
      id: "currentProgress",
      kind: "project_checkpoint",
      updatedAt: "2026-06-27T08:00:00.000Z",
      text: "Current Memory Lane project progress checkpoint: active eval plan is the benchmark harness slice.",
    }),
  ])
  assert.equal(result.slotResults?.[0]?.actualIds[0], "currentProgress")
  assert.equal(result.failureTags.length, 0)
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
  assert.equal(broadModel.operatingGuidance?.some((item) => item.id === "eval-pr-body-rule"), false)
  assert.equal(broadModel.operatingGuidance?.some((item) => item.id === "eval-pr-process-agreement"), true)

  const nextModel = buildContinuityReadModel(corpus.records, { projectScopeKey: PROJECT_SCOPE_KEY, query: nextWork.query, generatedAt: GENERATED_AT })
  assert.equal(nextModel.latestProgress?.id, "eval-current-track")

  const workstreamModel = buildContinuityReadModel(corpus.records, { projectScopeKey: PROJECT_SCOPE_KEY, query: workstream.query, generatedAt: GENERATED_AT })
  assert.equal(workstreamModel.workstreamDiscovery?.candidates[0]?.id, "eval-pr-body-rule")
})
