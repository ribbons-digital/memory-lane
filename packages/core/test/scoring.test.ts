import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { cosineSimilarity, lexicalScore, recencyScore, findMatchingEmbedding } from "../src/scoring.js"
import type { EmbeddingRecord } from "../src/types.js"

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1)
  })
  it("returns 0 for orthogonal vectors", () => {
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
  })
  it("returns 0 for empty input", () => {
    assert.equal(cosineSimilarity([], []), 0)
  })
  it("returns 0 for mismatched lengths", () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0)
  })
  it("returns correct value for 45deg", () => {
    const score = cosineSimilarity([1, 1], [1, 0])
    assert.ok(Math.abs(score - 0.7071) < 0.001)
  })
})

describe("lexicalScore", () => {
  it("finds matching tokens", () => {
    assert.ok(lexicalScore("use pnpm", "always use pnpm for installs") > 0)
  })
  it("returns 0 for no match", () => {
    assert.equal(lexicalScore("docker", "use pnpm"), 0)
  })
  it("returns 0 for empty query", () => {
    assert.equal(lexicalScore("", "some text"), 0)
  })
  it("matches partial words (4+ chars)", () => {
    assert.ok(lexicalScore("install", "installation") > 0)
    assert.ok(lexicalScore("docker", "dockerfile") > 0)
  })
})

describe("recencyScore", () => {
  it("returns 1 for current timestamp", () => {
    const score = recencyScore(new Date().toISOString(), Date.now())
    assert.ok(score > 0.9)
  })
  it("decays over time", () => {
    const old = recencyScore("2025-01-01T00:00:00.000Z", Date.now())
    const recent = recencyScore(new Date().toISOString(), Date.now())
    assert.ok(old < recent)
  })
  it("returns 0 for invalid date", () => {
    assert.equal(recencyScore("not-a-date"), 0)
  })
})

describe("findMatchingEmbedding", () => {
  it("finds exact match", () => {
    const emb: EmbeddingRecord = {
      memoryId: "a", memoryUpdatedAt: "2026-01-01T00:00:00.000Z",
      contentHash: "abc", profileName: "p1", model: "m1",
      dimensions: 3, vector: [1, 2, 3], createdAt: "2026-01-01T00:00:00.000Z",
    }
    assert.equal(findMatchingEmbedding([emb], "a", "abc", "p1", "m1"), emb)
    assert.equal(findMatchingEmbedding([emb], "a", "abc", "p1", "m2"), undefined)
  })
})
