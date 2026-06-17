import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import { MemoryEngine, writeConfig } from "@memory-lane/core"
import { tempDir } from "../../core/test/helpers.js"
import { handleSessionStart, handleUserPromptSubmit } from "../src/handlers.ts"

function engineInTemp(cwd?: string, memoryConfig?: Record<string, unknown>): MemoryEngine {
  const dir = tempDir()
  const configPath = path.join(dir, "config.json")
  if (memoryConfig) writeConfig(configPath, { memory: memoryConfig } as any)
  const engine = new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath,
  })
  if (cwd) engine.refreshScope(cwd)
  return engine
}

test("user-prompt list-memory intent returns authoritative list guidance instead of filtered relevant memory", async () => {
  const project = tempDir()
  const engine = engineInTemp(project)
  engine.save({ text: "This repo uses pnpm", status: "approved", category: "project", scopeType: "project" })

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "list current memory",
  })

  assert.match(result.additionalContext ?? "", /authoritative Memory Lane list/u)
  assert.match(result.additionalContext ?? "", /memory-lane list --json/u)
  assert.doesNotMatch(result.additionalContext ?? "", /## Relevant Memory/u)
  assert.doesNotMatch(result.additionalContext ?? "", /This repo uses pnpm/u)
})

test("user-prompt policy-only returns guidance without recalling memory bodies", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only" } })
  engine.save({ text: "This repo uses pnpm", status: "approved", category: "project", scopeType: "project" })

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "how do we run tests in this repo",
  })

  assert.match(result.additionalContext ?? "", /mode="policy-only"/u)
  assert.match(result.additionalContext ?? "", /Use Memory Lane recall\/list tools/u)
  assert.doesNotMatch(result.additionalContext ?? "", /This repo uses pnpm/u)
  assert.deepEqual(result.contextDecision, {
    event: "prompt",
    mode: "policy-only",
    maxItems: 6,
    maxChars: 3000,
    selected: 0,
    omitted: 0,
    omittedReasons: ["policy-only"],
  })
})

test("session-start off policy injects no baseline context", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "off" } })
  engine.save({ text: "This repo uses pnpm", status: "approved", category: "project", scopeType: "project" })

  const result = handleSessionStart(engine, { cwd: project })

  assert.equal(result.additionalContext, undefined)
  assert.deepEqual(result.contextDecision, {
    event: "sessionStart",
    mode: "off",
    maxItems: 4,
    maxChars: 1600,
    selected: 0,
    omitted: 0,
    omittedReasons: ["off"],
  })
})

test("session-start selective policy uses configured item budget", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective", maxItems: { sessionStart: 1 } } })
  engine.save({ text: "First baseline memory", status: "approved", category: "project", scopeType: "project" })
  engine.save({ text: "Second baseline memory", status: "approved", category: "project", scopeType: "project" })

  const result = handleSessionStart(engine, { cwd: project })

  assert.match(result.additionalContext ?? "", /<memory-context/u)
  assert.match(result.additionalContext ?? "", /baseline memory/u)
  assert.equal((result.additionalContext?.match(/baseline memory/gu) ?? []).length, 1)
  assert.deepEqual(result.contextDecision, {
    event: "sessionStart",
    mode: "selective",
    maxItems: 1,
    maxChars: 1600,
    selected: 1,
    omitted: 1,
    omittedReasons: ["budget-or-filter"],
  })
})
