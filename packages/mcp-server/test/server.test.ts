import test from "node:test"
import assert from "node:assert/strict"
import { MemoryEngine } from "@memory-lane/core"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createMemoryLaneMcpServer, MEMORY_LANE_TOOL_NAMES } from "../src/server.ts"
import { createMemoryLaneEngine } from "../src/engine.ts"

function engineInTemp(): MemoryEngine {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-mcp-server-"))
  return new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath: path.join(dir, "config.json"),
  })
}

test("exports the five Phase 7 tool names", () => {
  assert.deepEqual(MEMORY_LANE_TOOL_NAMES, [
    "memory_save",
    "memory_suggest",
    "memory_recall",
    "memory_list",
    "memory_review",
  ])
})

test("creates an MCP server without writing to stdout", () => {
  const originalWrite = process.stdout.write
  let stdoutWrites = 0
  ;(process.stdout.write as any) = (..._args: unknown[]) => {
    stdoutWrites++
    return true
  }
  try {
    const server = createMemoryLaneMcpServer({ engine: engineInTemp() })
    assert.equal(typeof server.connect, "function")
    assert.equal(stdoutWrites, 0)
  } finally {
    process.stdout.write = originalWrite
  }
})

test("createMemoryLaneEngine uses explicit environment paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-mcp-engine-"))
  const engine = createMemoryLaneEngine({
    cwd: dir,
    env: {
      MEMORY_LANE_FILE: path.join(dir, "custom-memory.jsonl"),
      MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "custom-embeddings.jsonl"),
      MEMORY_LANE_CONFIG: path.join(dir, "custom-config.json"),
    },
  })

  const result = engine.save({ text: "MCP engine path smoke", status: "approved", scopeType: "global" })
  assert.equal(result.status, "saved")
  assert.equal(fs.existsSync(path.join(dir, "custom-memory.jsonl")), true)
})
