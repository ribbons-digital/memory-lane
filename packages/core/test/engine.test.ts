import * as fs from "node:fs"
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

  it("rejects invalid save fields before writing", () => {
    const e = engine()

    assert.throws(
      () => e.save({ text: "invalid category", category: "research" } as any),
      /Invalid category.*research/,
    )
    assert.throws(
      () => e.save({ text: "invalid scope", scopeType: "team" } as any),
      /Invalid scopeType.*team/,
    )
    assert.throws(
      () => e.save({ text: "invalid status", status: "archived" } as any),
      /Invalid status.*archived/,
    )
    assert.throws(
      () => e.save({ text: "invalid kind", kind: "research" } as any),
      /Invalid kind.*research/,
    )
    assert.equal(e.list({ all: true }).length, 0)
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


  it("save stores optional memory provenance", () => {
    const e = engine()
    const result = e.save({
      text: "This repo uses pnpm for package management",
      category: "project",
      status: "approved",
      provenance: {
        adapter: "codex",
        lifecycleEvent: "turn_stop",
        sessionId: "session-1",
        turnId: "turn-1",
      },
    })

    assert.equal(result.status, "saved")
    if (result.status !== "saved") return
    assert.deepEqual(result.memory.provenance, {
      adapter: "codex",
      lifecycleEvent: "turn_stop",
      sessionId: "session-1",
      turnId: "turn-1",
    })
  })

  it("provenance survives approve reject and delete", () => {
    const e = engine()
    const saved = e.save({
      text: "This repo runs tests with pnpm test",
      category: "project",
      status: "pending",
      provenance: {
        adapter: "codex",
        lifecycleEvent: "post_tool_use",
        sessionId: "session-1",
        turnId: "turn-1",
        toolName: "Bash",
      },
    })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    const approved = e.approve(saved.memory.id)
    assert.equal(approved?.provenance?.adapter, "codex")
    assert.equal(approved?.provenance?.lifecycleEvent, "post_tool_use")

    const rejected = e.reject(saved.memory.id)
    assert.equal(rejected?.provenance?.adapter, "codex")
    assert.equal(rejected?.provenance?.toolName, "Bash")

    const deleted = e.delete(saved.memory.id)
    assert.equal(deleted?.provenance?.adapter, "codex")
    assert.equal(deleted?.provenance?.toolName, "Bash")
  })

  it("pending duplicate upgrade preserves existing provenance", () => {
    const e = engine()
    const pending = e.save({
      text: "This repo uses pnpm",
      category: "project",
      status: "pending",
      provenance: {
        adapter: "codex",
        lifecycleEvent: "turn_stop",
        sessionId: "session-1",
        turnId: "turn-1",
      },
    })
    assert.equal(pending.status, "saved")

    const approved = e.save({
      text: "This repo uses pnpm",
      category: "project",
      status: "approved",
      source: "manual",
      provenance: {
        adapter: "manual-test",
        lifecycleEvent: "user_prompt",
      },
    })

    assert.equal(approved.status, "saved")
    if (approved.status !== "saved") return
    assert.equal(approved.memory.status, "approved")
    assert.deepEqual(approved.memory.provenance, {
      adapter: "codex",
      lifecycleEvent: "turn_stop",
      sessionId: "session-1",
      turnId: "turn-1",
    })
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

  it("suggest creates pending entry by default", () => {
    const e = engine()
    const r = e.suggest("I prefer tabs", "preference", "global")
    assert.equal(r.status, "saved")
    if (r.status === "saved") {
      assert.equal(r.memory.status, "pending")
      assert.equal(r.memory.source, "user-suggested")
    }
  })

  it("suggest can auto-approve when status is explicit", () => {
    const e = engine()
    const r = e.suggest("remember this rule", "project", "project", undefined, "approved")
    assert.equal(r.status, "saved")
    if (r.status === "saved") {
      assert.equal(r.memory.status, "approved")
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

  it("save mirrors approved memory when obsidian mirror is configured", () => {
    const vault = path.join(dir, "vault")
    fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true })
    const configPath = path.join(dir, "config.json")
    fs.writeFileSync(configPath, JSON.stringify({
      obsidian: { enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" },
    }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "memory.jsonl"),
      embeddingsPath: path.join(dir, "embeddings.jsonl"),
      configPath,
    })

    const result = e.save({ text: "Mirror this memory", category: "project", status: "approved" })

    assert.equal(result.status, "saved")
    if (result.status === "saved") {
      assert.deepEqual(result.warnings, [])
      assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", `${result.memory.id}.md`)), true)
    }
  })

  it("delete removes mirrored file", () => {
    const vault = path.join(dir, "vault")
    fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true })
    const configPath = path.join(dir, "config.json")
    fs.writeFileSync(configPath, JSON.stringify({
      obsidian: { enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" },
    }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "memory.jsonl"),
      embeddingsPath: path.join(dir, "embeddings.jsonl"),
      configPath,
    })
    const saved = e.save({ text: "Delete mirrored memory", category: "project", status: "approved" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") throw new Error("expected save")
    const mirroredPath = path.join(vault, "Memory Lane", "memories", `${saved.memory.id}.md`)
    assert.equal(fs.existsSync(mirroredPath), true)

    e.delete(saved.memory.id)

    assert.equal(fs.existsSync(mirroredPath), false)
  })

  it("mirror warning does not prevent save when obsidian vault path is invalid", () => {
    const configPath = path.join(dir, "config.json")
    const missingVault = path.join(dir, "missing-vault")
    fs.writeFileSync(configPath, JSON.stringify({
      obsidian: { enabled: true, vaultPath: missingVault, folder: "Memory Lane", mode: "mirror" },
    }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "memory.jsonl"),
      embeddingsPath: path.join(dir, "embeddings.jsonl"),
      configPath,
    })

    const result = e.save({ text: "Save despite mirror warning", category: "project", status: "approved" })

    assert.equal(result.status, "saved")
    if (result.status === "saved") {
      assert.match(result.warnings?.join("\n") ?? "", /Vault path does not exist/u)
      assert.equal(e.list({ all: true }).some((memory) => memory.id === result.memory.id), true)
    }
  })
})
