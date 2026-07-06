import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { DEFAULT_CONFIG, MemoryEngine, type MemoryRecord, type ProjectScope } from "../src/index.js"
import { tempDir } from "./helpers.js"
import { isGateSatisfactory, summarizeEvalGate, type BenchmarkAbility, type BenchmarkMetadata } from "./eval-report-helpers.js"

export const GENERATED_AT = "2026-07-06T12:00:00.000Z"
export const MODE = "external-long-memory-smoke-local-dataset"
export const PROJECT_SCOPE_KEY = "external-long-memory-smoke-project"
export const DEFAULT_K = 5
export const DEFAULT_LIMIT = 20

export type ExternalLongMemoryFailureTag = "missing-answer-session" | "no-evidence-sessions" | "invalid-record"

export const ZERO_TOLERANCE_FAILURE_TAGS: Partial<Record<ExternalLongMemoryFailureTag, true>> = {
  "invalid-record": true,
}

export interface LongMemoryTurn {
  role?: string
  content?: string
  text?: string
}

export interface LongMemorySession {
  session_id?: string
  sessionId?: string
  id?: string
  turns?: LongMemoryTurn[]
  messages?: LongMemoryTurn[]
  transcript?: string
  text?: string
}

export interface LongMemoryRecord {
  id?: string
  question_id?: string
  question?: string
  query?: string
  category?: string
  question_type?: string
  answer_session_ids?: string[]
  answerSessionIds?: string[]
  sessions?: LongMemorySession[]
  haystack_sessions?: LongMemorySession[] | LongMemoryTurn[][]
  haystack_session_ids?: string[]
}

export interface LongMemoryDataset {
  corpus_id?: string
  dataset_id?: string
  records?: LongMemoryRecord[]
  data?: LongMemoryRecord[]
}

export interface LongMemorySmokeOptions {
  datasetPath: string
  limit?: number
  k?: number
}

export interface LongMemorySmokeScenarioResult {
  id: string
  category: string
  benchmark: BenchmarkMetadata
  question: string
  k: number
  expectedSessionIds: string[]
  actualSessionIds: string[]
  recallAtK: number
  passed: boolean
  failureTags: ExternalLongMemoryFailureTag[]
}

export interface LongMemorySmokeAbstentionResult {
  id: string
  category: string
  benchmark: BenchmarkMetadata
  question: string
  skipped: true
  reason: "abstention-has-no-answer-session"
}

export interface LongMemorySmokeReport {
  generatedAt: string
  corpusId: string
  mode: typeof MODE
  source: {
    datasetFile: string
    recordCount: number
    evaluatedCount: number
    abstentionCount: number
    limit: number
    k: number
    networkRequired: false
    modelRequired: false
    judgeRequired: false
  }
  scenarioResults: LongMemorySmokeScenarioResult[]
  abstentionResults: LongMemorySmokeAbstentionResult[]
  summary: {
    scenarioCount: number
    passCount: number
    failCount: number
    zeroToleranceFailures: number
    abstentionCount: number
    meanSessionRecallAtK: number
    failureTagCounts: Record<string, number>
    satisfactory: boolean
  }
}

export function datasetPathFromArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  const flagIndex = argv.findIndex((arg) => arg === "--dataset")
  if (flagIndex >= 0) return argv[flagIndex + 1]
  const equalsArg = argv.find((arg) => arg.startsWith("--dataset="))
  if (equalsArg) return equalsArg.slice("--dataset=".length)
  return env.MEMORY_LANE_LONG_MEMORY_SMOKE_DATASET
}

export function numberFlagFromArgs(argv: readonly string[], name: string, fallback: number): number {
  const flagIndex = argv.findIndex((arg) => arg === `--${name}`)
  const value = flagIndex >= 0 ? argv[flagIndex + 1] : argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer`)
  return parsed
}

export function requireDatasetPath(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): string {
  const datasetPath = datasetPathFromArgs(argv, env)
  if (!datasetPath) {
    throw new Error(
      "Long-memory smoke adapter requires an explicit local dataset path. Pass --dataset <path> or set MEMORY_LANE_LONG_MEMORY_SMOKE_DATASET. No dataset is downloaded and no network, model, or judge is used.",
    )
  }
  return datasetPath
}

function stableCategory(category: string | undefined): string {
  return (category ?? "information-extraction").trim().toLowerCase()
}

export function benchmarkForLongMemoryCategory(category: string, answerSessionIds: readonly string[]): BenchmarkMetadata {
  const normalized = stableCategory(category)
  let ability: BenchmarkAbility = "direct-recall"
  if (answerSessionIds.length === 0 || normalized.includes("abstention")) ability = "false-premise-abstention"
  else if (normalized === "temporal-reasoning") ability = "temporal-currentness"
  else if (normalized === "knowledge-update") ability = "knowledge-update"
  else if (normalized === "multi-session") ability = "direct-recall"
  else if (normalized === "single-session-user" || normalized === "single-session-assistant" || normalized === "single-session-preference") ability = "direct-recall"
  else if (normalized === "information-extraction") ability = "direct-recall"
  return { ability, lane: "retrieval" }
}

function readDataset(datasetPath: string): LongMemoryDataset {
  const raw = fs.readFileSync(datasetPath, "utf8")
  const parsed = JSON.parse(raw) as unknown
  if (Array.isArray(parsed)) return { records: parsed as LongMemoryRecord[] }
  if (!parsed || typeof parsed !== "object") throw new Error("Long-memory smoke dataset must be a JSON object or array")
  return parsed as LongMemoryDataset
}

function recordsFromDataset(dataset: LongMemoryDataset): LongMemoryRecord[] {
  const records = dataset.records ?? dataset.data
  if (!Array.isArray(records)) throw new Error("Long-memory smoke dataset must contain a records or data array")
  return records
}

function sessionText(session: LongMemorySession | LongMemoryTurn[]): string {
  if (Array.isArray(session)) return session.map((turn) => `${turn.role ?? "unknown"}: ${turn.content ?? turn.text ?? ""}`).join("\n")
  if (session.transcript) return session.transcript
  if (session.text) return session.text
  const turns = session.turns ?? session.messages ?? []
  return turns.map((turn) => `${turn.role ?? "unknown"}: ${turn.content ?? turn.text ?? ""}`).join("\n")
}

function answerSessionIds(record: LongMemoryRecord): string[] {
  return [...new Set(record.answer_session_ids ?? record.answerSessionIds ?? [])]
}

function recordQuestion(record: LongMemoryRecord, id: string): string {
  const question = record.question ?? record.query
  if (!question) throw new Error(`${id} is missing question`)
  return question
}

function normalizedSessions(record: LongMemoryRecord, id: string): { id: string; text: string }[] {
  if (record.sessions) {
    return record.sessions.map((session, index) => {
      const sessionId = session.session_id ?? session.sessionId ?? session.id
      if (!sessionId) throw new Error(`${id} session ${index + 1} is missing session_id`)
      return { id: sessionId, text: sessionText(session) }
    })
  }
  if (record.haystack_sessions && record.haystack_session_ids) {
    if (record.haystack_sessions.length !== record.haystack_session_ids.length) {
      throw new Error(`${id} haystack_sessions and haystack_session_ids lengths differ`)
    }
    return record.haystack_sessions.map((session, index) => ({ id: record.haystack_session_ids![index]!, text: sessionText(session) }))
  }
  throw new Error(`${id} is missing sessions or haystack_sessions with haystack_session_ids`)
}

function memoryForSession(recordId: string, session: { id: string; text: string }): MemoryRecord {
  return {
    id: `${recordId}:${session.id}`,
    text: session.text,
    category: "project",
    scope: { type: "project", key: PROJECT_SCOPE_KEY },
    status: "approved",
    source: "session-summary",
    kind: "session_summary",
    createdAt: "2026-07-06T10:00:00.000Z",
    updatedAt: "2026-07-06T10:00:00.000Z",
    provenance: { adapter: "long-memory-smoke", lifecycleEvent: "session_end", sessionId: session.id },
  }
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

async function retrieveSessionIds(question: string, memories: MemoryRecord[], k: number): Promise<string[]> {
  const dir = tempDir()
  const fixtureRoot = path.join(dir, "project")
  fs.mkdirSync(fixtureRoot, { recursive: true })
  const engine = new MemoryEngine({
    memoryPath: writeMemoryLog(dir, memories),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath: writeConfig(dir),
  })
  const projectScope: ProjectScope = { key: PROJECT_SCOPE_KEY, root: fixtureRoot, cwd: fixtureRoot }
  const result = await engine.recall(question, { projectScope })
  assert.equal(result.semantic.used, false)
  return result.memories
    .slice(0, k)
    .map((record) => record.provenance?.sessionId)
    .filter((id): id is string => Boolean(id))
}

function recallAtK(expected: readonly string[], actual: readonly string[]): number {
  if (expected.length === 0) return Number.NaN
  return expected.filter((id) => actual.includes(id)).length / expected.length
}

export async function evaluateLongMemoryRecord(record: LongMemoryRecord, index: number, k: number): Promise<LongMemorySmokeScenarioResult | LongMemorySmokeAbstentionResult> {
  const id = record.id ?? record.question_id ?? `record-${index + 1}`
  const question = recordQuestion(record, id)
  const isAbstention = id.endsWith("_abs")
  const category = stableCategory(record.category ?? record.question_type ?? (isAbstention ? "abstention" : undefined))
  const expectedSessionIds = answerSessionIds(record)
  const benchmark = benchmarkForLongMemoryCategory(category, isAbstention ? [] : expectedSessionIds)
  if (expectedSessionIds.length === 0 || isAbstention) {
    return { id, category, benchmark, question, skipped: true, reason: "abstention-has-no-answer-session" }
  }

  const sessions = normalizedSessions(record, id)
  const memories = sessions.map((session) => memoryForSession(id, session))
  const evidenceSessionIds = new Set(memories.map((memory) => memory.provenance?.sessionId).filter(Boolean))
  const actualSessionIds = await retrieveSessionIds(question, memories, k)
  const missingExpectedEvidence = expectedSessionIds.some((expectedId) => !evidenceSessionIds.has(expectedId))
  const failureTags: ExternalLongMemoryFailureTag[] = []
  if (missingExpectedEvidence) failureTags.push("invalid-record")
  if (actualSessionIds.length === 0) failureTags.push("no-evidence-sessions")
  if (expectedSessionIds.some((expectedId) => !actualSessionIds.includes(expectedId))) failureTags.push("missing-answer-session")
  const recall = recallAtK(expectedSessionIds, actualSessionIds)
  return {
    id,
    category,
    benchmark,
    question,
    k,
    expectedSessionIds,
    actualSessionIds,
    recallAtK: recall,
    passed: !failureTags.includes("invalid-record"),
    failureTags: [...new Set(failureTags)],
  }
}

export async function buildLongMemorySmokeReport(options: LongMemorySmokeOptions): Promise<LongMemorySmokeReport> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const k = options.k ?? DEFAULT_K
  const dataset = readDataset(options.datasetPath)
  const allRecords = recordsFromDataset(dataset)
  const selectedRecords = allRecords.slice(0, limit)
  const results = await Promise.all(selectedRecords.map((record, index) => evaluateLongMemoryRecord(record, index, k)))
  const scenarioResults = results.filter((result): result is LongMemorySmokeScenarioResult => !("skipped" in result))
  const abstentionResults = results.filter((result): result is LongMemorySmokeAbstentionResult => "skipped" in result)
  const gateSummary = summarizeEvalGate(scenarioResults, ZERO_TOLERANCE_FAILURE_TAGS)
  const meanSessionRecallAtK = scenarioResults.length === 0
    ? Number.NaN
    : scenarioResults.reduce((sum, result) => sum + result.recallAtK, 0) / scenarioResults.length
  const satisfactory = isGateSatisfactory(gateSummary) && Number.isFinite(meanSessionRecallAtK)
  return {
    generatedAt: GENERATED_AT,
    corpusId: dataset.corpus_id ?? dataset.dataset_id ?? "external-long-memory-smoke",
    mode: MODE,
    source: {
      datasetFile: path.basename(options.datasetPath),
      recordCount: allRecords.length,
      evaluatedCount: scenarioResults.length,
      abstentionCount: abstentionResults.length,
      limit,
      k,
      networkRequired: false,
      modelRequired: false,
      judgeRequired: false,
    },
    scenarioResults,
    abstentionResults,
    summary: {
      scenarioCount: gateSummary.scenarioCount,
      passCount: gateSummary.passCount,
      failCount: gateSummary.failCount,
      zeroToleranceFailures: gateSummary.zeroToleranceFailures,
      abstentionCount: abstentionResults.length,
      meanSessionRecallAtK,
      failureTagCounts: gateSummary.failureTagCounts,
      satisfactory,
    },
  }
}

export function reportIsSatisfactory(report: LongMemorySmokeReport): boolean {
  return isGateSatisfactory(report.summary) && Number.isFinite(report.summary.meanSessionRecallAtK)
}
