import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { MemoryEngine } from "../src/engine.js"
import { tempDir } from "./helpers.js"

describe("MemoryEngine", () => {
  let dir: string
  beforeEach(() => { dir = tempDir() })

  function engine() {
    return new MemoryEngine({
      memoryPath: path.join(dir, "mem.jsonl"),
      embeddingsPath: path.join(dir, "emb.jsonl"),
      configPath: path.join(dir, "cfg.json"),
    })
  }

  it("rejects empty text", () => {
    const e = engine()
    const r = e.save({ text: "" })
    assert.equal(r.status, "skipped")
    if (r.status === "skipped") assert.equal(r.reason, "empty")
  })

  it("rejects secrets", () => {
    const e = engine()
    const r = e.save({ text: "my key is sk-abc123def456ghi789jkl" })
    assert.equal(r.status, "skipped")
    if (r.status === "skipped") assert.equal(r.reason, "secret")
  })

  it("saves and lists memories", () => {
    const e = engine()
    const r = e.save({ text: "use pnpm for projects" })
    assert.equal(r.status, "saved")
    if (r.status === "saved") assert.equal(r.memory.status, "pending")
    assert.equal(e.list().length, 1)
  })

  it("saves with approved status", () => {
    const e = engine()
    const r = e.save({ text: "approved rule", status: "approved" })
    assert.equal(r.status, "saved")
    if (r.status === "saved") assert.equal(r.memory.status, "approved")
  })

  it("detects duplicates", () => {
    const e = engine()
    e.save({ text: "use pnpm" })
    const r = e.save({ text: "use pnpm" })
    assert.equal(r.status, "skipped")
    if (r.status === "skipped") assert.equal(r.reason, "duplicate")
  })

  it("approves pending memories", () => {
    const e = engine()
    const r = e.save({ text: "my rule", status: "pending" })
    assert.equal(r.status, "saved")
    if (r.status !== "saved") return
    const id = r.memory.id
    const updated = e.approve(id)
    assert.ok(updated)
    assert.equal(updated!.status, "approved")
    assert.equal(e.list().find((m) => m.id === id)?.status, "approved")
  })

  it("rejects memories", () => {
    const e = engine()
    const r = e.save({ text: "bad rule" })
    assert.equal(r.status, "saved")
    if (r.status !== "saved") return
    const rejected = e.reject(r.memory.id)
    assert.ok(rejected)
    assert.equal(rejected!.status, "rejected")
  })

  it("deletes memories", () => {
    const e = engine()
    const r = e.save({ text: "delete me", status: "approved" })
    assert.equal(r.status, "saved")
    if (r.status !== "saved") return
    const deleted = e.delete(r.memory.id)
    assert.ok(deleted)
    assert.equal(deleted!.status, "deleted")
    assert.equal(e.list().find((m) => m.id === r.memory.id)?.status, "deleted")
  })

  it("approve returns undefined for non-existent id", () => {
    const e = engine()
    assert.equal(e.approve("nonexistent"), undefined)
  })

  it("delete returns undefined for non-existent id", () => {
    const e = engine()
    assert.equal(e.delete("nonexistent"), undefined)
  })

  it("searches by text", () => {
    const e = engine()
    e.save({ text: "use pnpm", status: "approved" })
    e.save({ text: "deploy with docker", status: "approved" })
    const pnpm = e.search("pnpm")
    assert.equal(pnpm.length, 1)
    assert.equal(pnpm[0].text, "use pnpm")
    const docker = e.search("docker")
    assert.equal(docker.length, 1)
  })

  it("list with status filter", () => {
    const e = engine()
    e.save({ text: "pending memory" })
    e.save({ text: "approved memory", status: "approved" })
    assert.equal(e.list("pending").length, 1)
    assert.equal(e.list("approved").length, 1)
    assert.equal(e.list().length, 2)
  })

  it("reviewPending returns only pending memories", () => {
    const e = engine()
    e.save({ text: "pending memory" })
    e.save({ text: "approved memory", status: "approved" })
    const pending = e.reviewPending()
    assert.equal(pending.length, 1)
    assert.equal(pending[0].text, "pending memory")
  })

  it("suggest creates pending entry", () => {
    const e = engine()
    const r = e.suggest("I prefer tabs", "preference", "global")
    assert.equal(r.status, "saved")
    if (r.status === "saved") {
      assert.equal(r.memory.status, "pending")
      assert.equal(r.memory.source, "user-suggested")
    }
  })

  it("doctor returns stats", () => {
    const e = engine()
    e.save({ text: "approved text", status: "approved" })
    e.save({ text: "pending text" })
    const d = e.doctor()
    assert.equal(d.approvedMemories, 1)
    assert.equal(d.pendingMemories, 1)
    assert.equal(d.totalMemories, 2)
  })

  it("probe returns error without provider", async () => {
    const e = engine()
    const p = await e.probeEmbeddingProvider()
    assert.equal(p.ok, false)
    assert.ok(p.error)
  })

  it("recall returns lexical results", async () => {
    const e = engine()
    e.save({ text: "use pnpm", status: "approved" })
    const result = await e.recall("pnpm")
    assert.equal(result.memories.length, 1)
    assert.equal(result.semantic.used, false)
  })
})
