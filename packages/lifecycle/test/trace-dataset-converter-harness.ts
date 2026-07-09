import * as fs from "node:fs"
import * as path from "node:path"
import { createHash, randomBytes } from "node:crypto"
import type { TraceRecordV1 } from "../src/trace-capture.ts"

export const TRACE_DATASET_SCHEMA_VERSION = 1
export const TRACE_DATASET_THIN_THRESHOLD = 50

type TraceFidelity = TraceRecordV1["fidelity"]

const TRACE_HARNESSES: Record<string, true> = { claude: true, codex: true, pi: true }
const TRACE_EVENTS: Record<string, true> = { "session-end": true, "pre-compact": true }
const TRACE_FIDELITIES = ["full-transcript", "payload-messages", "last-turn-fallback"] as const
const TRACE_ROLES: Record<string, true> = { user: true, assistant: true, tool: true }

export interface TraceDatasetRecord {
  question_id: string
  category: "single-session-user"
  question: string
  answer_session_ids: string[]
  haystack_session_ids: string[]
  haystack_dates: string[]
  haystack_sessions: Array<Array<{ role: string; content: string }>>
  trace_fidelity: TraceFidelity
}

export interface TraceDatasetMetadata {
  sourceTraceCount: number
  sessionCount: number
  unusableTraceCount: number
  duplicateTraceCount: number
  dateRange: {
    oldest: string
    newest: string
  }
  fidelityMix: Record<TraceFidelity, number>
  thinData: boolean
  thinDataThreshold: number
}

export interface TraceDataset {
  schemaVersion: 1
  dataset_id: string
  metadata: TraceDatasetMetadata
  records: TraceDatasetRecord[]
}

export interface TraceDatasetPaths {
  tracesDirectory: string
  outputPath: string
}

interface PreparedTrace {
  digest: string
  trace: TraceRecordV1
  question?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, key: string, filePath: string): string {
  const value = record[key]
  if (typeof value !== "string" || !value) throw new Error(`${filePath} has invalid ${key}`)
  return value
}

function optionalString(record: Record<string, unknown>, key: string, filePath: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${filePath} has invalid ${key}`)
  return value
}

function parseTraceFile(filePath: string): TraceRecordV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown
  } catch (error) {
    throw new Error(`Unable to parse trace ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isObject(parsed)) throw new Error(`${filePath} must contain a trace object`)
  if (parsed.schemaVersion !== 1) throw new Error(`${filePath} uses unsupported trace schemaVersion ${String(parsed.schemaVersion)}`)

  const capturedAt = requiredString(parsed, "capturedAt", filePath)
  const capturedAtMs = Date.parse(capturedAt)
  if (!Number.isFinite(capturedAtMs)) throw new Error(`${filePath} has invalid capturedAt`)

  const harness = requiredString(parsed, "harness", filePath)
  if (!Object.hasOwn(TRACE_HARNESSES, harness)) throw new Error(`${filePath} has invalid harness`)
  const event = requiredString(parsed, "event", filePath)
  if (!Object.hasOwn(TRACE_EVENTS, event)) throw new Error(`${filePath} has invalid event`)
  const fidelity = requiredString(parsed, "fidelity", filePath)
  if (!TRACE_FIDELITIES.includes(fidelity as TraceFidelity)) throw new Error(`${filePath} has invalid fidelity`)

  if (!Array.isArray(parsed.messages)) throw new Error(`${filePath} has invalid messages`)
  const messages = parsed.messages.map((message, index) => {
    if (!isObject(message)) throw new Error(`${filePath} has invalid message ${index + 1}`)
    const role = requiredString(message, "role", filePath)
    if (!Object.hasOwn(TRACE_ROLES, role)) throw new Error(`${filePath} has invalid message role`)
    if (typeof message.content !== "string") throw new Error(`${filePath} has invalid message content`)
    const timestamp = optionalString(message, "timestamp", filePath)
    const timestampMs = timestamp === undefined ? undefined : Date.parse(timestamp)
    if (timestamp !== undefined && (!timestamp || !Number.isFinite(timestampMs))) {
      throw new Error(`${filePath} has invalid message timestamp`)
    }
    return {
      role: role as TraceRecordV1["messages"][number]["role"],
      content: message.content,
      ...(timestampMs !== undefined ? { timestamp: new Date(timestampMs).toISOString() } : {}),
    }
  })

  if (!Number.isInteger(parsed.redactedMessageCount) || Number(parsed.redactedMessageCount) < 0) {
    throw new Error(`${filePath} has invalid redactedMessageCount`)
  }
  if (!isObject(parsed.meta)) throw new Error(`${filePath} has invalid meta`)
  const sessionId = optionalString(parsed, "sessionId", filePath)
  const turnId = optionalString(parsed, "turnId", filePath)
  const model = optionalString(parsed.meta, "model", filePath)
  const trigger = optionalString(parsed.meta, "trigger", filePath)
  const reason = optionalString(parsed.meta, "reason", filePath)

  return {
    schemaVersion: 1,
    capturedAt: new Date(capturedAtMs).toISOString(),
    projectKey: requiredString(parsed, "projectKey", filePath),
    harness: harness as TraceRecordV1["harness"],
    event: event as TraceRecordV1["event"],
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(turnId !== undefined ? { turnId } : {}),
    fidelity: fidelity as TraceFidelity,
    messages,
    redactedMessageCount: Number(parsed.redactedMessageCount),
    meta: {
      ...(model !== undefined ? { model } : {}),
      ...(trigger !== undefined ? { trigger } : {}),
      ...(reason !== undefined ? { reason } : {}),
    },
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (isObject(value)) {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function questionFromTrace(trace: TraceRecordV1): string | undefined {
  for (let index = trace.messages.length - 1; index >= 0; index -= 1) {
    const message = trace.messages[index]
    if (message?.role === "user" && message.content.trim()) return message.content.trim()
  }
  return undefined
}

function traceFilePaths(tracesDirectory: string): string[] {
  const entries = fs.readdirSync(tracesDirectory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(tracesDirectory, entry.name))
    .sort()
}

function preparedTraces(tracesDirectory: string): { traces: PreparedTrace[]; sourceTraceCount: number; duplicateTraceCount: number } {
  const files = traceFilePaths(tracesDirectory)
  const unique = new Map<string, PreparedTrace>()
  for (const filePath of files) {
    const trace = parseTraceFile(filePath)
    const traceDigest = digest(trace)
    if (!unique.has(traceDigest)) unique.set(traceDigest, { digest: traceDigest, trace, question: questionFromTrace(trace) })
  }
  return {
    traces: [...unique.values()].sort((left, right) => left.digest.localeCompare(right.digest)),
    sourceTraceCount: files.length,
    duplicateTraceCount: files.length - unique.size,
  }
}

export function buildTraceDataset(tracesDirectory: string): TraceDataset {
  const prepared = preparedTraces(tracesDirectory)
  const usable = prepared.traces.filter((entry) => entry.question !== undefined)
  if (usable.length === 0) throw new Error(`Trace dataset converter found zero usable traces in ${tracesDirectory}`)

  const fidelityMix: Record<TraceFidelity, number> = {
    "full-transcript": 0,
    "payload-messages": 0,
    "last-turn-fallback": 0,
  }
  for (const entry of usable) fidelityMix[entry.trace.fidelity] += 1

  const dates = usable.map((entry) => entry.trace.capturedAt).sort()
  const metadata: TraceDatasetMetadata = {
    sourceTraceCount: prepared.sourceTraceCount,
    sessionCount: usable.length,
    unusableTraceCount: prepared.traces.length - usable.length,
    duplicateTraceCount: prepared.duplicateTraceCount,
    dateRange: {
      oldest: dates[0]!,
      newest: dates[dates.length - 1]!,
    },
    fidelityMix,
    thinData: usable.length < TRACE_DATASET_THIN_THRESHOLD,
    thinDataThreshold: TRACE_DATASET_THIN_THRESHOLD,
  }

  const records = usable.map((entry): TraceDatasetRecord => {
    const sessionId = `trace-session-${entry.digest}`
    return {
      question_id: `trace-question-${entry.digest}`,
      category: "single-session-user",
      question: entry.question!,
      answer_session_ids: [sessionId],
      haystack_session_ids: [sessionId],
      haystack_dates: [entry.trace.capturedAt],
      haystack_sessions: [entry.trace.messages.map((message) => ({ role: message.role, content: message.content }))],
      trace_fidelity: entry.trace.fidelity,
    }
  })

  return {
    schemaVersion: TRACE_DATASET_SCHEMA_VERSION,
    dataset_id: `memory-lane-trace-smoke-${digest({ metadata, recordIds: records.map((record) => record.question_id) })}`,
    metadata,
    records,
  }
}

export function serializeTraceDataset(dataset: TraceDataset): string {
  return JSON.stringify(dataset, null, 2) + "\n"
}

function realPathWithMissingTail(targetPath: string): string {
  let existingPath = path.resolve(targetPath)
  const missingSegments: string[] = []
  while (!fs.existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath)
    if (parentPath === existingPath) break
    missingSegments.unshift(path.basename(existingPath))
    existingPath = parentPath
  }
  return path.join(fs.realpathSync(existingPath), ...missingSegments)
}

function assertOutputOutsideTracesDirectory(tracesDirectory: string, outputPath: string): void {
  const realTracesDirectory = fs.realpathSync(tracesDirectory)
  const realOutputPath = path.join(realPathWithMissingTail(path.dirname(outputPath)), path.basename(outputPath))
  const relativeOutputPath = path.relative(realTracesDirectory, realOutputPath)
  const outputIsOutside = relativeOutputPath === ".." || relativeOutputPath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutputPath)
  if (!outputIsOutside) throw new Error(`Trace dataset converter --out must resolve outside --traces (${tracesDirectory})`)
}

export function writeTraceDataset(tracesDirectory: string, outputPath: string): TraceDataset {
  assertOutputOutsideTracesDirectory(tracesDirectory, outputPath)
  const dataset = buildTraceDataset(tracesDirectory)
  const serialized = serializeTraceDataset(dataset)
  const outputDirectory = path.dirname(outputPath)
  fs.mkdirSync(outputDirectory, { recursive: true })
  const temporaryPath = path.join(outputDirectory, `.${path.basename(outputPath)}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`)
  try {
    fs.writeFileSync(temporaryPath, serialized, "utf8")
    fs.renameSync(temporaryPath, outputPath)
  } catch (error) {
    try { fs.unlinkSync(temporaryPath) } catch { /* best effort */ }
    throw error
  }
  return dataset
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const flag = `--${name}`
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === flag) {
      const value = argv[index + 1]
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`)
      return value
    }
    if (argument?.startsWith(`${flag}=`)) {
      const value = argument.slice(flag.length + 1)
      if (!value) throw new Error(`${flag} requires a value`)
      return value
    }
  }
  return undefined
}

export function requireTraceDatasetPaths(argv: readonly string[]): TraceDatasetPaths {
  const tracesDirectory = flagValue(argv, "traces")
  const outputPath = flagValue(argv, "out")
  if (!tracesDirectory || !outputPath) {
    throw new Error("Trace dataset converter requires explicit --traces <dir> and --out <file>; no default path is implied")
  }
  return { tracesDirectory, outputPath }
}
