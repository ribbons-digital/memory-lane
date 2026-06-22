import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { isStrictIsoTimestamp } from "./freshness.js"
import type { ContinuityBaselineDiagnostic } from "./types.js"

const BASELINE_FILE_NAME = "continuity-baselines.json"
const UNREADABLE_WARNING = "Continuity baseline marker file is unreadable; treating it as absent."
const INVALID_MARKER_WARNING = "Continuity baseline marker timestamp is invalid; treating it as absent."

export interface ContinuityBaselineMarker {
  projectScope: string
  lastSeenAt: string
  updatedAt: string
}

interface ContinuityBaselineFile {
  version: 1
  projects: Record<string, ContinuityBaselineMarker>
}

export interface ContinuityBaselineReadResult {
  marker?: ContinuityBaselineMarker
  warning?: string
  readable: boolean
}

function emptyBaselineFile(): ContinuityBaselineFile {
  return { version: 1, projects: {} }
}

function normalizeBaselineFile(value: unknown): ContinuityBaselineFile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as { version?: unknown; projects?: unknown }
  if (record.version !== 1 || !record.projects || typeof record.projects !== "object" || Array.isArray(record.projects)) return undefined

  const projects: Record<string, ContinuityBaselineMarker> = {}
  for (const [key, marker] of Object.entries(record.projects as Record<string, unknown>)) {
    if (!marker || typeof marker !== "object" || Array.isArray(marker)) continue
    const item = marker as Record<string, unknown>
    if (typeof item.projectScope !== "string" || item.projectScope !== key) continue
    if (typeof item.lastSeenAt !== "string" || typeof item.updatedAt !== "string") continue
    projects[key] = { projectScope: item.projectScope, lastSeenAt: item.lastSeenAt, updatedAt: item.updatedAt }
  }
  return { version: 1, projects }
}

function readBaselineFile(filePath: string): { data: ContinuityBaselineFile; warning?: string; readable: boolean } {
  try {
    if (!fs.existsSync(filePath)) return { data: emptyBaselineFile(), readable: true }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"))
    const normalized = normalizeBaselineFile(parsed)
    if (!normalized) return { data: emptyBaselineFile(), readable: false, warning: UNREADABLE_WARNING }
    return { data: normalized, readable: true }
  } catch {
    return { data: emptyBaselineFile(), readable: false, warning: UNREADABLE_WARNING }
  }
}

export function defaultContinuityBaselinePath(memoryPath: string): string {
  return path.join(path.dirname(memoryPath), BASELINE_FILE_NAME)
}

export function readContinuityBaseline(filePath: string, projectScope?: string): ContinuityBaselineReadResult {
  const { data, warning, readable } = readBaselineFile(filePath)
  if (!projectScope) return { readable, ...(warning ? { warning } : {}) }
  const marker = data.projects[projectScope]
  if (!marker) return { readable, ...(warning ? { warning } : {}) }
  if (!isStrictIsoTimestamp(marker.lastSeenAt)) return { readable, warning: warning ?? INVALID_MARKER_WARNING }
  return { marker, readable, ...(warning ? { warning } : {}) }
}

export function writeContinuityBaseline(filePath: string, projectScope: string, observedAt: string): { ok: boolean; warning?: string } {
  try {
    const { data } = readBaselineFile(filePath)
    const now = new Date().toISOString()
    data.projects[projectScope] = { projectScope, lastSeenAt: observedAt, updatedAt: now }
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tmpFile = `${filePath}.tmp.${crypto.randomBytes(4).toString("hex")}`
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2) + "\n", "utf8")
    fs.renameSync(tmpFile, filePath)
    return { ok: true }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, warning: `Continuity baseline marker write failed: ${message}` }
  }
}

export function continuityBaselineDiagnostic(filePath: string, projectScope?: string): ContinuityBaselineDiagnostic {
  const read = readContinuityBaseline(filePath, projectScope)
  return {
    projectScope: projectScope ?? "none",
    source: read.marker ? "marker" : "none",
    stateFile: filePath,
    readable: read.readable,
    ...(read.marker ? { since: read.marker.lastSeenAt } : {}),
    ...(read.warning ? { warning: read.warning } : {}),
  }
}
