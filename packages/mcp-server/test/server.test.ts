import test from "node:test"
import assert from "node:assert/strict"
import { MemoryEngine, type MemoryRecord } from "@memory-lane/core"
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
    "memory_get",
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
    "memory_get",
    "memory_list",
    "memory_recall",
    "memory_reject",
    "memory_review",
    "memory_save",
    "memory_status",
    "memory_suggest",
  ])

  const continuityTool = registeredTool(server, "memory_continuity")
  assert.match(continuityTool.description, /Use this before memory_recall for continuity questions/u)
  assert.match(continuityTool.description, /Pass projectPath/u)
})

test("read-only MCP tools request non-writable project-path engines", async () => {
  const engine = engineInTemp()
  const projectPath = path.join(tempDir("memory-lane-mcp-readonly-routing-"), "project")
  const calls: Array<{ projectPath?: string; options?: { writable?: boolean } }> = []
  const server = createMemoryLaneMcpServer({
    engine,
    engineForProjectPath(inputProjectPath, options) {
      calls.push({ projectPath: inputProjectPath, options })
      return engine
    },
  })

  const cases: Array<[string, Record<string, unknown>]> = [
    ["memory_recall", { query: "nothing", projectPath }],
    ["memory_status", { projectPath }],
    ["memory_list", { projectPath }],
    ["memory_get", { id: "missing", projectPath }],
    ["memory_review", { projectPath }],
    ["memory_continuity", { projectPath }],
  ]
  for (const [name, input] of cases) await registeredTool(server, name).handler(input)

  assert.deepEqual(calls, cases.map(() => ({ projectPath, options: { writable: false } })))
})

test("createMemoryLaneEngine retargets storage for per-call project paths", async () => {
  const dir = tempDir("memory-lane-mcp-engine-project-path-")
  const home = path.join(dir, "home")
  const startupProject = path.join(dir, "startup-project")
  const callProject = path.join(dir, "call-project")
  fs.mkdirSync(startupProject, { recursive: true })
  fs.mkdirSync(callProject, { recursive: true })

  const { engineForProjectPath } = await createMemoryLaneEngine({ cwd: startupProject, env: { HOME: home } })
  const engine = engineForProjectPath(callProject)
  const result = engine.save({ text: "MCP projectPath storage", category: "project", status: "approved" })

  assert.equal(result.status, "saved")
  assert.equal(fs.existsSync(path.join(callProject, ".memory-lane", "memory.jsonl")), true)
  assert.ok(fs.readFileSync(path.join(callProject, ".memory-lane", "memory.jsonl"), "utf8").includes("MCP projectPath storage"))
  assert.equal(fs.existsSync(path.join(startupProject, ".memory-lane", "memory.jsonl")), false)
})

test("MCP startup does not initialize project-local fallback", async () => {
  const dir = tempDir("memory-lane-mcp-engine-readonly-startup-")
  const blockedHome = path.join(dir, "blocked-home")
  const startupProject = path.join(dir, "startup-project")
  fs.writeFileSync(blockedHome, "not a directory")
  fs.mkdirSync(startupProject, { recursive: true })

  await createMemoryLaneEngine({ cwd: startupProject, env: { HOME: blockedHome } })

  assert.equal(fs.existsSync(path.join(startupProject, ".memory-lane")), false)
  assert.equal(fs.existsSync(path.join(startupProject, ".memory-lane-scope")), false)
})

test("MCP startup does not auto-compact read-only storage", async () => {
  const dir = tempDir("memory-lane-mcp-engine-readonly-compact-")
  const home = path.join(dir, "home")
  const storage = path.join(home, ".memory-lane")
  fs.mkdirSync(storage, { recursive: true })
  fs.writeFileSync(path.join(storage, "config.json"), JSON.stringify({}), "utf8")
  fs.writeFileSync(path.join(storage, "embeddings.jsonl"), "", "utf8")
  const memoryFile = path.join(storage, "memory.jsonl")
  const records = [
    ...Array.from({ length: 70 }, (_, i) => ({ id: `approved-${i}`, text: `Approved ${i}`, category: "project", scope: { type: "global" }, status: "approved", source: "manual", createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z" })),
    ...Array.from({ length: 40 }, (_, i) => ({ id: `deleted-${i}`, text: `Deleted ${i}`, category: "project", scope: { type: "global" }, status: "deleted", source: "manual", createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z" })),
  ] as MemoryRecord[]
  fs.writeFileSync(memoryFile, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
  const before = fs.readFileSync(memoryFile, "utf8")

  const { engine } = await createMemoryLaneEngine({ cwd: dir, env: { HOME: home } })
  const result = await engine.recall("Approved")

  assert.equal(result.memories.length > 0, true)
  assert.equal(fs.readFileSync(memoryFile, "utf8"), before)
})

test("read-only per-call project paths do not initialize project-local fallback", async () => {
  const dir = tempDir("memory-lane-mcp-engine-readonly-project-path-")
  const blockedHome = path.join(dir, "blocked-home")
  const startupProject = path.join(dir, "startup-project")
  const callProject = path.join(dir, "call-project")
  fs.writeFileSync(blockedHome, "not a directory")
  fs.mkdirSync(startupProject, { recursive: true })
  fs.mkdirSync(callProject, { recursive: true })

  const { engineForProjectPath } = await createMemoryLaneEngine({ cwd: startupProject, env: { HOME: blockedHome } })
  const engine = engineForProjectPath(callProject, { writable: false })
  const result = await engine.recall("nothing")

  assert.equal(result.memories.length, 0)
  assert.equal(fs.existsSync(path.join(callProject, ".memory-lane")), false)
  assert.equal(fs.existsSync(path.join(callProject, ".memory-lane-scope")), false)
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
