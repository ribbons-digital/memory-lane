import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { compact, shouldCompact } from "../src/compact.js"
import { tempDir } from "./helpers.js"
import { createMemoryId } from "../src/storage.js"
import type { MemoryRecord } from "../src/types.js"

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex")
}

function rec(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: overrides.id ?? createMemoryId(),
    status: overrides.status ?? "approved",
    text: overrides.text ?? "x",
    category: overrides.category ?? "project",
    scope: { type: "project", key: "/p" },
    source: overrides.source ?? "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

describe("compact", () => {
  let dir: string, mf: string, ef: string
  beforeEach(() => {
    dir = tempDir()
    mf = path.join(dir, "m.jsonl")
    ef = path.join(dir, "e.jsonl")
  })

  it("removes deleted and rejected memories", () => {
    const records = [
      rec({ status: "approved", id: "a" }),
      rec({ status: "deleted", id: "b" }),
      rec({ status: "rejected", id: "c" }),
    ]
    fs.writeFileSync(mf, records.map(JSON.stringify).join("\n") + "\n", "utf8")
    const r = compact(mf, ef)
    assert.equal(r.removedMemories, 2)
    const remaining = fs.readFileSync(mf, "utf8").split("\n").filter(Boolean)
    assert.equal(remaining.length, 1)
    assert.equal(JSON.parse(remaining[0]).id, "a")
  })

  it("handles empty memory file", () => {
    fs.writeFileSync(mf, "", "utf8")
    const r = compact(mf, ef)
    assert.equal(r.removedMemories, 0)
    assert.equal(r.removedEmbeddings, 0)
  })

  it("handles missing memory file", () => {
    const r = compact(mf, ef)
    assert.equal(r.removedMemories, 0)
    assert.equal(r.removedEmbeddings, 0)
  })

  it("compacts embeddings for deleted memories", () => {
    const alive = rec({ id: "alive", status: "approved" })
    const dead = rec({ id: "dead", status: "deleted" })
    fs.writeFileSync(mf, [alive, dead].map(JSON.stringify).join("\n") + "\n", "utf8")

    // alive memory has text "x" (default from rec()), so contentHash must be sha256("x")
    const embAlive = { memoryId: "alive", contentHash: sha256("x"), profileName: "p", model: "m", dimensions: 1, vector: [0.5], createdAt: "2026-01-01T00:00:00.000Z", memoryUpdatedAt: "2026-01-01T00:00:00.000Z" }
    const embDead = { memoryId: "dead", contentHash: sha256("x"), profileName: "p", model: "m", dimensions: 1, vector: [0.5], createdAt: "2026-01-01T00:00:00.000Z", memoryUpdatedAt: "2026-01-01T00:00:00.000Z" }
    const invalidation = { type: "invalidation", memoryId: "dead", invalidatedAt: "2026-01-01T00:00:00.000Z", reason: "deleted" }
    fs.writeFileSync(ef, [embAlive, embDead, invalidation].map(JSON.stringify).join("\n") + "\n", "utf8")

    const r = compact(mf, ef)
    assert.ok(r.removedEmbeddings >= 2) // dead embedding + invalidation
    const embLines = fs.readFileSync(ef, "utf8").split("\n").filter(Boolean)
    assert.equal(embLines.length, 1)
    assert.equal(JSON.parse(embLines[0]).memoryId, "alive")
  })

  it("keeps all approved memories", () => {
    const records = [
      rec({ status: "approved", id: "x" }),
      rec({ status: "approved", id: "y" }),
      rec({ status: "pending", id: "z" }),
    ]
    fs.writeFileSync(mf, records.map(JSON.stringify).join("\n") + "\n", "utf8")
    compact(mf, ef)
    const remaining = fs.readFileSync(mf, "utf8").split("\n").filter(Boolean)
    assert.equal(remaining.length, 3)
  })

  it("preserves invalid rows while compacting valid memory records", () => {
    const alive = rec({ status: "approved", id: "alive" })
    const dead = rec({ status: "deleted", id: "dead" })
    const invalidJson = "{not json"
    const invalidRecord = JSON.stringify({ foo: 1 })
    fs.writeFileSync(mf, [alive, dead].map(JSON.stringify).concat([invalidRecord, invalidJson]).join("\n") + "\n", "utf8")

    const report = compact(mf, ef)
    const remaining = fs.readFileSync(mf, "utf8").split("\n").filter(Boolean)

    assert.equal(report.removedMemories, 1)
    assert.equal(remaining.length, 3)
    assert.equal(JSON.parse(remaining[0]).id, "alive")
    assert.ok(remaining.includes(invalidRecord))
    assert.ok(remaining.includes(invalidJson))
  })
})

describe("shouldCompact", () => {
  it("ignores invalid JSON records when calculating dead weight", () => {
    const dir = tempDir()
    const f = path.join(dir, "m.jsonl")
    const records = [
      ...Array.from({ length: 70 }, (_, i) => rec({ id: `a${i}`, status: "approved" })),
      ...Array.from({ length: 40 }, (_, i) => rec({ id: `d${i}`, status: "deleted" })),
    ]
    fs.writeFileSync(f, records.map(JSON.stringify).concat([JSON.stringify({ foo: 1 })]).join("\n") + "\n", "utf8")
    assert.equal(shouldCompact(f), true)
  })
})

describe("shouldCompact", () => {
  it("returns false for missing file", () => {
    assert.equal(shouldCompact("/nonexistent/file.jsonl"), false)
  })

  it("returns false for small files", () => {
    const dir = tempDir()
    const f = path.join(dir, "m.jsonl")
    // Write fewer than 100 records
    const records = Array.from({ length: 5 }, (_, i) => rec({ id: `${i}`, status: "deleted" }))
    fs.writeFileSync(f, records.map(JSON.stringify).join("\n") + "\n", "utf8")
    assert.equal(shouldCompact(f), false)
  })

  it("returns true when dead weight > 30% with 100+ records", () => {
    const dir = tempDir()
    const f = path.join(dir, "m.jsonl")
    // 70 approved, 40 deleted = 36% dead weight
    const records = [
      ...Array.from({ length: 70 }, (_, i) => rec({ id: `a${i}`, status: "approved" })),
      ...Array.from({ length: 40 }, (_, i) => rec({ id: `d${i}`, status: "deleted" })),
    ]
    fs.writeFileSync(f, records.map(JSON.stringify).join("\n") + "\n", "utf8")
    assert.equal(shouldCompact(f), true)
  })

  it("returns false when dead weight <= 30%", () => {
    const dir = tempDir()
    const f = path.join(dir, "m.jsonl")
    // 90 approved, 20 deleted = 18% dead weight
    const records = [
      ...Array.from({ length: 90 }, (_, i) => rec({ id: `a${i}`, status: "approved" })),
      ...Array.from({ length: 20 }, (_, i) => rec({ id: `d${i}`, status: "deleted" })),
    ]
    fs.writeFileSync(f, records.map(JSON.stringify).join("\n") + "\n", "utf8")
    assert.equal(shouldCompact(f), false)
  })
})
