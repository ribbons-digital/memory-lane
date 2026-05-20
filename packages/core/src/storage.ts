import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import type { MemoryRecord, MemoryStatus, MemoryCategory, MemoryScopeType, MemorySource } from "./types.js"

const VALID_STATUSES = new Set<MemoryStatus>(["pending", "approved", "rejected", "deleted"])
const VALID_CATEGORIES = new Set<MemoryCategory>(["preference", "personal", "project"])
const VALID_SCOPE_TYPES = new Set<MemoryScopeType>(["global", "project"])
const VALID_SOURCES = new Set<MemorySource>(["manual", "user-suggested", "agent-suggested"])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!isPlainObject(value)) return false
  if (!isNonEmptyString(value.id)) return false
  if (typeof value.status !== "string" || !VALID_STATUSES.has(value.status as MemoryStatus)) return false
  if (!isNonEmptyString(value.text)) return false
  if (typeof value.category !== "string" || !VALID_CATEGORIES.has(value.category as MemoryCategory)) return false
  if (typeof value.source !== "string" || !VALID_SOURCES.has(value.source as MemorySource)) return false
  if (!isNonEmptyString(value.createdAt)) return false
  if (!isNonEmptyString(value.updatedAt)) return false
  const scope = value.scope
  if (!isPlainObject(scope)) return false
  if (typeof scope.type !== "string" || !VALID_SCOPE_TYPES.has(scope.type as MemoryScopeType)) return false
  if (scope.key !== undefined && typeof scope.key !== "string") return false
  const project = value.project
  if (project !== undefined) {
    if (!isPlainObject(project)) return false
    if (typeof project.cwd !== "string") return false
    if (project.root !== undefined && typeof project.root !== "string") return false
    if (project.key !== undefined && typeof project.key !== "string") return false
  }
  return true
}

export function createMemoryId(): string {
  return crypto.randomBytes(4).toString("hex")
}

export function foldMemoryRecords(records: MemoryRecord[]): MemoryRecord[] {
  const latest = new Map<string, MemoryRecord>()
  for (const record of records) latest.set(record.id, record)
  return Array.from(latest.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export interface MemoryStore {
  readonly file: string
  append(record: MemoryRecord): void
  readLog(): MemoryRecord[]
  list(): MemoryRecord[]
}

export function createMemoryStore(filePath: string): MemoryStore {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  let cache: { mtime: number; records: MemoryRecord[] } | null = null

  function parseLines(): MemoryRecord[] {
    if (!fs.existsSync(filePath)) return []
    const records: MemoryRecord[] = []
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        if (isMemoryRecord(parsed)) records.push(parsed)
      } catch { /* skip malformed lines */ }
    }
    return records
  }

  function readAll(): MemoryRecord[] {
    try {
      const stat = fs.statSync(filePath)
      if (cache && stat.mtimeMs <= cache.mtime) return cache.records
      const records = foldMemoryRecords(parseLines())
      cache = { mtime: stat.mtimeMs, records }
      return records
    } catch {
      return []
    }
  }

  return {
    file: filePath,
    append(record) {
      const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
      const tmpFile = filePath + ".tmp." + crypto.randomBytes(4).toString("hex")
      fs.writeFileSync(tmpFile, existing + JSON.stringify(record) + "\n", "utf8")
      fs.renameSync(tmpFile, filePath)
      cache = null
    },
    readLog: parseLines,
    list: readAll,
  }
}
