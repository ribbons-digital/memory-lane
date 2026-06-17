import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, test } from "node:test"
import memoryLaneExtension, { type ExtensionAPI, type ExtensionContext } from "../src/index.js"

type EventHandler = (event: any, ctx: ExtensionContext) => Promise<any> | any

interface FakePi extends ExtensionAPI {
  commands: Map<string, any>
  tools: Map<string, any>
  events: Map<string, EventHandler[]>
}

function createFakePi(): FakePi {
  const commands = new Map<string, any>()
  const tools = new Map<string, any>()
  const events = new Map<string, EventHandler[]>()

  return {
    commands,
    tools,
    events,
    registerCommand(name, handler) {
      commands.set(name, handler)
    },
    registerTool(tool) {
      tools.set(tool.name, tool)
    },
    on(event, handler) {
      const handlers = events.get(event) ?? []
      handlers.push(handler)
      events.set(event, handlers)
    },
  }
}

function makeTempEnv(): { dir: string; restore: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-pi-test-"))
  const previous = {
    MEMORY_LANE_FILE: process.env.MEMORY_LANE_FILE,
    MEMORY_LANE_EMBEDDINGS_FILE: process.env.MEMORY_LANE_EMBEDDINGS_FILE,
    MEMORY_LANE_CONFIG: process.env.MEMORY_LANE_CONFIG,
    PI_MEMORY_FILE: process.env.PI_MEMORY_FILE,
    PI_MEMORY_EMBEDDINGS_FILE: process.env.PI_MEMORY_EMBEDDINGS_FILE,
    PI_MEMORY_CONFIG_FILE: process.env.PI_MEMORY_CONFIG_FILE,
  }

  process.env.PI_MEMORY_FILE = path.join(dir, "memory.jsonl")
  process.env.PI_MEMORY_EMBEDDINGS_FILE = path.join(dir, "embeddings.jsonl")
  process.env.PI_MEMORY_CONFIG_FILE = path.join(dir, "config.json")
  delete process.env.MEMORY_LANE_FILE
  delete process.env.MEMORY_LANE_EMBEDDINGS_FILE
  delete process.env.MEMORY_LANE_CONFIG
  fs.writeFileSync(process.env.PI_MEMORY_CONFIG_FILE, JSON.stringify({ semantic: { enabled: false } }))
  fs.writeFileSync(path.join(dir, ".memory-lane-scope"), JSON.stringify({ id: "pi-test-project" }))

  return {
    dir,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

function baseCtx(cwd: string): ExtensionContext {
  return {
    cwd,
    ui: { notify() {} },
    sessionManager: {
      getSessionFile: () => path.join(cwd, ".pi-session.jsonl"),
    },
  }
}

type FakeNotification = { message: string; level?: "info" | "warning" | "error" }

type FakeBranchEntry = {
  type: string
  message?: {
    role?: string
    content?: unknown
  }
}

function ctxWithUi(cwd: string, options: {
  confirmResult?: boolean
  includeConfirm?: boolean
  branch?: FakeBranchEntry[]
  notifications?: FakeNotification[]
} = {}): ExtensionContext {
  const notifications = options.notifications ?? []
  const ui: {
    notify(message: string, level?: "info" | "warning" | "error"): void
    confirm?: () => Promise<boolean>
  } = {
    notify(message: string, level?: "info" | "warning" | "error") {
      notifications.push({ message, level })
    },
  }
  if (options.includeConfirm !== false) {
    ui.confirm = async () => options.confirmResult ?? false
  }
  return {
    cwd,
    ui,
    sessionManager: {
      getSessionFile: () => path.join(cwd, ".pi-session.jsonl"),
      getBranch: () => options.branch ?? [],
    },
  } as ExtensionContext
}

async function runMemoryCommand(pi: FakePi, args: string, ctx: ExtensionContext): Promise<void> {
  const command = pi.commands.get("memory")
  assert.ok(command)
  await command.handler(args, ctx)
}

async function withMockSummaryServer(summary: string, fn: (baseUrl: string, prompts: string[]) => Promise<void>): Promise<void> {
  const prompts: string[] = []
  const server = http.createServer((req, res) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      prompts.push(body)
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ choices: [{ message: { content: summary } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  try {
    await fn(`http://127.0.0.1:${address.port}/v1`, prompts)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  }
}

async function runBeforeAgentStart(pi: FakePi, event: any, ctx: ExtensionContext): Promise<any> {
  const handlers = pi.events.get("before_agent_start") ?? []
  assert.equal(handlers.length, 1)
  return handlers[0](event, ctx)
}

async function runEvent(pi: FakePi, eventName: string, event: any, ctx: ExtensionContext): Promise<any> {
  const handlers = pi.events.get(eventName) ?? []
  if (handlers.length === 0) return undefined
  return handlers[0](event, ctx)
}

let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

test("registers pi commands tools input and before_agent_start handlers", () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()

  memoryLaneExtension(pi)

  assert.ok(pi.commands.has("remember"))
  assert.ok(pi.commands.has("memory"))
  assert.ok(pi.tools.has("memory_save"))
  assert.ok(pi.tools.has("memory_suggest"))
  assert.ok(pi.tools.has("memory_recall"))
  assert.equal(pi.events.get("input")?.length, 1)
  assert.equal(pi.events.get("turn_end")?.length, 1)
  assert.equal(pi.events.get("tool_result")?.length, 1)
  assert.equal(pi.events.get("before_agent_start")?.length, 1)
})

test("before_agent_start returns nothing when no relevant memory exists", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)

  const result = await runBeforeAgentStart(pi, { prompt: "How should I run tests?" }, baseCtx(env.dir))

  assert.equal(result, undefined)
  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
})

test("before_agent_start injects shared lifecycle memory block for relevant approved memory", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  const saveTool = pi.tools.get("memory_save")
  await saveTool.execute("tool-1", { text: "This repo uses pnpm test for verification", category: "project" }, undefined, () => {}, ctx)
  const before = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8")

  const result = await runBeforeAgentStart(pi, { prompt: "How do I verify this repo?" }, ctx)

  assert.equal(result?.message.customType, "memory-lane")
  assert.match(result?.message.content ?? "", /<memory-context mode="selective" event="prompt">/)
  assert.match(result?.message.content ?? "", /This repo uses pnpm test for verification/u)
  assert.equal(result?.message.display, false)
  assert.deepEqual(result?.message.details, {
    source: "memory-lane",
    lifecycleEvent: "user_prompt_submit",
  })
  assert.equal(fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8"), before)
})

test("input auto-save delegates to shared lifecycle filtering", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  await runEvent(pi, "input", { text: "This repo uses pnpm test" }, ctx)

  const lines = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n")
  assert.equal(lines.length, 1)
  const mem = JSON.parse(lines[0])
  assert.equal(mem.text, "This repo uses pnpm test")
})

test("input filters questions through shared lifecycle", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  await runEvent(pi, "input", { text: "How do I run tests?" }, ctx)

  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
})

test("turn_end saves stop candidates from the last user message", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  await runEvent(pi, "turn_end", { lastUserMessage: "This repo uses pnpm test for verification" }, ctx)

  const lines = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n")
  assert.equal(lines.length, 1)
  const mem = JSON.parse(lines[0])
  assert.equal(mem.text, "This repo uses pnpm test for verification")
})

test("tool_result saves successful pnpm test workflow memory", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  await runEvent(pi, "tool_result", {
    toolName: "bash",
    toolInput: { command: "pnpm test" },
    toolResponse: { exit_code: 0, stdout: "passing" },
  }, ctx)

  const lines = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n")
  assert.equal(lines.length, 1)
  const mem = JSON.parse(lines[0])
  assert.equal(mem.text, "`pnpm test` is the test command for this repo.")
})

test("duplicate saves across input and turn_end are suppressed", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  await runEvent(pi, "input", { text: "This repo uses pnpm test", turnId: "t1" }, ctx)
  await runEvent(pi, "turn_end", { lastUserMessage: "This repo uses pnpm test", turnId: "t1" }, ctx)

  const lines = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n")
  assert.equal(lines.length, 1)
})

test("memory session-summary reports disabled summarization without saving", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, {
    confirmResult: true,
    notifications,
    branch: [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "Summarize this later" }] } },
    ],
  })

  await runMemoryCommand(pi, "session-summary", ctx)

  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
  assert.ok(notifications.some((n) => n.message.includes("Session-end summarization is not enabled")))
})

test("memory summarize-session reports disabled summarization without saving", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, {
    confirmResult: true,
    notifications,
    branch: [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "Summarize this later" }] } },
    ],
  })

  await runMemoryCommand(pi, "summarize-session", ctx)

  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
  assert.ok(notifications.some((n) => n.message.includes("Session-end summarization is not enabled")))
})

test("memory session-summary reports missing provider before confirmation", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
    semantic: { enabled: false },
    memory: { sessionEndSummary: { enabled: true, requireConfirmation: false } },
  }))
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  let confirmCalled = false
  const ctx = ctxWithUi(env.dir, {
    notifications,
    branch: [{ type: "message", message: { role: "user", content: [{ type: "text", text: "Important decision" }] } }],
  }) as any
  ctx.ui.confirm = async () => { confirmCalled = true; return true }

  await runMemoryCommand(pi, "session-summary", ctx)

  assert.equal(confirmCalled, false)
  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
  assert.ok(notifications.some((n) => n.message.includes("baseUrl") && n.message.includes("model")))
})

test("memory session-summary reports empty branch without saving", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
    semantic: { enabled: false },
    memory: { sessionEndSummary: { enabled: true, baseUrl: "http://127.0.0.1:9/v1", model: "mock" } },
  }))
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, { confirmResult: true, notifications, branch: [] })

  await runMemoryCommand(pi, "session-summary", ctx)

  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
  assert.ok(notifications.some((n) => n.message.includes("No conversation text found")))
})

test("memory session-summary requires interactive confirmation", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
    semantic: { enabled: false },
    memory: { sessionEndSummary: { enabled: true, baseUrl: "http://127.0.0.1:9/v1", model: "mock" } },
  }))
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, {
    includeConfirm: false,
    notifications,
    branch: [{ type: "message", message: { role: "user", content: [{ type: "text", text: "Important decision" }] } }],
  })

  await runMemoryCommand(pi, "session-summary", ctx)

  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
  assert.ok(notifications.some((n) => n.message.includes("requires interactive confirmation")))
})

test("memory session-summary cancellation saves nothing", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
    semantic: { enabled: false },
    memory: { sessionEndSummary: { enabled: true, baseUrl: "http://127.0.0.1:9/v1", model: "mock" } },
  }))
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, {
    confirmResult: false,
    notifications,
    branch: [{ type: "message", message: { role: "user", content: [{ type: "text", text: "Important decision" }] } }],
  })

  await runMemoryCommand(pi, "session-summary", ctx)

  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
  assert.ok(notifications.some((n) => n.message.includes("cancelled")))
})

test("memory session-summary saves pending pi session summary without raw branch text", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  await withMockSummaryServer("## Decisions made\n- Provider summary survived.", async (baseUrl, prompts) => {
    fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
      semantic: { enabled: false },
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-summary" } },
    }))
    const pi = createFakePi()
    memoryLaneExtension(pi)
    const notifications: FakeNotification[] = []
    const ctx = ctxWithUi(env.dir, {
      confirmResult: true,
      notifications,
      branch: [
        { type: "message", message: { role: "user", content: [{ type: "text", text: "RAW_USER_SENTINEL remember this" }] } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "RAW_ASSISTANT_SENTINEL acknowledged" }] } },
        { type: "message", message: { role: "tool", content: [{ type: "text", text: "RAW_TOOL_SENTINEL" }] } },
      ],
    })

    await runMemoryCommand(pi, "session-summary", ctx)

    assert.equal(prompts.length, 1)
    const rawMemory = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8")
    assert.doesNotMatch(rawMemory, /RAW_USER_SENTINEL|RAW_ASSISTANT_SENTINEL|RAW_TOOL_SENTINEL/)
    const lines = rawMemory.trim().split("\n")
    assert.equal(lines.length, 1)
    const mem = JSON.parse(lines[0])
    assert.equal(mem.status, "pending")
    assert.equal(mem.source, "session-summary")
    assert.equal(mem.kind, "session_summary")
    assert.equal(mem.provenance.adapter, "pi")
    assert.equal(mem.provenance.lifecycleEvent, "session_end")
    assert.equal(mem.provenance.sessionId, path.join(env.dir, ".pi-session.jsonl"))
    assert.match(mem.text, /Provider summary survived/)
    assert.ok(notifications.some((n) => n.message.includes("Saved 1 pending session summary")))
  })
})
