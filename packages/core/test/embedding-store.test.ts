import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { foldEmbeddings } from "../src/embedding-store.js"
import type { EmbeddingRecord } from "../src/types.js"

function embedding(overrides: Partial<EmbeddingRecord> = {}): EmbeddingRecord {
  return {
    memoryId: overrides.memoryId ?? "memory-a",
    memoryUpdatedAt: overrides.memoryUpdatedAt ?? "2026-01-01T00:00:00.000Z",
    contentHash: overrides.contentHash ?? "hash-a",
    profileName: overrides.profileName ?? "profile-a",
    model: overrides.model ?? "model-a",
    dimensions: overrides.dimensions ?? 2,
    vector: overrides.vector ?? [1, 0],
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  }
}

describe("foldEmbeddings", () => {
  it("keeps distinct content-hash variants for the same memory profile and model", () => {
    const folded = foldEmbeddings([
      embedding({ contentHash: "old-hash", createdAt: "2026-01-01T00:00:00.000Z" }),
      embedding({ contentHash: "new-hash", createdAt: "2026-01-01T00:00:01.000Z" }),
    ])

    assert.deepEqual(folded.map((record) => record.contentHash).sort(), ["new-hash", "old-hash"])
  })

  it("keeps the latest embedding for an exact memory content profile and model variant", () => {
    const folded = foldEmbeddings([
      embedding({ contentHash: "same-hash", vector: [1, 0], createdAt: "2026-01-01T00:00:00.000Z" }),
      embedding({ contentHash: "same-hash", vector: [0, 1], createdAt: "2026-01-01T00:00:01.000Z" }),
    ])

    assert.equal(folded.length, 1)
    assert.deepEqual(folded[0].vector, [0, 1])
  })
})
