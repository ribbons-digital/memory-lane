import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createHash, randomBytes } from "node:crypto"
import { appendHookDebugLog, containsLikelySecret, hookDebugEnabled, loadConfig, resolveProjectScope, type SemanticMemoryConfig } from "@memory-lane/core"
import type { SessionMessage, TraceFidelity } from "./types.js"

export const TRACE_SCHEMA_VERSION = 1
export const TRACE_RETENTION_DAYS = 60
export const TRACE_RETENTION_MAX_BYTES = 512 * 1024 * 1024
export const REDACTED_SECRET_CONTENT = "[redacted:secret]"

export type TraceHarness = "claude" | "codex" | "pi"
export type TraceEvent = "session-end" | "pre-compact"

export interface TraceMessage {
  role: SessionMessage["role"]
  content: string
  timestamp?: string
}

export interface TraceRecordV1 {
  schemaVersion: 1
  capturedAt: string
  projectKey: string
  harness: TraceHarness
  event: TraceEvent
  sessionId?: string
  turnId?: string
  fidelity: TraceFidelity
  messages: TraceMessage[]
  redactedMessageCount: number
  meta: {
    model?: string
    trigger?: string
    reason?: string
  }
}

export interface CaptureTraceInput {
  cwd: string
  sessionId?: string
  turnId?: string
  transcriptPath?: string
  messages: SessionMessage[]
  model?: string
}

export interface CaptureTraceOptions {
  adapter?: string
  lifecycleEvent?: "session_end" | "pre_compact"
  trigger?: string
  reason?: string
  fidelity?: TraceFidelity
  configPath?: string
  env?: NodeJS.ProcessEnv
  now?: Date
  traceRoot?: string
}

export interface TraceStatus {
  enabled: boolean
  tracesDirectory: string
  fileCount: number
  totalBytes: number
  excludedProjects: string[]
  oldestTrace?: string
  newestTrace?: string
}

export interface PurgeTraceResult {
  tracesDirectory: string
  removedFiles: number
  removedBytes: number
}

function traceRoot(override?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (override) return override
  if (env.MEMORY_LANE_TRACES_DIR) return env.MEMORY_LANE_TRACES_DIR
  return path.join(os.homedir(), ".memory-lane", "traces")
}

function traceHarness(adapter?: string): TraceHarness | undefined {
  if (adapter === "claude" || adapter === "codex" || adapter === "pi") return adapter
  return undefined
}

function traceEvent(lifecycleEvent?: "session_end" | "pre_compact"): TraceEvent {
  return lifecycleEvent === "pre_compact" ? "pre-compact" : "session-end"
}

function resolveProjectKey(cwd: string): string {
  return resolveProjectScope(cwd)?.key ?? path.resolve(cwd)
}

function projectHash(projectKey: string): string {
  return createHash("sha256").update(projectKey).digest("hex").slice(0, 8)
}

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/gu, "-")
}

function learningCaptureEnabled(config: SemanticMemoryConfig): boolean {
  return config.learning?.capture === "on"
}

function excludedProjects(config: SemanticMemoryConfig): string[] {
  return config.learning?.excludedProjects ?? []
}

function isExcludedProject(config: SemanticMemoryConfig, projectKey: string): boolean {
  return excludedProjects(config).includes(projectKey)
}

export function shouldCaptureLifecycleTrace(cwd: string, config: SemanticMemoryConfig): boolean {
  if (!learningCaptureEnabled(config)) return false
  return !isExcludedProject(config, resolveProjectKey(cwd))
}

function redactedMessages(messages: SessionMessage[]): { messages: TraceMessage[]; redactedMessageCount: number } {
  let redactedMessageCount = 0
  const result = messages.map((message) => {
    const redacted = containsLikelySecret(message.content)
    if (redacted) redactedMessageCount += 1
    return {
      role: message.role,
      content: redacted ? REDACTED_SECRET_CONTENT : message.content,
      ...(message.timestamp ? { timestamp: message.timestamp } : {}),
    }
  })
  return { messages: result, redactedMessageCount }
}

function defaultFidelity(input: CaptureTraceInput): TraceFidelity {
  return input.transcriptPath ? "full-transcript" : "payload-messages"
}

function writeProjectIndex(root: string, hash: string, projectKey: string): void {
  const indexPath = path.join(root, "_projects.json")
  let index: Record<string, string> = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) index = parsed as Record<string, string>
  } catch { /* first write or malformed stale index */ }
  if (index[hash] === projectKey) return
  index[hash] = projectKey
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8")
}

function traceFiles(root: string): Array<{ path: string; size: number; mtimeMs: number }> {
  const files: Array<{ path: string; size: number; mtimeMs: number }> = []
  if (!fs.existsSync(root)) return files
  for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const dir = path.join(root, dirent.name)
    for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!child.isFile() || !child.name.endsWith(".json")) continue
      const filePath = path.join(dir, child.name)
      const stat = fs.statSync(filePath)
      files.push({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs })
    }
  }
  return files
}

function enforceTraceRetention(root: string, now: Date): void {
  const cutoffMs = now.getTime() - TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000
  for (const file of traceFiles(root)) {
    if (file.mtimeMs < cutoffMs) {
      try { fs.unlinkSync(file.path) } catch { /* best effort */ }
    }
  }

  let files = traceFiles(root).sort((a, b) => a.mtimeMs - b.mtimeMs)
  let total = files.reduce((sum, file) => sum + file.size, 0)
  for (const file of files) {
    if (total <= TRACE_RETENTION_MAX_BYTES) break
    try {
      fs.unlinkSync(file.path)
      total -= file.size
    } catch { /* best effort */ }
  }
}

function debugCaptureFailure(options: CaptureTraceOptions, message: string): void {
  const env = options.env ?? process.env
  if (!hookDebugEnabled(env)) return
  appendHookDebugLog({
    adapter: traceHarness(options.adapter) ?? "lifecycle",
    event: traceEvent(options.lifecycleEvent),
    cwd: process.cwd(),
    status: "noop",
    reason: `trace capture failed: ${message}`,
  })
}

export function captureLifecycleTrace(input: CaptureTraceInput, options: CaptureTraceOptions = {}): TraceRecordV1 | undefined {
  try {
    const harness = traceHarness(options.adapter)
    if (!harness) return undefined
    if (!input.messages.length) return undefined

    const config = loadConfig(options.configPath)
    if (!learningCaptureEnabled(config)) return undefined

    const projectKey = resolveProjectKey(input.cwd)
    if (isExcludedProject(config, projectKey)) return undefined

    const root = traceRoot(options.traceRoot, options.env)
    const hash = projectHash(projectKey)
    const dir = path.join(root, hash)
    const now = options.now ?? new Date()
    const event = traceEvent(options.lifecycleEvent)
    const redacted = redactedMessages(input.messages)
    const record: TraceRecordV1 = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      capturedAt: now.toISOString(),
      projectKey,
      harness,
      event,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      fidelity: options.fidelity ?? defaultFidelity(input),
      messages: redacted.messages,
      redactedMessageCount: redacted.redactedMessageCount,
      meta: {
        ...(input.model ? { model: input.model } : {}),
        ...(options.trigger ? { trigger: options.trigger } : {}),
        ...(options.reason ? { reason: options.reason } : {}),
      },
    }

    fs.mkdirSync(dir, { recursive: true })
    writeProjectIndex(root, hash, projectKey)
    const id = randomBytes(4).toString("hex")
    const filePath = path.join(dir, `${safeTimestamp(now)}-${event}-${id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + "\n", "utf8")
    enforceTraceRetention(root, now)
    return record
  } catch (error) {
    debugCaptureFailure(options, error instanceof Error ? error.message : String(error))
    return undefined
  }
}

export function traceStatus(configPath?: string, rootOverride?: string): TraceStatus {
  const config = loadConfig(configPath)
  const root = traceRoot(rootOverride)
  const files = traceFiles(root)
  const sorted = files.slice().sort((a, b) => a.mtimeMs - b.mtimeMs)
  return {
    enabled: learningCaptureEnabled(config),
    tracesDirectory: root,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    excludedProjects: excludedProjects(config),
    ...(sorted[0] ? { oldestTrace: new Date(sorted[0].mtimeMs).toISOString() } : {}),
    ...(sorted[sorted.length - 1] ? { newestTrace: new Date(sorted[sorted.length - 1].mtimeMs).toISOString() } : {}),
  }
}

export function purgeTraces(configPath?: string, rootOverride?: string): PurgeTraceResult {
  const root = traceRoot(rootOverride)
  const files = traceFiles(root)
  const removedBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true })
  return { tracesDirectory: root, removedFiles: files.length, removedBytes }
}
