import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import type { EmbeddingRecord, EmbeddingInvalidationRecord } from "./types.js"

export type EmbeddingLine = EmbeddingRecord | EmbeddingInvalidationRecord

function isEmbeddingRecord(v: unknown): v is EmbeddingRecord {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return (
    typeof o.memoryId === "string" &&
    typeof o.contentHash === "string" &&
    typeof o.profileName === "string" &&
    typeof o.model === "string" &&
    typeof o.createdAt === "string" &&
    Array.isArray(o.vector) &&
    o.type !== "invalidation"
  )
}

function isInvalidation(v: unknown): v is EmbeddingInvalidationRecord {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return o.type === "invalidation" && typeof o.memoryId === "string"
}

export function foldEmbeddings(records: EmbeddingRecord[]): EmbeddingRecord[] {
  const latest = new Map<string, EmbeddingRecord>()
  for (const r of records) {
    const key = [r.memoryId, r.contentHash, r.profileName, r.model].join("\0")
    const existing = latest.get(key)
    if (!existing || existing.createdAt <= r.createdAt) latest.set(key, r)
  }
  return Array.from(latest.values())
}

export interface EmbeddingStore {
  readonly file: string
  append(record: EmbeddingLine): void
  readLog(): EmbeddingLine[]
  listEmbeddings(): EmbeddingRecord[]
  listInvalidations(): EmbeddingInvalidationRecord[]
}

export function createEmbeddingStore(filePath: string): EmbeddingStore {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  let cache: { mtime: number; records: EmbeddingLine[] } | null = null

  function parse(): EmbeddingLine[] {
    if (!fs.existsSync(filePath)) return []
    const lines: EmbeddingLine[] = []
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
      if (!line.trim()) continue
      try {
        const p = JSON.parse(line)
        if (isEmbeddingRecord(p) || isInvalidation(p)) lines.push(p)
      } catch { /* skip malformed */ }
    }
    return lines
  }

  function readAll(): EmbeddingLine[] {
    try {
      const stat = fs.statSync(filePath)
      if (cache && stat.mtimeMs <= cache.mtime) return cache.records
      cache = { mtime: stat.mtimeMs, records: parse() }
      return cache.records
    } catch { return [] }
  }

  return {
    file: filePath,
    append(record) {
      const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
      const tmp = filePath + ".tmp." + crypto.randomBytes(4).toString("hex")
      fs.writeFileSync(tmp, existing + JSON.stringify(record) + "\n", "utf8")
      fs.renameSync(tmp, filePath)
      cache = null
    },
    readLog: parse,
    listEmbeddings() {
      return foldEmbeddings(readAll().filter((l): l is EmbeddingRecord => isEmbeddingRecord(l)))
    },
    listInvalidations() {
      return readAll().filter((l): l is EmbeddingInvalidationRecord => isInvalidation(l))
    },
  }
}
