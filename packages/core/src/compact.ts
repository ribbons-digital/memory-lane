import * as crypto from "node:crypto"
import * as fs from "node:fs"
import { foldMemoryRecords } from "./storage.js"
import { foldEmbeddings } from "./embedding-store.js"
import type { MemoryRecord, EmbeddingRecord, EmbeddingInvalidationRecord, CompactReport } from "./types.js"

export function compact(memFile: string, embFile: string): CompactReport {
  let removedMemories = 0
  let removedEmbeddings = 0
  let aliveIds = new Set<string>()

  // ── Compact memories ─────────────────────────────────────
  if (fs.existsSync(memFile)) {
    const raw = fs.readFileSync(memFile, "utf8").split("\n").filter(Boolean)
    let records: MemoryRecord[] = []
    for (const line of raw) {
      try { records.push(JSON.parse(line) as MemoryRecord) } catch { /* skip malformed */ }
    }
    const folded = foldMemoryRecords(records)
    const alive = folded.filter((m) => m.status !== "deleted" && m.status !== "rejected")
    removedMemories = folded.length - alive.length
    aliveIds = new Set(alive.map((m) => m.id))

    const tmp = memFile + ".tmp." + crypto.randomBytes(4).toString("hex")
    fs.writeFileSync(tmp, alive.map((m) => JSON.stringify(m)).join("\n") + (alive.length ? "\n" : ""), "utf8")
    fs.renameSync(tmp, memFile)
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

    // Keep only embeddings for alive memories; drop all invalidation records (they're absorbed)
    const folded = foldEmbeddings(embeddingLines)
    const validEmbeddings = folded.filter((e) => aliveIds.has(e.memoryId))
    removedEmbeddings = totalBefore - validEmbeddings.length

    const tmp = embFile + ".tmp." + crypto.randomBytes(4).toString("hex")
    fs.writeFileSync(tmp, validEmbeddings.map((e) => JSON.stringify(e)).join("\n") + (validEmbeddings.length ? "\n" : ""), "utf8")
    fs.renameSync(tmp, embFile)
  }

  return { removedMemories, removedEmbeddings, removedInvalidations: 0 }
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
    try { records.push(JSON.parse(line) as MemoryRecord) } catch { /* skip */ }
  }
  const folded = foldMemoryRecords(records)
  const dead = folded.filter((m) => m.status === "deleted" || m.status === "rejected").length
  return dead / folded.length > threshold
}
