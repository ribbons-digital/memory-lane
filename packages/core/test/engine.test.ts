import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { MemoryEngine } from "../src/engine.js"
import { contentHash } from "../src/engine-helpers.js"
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

  function readJsonl(file: string): any[] {
    if (!fs.existsSync(file)) return []
    return fs.readFileSync(file, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
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


  it("updates active memories with validation and preserves identity", () => {
    const e = engine()
    const saved = e.save({
      text: "Original memory text",
      category: "project",
      status: "pending",
      source: "agent-suggested",
      kind: "project_fact",
      provenance: {
        adapter: "codex",
        lifecycleEvent: "turn_stop",
        sessionId: "session-1",
      },
    })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    const updated = e.update(saved.memory.id, {
      text: "  Updated memory text  ",
      category: "personal",
      status: "approved",
      kind: "personal_context",
    })

    assert.ok(updated)
    assert.equal(updated!.id, saved.memory.id)
    assert.equal(updated!.createdAt, saved.memory.createdAt)
    assert.equal(updated!.text, "Updated memory text")
    assert.equal(updated!.category, "personal")
    assert.equal(updated!.status, "approved")
    assert.equal(updated!.kind, "personal_context")
    assert.equal(updated!.source, "agent-suggested")
    assert.deepEqual(updated!.scope, saved.memory.scope)
    assert.deepEqual(updated!.project, saved.memory.project)
    assert.deepEqual(updated!.provenance, saved.memory.provenance)
    assert.equal(e.list({ all: true }).find((memory) => memory.id === saved.memory.id)?.text, "Updated memory text")
    const log = readJsonl(path.join(dir, "mem.jsonl"))
    assert.equal(log.length, 2)
    assert.equal(log[1].id, saved.memory.id)
  })

  it("does not update rejected deleted or missing memories", () => {
    const e = engine()
    const rejectedSource = e.save({ text: "Reject before update", status: "pending" })
    assert.equal(rejectedSource.status, "saved")
    if (rejectedSource.status !== "saved") return
    e.reject(rejectedSource.memory.id)

    const deletedSource = e.save({ text: "Delete before update", status: "approved" })
    assert.equal(deletedSource.status, "saved")
    if (deletedSource.status !== "saved") return
    e.delete(deletedSource.memory.id)
    const logLength = readJsonl(path.join(dir, "mem.jsonl")).length

    assert.equal(e.update(rejectedSource.memory.id, { text: "Should not update rejected" }), undefined)
    assert.equal(e.update(deletedSource.memory.id, { text: "Should not update deleted" }), undefined)
    assert.equal(e.update("missing", { text: "Should not update missing" }), undefined)
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, logLength)
  })

  it("rejects invalid update patches before writing", () => {
    const e = engine()
    const saved = e.save({ text: "Original valid memory", status: "approved" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    assert.throws(() => e.update(saved.memory.id, { text: "   " }), /empty/i)
    assert.throws(() => e.update(saved.memory.id, { text: "my key is sk-abc123def456ghi789jkl" }), /secret/i)
    assert.throws(
      () => e.update(saved.memory.id, { category: "research" } as any),
      /Invalid category.*research/,
    )
    assert.throws(
      () => e.update(saved.memory.id, { status: "rejected" } as any),
      /Invalid status.*rejected.*pending, approved/,
    )
    assert.throws(
      () => e.update(saved.memory.id, { status: "archived" } as any),
      /Invalid status.*archived.*pending, approved/,
    )
    assert.throws(
      () => e.update(saved.memory.id, { kind: "research" } as any),
      /Invalid kind.*research/,
    )
    assert.equal(e.list({ all: true }).find((memory) => memory.id === saved.memory.id)?.text, "Original valid memory")
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, 1)
  })

  it("update invalidates embeddings and auto-embeds approved safe memories", async () => {
    fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({
      semantic: {
        enabled: true,
        activeEmbeddingProfile: "test-profile",
        embeddings: {
          profiles: {
            "test-profile": {
              provider: "openai-compatible-embeddings",
              baseUrl: "http://localhost:11434",
              model: "test-model",
            },
          },
        },
      },
    }), "utf8")
    const embeddedInputs: string[] = []
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem.jsonl"),
      embeddingsPath: path.join(dir, "emb.jsonl"),
      configPath: path.join(dir, "cfg.json"),
      embeddingProvider: {
        async embed(inputs: string[]) {
          embeddedInputs.push(...inputs)
          return inputs.map(() => [1, 0, 0])
        },
      },
    })
    const saved = e.save({ text: "Initial approved memory", status: "approved" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    const updated = e.update(saved.memory.id, { text: "Updated approved memory" })
    assert.equal(updated?.text, "Updated approved memory")
    await new Promise((resolve) => setImmediate(resolve))

    assert.ok(embeddedInputs.includes("Updated approved memory"))
    const embeddingLog = readJsonl(path.join(dir, "emb.jsonl"))
    assert.ok(embeddingLog.some((entry) => entry.type === "invalidation" && entry.memoryId === saved.memory.id && entry.reason === "updated"))
    assert.ok(embeddingLog.some((entry) => entry.memoryId === saved.memory.id && entry.memoryUpdatedAt === updated?.updatedAt))
  })

  it("update returns Obsidian mirror warnings without preventing JSONL update", () => {
    const missingVault = path.join(dir, "missing-vault")
    fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({
      obsidian: { enabled: true, vaultPath: missingVault, folder: "Memory Lane", mode: "mirror" },
    }), "utf8")
    const e = engine()
    const saved = e.save({ text: "Update despite mirror warning", status: "approved" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    const updated = e.update(saved.memory.id, { text: "Updated despite mirror warning" })

    assert.equal(updated?.text, "Updated despite mirror warning")
    assert.match(updated?.warnings?.join("\n") ?? "", /Vault path does not exist/u)
    assert.equal(e.list({ all: true }).find((memory) => memory.id === saved.memory.id)?.text, "Updated despite mirror warning")
  })

  it("status transitions return Obsidian mirror warnings", () => {
    const missingVault = path.join(dir, "missing-vault")
    fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({
      obsidian: { enabled: true, vaultPath: missingVault, folder: "Memory Lane", mode: "mirror" },
    }), "utf8")
    const e = engine()

    const pending = e.save({ text: "approve warning", status: "pending" })
    assert.equal(pending.status, "saved")
    if (pending.status !== "saved") return
    const approved = e.approve(pending.memory.id)
    assert.equal(approved?.status, "approved")
    assert.match(approved?.warnings?.join("\n") ?? "", /Vault path does not exist/u)

    const rejectedSource = e.save({ text: "reject warning", status: "pending" })
    assert.equal(rejectedSource.status, "saved")
    if (rejectedSource.status !== "saved") return
    const rejected = e.reject(rejectedSource.memory.id)
    assert.equal(rejected?.status, "rejected")
    assert.match(rejected?.warnings?.join("\n") ?? "", /Vault path does not exist/u)

    const deletedSource = e.save({ text: "delete warning", status: "approved" })
    assert.equal(deletedSource.status, "saved")
    if (deletedSource.status !== "saved") return
    const deleted = e.delete(deletedSource.memory.id)
    assert.equal(deleted?.status, "deleted")
    assert.match(deleted?.warnings?.join("\n") ?? "", /Vault path does not exist/u)
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

  it("doctor does not warn about semantic under-indexing when semantic search is disabled", () => {
    const configPath = path.join(dir, "cfg-disabled-semantic.json")
    fs.writeFileSync(configPath, JSON.stringify({ semantic: { enabled: false } }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-disabled-semantic.jsonl"),
      embeddingsPath: path.join(dir, "emb-disabled-semantic.jsonl"),
      configPath,
    })
    e.save({ text: "approved text", status: "approved" })

    const report = e.doctor()

    assert.equal(report.semanticApprovedMemories, 1)
    assert.equal(report.semanticEmbeddedApprovedMemories, 0)
    assert.equal(report.semanticEmbeddingCoverage, 1)
    assert.deepEqual(report.semanticWarnings, [])
  })

  it("doctor warns when semantic search is enabled and approved memories are under-indexed", () => {
    const configPath = path.join(dir, "cfg-semantic-under-indexed.json")
    fs.writeFileSync(configPath, JSON.stringify({
      semantic: {
        enabled: true,
        activeEmbeddingProfile: "test-profile",
        embeddings: {
          profiles: {
            "test-profile": {
              provider: "openai-compatible-embeddings",
              baseUrl: "http://localhost:11434",
              model: "test-model",
            },
          },
        },
      },
    }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-semantic-under-indexed.jsonl"),
      embeddingsPath: path.join(dir, "emb-semantic-under-indexed.jsonl"),
      configPath,
    })
    e.save({ text: "first approved memory", status: "approved" })
    e.save({ text: "second approved memory", status: "approved" })

    const report = e.doctor()

    assert.equal(report.semanticApprovedMemories, 2)
    assert.equal(report.semanticEmbeddedApprovedMemories, 0)
    assert.equal(report.semanticEmbeddingCoverage, 0)
    assert.match((report.semanticWarnings as string[]).join("\n"), /only 0\/2 approved memories have current embeddings/)
    assert.match((report.semanticWarnings as string[]).join("\n"), /memory-lane reindex/)
  })

  it("doctor does not warn when every approved memory has a current embedding", () => {
    const configPath = path.join(dir, "cfg-semantic-current.json")
    const embPath = path.join(dir, "emb-semantic-current.jsonl")
    fs.writeFileSync(configPath, JSON.stringify({
      semantic: {
        enabled: true,
        activeEmbeddingProfile: "test-profile",
        embeddings: {
          profiles: {
            "test-profile": {
              provider: "openai-compatible-embeddings",
              baseUrl: "http://localhost:11434",
              model: "test-model",
            },
          },
        },
      },
    }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-semantic-current.jsonl"),
      embeddingsPath: embPath,
      configPath,
    })
    const saved = e.save({ text: "fully indexed memory", status: "approved" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    fs.appendFileSync(embPath, JSON.stringify({
      memoryId: saved.memory.id,
      memoryUpdatedAt: saved.memory.updatedAt,
      contentHash: contentHash(saved.memory.text),
      profileName: "test-profile",
      model: "test-model",
      dimensions: 2,
      vector: [1, 0],
      createdAt: new Date().toISOString(),
    }) + "\n", "utf8")

    const report = e.doctor()

    assert.equal(report.semanticApprovedMemories, 1)
    assert.equal(report.semanticEmbeddedApprovedMemories, 1)
    assert.equal(report.semanticEmbeddingCoverage, 1)
    assert.deepEqual(report.semanticWarnings, [])
  })

  it("doctor ignores stale embeddings with mismatched content hash model or profile", () => {
    const configPath = path.join(dir, "cfg-semantic-stale.json")
    const embPath = path.join(dir, "emb-semantic-stale.jsonl")
    fs.writeFileSync(configPath, JSON.stringify({
      semantic: {
        enabled: true,
        activeEmbeddingProfile: "test-profile",
        embeddings: {
          profiles: {
            "test-profile": {
              provider: "openai-compatible-embeddings",
              baseUrl: "http://localhost:11434",
              model: "test-model",
            },
          },
        },
      },
    }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-semantic-stale.jsonl"),
      embeddingsPath: embPath,
      configPath,
    })
    const saved = e.save({ text: "current indexed text", status: "approved" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    const base = {
      memoryId: saved.memory.id,
      memoryUpdatedAt: saved.memory.updatedAt,
      dimensions: 2,
      vector: [1, 0],
      createdAt: new Date().toISOString(),
    }
    fs.appendFileSync(embPath, JSON.stringify({
      ...base,
      contentHash: contentHash("old indexed text"),
      profileName: "test-profile",
      model: "test-model",
    }) + "\n", "utf8")
    fs.appendFileSync(embPath, JSON.stringify({
      ...base,
      contentHash: contentHash(saved.memory.text),
      profileName: "test-profile",
      model: "other-model",
    }) + "\n", "utf8")
    fs.appendFileSync(embPath, JSON.stringify({
      ...base,
      contentHash: contentHash(saved.memory.text),
      profileName: "other-profile",
      model: "test-model",
    }) + "\n", "utf8")

    const report = e.doctor()

    assert.equal(report.semanticApprovedMemories, 1)
    assert.equal(report.semanticEmbeddedApprovedMemories, 0)
    assert.equal(report.semanticEmbeddingCoverage, 0)
    assert.match((report.semanticWarnings as string[]).join("\n"), /only 0\/1 approved memories have current embeddings/)
  })

  it("doctor reports disabled obsidian mirror", () => {
    const e = engine()
    const report = e.doctor()
    assert.equal(report.obsidianEnabled, false)
    assert.deepEqual(report.obsidianWarnings, [])
  })

  it("doctor reports healthy obsidian folders without writing", () => {
    const vault = path.join(dir, "vault")
    fs.mkdirSync(path.join(vault, "Memory Lane", "memories"), { recursive: true })
    fs.mkdirSync(path.join(vault, "Memory Lane", "imports"), { recursive: true })
    const configPath = path.join(dir, "cfg.json")
    fs.writeFileSync(configPath, JSON.stringify({ obsidian: { enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" } }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem.jsonl"),
      embeddingsPath: path.join(dir, "emb.jsonl"),
      configPath,
    })

    const mirrorRoot = path.join(vault, "Memory Lane")
    const before = fs.readdirSync(mirrorRoot).sort()
    const report = e.doctor()
    const after = fs.readdirSync(mirrorRoot).sort()

    assert.equal(report.obsidianEnabled, true)
    assert.equal(report.obsidianVaultPath, vault)
    assert.equal(report.obsidianFolder, "Memory Lane")
    assert.equal(report.obsidianMirrorRoot, mirrorRoot)
    assert.equal(report.obsidianMirrorFolderExists, true)
    assert.equal(report.obsidianMemoriesFolderExists, true)
    assert.equal(report.obsidianImportsFolderExists, true)
    assert.deepEqual(report.obsidianWarnings, [])
    assert.deepEqual(after, before)
  })

  it("doctor reports obsidian folder warnings", () => {
    const vault = path.join(dir, "vault")
    fs.mkdirSync(vault, { recursive: true })
    const configPath = path.join(dir, "cfg.json")
    fs.writeFileSync(configPath, JSON.stringify({ obsidian: { enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" } }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem.jsonl"),
      embeddingsPath: path.join(dir, "emb.jsonl"),
      configPath,
    })

    const report = e.doctor()

    assert.equal(report.obsidianEnabled, true)
    assert.equal(report.obsidianMirrorFolderExists, false)
    assert.equal(report.obsidianMemoriesFolderExists, false)
    assert.equal(report.obsidianImportsFolderExists, false)
    assert.match((report.obsidianWarnings as string[]).join("\n"), /Mirror folder does not exist/)
    assert.match((report.obsidianWarnings as string[]).join("\n"), /memories\/ folder does not exist/)
    assert.match((report.obsidianWarnings as string[]).join("\n"), /imports\/ folder does not exist/)
  })

  it("doctor reports missing obsidian vault path", () => {
    const vault = path.join(dir, "missing-vault")
    const configPath = path.join(dir, "cfg.json")
    fs.writeFileSync(configPath, JSON.stringify({ obsidian: { enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" } }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem.jsonl"),
      embeddingsPath: path.join(dir, "emb.jsonl"),
      configPath,
    })

    const report = e.doctor()

    assert.equal(report.obsidianEnabled, true)
    assert.equal(report.obsidianMirrorFolderExists, false)
    assert.match((report.obsidianWarnings as string[]).join("\n"), /Obsidian vault path does not exist/)
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
      assert.equal(result.warnings, undefined)
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
