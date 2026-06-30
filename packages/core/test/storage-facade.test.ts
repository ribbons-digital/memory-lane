import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { contentHash } from "../src/engine-helpers.js"
import { createSingleStoreEngineStorage } from "../src/storage-facade.js"
import { createMemoryId } from "../src/storage.js"
import type { MemoryRecord } from "../src/types.js"
import { tempDir } from "./helpers.js"

function rec(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString()
  return {
    id: overrides.id ?? createMemoryId(),
    status: overrides.status ?? "approved",
    text: overrides.text ?? "test",
    category: overrides.category ?? "project",
    scope: overrides.scope ?? { type: "project", key: "/p" },
    source: overrides.source ?? "manual",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    project: overrides.project ?? { cwd: "/p", root: "/p", key: "/p" },
  }
}

describe("MemoryEngineStorage single-store facade", () => {
  let dir: string
  let memoryFile: string
  let embeddingFile: string

  beforeEach(() => {
    dir = tempDir()
    memoryFile = path.join(dir, "memories.jsonl")
    embeddingFile = path.join(dir, "embeddings.jsonl")
  })

  it("routes memory append, appendMany, list, read log, and diagnostics through one store", () => {
    const storage = createSingleStoreEngineStorage(memoryFile, embeddingFile)
    const first = rec({ id: "a", text: "first", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })
    storage.appendMemory(first)
    const cached = storage.listMemories()

    storage.appendMemories([
      rec({ id: "a", text: "updated", createdAt: first.createdAt, updatedAt: "2026-01-02T00:00:00.000Z" }),
      rec({ id: "b", text: "second", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" }),
    ])

    const listed = storage.listMemories()
    assert.notEqual(listed, cached)
    assert.deepEqual(listed.map((memory) => [memory.id, memory.text]), [["a", "updated"], ["b", "second"]])
    assert.equal(storage.readMemoryLog().length, 3)
    assert.equal(storage.memoryDiagnostics().validRows, 3)
  })

  it("routes embedding appends and invalidations through the facade", () => {
    const storage = createSingleStoreEngineStorage(memoryFile, embeddingFile)
    storage.appendEmbedding({
      memoryId: "a",
      memoryUpdatedAt: "2026-01-01T00:00:00.000Z",
      contentHash: contentHash("hello"),
      profileName: "default",
      model: "test-model",
      dimensions: 2,
      vector: [0.1, 0.2],
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    storage.appendEmbedding({ type: "invalidation", memoryId: "a", invalidatedAt: "2026-01-02T00:00:00.000Z", reason: "updated" })

    assert.equal(storage.listEmbeddings().length, 1)
    assert.equal(storage.listEmbeddingInvalidations().length, 1)
  })

  it("refreshes facade memory reads after compaction", () => {
    const storage = createSingleStoreEngineStorage(memoryFile, embeddingFile)
    storage.appendMemories([
      rec({ id: "a", text: "old", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }),
      rec({ id: "a", text: "new", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" }),
    ])
    const cached = storage.listMemories()
    assert.equal(cached[0].text, "new")
    assert.equal(storage.readMemoryLog().length, 2)

    const report = storage.compact()
    assert.equal(report.removedMemories, 0)
    assert.equal(storage.listMemories()[0].text, "new")
    assert.notEqual(storage.listMemories(), cached)
    assert.equal(storage.readMemoryLog().length, 1)
  })
})
