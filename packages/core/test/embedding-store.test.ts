import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createEmbeddingStore, foldEmbeddings } from "../src/embedding-store.js"
import type { EmbeddingRecord } from "../src/types.js"
import { tempDir } from "./helpers.js"

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

describe("EmbeddingStore batch append", () => {
  it("preserves a malformed trailing row and inserts a separator before the complete batch", () => {
    const file = path.join(tempDir(), "embeddings.jsonl")
    const malformedTail = "{malformed trailing row"
    fs.writeFileSync(file, malformedTail, "utf8")
    const store = createEmbeddingStore(file)
    const records = [
      embedding({ memoryId: "first" }),
      embedding({ memoryId: "second" }),
    ]

    store.appendMany(records)

    assert.equal(
      fs.readFileSync(file, "utf8"),
      malformedTail + "\n" + records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    )
    assert.deepEqual(store.readLog().map((record) => record.memoryId), ["first", "second"])
  })

  it("preserves existing trailing newlines without adding another separator", () => {
    const file = path.join(tempDir(), "embeddings.jsonl")
    const existing = "{malformed}\n\n"
    fs.writeFileSync(file, existing, "utf8")
    const store = createEmbeddingStore(file)
    const record = embedding()

    store.appendMany([record])

    assert.equal(fs.readFileSync(file, "utf8"), existing + JSON.stringify(record) + "\n")
  })

  it("leaves the original file unchanged when batch serialization fails", () => {
    const file = path.join(tempDir(), "embeddings.jsonl")
    const store = createEmbeddingStore(file)
    store.append(embedding({ memoryId: "existing" }))
    const before = fs.readFileSync(file, "utf8")
    const unserializable = embedding({ memoryId: "invalid" }) as EmbeddingRecord & { invalid: bigint }
    unserializable.invalid = 1n

    assert.throws(() => store.appendMany([embedding({ memoryId: "new" }), unserializable]), /BigInt/u)
    assert.equal(fs.readFileSync(file, "utf8"), before)
    assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), [path.basename(file)])
  })
})

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
