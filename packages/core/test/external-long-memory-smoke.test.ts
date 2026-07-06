import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  benchmarkForLongMemoryCategory,
  buildLongMemorySmokeReport,
  datasetPathFromArgs,
  numberFlagFromArgs,
  reportIsSatisfactory,
  requireDatasetPath,
} from "./external-long-memory-smoke-harness.js"
import { tempDir } from "./helpers.js"

function writeDataset(fileName: string, dataset: unknown): string {
  const dir = tempDir()
  const datasetPath = path.join(dir, fileName)
  fs.writeFileSync(datasetPath, JSON.stringify(dataset, null, 2), "utf8")
  return datasetPath
}

test("requires an explicit local dataset path and never implies download", () => {
  assert.equal(datasetPathFromArgs(["--dataset", "fixture.json"], {}), "fixture.json")
  assert.equal(datasetPathFromArgs(["--dataset=fixture.json"], {}), "fixture.json")
  assert.equal(datasetPathFromArgs([], { MEMORY_LANE_LONG_MEMORY_SMOKE_DATASET: "env-fixture.json" }), "env-fixture.json")
  assert.throws(
    () => requireDatasetPath([], {}),
    /requires an explicit local dataset path.*No dataset is downloaded.*no network, model, or judge is used/u,
  )
  assert.equal(numberFlagFromArgs(["--limit", "2"], "limit", 20), 2)
  assert.throws(() => numberFlagFromArgs(["--k=0"], "k", 5), /--k must be a positive integer/u)
})

test("maps documented long-memory categories into test-only taxonomy", () => {
  assert.deepEqual(benchmarkForLongMemoryCategory("single-session-user", ["s1"]), { ability: "direct-recall", lane: "retrieval" })
  assert.deepEqual(benchmarkForLongMemoryCategory("single-session-assistant", ["s1"]), { ability: "direct-recall", lane: "retrieval" })
  assert.deepEqual(benchmarkForLongMemoryCategory("single-session-preference", ["s1"]), { ability: "direct-recall", lane: "retrieval" })
  assert.deepEqual(benchmarkForLongMemoryCategory("information-extraction", ["s1"]), { ability: "direct-recall", lane: "retrieval" })
  assert.deepEqual(benchmarkForLongMemoryCategory("multi-session", ["s1", "s2"]), { ability: "direct-recall", lane: "retrieval" })
  assert.deepEqual(benchmarkForLongMemoryCategory("temporal-reasoning", ["s1"]), { ability: "temporal-currentness", lane: "retrieval" })
  assert.deepEqual(benchmarkForLongMemoryCategory("knowledge-update", ["s1"]), { ability: "knowledge-update", lane: "retrieval" })
  assert.deepEqual(benchmarkForLongMemoryCategory("abstention", []), { ability: "false-premise-abstention", lane: "retrieval" })
})

test("builds a stable optional smoke report without mutating the dataset directory", async () => {
  const dataset = {
    corpus_id: "tiny-longmemeval-smoke-subset-v1",
    records: [
      {
        question_id: "favorite-editor",
        category: "single-session-preference",
        question: "Which editor did Mira choose for release notes?",
        answer_session_ids: ["session-editor"],
        haystack_session_ids: ["session-editor", "session-distractor"],
        haystack_sessions: [
          [
            { role: "user", content: "Mira chose Helix as the editor for release notes." },
            { role: "assistant", content: "Noted that Helix is the release notes editor." },
          ],
          [{ role: "user", content: "This unrelated session discusses installer packaging." }],
        ],
      },
      {
        question_id: "pricing-currentness",
        category: "temporal-reasoning",
        question: "What is the current pricing plan?",
        answer_session_ids: ["session-current-pricing"],
        haystack_session_ids: ["session-old-pricing", "session-current-pricing"],
        haystack_sessions: [
          [{ role: "user", content: "Old pricing was Basic during the first beta." }],
          [{ role: "user", content: "Current pricing plan is Pro after the July update." }],
        ],
      },
      {
        question_id: "unsupported-false-premise_abs",
        category: "single-session-user",
        question: "Which office did the user move to?",
        answer_session_ids: ["session-office"],
        haystack_session_ids: ["session-office"],
        haystack_sessions: [[{ role: "user", content: "No office move was discussed." }]],
      },
    ],
  }
  const datasetPath = writeDataset("longmemeval-smoke.json", dataset)
  const datasetDir = path.dirname(datasetPath)
  const before = fs.readdirSync(datasetDir).sort()

  const report = await buildLongMemorySmokeReport({ datasetPath, limit: 3, k: 2 })

  assert.deepEqual(fs.readdirSync(datasetDir).sort(), before)
  assert.equal(report.generatedAt, "2026-07-06T12:00:00.000Z")
  assert.equal(report.corpusId, "tiny-longmemeval-smoke-subset-v1")
  assert.equal(report.mode, "external-long-memory-smoke-local-dataset")
  assert.deepEqual(report.source, {
    datasetFile: "longmemeval-smoke.json",
    recordCount: 3,
    evaluatedCount: 2,
    abstentionCount: 1,
    limit: 3,
    k: 2,
    networkRequired: false,
    modelRequired: false,
    judgeRequired: false,
  })
  assert.deepEqual(report.scenarioResults.map((result) => result.id), ["favorite-editor", "pricing-currentness"])
  assert.equal(report.scenarioResults.every((result) => result.passed), true)
  assert.deepEqual(report.scenarioResults[0]?.actualSessionIds, ["session-editor", "session-distractor"])
  assert.deepEqual(report.scenarioResults[1]?.actualSessionIds, ["session-current-pricing", "session-old-pricing"])
  assert.deepEqual(report.abstentionResults, [{
    id: "unsupported-false-premise_abs",
    category: "single-session-user",
    benchmark: { ability: "false-premise-abstention", lane: "retrieval" },
    question: "Which office did the user move to?",
    skipped: true,
    reason: "abstention-has-no-answer-session",
  }])
  assert.deepEqual(report.summary, {
    scenarioCount: 2,
    passCount: 2,
    failCount: 0,
    zeroToleranceFailures: 0,
    abstentionCount: 1,
    meanSessionRecallAtK: 1,
    failureTagCounts: {},
    satisfactory: true,
  })
  assert.equal(reportIsSatisfactory(report), true)
})

test("reports recall misses without failing the adapter gate", async () => {
  const datasetPath = writeDataset("recall-miss-longmemeval-smoke.json", {
    records: [{
      question_id: "answer-not-top-ranked",
      category: "single-session-user",
      question: "Which session mentions alpha?",
      answer_session_ids: ["expected-session"],
      haystack_session_ids: ["distractor-session", "expected-session"],
      haystack_sessions: [
        [{ role: "user", content: "The alpha keyword appears only in this distractor." }],
        [{ role: "user", content: "The expected answer session talks about beta." }],
      ],
    }],
  })

  const report = await buildLongMemorySmokeReport({ datasetPath, limit: 1, k: 1 })

  assert.deepEqual(report.scenarioResults[0]?.failureTags, ["missing-answer-session"])
  assert.equal(report.scenarioResults[0]?.passed, true)
  assert.equal(report.summary.zeroToleranceFailures, 0)
  assert.equal(report.summary.meanSessionRecallAtK, 0)
  assert.equal(report.summary.satisfactory, true)
  assert.equal(reportIsSatisfactory(report), true)
})


test("reports missing answer sessions as zero-tolerance failures", async () => {
  const datasetPath = writeDataset("broken-longmemeval-smoke.json", {
    records: [{
      question_id: "missing-evidence",
      category: "knowledge-update",
      question: "Which launch window is current?",
      answer_session_ids: ["missing-session"],
      haystack_session_ids: ["present-session"],
      haystack_sessions: [[{ role: "user", content: "Current launch window is August." }]],
    }],
  })

  const report = await buildLongMemorySmokeReport({ datasetPath, limit: 1, k: 1 })

  assert.deepEqual(report.scenarioResults[0]?.failureTags, ["invalid-record", "missing-answer-session"])
  assert.equal(report.summary.zeroToleranceFailures, 1)
  assert.equal(report.summary.satisfactory, false)
  assert.equal(reportIsSatisfactory(report), false)
})
