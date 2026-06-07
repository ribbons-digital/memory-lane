import * as assert from "node:assert/strict"
import * as fs from "node:fs"
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

async function runBeforeAgentStart(pi: FakePi, event: any, ctx: ExtensionContext): Promise<any> {
  const handlers = pi.events.get("before_agent_start") ?? []
  assert.equal(handlers.length, 1)
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

  assert.deepEqual(result, {
    message: {
      customType: "memory-lane",
      content: "## Relevant Memory\n\n- This repo uses pnpm test for verification",
      display: false,
      details: {
        source: "memory-lane",
        lifecycleEvent: "user_prompt_submit",
      },
    },
  })
  assert.equal(fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8"), before)
})
