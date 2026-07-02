import { createHash, randomBytes } from "node:crypto"
import * as fs from "node:fs"
import { foldMemoryRecords, withFileLocks } from "./storage.js"
import { foldEmbeddings } from "./embedding-store.js"
import { normalizeMemoryRecord } from "./storage-validation.js"
import type { MemoryRecord, EmbeddingRecord, EmbeddingInvalidationRecord, CompactReport } from "./types.js"

export function compact(memFile: string, embFile: string): CompactReport {
  let report: CompactReport = { removedMemories: 0, removedEmbeddings: 0, removedInvalidations: 0 }
  withFileLocks([memFile, embFile], () => {
    report = compactUnlocked(memFile, embFile)
  })
  return report
}

function compactUnlocked(memFile: string, embFile: string): CompactReport {
  let removedMemories = 0
  let removedEmbeddings = 0
  let removedInvalidations = 0
  // aliveRecords is hoisted so the embeddings section can use it for hash validation
  const aliveRecords: MemoryRecord[] = []

  // ── Compact memories ─────────────────────────────────────
  if (fs.existsSync(memFile)) {
    const raw = fs.readFileSync(memFile, "utf8").split("\n").filter(Boolean)
    const records: MemoryRecord[] = []
    const preservedInvalidLines: string[] = []
    for (const line of raw) {
      try {
        const record = normalizeMemoryRecord(JSON.parse(line))
        if (record) records.push(record)
        else preservedInvalidLines.push(line)
      } catch {
        preservedInvalidLines.push(line)
      }
    }
    const folded = foldMemoryRecords(records)
    const alive = folded.filter((m) => m.status !== "deleted" && m.status !== "rejected")
    removedMemories = folded.length - alive.length
    aliveRecords.push(...alive)

    const tmp = memFile + ".tmp." + randomBytes(4).toString("hex")
    const compactedLines = [...alive.map((m) => JSON.stringify(m)), ...preservedInvalidLines]
    fs.writeFileSync(tmp, compactedLines.join("\n") + (compactedLines.length ? "\n" : ""), "utf8")
    fs.renameSync(tmp, memFile)
  }

  // Pre-compute alive id set and content-hash map for embedding validation
  const aliveIds = new Set(aliveRecords.map((m) => m.id))
  const aliveHashes = new Map<string, string>()
  for (const m of aliveRecords) {
    aliveHashes.set(m.id, createHash("sha256").update(m.text, "utf8").digest("hex"))
  }

  // ── Compact embeddings ────────────────────────────────────
  if (fs.existsSync(embFile)) {
    const raw = fs.readFileSync(embFile, "utf8").split("\n").filter(Boolean)
    const allLines: (EmbeddingRecord | EmbeddingInvalidationRecord)[] = []
    for (const line of raw) {
      try { allLines.push(JSON.parse(line)) } catch { /* skip */ }
    }

    const embeddingLines = allLines.filter((e): e is EmbeddingRecord =>
      (e as any).type !== "invalidation" && Array.isArray((e as any).vector),
    )
    const invalidationLines = allLines.filter((e): e is EmbeddingInvalidationRecord =>
      (e as any).type === "invalidation",
    )
    const totalBefore = embeddingLines.length + invalidationLines.length

    // Keep only embeddings for alive memories with matching content hashes;
    // all invalidation records are absorbed (dropped) during compaction
    const folded = foldEmbeddings(embeddingLines)
    const validEmbeddings = folded.filter((e) =>
      aliveIds.has(e.memoryId) && aliveHashes.get(e.memoryId) === e.contentHash
    )
    removedInvalidations = invalidationLines.length
    removedEmbeddings = totalBefore - validEmbeddings.length

    const tmp = embFile + ".tmp." + randomBytes(4).toString("hex")
    fs.writeFileSync(tmp, validEmbeddings.map((e) => JSON.stringify(e)).join("\n") + (validEmbeddings.length ? "\n" : ""), "utf8")
    fs.renameSync(tmp, embFile)
  }

  return { removedMemories, removedEmbeddings, removedInvalidations }
}

/** Check if compaction should run at startup. */
export function shouldCompact(
  memFile: string,
  threshold = 0.3,
  minRecords = 100,
): boolean {
  if (!fs.existsSync(memFile)) return false
  const raw = fs.readFileSync(memFile, "utf8").split("\n").filter(Boolean)
  if (raw.length < minRecords) return false
  const records: MemoryRecord[] = []
  for (const line of raw) {
    try {
      const record = normalizeMemoryRecord(JSON.parse(line))
      if (record) records.push(record)
    } catch { /* skip */ }
  }
  const folded = foldMemoryRecords(records)
  if (!folded.length) return false
  const dead = folded.filter((m) => m.status === "deleted" || m.status === "rejected").length
  return dead / folded.length > threshold
}
