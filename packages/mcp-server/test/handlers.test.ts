import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { MemoryEngine } from "@memory-lane/core"
import {
  handleMemoryApprove,
  handleMemoryContinuity,
  handleMemoryDelete,
  handleMemoryList,
  handleMemoryRecall,
  handleMemoryReject,
  handleMemoryReview,
  handleMemorySave,
  handleMemoryStatus,
  handleMemorySuggest,
} from "../src/handlers.ts"

const tempDirs = new Set<string>()
let listenerRegistered = false

function registerCleanup(): void {
  if (listenerRegistered) return
  listenerRegistered = true
  process.setMaxListeners(100)
  process.on("exit", () => {
    for (const dir of tempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
    }
  })
}

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-mcp-"))
  tempDirs.add(dir)
  registerCleanup()
  return dir
}

function engineInTemp(cwd?: string): MemoryEngine {
  const dir = tempDir()
  const engine = new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath: path.join(dir, "config.json"),
  })
  if (cwd) engine.refreshScope(cwd)
  return engine
}

function parseToolResult(result: { content: Array<{ type: string; text?: string }> }): any {
  const text = result.content.find((item) => item.type === "text")?.text
  assert.equal(typeof text, "string")
  return JSON.parse(text!)
}

test("memory_save stores an approved memory", async () => {
  const engine = engineInTemp()
  const result = parseToolResult(await handleMemorySave(engine, { text: "Use pnpm for installs", category: "preference", scope: "global" }))

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "saved")
  assert.equal(result.data.memory.status, "approved")
  assert.equal(result.data.memory.text, "Use pnpm for installs")
  assert.equal(result.meta.projectScope, engine.getProjectScope()?.key ?? "none")
})

test("memory_save reports skipped secret without throwing", async () => {
  const engine = engineInTemp()
  const result = parseToolResult(await handleMemorySave(engine, { text: "api_key = sk-1234567890abcdef1234567890abcdef" }))

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, { status: "skipped", reason: "secret" })
})

test("memory_suggest defaults to pending and can approve explicitly", async () => {
  const engine = engineInTemp()
  const pending = parseToolResult(await handleMemorySuggest(engine, { text: "Review docs before implementation" }))
  const approved = parseToolResult(await handleMemorySuggest(engine, { text: "This project uses pnpm", status: "approved", category: "project", scope: "global" }))

  assert.equal(pending.data.memory.status, "pending")
  assert.equal(approved.data.memory.status, "approved")
})

test("memory_recall returns memories and semantic metadata", async () => {
  const engine = engineInTemp()
  engine.save({ text: "Tests run with pnpm test", status: "approved", category: "project", scopeType: "global" })

  const result = parseToolResult(await handleMemoryRecall(engine, { query: "How do tests run?" }))

  assert.equal(result.ok, true)
  assert.equal(result.data.memories.length, 1)
  assert.equal(result.data.semantic.enabled, false)
  assert.equal(result.meta.count, 1)
})

test("memory_list respects project scope by default and all bypasses scope", async () => {
  const projectA = tempDir()
  const projectB = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "project-a" }))
  fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "project-b" }))

  const engine = engineInTemp(projectA)
  engine.save({ text: "A scoped fact", status: "approved", category: "project", scopeType: "project" })
  engine.refreshScope(projectB)
  engine.save({ text: "B scoped fact", status: "approved", category: "project", scopeType: "project" })

  const scoped = parseToolResult(await handleMemoryList(engine, { projectPath: projectA }))
  const all = parseToolResult(await handleMemoryList(engine, { projectPath: projectA, all: true }))

  assert.deepEqual(scoped.data.memories.map((m: any) => m.text), ["A scoped fact"])
  assert.equal(all.data.memories.length, 2)
})

test("memory_review returns pending memories", async () => {
  const engine = engineInTemp()
  engine.suggest("Pending review item")

  const result = parseToolResult(await handleMemoryReview(engine, {}))

  assert.equal(result.ok, true)
  assert.equal(result.data.memories.length, 1)
  assert.equal(result.data.memories[0].status, "pending")
})

test("memory_review includes checkpoint candidate metadata", async () => {
  const engine = engineInTemp()
  engine.suggest("Merged PR #13 adding prompt continuity intents.", "project", "project")
  engine.suggest("Remember to check release notes later.", "project", "project")

  const result = parseToolResult(await handleMemoryReview(engine, {}))
  const merge = result.data.memories.find((memory: any) => memory.text === "Merged PR #13 adding prompt continuity intents.")
  const ambiguous = result.data.memories.find((memory: any) => memory.text === "Remember to check release notes later.")

  assert.deepEqual(merge.checkpointCandidate, {
    detected: true,
    kind: "merge",
    reason: "matched merged pull request phrase",
  })
  assert.equal(ambiguous.checkpointCandidate, undefined)
})

test("memory_review includes grouped project source kind and provenance metadata", async () => {
  const projectA = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "review-project-a" }))
  const engine = engineInTemp(projectA)
  engine.suggest("Pending preference", "preference", "global", "preference")
  engine.save({
    text: "Pending session summary",
    status: "pending",
    category: "project",
    scopeType: "project",
    source: "session-summary",
    kind: "session_summary",
    provenance: { adapter: "pi", lifecycleEvent: "session_end" },
  })

  const result = parseToolResult(await handleMemoryReview(engine, {}))

  assert.equal(result.ok, true)
  assert.equal(result.data.memories.length, 2)
  assert.equal(result.data.groups.length, 2)
  assert.deepEqual(result.data.groups.map((g: any) => ({ projectScope: g.projectScope, source: g.source, kind: g.kind, adapter: g.adapter, lifecycleEvent: g.lifecycleEvent, count: g.count })), [
    { projectScope: "global", source: "user-suggested", kind: "preference", adapter: "none", lifecycleEvent: "none", count: 1 },
    { projectScope: "review-project-a", source: "session-summary", kind: "session_summary", adapter: "pi", lifecycleEvent: "session_end", count: 1 },
  ])
})

test("memory_review filters pending memories by kind source and provenance", async () => {
  const projectA = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "review-filter-project" }))
  const engine = engineInTemp(projectA)
  engine.suggest("Pending preference", "preference", "global", "preference")
  engine.save({
    text: "Pending pi session summary",
    status: "pending",
    category: "project",
    scopeType: "project",
    source: "session-summary",
    kind: "session_summary",
    provenance: { adapter: "pi", lifecycleEvent: "session_end" },
  })
  engine.save({
    text: "Pending claude session summary",
    status: "pending",
    category: "project",
    scopeType: "project",
    source: "session-summary",
    kind: "session_summary",
    provenance: { adapter: "claude", lifecycleEvent: "session_end" },
  })

  const result = parseToolResult(await handleMemoryReview(engine, {
    kind: "session_summary",
    source: "session-summary",
    provenance: "pi/session_end",
  }))

  assert.equal(result.ok, true)
  assert.equal(result.meta.count, 1)
  assert.deepEqual(result.meta.filters, { kind: "session_summary", source: "session-summary", provenance: "pi/session_end" })
  assert.deepEqual(result.data.memories.map((memory: any) => memory.text), ["Pending pi session summary"])
  assert.equal(result.data.groups.length, 1)
  assert.equal(result.data.groups[0].adapter, "pi")
})

test("memory_approve approves a pending memory", async () => {
  const engine = engineInTemp()
  const saved = engine.suggest("Approve this item")
  assert.equal(saved.status, "saved")

  const result = parseToolResult(await handleMemoryApprove(engine, { id: saved.memory.id }))

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "updated")
  assert.equal(result.data.memory.id, saved.memory.id)
  assert.equal(result.data.memory.status, "approved")
})

test("memory_reject rejects a pending memory", async () => {
  const engine = engineInTemp()
  const saved = engine.suggest("Reject this item")
  assert.equal(saved.status, "saved")

  const result = parseToolResult(await handleMemoryReject(engine, { id: saved.memory.id }))

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "updated")
  assert.equal(result.data.memory.id, saved.memory.id)
  assert.equal(result.data.memory.status, "rejected")
})

test("memory_delete soft-deletes an approved memory", async () => {
  const engine = engineInTemp()
  const saved = engine.save({ text: "Delete this item", status: "approved" })
  assert.equal(saved.status, "saved")

  const result = parseToolResult(await handleMemoryDelete(engine, { id: saved.memory.id }))

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "updated")
  assert.equal(result.data.memory.id, saved.memory.id)
  assert.equal(result.data.memory.status, "deleted")
})

test("review mutation tools report missing ids without throwing", async () => {
  const engine = engineInTemp()

  const result = parseToolResult(await handleMemoryDelete(engine, { id: "missing-id" }))

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, { status: "not_found", id: "missing-id" })
})

test("memory_continuity applies projectPath before reading continuity", async () => {
  const projectA = tempDir()
  const projectB = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "mcp-continuity-project-a" }))
  fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "mcp-continuity-project-b" }))

  const engine = engineInTemp(projectB)
  engine.save({ text: "Approved project B checkpoint", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })
  engine.refreshScope(projectA)
  engine.save({ text: "Approved project A checkpoint", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })
  engine.save({ text: "Merged PR #18 adding project A continuity hints.", status: "pending", category: "project", scopeType: "project", kind: "project_fact" })
  engine.refreshScope(projectB)

  const result = parseToolResult(await handleMemoryContinuity(engine, { projectPath: projectA }))

  assert.equal(result.ok, true)
  assert.equal(result.meta.projectScope, "mcp-continuity-project-a")
  assert.equal(result.data.continuity.projectScope, "mcp-continuity-project-a")
  assert.match(result.data.continuity.latestApproved.project.preview, /Approved project A checkpoint/u)
  assert.equal(result.data.continuity.pendingContinuity.length, 1)
  assert.match(result.data.continuity.pendingContinuity[0].preview, /project A continuity/u)
  assert.ok(result.data.continuity.warnings.some((warning: any) => warning.code === "mcp-explicit-tools-only"))
  assert.ok(result.data.notes.some((note: string) => /explicit tools only/u.test(note)))
})

test("memory_continuity includes pending captured checkpoint candidates", async () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "mcp-captured-checkpoint" }))
  const engine = engineInTemp(project)
  const saved = engine.save({
    text: "Released v0.2.12.",
    status: "pending",
    category: "project",
    scopeType: "project",
    kind: "project_checkpoint",
    source: "agent-suggested",
    provenance: { adapter: "codex", lifecycleEvent: "turn_stop" },
  })
  assert.equal(saved.status, "saved")

  const result = parseToolResult(await handleMemoryContinuity(engine, { projectPath: project }))

  assert.equal(result.ok, true)
  assert.equal(result.meta.projectScope, "mcp-captured-checkpoint")
  assert.equal(result.data.continuity.projectScope, "mcp-captured-checkpoint")
  assert.equal(result.data.continuity.status.pendingReviewCount, 1)
  assert.equal(result.data.continuity.status.pendingContinuityCount, 1)
  assert.equal(result.data.continuity.pendingContinuity.length, 1)
  const pending = result.data.continuity.pendingContinuity[0]
  assert.equal(pending.id, saved.memory.id)
  assert.equal(pending.status, "pending")
  assert.equal(pending.kind, "project_checkpoint")
  assert.equal(pending.source, "agent-suggested")
  assert.equal(pending.provenance.adapter, "codex")
  assert.equal(pending.provenance.lifecycleEvent, "turn_stop")
  assert.deepEqual(pending.checkpointCandidate, {
    detected: true,
    kind: "project",
    reason: "kind is project_checkpoint",
  })
})

test("memory_continuity explains missing projectPath when no project scope is active", async () => {
  const previousCwd = process.cwd()
  const cwd = tempDir()
  try {
    process.chdir(cwd)
    const engine = engineInTemp()

    const result = parseToolResult(await handleMemoryContinuity(engine, {}))

    assert.equal(result.ok, true)
    assert.equal(result.meta.projectScope, "none")
    assert.equal(result.data.continuity.projectScope, "none")
    assert.match(result.data.notes.join("\n"), /No projectPath was provided/u)
    assert.ok(result.data.continuity.warnings.some((warning: any) => warning.code === "no-project-scope"))
  } finally {
    process.chdir(previousCwd)
  }
})

test("memory_status returns doctor counts without memory text", async () => {
  const engine = engineInTemp(tempDir())
  engine.save({ text: "Do not leak this exact memory text", status: "approved", category: "project", scopeType: "global" })
  engine.suggest("Do not leak this pending text")

  const result = parseToolResult(await handleMemoryStatus(engine, {}))
  const serialized = JSON.stringify(result)

  assert.equal(result.ok, true)
  assert.equal(result.data.status.totalMemories, 2)
  assert.equal(result.data.status.approvedMemories, 1)
  assert.equal(result.data.status.pendingMemories, 1)
  assert.equal(result.data.status.semanticEnabled, false)
  assert.equal(result.data.status.contextPolicyMode, "selective")
  assert.equal(result.data.status.contextPolicyPromptMaxItems, 6)
  const expectedScope = engine.getProjectScope()?.key ?? "none"
  assert.equal(result.data.status.projectScope, expectedScope)
  assert.equal(result.meta.projectScope, expectedScope)
  assert.ok(Array.isArray(result.data.notes))
  assert.match(result.data.notes.join("\n"), /MCP provides explicit/u)
  assert.doesNotMatch(result.data.notes.join("\n"), /No projectPath was provided/u)
  assert.doesNotMatch(serialized, /Do not leak this exact memory text/u)
  assert.doesNotMatch(serialized, /Do not leak this pending text/u)
})

test("memory_status explains missing projectPath when no project scope is active", async () => {
  const previousCwd = process.cwd()
  const cwd = tempDir()
  try {
    process.chdir(cwd)
    const engine = engineInTemp()

    const result = parseToolResult(await handleMemoryStatus(engine, {}))

    assert.equal(result.ok, true)
    assert.equal(result.meta.projectScope, "none")
    assert.match(result.data.notes.join("\n"), /No projectPath was provided/u)
  } finally {
    process.chdir(previousCwd)
  }
})

test("memory_status applies projectPath before reading scope", async () => {
  const projectA = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "status-project-a" }))
  const engine = engineInTemp()

  const result = parseToolResult(await handleMemoryStatus(engine, { projectPath: projectA }))

  assert.equal(result.ok, true)
  assert.equal(result.data.status.projectScope, "status-project-a")
  assert.equal(result.meta.projectScope, "status-project-a")
})

test("memory_status includes text-free operating agreement summary", async () => {
  const engine = engineInTemp(tempDir())
  engine.save({
    text: "PRIVATE MCP AGREEMENT TEXT Project workflow loop: spec before implementation.",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "project_fact",
  })
  engine.save({
    text: "User prefers concise answers.",
    status: "approved",
    category: "preference",
    scopeType: "global",
    kind: "preference",
  })

  const result = parseToolResult(await handleMemoryStatus(engine, {}))
  const serialized = JSON.stringify(result)
  const summary = result.data.status.operatingAgreements

  assert.equal(result.ok, true)
  assert.equal(summary.primaryCount, 1)
  assert.equal(summary.primary[0].workflowArea, "project-loop")
  assert.equal(summary.primary[0].recommendedKind, "workflow_rule")
  assert.doesNotMatch(serialized, /PRIVATE MCP AGREEMENT TEXT/u)
  assert.doesNotMatch(serialized, /User prefers concise answers/u)
})

test("memory_status includes text-free continuity hints", async () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "mcp-continuity" }))
  const engine = engineInTemp(project)
  const old = engine.save({ text: "PRIVATE MCP OLD LOOP TEXT Project workflow loop old", status: "approved", category: "project", kind: "project_fact" })
  const current = engine.save({ text: "PRIVATE MCP CURRENT LOOP TEXT Project workflow loop current", status: "approved", category: "project", kind: "workflow_rule" })
  engine.save({
    text: "PRIVATE MCP GLOBAL PROJECT-LIKE TEXT docs/superpowers/specs/mcp-specific.md",
    status: "approved",
    category: "preference",
    scopeType: "global",
    kind: "preference",
  })
  assert.equal(old.status, "saved")
  assert.equal(current.status, "saved")
  engine.supersede(current.memory.id, [old.memory.id], { revisedBy: "manual", reason: "newer" })

  const result = parseToolResult(await handleMemoryStatus(engine, { projectPath: project, since: "2000-01-01T00:00:00.000Z" }))

  assert.equal(result.ok, true)
  assert.equal(result.data.status.continuityHints.supersededVisible[0].id, old.memory.id)
  assert.equal(result.data.status.continuityHints.scopeHygieneCandidates[0].reason, "project-path-global-scope")
  assert.ok(result.data.status.continuityHints.hints.some((hint: any) => hint.code === "scope-hygiene-candidate"))
  assert.equal(result.data.status.continuityHints.newerApproved.count >= 2, true)
  assert.doesNotMatch(JSON.stringify(result.data.status.continuityHints), /PRIVATE MCP OLD LOOP TEXT|PRIVATE MCP CURRENT LOOP TEXT|PRIVATE MCP GLOBAL PROJECT-LIKE TEXT/u)
})

test("memory_status applies projectPath before computing operating agreements", async () => {
  const projectA = tempDir()
  const projectB = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "agreement-status-a" }))
  fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "agreement-status-b" }))

  const engine = engineInTemp(projectA)
  engine.save({ text: "Project workflow loop for A.", status: "approved", category: "project", scopeType: "project", kind: "project_fact" })
  engine.refreshScope(projectB)
  engine.save({ text: "Project workflow loop for B.", status: "approved", category: "project", scopeType: "project", kind: "project_fact" })

  const result = parseToolResult(await handleMemoryStatus(engine, { projectPath: projectA }))
  const summary = result.data.status.operatingAgreements

  assert.equal(result.ok, true)
  assert.equal(result.data.status.projectScope, "agreement-status-a")
  assert.equal(summary.projectScope, "agreement-status-a")
  assert.equal(summary.primaryCount, 1)
  assert.equal(summary.primary[0].scope.key, "agreement-status-a")
})

test("memory_status passes since and returns freshness metadata without memory text", async () => {
  const engine = engineInTemp(tempDir())
  engine.save({ text: "Approved private MCP freshness text", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint", source: "session-summary" })
  engine.save({ text: "Approved global MCP preference text", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
  engine.suggest("Pending private MCP freshness text")

  const result = parseToolResult(await handleMemoryStatus(engine, { since: "1970-01-01T00:00:00.000Z" }))
  const serialized = JSON.stringify(result)
  const freshness = result.data.status.freshness

  assert.equal(result.ok, true)
  assert.equal(freshness.referenceTime, "1970-01-01T00:00:00.000Z")
  assert.equal(freshness.visibleApprovedCount, 2)
  assert.equal(freshness.newerApprovedCount, 2)
  assert.equal(freshness.newerProjectApprovedCount, 1)
  assert.equal(freshness.newerGlobalApprovedCount, 1)
  assert.equal(freshness.newerGlobalPreferenceCount, 1)
  assert.equal(freshness.newerByKind.project_checkpoint, 1)
  assert.equal(freshness.newerByKind.preference, 1)
  assert.equal(freshness.newerBySource["session-summary"], 1)
  assert.equal(freshness.newerBySource.manual, 1)
  assert.equal(freshness.newestNewerApproved.length, 2)
  assert.ok(freshness.newestNewerApproved.every((memory: any) => memory.status === "approved"))
  assert.ok(freshness.newestNewerApproved.every((memory: any) => !("text" in memory)))
  assert.doesNotMatch(serialized, /Approved private MCP freshness text/u)
  assert.doesNotMatch(serialized, /Approved global MCP preference text/u)
  assert.doesNotMatch(serialized, /Pending private MCP freshness text/u)
})

test("memory_status applies projectPath before computing freshness", async () => {
  const projectA = tempDir()
  const projectB = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "fresh-status-project-a" }))
  fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "fresh-status-project-b" }))

  const engine = engineInTemp(projectA)
  engine.save({ text: "Fresh project A private fact", status: "approved", category: "project", scopeType: "project" })
  engine.save({ text: "Fresh global private preference", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
  engine.refreshScope(projectB)
  engine.save({ text: "Fresh project B private fact", status: "approved", category: "project", scopeType: "project" })

  const result = parseToolResult(await handleMemoryStatus(engine, { projectPath: projectA, since: "1970-01-01T00:00:00.000Z" }))
  const serialized = JSON.stringify(result)
  const freshness = result.data.status.freshness

  assert.equal(result.ok, true)
  assert.equal(result.data.status.projectScope, "fresh-status-project-a")
  assert.equal(result.meta.projectScope, "fresh-status-project-a")
  assert.equal(freshness.projectScope, "fresh-status-project-a")
  assert.equal(freshness.visibleApprovedCount, 2)
  assert.equal(freshness.newerApprovedCount, 2)
  assert.equal(freshness.newerProjectApprovedCount, 1)
  assert.equal(freshness.newerGlobalApprovedCount, 1)
  assert.deepEqual(freshness.newestNewerApproved.map((memory: any) => memory.scope.type).sort(), ["global", "project"])
  assert.doesNotMatch(serialized, /Fresh project A private fact/u)
  assert.doesNotMatch(serialized, /Fresh global private preference/u)
  assert.doesNotMatch(serialized, /Fresh project B private fact/u)
})

test("memory_status returns an error envelope for invalid since timestamps", async () => {
  const engine = engineInTemp()

  const result = parseToolResult(await handleMemoryStatus(engine, { since: "not-a-date" }))

  assert.equal(result.ok, false)
  assert.match(result.error, /Invalid since timestamp/u)
})
