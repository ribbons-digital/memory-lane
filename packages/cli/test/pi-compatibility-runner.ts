import * as fs from "node:fs"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { piAdapterImportSource, piCliBridgeSource } from "../src/installer/config.js"

export const PINNED_PI_VERSION = "0.81.1"
export const ESSENTIAL_TOOL_ALLOWLIST = ["memory_save"] as const
export type PiSourceForm = "adapter" | "bridge"

type RpcFrame = Record<string, unknown> & { type?: string; id?: string }
type Registration = { name: string; loadMode?: string }
type ProviderRequest = { toolNames: string[]; roles: string[] }

export const EXPECTED_PI_TOOLS: Record<PiSourceForm, readonly string[]> = {
  adapter: ["memory_suggest", "memory_revise", "memory_save", "memory_continuity", "memory_recall"],
  bridge: ["memory_save", "memory_suggest", "memory_revise", "memory_continuity", "memory_recall", "memory_get"],
}
export const EXPECTED_PI_LIFECYCLE_EVENTS = [
  "before_agent_start",
  "session_before_compact",
  "session_compact",
  "session_switch",
  "session_shutdown",
  "input",
  "turn_end",
  "tool_result",
] as const

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function parseFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function commandOutput(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): string {
  const result = spawnSync(command, args, { encoding: "utf8", env: options.env, cwd: options.cwd })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || `${command} exited with ${result.status}`)
  return result.stdout.trim()
}

export function validatePiVersion(versionOutput: string): void {
  if (versionOutput.trim() !== PINNED_PI_VERSION) {
    throw new Error(`Pi compatibility requires exact ${PINNED_PI_VERSION}; received ${versionOutput.trim() || "no version output"}`)
  }
}

export function isolatedPiEnvironment(base: NodeJS.ProcessEnv, scratch: {
  homeDir: string
  agentDir: string
  configDir: string
  cacheDir: string
  dataDir: string
  memoryPath: string
  embeddingsPath: string
  memoryConfigPath: string
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    HOME: scratch.homeDir,
    PI_CODING_AGENT_DIR: scratch.agentDir,
    XDG_CONFIG_HOME: scratch.configDir,
    XDG_CACHE_HOME: scratch.cacheDir,
    XDG_DATA_HOME: scratch.dataDir,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    MEMORY_LANE_FILE: scratch.memoryPath,
    MEMORY_LANE_EMBEDDINGS_FILE: scratch.embeddingsPath,
    MEMORY_LANE_CONFIG: scratch.memoryConfigPath,
    PI_MEMORY_FILE: scratch.memoryPath,
    PI_MEMORY_EMBEDDINGS_FILE: scratch.embeddingsPath,
    PI_MEMORY_CONFIG_FILE: scratch.memoryConfigPath,
  }
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete env[key]
  env.NO_PROXY = "127.0.0.1,localhost"
  env.no_proxy = env.NO_PROXY
  return env
}

export function piRpcCommandPlan(options: {
  executable: string
  extensionPath: string
  sessionDir: string
}): { command: string; args: string[] } {
  return {
    command: options.executable,
    args: [
      "--mode", "rpc",
      "--session-dir", options.sessionDir,
      "--no-extensions",
      "--extension", options.extensionPath,
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--approve",
      "--provider", "memory-lane-compat",
      "--model", "compat-model",
      "--tools", ESSENTIAL_TOOL_ALLOWLIST.join(","),
      "--thinking", "off",
    ],
  }
}

function wrapperSource(targetPath: string, logPath: string, providerBaseUrl: string): string {
  return `import * as fs from "node:fs"

const TARGET = ${JSON.stringify(pathToFileURL(targetPath).href)}
const LOG = ${JSON.stringify(logPath)}
const PROVIDER_BASE_URL = ${JSON.stringify(providerBaseUrl)}

function record(value) {
  fs.appendFileSync(LOG, JSON.stringify(value) + "\\n")
}

export default async function memoryLanePiCompatibility(api) {
  api.registerProvider("memory-lane-compat", {
    baseUrl: PROVIDER_BASE_URL,
    apiKey: "pi-compatibility-loopback-only",
    api: "openai-completions",
    models: [{
      id: "compat-model",
      name: "Memory Lane Pi Compatibility Model",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 256,
    }],
  })

  const mod = await import(TARGET + "?compat=" + Date.now())
  const factory = typeof mod.default === "function" ? mod.default : mod.default?.default
  if (typeof factory !== "function") throw new Error("Memory Lane extension factory missing")
  const proxy = new Proxy(api, {
    get(target, property, receiver) {
      if (property === "registerTool") return (tool) => {
        record({ kind: "registration", name: tool?.name, loadMode: tool?.loadMode })
        return target.registerTool(tool)
      }
      if (property === "on") return (eventName, handler) => {
        record({ kind: "lifecycle-registration", name: eventName })
        return target.on(eventName, handler)
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  await factory(proxy)

  api.on("before_agent_start", (event) => {
    record({
      kind: "selection",
      activeTools: api.getActiveTools(),
      allTools: api.getAllTools().map((tool) => tool.name),
      selectedTools: event?.systemPromptOptions?.selectedTools ?? [],
    })
  })
}
`
}

class RpcSession {
  readonly child: ChildProcessWithoutNullStreams
  readonly frames: RpcFrame[] = []
  readonly stderr: string[] = []
  #waiters = new Set<() => void>()

  constructor(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) {
    this.child = spawn(command, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] })
    this.child.stdout.setEncoding("utf8")
    this.child.stderr.setEncoding("utf8")
    let stdout = ""
    this.child.stdout.on("data", (chunk: string) => {
      stdout += chunk
      for (;;) {
        const newline = stdout.indexOf("\n")
        if (newline < 0) break
        const line = stdout.slice(0, newline).trim()
        stdout = stdout.slice(newline + 1)
        if (!line) continue
        try { this.frames.push(JSON.parse(line) as RpcFrame) } catch { this.frames.push({ type: "unparsed", line }) }
        for (const wake of this.#waiters) wake()
      }
    })
    this.child.stderr.on("data", (chunk: string) => this.stderr.push(chunk))
  }

  send(frame: RpcFrame): void {
    this.child.stdin.write(`${JSON.stringify(frame)}\n`)
  }

  async waitFor(predicate: (frame: RpcFrame) => boolean, timeoutMs = 60_000): Promise<RpcFrame> {
    const existing = this.frames.find(predicate)
    if (existing) return existing
    const pending = deferred<RpcFrame>()
    let timer: NodeJS.Timeout
    const wake = () => {
      const found = this.frames.find(predicate)
      if (!found) return
      clearTimeout(timer)
      this.#waiters.delete(wake)
      pending.resolve(found)
    }
    timer = setTimeout(() => {
      this.#waiters.delete(wake)
      const recent = this.frames.slice(-10).map((frame) => `${frame.type ?? "unknown"}:${frame.id ?? ""}`).join(", ")
      pending.reject(new Error(`Timed out waiting for Pi RPC frame. recent frames: ${recent || "none"}; stderr: ${this.stderr.join("").trim()}`))
    }, timeoutMs)
    this.#waiters.add(wake)
    this.child.once("exit", (code) => {
      if (this.frames.find(predicate)) return
      clearTimeout(timer)
      this.#waiters.delete(wake)
      pending.reject(new Error(`Pi RPC exited with ${code}. stderr: ${this.stderr.join("").trim()}`))
    })
    return pending.promise
  }

  async initialize(): Promise<void> {
    this.send({ id: "state", type: "get_state" })
    const response = await this.waitFor((frame) => frame.type === "response" && frame.id === "state")
    if (response.success !== true) throw new Error(`Pi RPC startup failed: ${String(response.error ?? "unknown error")}`)
  }

  async prompt(message: string): Promise<RpcFrame[]> {
    const start = this.frames.length
    this.send({ id: "save", type: "prompt", message })
    const accepted = await this.waitFor((frame) => frame.type === "response" && frame.id === "save")
    if (accepted.success !== true) throw new Error(`Pi RPC prompt was rejected: ${String(accepted.error ?? "unknown error")}`)
    await this.waitFor((frame) => this.frames.indexOf(frame) >= start && frame.type === "agent_settled")
    const turn = this.frames.slice(start)
    const failed = turn.find((frame) => frame.type === "message_end"
      && frame.message && typeof frame.message === "object"
      && !Array.isArray(frame.message)
      && (frame.message as Record<string, unknown>).stopReason === "error")
    if (failed) throw new Error(`Pi model turn failed: ${JSON.stringify(failed).slice(0, 1_000)}`)
    return turn
  }

  async close(): Promise<void> {
    this.child.stdin.end()
    if (this.child.exitCode !== null) return
    const pending = deferred<void>()
    const timer = setTimeout(() => {
      this.child.kill("SIGTERM")
      pending.resolve()
    }, 5_000)
    this.child.once("exit", () => {
      clearTimeout(timer)
      pending.resolve()
    })
    await pending.promise
  }
}

async function startLoopbackProvider(logPath: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
        const tools = Array.isArray(payload.tools) ? payload.tools as Array<Record<string, unknown>> : []
        const messages = Array.isArray(payload.messages) ? payload.messages as Array<Record<string, unknown>> : []
        const toolNames = tools.map((tool) => {
          const fn = tool.function
          return fn && typeof fn === "object" && !Array.isArray(fn) && typeof (fn as Record<string, unknown>).name === "string"
            ? (fn as Record<string, unknown>).name as string
            : undefined
        }).filter((name): name is string => Boolean(name))
        const roles = messages.map((message) => String(message.role ?? ""))
        fs.appendFileSync(logPath, `${JSON.stringify({ toolNames, roles })}\n`)

        response.writeHead(200, { "content-type": "text/event-stream" })
        const writeChunk = (delta: Record<string, unknown>, finishReason: string | null) => {
          response.write(`data: ${JSON.stringify({
            id: "chatcmpl-memory-lane-pi-compat",
            object: "chat.completion.chunk",
            created: 1,
            model: "compat-model",
            choices: [{ index: 0, delta, finish_reason: finishReason }],
            ...(finishReason ? { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } : {}),
          })}\n\n`)
        }
        if (roles.at(-1) === "tool") {
          writeChunk({ role: "assistant", content: "Memory saved through the real Pi tool path." }, null)
          writeChunk({}, "stop")
        } else {
          writeChunk({
            role: "assistant",
            tool_calls: [{
              index: 0,
              id: "call_memory_save_compat",
              type: "function",
              function: { name: "memory_save", arguments: JSON.stringify({ text: "Pi 0.81.1 compatibility sentinel", category: "project" }) },
            }],
          }, null)
          writeChunk({}, "tool_calls")
        }
        response.end("data: [DONE]\n\n")
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
    })
  })
  const listening = deferred<void>()
  server.once("error", listening.reject)
  server.listen(0, "127.0.0.1", listening.resolve)
  await listening.promise
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Could not start Pi compatibility provider")
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      const closed = deferred<void>()
      server.close((error) => error ? closed.reject(error) : closed.resolve())
      await closed.promise
    },
  }
}

function readJsonLines<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return []
  return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as T)
}

export function evaluatePiSourceForm(input: {
  form: PiSourceForm
  registrations: Registration[]
  lifecycleRegistrations: string[]
  selections: Array<{ activeTools?: string[]; allTools?: string[]; selectedTools?: string[] }>
  providerRequests: ProviderRequest[]
  toolEvents: RpcFrame[]
  persistedTexts: string[]
}): { pass: boolean; checks: Record<string, boolean> } {
  const expected = EXPECTED_PI_TOOLS[input.form]
  const checks = {
    productionDefinitionsLoaded: expected.every((name) => input.registrations.some((registration) => registration.name === name)),
    essentialDefinitionsPreserved: expected.every((name) => input.registrations.some((registration) => registration.name === name && registration.loadMode === "essential")),
    lifecycleHooksLoaded: EXPECTED_PI_LIFECYCLE_EVENTS.every((name) => input.lifecycleRegistrations.includes(name)),
    allowlistSelectionPreserved: input.selections.some((selection) =>
      selection.activeTools?.length === 1
      && selection.activeTools[0] === "memory_save"
      && selection.allTools?.length === 1
      && selection.allTools[0] === "memory_save"
      && selection.selectedTools?.length === 1
      && selection.selectedTools[0] === "memory_save"),
    providerSchemaVisible: input.providerRequests.some((request) => request.toolNames.length === 1 && request.toolNames[0] === "memory_save"),
    providerObservedToolResult: input.providerRequests.some((request) => request.roles.includes("tool")),
    memorySaveExecuted: input.toolEvents.some((event) => event.type === "tool_execution_end" && event.toolName === "memory_save" && event.isError === false),
    isolatedPersistenceSucceeded: input.persistedTexts.includes("Pi 0.81.1 compatibility sentinel"),
  }
  return { pass: Object.values(checks).every(Boolean), checks }
}

async function runSourceForm(options: {
  form: PiSourceForm
  executable: string
  root: string
  targetSource: string
  providerBaseUrl: string
  cliPath: string
}): Promise<Record<string, unknown>> {
  const formDir = path.join(options.root, options.form)
  const projectDir = path.join(formDir, "project")
  const homeDir = path.join(formDir, "home")
  const agentDir = path.join(formDir, "pi-agent")
  const sessionDir = path.join(formDir, "sessions")
  const configDir = path.join(formDir, "config")
  const cacheDir = path.join(formDir, "cache")
  const dataDir = path.join(formDir, "data")
  const targetPath = path.join(formDir, "memory-lane-target.ts")
  const wrapperPath = path.join(formDir, "memory-lane-pi-compatibility.ts")
  const extensionLogPath = path.join(formDir, "extension.jsonl")
  const providerLogPath = path.join(options.root, "provider.jsonl")
  const memoryPath = path.join(formDir, "storage", "memory.jsonl")
  const embeddingsPath = path.join(formDir, "storage", "embeddings.jsonl")
  const memoryConfigPath = path.join(formDir, "storage", "config.json")
  for (const directory of [projectDir, homeDir, agentDir, sessionDir, configDir, cacheDir, dataDir, path.dirname(memoryPath)]) {
    fs.mkdirSync(directory, { recursive: true })
  }
  fs.writeFileSync(path.join(projectDir, ".memory-lane-scope"), JSON.stringify({ id: `pi-compat-${options.form}` }))
  fs.writeFileSync(memoryConfigPath, JSON.stringify({ semantic: { enabled: false }, learning: { capture: "off" } }))
  fs.writeFileSync(targetPath, options.targetSource)
  fs.writeFileSync(wrapperPath, wrapperSource(targetPath, extensionLogPath, options.providerBaseUrl))

  const env = isolatedPiEnvironment(process.env, {
    homeDir,
    agentDir,
    configDir,
    cacheDir,
    dataDir,
    memoryPath,
    embeddingsPath,
    memoryConfigPath,
  })
  const plan = piRpcCommandPlan({ executable: options.executable, extensionPath: wrapperPath, sessionDir })
  const providerRequestStart = readJsonLines<ProviderRequest>(providerLogPath).length
  const rpc = new RpcSession(plan.command, plan.args, env, projectDir)
  let toolEvents: RpcFrame[] = []
  try {
    await rpc.initialize()
    toolEvents = await rpc.prompt("Explicitly remember the Pi compatibility sentinel using the available memory tool.")
  } finally {
    await rpc.close()
  }

  const extensionEntries = readJsonLines<Record<string, unknown>>(extensionLogPath)
  const registrations = extensionEntries.filter((entry) => entry.kind === "registration") as Registration[]
  const lifecycleRegistrations = extensionEntries
    .filter((entry) => entry.kind === "lifecycle-registration" && typeof entry.name === "string")
    .map((entry) => entry.name as string)
  const selections = extensionEntries.filter((entry) => entry.kind === "selection") as Array<{ activeTools?: string[]; allTools?: string[]; selectedTools?: string[] }>
  const providerRequests = readJsonLines<ProviderRequest>(providerLogPath).slice(providerRequestStart)
  const listed = JSON.parse(commandOutput(process.execPath, [options.cliPath, "list", "--json", "--project", projectDir], { env, cwd: projectDir })) as {
    data?: { memories?: Array<{ text?: string }> }
  }
  const persistedTexts = listed.data?.memories?.map((memory) => memory.text).filter((text): text is string => typeof text === "string") ?? []
  const evaluation = evaluatePiSourceForm({ form: options.form, registrations, lifecycleRegistrations, selections, providerRequests, toolEvents, persistedTexts })
  return {
    sourceForm: options.form,
    registrations,
    lifecycleRegistrations,
    selection: selections.at(-1),
    providerRequests,
    toolExecution: toolEvents.filter((event) => event.type === "tool_execution_start" || event.type === "tool_execution_end"),
    persistedTexts,
    ...evaluation,
  }
}

async function main(): Promise<void> {
  const executable = parseFlag("--pi") ?? "pi"
  const versionOutput = commandOutput(executable, ["--version"])
  validatePiVersion(versionOutput)
  const currentFile = fileURLToPath(import.meta.url)
  const cliRoot = path.resolve(path.dirname(currentFile), "..")
  const workspaceRoot = path.resolve(cliRoot, "../..")
  const adapterPath = path.join(workspaceRoot, "packages/pi-adapter/dist/index.js")
  const cliPath = path.join(cliRoot, "dist/index.js")
  if (!fs.existsSync(adapterPath) || !fs.existsSync(cliPath)) {
    throw new Error("Build @memory-lane/pi-adapter and @memory-lane/cli before running the Pi compatibility smoke")
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-pi-compatibility-"))
  const providerLogPath = path.join(root, "provider.jsonl")
  const provider = await startLoopbackProvider(providerLogPath)
  const preserve = process.argv.includes("--preserve")
  try {
    const adapter = await runSourceForm({
      form: "adapter",
      executable,
      root,
      targetSource: piAdapterImportSource(adapterPath),
      providerBaseUrl: provider.baseUrl,
      cliPath,
    })
    const bridge = await runSourceForm({
      form: "bridge",
      executable,
      root,
      targetSource: piCliBridgeSource(cliPath),
      providerBaseUrl: provider.baseUrl,
      cliPath,
    })
    const sourceForms = [adapter, bridge]
    const overallPass = sourceForms.every((form) => form.pass === true)
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      host: "pi",
      expectedVersion: PINNED_PI_VERSION,
      actualVersion: versionOutput,
      execution: {
        realRuntime: true,
        mode: "rpc",
        realModelToolPath: true,
        loopbackProvider: true,
        extensionFlag: true,
        toolsAllowlist: [...ESSENTIAL_TOOL_ALLOWLIST],
        scratchHome: true,
        scratchAgentConfig: true,
        scratchSession: true,
        scratchProject: true,
        scratchStorage: true,
      },
      sourceForms,
      overallPass,
    }, null, 2)}\n`)
    if (!overallPass) process.exitCode = 1
  } finally {
    await provider.close()
    if (preserve) process.stderr.write(`Preserved Pi compatibility scratch directory: ${root}\n`)
    else fs.rmSync(root, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
