import test from "node:test"
import assert from "node:assert/strict"
import { MemoryEngine, type MemoryRecord } from "@memory-lane/core"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { createMemoryLaneMcpServer, MEMORY_LANE_TOOL_NAMES } from "../src/server.ts"
import { z } from "zod"
import { createMemoryLaneEngine } from "../src/engine.ts"
import { isDirectExecution } from "../src/index.ts"

const tempDirs = new Set<string>()
let listenerRegistered = false

type RegisteredToolResult = {
  content: Array<{ type: string; text?: string }>
}

type RegisteredTool = {
  description: string
  handler(input: Record<string, unknown>): Promise<RegisteredToolResult>
}

const memoriesEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    memories: z.array(z.object({ text: z.string() })),
  }),
  meta: z.object({
    count: z.number(),
    projectScope: z.string(),
  }),
})

const statusEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    status: z.object({ projectScope: z.string() }),
    notes: z.array(z.string()),
  }),
  meta: z.object({ projectScope: z.string() }),
})

function isRegisteredTool(value: unknown): value is RegisteredTool {
  return value !== null
    && typeof value === "object"
    && "description" in value
    && typeof value.description === "string"
    && "handler" in value
    && typeof value.handler === "function"
}

function registeredTools(server: unknown): object {
  assert.ok(server !== null && typeof server === "object" && "_registeredTools" in server)
  const tools: unknown = server._registeredTools
  assert.ok(tools !== null && typeof tools === "object")
  return tools
}

function parseToolJson(result: RegisteredToolResult): unknown {
  const text = result.content.find((item) => item.type === "text")?.text
  assert.equal(typeof text, "string")
  return JSON.parse(text)
}

function projectScope(prefix: string, id: string): string {
  const projectPath = tempDir(prefix)
  fs.writeFileSync(path.join(projectPath, ".memory-lane-scope"), JSON.stringify({ id }), "utf8")
  return projectPath
}

function saveProjectMemory(engine: MemoryEngine, projectPath: string, text: string): MemoryRecord {
  engine.refreshScope(projectPath)
  const result = engine.save({ text, status: "approved", category: "project", scopeType: "project" })
  if (result.status !== "saved") throw new Error(`failed to save project fixture: ${result.reason}`)
  return result.memory
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => { throw new Error("deferred resolved before initialization") }
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

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
  return Object.keys(registeredTools(server)).sort()
}

function registeredTool(server: unknown, name: string): RegisteredTool {
  const tool: unknown = Reflect.get(registeredTools(server), name)
  assert.ok(isRegisteredTool(tool), `expected ${name} to be a registered MCP tool`)
  return tool
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

test("registered review and mutation tools accept all true", async () => {
  const projectA = tempDir("memory-lane-mcp-all-project-a-")
  const projectB = tempDir("memory-lane-mcp-all-project-b-")
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "server-all-project-a" }))
  fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "server-all-project-b" }))
  const engine = engineInTemp()
  engine.refreshScope(projectA)
  const reviewMemory = engine.save({ text: "Registered review all text", status: "pending", category: "project", scopeType: "project" })
  const approveMemory = engine.save({ text: "Registered approve all text", status: "pending", category: "project", scopeType: "project" })
  const rejectMemory = engine.save({ text: "Registered reject all text", status: "pending", category: "project", scopeType: "project" })
  const deleteMemory = engine.save({ text: "Registered delete all text", status: "approved", category: "project", scopeType: "project" })
  if (reviewMemory.status !== "saved" || approveMemory.status !== "saved" || rejectMemory.status !== "saved" || deleteMemory.status !== "saved") {
    throw new Error("expected registered tool fixtures to save")
  }
  engine.refreshScope(projectB)
  const server = createMemoryLaneMcpServer({ engine })
  const parseResult = (result: { content: Array<{ type: string; text?: string }> }) => {
    const text = result.content.find((item) => item.type === "text")?.text
    assert.equal(typeof text, "string")
    return JSON.parse(text)
  }

  const reviewed = parseResult(await registeredTool(server, "memory_review").handler({ all: true }))
  assert.equal(reviewed.ok, true)
  assert.equal(reviewed.meta.count, 3)
  assert.deepEqual(reviewed.data.memories.map((memory: { text: string }) => memory.text).sort(), [
    "Registered approve all text",
    "Registered reject all text",
    "Registered review all text",
  ].sort())

  const approved = parseResult(await registeredTool(server, "memory_approve").handler({ id: approveMemory.memory.id, all: true }))
  const rejected = parseResult(await registeredTool(server, "memory_reject").handler({ id: rejectMemory.memory.id, all: true }))
  const deleted = parseResult(await registeredTool(server, "memory_delete").handler({ id: deleteMemory.memory.id, all: true }))
  assert.equal(approved.data.memory.status, "approved")
  assert.equal(rejected.data.memory.status, "rejected")
  assert.equal(deleted.data.memory.status, "deleted")
})

test("fallback registered tool scope resets an omitted read to the startup project", async () => {
  const projectA = projectScope("memory-lane-mcp-fallback-read-a-", "fallback-read-a")
  const projectB = projectScope("memory-lane-mcp-fallback-read-b-", "fallback-read-b")
  const engine = engineInTemp()
  saveProjectMemory(engine, projectA, "Startup project read memory")
  saveProjectMemory(engine, projectB, "Explicit project B read memory")
  engine.refreshScope(projectA)
  const server = createMemoryLaneMcpServer({ engine })
  const listTool = registeredTool(server, "memory_list")

  const projectBResult = memoriesEnvelopeSchema.parse(parseToolJson(await listTool.handler({ projectPath: projectB })))
  const startupResult = memoriesEnvelopeSchema.parse(parseToolJson(await listTool.handler({})))

  assert.deepEqual(projectBResult.data.memories.map((memory) => memory.text), ["Explicit project B read memory"])
  assert.equal(projectBResult.meta.projectScope, "fallback-read-b")
  assert.deepEqual(startupResult.data.memories.map((memory) => memory.text), ["Startup project read memory"])
  assert.equal(startupResult.meta.projectScope, "fallback-read-a")
})

test("fallback registered tool scope resets an omitted mutation to the startup project", async () => {
  const projectA = projectScope("memory-lane-mcp-fallback-mutation-a-", "fallback-mutation-a")
  const projectB = projectScope("memory-lane-mcp-fallback-mutation-b-", "fallback-mutation-b")
  const engine = engineInTemp()
  engine.refreshScope(projectA)
  const server = createMemoryLaneMcpServer({ engine })
  const saveTool = registeredTool(server, "memory_save")
  const listTool = registeredTool(server, "memory_list")

  await saveTool.handler({
    text: "Explicit project B mutation",
    category: "project",
    scope: "project",
    projectPath: projectB,
  })
  await saveTool.handler({
    text: "Omitted path startup mutation",
    category: "project",
    scope: "project",
  })

  const projectBResult = memoriesEnvelopeSchema.parse(parseToolJson(await listTool.handler({ projectPath: projectB })))
  const startupResult = memoriesEnvelopeSchema.parse(parseToolJson(await listTool.handler({ projectPath: projectA })))
  assert.deepEqual(projectBResult.data.memories.map((memory) => memory.text), ["Explicit project B mutation"])
  assert.deepEqual(startupResult.data.memories.map((memory) => memory.text), ["Omitted path startup mutation"])
})

test("fallback registered tool scope serializes deliberately interleaved calls", async () => {
  const projectA = projectScope("memory-lane-mcp-fallback-interleaved-a-", "fallback-interleaved-a")
  const projectB = projectScope("memory-lane-mcp-fallback-interleaved-b-", "fallback-interleaved-b")
  const engine = engineInTemp()
  saveProjectMemory(engine, projectA, "Interleaved startup memory")
  saveProjectMemory(engine, projectB, "Interleaved project B memory")
  engine.refreshScope(projectA)

  const originalRecall = engine.recall.bind(engine)
  const recallStarted = deferred()
  const releaseRecall = deferred()
  engine.recall = async (query, options) => {
    if (query === "Interleaved project B memory") {
      recallStarted.resolve()
      await releaseRecall.promise
    }
    return originalRecall(query, options)
  }

  try {
    const server = createMemoryLaneMcpServer({ engine })
    const projectBRecallPromise = registeredTool(server, "memory_recall").handler({
      query: "Interleaved project B memory",
      projectPath: projectB,
    })
    await recallStarted.promise
    const startupListPromise = registeredTool(server, "memory_list").handler({})
    releaseRecall.resolve()

    const [projectBRecallRaw, startupListRaw] = await Promise.all([projectBRecallPromise, startupListPromise])
    const projectBRecall = memoriesEnvelopeSchema.parse(parseToolJson(projectBRecallRaw))
    const startupList = memoriesEnvelopeSchema.parse(parseToolJson(startupListRaw))
    assert.deepEqual(projectBRecall.data.memories.map((memory) => memory.text), ["Interleaved project B memory"])
    assert.equal(projectBRecall.meta.projectScope, "fallback-interleaved-b")
    assert.deepEqual(startupList.data.memories.map((memory) => memory.text), ["Interleaved startup memory"])
    assert.equal(startupList.meta.projectScope, "fallback-interleaved-a")
  } finally {
    releaseRecall.resolve()
    engine.recall = originalRecall
  }
})

test("fallback registered tool scope restores no scope after an explicit path", async () => {
  const projectB = projectScope("memory-lane-mcp-fallback-none-b-", "fallback-none-b")
  const engine = engineInTemp()
  engine.refreshScope(null)
  const server = createMemoryLaneMcpServer({ engine })
  const statusTool = registeredTool(server, "memory_status")

  const projectBResult = statusEnvelopeSchema.parse(parseToolJson(await statusTool.handler({ projectPath: projectB })))
  const unscopedResult = statusEnvelopeSchema.parse(parseToolJson(await statusTool.handler({})))

  assert.equal(projectBResult.data.status.projectScope, "fallback-none-b")
  assert.equal(projectBResult.meta.projectScope, "fallback-none-b")
  assert.equal(unscopedResult.data.status.projectScope, "none")
  assert.equal(unscopedResult.meta.projectScope, "none")
  assert.ok(unscopedResult.data.notes.some((note) => note.includes("no project scope is active")))
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

test("createMemoryLaneEngine settles cached engines before MCP shutdown", async () => {
  const dir = tempDir("memory-lane-mcp-engine-settle-")
  const home = path.join(dir, "home")
  const startupProject = path.join(dir, "startup-project")
  const callProject = path.join(dir, "call-project")
  fs.mkdirSync(startupProject, { recursive: true })
  fs.mkdirSync(callProject, { recursive: true })

  const { engine, engineForProjectPath, settleEngines } = await createMemoryLaneEngine({ cwd: startupProject, env: { HOME: home } })
  const writableEngine = engineForProjectPath(callProject)
  const settled: string[] = []
  ;(engine as any).settle = async () => { settled.push("startup") }
  ;(writableEngine as any).settle = async () => { settled.push("call-project-old") }

  const configPath = path.join(home, ".memory-lane", "config.json")
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify({ memory: { handoffMode: "manual" } }), "utf8")
  const replacedEngine = engineForProjectPath(callProject)
  assert.notEqual(replacedEngine, writableEngine)
  ;(replacedEngine as any).settle = async () => { settled.push("call-project-new") }

  await settleEngines()

  assert.deepEqual(settled.sort(), ["call-project-new", "call-project-old", "startup"])
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
