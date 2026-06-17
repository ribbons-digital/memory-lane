import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import { MemoryEngine } from "@memory-lane/core"
import { tempDir } from "../../core/test/helpers.js"
import { handleUserPromptSubmit } from "../src/handlers.ts"

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
