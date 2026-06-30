import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import type { MemoryRecord } from "./types.js"
import { normalizeMemoryRecord } from "./storage-validation.js"

export function createMemoryId(): string {
  return crypto.randomBytes(4).toString("hex")
}

export function foldMemoryRecords(records: MemoryRecord[]): MemoryRecord[] {
  const latest = new Map<string, MemoryRecord>()
  for (const record of records) latest.set(record.id, record)
  return Array.from(latest.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export interface MemoryStoreDiagnostics {
  totalRows: number
  validRows: number
  skippedRows: number
  malformedRows: number
  invalidRows: number
}

export interface MemoryStore {
  readonly file: string
  append(record: MemoryRecord): void
  appendMany(records: MemoryRecord[]): void
  readLog(): MemoryRecord[]
  list(): MemoryRecord[]
  diagnostics(): MemoryStoreDiagnostics
}

export function createMemoryStore(filePath: string): MemoryStore {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  let cache: { mtime: number; records: MemoryRecord[] } | null = null

  function analyzeLines(): { records: MemoryRecord[]; diagnostics: MemoryStoreDiagnostics } {
    const diagnostics: MemoryStoreDiagnostics = {
      totalRows: 0,
      validRows: 0,
      skippedRows: 0,
      malformedRows: 0,
      invalidRows: 0,
    }
    const records: MemoryRecord[] = []
    if (!fs.existsSync(filePath)) return { records, diagnostics }

    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
      if (!line.trim()) continue
      diagnostics.totalRows += 1
      try {
        const parsed = JSON.parse(line)
        const record = normalizeMemoryRecord(parsed)
        if (record) {
          diagnostics.validRows += 1
          records.push(record)
        } else {
          diagnostics.invalidRows += 1
        }
      } catch {
        diagnostics.malformedRows += 1
      }
    }
    diagnostics.skippedRows = diagnostics.malformedRows + diagnostics.invalidRows
    return { records, diagnostics }
  }

  function parseLines(): MemoryRecord[] {
    return analyzeLines().records
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

  function appendMany(records: MemoryRecord[]): void {
    if (!records.length) return
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
    const prefix = existing && !existing.endsWith("\n") ? existing + "\n" : existing
    const tmpFile = filePath + ".tmp." + crypto.randomBytes(4).toString("hex")
    fs.writeFileSync(tmpFile, prefix + records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
    fs.renameSync(tmpFile, filePath)
    cache = null
  }

  return {
    file: filePath,
    append(record) {
      appendMany([record])
    },
    appendMany,
    readLog: parseLines,
    list: readAll,
    diagnostics() {
      return analyzeLines().diagnostics
    },
  }
}
