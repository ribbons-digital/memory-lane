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

describe("createMemoryId", () => {
  it("returns 32 lowercase hexadecimal characters", () => {
    assert.match(createMemoryId(), /^[0-9a-f]{32}$/)
  })
})

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

  it("loads an existing short non-empty id unchanged", () => {
    fs.writeFileSync(file, JSON.stringify(rec({ id: "legacy-id" })) + "\n", "utf8")

    const memories = createMemoryStore(file).list()

    assert.deepEqual(memories.map(memory => memory.id), ["legacy-id"])
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

  it("reports skipped malformed and schema-invalid rows", () => {
    fs.writeFileSync(file, [
      JSON.stringify(rec({ id: "ok" })),
      "garbage",
      JSON.stringify({ id: "bad", status: "approved", text: "missing required fields" }),
      "",
    ].join("\n"), "utf8")

    const diagnostics = createMemoryStore(file).diagnostics()

    assert.equal(diagnostics.totalRows, 3)
    assert.equal(diagnostics.validRows, 1)
    assert.equal(diagnostics.skippedRows, 2)
    assert.equal(diagnostics.malformedRows, 1)
    assert.equal(diagnostics.invalidRows, 1)
  })

  it("storage accepts old records without provenance", () => {
    const record = rec({ text: "Old memory without provenance" })
    fs.writeFileSync(file, JSON.stringify(record) + "\n", "utf8")

    const store = createMemoryStore(file)
    const memories = store.list()
    assert.equal(memories.length, 1)
    assert.equal(memories[0].text, "Old memory without provenance")
    assert.equal(memories[0].provenance, undefined)
  })

  it("normalizes historical records that predate source and scope fields", () => {
    const legacyRecord = {
      id: "legacy1",
      status: "pending",
      text: "Historical pending memory",
      category: "project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
    fs.writeFileSync(file, JSON.stringify(legacyRecord) + "\n", "utf8")

    const memories = createMemoryStore(file).list()

    assert.equal(memories.length, 1)
    assert.equal(memories[0].id, "legacy1")
    assert.equal(memories[0].source, "manual")
    assert.deepEqual(memories[0].scope, { type: "global" })
    assert.equal(memories[0].kind, undefined)
  })

  it("storage rejects malformed provenance when present", () => {
    const record = {
      ...rec({ text: "Bad provenance" }),
      provenance: { adapter: "codex", lifecycleEvent: "CodexStop" },
    }
    fs.writeFileSync(file, JSON.stringify(record) + "\n", "utf8")

    const store = createMemoryStore(file)
    assert.deepEqual(store.list(), [])
  })

  it("storage preserves valid revision metadata", () => {
    const file = path.join(dir, "memories.jsonl")
    const store = createMemoryStore(file)
    const record: MemoryRecord = {
      id: "revision-valid",
      text: "Refined workflow rule",
      category: "project",
      scope: { type: "project", key: "project-a" },
      status: "approved",
      source: "manual",
      kind: "workflow_rule",
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T01:00:00.000Z",
      revision: {
        supersedes: ["old-a", "old-b"],
        reason: "merged duplicate workflow memories",
        revisedAt: "2026-06-18T01:00:00.000Z",
        revisedBy: "cli",
      },
    }

    store.append(record)

    assert.deepEqual(store.list()[0].revision, record.revision)
  })

  it("storage skips records with invalid revision metadata", () => {
    const file = path.join(dir, "memories.jsonl")
    fs.writeFileSync(file, JSON.stringify({
      id: "revision-invalid",
      text: "Bad revision",
      category: "project",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
      revision: { supersededBy: "new-id", revisedAt: "not-an-iso-date", revisedBy: "robot" },
    }) + "\n", "utf8")

    const store = createMemoryStore(file)

    assert.equal(store.list().length, 0)
    assert.equal(store.diagnostics().invalidRows, 1)
  })

  it("caches reads", () => {
    const store = createMemoryStore(file)
    store.append(rec({ id: "a" }))
    const first = store.list()
    const second = store.list()
    assert.equal(first, second) // same array ref from cache
  })

  it("appendMany recovers a stale lock from a dead owner process", () => {
    const lockDir = file + ".lock"
    fs.mkdirSync(lockDir)
    fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ pid: 9_999_999, createdAt: Date.now() }), "utf8")
    const store = createMemoryStore(file)

    store.appendMany([rec({ id: "a", text: "after stale lock" })])

    assert.equal(store.list().length, 1)
    assert.equal(fs.existsSync(lockDir), false)
  })

  it("appendMany inserts a separator when the existing file lacks a trailing newline", () => {
    fs.writeFileSync(file, JSON.stringify(rec({ id: "a", text: "first" })), "utf8")
    const store = createMemoryStore(file)

    store.appendMany([rec({ id: "b", text: "second" })])

    assert.equal(store.readLog().length, 2)
    assert.match(fs.readFileSync(file, "utf8"), /first.*\n.*second/su)
  })

  it("appendMany appends records and refreshes cached folded reads", () => {
    const store = createMemoryStore(file)
    store.append(rec({ id: "a", text: "old", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }))
    const first = store.list()

    store.appendMany([
      rec({ id: "a", text: "new", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" }),
      rec({ id: "b", text: "second", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" }),
    ])

    const second = store.list()
    assert.notEqual(second, first)
    assert.deepEqual(second.map((memory) => [memory.id, memory.text]), [["a", "new"], ["b", "second"]])
    assert.equal(store.readLog().length, 3)
  })
})
