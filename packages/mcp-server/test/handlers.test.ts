import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { MemoryEngine, type LocalLearningEventInput } from "@memory-lane/core"
import { createLearningEventSink } from "@memory-lane/lifecycle"
import {
  handleMemoryApprove,
  handleMemoryContinuity,
  handleMemoryDelete,
  handleMemoryGet,
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

function engineInTempWithConfig(config: unknown, cwd?: string): MemoryEngine {
  const dir = tempDir()
  const configPath = path.join(dir, "config.json")
  fs.writeFileSync(configPath, JSON.stringify(config), "utf8")
  const engine = new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath,
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

test("memory_save accepts freshness metadata", async () => {
  const engine = engineInTemp()
  const result = parseToolResult(await handleMemorySave(engine, {
    text: "Temporary MCP fact",
    expiresAt: "2026-07-01T00:00:00.000Z",
    staleAfterDays: 30,
    capturedAt: "2026-06-21T00:00:00.000Z",
  }))

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "saved")
  assert.equal(result.data.memory.freshness.expiresAt, "2026-07-01T00:00:00.000Z")
  assert.equal(result.data.memory.freshness.staleAfterDays, 30)
  assert.equal(result.data.memory.freshness.capturedAt, "2026-06-21T00:00:00.000Z")
})

test("memory_suggest accepts freshness metadata", async () => {
  const engine = engineInTemp()
  const result = parseToolResult(await handleMemorySuggest(engine, {
    text: "Temporary MCP suggestion",
    staleAfterDays: 14,
  }))

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "saved")
  assert.equal(result.data.memory.status, "pending")
  assert.deepEqual(result.data.memory.freshness, { staleAfterDays: 14 })
})

test("memory_suggest rejects invalid freshness metadata", async () => {
  const engine = engineInTemp()
  const result = parseToolResult(await handleMemorySuggest(engine, {
    text: "Bad MCP freshness",
    staleAfterDays: 0,
  }))

  assert.equal(result.ok, false)
  assert.match(result.error, /Invalid freshness\.staleAfterDays/u)
})

test("memory_save rejects empty freshness timestamps", async () => {
  const engine = engineInTemp()
  const result = parseToolResult(await handleMemorySave(engine, {
    text: "Bad MCP expiration",
    expiresAt: "",
  }))

  assert.equal(result.ok, false)
  assert.match(result.error, /Invalid freshness\.expiresAt/u)
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

test("memory_review applies projectPath and only --all reveals another project", async () => {
  const projectA = tempDir()
  const projectB = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "mcp-review-project-a" }))
  fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "mcp-review-project-b" }))
  const engine = engineInTemp(projectA)
  engine.suggest("SECRET MCP project A pending text", "project", "project")
  engine.refreshScope(projectB)
  engine.suggest("Visible MCP project B pending text", "project", "project")
  engine.refreshScope(projectA)

  const scopedResult = await handleMemoryReview(engine, { projectPath: projectB })
  const scoped = parseToolResult(scopedResult)
  assert.deepEqual(scopedResult.structuredContent, scoped)
  assert.equal(scoped.ok, true)
  assert.equal(scoped.meta.projectScope, "mcp-review-project-b")
  assert.equal(scoped.meta.count, 1)
  assert.deepEqual(scoped.data.memories.map((memory: { text: string }) => memory.text), ["Visible MCP project B pending text"])
  assert.doesNotMatch(JSON.stringify(scopedResult), /SECRET MCP project A/u)

  const allResult = await handleMemoryReview(engine, { projectPath: projectB, all: true })
  const all = parseToolResult(allResult)
  assert.deepEqual(allResult.structuredContent, all)
  assert.equal(all.ok, true)
  assert.equal(all.meta.projectScope, "mcp-review-project-b")
  assert.equal(all.meta.count, 2)
  assert.deepEqual(all.data.memories.map((memory: { text: string }) => memory.text).sort(), ["SECRET MCP project A pending text", "Visible MCP project B pending text"].sort())
})

test("review mutation handlers refuse cross-project ids unless all is true", async (t) => {
  const scenarios = [
    { name: "memory_approve", initialStatus: "pending", finalStatus: "approved", invoke: handleMemoryApprove },
    { name: "memory_reject", initialStatus: "pending", finalStatus: "rejected", invoke: handleMemoryReject },
    { name: "memory_delete", initialStatus: "approved", finalStatus: "deleted", invoke: handleMemoryDelete },
  ] as const

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const projectA = tempDir()
      const projectB = tempDir()
      fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: `mcp-${scenario.name}-project-a` }))
      fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: `mcp-${scenario.name}-project-b` }))
      const engine = engineInTemp(projectA)
      const secretText = `SECRET ${scenario.name} project A text`
      const saved = engine.save({
        text: secretText,
        status: scenario.initialStatus,
        category: "project",
        scopeType: "project",
      })
      assert.equal(saved.status, "saved")

      const refusedResult = await scenario.invoke(engine, { id: saved.memory.id, projectPath: projectB })
      const refused = parseToolResult(refusedResult)
      assert.deepEqual(refusedResult.structuredContent, refused)
      assert.equal(refused.ok, true)
      assert.equal(refused.meta.projectScope, `mcp-${scenario.name}-project-b`)
      assert.deepEqual(refused.data, { status: "not_found", id: saved.memory.id })
      assert.doesNotMatch(JSON.stringify(refusedResult), /SECRET/u)
      assert.equal(engine.getById(saved.memory.id, { all: true })?.status, scenario.initialStatus)

      const allowedResult = await scenario.invoke(engine, { id: saved.memory.id, projectPath: projectB, all: true })
      const allowed = parseToolResult(allowedResult)
      assert.deepEqual(allowedResult.structuredContent, allowed)
      assert.equal(allowed.ok, true)
      assert.equal(allowed.meta.projectScope, `mcp-${scenario.name}-project-b`)
      assert.equal(allowed.data.status, "updated")
      assert.equal(allowed.data.memory.id, saved.memory.id)
      assert.equal(allowed.data.memory.status, scenario.finalStatus)
      assert.equal(allowed.data.memory.text, secretText)
    })
  }
})

test("review mutation handlers emit MCP decision events through the shared engine source", async (t) => {
  const scenarios = [
    { name: "approve", initialStatus: "pending", eventType: "suggestion-approved", invoke: handleMemoryApprove },
    { name: "reject", initialStatus: "pending", eventType: "suggestion-rejected", invoke: handleMemoryReject },
    { name: "delete", initialStatus: "approved", eventType: "suggestion-deleted", invoke: handleMemoryDelete },
  ] as const

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const dir = tempDir()
      const events: LocalLearningEventInput[] = []
      const engine = new MemoryEngine({
        memoryPath: path.join(dir, "memory.jsonl"),
        embeddingsPath: path.join(dir, "embeddings.jsonl"),
        configPath: path.join(dir, "config.json"),
        learningEventSink: (event) => { events.push(event) },
      })
      const saved = engine.save({ text: `MCP ${scenario.name} event`, status: scenario.initialStatus, source: "agent-suggested" })
      assert.equal(saved.status, "saved")
      if (saved.status !== "saved") throw new Error("expected saved fixture")

      const result = parseToolResult(await scenario.invoke(engine, { id: saved.memory.id }))

      assert.equal(result.ok, true)
      assert.deepEqual(events.map((event) => event.eventType), ["suggestion-created", scenario.eventType])
      assert.equal(events[1]?.actor, "mcp")
      assert.equal(events[1]?.memory.id, saved.memory.id)
      assert.equal(events[1]?.previousMemory?.status, scenario.initialStatus)
    })
  }
})

test("all-scope MCP decisions honor both owning and acting project exclusions", async () => {
  const cases = [
    { name: "excluded owner", excludedProject: "mcp-event-owner" },
    { name: "excluded caller", excludedProject: "mcp-event-caller" },
  ]

  for (const item of cases) {
    const dir = tempDir()
    const ownerProject = path.join(dir, "owner")
    const callerProject = path.join(dir, "caller")
    const configPath = path.join(dir, "config.json")
    const traceRoot = path.join(dir, "traces")
    fs.mkdirSync(ownerProject, { recursive: true })
    fs.mkdirSync(callerProject, { recursive: true })
    fs.writeFileSync(path.join(ownerProject, ".memory-lane-scope"), JSON.stringify({ id: "mcp-event-owner" }))
    fs.writeFileSync(path.join(callerProject, ".memory-lane-scope"), JSON.stringify({ id: "mcp-event-caller" }))
    fs.writeFileSync(configPath, JSON.stringify({ learning: { capture: "off" } }))
    const engine = new MemoryEngine({
      memoryPath: path.join(dir, "memory.jsonl"),
      embeddingsPath: path.join(dir, "embeddings.jsonl"),
      configPath,
      learningEventSink: createLearningEventSink({ configPath, traceRoot }),
    })
    engine.refreshScope(ownerProject)
    const saved = engine.save({ text: `Pending ${item.name} MCP decision`, status: "pending", scopeType: "project" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") throw new Error("expected saved fixture")
    fs.writeFileSync(configPath, JSON.stringify({ learning: { capture: "on", excludedProjects: [item.excludedProject] } }))

    const result = parseToolResult(await handleMemoryApprove(engine, { id: saved.memory.id, all: true, projectPath: callerProject }))

    assert.equal(result.data.status, "updated", item.name)
    assert.equal(result.data.memory.status, "approved", item.name)
    assert.equal(fs.existsSync(traceRoot), false, item.name)
  }
})

test("memory review, get, and approve without projectPath are global-only unless all is true", async () => {
  const storageDir = tempDir()
  const projectA = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "mcp-null-scope-project-a" }))
  const engineOptions = {
    memoryPath: path.join(storageDir, "memory.jsonl"),
    embeddingsPath: path.join(storageDir, "embeddings.jsonl"),
    configPath: path.join(storageDir, "config.json"),
  }
  const writer = new MemoryEngine(engineOptions)
  writer.refreshScope(projectA)
  const projectMemory = writer.save({
    text: "SECRET null-scope project pending text",
    status: "pending",
    category: "project",
    scopeType: "project",
  })
  assert.equal(projectMemory.status, "saved")
  const globalMemory = writer.save({
    text: "Visible global pending text",
    status: "pending",
    category: "preference",
    scopeType: "global",
  })
  assert.equal(globalMemory.status, "saved")
  const reader = new MemoryEngine(engineOptions)
  const previousCwd = process.cwd()
  try {
    process.chdir(tempDir())
    reader.refreshScope()
  } finally {
    process.chdir(previousCwd)
  }

  const scopedReviewResult = await handleMemoryReview(reader, {})
  const scopedReview = parseToolResult(scopedReviewResult)
  assert.deepEqual(scopedReviewResult.structuredContent, scopedReview)
  assert.equal(scopedReview.ok, true)
  assert.equal(scopedReview.meta.projectScope, "none")
  assert.equal(scopedReview.meta.count, 1)
  assert.deepEqual(scopedReview.data.memories.map((memory: { text: string }) => memory.text), ["Visible global pending text"])
  assert.doesNotMatch(JSON.stringify(scopedReviewResult), /SECRET null-scope/u)

  const allReviewResult = await handleMemoryReview(reader, { all: true })
  const allReview = parseToolResult(allReviewResult)
  assert.deepEqual(allReviewResult.structuredContent, allReview)
  assert.equal(allReview.ok, true)
  assert.equal(allReview.meta.projectScope, "none")
  assert.equal(allReview.meta.count, 2)
  assert.deepEqual(allReview.data.memories.map((memory: { text: string }) => memory.text).sort(), ["SECRET null-scope project pending text", "Visible global pending text"].sort())

  const visibleGlobalResult = await handleMemoryGet(reader, { id: globalMemory.memory.id })
  const visibleGlobal = parseToolResult(visibleGlobalResult)
  assert.deepEqual(visibleGlobalResult.structuredContent, visibleGlobal)
  assert.equal(visibleGlobal.ok, true)
  assert.equal(visibleGlobal.meta.projectScope, "none")
  assert.equal(visibleGlobal.data.memory.text, "Visible global pending text")

  const hiddenProjectResult = await handleMemoryGet(reader, { id: projectMemory.memory.id })
  const hiddenProject = parseToolResult(hiddenProjectResult)
  assert.deepEqual(hiddenProjectResult.structuredContent, hiddenProject)
  assert.equal(hiddenProject.ok, true)
  assert.equal(hiddenProject.meta.projectScope, "none")
  assert.deepEqual(hiddenProject.data, {
    status: "not_found",
    id: projectMemory.memory.id,
    hint: "Use all: true to search across projects and deleted/rejected memories.",
  })
  assert.doesNotMatch(JSON.stringify(hiddenProjectResult), /SECRET null-scope/u)

  const visibleWithAllResult = await handleMemoryGet(reader, { id: projectMemory.memory.id, all: true })
  const visibleWithAll = parseToolResult(visibleWithAllResult)
  assert.deepEqual(visibleWithAllResult.structuredContent, visibleWithAll)
  assert.equal(visibleWithAll.ok, true)
  assert.equal(visibleWithAll.meta.projectScope, "none")
  assert.equal(visibleWithAll.data.memory.text, "SECRET null-scope project pending text")

  const refusedResult = await handleMemoryApprove(reader, { id: projectMemory.memory.id })
  const refused = parseToolResult(refusedResult)
  assert.deepEqual(refusedResult.structuredContent, refused)
  assert.equal(refused.ok, true)
  assert.equal(refused.meta.projectScope, "none")
  assert.deepEqual(refused.data, { status: "not_found", id: projectMemory.memory.id })
  assert.doesNotMatch(JSON.stringify(refusedResult), /SECRET null-scope/u)
  assert.equal(reader.getById(projectMemory.memory.id, { all: true })?.status, "pending")

  const allowedResult = await handleMemoryApprove(reader, { id: projectMemory.memory.id, all: true })
  const allowed = parseToolResult(allowedResult)
  assert.deepEqual(allowedResult.structuredContent, allowed)
  assert.equal(allowed.ok, true)
  assert.equal(allowed.meta.projectScope, "none")
  assert.equal(allowed.data.status, "updated")
  assert.equal(allowed.data.memory.status, "approved")
  assert.equal(allowed.data.memory.text, "SECRET null-scope project pending text")
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

test("memory_review includes review hygiene metadata for operational summary chatter", async () => {
  const engine = engineInTemp()
  engine.save({
    text: "## Session Summary\n\n- Delegated subagent completed task 3 only.\n- Report status as APPROVED.",
    status: "pending",
    category: "project",
    scopeType: "project",
    source: "session-summary",
    kind: "session_summary",
  })

  const result = parseToolResult(await handleMemoryReview(engine, {}))
  const memory = result.data.memories[0]

  assert.equal(memory.reviewHygiene.operationalChatter, true)
  assert.equal(memory.reviewHygiene.suggestedAction, "consider-rejecting")
  assert.ok(memory.reviewHygiene.reasons.includes("delegated-subagent"))
})

test("memory_review includes advisory quality signals and filters by one or more signals", async () => {
  const engine = engineInTemp()
  engine.suggest("Should we keep it?", "project", "project", "project_fact")
  engine.suggest("Use pnpm for package installation in this project.", "project", "project", "workflow_rule")

  const all = parseToolResult(await handleMemoryReview(engine, {}))
  const signaled = all.data.memories.find((memory: any) => memory.text === "Should we keep it?")
  const valid = all.data.memories.find((memory: any) => memory.text.startsWith("Use pnpm"))
  assert.deepEqual(signaled.qualitySignals.map((signal: any) => signal.code), ["contains-question", "ambiguous-reference"])
  assert.deepEqual(valid.qualitySignals, [])

  const filtered = parseToolResult(await handleMemoryReview(engine, { signal: ["contains-question", "contains-code-fence"] }))
  assert.deepEqual(filtered.meta.filters, { signal: ["contains-question", "contains-code-fence"] })
  assert.deepEqual(filtered.data.memories.map((memory: any) => memory.text), ["Should we keep it?"])
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
  const stale = engine.save({ text: "SECRET stale MCP continuity body", status: "approved", category: "project", scopeType: "project", kind: "project_fact", freshness: { staleAfterDays: 1, capturedAt: "2000-01-01T00:00:00.000Z" } })
  engine.save({ text: "Approved project A checkpoint", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })
  engine.save({ text: "Merged PR #18 adding project A continuity hints.", status: "pending", category: "project", scopeType: "project", kind: "project_fact" })
  engine.refreshScope(projectB)

  const result = parseToolResult(await handleMemoryContinuity(engine, { projectPath: projectA }))

  assert.equal(result.ok, true)
  assert.equal(result.meta.projectScope, "mcp-continuity-project-a")
  assert.equal(result.data.continuity.projectScope, "mcp-continuity-project-a")
  assert.match(result.data.continuity.latestApproved.project.preview, /Approved project A checkpoint/u)
  assert.match(result.data.continuity.latestProgress.preview, /Approved project A checkpoint/u)
  assert.equal(result.data.continuity.pendingContinuity.length, 1)
  assert.match(result.data.continuity.pendingContinuity[0].preview, /project A continuity/u)
  assert.ok(result.data.continuity.warnings.some((warning: any) => warning.code === "mcp-explicit-tools-only"))
  assert.ok(result.data.continuity.warnings.some((warning: any) => warning.code === "freshness-advisory"))
  assert.match(result.data.continuity.suggestedActions.join("\n"), new RegExp(`memory-lane update ${stale.memory.id} --text <updated-memory-text> --dry-run`, "u"))
  assert.doesNotMatch(JSON.stringify(result.data.continuity), /SECRET stale MCP continuity body/u)
  assert.ok(result.data.notes.some((note: string) => /explicit tools only/u.test(note)))
})

test("memory_continuity query includes workstream discovery", async () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "mcp-workstream-discovery" }))
  const engine = engineInTemp(project)
  const saved = engine.save({
    text: "Merged PR #39 from branch docs/phase-21-workstream-discovery at commit 84692b9 for workstream discovery implementation.",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "project_checkpoint",
  })
  assert.equal(saved.status, "saved")

  const result = parseToolResult(await handleMemoryContinuity(engine, { projectPath: project, query: "where was workstream discovery implemented" }))

  assert.equal(result.ok, true)
  assert.equal(result.data.continuity.workstreamDiscovery.query, "where was workstream discovery implemented")
  assert.deepEqual(result.data.continuity.workstreamDiscovery.candidates.map((candidate: any) => candidate.id), [saved.memory.id])
  assert.deepEqual(result.data.continuity.workstreamDiscovery.candidates[0].references.pullRequests, ["#39"])
})

test("memory_continuity without query omits workstream discovery", async () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "mcp-no-discovery" }))
  const engine = engineInTemp(project)
  engine.save({ text: "Merged PR #39 for workstream discovery.", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })

  const result = parseToolResult(await handleMemoryContinuity(engine, { projectPath: project }))

  assert.equal(result.ok, true)
  assert.equal(result.data.continuity.workstreamDiscovery, undefined)
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
  assert.equal(result.data.continuity.handoffProposal, undefined)
})

test("memory_continuity includes review-mode handoff proposal", async () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "mcp-review-proposal" }))
  const engine = engineInTempWithConfig({ memory: { handoffMode: "review" } }, project)
  const saved = engine.save({
    text: "## Session Summary\nNext action: inspect MCP review-mode handoff proposal.",
    status: "pending",
    category: "project",
    scopeType: "project",
    kind: "session_summary",
    source: "session-summary",
  })
  assert.equal(saved.status, "saved")

  const result = parseToolResult(await handleMemoryContinuity(engine, { projectPath: project }))

  assert.equal(result.ok, true)
  assert.equal(result.data.continuity.handoffProposal.mode, "review")
  assert.equal(result.data.continuity.handoffProposal.pendingCount, 1)
  assert.equal(result.data.continuity.handoffProposal.items[0].id, saved.memory.id)
  assert.ok(result.data.continuity.handoffProposal.suggestedActions.includes(`memory-lane approve ${saved.memory.id}`))
  assert.ok(result.data.continuity.suggestedActions.includes(`memory-lane approve ${saved.memory.id}`))

  const status = parseToolResult(await handleMemoryStatus(engine, { projectPath: project }))
  assert.equal(status.data.status.handoffMode, "review")
  assert.equal(status.data.status.handoffModeBehaviorActive, true)
  assert.equal(status.data.status.handoffProposal, undefined)
})

test("memory_continuity omits handoff proposal outside review mode", async () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "mcp-manual-proposal" }))
  const engine = engineInTemp(project)
  engine.save({
    text: "## Session Summary\nNext action: remain manual.",
    status: "pending",
    category: "project",
    scopeType: "project",
    kind: "session_summary",
    source: "session-summary",
  })

  const result = parseToolResult(await handleMemoryContinuity(engine, { projectPath: project }))

  assert.equal(result.ok, true)
  assert.equal(result.data.continuity.handoffProposal, undefined)
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
  assert.equal(result.data.status.handoffMode, "manual")
  assert.equal(result.data.status.handoffModeBehaviorActive, true)
  assert.equal(result.data.status.handoffModeNote, "Current inspection-first behavior is active.")
  assert.equal(result.data.status.handoffProposal, undefined)
  const expectedScope = engine.getProjectScope()?.key ?? "none"
  assert.equal(result.data.status.continuityBaseline.projectScope, expectedScope)
  assert.equal(result.data.status.continuityBaseline.source, "none")
  assert.equal(result.data.status.continuityBaseline.readable, true)
  assert.match(result.data.status.continuityBaseline.stateFile, /continuity-baselines\.json$/u)
  assert.doesNotMatch(JSON.stringify(result.data.status.continuityBaseline), /Do not leak this exact memory text|Do not leak this pending text/u)
  assert.equal(result.data.status.projectScope, expectedScope)
  assert.equal(result.meta.projectScope, expectedScope)
  assert.ok(Array.isArray(result.data.notes))
  assert.match(result.data.notes.join("\n"), /MCP provides explicit/u)
  assert.doesNotMatch(result.data.notes.join("\n"), /No projectPath was provided/u)
  assert.doesNotMatch(serialized, /Do not leak this exact memory text/u)
  assert.doesNotMatch(serialized, /Do not leak this pending text/u)
})

test("memory_status includes text-free preference diagnostics", async () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "mcp-pref-diagnostics" }))
  const engine = engineInTemp(project)
  engine.save({ text: "MCP_SECRET_GLOBAL_PREF", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
  engine.refreshScope(project)
  engine.save({ text: "MCP_SECRET_PROJECT_PREF", status: "approved", category: "preference", scopeType: "project", kind: "preference" })

  const result = parseToolResult(await handleMemoryStatus(engine, { projectPath: project }))
  const serialized = JSON.stringify(result)

  assert.equal(result.ok, true)
  assert.equal(result.data.status.preferenceDiagnostics.projectScope, "mcp-pref-diagnostics")
  assert.equal(result.data.status.preferenceDiagnostics.visiblePreferenceCount, 2)
  assert.equal(result.data.status.preferenceDiagnostics.currentProjectPreferenceCount, 1)
  assert.equal(result.data.status.preferenceDiagnostics.globalPreferenceCount, 1)
  assert.match(result.data.notes.join("\n"), /Preference diagnostics in memory_status are counts\/metadata only/u)
  assert.doesNotMatch(serialized, /MCP_SECRET_GLOBAL_PREF|MCP_SECRET_PROJECT_PREF/u)
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
  engine.save({
    text: "Approved private MCP freshness text",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "project_checkpoint",
    source: "session-summary",
    freshness: { staleAfterDays: 1, capturedAt: "2000-01-01T00:00:00.000Z" },
  })
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
  assert.equal(freshness.advisory.staleCount, 1)
  assert.deepEqual(freshness.advisory.stale[0].freshness.suggestedActions, ["memory-lane update " + freshness.advisory.stale[0].id + " --text <updated-memory-text> --dry-run"])
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


test("memory_get returns visible exact ids and all bypasses scope and status", async () => {
  const projectA = tempDir()
  const projectB = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "mcp-get-project-a" }))
  fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "mcp-get-project-b" }))

  const engine = engineInTemp(projectA)
  const a = engine.save({ text: "MCP project A exact text", status: "approved", category: "project", scopeType: "project" })
  engine.refreshScope(projectB)
  const b = engine.save({ text: "MCP project B exact text", status: "approved", category: "project", scopeType: "project" })
  if (a.status !== "saved" || b.status !== "saved") throw new Error("expected saved")
  engine.delete(b.memory.id)

  const visible = parseToolResult(await handleMemoryGet(engine, { id: a.memory.id, projectPath: projectA }))
  assert.equal(visible.ok, true)
  assert.equal(visible.data.memory.text, "MCP project A exact text")

  const hidden = parseToolResult(await handleMemoryGet(engine, { id: b.memory.id, projectPath: projectA }))
  assert.equal(hidden.ok, true)
  assert.deepEqual(hidden.data, { status: "not_found", id: b.memory.id, hint: "Use all: true to search across projects and deleted/rejected memories." })

  const all = parseToolResult(await handleMemoryGet(engine, { id: b.memory.id, projectPath: projectA, all: true }))
  assert.equal(all.ok, true)
  assert.equal(all.data.memory.status, "deleted")
  assert.equal(all.data.memory.text, "MCP project B exact text")
})
