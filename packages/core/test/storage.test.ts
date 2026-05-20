import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { createMemoryStore, createMemoryId, foldMemoryRecords } from "../src/storage.js"
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
    kind: overrides.kind,
  }
}

describe("MemoryStore", () => {
  let dir: string, file: string
  beforeEach(() => { dir = tempDir(); file = path.join(dir, "mem.jsonl") })

  it("returns empty for missing file", () => {
    const store = createMemoryStore(file)
    assert.equal(store.list().length, 0)
  })

  it("persists and retrieves", () => {
    const store = createMemoryStore(file)
    store.append(rec({ text: "hello" }))
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0].text, "hello")
  })

  it("folds duplicates by id", () => {
    const store = createMemoryStore(file)
    store.append(rec({ id: "a", text: "v1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }))
    store.append(rec({ id: "a", text: "v2", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" }))
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0].text, "v2")
  })

  it("skips malformed lines", () => {
    fs.writeFileSync(file, '{"id":"ok","status":"approved","text":"x","category":"project","scope":{"type":"project","key":"/p"},"source":"manual","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}\ngarbage\n', "utf8")
    assert.equal(createMemoryStore(file).list().length, 1)
  })

  it("caches reads", () => {
    const store = createMemoryStore(file)
    store.append(rec({ id: "a" }))
    const first = store.list()
    const second = store.list()
    assert.equal(first, second) // same array ref from cache
  })
})
