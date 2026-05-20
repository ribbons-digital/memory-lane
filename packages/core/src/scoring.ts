import type { EmbeddingRecord } from "./types.js"

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return Math.min(1, Math.max(0, dot / (Math.sqrt(na) * Math.sqrt(nb))))
}

const STOP_WORDS = new Set(["a","an","and","are","as","at","be","by","can","did","do","does","for","from","how","i","in","is","it","of","off","on","or","please","that","the","this","to","use","we","what","where","with","you"])

function tokens(text: string): string[] {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  return [...new Set(t ? t.split(/\s+/).filter((w) => w && !STOP_WORDS.has(w)) : [])]
}

export function lexicalScore(query: string, text: string): number {
  const qt = tokens(query)
  if (!qt.length) return 0
  const tt = tokens(text)
  if (!tt.length) return 0
  let hits = 0
  for (const q of qt) {
    if (tt.some((t) => t === q || (q.length >= 4 && t.includes(q)) || (t.length >= 4 && q.includes(t)))) hits++
  }
  return Math.min(1, hits / qt.length)
}

export function recencyScore(updatedAt: string, nowMs: number = Date.now()): number {
  const ms = Date.parse(updatedAt)
  if (!Number.isFinite(ms)) return 0
  return 1 / (1 + Math.max(0, nowMs - ms) / (30 * 24 * 60 * 60 * 1000))
}

export function findMatchingEmbedding(
  embeddings: EmbeddingRecord[], memoryId: string, contentHash: string, profileName: string, model: string,
): EmbeddingRecord | undefined {
  return embeddings.find((e) =>
    e.memoryId === memoryId &&
    e.contentHash === contentHash &&
    e.profileName === profileName &&
    e.model === model,
  )
}
