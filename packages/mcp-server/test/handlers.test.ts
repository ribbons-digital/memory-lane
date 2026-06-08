import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { MemoryEngine } from "@memory-lane/core"
import {
  handleMemoryList, handleMemoryRecall, handleMemoryReview, handleMemorySave, handleMemorySuggest,
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
