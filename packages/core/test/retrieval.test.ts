import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { retrieveSemanticMemories } from "../src/retrieval.js"
import type { MemoryRecord, EmbeddingRecord, SemanticMemoryConfig } from "../src/types.js"

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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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

  it("returns all visible for empty query", async () => {
    const memories = [rec({ id: "a" }), rec({ id: "b" })]
    const r = await retrieveSemanticMemories(memories, [], [], "", "", BASE_CONFIG)
    assert.equal(r.memories.length, 2)
    assert.equal(r.semantic.used, false)
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
