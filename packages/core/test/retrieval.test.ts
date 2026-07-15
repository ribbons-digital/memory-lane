import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { retrieveSemanticMemories } from "../src/retrieval.js"
import type { MemoryRecord, EmbeddingRecord, EmbeddingInvalidationRecord, SemanticMemoryConfig } from "../src/types.js"

const BASE_CONFIG: SemanticMemoryConfig["semantic"] = {
  enabled: false,
  activeEmbeddingProfile: "test",
  embeddings: { profiles: {} },
  retrieval: { topK: 5, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
  privacy: { allowRemoteEmbeddings: false },
}

function rec(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: overrides.id ?? "test",
    status: overrides.status ?? "approved",
    text: overrides.text ?? "x",
    category: overrides.category ?? "project",
    scope: overrides.scope ?? { type: "global" },
    source: overrides.source ?? "manual",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    kind: overrides.kind,
  }
}

function enabledSemanticConfig(): SemanticMemoryConfig["semantic"] {
  return {
    ...BASE_CONFIG,
    enabled: true,
    activeEmbeddingProfile: "test",
    embeddings: {
      profiles: {
        test: { provider: "openai-compatible-embeddings" as const, baseUrl: "http://localhost", model: "test" },
      },
    },
  }
}

describe("retrieveSemanticMemories", () => {
  it("returns empty for no memories", async () => {
    const r = await retrieveSemanticMemories([], [], [], "query", "", BASE_CONFIG)
    assert.equal(r.memories.length, 0)
    assert.equal(r.semantic.used, false)
  })

  it("returns newest visible memories before applying topK for an empty query", async () => {
    const memories = [
      rec({ id: "oldest", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }),
      rec({ id: "middle", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" }),
      rec({ id: "newest", createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" }),
    ]
    const config = { ...BASE_CONFIG, retrieval: { ...BASE_CONFIG.retrieval, topK: 2 } }

    const result = await retrieveSemanticMemories(memories, [], [], "", "", config)

    assert.deepEqual(result.memories.map((memory) => memory.id), ["newest", "middle"])
    assert.equal(result.semantic.used, false)
  })

  it("falls back to lexical when no provider", async () => {
    const memories = [
      rec({ id: "a", text: "use pnpm for everything" }),
      rec({ id: "b", text: "docker for containers" }),
    ]
    const r = await retrieveSemanticMemories(memories, [], [], "pnpm", "", BASE_CONFIG)
    assert.equal(r.semantic.used, false)
    // pnpm match should come first
    assert.ok(r.memories.length >= 1)
    assert.equal(r.memories[0].id, "a")
  })

  it("respects topK", async () => {
    const memories = Array.from({ length: 10 }, (_, i) =>
      rec({ id: `m${i}`, text: `text about pnpm number ${i}` }),
    )
    const r = await retrieveSemanticMemories(memories, [], [], "pnpm", "", BASE_CONFIG)
    assert.ok(r.memories.length <= 5)
  })

  it("uses semantic provider when enabled", async () => {
    const memories = [rec({ id: "a", text: "use pnpm" })]
    const config = enabledSemanticConfig()
    // Mock provider that returns vectors
    const provider = {
      async embed() { return [[0.5, 0.5]] },
    }
    // Precomputed SHA256("use pnpm")
    const contentHash = "962d19749afe5a8fb511ea7b17458065dbf11a89ee104a67d0e5cb89d16485c7"
    const embeddings: EmbeddingRecord[] = [{
      memoryId: "a",
      memoryUpdatedAt: "2026-01-01T00:00:00.000Z",
      contentHash,
      profileName: "test",
      model: "test",
      dimensions: 2,
      vector: [0.5, 0.5],
      createdAt: "2026-01-01T00:00:00.000Z",
    }]
    const r = await retrieveSemanticMemories(memories, embeddings, [], "package manager", "", config, provider)
    assert.equal(r.semantic.enabled, true)
    assert.equal(r.semantic.used, true)
  })

  it("uses embeddings written after an invalidation", async () => {
    const memories = [rec({ id: "a", text: "use pnpm" })]
    const config = enabledSemanticConfig()
    const provider = {
      async embed() { return [[0.5, 0.5]] },
    }
    const contentHash = "962d19749afe5a8fb511ea7b17458065dbf11a89ee104a67d0e5cb89d16485c7"
    const embeddings: EmbeddingRecord[] = [{
      memoryId: "a",
      memoryUpdatedAt: "2026-01-01T00:00:00.000Z",
      contentHash,
      profileName: "test",
      model: "test",
      dimensions: 2,
      vector: [0.5, 0.5],
      createdAt: "2026-01-01T00:00:01.000Z",
    }]
    const invalidations: EmbeddingInvalidationRecord[] = [{
      type: "invalidation",
      memoryId: "a",
      invalidatedAt: "2026-01-01T00:00:00.000Z",
      reason: "updated",
    }]

    const r = await retrieveSemanticMemories(memories, embeddings, invalidations, "package manager", "", config, provider)

    assert.equal(r.semantic.enabled, true)
    assert.equal(r.semantic.used, true)
    assert.equal(r.semantic.fallbackReason, undefined)
    assert.equal(r.memories[0]?.id, "a")
  })

  it("keeps fresh embeddings distinct by content hash profile and model", async () => {
    const memories = [rec({ id: "a", text: "use pnpm" })]
    const config = enabledSemanticConfig()
    const provider = {
      async embed() { return [[0.5, 0.5]] },
    }
    const activeContentHash = "962d19749afe5a8fb511ea7b17458065dbf11a89ee104a67d0e5cb89d16485c7"
    const embeddings: EmbeddingRecord[] = [
      {
        memoryId: "a",
        memoryUpdatedAt: "2026-01-01T00:00:00.000Z",
        contentHash: activeContentHash,
        profileName: "test",
        model: "test",
        dimensions: 2,
        vector: [0.5, 0.5],
        createdAt: "2026-01-01T00:00:01.000Z",
      },
      {
        memoryId: "a",
        memoryUpdatedAt: "2026-01-01T00:00:00.000Z",
        contentHash: "other-hash",
        profileName: "other-profile",
        model: "other-model",
        dimensions: 2,
        vector: [0, 1],
        createdAt: "2026-01-01T00:00:02.000Z",
      },
    ]
    const invalidations: EmbeddingInvalidationRecord[] = [{
      type: "invalidation",
      memoryId: "a",
      invalidatedAt: "2026-01-01T00:00:00.000Z",
      reason: "updated",
    }]

    const r = await retrieveSemanticMemories(memories, embeddings, invalidations, "package manager", "", config, provider)

    assert.equal(r.semantic.enabled, true)
    assert.equal(r.semantic.used, true)
    assert.equal(r.semantic.fallbackReason, undefined)
    assert.equal(r.memories[0]?.id, "a")
  })

  it("ignores embeddings written before an invalidation", async () => {
    const memories = [rec({ id: "a", text: "use pnpm" })]
    const config = enabledSemanticConfig()
    const provider = {
      async embed() { return [[0.5, 0.5]] },
    }
    const contentHash = "962d19749afe5a8fb511ea7b17458065dbf11a89ee104a67d0e5cb89d16485c7"
    const embeddings: EmbeddingRecord[] = [{
      memoryId: "a",
      memoryUpdatedAt: "2026-01-01T00:00:00.000Z",
      contentHash,
      profileName: "test",
      model: "test",
      dimensions: 2,
      vector: [0.5, 0.5],
      createdAt: "2026-01-01T00:00:00.000Z",
    }]
    const invalidations: EmbeddingInvalidationRecord[] = [{
      type: "invalidation",
      memoryId: "a",
      invalidatedAt: "2026-01-01T00:00:01.000Z",
      reason: "updated",
    }]

    const r = await retrieveSemanticMemories(memories, embeddings, invalidations, "package manager", "", config, provider)

    assert.equal(r.semantic.enabled, true)
    assert.equal(r.semantic.used, true)
    assert.equal(r.semantic.fallbackReason, "No semantic matches")
  })

  it("falls back gracefully when provider throws", async () => {
    const memories = [rec({ id: "a", text: "use pnpm" })]
    const config = enabledSemanticConfig()
    const provider = {
      async embed(): Promise<number[][]> { throw new Error("network error") },
    }
    const r = await retrieveSemanticMemories(memories, [], [], "pnpm", "", config, provider)
    // Should fall back to lexical
    assert.equal(r.semantic.used, false)
  })
})
