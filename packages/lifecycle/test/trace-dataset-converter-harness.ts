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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readJsonTrace(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown
  } catch (error) {
    throw new Error(`Unable to parse trace ${filePath}: ${errorMessage(error)}`)
  }
}

// fallow-ignore-next-line complexity
function parseTraceObject(filePath: string): Record<string, unknown> {
  const parsed = readJsonTrace(filePath)
  if (!isObject(parsed)) throw new Error(`${filePath} must contain a trace object`)
  if (parsed.schemaVersion !== 1) throw new Error(`${filePath} uses unsupported trace schemaVersion ${String(parsed.schemaVersion)}`)
  return parsed
}

function requiredDate(record: Record<string, unknown>, key: string, filePath: string): string {
  const value = requiredString(record, key, filePath)
  const valueMs = Date.parse(value)
  if (!Number.isFinite(valueMs)) throw new Error(`${filePath} has invalid ${key}`)
  return new Date(valueMs).toISOString()
}

function requiredKnownString<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[] | Record<string, true>,
  filePath: string,
): T {
  const value = requiredString(record, key, filePath)
  const isAllowed = Array.isArray(allowed) ? allowed.includes(value as T) : Object.hasOwn(allowed, value)
  if (!isAllowed) throw new Error(`${filePath} has invalid ${key}`)
  return value as T
}

function parseTraceMessage(message: unknown, index: number, filePath: string): TraceRecordV1["messages"][number] {
  if (!isObject(message)) throw new Error(`${filePath} has invalid message ${index + 1}`)
  const role = requiredKnownString(message, "role", TRACE_ROLES, filePath) as TraceRecordV1["messages"][number]["role"]
  if (typeof message.content !== "string") throw new Error(`${filePath} has invalid message content`)
  const timestamp = optionalString(message, "timestamp", filePath)
  return {
    role,
    content: message.content,
    ...(timestamp !== undefined ? { timestamp: parseMessageTimestamp(timestamp, filePath) } : {}),
  }
}

function parseMessageTimestamp(timestamp: string, filePath: string): string {
  const timestampMs = Date.parse(timestamp)
  if (!timestamp || !Number.isFinite(timestampMs)) throw new Error(`${filePath} has invalid message timestamp`)
  return new Date(timestampMs).toISOString()
}

function requiredMessages(parsed: Record<string, unknown>, filePath: string): TraceRecordV1["messages"] {
  if (!Array.isArray(parsed.messages)) throw new Error(`${filePath} has invalid messages`)
  return parsed.messages.map((message, index) => parseTraceMessage(message, index, filePath))
}

function requiredRedactedMessageCount(parsed: Record<string, unknown>, filePath: string): number {
  if (!Number.isInteger(parsed.redactedMessageCount) || Number(parsed.redactedMessageCount) < 0) {
    throw new Error(`${filePath} has invalid redactedMessageCount`)
  }
  return Number(parsed.redactedMessageCount)
}

// fallow-ignore-next-line complexity
function optionalTraceMeta(parsed: Record<string, unknown>, filePath: string): TraceRecordV1["meta"] {
  if (!isObject(parsed.meta)) throw new Error(`${filePath} has invalid meta`)
  const entries = ["model", "trigger", "reason"].flatMap((key) => {
    const value = optionalString(parsed.meta as Record<string, unknown>, key, filePath)
    return value === undefined ? [] : [[key, value]]
  })
  return Object.fromEntries(entries) as TraceRecordV1["meta"]
}

function parseTraceFile(filePath: string): TraceRecordV1 {
  const parsed = parseTraceObject(filePath)
  const sessionId = optionalString(parsed, "sessionId", filePath)
  const turnId = optionalString(parsed, "turnId", filePath)

  return {
    schemaVersion: 1,
    capturedAt: requiredDate(parsed, "capturedAt", filePath),
    projectKey: requiredString(parsed, "projectKey", filePath),
    harness: requiredKnownString(parsed, "harness", TRACE_HARNESSES, filePath) as TraceRecordV1["harness"],
    event: requiredKnownString(parsed, "event", TRACE_EVENTS, filePath) as TraceRecordV1["event"],
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(turnId !== undefined ? { turnId } : {}),
    fidelity: requiredKnownString(parsed, "fidelity", TRACE_FIDELITIES, filePath),
    messages: requiredMessages(parsed, filePath),
    redactedMessageCount: requiredRedactedMessageCount(parsed, filePath),
    meta: optionalTraceMeta(parsed, filePath),
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
  return [...trace.messages]
    .reverse()
    .find((message) => message.role === "user" && Boolean(message.content.trim()))
    ?.content.trim()
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

function requireFlagValue(value: string | undefined, flag: string): string {
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`)
  return value
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const flag = `--${name}`
  const argumentIndex = argv.findIndex((argument) => argument === flag || argument.startsWith(`${flag}=`))
  if (argumentIndex === -1) return undefined

  const argument = argv[argumentIndex]!
  if (argument === flag) return requireFlagValue(argv[argumentIndex + 1], flag)
  return requireFlagValue(argument.slice(flag.length + 1), flag)
}

export function requireTraceDatasetPaths(argv: readonly string[]): TraceDatasetPaths {
  const tracesDirectory = flagValue(argv, "traces")
  const outputPath = flagValue(argv, "out")
  if (!tracesDirectory || !outputPath) {
    throw new Error("Trace dataset converter requires explicit --traces <dir> and --out <file>; no default path is implied")
  }
  return { tracesDirectory, outputPath }
}
