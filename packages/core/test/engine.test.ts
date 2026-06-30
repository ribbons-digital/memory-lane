import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { MemoryEngine } from "../src/engine.js"
import { normalizeMemoryRecord } from "../src/storage-validation.js"
import { contentHash } from "../src/engine-helpers.js"
import { createSingleStoreEngineStorage } from "../src/storage-facade.js"
import {
  selectOperatingAgreements,
  summarizeOperatingAgreements,
} from "../src/operating-agreements.js"
import type { MemoryRecord } from "../src/types.js"
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

  it("save persists optional freshness metadata", () => {
    const e = engine()
    const result = e.save({
      text: "Temporary project status expires soon",
      status: "approved",
      category: "project",
      scopeType: "project",
      kind: "project_fact",
      freshness: {
        expiresAt: "2026-07-01T00:00:00.000Z",
        staleAfterDays: 30,
        capturedAt: "2026-06-21T00:00:00.000Z",
      },
    })

    assert.equal(result.status, "saved")
    if (result.status !== "saved") throw new Error("expected saved")
    assert.deepEqual(result.memory.freshness, {
      expiresAt: "2026-07-01T00:00:00.000Z",
      staleAfterDays: 30,
      capturedAt: "2026-06-21T00:00:00.000Z",
    })
    assert.deepEqual(e.list()[0].freshness, result.memory.freshness)
  })

  it("suggest persists optional freshness metadata", () => {
    const e = engine()
    const result = e.suggest(
      "Review this temporary fact later",
      "project",
      "project",
      "project_fact",
      "pending",
      { staleAfterDays: 14 },
    )

    assert.equal(result.status, "saved")
    if (result.status !== "saved") throw new Error("expected saved")
    assert.equal(result.memory.status, "pending")
    assert.deepEqual(result.memory.freshness, { staleAfterDays: 14 })
  })

  it("approved duplicate upgrade can add freshness metadata", () => {
    const e = engine()
    const pending = e.save({ text: "Duplicate temporary fact", status: "pending" })
    assert.equal(pending.status, "saved")

    const approved = e.save({
      text: "Duplicate temporary fact",
      status: "approved",
      freshness: { expiresAt: "2026-07-01T00:00:00.000Z" },
    })

    assert.equal(approved.status, "saved")
    if (approved.status !== "saved") throw new Error("expected saved")
    assert.equal(approved.memory.status, "approved")
    assert.deepEqual(approved.memory.freshness, { expiresAt: "2026-07-01T00:00:00.000Z" })
  })

  it("save rejects invalid freshness metadata", () => {
    const e = engine()

    assert.throws(() => e.save({
      text: "Bad expires timestamp",
      status: "approved",
      freshness: { expiresAt: "tomorrow" },
    }), /Invalid freshness\.expiresAt/u)

    assert.throws(() => e.save({
      text: "Bad captured timestamp",
      status: "approved",
      freshness: { capturedAt: "2026-06-21" },
    }), /Invalid freshness\.capturedAt/u)

    assert.throws(() => e.save({
      text: "Bad stale days",
      status: "approved",
      freshness: { staleAfterDays: 0 },
    }), /Invalid freshness\.staleAfterDays/u)

    assert.throws(() => e.save({
      text: "Empty freshness",
      status: "approved",
      freshness: {},
    }), /Invalid freshness/u)

    assert.throws(() => e.save({
      text: "Null freshness",
      status: "approved",
      freshness: null as any,
    }), /Invalid freshness/u)
  })

  it("suggest validates freshness before meta-task filtering", () => {
    const e = engine()

    assert.throws(() => e.suggest(
      "Task: Review this code quality change",
      "project",
      "project",
      "project_fact",
      "pending",
      { expiresAt: "tomorrow" },
    ), /Invalid freshness\.expiresAt/u)
  })

  it("historical records without freshness remain valid", () => {
    const e = engine()
    const result = e.save({ text: "Historical shape remains valid", status: "approved" })
    assert.equal(result.status, "saved")
    const memory = e.list()[0]
    assert.equal(memory.freshness, undefined)
  })

  it("normalization rejects malformed freshness metadata", () => {
    const base = {
      id: "freshness-invalid",
      status: "approved",
      text: "Bad stored freshness",
      category: "project",
      scope: { type: "project" },
      source: "manual",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
    }

    assert.equal(normalizeMemoryRecord({ ...base, freshness: { expiresAt: "tomorrow" } }), undefined)
    assert.equal(normalizeMemoryRecord({ ...base, freshness: { staleAfterDays: 0 } }), undefined)
    assert.equal(normalizeMemoryRecord(base)?.freshness, undefined)
  })

  it("save persists normalized descriptor metadata", () => {
    const e = engine()
    const result = e.save({
      text: "Descriptor metadata source memory",
      status: "approved",
      descriptor: {
        description: "  Compact descriptor summary  ",
        fetchHint: "  when setting up descriptors  ",
        keywords: ["Descriptor", "metadata", "DESCRIPTOR"],
      },
    })

    assert.equal(result.status, "saved")
    if (result.status !== "saved") throw new Error("expected saved")
    assert.deepEqual(result.memory.descriptor, {
      description: "Compact descriptor summary",
      fetchHint: "when setting up descriptors",
      keywords: ["descriptor", "metadata"],
    })
    assert.deepEqual(e.list()[0].descriptor, result.memory.descriptor)
  })

  it("descriptor keyword limit applies after normalization and deduplication", () => {
    const e = engine()
    const result = e.save({
      text: "Descriptor keyword duplicate source",
      status: "approved",
      descriptor: { keywords: ["One", "one", "TWO", "two", "three", "THREE", "four", "FOUR", "five", "FIVE", "six", "SIX", "seven"] },
    })

    assert.equal(result.status, "saved")
    if (result.status !== "saved") throw new Error("expected saved")
    assert.deepEqual(result.memory.descriptor?.keywords, ["one", "two", "three", "four", "five", "six", "seven"])
  })

  it("save rejects invalid descriptor metadata", () => {
    const e = engine()

    assert.throws(() => e.save({
      text: "Bad descriptor description",
      status: "approved",
      descriptor: { description: "   " },
    }), /Invalid descriptor\.description/u)

    assert.throws(() => e.save({
      text: "Bad descriptor keyword",
      status: "approved",
      descriptor: { keywords: [""] },
    }), /Invalid descriptor\.keywords/u)

    assert.throws(() => e.save({
      text: "Secret descriptor",
      status: "approved",
      descriptor: { fetchHint: "api key is sk-abc123def456ghi789jkl" },
    }), /Invalid descriptor\.fetchHint/u)

    assert.throws(() => e.save({
      text: "Secret descriptor keyword",
      status: "approved",
      descriptor: { keywords: ["Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2"] },
    }), /Invalid descriptor\.keywords/u)

    assert.throws(() => e.save({
      text: "Long descriptor",
      status: "approved",
      descriptor: { description: "x".repeat(241) },
    }), /descriptor\.description.*240 characters/u)

    assert.throws(() => e.save({
      text: "Too many descriptor keywords",
      status: "approved",
      descriptor: { keywords: Array.from({ length: 13 }, (_, index) => `keyword-${index}`) },
    }), /descriptor\.keywords.*12 items/u)
  })

  it("ordinary text update preserves descriptor metadata until descriptor update support exists", () => {
    const e = engine()
    const saved = e.save({
      text: "Descriptor update source",
      status: "approved",
      descriptor: { description: "Existing descriptor" },
    })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") throw new Error("expected saved")

    const updated = e.update(saved.memory.id, { text: "Descriptor update revised text" })

    assert.equal(updated?.text, "Descriptor update revised text")
    assert.deepEqual(updated?.descriptor, { description: "Existing descriptor" })
  })

  it("approved duplicate upgrade applies explicit descriptor and otherwise preserves existing descriptor", () => {
    const e = engine()
    const pending = e.save({
      text: "Duplicate descriptor fact",
      status: "pending",
      descriptor: { description: "Original descriptor" },
    })
    assert.equal(pending.status, "saved")

    const upgraded = e.save({
      text: "Duplicate descriptor fact",
      status: "approved",
      descriptor: { description: "Updated descriptor", keywords: ["Updated"] },
    })
    assert.equal(upgraded.status, "saved")
    if (upgraded.status !== "saved") throw new Error("expected saved")
    assert.deepEqual(upgraded.memory.descriptor, { description: "Updated descriptor", keywords: ["updated"] })

    const secondEngine = engine()
    const secondPending = secondEngine.save({
      text: "Duplicate descriptor preserved",
      status: "pending",
      descriptor: { description: "Preserved descriptor" },
    })
    assert.equal(secondPending.status, "saved")
    const secondUpgraded = secondEngine.save({ text: "Duplicate descriptor preserved", status: "approved" })
    assert.equal(secondUpgraded.status, "saved")
    if (secondUpgraded.status !== "saved") throw new Error("expected saved")
    assert.deepEqual(secondUpgraded.memory.descriptor, { description: "Preserved descriptor" })
  })

  it("normalization accepts historical records without descriptor and rejects malformed descriptors", () => {
    const base = {
      id: "descriptor-invalid",
      status: "approved",
      text: "Stored descriptor validation",
      category: "project",
      scope: { type: "project" },
      source: "manual",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
    }

    assert.equal(normalizeMemoryRecord(base)?.descriptor, undefined)
    assert.equal(normalizeMemoryRecord({ ...base, descriptor: { description: "Valid descriptor", keywords: ["One", "one"] } })?.descriptor?.keywords?.join(","), "one")
    assert.equal(normalizeMemoryRecord({ ...base, descriptor: { description: 123 } }), undefined)
    assert.equal(normalizeMemoryRecord({ ...base, descriptor: { keywords: [""] } }), undefined)
  })

  it("approve and rescope preserve descriptor metadata", () => {
    const e = engine()
    const saved = e.save({
      text: "Descriptor preservation fact",
      status: "pending",
      category: "project",
      scopeType: "project",
      descriptor: { description: "Preserve this descriptor" },
    })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") throw new Error("expected saved")

    const approved = e.approve(saved.memory.id)
    assert.deepEqual(approved?.descriptor, { description: "Preserve this descriptor" })
    const rescoped = e.rescope(saved.memory.id, { scopeType: "global" })
    assert.deepEqual(rescoped?.proposed.descriptor, { description: "Preserve this descriptor" })
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

  it("update records revision metadata when reason is provided", () => {
    const e = engine()
    const saved = e.save({ text: "Old workflow wording", status: "approved", category: "project", kind: "workflow_rule" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    const updated = e.update(saved.memory.id, {
      text: "New workflow wording",
      reason: "clarified operating agreement",
      revisedBy: "cli",
    })

    assert.equal(updated?.id, saved.memory.id)
    assert.equal(updated?.text, "New workflow wording")
    assert.equal(updated?.revision?.reason, "clarified operating agreement")
    assert.equal(updated?.revision?.revisedBy, "cli")
    assert.match(updated?.revision?.revisedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u)
    assert.equal(updated?.revision?.supersedes, undefined)
    assert.equal(updated?.revision?.supersededBy, undefined)
  })

  it("update rejects metadata-only and no-op patches", () => {
    const e = engine()
    const saved = e.save({ text: "Stable memory", status: "approved", category: "project", kind: "project_fact" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    assert.throws(() => e.update(saved.memory.id, { reason: "reviewed", revisedBy: "cli" }), /No changes to apply/u)
    assert.throws(() => e.update(saved.memory.id, { text: "Stable memory" }), /No changes to apply/u)
  })

  it("previewUpdate returns proposed memory without writing or invalidating embeddings", () => {
    const e = engine()
    const saved = e.save({ text: "Preview source", status: "approved", category: "project", kind: "project_fact" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return
    const logBefore = readJsonl(path.join(dir, "mem.jsonl")).length

    const preview = e.previewUpdate(saved.memory.id, { text: "Preview target", reason: "dry run", revisedBy: "cli" })

    assert.equal(preview?.dryRun, true)
    assert.equal(preview?.current.text, "Preview source")
    assert.equal(preview?.proposed.text, "Preview target")
    assert.equal(preview?.proposed.revision?.reason, "dry run")
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, logBefore)
    assert.equal(readJsonl(path.join(dir, "emb.jsonl")).length, 0)
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
    assert.throws(
      () => e.update(saved.memory.id, { text: "Changed by invalid actor", revisedBy: "robot" } as any),
      /Invalid revisedBy.*robot.*manual, cli, mcp/,
    )
    assert.throws(
      () => e.previewUpdate(saved.memory.id, { text: "Preview by invalid actor", revisedBy: "robot" } as any),
      /Invalid revisedBy.*robot.*manual, cli, mcp/,
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

  it("approve invalidates embeddings and auto-embeds newly approved safe memories", async () => {
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
    const saved = e.save({ text: "Pending semantic memory", status: "pending" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    const approved = e.approve(saved.memory.id)
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(approved?.status, "approved")
    assert.ok(embeddedInputs.includes("Pending semantic memory"))
    const embeddingLog = readJsonl(path.join(dir, "emb.jsonl"))
    assert.ok(embeddingLog.some((entry) => entry.type === "invalidation" && entry.memoryId === saved.memory.id && entry.reason === "updated"))
    assert.ok(embeddingLog.some((entry) => entry.memoryId === saved.memory.id && entry.memoryUpdatedAt === approved?.updatedAt))
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

  it("supersede links one approved successor to many approved old memories", () => {
    const e = engine()
    const oldA = e.save({ text: "Old A", status: "approved", category: "project", kind: "workflow_rule" })
    const oldB = e.save({ text: "Old B", status: "approved", category: "project", kind: "workflow_rule" })
    const newer = e.save({ text: "New canonical", status: "approved", category: "project", kind: "workflow_rule" })
    assert.equal(oldA.status, "saved"); assert.equal(oldB.status, "saved"); assert.equal(newer.status, "saved")
    if (oldA.status !== "saved" || oldB.status !== "saved" || newer.status !== "saved") return

    const result = e.supersede(newer.memory.id, [oldA.memory.id, oldB.memory.id], { reason: "merged duplicates", revisedBy: "cli" })

    assert.equal(result.dryRun, false)
    assert.deepEqual(result.successor.revision?.supersedes, [oldA.memory.id, oldB.memory.id])
    assert.equal(result.successor.revision?.reason, "merged duplicates")
    assert.deepEqual(result.superseded.map((m) => m.revision?.supersededBy), [newer.memory.id, newer.memory.id])
    assert.equal(e.list({ all: true }).find((m) => m.id === oldA.memory.id)?.status, "approved")
  })

  it("supersede validates all inputs before writing", () => {
    const e = engine()
    const old = e.save({ text: "Old", status: "approved" })
    const pendingSuccessor = e.save({ text: "Pending successor", status: "pending" })
    const pendingOld = e.save({ text: "Pending old", status: "pending" })
    assert.equal(old.status, "saved"); assert.equal(pendingSuccessor.status, "saved"); assert.equal(pendingOld.status, "saved")
    if (old.status !== "saved" || pendingSuccessor.status !== "saved" || pendingOld.status !== "saved") return
    const logBefore = readJsonl(path.join(dir, "mem.jsonl")).length

    assert.throws(() => e.supersede("missing", [old.memory.id]), /Successor memory not found/u)
    assert.throws(() => e.supersede(pendingSuccessor.memory.id, [old.memory.id]), /Successor must be approved/u)
    assert.throws(() => e.supersede(old.memory.id, [old.memory.id]), /cannot supersede itself/u)
    assert.throws(() => e.supersede(old.memory.id, ["missing-old"]), /Old memory not found/u)
    assert.throws(() => e.supersede(old.memory.id, [pendingOld.memory.id]), /Old must be approved/u)
    assert.throws(() => e.supersede(old.memory.id, [pendingOld.memory.id, pendingOld.memory.id]), /Old memory ids must be unique/u)
    assert.throws(() => e.supersede(old.memory.id, [pendingOld.memory.id], { revisedBy: "robot" as any }), /Invalid revisedBy.*robot/u)
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, logBefore)
  })

  it("supersede rejects already superseded old memories before writing", () => {
    const e = engine()
    const old = e.save({ text: "Old already", status: "approved" })
    const newer = e.save({ text: "New already", status: "approved" })
    const newest = e.save({ text: "Newest already", status: "approved" })
    assert.equal(old.status, "saved"); assert.equal(newer.status, "saved"); assert.equal(newest.status, "saved")
    if (old.status !== "saved" || newer.status !== "saved" || newest.status !== "saved") return

    e.supersede(newer.memory.id, [old.memory.id])
    const logBefore = readJsonl(path.join(dir, "mem.jsonl")).length

    assert.throws(() => e.supersede(newest.memory.id, [old.memory.id]), /Old memory is already superseded/u)
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, logBefore)
  })

  it("supersede dry-run returns proposed records without writing", () => {
    const e = engine()
    const old = e.save({ text: "Old dry", status: "approved" })
    const newer = e.save({ text: "New dry", status: "approved" })
    assert.equal(old.status, "saved"); assert.equal(newer.status, "saved")
    if (old.status !== "saved" || newer.status !== "saved") return
    const logBefore = readJsonl(path.join(dir, "mem.jsonl")).length

    const result = e.supersede(newer.memory.id, [old.memory.id], { reason: "preview", revisedBy: "cli", dryRun: true })

    assert.equal(result.dryRun, true)
    assert.equal(result.successor.revision?.reason, "preview")
    assert.equal(result.superseded[0].revision?.supersededBy, newer.memory.id)
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, logBefore)
    assert.equal(readJsonl(path.join(dir, "emb.jsonl")).length, 0)
  })

  it("supersede warns on cross-scope and cross-category relationships", () => {
    const e = engine()
    const old = e.save({ text: "Global pref", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
    const newer = e.save({ text: "Project successor", status: "approved", category: "project", scopeType: "project", kind: "workflow_rule" })
    assert.equal(old.status, "saved"); assert.equal(newer.status, "saved")
    if (old.status !== "saved" || newer.status !== "saved") return

    const result = e.supersede(newer.memory.id, [old.memory.id], { dryRun: true })

    assert.ok(result.warnings.some((warning) => warning.code === "cross-scope"))
    assert.ok(result.warnings.some((warning) => warning.code === "cross-category"))
  })

  it("replace approved creates successor and marks old memories superseded", () => {
    const e = engine()
    const old = e.save({ text: "Old replacement source", status: "approved", category: "project", kind: "project_fact" })
    assert.equal(old.status, "saved")
    if (old.status !== "saved") return

    const result = e.replace([old.memory.id], { text: "New replacement", status: "approved", kind: "workflow_rule", reason: "refined", revisedBy: "cli" })

    assert.equal(result.successorCreated, true)
    assert.equal(result.successor.text, "New replacement")
    assert.equal(result.successor.status, "approved")
    assert.equal(result.successor.kind, "workflow_rule")
    assert.deepEqual(result.successor.revision?.supersedes, [old.memory.id])
    assert.equal(result.superseded[0].revision?.supersededBy, result.successor.id)
  })

  it("supersede and replace approved write revisions through storage facade batch append", () => {
    const storage = createSingleStoreEngineStorage(path.join(dir, "mem.jsonl"), path.join(dir, "emb.jsonl"))
    const batchSizes: number[] = []
    const originalAppendMemories = storage.appendMemories.bind(storage)
    storage.appendMemories = (records) => {
      batchSizes.push(records.length)
      originalAppendMemories(records)
    }
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "ignored-mem.jsonl"),
      embeddingsPath: path.join(dir, "ignored-emb.jsonl"),
      configPath: path.join(dir, "cfg.json"),
      storage,
    })
    const oldForSupersede = e.save({ text: "Old facade supersede", status: "approved" })
    const successor = e.save({ text: "New facade supersede", status: "approved" })
    const oldForReplace = e.save({ text: "Old facade replace", status: "approved" })
    assert.equal(oldForSupersede.status, "saved")
    assert.equal(successor.status, "saved")
    assert.equal(oldForReplace.status, "saved")
    if (oldForSupersede.status !== "saved" || successor.status !== "saved" || oldForReplace.status !== "saved") return
    batchSizes.length = 0

    e.supersede(successor.memory.id, [oldForSupersede.memory.id])
    e.replace([oldForReplace.memory.id], { text: "New facade replace", status: "approved" })

    assert.deepEqual(batchSizes, [2, 2])
    assert.equal(readJsonl(path.join(dir, "ignored-mem.jsonl")).length, 0)
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, 7)
  })

  it("replace does not auto-copy descriptor metadata from old memory", () => {
    const e = engine()
    const old = e.save({
      text: "Old descriptor replacement source",
      status: "approved",
      category: "project",
      kind: "project_fact",
      descriptor: { description: "Old descriptor should not copy" },
    })
    assert.equal(old.status, "saved")
    if (old.status !== "saved") return

    const result = e.replace([old.memory.id], { text: "New descriptor-free replacement", status: "approved" })

    assert.equal(result.successor.text, "New descriptor-free replacement")
    assert.equal(result.successor.descriptor, undefined)
  })

  it("replace approved supersedes multiple old memories in order", () => {
    const e = engine()
    const oldA = e.save({ text: "First old replacement source", status: "approved", category: "project", kind: "project_fact" })
    const oldB = e.save({ text: "Second old replacement source", status: "approved", category: "project", kind: "project_fact" })
    assert.equal(oldA.status, "saved")
    assert.equal(oldB.status, "saved")
    if (oldA.status !== "saved" || oldB.status !== "saved") return

    const result = e.replace([oldA.memory.id, oldB.memory.id], {
      text: "Merged approved replacement",
      status: "approved",
      kind: "workflow_rule",
      reason: "merged duplicate memories",
      revisedBy: "cli",
    })

    assert.equal(result.successorCreated, true)
    assert.equal(result.successor.text, "Merged approved replacement")
    assert.equal(result.successor.status, "approved")
    assert.deepEqual(result.successor.revision?.supersedes, [oldA.memory.id, oldB.memory.id])
    assert.deepEqual(result.superseded.map((memory) => memory.id), [oldA.memory.id, oldB.memory.id])
    assert.ok(result.superseded.every((memory) => memory.revision?.supersededBy === result.successor.id))

    const folded = e.list({ all: true })
    for (const oldId of [oldA.memory.id, oldB.memory.id]) {
      const memory = folded.find((record) => record.id === oldId)
      assert.ok(memory)
      assert.equal(memory.status, "approved")
      assert.equal(memory.revision?.supersededBy, result.successor.id)
    }
  })

  it("replace pending creates successor intent without mutating old memory", () => {
    const e = engine()
    const old = e.save({ text: "Old pending replace", status: "approved", category: "project", kind: "project_fact" })
    assert.equal(old.status, "saved")
    if (old.status !== "saved") return
    const logBefore = readJsonl(path.join(dir, "mem.jsonl")).length

    const result = e.replace([old.memory.id], { text: "Pending replacement", status: "pending", reason: "draft", revisedBy: "cli" })

    assert.equal(result.successor.status, "pending")
    assert.deepEqual(result.successor.revision?.supersedes, [old.memory.id])
    assert.deepEqual(result.superseded, [])
    assert.equal(e.list({ all: true }).find((m) => m.id === old.memory.id)?.revision, undefined)
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, logBefore + 1)
    assert.equal(readJsonl(path.join(dir, "emb.jsonl")).length, 0)
  })

  it("replace dry-run returns proposed records without writing", () => {
    const e = engine()
    const old = e.save({ text: "Old dry replace", status: "approved" })
    assert.equal(old.status, "saved")
    if (old.status !== "saved") return
    const logBefore = readJsonl(path.join(dir, "mem.jsonl")).length

    const result = e.replace([old.memory.id], { text: "New dry replace", reason: "preview", revisedBy: "cli", dryRun: true })

    assert.equal(result.dryRun, true)
    assert.equal(result.successor.text, "New dry replace")
    assert.deepEqual(result.successor.revision?.supersedes, [old.memory.id])
    assert.equal(result.superseded[0].revision?.supersededBy, result.successor.id)
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, logBefore)
    assert.equal(readJsonl(path.join(dir, "emb.jsonl")).length, 0)
  })

  it("replace validates all inputs before writing", () => {
    const e = engine()
    const old = e.save({ text: "Old replace validation", status: "approved" })
    const pendingOld = e.save({ text: "Pending replace validation", status: "pending" })
    assert.equal(old.status, "saved"); assert.equal(pendingOld.status, "saved")
    if (old.status !== "saved" || pendingOld.status !== "saved") return
    const logBefore = readJsonl(path.join(dir, "mem.jsonl")).length

    assert.throws(() => e.replace([], { text: "No old ids" }), /At least one old memory id is required/u)
    assert.throws(() => e.replace([old.memory.id, old.memory.id], { text: "Duplicate old ids" }), /Old memory ids must be unique/u)
    assert.throws(() => e.replace(["missing-old"], { text: "Missing old" }), /Old memory not found/u)
    assert.throws(() => e.replace([pendingOld.memory.id], { text: "Pending old" }), /Old must be approved/u)
    assert.throws(() => e.replace([old.memory.id], { text: "   " }), /empty/u)
    assert.throws(() => e.replace([old.memory.id], { text: "my key is sk-abc123def456ghi789jkl" }), /secret/u)
    assert.throws(() => e.replace([old.memory.id], { text: "Bad status", status: "rejected" as any }), /Invalid status.*rejected/u)
    assert.throws(() => e.replace([old.memory.id], { text: "Bad actor", revisedBy: "robot" as any }), /Invalid revisedBy.*robot/u)
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, logBefore)
  })

  it("replace rejects already superseded old memories before writing", () => {
    const e = engine()
    const old = e.save({ text: "Old replace already", status: "approved" })
    const newer = e.save({ text: "New replace already", status: "approved" })
    assert.equal(old.status, "saved"); assert.equal(newer.status, "saved")
    if (old.status !== "saved" || newer.status !== "saved") return

    e.supersede(newer.memory.id, [old.memory.id])
    const logBefore = readJsonl(path.join(dir, "mem.jsonl")).length

    assert.throws(() => e.replace([old.memory.id], { text: "Another replace" }), /Old memory is already superseded/u)
    assert.equal(readJsonl(path.join(dir, "mem.jsonl")).length, logBefore)
  })

  it("replace warns on cross-category relationships", () => {
    const e = engine()
    const old = e.save({ text: "Global pref replace", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
    assert.equal(old.status, "saved")
    if (old.status !== "saved") return

    const result = e.replace([old.memory.id], { text: "Project successor replace", category: "project", kind: "workflow_rule", status: "approved", reason: "cross category", revisedBy: "cli" })

    assert.ok(result.warnings.some((warning) => warning.code === "cross-category"))
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

  it("suggest skips delegated subagent task wrapper prompts", () => {
    const e = engine()
    const r = e.suggest(`Task: You are a delegated subagent running from a fork of the parent session. Treat the inherited conversation as reference-only context, not a live thread to continue.

Task:
Implement Task 2 of the Codex SessionStart baseline injection plan.`, "project", "project")

    assert.equal(r.status, "skipped")
    if (r.status === "skipped") assert.match(r.reason, /meta task prompt/u)
    assert.equal(e.reviewPending().length, 0)
  })

  it("suggest skips acceptance finalization prompts", () => {
    const e = engine()
    const r = e.suggest(`Task: ## Acceptance Finalization
You are continuing the same subagent session. Before this run can be accepted, compare the current work to the acceptance contract and the evidence below.`, "project", "project")

    assert.equal(r.status, "skipped")
    if (r.status === "skipped") assert.match(r.reason, /meta task prompt/u)
    assert.equal(e.reviewPending().length, 0)
  })

  it("doctor returns stats and preserves storage path fields", () => {
    const e = engine()
    e.save({ text: "approved text", status: "approved" })
    e.save({ text: "pending text" })
    const d = e.doctor()
    assert.equal(d.approvedMemories, 1)
    assert.equal(d.pendingMemories, 1)
    assert.equal(d.totalMemories, 2)
    assert.equal(d.memoryFile, path.join(dir, "mem.jsonl"))
    assert.equal(d.embeddingFile, path.join(dir, "emb.jsonl"))
  })

  it("accepts correction and procedure memory kinds", () => {
    const e = engine()
    const correction = e.save({ text: "Workflow correction: wait for PR merge before cleanup.", status: "pending", category: "project", kind: "correction" })
    const procedure = e.save({ text: "Procedure: open a PR, wait for merge, then cleanup.", status: "approved", category: "project", kind: "procedure" })

    assert.equal(correction.status, "saved")
    assert.equal(procedure.status, "saved")
    if (correction.status !== "saved" || procedure.status !== "saved") return

    assert.equal(correction.memory.kind, "correction")
    assert.equal(procedure.memory.kind, "procedure")
    assert.equal(e.reviewPending()[0].kind, "correction")
    assert.equal(e.list({ status: "approved" }).find((memory) => memory.id === procedure.memory.id)?.kind, "procedure")
  })

  it("continuityHints reports text-free project scoped hints", () => {
    const e = engine()
    const old = e.save({ text: "PRIVATE OLD WORKFLOW TEXT", status: "approved", category: "project", kind: "workflow_rule" })
    const newer = e.save({ text: "PRIVATE NEW WORKFLOW TEXT", status: "approved", category: "project", kind: "workflow_rule" })
    assert.equal(old.status, "saved")
    assert.equal(newer.status, "saved")
    if (old.status !== "saved" || newer.status !== "saved") return
    e.supersede(newer.memory.id, [old.memory.id], { reason: "newer guidance", revisedBy: "manual" })

    const hints = e.continuityHints()

    assert.equal(hints.supersededVisible.length, 1)
    assert.equal(hints.supersededVisible[0].id, old.memory.id)
    assert.equal(hints.supersededVisible[0].supersededBy, newer.memory.id)
    assert.doesNotMatch(JSON.stringify(hints), /PRIVATE OLD WORKFLOW TEXT|PRIVATE NEW WORKFLOW TEXT/u)
  })

  it("freshnessStatus reports visible approved metadata without memory text", () => {
    const e = engine()
    const projectA = path.join(dir, "project-a")
    const projectB = path.join(dir, "project-b")
    fs.mkdirSync(projectA, { recursive: true })
    fs.mkdirSync(projectB, { recursive: true })
    fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "project-a" }), "utf8")
    fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "project-b" }), "utf8")

    e.refreshScope(projectA)
    const projectApproved = e.save({
      text: "Approved private project freshness text",
      status: "approved",
      kind: "project_checkpoint",
      source: "session-summary",
      provenance: { adapter: "pi", lifecycleEvent: "session_end" },
    })
    const globalApproved = e.save({
      text: "Global approved private preference freshness text",
      category: "preference",
      scopeType: "global",
      status: "approved",
      kind: "preference",
    })
    e.save({ text: "Pending private freshness text", status: "pending" })
    e.refreshScope(projectB)
    e.save({ text: "Other project private freshness text", status: "approved" })
    e.refreshScope(projectA)

    assert.equal(projectApproved.status, "saved")
    assert.equal(globalApproved.status, "saved")
    if (projectApproved.status !== "saved" || globalApproved.status !== "saved") return

    const status = e.freshnessStatus({ since: "2000-01-01T00:00:00.000Z" })
    const serialized = JSON.stringify(status)

    assert.equal(status.projectScope, "project-a")
    assert.equal(status.visibleApprovedCount, 2)
    assert.equal(status.newerApprovedCount, 2)
    assert.equal(status.newerProjectApprovedCount, 1)
    assert.equal(status.newerGlobalApprovedCount, 1)
    assert.equal(status.newerGlobalPreferenceCount, 1)
    assert.deepEqual(status.newerByKind, { project_checkpoint: 1, preference: 1 })
    assert.deepEqual(status.newerBySource, { "session-summary": 1, manual: 1 })
    assert.deepEqual(status.newerByProvenance, { "pi/session_end": 1, none: 1 })
    assert.deepEqual(new Set(status.newestNewerApproved.map((memory) => memory.id)), new Set([projectApproved.memory.id, globalApproved.memory.id]))
    assert.doesNotMatch(serialized, /Approved private project freshness text|Global approved private preference freshness text|Pending private freshness text|Other project private freshness text/u)
  })

  it("doctor includes text-free continuity hints and accepts freshnessSince", () => {
    const e = engine()
    const saved = e.save({
      text: "PRIVATE NEW CHECKPOINT TEXT",
      status: "approved",
      category: "project",
      kind: "project_checkpoint",
    })
    assert.equal(saved.status, "saved")

    const report = e.doctor({ freshnessSince: "2000-01-01T00:00:00.000Z" }) as any

    assert.equal(typeof report.continuityHints.hintCount, "number")
    assert.equal(report.continuityHints.newerApproved.count >= 1, true)
    assert.doesNotMatch(JSON.stringify(report.continuityHints), /PRIVATE NEW CHECKPOINT TEXT/u)
  })

  it("doctor includes privacy-safe freshness and accepts optional freshnessSince", () => {
    const e = engine()
    const projectA = path.join(dir, "doctor-project-a")
    const projectB = path.join(dir, "doctor-project-b")
    fs.mkdirSync(projectA, { recursive: true })
    fs.mkdirSync(projectB, { recursive: true })
    fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "doctor-project-a" }), "utf8")
    fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "doctor-project-b" }), "utf8")

    e.refreshScope(projectA)
    e.save({ text: "Doctor approved private project freshness text", status: "approved", kind: "project_checkpoint" })
    e.save({ text: "Doctor pending private freshness text", status: "pending" })
    e.save({ text: "Doctor global approved private freshness text", category: "preference", scopeType: "global", status: "approved", kind: "preference" })
    e.refreshScope(projectB)
    e.save({ text: "Doctor other project private freshness text", status: "approved" })
    e.refreshScope(projectA)

    const report = e.doctor({ freshnessSince: "2000-01-01T00:00:00.000Z" }) as any
    const serialized = JSON.stringify(report)

    assert.equal(report.freshness.projectScope, "doctor-project-a")
    assert.equal(report.freshness.visibleApprovedCount, 2)
    assert.equal(report.freshness.newerApprovedCount, 2)
    assert.equal(report.freshness.newerProjectApprovedCount, 1)
    assert.equal(report.freshness.newerGlobalApprovedCount, 1)
    assert.doesNotMatch(serialized, /Doctor approved private project freshness text|Doctor pending private freshness text|Doctor global approved private freshness text|Doctor other project private freshness text/u)
  })

  it("returns operating agreements through engine APIs", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "agreement-engine-project" }), "utf8")
    const e = engine()
    e.refreshScope(project)

    e.save({
      text: "Project workflow loop: write a spec, get approval, implement a slice.",
      status: "approved",
      category: "project",
      scopeType: "project",
      kind: "project_fact",
    })
    e.save({
      text: "User prefers concise answers.",
      status: "approved",
      category: "preference",
      scopeType: "global",
      kind: "preference",
    })

    const agreements = e.operatingAgreements()
    const summary = e.operatingAgreementSummary()

    assert.equal(agreements.projectScope, "agreement-engine-project")
    assert.equal(agreements.primary.length, 1)
    assert.equal(agreements.primary[0].memory.text, "Project workflow loop: write a spec, get approval, implement a slice.")
    assert.equal(summary.primaryCount, 1)
    assert.equal(summary.primary[0].id, agreements.primary[0].memory.id)
    assert.ok(!JSON.stringify(summary).includes("Project workflow loop: write a spec"))
  })

  it("includes text-free operating agreement summary in doctor", () => {
    const e = engine()
    e.save({
      text: "PRIVATE DOCTOR AGREEMENT TEXT Project workflow loop: review before implementation.",
      status: "approved",
      category: "project",
      scopeType: "global",
      kind: "workflow_rule",
    })

    const report = e.doctor()
    const serialized = JSON.stringify(report)
    const operatingAgreements = report.operatingAgreements as any

    assert.equal(operatingAgreements.primaryCount, 1)
    assert.equal(operatingAgreements.primary[0].matchReason, "explicit-kind")
    assert.doesNotMatch(serialized, /PRIVATE DOCTOR AGREEMENT TEXT/u)
  })

  it("freshnessStatus and doctor reject invalid since timestamps", () => {
    const e = engine()

    assert.throws(
      () => e.freshnessStatus({ since: "not-a-date" }),
      /Invalid since timestamp/u,
    )
    assert.throws(
      () => e.doctor({ freshnessSince: "not-a-date" }),
      /Invalid since timestamp/u,
    )
  })

  it("doctor reports skipped invalid memory JSONL rows without memory text", () => {
    const memoryPath = path.join(dir, "mem.jsonl")
    fs.writeFileSync(memoryPath, [
      JSON.stringify({
        id: "ok1",
        status: "approved",
        text: "Do not expose this memory text",
        category: "project",
        scope: { type: "global" },
        source: "manual",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      "not json",
      JSON.stringify({ id: "bad1", status: "approved", text: "Also do not expose" }),
    ].join("\n") + "\n", "utf8")
    const e = engine()

    const d = e.doctor()
    const serialized = JSON.stringify(d)

    assert.equal(d.memoryFileRows, 3)
    assert.equal(d.memoryFileValidRows, 1)
    assert.equal(d.memoryFileSkippedRows, 2)
    assert.equal(d.memoryFileMalformedRows, 1)
    assert.equal(d.memoryFileInvalidRows, 1)
    assert.deepEqual(d.memoryFileWarnings, ["Memory file has 2 skipped JSONL row(s): 1 malformed JSON, 1 schema-invalid."])
    assert.doesNotMatch(serialized, /Do not expose this memory text|Also do not expose/u)
  })

  it("loads default preference context budgets", () => {
    const e = engine()

    assert.deepEqual(e.getContextPolicy()?.preferenceMaxItems, { sessionStart: 2, prompt: 2 })
    assert.deepEqual(e.getContextPolicy()?.preferenceMaxChars, { sessionStart: 600, prompt: 900 })
  })

  it("rejects invalid preference context budget config", () => {
    const invalidPolicies = [
      {
        policy: { preferenceMaxItems: "two" },
        message: /memory\.contextPolicy\.preferenceMaxItems must be object/u,
      },
      {
        policy: { preferenceMaxChars: "many" },
        message: /memory\.contextPolicy\.preferenceMaxChars must be object/u,
      },
      {
        policy: { preferenceMaxItems: { sessionStart: -1 } },
        message: /memory\.contextPolicy\.preferenceMaxItems\.sessionStart must be a non-negative integer/u,
      },
      {
        policy: { preferenceMaxItems: { prompt: 1.5 } },
        message: /memory\.contextPolicy\.preferenceMaxItems\.prompt must be a non-negative integer/u,
      },
      {
        policy: { preferenceMaxChars: { sessionStart: -1 } },
        message: /memory\.contextPolicy\.preferenceMaxChars\.sessionStart must be a non-negative integer/u,
      },
      {
        policy: { preferenceMaxChars: { prompt: 1.5 } },
        message: /memory\.contextPolicy\.preferenceMaxChars\.prompt must be a non-negative integer/u,
      },
    ]

    for (const [index, { policy, message }] of invalidPolicies.entries()) {
      const configPath = path.join(dir, `cfg-invalid-preference-budget-${index}.json`)
      fs.writeFileSync(configPath, JSON.stringify({ memory: { contextPolicy: policy } }), "utf8")

      assert.throws(
        () => new MemoryEngine({
          memoryPath: path.join(dir, `mem-invalid-preference-budget-${index}.jsonl`),
          embeddingsPath: path.join(dir, `emb-invalid-preference-budget-${index}.jsonl`),
          configPath,
        }),
        message,
      )
    }
  })

  it("doctor includes text-free preference diagnostics for visible scope", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "pref-diagnostics-project" }))
    const e = engine()
    e.save({ text: "GLOBAL_SECRET_PREF_BODY prefer concise answers", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
    e.refreshScope(project)
    e.save({ text: "PROJECT_SECRET_PREF_BODY include verification output", status: "approved", category: "preference", scopeType: "project", kind: "preference" })
    e.save({ text: "Workflow rule should count as preference-like", status: "approved", category: "project", scopeType: "project", kind: "workflow_rule" })
    e.save({ text: "Pending preference should not count", status: "pending", category: "preference", scopeType: "global", kind: "preference" })

    const report = e.doctor() as any
    const diagnostics = report.preferenceDiagnostics
    const serialized = JSON.stringify(report)

    assert.equal(diagnostics.projectScope, "pref-diagnostics-project")
    assert.equal(diagnostics.visiblePreferenceCount, 3)
    assert.equal(diagnostics.currentProjectPreferenceCount, 2)
    assert.equal(diagnostics.globalPreferenceCount, 1)
    assert.equal(diagnostics.workflowRulePreferenceCount, 1)
    assert.equal(diagnostics.sessionStart.maxPreferenceItems, 2)
    assert.equal(diagnostics.sessionStart.maxPreferenceChars, 600)
    assert.equal(typeof diagnostics.sessionStart.selectedPreferenceCount, "number")
    assert.equal(typeof diagnostics.sessionStart.omittedPreferenceCount, "number")
    assert.doesNotMatch(serialized, /GLOBAL_SECRET_PREF_BODY|PROJECT_SECRET_PREF_BODY|Pending preference should not count/u)
  })

  it("doctor preference diagnostics apply session-start preference caps and dedupe", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "pref-diagnostics-dedupe" }))
    fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({
      memory: {
        contextPolicy: {
          mode: "selective",
          maxItems: { sessionStart: 4, prompt: 6 },
          maxChars: { sessionStart: 1000, prompt: 3000 },
          preferenceMaxItems: { sessionStart: 2, prompt: 2 },
          preferenceMaxChars: { sessionStart: 1000, prompt: 900 },
        },
      },
    }), "utf8")
    const e = engine()
    e.save({ text: "Prefer blue review badges", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
    e.save({ text: "Prefer concise answers", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
    e.refreshScope(project)
    e.save({ text: "Prefer blue review badges", status: "approved", category: "preference", scopeType: "project", kind: "preference" })

    const diagnostics = (e.doctor() as any).preferenceDiagnostics

    assert.equal(diagnostics.visiblePreferenceCount, 3)
    assert.equal(diagnostics.sessionStart.selectedPreferenceCount, 2)
    assert.equal(diagnostics.sessionStart.omittedPreferenceCount, 1)
    assert.equal(diagnostics.sessionStart.selectedCurrentProjectPreferenceCount, 1)
    assert.equal(diagnostics.sessionStart.selectedGlobalPreferenceCount, 1)
  })

  it("doctor preference diagnostics respect preference char cap and disabled body modes", () => {
    fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({
      memory: {
        contextPolicy: {
          mode: "policy-only",
          maxItems: { sessionStart: 4, prompt: 6 },
          maxChars: { sessionStart: 1000, prompt: 3000 },
          preferenceMaxItems: { sessionStart: 2, prompt: 2 },
          preferenceMaxChars: { sessionStart: 1, prompt: 900 },
        },
      },
    }), "utf8")
    const policyOnlyEngine = engine()
    policyOnlyEngine.save({ text: "Preference too long for one char cap", status: "approved", category: "preference", scopeType: "global", kind: "preference" })

    let diagnostics = (policyOnlyEngine.doctor() as any).preferenceDiagnostics
    assert.equal(diagnostics.visiblePreferenceCount, 1)
    assert.equal(diagnostics.sessionStart.selectedPreferenceCount, 0)
    assert.equal(diagnostics.sessionStart.omittedPreferenceCount, 1)

    const offDir = tempDir()
    fs.writeFileSync(path.join(offDir, "cfg.json"), JSON.stringify({ memory: { contextPolicy: { mode: "off" } } }), "utf8")
    const offEngine = new MemoryEngine({
      memoryPath: path.join(offDir, "mem.jsonl"),
      embeddingsPath: path.join(offDir, "emb.jsonl"),
      configPath: path.join(offDir, "cfg.json"),
    })
    offEngine.save({ text: "Another global preference", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
    diagnostics = (offEngine.doctor() as any).preferenceDiagnostics
    assert.equal(diagnostics.visiblePreferenceCount, 1)
    assert.equal(diagnostics.sessionStart.selectedPreferenceCount, 0)
    assert.equal(diagnostics.sessionStart.omittedPreferenceCount, 1)
  })

  it("defaults handoff mode to manual in doctor diagnostics", () => {
    const e = engine()
    const report = e.doctor()

    assert.equal(e.getHandoffMode(), "manual")
    assert.equal(report.handoffMode, "manual")
    assert.equal(report.handoffModeBehaviorActive, true)
    assert.equal(report.handoffModeNote, "Current inspection-first behavior is active.")
  })

  it("accepts configured handoff modes and reports canonical notes", () => {
    const cases = [
      { mode: "manual", active: true, note: "Current inspection-first behavior is active." },
      { mode: "review", active: true, note: "Review mode is active for read-only handoff proposals; approve pending memories before relying on them as handoff state." },
      { mode: "automatic", active: true, note: "Automatic mode is active for approved, budgeted SessionStart handoff selection; context policy still controls injection." },
    ] as const

    for (const { mode, active, note } of cases) {
      const configPath = path.join(dir, `cfg-handoff-${mode}.json`)
      fs.writeFileSync(configPath, JSON.stringify({ memory: { handoffMode: mode } }), "utf8")
      const e = new MemoryEngine({
        memoryPath: path.join(dir, `mem-handoff-${mode}.jsonl`),
        embeddingsPath: path.join(dir, `emb-handoff-${mode}.jsonl`),
        configPath,
      })
      const report = e.doctor()

      assert.equal(e.getHandoffMode(), mode)
      assert.equal(report.handoffMode, mode)
      assert.equal(report.handoffModeBehaviorActive, active)
      assert.equal(report.handoffModeNote, note)
    }
  })

  it("rejects invalid handoff mode config", () => {
    const cases = ["enabled", null]

    for (const value of cases) {
      const configPath = path.join(dir, `cfg-invalid-handoff-${String(value)}.json`)
      fs.writeFileSync(configPath, JSON.stringify({ memory: { handoffMode: value } }), "utf8")

      assert.throws(
        () => new MemoryEngine({
          memoryPath: path.join(dir, `mem-invalid-handoff-${String(value)}.jsonl`),
          embeddingsPath: path.join(dir, `emb-invalid-handoff-${String(value)}.jsonl`),
          configPath,
        }),
        /memory\.handoffMode must be manual, review, or automatic/u,
      )
    }
  })

  it("changing handoff mode only changes handoff diagnostics", () => {
    const configPath = path.join(dir, "cfg-handoff-diff.json")
    const memoryPath = path.join(dir, "mem-handoff-diff.jsonl")
    const embeddingsPath = path.join(dir, "emb-handoff-diff.jsonl")

    function reportFor(mode: "manual" | "review" | "automatic") {
      fs.writeFileSync(configPath, JSON.stringify({ memory: { handoffMode: mode } }), "utf8")
      const e = new MemoryEngine({ memoryPath, embeddingsPath, configPath })
      if (!fs.existsSync(memoryPath) || fs.readFileSync(memoryPath, "utf8").trim() === "") {
        e.save({ text: "Do not leak handoff diff memory text", status: "approved", category: "project", scopeType: "global" })
      }
      const report = e.doctor() as Record<string, unknown>
      const normalized = structuredClone(report) as Record<string, unknown>
      delete normalized.handoffMode
      delete normalized.handoffModeBehaviorActive
      delete normalized.handoffModeNote
      delete normalized.automaticHandoffDiagnostics
      const freshness = normalized.freshness as { advisory?: { referenceNow?: string } } | undefined
      if (freshness?.advisory) freshness.advisory.referenceNow = "<reference-now>"
      return { report, normalized }
    }

    const manual = reportFor("manual")
    const review = reportFor("review")
    const automatic = reportFor("automatic")

    assert.equal(review.report.handoffModeBehaviorActive, true)
    assert.equal(automatic.report.handoffModeBehaviorActive, true)
    assert.deepEqual(review.normalized, manual.normalized)
    assert.deepEqual(automatic.normalized, manual.normalized)
    assert.doesNotMatch(JSON.stringify(review.report), /handoffProposal/u)
    assert.doesNotMatch(JSON.stringify(automatic.report), /handoffProposal/u)
    assert.doesNotMatch(JSON.stringify(review.report), /Do not leak handoff diff memory text/u)
    assert.doesNotMatch(JSON.stringify(automatic.report), /Do not leak handoff diff memory text/u)
  })

  it("doctor reports automatic handoff diagnostics as static text-free eligibility", () => {
    const project = path.join(dir, "automatic-doctor-project")
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "automatic-doctor-project" }), "utf8")
    const configPath = path.join(dir, "cfg-automatic-doctor.json")
    fs.writeFileSync(configPath, JSON.stringify({ memory: { handoffMode: "automatic", contextPolicy: { mode: "selective" } } }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-automatic-doctor.jsonl"),
      embeddingsPath: path.join(dir, "emb-automatic-doctor.jsonl"),
      configPath,
    })
    e.refreshScope(project)
    e.save({ text: "PRIVATE DOCTOR HANDOFF BODY", status: "approved", category: "project", scopeType: "project", source: "session-summary", kind: "session_summary" })

    const report = e.doctor() as any

    assert.equal(report.handoffModeBehaviorActive, true)
    assert.deepEqual(report.automaticHandoffDiagnostics.mode, "active")
    assert.equal(report.automaticHandoffDiagnostics.policyMode, "selective")
    assert.equal(report.automaticHandoffDiagnostics.eligibleCount, 1)
    assert.equal("selectedCount" in report.automaticHandoffDiagnostics, false)
    assert.equal("omittedCount" in report.automaticHandoffDiagnostics, false)
    assert.doesNotMatch(JSON.stringify(report.automaticHandoffDiagnostics), /PRIVATE DOCTOR HANDOFF BODY/u)
  })

  it("review handoff proposal is read-only when reading continuity", () => {
    const project = path.join(dir, "review-project")
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "engine-review-proposal" }), "utf8")
    fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({ memory: { handoffMode: "review" } }), "utf8")
    const e = engine()
    e.refreshScope(project)
    e.save({ text: "## Session Summary\nNext action: inspect review proposal.", status: "pending", category: "project", scopeType: "project", source: "session-summary", kind: "session_summary" })

    const before = JSON.stringify(e.list({ all: true }).map((memory) => ({ id: memory.id, status: memory.status, text: memory.text })))
    const continuity = e.continuity({ caller: "core" })
    const after = JSON.stringify(e.list({ all: true }).map((memory) => ({ id: memory.id, status: memory.status, text: memory.text })))

    assert.equal(continuity.handoffProposal?.pendingCount, 1)
    assert.equal(continuity.handoffProposal?.items.length, 1)
    assert.equal(before, after)
  })

  it("resolves and records continuity baseline markers without memory text", () => {
    const project = tempDir()
    const memPath = path.join(dir, "baseline-memory.jsonl")
    const e = new MemoryEngine({ memoryPath: memPath, embeddingsPath: path.join(dir, "baseline-emb.jsonl"), configPath: path.join(dir, "baseline-cfg.json") })

    e.refreshScope(project)
    const projectKey = fs.realpathSync(project)
    assert.deepEqual(e.resolveContinuityBaseline("not-a-date"), { source: "none" })
    assert.deepEqual(e.resolveContinuityBaseline("2026-06-22T00:00:00.000Z"), { source: "payload", since: "2026-06-22T00:00:00.000Z" })

    e.recordContinuityBaseline("2026-06-22T01:00:00.000Z")
    const markerPath = path.join(path.dirname(memPath), "continuity-baselines.json")
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"))
    assert.deepEqual(Object.keys(marker.projects), [projectKey])
    assert.deepEqual(Object.keys(marker.projects[projectKey]).sort(), ["lastSeenAt", "projectScope", "updatedAt"])
    assert.equal(marker.projects[projectKey].projectScope, projectKey)
    assert.equal(marker.projects[projectKey].lastSeenAt, "2026-06-22T01:00:00.000Z")
    assert.doesNotMatch(JSON.stringify(marker), /memory text|prompt|transcript|tool output|branch|model/u)

    assert.deepEqual(e.resolveContinuityBaseline("2026-06-22T02:00:00.000Z"), { source: "marker", since: "2026-06-22T01:00:00.000Z" })
  })

  it("continuity baseline diagnostics handle corrupt markers without leaking memory text", () => {
    const project = tempDir()
    const memPath = path.join(dir, "baseline-corrupt-memory.jsonl")
    const e = new MemoryEngine({ memoryPath: memPath, embeddingsPath: path.join(dir, "baseline-corrupt-emb.jsonl"), configPath: path.join(dir, "baseline-corrupt-cfg.json") })
    e.refreshScope(project)
    const projectKey = fs.realpathSync(project)
    e.save({ text: "PRIVATE BASELINE MEMORY TEXT", status: "approved", category: "project", scopeType: "project" })
    fs.writeFileSync(path.join(path.dirname(memPath), "continuity-baselines.json"), "{not-json", "utf8")

    assert.deepEqual(e.resolveContinuityBaseline("also-invalid"), { source: "none" })
    const report = e.doctor()
    const baseline = report.continuityBaseline as any
    assert.equal(baseline.projectScope, projectKey)
    assert.equal(baseline.source, "none")
    assert.equal(baseline.readable, false)
    assert.match(baseline.warning, /unreadable/u)
    assert.doesNotMatch(JSON.stringify(baseline), /PRIVATE BASELINE MEMORY TEXT/u)
  })

  it("doctor reports context policy config without memory text", () => {
    fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({
      memory: {
        contextPolicy: {
          mode: "policy-only",
          maxItems: { sessionStart: 2, prompt: 3 },
          maxChars: { sessionStart: 400, prompt: 900 },
          includePending: false,
          fallbackToSearch: true,
        },
      },
    }), "utf8")
    const e = engine()
    e.save({ text: "Do not leak this memory text", status: "approved" })

    const report = e.doctor()
    const serialized = JSON.stringify(report)

    assert.equal(report.contextPolicyMode, "policy-only")
    assert.equal(report.contextPolicyPromptMaxItems, 3)
    assert.equal(report.contextPolicySessionStartMaxItems, 2)
    assert.equal(report.contextPolicyPromptMaxChars, 900)
    assert.equal(report.contextPolicySessionStartMaxChars, 400)
    assert.equal(report.contextPolicyIncludePending, false)
    assert.equal(report.contextPolicyFallbackToSearch, true)
    assert.doesNotMatch(serialized, /Do not leak this memory text/u)
  })

  it("doctor includes integration diagnostics from injected paths", () => {
    const integrationRoot = path.join(dir, "integration-doctor")
    const claudeDesktopConfig = path.join(integrationRoot, "Claude", "claude_desktop_config.json")
    fs.mkdirSync(path.dirname(claudeDesktopConfig), { recursive: true })
    fs.writeFileSync(claudeDesktopConfig, JSON.stringify({ mcpServers: { "memory-lane": { command: "node", args: ["server.js"] } } }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-integration.jsonl"),
      embeddingsPath: path.join(dir, "emb-integration.jsonl"),
      configPath: path.join(dir, "cfg-integration.json"),
      integrationPaths: { claudeDesktopConfig },
    })

    const report = e.doctor() as any

    assert.equal(report.integrations.claudeDesktopMcp.exists, true)
    assert.equal(report.integrations.claudeDesktopMcp.configured, true)
    assert.equal(report.integrations.summary.mcpExplicitToolsOnly, true)
  })

  it("doctor integration diagnostics do not create missing config folders", () => {
    const integrationRoot = path.join(dir, "missing-integration-root")
    const claudeDesktopConfig = path.join(integrationRoot, "Claude", "claude_desktop_config.json")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-integration-missing.jsonl"),
      embeddingsPath: path.join(dir, "emb-integration-missing.jsonl"),
      configPath: path.join(dir, "cfg-integration-missing.json"),
      integrationPaths: { claudeDesktopConfig },
    })

    const report = e.doctor() as any

    assert.equal(report.integrations.claudeDesktopMcp.exists, false)
    assert.equal(fs.existsSync(integrationRoot), false)
  })

  it("doctor reports missing hook debug log without creating it", () => {
    const hookDebugLogPath = path.join(dir, "missing-hook-root", ".memory-lane", "hooks-log.jsonl")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-hook-missing.jsonl"),
      embeddingsPath: path.join(dir, "emb-hook-missing.jsonl"),
      configPath: path.join(dir, "cfg-hook-missing.json"),
      hookDebugLogPath,
    })

    const report = e.doctor()

    assert.equal(report.hookDebugEnabledInCurrentEnv, false)
    assert.equal(report.hookDebugLogPath, hookDebugLogPath)
    assert.equal(report.hookDebugLogExists, false)
    assert.equal(report.hookDebugLogSizeBytes, 0)
    assert.equal(report.hookDebugLogLastModified, null)
    assert.deepEqual(report.hookDebugWarnings, [])
    assert.equal(fs.existsSync(path.dirname(hookDebugLogPath)), false)
    assert.equal(fs.existsSync(hookDebugLogPath), false)
  })

  it("doctor reports existing hook debug log metadata", () => {
    const hookDebugLogPath = path.join(dir, "existing-hooks", "hooks-log.jsonl")
    fs.mkdirSync(path.dirname(hookDebugLogPath), { recursive: true })
    fs.writeFileSync(hookDebugLogPath, JSON.stringify({ status: "ok" }) + "\n", "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-hook-existing.jsonl"),
      embeddingsPath: path.join(dir, "emb-hook-existing.jsonl"),
      configPath: path.join(dir, "cfg-hook-existing.json"),
      hookDebugLogPath,
    })

    const report = e.doctor()

    assert.equal(report.hookDebugLogPath, hookDebugLogPath)
    assert.equal(report.hookDebugLogExists, true)
    assert.equal(typeof report.hookDebugLogSizeBytes, "number")
    assert.ok((report.hookDebugLogSizeBytes as number) > 0)
    assert.equal(typeof report.hookDebugLogLastModified, "string")
    assert.ok(!Number.isNaN(Date.parse(report.hookDebugLogLastModified as string)))
    assert.deepEqual(report.hookDebugWarnings, [])
  })

  it("doctor reports hook debug enabled in the current env", () => {
    const hookDebugLogPath = path.join(dir, "env-hooks", "hooks-log.jsonl")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-hook-env.jsonl"),
      embeddingsPath: path.join(dir, "emb-hook-env.jsonl"),
      configPath: path.join(dir, "cfg-hook-env.json"),
      hookDebugLogPath,
      env: { MEMORY_LANE_HOOK_DEBUG: "1" },
    })

    const report = e.doctor()

    assert.equal(report.hookDebugEnabledInCurrentEnv, true)
    assert.equal(report.hookDebugLogPath, hookDebugLogPath)
  })

  it("doctor warns when hook debug log path is a directory", () => {
    const hookDebugLogPath = path.join(dir, "directory-hooks", "hooks-log.jsonl")
    fs.mkdirSync(hookDebugLogPath, { recursive: true })
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-hook-directory.jsonl"),
      embeddingsPath: path.join(dir, "emb-hook-directory.jsonl"),
      configPath: path.join(dir, "cfg-hook-directory.json"),
      hookDebugLogPath,
    })

    const report = e.doctor()

    assert.equal(report.hookDebugLogExists, true)
    assert.equal(report.hookDebugLogSizeBytes, 0)
    assert.equal(report.hookDebugLogLastModified, null)
    assert.match((report.hookDebugWarnings as string[]).join("\n"), /Hook debug log path is not a file/)
    assert.match((report.hookDebugWarnings as string[]).join("\n"), new RegExp(hookDebugLogPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
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

describe("operating agreement selection", () => {
  function record(overrides: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
    return {
      id: overrides.id,
      text: overrides.text,
      status: overrides.status ?? "approved",
      category: overrides.category ?? "project",
      scope: overrides.scope ?? { type: "project", key: "project-a" },
      source: overrides.source ?? "manual",
      kind: overrides.kind,
      createdAt: overrides.createdAt ?? "2026-06-18T00:00:00.000Z",
      updatedAt: overrides.updatedAt ?? "2026-06-18T00:00:00.000Z",
      provenance: overrides.provenance,
      project: overrides.project,
    }
  }

  it("selects explicit workflow_rule memories as primary operating agreements", () => {
    const result = selectOperatingAgreements([
      record({
        id: "rule-1",
        kind: "workflow_rule",
        text: "Project loop: spec review before implementation.",
        updatedAt: "2026-06-18T10:00:00.000Z",
      }),
    ], { projectScopeKey: "project-a" })

    assert.equal(result.primary.length, 1)
    assert.equal(result.primary[0].memory.id, "rule-1")
    assert.equal(result.primary[0].workflowArea, "project-loop")
    assert.equal(result.primary[0].matchReason, "explicit-kind")
    assert.equal(result.primary[0].recommendedKind, undefined)
    assert.equal(result.relatedCandidates.length, 0)
  })

  it("selects heuristic preference and project_fact candidates and recommends workflow_rule", () => {
    const result = selectOperatingAgreements([
      record({
        id: "loop-pref",
        category: "preference",
        kind: "preference",
        scope: { type: "global" },
        text: "Global working preference: use the project loop with review gates before implementation.",
      }),
      record({
        id: "plain-pref",
        category: "preference",
        kind: "preference",
        scope: { type: "global" },
        text: "User prefers concise answers.",
      }),
      record({
        id: "project-pr",
        kind: "project_fact",
        text: "For PR process, use feature branches and wait for merge approval.",
      }),
    ], { projectScopeKey: "project-a" })

    assert.deepEqual(result.primary.map((item) => item.memory.id).sort(), ["loop-pref", "project-pr"])
    assert.ok(result.primary.every((item) => item.matchReason === "heuristic"))
    assert.ok(result.primary.every((item) => item.recommendedKind === "workflow_rule"))
    assert.ok(!result.primary.some((item) => item.memory.id === "plain-pref"))
    assert.ok(!result.relatedCandidates.some((item) => item.memory.id === "plain-pref"))
  })

  it("selects workflow-like correction and procedure candidates heuristically", () => {
    const result = selectOperatingAgreements([
      record({ id: "correction-pr", text: "Workflow correction: follow the PR-protected workflow before cleanup.", kind: "correction" }),
      record({ id: "procedure-review", text: "Procedure: use the review gate and get approval before implementation.", kind: "procedure" }),
      record({ id: "generic-correction", text: "Correction: the package name was wrong.", kind: "correction" }),
    ], { projectScopeKey: "project-a" })

    assert.deepEqual(result.primary.map((item) => item.memory.id).sort(), ["correction-pr", "procedure-review"])
    assert.ok(result.primary.every((item) => item.matchReason === "heuristic"))
    assert.ok(result.primary.every((item) => item.recommendedKind === "workflow_rule"))
    assert.ok(!result.primary.some((item) => item.memory.id === "generic-correction"))
  })

  it("keeps explicit workflow_rule preferred over correction candidates", () => {
    const result = selectOperatingAgreements([
      record({ id: "correction-pr", text: "Workflow correction: follow the PR-protected workflow before cleanup.", kind: "correction", updatedAt: "2026-06-18T12:00:00.000Z" }),
      record({ id: "explicit-pr", text: "PR process: open a pull request and wait for merge before cleanup.", kind: "workflow_rule", updatedAt: "2026-06-18T10:00:00.000Z" }),
    ], { projectScopeKey: "project-a" })

    assert.equal(result.primary[0].memory.id, "explicit-pr")
    assert.equal(result.primary[0].matchReason, "explicit-kind")
    assert.deepEqual(result.relatedCandidates.map((item) => item.memory.id), ["correction-pr"])
  })

  it("prefers explicit kind, then project scope, then recency for each area", () => {
    const result = selectOperatingAgreements([
      record({
        id: "new-global-loop",
        category: "preference",
        kind: "preference",
        scope: { type: "global" },
        text: "Global workflow loop: plan, review, implement.",
        updatedAt: "2026-06-18T12:00:00.000Z",
      }),
      record({
        id: "old-project-loop",
        kind: "project_fact",
        text: "Project collaboration workflow loop: roadmap, plan, review, implement.",
        updatedAt: "2026-06-18T11:00:00.000Z",
      }),
      record({
        id: "explicit-global-loop",
        kind: "workflow_rule",
        scope: { type: "global" },
        category: "preference",
        text: "Workflow rule: use review-gated loop.",
        updatedAt: "2026-06-18T09:00:00.000Z",
      }),
    ], { projectScopeKey: "project-a" })

    assert.equal(result.primary.length, 1)
    assert.equal(result.primary[0].memory.id, "explicit-global-loop")
    assert.deepEqual(result.relatedCandidates.map((item) => item.memory.id), ["old-project-loop", "new-global-loop"])
  })

  it("respects project plus global scope by default and all scope when requested", () => {
    const memories = [
      record({ id: "project-a-loop", text: "Project workflow loop for A.", scope: { type: "project", key: "project-a" }, kind: "project_fact" }),
      record({ id: "project-b-loop", text: "Project workflow loop for B.", scope: { type: "project", key: "project-b" }, kind: "project_fact" }),
      record({ id: "global-loop", text: "Global workflow loop.", scope: { type: "global" }, category: "preference", kind: "preference" }),
    ]

    const scoped = selectOperatingAgreements(memories, { projectScopeKey: "project-a" })
    const all = selectOperatingAgreements(memories, { projectScopeKey: "project-a", all: true })

    assert.ok(scoped.primary.concat(scoped.relatedCandidates).some((item) => item.memory.id === "project-a-loop"))
    assert.ok(scoped.primary.concat(scoped.relatedCandidates).some((item) => item.memory.id === "global-loop"))
    assert.ok(!scoped.primary.concat(scoped.relatedCandidates).some((item) => item.memory.id === "project-b-loop"))
    assert.ok(all.primary.concat(all.relatedCandidates).some((item) => item.memory.id === "project-b-loop"))
  })

  it("filters by area, applies limits, and reports omitted counts", () => {
    const result = selectOperatingAgreements([
      record({ id: "loop-1", text: "Project workflow loop: plan first.", kind: "project_fact", updatedAt: "2026-06-18T12:00:00.000Z" }),
      record({ id: "loop-2", text: "Project workflow loop: older rule.", kind: "project_fact", updatedAt: "2026-06-18T11:00:00.000Z" }),
      record({ id: "review-1", text: "Review gate: get approval before merge.", kind: "project_fact" }),
    ], { projectScopeKey: "project-a", area: "project-loop", limit: 1, relatedLimit: 0 })

    assert.deepEqual(result.primary.map((item) => item.memory.id), ["loop-1"])
    assert.deepEqual(result.relatedCandidates, [])
    assert.equal(result.omittedPrimaryCount, 0)
    assert.equal(result.omittedRelatedCandidateCount, 1)
    assert.deepEqual(result.workflowAreas, ["project-loop"])
  })

  it("keeps distinct workflow-area candidates beyond the primary limit visible as related", () => {
    const result = selectOperatingAgreements([
      record({ id: "area-1-project-loop", text: "Project loop: plan first.", kind: "workflow_rule", updatedAt: "2026-06-18T06:00:00.000Z" }),
      record({ id: "area-2-review-gate", text: "Code review gate: get approval before merge.", kind: "workflow_rule", updatedAt: "2026-06-18T05:00:00.000Z" }),
      record({ id: "area-3-pr-process", text: "Pull request process: use feature branches.", kind: "workflow_rule", updatedAt: "2026-06-18T04:00:00.000Z" }),
      record({ id: "area-4-release-process", text: "Release process: tag versions before publishing.", kind: "workflow_rule", updatedAt: "2026-06-18T03:00:00.000Z" }),
      record({ id: "area-5-tooling-preference", text: "Package manager preference: use pnpm.", kind: "workflow_rule", updatedAt: "2026-06-18T02:00:00.000Z" }),
      record({ id: "area-6-other", text: "Keep incident handoff checklist updated.", kind: "workflow_rule", updatedAt: "2026-06-18T01:00:00.000Z" }),
    ], { projectScopeKey: "project-a", limit: 3 })

    assert.deepEqual(result.primary.map((item) => item.memory.id), [
      "area-1-project-loop",
      "area-2-review-gate",
      "area-3-pr-process",
    ])
    assert.deepEqual(result.relatedCandidates.map((item) => item.memory.id), [
      "area-4-release-process",
      "area-5-tooling-preference",
      "area-6-other",
    ])
    assert.deepEqual(result.primary.map((item) => item.workflowArea), ["project-loop", "review-gate", "pr-process"])
    assert.deepEqual(result.relatedCandidates.map((item) => item.workflowArea), ["release-process", "tooling-preference", "other"])
    assert.equal(result.omittedPrimaryCount, 0)
    assert.equal(result.omittedRelatedCandidateCount, 0)
  })

  it("builds a text-free operating agreement summary", () => {
    const result = summarizeOperatingAgreements(selectOperatingAgreements([
      record({ id: "private-loop", text: "PRIVATE AGREEMENT TEXT workflow loop", kind: "project_fact" }),
    ], { projectScopeKey: "project-a" }))
    const serialized = JSON.stringify(result)

    assert.equal(result.primaryCount, 1)
    assert.equal(result.primary[0].id, "private-loop")
    assert.equal(result.primary[0].workflowArea, "project-loop")
    assert.ok(!serialized.includes("PRIVATE AGREEMENT TEXT"))
  })

  it("gets memories by exact id with scoped defaults and all-status escape hatch", () => {
    const projectA = tempDir()
    const projectB = tempDir()
    fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "get-project-a" }))
    fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "get-project-b" }))

    const e = new MemoryEngine({
      memoryPath: path.join(tempDir(), "mem.jsonl"),
      embeddingsPath: path.join(tempDir(), "emb.jsonl"),
      configPath: path.join(tempDir(), "cfg.json"),
    })
    e.refreshScope(projectA)
    const global = e.save({ text: "Global exact lookup", status: "approved", scopeType: "global" })
    const project = e.save({ text: "Project A exact lookup", status: "pending", scopeType: "project", category: "project" })
    e.refreshScope(projectB)
    const crossProject = e.save({ text: "Project B hidden exact lookup", status: "approved", scopeType: "project", category: "project" })
    e.delete(global.status === "saved" ? global.memory.id : "missing")

    if (global.status !== "saved" || project.status !== "saved" || crossProject.status !== "saved") throw new Error("expected saved")
    e.refreshScope(projectA)

    assert.equal(e.getById(project.memory.id)?.text, "Project A exact lookup")
    assert.equal(e.getById(crossProject.memory.id), undefined)
    assert.equal(e.getById(global.memory.id), undefined)
    assert.equal(e.getById(global.memory.id, { all: true })?.status, "deleted")
    assert.equal(e.getById(crossProject.memory.id, { all: true })?.text, "Project B hidden exact lookup")
  })

  it("rescopes active memories with same id and normalized project metadata", () => {
    const projectA = tempDir()
    const projectB = tempDir()
    fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "rescope-project-a" }))
    fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "rescope-project-b" }))

    const e = new MemoryEngine({
      memoryPath: path.join(tempDir(), "mem.jsonl"),
      embeddingsPath: path.join(tempDir(), "emb.jsonl"),
      configPath: path.join(tempDir(), "cfg.json"),
    })
    e.refreshScope(projectA)
    const saved = e.save({ text: "Wispergo-specific rule", status: "approved", scopeType: "global", kind: "workflow_rule", category: "preference" })
    if (saved.status !== "saved") throw new Error("expected saved")

    const preview = e.previewRescope(saved.memory.id, { scopeType: "project", projectPath: projectB, dryRun: true })
    assert.equal(preview?.dryRun, true)
    assert.equal(preview?.proposed.id, saved.memory.id)
    assert.equal(preview?.proposed.scope.type, "project")
    assert.equal(preview?.proposed.scope.key, "rescope-project-b")
    assert.equal(preview?.proposed.project?.key, "rescope-project-b")
    assert.equal(e.getById(saved.memory.id)?.scope.type, "global")

    const applied = e.rescope(saved.memory.id, { scopeType: "project", projectPath: projectB })
    assert.equal(applied?.dryRun, false)
    assert.equal(applied?.proposed.id, saved.memory.id)
    assert.equal(applied?.proposed.scope.key, "rescope-project-b")
    assert.equal(applied?.proposed.project?.key, "rescope-project-b")
    assert.equal(e.getById(saved.memory.id), undefined)
    e.refreshScope(projectB)
    assert.equal(e.getById(saved.memory.id)?.text, "Wispergo-specific rule")

    const backToGlobal = e.rescope(saved.memory.id, { scopeType: "global" })
    assert.equal(backToGlobal?.proposed.scope.type, "global")
    assert.equal(backToGlobal?.proposed.scope.key, undefined)
    assert.equal(backToGlobal?.proposed.project, undefined)
    e.refreshScope(projectA)
    assert.equal(e.getById(saved.memory.id)?.scope.type, "global")
  })

  it("rejects rescope for deleted rejected and no-op memories", () => {
    const e = new MemoryEngine({
      memoryPath: path.join(tempDir(), "mem.jsonl"),
      embeddingsPath: path.join(tempDir(), "emb.jsonl"),
      configPath: path.join(tempDir(), "cfg.json"),
    })
    const active = e.save({ text: "Active global", status: "approved", scopeType: "global" })
    const rejected = e.save({ text: "Rejected global", status: "approved", scopeType: "global" })
    const deleted = e.save({ text: "Deleted global", status: "approved", scopeType: "global" })
    if (active.status !== "saved" || rejected.status !== "saved" || deleted.status !== "saved") throw new Error("expected saved")
    e.reject(rejected.memory.id)
    e.delete(deleted.memory.id)

    const cleaned = e.rescope(active.memory.id, { scopeType: "global" })
    assert.equal(cleaned?.proposed.project, undefined)
    assert.throws(() => e.previewRescope(active.memory.id, { scopeType: "global", dryRun: true }), /no-op/i)
    assert.throws(() => e.previewRescope(rejected.memory.id, { scopeType: "project", dryRun: true }), /active memory/i)
    assert.throws(() => e.previewRescope(deleted.memory.id, { scopeType: "project", dryRun: true }), /active memory/i)
  })

})
