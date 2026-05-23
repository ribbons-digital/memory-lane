import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import type { MemoryRecord } from "./types.js"
import { isMemoryRecord } from "./storage-validation.js"

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

  function parseLine(line: string): MemoryRecord | undefined {
    if (!line.trim()) return undefined
    try {
      const parsed = JSON.parse(line)
      return isMemoryRecord(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  }

  function parseLines(): MemoryRecord[] {
    if (!fs.existsSync(filePath)) return []
    return fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .map(parseLine)
      .filter((record): record is MemoryRecord => record !== undefined)
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
