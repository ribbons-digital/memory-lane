import { createHash } from "node:crypto"
import { isCheckpointRecallQuery, isCurrentnessRecallQuery, filterMemoriesForContext } from "./search.js"
import { cosineSimilarity, lexicalScore, recencyScore, findMatchingEmbedding } from "./scoring.js"
import type {
  MemoryRecord, EmbeddingRecord, EmbeddingInvalidationRecord,
  EmbeddingProvider, SemanticMemoryConfig, RecallResult,
} from "./types.js"

export async function retrieveSemanticMemories(
  memories: MemoryRecord[],
  embeddings: EmbeddingRecord[],
  invalidations: EmbeddingInvalidationRecord[],
  query: string,
  projectKey: string,
  config: SemanticMemoryConfig["semantic"],
  provider?: EmbeddingProvider,
  signal?: AbortSignal,
): Promise<RecallResult> {
  const visible = filterMemoriesForContext(memories, projectKey).filter((memory) => !memory.revision?.supersededBy)
  if (!visible.length) {
    return { memories: [], semantic: { enabled: config.enabled, used: false } }
  }

  const q = query.trim()
  if (!q) {
    return {
      memories: [...visible]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
        .slice(0, config.retrieval.topK),
      semantic: { enabled: config.enabled, used: false },
    }
  }

  const checkpointRecall = isCheckpointRecallQuery(q)

  // ── Semantic path ─────────────────────────────────────────
  if (config.enabled && provider) {
    try {
      const vectors = await provider.embed([q], signal)
      if (vectors?.length === 1) {
        const queryVec = vectors[0]
        const latestInvalidations = latestInvalidationTimes(invalidations)
        const folded = new Map<string, EmbeddingRecord>()
        for (const e of embeddings) {
          if (!isEmbeddingAfterLatestInvalidation(e, latestInvalidations.get(e.memoryId))) continue
          const key = embeddingVariantKey(e)
          const existing = folded.get(key)
          if (!existing || existing.createdAt <= e.createdAt) folded.set(key, e)
        }

        const profileName = config.activeEmbeddingProfile
        const profile = config.embeddings.profiles[profileName]
        const model = profile?.model ?? ""

        const scored = visible.map((m) => {
          const emb = findMatchingEmbedding(
            [...folded.values()], m.id, hashText(m.text), profileName, model,
          )
          const sem = emb ? cosineSimilarity(queryVec, emb.vector) : 0
          const lex = lexicalScore(q, m.text)
          const rec = recencyScore(m.updatedAt)
          const boost = checkpointRecall && effectiveKind(m) === "project_checkpoint" ? 0.2 : 0
          const final =
            sem * config.retrieval.semanticWeight +
            lex * config.retrieval.lexicalWeight +
            rec * config.retrieval.recencyWeight +
            boost
          return {
            memory: m,
            semanticScore: sem,
            lexicalScore: lex,
            recencyScore: rec,
            kindBoost: boost,
            finalScore: final,
          }
        })

        const { minSimilarity, topK } = config.retrieval
        const selected = scored
          .filter((s) => s.semanticScore >= minSimilarity || s.lexicalScore > 0)
          .sort((a, b) =>
            b.finalScore - a.finalScore ||
            b.semanticScore - a.semanticScore ||
            b.lexicalScore - a.lexicalScore,
          )
          .slice(0, topK)

        if (selected.length) {
          return {
            memories: selected.map((s) => s.memory),
            semantic: { enabled: true, used: true },
          }
        }

        if (config.retrieval.fallbackToAllVisibleOnMiss) {
          const lexScored = visible
            .map((m) => ({ memory: m, score: lexicalScore(q, m.text) }))
            .sort((a, b) => compareLexicalFallbackResults(q, a, b))
            .slice(0, topK)
          return {
            memories: lexScored.map((s) => s.memory),
            semantic: { enabled: true, used: true, fallbackReason: "No semantic matches" },
          }
        }
      }
    } catch {
      // Fall through to lexical fallback
    }
  }

  // ── Lexical fallback ─────────────────────────────────────
  const lexScored = visible
    .map((m) => ({ memory: m, score: lexicalScore(q, m.text) }))
    .sort((a, b) => compareLexicalFallbackResults(q, a, b))
    .slice(0, config.retrieval.topK)

  return {
    memories: lexScored.map((s) => s.memory),
    semantic: { enabled: config.enabled, used: false },
  }
}

function embeddingVariantKey(embedding: EmbeddingRecord): string {
  return [embedding.memoryId, embedding.contentHash, embedding.profileName, embedding.model].join("\0")
}

function latestInvalidationTimes(invalidations: EmbeddingInvalidationRecord[]): Map<string, number> {
  const latest = new Map<string, number>()
  for (const invalidation of invalidations) {
    const invalidatedAt = Date.parse(invalidation.invalidatedAt)
    const time = Number.isFinite(invalidatedAt) ? invalidatedAt : Number.POSITIVE_INFINITY
    const existing = latest.get(invalidation.memoryId)
    if (existing === undefined || existing <= time) latest.set(invalidation.memoryId, time)
  }
  return latest
}

function isEmbeddingAfterLatestInvalidation(embedding: EmbeddingRecord, latestInvalidatedAt: number | undefined): boolean {
  if (latestInvalidatedAt === undefined) return true
  const embeddedAt = Date.parse(embedding.createdAt)
  return Number.isFinite(embeddedAt) && embeddedAt >= latestInvalidatedAt
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function compareLexicalFallbackResults(
  query: string,
  a: { memory: MemoryRecord; score: number },
  b: { memory: MemoryRecord; score: number },
): number {
  const lexicalDifference = b.score - a.score
  if (lexicalDifference !== 0) return lexicalDifference
  if (!isCurrentnessRecallQuery(query)) return 0
  if (!isCheckpointLike(a.memory) || !isCheckpointLike(b.memory)) return 0
  const aUpdatedAt = Date.parse(a.memory.updatedAt)
  const bUpdatedAt = Date.parse(b.memory.updatedAt)
  if (!Number.isFinite(aUpdatedAt) || !Number.isFinite(bUpdatedAt)) return 0
  return bUpdatedAt - aUpdatedAt
}

function isCheckpointLike(m: MemoryRecord): boolean {
  return effectiveKind(m) === "project_checkpoint"
}

function effectiveKind(m: MemoryRecord): string {
  const validKinds = new Set(["preference","personal_context","project_fact","project_checkpoint","workflow_rule","decision","correction","procedure","session_summary","misc"])
  if (m.kind && validKinds.has(m.kind)) return m.kind
  return "misc"
}
