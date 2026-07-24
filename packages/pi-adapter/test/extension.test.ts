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

function ompTaskCtx(cwd: string): ExtensionContext {
  const artifactsDir = path.join(cwd, "artifacts")
  return {
    cwd,
    ui: { notify() {} },
    getSystemPrompt: () => ["You are a worker agent for delegated tasks."],
    sessionManager: {
      getSessionFile: () => path.join(artifactsDir, "child.jsonl"),
      getArtifactsDir: () => artifactsDir,
      getBranch: () => [],
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

async function withMockSummaryServer(summary: string | ((requestBody: string, index: number) => string), fn: (baseUrl: string, prompts: string[]) => Promise<void>): Promise<void> {
  const prompts: string[] = []
  const server = http.createServer((req, res) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      prompts.push(body)
      const content = typeof summary === "function" ? summary(body, prompts.length - 1) : summary
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ choices: [{ message: { content } }] }))
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
  assert.ok(pi.tools.has("memory_continuity"))
  assert.ok(pi.tools.has("memory_recall"))
  assert.equal(pi.events.get("input")?.length, 1)
  assert.equal(pi.events.get("turn_end")?.length, 1)
  assert.equal(pi.events.get("tool_result")?.length, 1)
  assert.equal(pi.events.get("before_agent_start")?.length, 1)
  assert.equal(pi.events.get("session_before_compact")?.length, 1)
  assert.equal(pi.events.get("session_compact")?.length, 1)
  assert.equal(pi.events.get("session_switch")?.length, 1)
  assert.equal(pi.events.get("session_shutdown")?.length, 1)
})

test("registers every handwritten Memory Lane tool as essential", () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()

  memoryLaneExtension(pi)

  assert.deepEqual([...pi.tools.keys()], [
    "memory_suggest",
    "memory_revise",
    "memory_save",
    "memory_continuity",
    "memory_recall",
  ])
  for (const tool of pi.tools.values()) {
    assert.equal(tool.loadMode, "essential", `${tool.name} must load in essential mode`)
    assert.equal(typeof tool.execute, "function")
  }
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
  assert.match(result?.message.content ?? "", /### Current project/u)
  assert.match(result?.message.content ?? "", /\*\*Project fact\*\*/u)
  assert.match(result?.message.content ?? "", /This repo uses pnpm test for verification/u)
  assert.equal(result?.message.display, false)
  assert.deepEqual(result?.message.details, {
    source: "memory-lane",
    lifecycleEvent: "user_prompt_submit",
  })
  assert.equal(fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8"), before)
})

test("OMP task-session detection requires nested ownership and delegated-worker role", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const saveTool = pi.tools.get("memory_save")
  await saveTool.execute("tool-1", { text: "This repo uses pnpm test for verification", category: "project" }, undefined, () => {}, baseCtx(env.dir))

  const artifactsDir = path.join(env.dir, "artifacts")
  const nestedSessionFile = path.join(artifactsDir, "child.jsonl")
  const delegatedPrompt = () => ["You are a worker agent for delegated tasks."]
  const ordinaryPrompt = () => ["You are the main coding agent."]
  const contexts: ExtensionContext[] = [
    baseCtx(env.dir),
    {
      ...baseCtx(env.dir),
      sessionManager: {
        getSessionFile: () => path.join(env.dir, "branch.jsonl"),
        getHeader: () => ({ parentSession: "main-session" }),
      },
    },
    {
      ...baseCtx(env.dir),
      getSystemPrompt: ordinaryPrompt,
      sessionManager: {
        getSessionFile: () => nestedSessionFile,
        getArtifactsDir: () => artifactsDir,
      },
    },
    { ...baseCtx(env.dir), getSystemPrompt: delegatedPrompt },
    {
      ...baseCtx(env.dir),
      getSystemPrompt: delegatedPrompt,
      sessionManager: { getArtifactsDir: () => artifactsDir },
    },
    {
      ...baseCtx(env.dir),
      getSystemPrompt: (() => "malformed") as unknown as () => string[],
      sessionManager: {
        getSessionFile: () => nestedSessionFile,
        getArtifactsDir: () => artifactsDir,
      },
    },
    {
      ...baseCtx(env.dir),
      getSystemPrompt: () => { throw new Error("unavailable") },
      sessionManager: {
        getSessionFile: () => { throw new Error("unavailable") },
        getArtifactsDir: () => artifactsDir,
      },
    },
  ]

  for (const ctx of contexts) {
    const result = await runBeforeAgentStart(pi, { prompt: "How do I verify this repo?" }, ctx)
    assert.equal(result?.message.customType, "memory-lane")
  }
  assert.equal(await runBeforeAgentStart(pi, { prompt: "How do I verify this repo?" }, ompTaskCtx(env.dir)), undefined)
})

test("OMP task sessions suppress every automatic lifecycle handler", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const mainCtx = baseCtx(env.dir)
  const taskCtx = ompTaskCtx(env.dir)
  const saveTool = pi.tools.get("memory_save")
  await saveTool.execute("tool-1", { text: "This repo uses pnpm test for verification", category: "project" }, undefined, () => {}, mainCtx)
  const before = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8")

  assert.equal(await runBeforeAgentStart(pi, { prompt: "How do I verify this repo?" }, taskCtx), undefined)
  assert.deepEqual(await runEvent(pi, "input", { source: "interactive", text: "Remember that this repo uses pnpm test" }, taskCtx), { action: "continue" })
  assert.equal(await runEvent(pi, "turn_end", { lastUserMessage: "Remember that this repo uses pnpm test" }, taskCtx), undefined)
  assert.equal(await runEvent(pi, "tool_result", {
    toolName: "bash",
    toolInput: { command: "pnpm test" },
    toolResponse: { exit_code: 0, stdout: "passing" },
  }, taskCtx), undefined)
  assert.equal(await runEvent(pi, "session_before_compact", { reason: "threshold" }, taskCtx), undefined)
  assert.equal(fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8"), before)
})

test("before_agent_start skips greeting prompts", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  const saveTool = pi.tools.get("memory_save")
  await saveTool.execute("tool-1", { text: "This repo uses pnpm test for verification", category: "project" }, undefined, () => {}, ctx)
  const before = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8")

  const result = await runBeforeAgentStart(pi, { prompt: "hi" }, ctx)

  assert.equal(result, undefined)
  assert.equal(fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8"), before)
})

test("before_agent_start injects continuity context for broad prior-work prompts", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  const saveTool = pi.tools.get("memory_save")
  await saveTool.execute("tool-1", { text: "PR #51 merged and v0.2.28 was released after fixing Pi bridge continuity.", category: "project" }, undefined, () => {}, ctx)
  const before = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8")

  const result = await runBeforeAgentStart(pi, { prompt: "What were we last working on?" }, ctx)

  assert.equal(result?.message.customType, "memory-lane")
  assert.match(result?.message.content ?? "", /Memory Lane continuity context/u)
  assert.match(result?.message.content ?? "", /Latest project progress/u)
  assert.match(result?.message.content ?? "", /PR #51 merged/u)
  assert.doesNotMatch(result?.message.content ?? "", /Memory Lane continuity guidance/u)
  assert.equal(result?.message.display, false)
  assert.deepEqual(result?.message.details, {
    source: "memory-lane",
    lifecycleEvent: "user_prompt_submit",
    surface: "continuity",
  })
  assert.equal(fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8"), before)
})

test("memory_continuity tool returns canonical continuity context", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  const saveTool = pi.tools.get("memory_save")
  await saveTool.execute("tool-1", { text: "PR #52 released v0.2.29 with Pi continuity routing.", category: "project" }, undefined, () => {}, ctx)

  const continuityTool = pi.tools.get("memory_continuity")
  const result = await continuityTool.execute("tool-2", { query: "what were we last working on?" }, undefined, () => {}, ctx)

  assert.match(result.content[0].text, /Memory Lane continuity context/u)
  assert.match(result.content[0].text, /Latest project progress/u)
  assert.match(result.content[0].text, /PR #52 released v0\.2\.29/u)
  assert.equal(result.details.projectScope, "pi-test-project")
  assert.match(result.details.latestApproved.project.id, /^[0-9a-f]{32}$/u)
})

test("memory_continuity tool dedupes collapsed operating guidance items", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  const records = [
    { id: "release1", text: "Released v0.2.30 with Pi continuity dogfood complete.", category: "project", scope: { type: "project", key: "pi-test-project" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-25T10:00:00.000Z", updatedAt: "2026-06-25T10:00:00.000Z" },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `guide00${index + 1}`,
      text: `Procedure: use review workflow step ${index + 1} before release.`,
      category: "project",
      scope: { type: "project", key: "pi-test-project" },
      status: "approved",
      source: "manual",
      kind: "procedure",
      createdAt: `2026-06-25T11:0${index}:00.000Z`,
      updatedAt: `2026-06-25T11:0${index}:00.000Z`,
    })),
  ]
  fs.writeFileSync(path.join(env.dir, "memory.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")

  const continuityTool = pi.tools.get("memory_continuity")
  const result = await continuityTool.execute("tool-2", { query: "what were we last working on?" }, undefined, () => {}, ctx)

  assert.equal(result.content[0].text.match(/\[guide005\]/gu)?.length, 1)
  for (const id of ["guide001", "guide002", "guide003", "guide004"]) {
    assert.doesNotMatch(result.content[0].text, new RegExp(`\\[${id}\\]`, "u"))
  }
})

test("memory_continuity tool dedupes rendered ids and promotes actionable warnings", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  const records = [
    { id: "release1", text: "Released v0.2.45 with continuity dogfood complete.", category: "project", scope: { type: "project", key: "pi-test-project" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-26T12:00:00.000Z", updatedAt: "2026-06-26T12:00:00.000Z" },
    { id: "projloop", text: "Project loop workflow: run review before implementation.", category: "project", scope: { type: "project", key: "pi-test-project" }, status: "approved", source: "manual", kind: "procedure", createdAt: "2026-06-26T11:00:00.000Z", updatedAt: "2026-06-26T11:00:00.000Z" },
    { id: "globloop", text: "Global project loop workflow preference: run review before implementation.", category: "preference", scope: { type: "global" }, status: "approved", source: "manual", kind: "workflow_rule", createdAt: "2026-06-26T10:30:00.000Z", updatedAt: "2026-06-26T10:30:00.000Z" },
  ]
  fs.writeFileSync(path.join(env.dir, "memory.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")

  const continuityTool = pi.tools.get("memory_continuity")
  const result = await continuityTool.execute("tool-2", { query: "what should we work on next?" }, undefined, () => {}, ctx)
  const text = result.content[0].text

  assert.equal(text.match(/\[release1\]/gu)?.length, 1)
  assert.equal(text.match(/\[globloop\]/gu)?.length, 1)
  assert.doesNotMatch(text, /Relevant global workflow context: \[globloop\]/u)
  assert.match(text, /Action required before applying continuity guidance:/u)
  assert.match(text, /Inspect: memory-lane agreements --area project-loop --json/u)
  assert.equal(text.match(/memory-lane agreements --area project-loop --json/gu)?.length, 1)
  assert.ok(text.indexOf("Action required before applying continuity guidance:") < text.indexOf("Operating guidance:"))
})

test("memory_continuity tool renders truncated operating guidance inspection instruction", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)
  const filler = "Review workflow requires Opus before design approval and before PR. ".repeat(6)

  const records = [
    { id: "release1", text: "Released v0.2.32 with Pi continuity dogfood complete.", category: "project", scope: { type: "project", key: "pi-test-project" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-26T10:00:00.000Z", updatedAt: "2026-06-26T10:00:00.000Z" },
    { id: "opus001", text: `${filler}Do not summon Opus 4.8 through subagents; invoke it with claude -p --model=claude-opus-4-8 and request high-effort thinking in the prompt.`, category: "preference", scope: { type: "global" }, status: "approved", source: "manual", kind: "workflow_rule", createdAt: "2026-06-26T11:00:00.000Z", updatedAt: "2026-06-26T11:00:00.000Z" },
  ]
  fs.writeFileSync(path.join(env.dir, "memory.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")

  const continuityTool = pi.tools.get("memory_continuity")
  const result = await continuityTool.execute("tool-2", { query: "what should we work on next?" }, undefined, () => {}, ctx)

  assert.match(result.content[0].text, /Operating guidance:/u)
  assert.match(result.content[0].text, /opus001/u)
  assert.doesNotMatch(result.content[0].text, /claude -p --model=claude-opus-4-8/u)
  assert.match(result.content[0].text, /memory-lane show opus001/u)
})


test("memory continuity command returns canonical continuity context", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, { notifications })

  const saveTool = pi.tools.get("memory_save")
  await saveTool.execute("tool-1", { text: "PR #52 released v0.2.29 with Pi continuity routing.", category: "project" }, undefined, () => {}, ctx)
  await runMemoryCommand(pi, "continuity what were we last working on?", ctx)

  assert.match(notifications.at(-1)?.message ?? "", /Memory Lane continuity context/u)
  assert.match(notifications.at(-1)?.message ?? "", /Latest project progress/u)
  assert.match(notifications.at(-1)?.message ?? "", /PR #52 released v0\.2\.29/u)
})

test("memory review defaults to the current project and global scope until --all is explicit", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const records = [
    { id: "current001", text: "CURRENT_PROJECT_PENDING", category: "project", scope: { type: "project", key: "pi-test-project" }, status: "pending", source: "manual", createdAt: "2026-07-10T10:00:00.000Z", updatedAt: "2026-07-10T10:00:00.000Z" },
    { id: "other001", text: "SECRET_OTHER_PROJECT_PENDING", category: "project", scope: { type: "project", key: "other-project" }, status: "pending", source: "manual", createdAt: "2026-07-10T10:01:00.000Z", updatedAt: "2026-07-10T10:01:00.000Z" },
    { id: "global001", text: "GLOBAL_PENDING", category: "preference", scope: { type: "global" }, status: "pending", source: "manual", createdAt: "2026-07-10T10:02:00.000Z", updatedAt: "2026-07-10T10:02:00.000Z" },
  ]
  fs.writeFileSync(path.join(env.dir, "memory.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, { notifications })

  await runMemoryCommand(pi, "review", ctx)

  const scopedReview = notifications.at(-1)?.message ?? ""
  assert.match(scopedReview, /CURRENT_PROJECT_PENDING/u)
  assert.match(scopedReview, /GLOBAL_PENDING/u)
  assert.doesNotMatch(scopedReview, /other001|SECRET_OTHER_PROJECT_PENDING/u)

  await runMemoryCommand(pi, "review --all", ctx)

  assert.match(notifications.at(-1)?.message ?? "", /SECRET_OTHER_PROJECT_PENDING/u)
})

test("memory delete refuses another project's id without leaking its text until --all is explicit", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const records = [
    { id: "other001", text: "SECRET_OTHER_PROJECT_DELETE", category: "project", scope: { type: "project", key: "other-project" }, status: "approved", source: "manual", createdAt: "2026-07-10T11:00:00.000Z", updatedAt: "2026-07-10T11:00:00.000Z" },
  ]
  const originalLog = records.map((record) => JSON.stringify(record)).join("\n") + "\n"
  fs.writeFileSync(path.join(env.dir, "memory.jsonl"), originalLog, "utf8")
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, { notifications })

  await runMemoryCommand(pi, "delete other001", ctx)

  assert.deepEqual(notifications.at(-1), { message: "Memory not found: other001", level: "warning" })
  assert.doesNotMatch(notifications.at(-1)?.message ?? "", /SECRET_OTHER_PROJECT_DELETE/u)
  assert.equal(fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8"), originalLog)

  await runMemoryCommand(pi, "delete other001 --all", ctx)

  assert.deepEqual(notifications.at(-1), { message: "Deleted memory other001", level: "info" })
  const transitions = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
  assert.equal(transitions.at(-1)?.id, "other001")
  assert.equal(transitions.at(-1)?.status, "deleted")
})

test("memory review with null project scope is global-only until --all is explicit", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  fs.rmSync(path.join(env.dir, ".memory-lane-scope"))
  const records = [
    { id: "project001", text: "SECRET_PROJECT_PENDING_WITH_NULL_SCOPE", category: "project", scope: { type: "project", key: "other-project" }, status: "pending", source: "manual", createdAt: "2026-07-10T12:00:00.000Z", updatedAt: "2026-07-10T12:00:00.000Z" },
    { id: "global001", text: "GLOBAL_PENDING_WITH_NULL_SCOPE", category: "preference", scope: { type: "global" }, status: "pending", source: "manual", createdAt: "2026-07-10T12:01:00.000Z", updatedAt: "2026-07-10T12:01:00.000Z" },
  ]
  fs.writeFileSync(path.join(env.dir, "memory.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, { notifications })

  await runMemoryCommand(pi, "review", ctx)

  const globalReview = notifications.at(-1)?.message ?? ""
  assert.match(globalReview, /GLOBAL_PENDING_WITH_NULL_SCOPE/u)
  assert.doesNotMatch(globalReview, /project001|SECRET_PROJECT_PENDING_WITH_NULL_SCOPE/u)

  await runMemoryCommand(pi, "review --all", ctx)

  assert.match(notifications.at(-1)?.message ?? "", /SECRET_PROJECT_PENDING_WITH_NULL_SCOPE/u)
})

test("memory delete with null project scope requires explicit --all for a project memory", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  fs.rmSync(path.join(env.dir, ".memory-lane-scope"))
  const records = [
    { id: "project001", text: "SECRET_PROJECT_DELETE_WITH_NULL_SCOPE", category: "project", scope: { type: "project", key: "other-project" }, status: "approved", source: "manual", createdAt: "2026-07-10T13:00:00.000Z", updatedAt: "2026-07-10T13:00:00.000Z" },
  ]
  const originalLog = records.map((record) => JSON.stringify(record)).join("\n") + "\n"
  fs.writeFileSync(path.join(env.dir, "memory.jsonl"), originalLog, "utf8")
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, { notifications })

  await runMemoryCommand(pi, "delete project001", ctx)

  assert.deepEqual(notifications.at(-1), { message: "Memory not found: project001", level: "warning" })
  assert.equal(fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8"), originalLog)

  await runMemoryCommand(pi, "delete project001 --all", ctx)

  assert.deepEqual(notifications.at(-1), { message: "Deleted memory project001", level: "info" })
})

test("memory usage documents explicit all-scope review and delete flags", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, { notifications })

  await runMemoryCommand(pi, "help", ctx)

  const usage = notifications.at(-1)?.message ?? ""
  assert.match(usage, /delete <id> \[--all\]/u)
  assert.match(usage, /review \[--all\]/u)
})

test("input ignores implicit durable statements", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  await runEvent(pi, "input", { text: "This repo uses pnpm test" }, ctx)

  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
})

test("input saves explicit memory requests", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  await runEvent(pi, "input", { text: "Remember that this repo uses pnpm test" }, ctx)

  const lines = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n")
  assert.equal(lines.length, 1)
  const mem = JSON.parse(lines[0])
  assert.equal(mem.text, "this repo uses pnpm test")
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

test("session_before_compact skips summarization when confirmation is required", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  await withMockSummaryServer("## Decisions made\n- SHOULD_NOT_SAVE.", async (baseUrl, prompts) => {
    fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
      semantic: { enabled: false },
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-summary", requireConfirmation: true } },
    }))
    const pi = createFakePi()
    memoryLaneExtension(pi)
    const notifications: FakeNotification[] = []
    const ctx = ctxWithUi(env.dir, { notifications })

    const result = await runEvent(pi, "session_before_compact", {
      reason: "threshold",
      turnId: "turn-compact",
      preparation: {
        messagesToSummarize: [{ role: "user", content: [{ type: "text", text: "RAW_PI_PRECOMPACT_USER" }] }],
        turnPrefixMessages: [],
      },
    }, ctx)

    assert.equal(result, undefined)
    assert.equal(prompts.length, 0)
    assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
    assert.equal(notifications.length, 0)
  })
})

test("session_before_compact saves pending pi summary without overriding compaction", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  await withMockSummaryServer("## Decisions made\n- Pi pre-compact summary survived.", async (baseUrl, prompts) => {
    fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
      semantic: { enabled: false },
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-summary", requireConfirmation: false } },
    }))
    const pi = createFakePi()
    memoryLaneExtension(pi)
    const notifications: FakeNotification[] = []
    const ctx = ctxWithUi(env.dir, { notifications })

    const result = await runEvent(pi, "session_before_compact", {
      reason: "threshold",
      turnId: "turn-compact",
      preparation: {
        messagesToSummarize: [
          { role: "user", content: [{ type: "text", text: "RAW_PI_PRECOMPACT_USER" }] },
          { role: "assistant", content: [{ type: "text", text: "Durable pi compaction outcome." }] },
        ],
        turnPrefixMessages: [],
      },
    }, ctx)

    assert.equal(result, undefined)
    assert.equal(prompts.length, 1)
    const rawMemory = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8")
    assert.doesNotMatch(rawMemory, /RAW_PI_PRECOMPACT_USER/)
    const mem = JSON.parse(rawMemory.trim())
    assert.equal(mem.status, "pending")
    assert.equal(mem.source, "session-summary")
    assert.equal(mem.kind, "decision")
    assert.ok(mem.provenance.sourceSummaryId)
    assert.equal(mem.provenance.adapter, "pi")
    assert.equal(mem.provenance.lifecycleEvent, "pre_compact")
    assert.equal(mem.provenance.turnId, "turn-compact")
    assert.match(mem.text, /Pi pre-compact summary survived/)
    assert.ok(notifications.some((n) => n.message.includes("pending memory suggestion")))

    await runEvent(pi, "session_compact", { compactionEntry: { summary: "SHOULD_NOT_DUPLICATE" } }, ctx)
    assert.equal(prompts.length, 1)
    assert.equal(fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n").length, 1)
  })
})

test("lossy split-turn compaction defers to the host summary without leaking tool or reasoning content", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  await withMockSummaryServer("## Checkpoints\n- Completed issue #215 implementation and verification.", async (baseUrl, prompts) => {
    fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
      semantic: { enabled: false },
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-summary", requireConfirmation: false } },
    }))
    const pi = createFakePi()
    memoryLaneExtension(pi)
    const ctx = ctxWithUi(env.dir)

    await runEvent(pi, "session_before_compact", {
      reason: "threshold",
      turnId: "active-split-turn",
      preparation: {
        messagesToSummarize: [
          { role: "user", content: [{ type: "text", text: "Implement issue #215." }] },
          { role: "assistant", content: [{ type: "thinking", thinking: "HIDDEN_REASONING_SENTINEL" }, { type: "toolCall", name: "bash", arguments: { command: "RAW_TOOL_COMMAND_SENTINEL" } }] },
          { role: "toolResult", content: [{ type: "text", text: "RAW_TOOL_OUTPUT_SENTINEL" }] },
        ],
        turnPrefixMessages: [],
      },
    }, ctx)

    assert.equal(prompts.length, 0)
    assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)

    await runEvent(pi, "session_compact", {
      compactionEntry: {
        summary: "## Turn Context\nImplementation and verification for issue #215 completed. The scope is known and all focused tests passed.",
      },
    }, ctx)

    assert.equal(prompts.length, 1)
    assert.match(prompts[0], /Implementation and verification for issue #215 completed/u)
    assert.doesNotMatch(prompts[0], /HIDDEN_REASONING_SENTINEL|RAW_TOOL_COMMAND_SENTINEL|RAW_TOOL_OUTPUT_SENTINEL/u)
    const records = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
    assert.equal(records.length, 1)
    assert.match(records[0].text, /Completed issue #215 implementation and verification/u)
    assert.doesNotMatch(records[0].text, /scope is unknown|HIDDEN_REASONING_SENTINEL|RAW_TOOL/iu)
  })
})

test("lossy split-turn compaction fails open without saving on a legacy host", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  await withMockSummaryServer("## Checkpoints\n- SHOULD_NOT_SAVE.", async (baseUrl, prompts) => {
    fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
      semantic: { enabled: false },
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-summary", requireConfirmation: false } },
    }))
    const pi = createFakePi()
    memoryLaneExtension(pi)
    await runEvent(pi, "session_before_compact", {
      reason: "threshold",
      turnId: "legacy-lossy-turn",
      preparation: {
        messagesToSummarize: [
          { role: "user", content: [{ type: "text", text: "Implement the issue." }] },
          { role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "private" } }] },
        ],
      },
    }, ctxWithUi(env.dir))

    assert.equal(prompts.length, 0)
    assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
  })
})

test("deferred split-turn state clears on cancellation, session switch, and shutdown", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  await withMockSummaryServer("## Checkpoints\n- SHOULD_NOT_SAVE.", async (baseUrl, prompts) => {
    fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
      semantic: { enabled: false },
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-summary", requireConfirmation: false } },
    }))

    for (const clearEvent of ["session_compact", "session_switch", "session_shutdown"]) {
      const pi = createFakePi()
      memoryLaneExtension(pi)
      const ctx = ctxWithUi(env.dir)
      await runEvent(pi, "session_before_compact", {
        reason: "threshold",
        turnId: `lossy-${clearEvent}`,
        preparation: { messagesToSummarize: [{ role: "assistant", content: [{ type: "toolCall", name: "bash" }] }] },
      }, ctx)
      await runEvent(pi, clearEvent, {}, ctx)
      await runEvent(pi, "session_compact", { compactionEntry: { summary: "LATE_SUMMARY_SHOULD_NOT_SAVE" } }, ctx)
    }

    assert.equal(prompts.length, 0)
    assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
  })
})

test("session switch clears only the switched session's deferred split-turn state", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  await withMockSummaryServer("## Checkpoints\n- Issue #302 completed for session B.", async (baseUrl, prompts) => {
    fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
      semantic: { enabled: false },
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-summary", requireConfirmation: false } },
    }))
    const pi = createFakePi()
    memoryLaneExtension(pi)
    const context = (id: string): ExtensionContext => ({
      ...ctxWithUi(env.dir),
      sessionManager: { getSessionFile: () => path.join(env.dir, `${id}.jsonl`) },
    })
    const ctxA = context("session-a")
    const ctxB = context("session-b")
    const lossy = (turnId: string) => ({
      reason: "threshold",
      turnId,
      preparation: { messagesToSummarize: [{ role: "assistant", content: [{ type: "toolCall", name: "bash" }] }] },
    })

    await runEvent(pi, "session_before_compact", lossy("turn-a"), ctxA)
    await runEvent(pi, "session_before_compact", lossy("turn-b"), ctxB)
    await runEvent(pi, "session_switch", {}, ctxA)
    await runEvent(pi, "session_compact", { compactionEntry: { summary: "SESSION_B_COMPLETE" } }, ctxB)
    await runEvent(pi, "session_compact", { compactionEntry: { summary: "SESSION_A_MUST_NOT_SAVE" } }, ctxA)

    assert.equal(prompts.length, 1)
    const records = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
    assert.equal(records.length, 1)
    assert.equal(records[0].provenance.sessionId, path.join(env.dir, "session-b.jsonl"))
  })
})

test("deferred split-turn state is isolated by concurrent session id", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  await withMockSummaryServer((body) => body.includes("SESSION_A_COMPLETE")
    ? "## Checkpoints\n- Issue #301 completed for session A."
    : "## Checkpoints\n- Issue #302 completed for session B.", async (baseUrl, prompts) => {
    fs.writeFileSync(path.join(env.dir, "config.json"), JSON.stringify({
      semantic: { enabled: false },
      memory: { sessionEndSummary: { enabled: true, baseUrl, model: "mock-summary", requireConfirmation: false } },
    }))
    const pi = createFakePi()
    memoryLaneExtension(pi)
    const context = (id: string): ExtensionContext => ({
      ...ctxWithUi(env.dir),
      sessionManager: { getSessionFile: () => path.join(env.dir, `${id}.jsonl`) },
    })
    const ctxA = context("session-a")
    const ctxB = context("session-b")
    const lossy = (turnId: string) => ({
      reason: "threshold",
      turnId,
      preparation: { messagesToSummarize: [{ role: "assistant", content: [{ type: "toolCall", name: "bash" }] }] },
    })

    await runEvent(pi, "session_before_compact", lossy("turn-a"), ctxA)
    await runEvent(pi, "session_before_compact", lossy("turn-b"), ctxB)
    await runEvent(pi, "session_compact", { compactionEntry: { summary: "SESSION_B_COMPLETE" } }, ctxB)
    await runEvent(pi, "session_compact", { compactionEntry: { summary: "SESSION_A_COMPLETE" } }, ctxA)

    assert.equal(prompts.length, 2)
    const records = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
    assert.equal(records.length, 2)
    assert.deepEqual(new Set(records.map((record) => record.provenance.sessionId)), new Set([
      path.join(env.dir, "session-a.jsonl"),
      path.join(env.dir, "session-b.jsonl"),
    ]))
  })
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
    assert.equal(mem.kind, "decision")
    assert.ok(mem.provenance.sourceSummaryId)
    assert.equal(mem.provenance.adapter, "pi")
    assert.equal(mem.provenance.lifecycleEvent, "session_end")
    assert.equal(mem.provenance.sessionId, path.join(env.dir, ".pi-session.jsonl"))
    assert.match(mem.text, /Provider summary survived/)
    assert.ok(notifications.some((n) => n.message === "Saved 1 pending session summary. Run /memory review to inspect."))
  })
})

test("memory session-summary pluralizes multiple pending pi session summaries", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  await withMockSummaryServer("## Decisions made\n- First provider summary survived.\n- Second provider summary survived.", async (baseUrl) => {
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
        { type: "message", message: { role: "user", content: [{ type: "text", text: "Summarize both durable decisions." }] } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Both decisions are ready to summarize." }] } },
      ],
    })

    await runMemoryCommand(pi, "session-summary", ctx)

    const records = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8").trim().split("\n")
    assert.equal(records.length, 2)
    assert.ok(notifications.some((n) => n.message === "Saved 2 pending session summaries. Run /memory review to inspect."))
    assert.ok(notifications.every((n) => !n.message.includes("summaryies")))
  })
})

test("automatic lifecycle writes emit one batched count-only pending-review notification", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, { notifications })

  await runEvent(pi, "turn_end", {
    turnId: "notice-turn",
    lastUserMessage: "This project released v4.5.6 with the durable retry invariant documented for future deploys.",
  }, ctx)
  await runEvent(pi, "tool_result", {
    turnId: "notice-turn",
    toolName: "bash",
    toolInput: { command: "pnpm test" },
    toolResponse: { exit_code: 0, stdout: "passing" },
  }, ctx)
  await new Promise((resolve) => setTimeout(resolve, 100))

  const notices = notifications.filter((item) => item.message.includes("pending memory suggestion"))
  assert.equal(notices.length, 1)
  assert.match(notices[0]?.message ?? "", /queued 2 pending memory suggestions for review/u)
  assert.match(notices[0]?.message ?? "", /\/memory review/u)
  assert.doesNotMatch(notices[0]?.message ?? "", /released|pnpm|Auto-saved/iu)
})

test("suppressed automatic lifecycle candidates stay notification-quiet", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const notifications: FakeNotification[] = []
  const ctx = ctxWithUi(env.dir, { notifications })

  await runEvent(pi, "tool_result", {
    turnId: "quiet-turn",
    toolName: "bash",
    toolInput: { command: "gh release create v4.5.6" },
    toolResponse: { exit_code: 0, stdout: "created" },
  }, ctx)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(notifications.length, 0)
})
