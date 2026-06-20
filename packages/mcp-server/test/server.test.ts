import test from "node:test"
import assert from "node:assert/strict"
import { MemoryEngine } from "@memory-lane/core"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { createMemoryLaneMcpServer, MEMORY_LANE_TOOL_NAMES } from "../src/server.ts"
import { createMemoryLaneEngine } from "../src/engine.ts"
import { isDirectExecution } from "../src/index.ts"

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

function tempDir(prefix = "memory-lane-mcp-server-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.add(dir)
  registerCleanup()
  return dir
}

function engineInTemp(): MemoryEngine {
  const dir = tempDir()
  return new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath: path.join(dir, "config.json"),
  })
}

function registeredToolNames(server: unknown): string[] {
  const registeredTools = (server as { _registeredTools?: Record<string, unknown> })._registeredTools
  assert.equal(typeof registeredTools, "object")
  assert.notEqual(registeredTools, null)
  return Object.keys(registeredTools).sort()
}

function registeredTool(server: unknown, name: string): any {
  const registeredTools = (server as { _registeredTools?: Record<string, unknown> })._registeredTools
  assert.equal(typeof registeredTools, "object")
  assert.notEqual(registeredTools, null)
  return registeredTools[name]
}

test("direct index entrypoint detection supports existing client configs", () => {
  const dir = tempDir("memory-lane-mcp-entrypoint-")
  const indexPath = path.join(dir, "index.js")
  fs.writeFileSync(indexPath, "")

  assert.equal(isDirectExecution(pathToFileURL(indexPath).href, indexPath), true)
  assert.equal(isDirectExecution(pathToFileURL(indexPath).href, undefined), false)
  assert.equal(isDirectExecution(pathToFileURL(indexPath).href, path.join(dir, "cli.js")), false)
})

test("exports status review-complete and continuity MCP tool names", () => {
  assert.deepEqual(MEMORY_LANE_TOOL_NAMES, [
    "memory_save",
    "memory_suggest",
    "memory_recall",
    "memory_status",
    "memory_list",
    "memory_review",
    "memory_continuity",
    "memory_approve",
    "memory_reject",
    "memory_delete",
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

test("registers plugin MCP tools", () => {
  const server = createMemoryLaneMcpServer({
    engine: engineInTemp(),
    plugins: [{
      name: "fake",
      mcpTools: [{
        name: "fake_tool",
        title: "Fake",
        description: "...",
        inputSchema: {},
        async handler() { return { content: [{ type: "text" as const, text: "ok" }] } },
      }],
      mcpResources: [],
      cliCommands: [],
    }],
  })

  const names = registeredToolNames(server)
  assert.ok(names.includes("fake_tool"))
})

test("createMemoryLaneEngine loads bundled plugins", async () => {
  const dir = tempDir("memory-lane-mcp-engine-")
  const configPath = path.join(dir, "config.json")
  fs.writeFileSync(configPath, JSON.stringify({
    semantic: {
      enabled: false,
      activeEmbeddingProfile: "local-example",
      embeddings: { profiles: {} },
      retrieval: {
        topK: 8,
        minSimilarity: 0.25,
        semanticWeight: 0.65,
        lexicalWeight: 0.25,
        recencyWeight: 0.1,
        fallbackToAllVisibleOnMiss: true,
      },
      privacy: { allowRemoteEmbeddings: false },
    },
    plugins: ["fake-bundled"],
    pluginConfig: {},
  }))

  const { plugins } = await createMemoryLaneEngine({
    cwd: dir,
    env: {
      MEMORY_LANE_FILE: path.join(dir, "memory.jsonl"),
      MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"),
      MEMORY_LANE_CONFIG: configPath,
    },
    bundledPlugins: [{
      name: "fake-bundled",
      default(api) {
        api.registerMcpTool({
          name: "fake_bundled_tool",
          title: "Fake Bundled",
          description: "...",
          inputSchema: {},
          async handler() { return { content: [{ type: "text" as const, text: "ok" }] } },
        })
      },
    }],
  })

  assert.equal(plugins.length, 1)
  assert.equal(plugins[0].mcpTools[0].name, "fake_bundled_tool")
})

test("registers status review-complete and continuity tools on the MCP server", () => {
  const server = createMemoryLaneMcpServer({ engine: engineInTemp() })

  assert.deepEqual(registeredToolNames(server), [
    "memory_approve",
    "memory_continuity",
    "memory_delete",
    "memory_list",
    "memory_recall",
    "memory_reject",
    "memory_review",
    "memory_save",
    "memory_status",
    "memory_suggest",
  ])

  const continuityTool = registeredTool(server, "memory_continuity")
  assert.match(continuityTool.description, /Prefer this over memory_recall for continuity questions/u)
  assert.match(continuityTool.description, /Pass projectPath/u)
})

test("createMemoryLaneEngine uses explicit environment paths", async () => {
  const dir = tempDir("memory-lane-mcp-engine-")
  const { engine } = await createMemoryLaneEngine({
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
