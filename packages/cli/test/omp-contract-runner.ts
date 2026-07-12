import * as fs from "node:fs"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { piAdapterImportSource, piCliBridgeSource } from "../src/installer/config.js"

export const PINNED_OMP_VERSION = "16.4.5"
export const REQUIRED_FLAGS = ["--extension", "--profile", "--mode", "--config", "--cwd", "--session-dir", "--no-skills", "--no-rules", "--tools", "--append-system-prompt", "--auto-approve", "--max-time"] as const
export const CONTRACT_EVENTS = ["input", "before_agent_start", "turn_end", "tool_result", "session_before_compact"] as const
export type ContractEvent = typeof CONTRACT_EVENTS[number]
export type SourceForm = "adapter" | "bridge"
export type EventStatus = "pass" | "fail" | "not-registered-by-production-design"

type LogEntry = {
  kind: "registration" | "event" | "mechanism"
  name: string
  owner?: "production" | "harness"
  eventShape?: Record<string, string>
  eventValues?: Record<string, unknown>
  contextShape?: Record<string, string>
  contextValues?: Record<string, boolean>
  resultShape?: Record<string, string>
  resultValues?: Record<string, unknown>
  note?: string
}

type RpcFrame = Record<string, unknown> & { type?: string; id?: string }

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

export const EXPECTED_REGISTRATIONS: Record<SourceForm, readonly string[]> = {
  adapter: [
    "command:remember",
    "command:memory",
    "tool:memory_suggest",
    "tool:memory_save",
    "tool:memory_continuity",
    "tool:memory_recall",
    "before_agent_start",
    "session_before_compact",
    "input",
    "turn_end",
    "tool_result",
  ],
  bridge: [
    "command:remember",
    "command:memory",
    "tool:memory_save",
    "tool:memory_suggest",
    "tool:memory_continuity",
    "tool:memory_recall",
    "tool:memory_get",
    "session_before_compact",
    "before_agent_start",
    "input",
    "turn_end",
    "tool_result",
  ],
}


const EXPECTED_EVENTS: Record<SourceForm, Record<ContractEvent, true>> = {
  adapter: { input: true, before_agent_start: true, turn_end: true, tool_result: true, session_before_compact: true },
  bridge: { input: true, before_agent_start: true, turn_end: true, tool_result: true, session_before_compact: true },
}
type AggregateSourceForm = {
  sourceForm: SourceForm
  registrations: readonly string[]
  events: Record<ContractEvent, { status: EventStatus }>
}

export function ompContractOverallPass(sourceForms: readonly AggregateSourceForm[]): boolean {
  return (Object.keys(EXPECTED_REGISTRATIONS) as SourceForm[]).every((sourceForm) => {
    const result = sourceForms.find((candidate) => candidate.sourceForm === sourceForm)
    return result !== undefined
      && CONTRACT_EVENTS.every((event) => result.events[event]?.status === "pass")
      && EXPECTED_REGISTRATIONS[sourceForm].every((registration) => result.registrations.includes(registration))
  })
}

function parseFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function commandOutput(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(command, args, { encoding: "utf8", env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || `${command} exited with ${result.status}`)
  return result.stdout.trim()
}

export function validateOmpContract(versionOutput: string, helpOutput: string): void {
  const match = versionOutput.match(/(?:omp\/|omp v)(\d+\.\d+\.\d+)/u)
  if (match?.[1] !== PINNED_OMP_VERSION) {
    throw new Error(`OMP contract requires ${PINNED_OMP_VERSION}; received ${versionOutput || "no version output"}`)
  }
  const availableFlags = new Set(helpOutput.match(/--[\w-]+/gu) ?? [])
  const missing = REQUIRED_FLAGS.filter((flag) => !availableFlags.has(flag))
  if (missing.length) throw new Error(`OMP ${PINNED_OMP_VERSION} is missing required flags: ${missing.join(", ")}`)
}

function requireOmpContract(): { executable: string; versionOutput: string } {
  const executable = parseFlag("--omp") ?? "omp"
  const versionOutput = commandOutput(executable, ["--version"])
  const helpOutput = commandOutput(executable, ["--help"])
  validateOmpContract(versionOutput, helpOutput)
  return { executable, versionOutput }
}

export function isolatedOmpEnvironment(base: NodeJS.ProcessEnv, overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base, ...overrides }
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    delete env[key]
  }
  env.NO_PROXY = "127.0.0.1,localhost"
  env.no_proxy = env.NO_PROXY
  return env
}

function wrapperSource(targetPath: string, logPath: string, providerBaseUrl: string): string {
  return `import * as fs from "node:fs"
import * as path from "node:path"

const TARGET = ${JSON.stringify(pathToFileURL(targetPath).href)}
const LOG = ${JSON.stringify(logPath)}
const PROVIDER_BASE_URL = ${JSON.stringify(providerBaseUrl)}

function shape(value) {
  if (!value || typeof value !== "object") return {}
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Array.isArray(item) ? "array" : item === null ? "null" : typeof item]))
}

function record(entry) {
  fs.appendFileSync(LOG, JSON.stringify(entry) + "\\n")
}

function sessionSignals(ctx) {
  try {
    const manager = ctx?.sessionManager
    const header = manager?.getHeader?.()
    const sessionFile = manager?.getSessionFile?.()
    const artifactsDir = manager?.getArtifactsDir?.()
    const systemPrompt = ctx?.getSystemPrompt?.()
    const parentLineage = typeof header?.parentSession === "string"
    const nestedSessionFile = typeof sessionFile === "string"
      && typeof artifactsDir === "string"
      && path.resolve(path.dirname(sessionFile)) === path.resolve(artifactsDir)
    const subagentRole = Array.isArray(systemPrompt)
      && systemPrompt.some((part) => typeof part === "string" && part.includes("You are a worker agent for delegated tasks."))
    return { parentLineage, nestedSessionFile, subagentRole, taskSession: nestedSessionFile && subagentRole }
  } catch {
    return { parentLineage: false, nestedSessionFile: false, subagentRole: false, taskSession: false }
  }
}

function eventValues(name, event) {
  if (name === "input") return { source: event?.source, textMatchesSentinel: event?.text === "Remember that interactive OMP input preserves the contract sentinel." }
  if (name === "tool_result") {
    const content = Array.isArray(event?.content) ? event.content : []
    return {
      toolName: event?.toolName,
      isError: event?.isError,
      inputCommand: event?.input?.command,
      contentMatchesSentinel: content.some((item) => item?.type === "text" && item.text === "OMP_CONTRACT_TEST_PASSED: \\\`pnpm test\\\` is the test command for this repo."),
    }
  }
  return {}
}

function resultValues(name, result) {
  return name === "input" ? { action: result?.action } : {}
}

export default async function instrumentedMemoryLaneExtension(api) {
  api.registerProvider("memory-lane-contract", {
    baseUrl: PROVIDER_BASE_URL,
    apiKey: "MEMORY_LANE_CONTRACT_KEY",
    api: "openai-completions",
    models: [{
      id: "contract-model",
      name: "Memory Lane Contract Model",
      api: "openai-completions",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 512,
    }],
  })
  record({ kind: "mechanism", name: "provider", owner: "harness", note: "loopback OpenAI-compatible contract provider registered" })

  // Runtime-selected production artifact intentionally exercises OMP's real extension loader.
  const mod = await import(TARGET + "?contract=" + Date.now())
  const factory = typeof mod.default === "function" ? mod.default : mod.default?.default
  if (typeof factory !== "function") throw new Error("Memory Lane extension factory missing")
  const proxy = new Proxy(api, {
    get(target, property, receiver) {
      if (property === "on") return (name, handler) => {
        record({ kind: "registration", name, owner: "production" })
        return target.on(name, async (event, ctx) => {
          const contextShape = { ...shape(ctx), uiNotify: typeof ctx?.ui?.notify, sessionFile: typeof ctx?.sessionManager?.getSessionFile, sessionBranch: typeof ctx?.sessionManager?.getBranch }
          const result = await handler(event, ctx)
          record({
            kind: "event",
            name,
            owner: "production",
            eventShape: shape(event),
            eventValues: eventValues(name, event),
            contextShape,
            contextValues: sessionSignals(ctx),
            resultShape: shape(result),
            resultValues: resultValues(name, result),
          })
          return result
        })
      }
      if (property === "registerCommand") return (name, command) => {
        record({ kind: "registration", name: "command:" + name, owner: "production" })
        return target.registerCommand(name, command)
      }
      if (property === "registerTool") return (tool) => {
        record({ kind: "registration", name: "tool:" + tool.name, owner: "production" })
        return target.registerTool(tool)
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  await factory(proxy)

  api.registerTool({
    name: "shell:memory-lane-contract",
    label: "Memory Lane Contract Tool",
    description: "Deterministic contract-only shell outcome tool.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: { type: "string" },
        fail: { type: "boolean" },
      },
      required: ["command"],
    },
    async execute(_id, params) {
      record({ kind: "mechanism", name: "contract-tool-execution", owner: "harness", note: params?.fail === true ? "error" : "success" })
      if (params?.fail === true) throw new Error("OMP_CONTRACT_TOOL_FAILED")
      return {
        content: [{ type: "text", text: "OMP_CONTRACT_TEST_PASSED: \\\`pnpm test\\\` is the test command for this repo." }],
        details: { contract: true },
      }
    },
  })
  record({ kind: "registration", name: "tool:shell:memory-lane-contract", owner: "harness" })
}
`
}

class RpcSession {
  readonly child: ChildProcessWithoutNullStreams
  readonly frames: RpcFrame[] = []
  readonly stderr: string[] = []
  #waiters = new Set<() => void>()

  constructor(command: string, args: string[], env: NodeJS.ProcessEnv) {
    this.child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] })
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
    this.child.stderr.on("data", (chunk: string) => { this.stderr.push(chunk) })
  }

  send(frame: RpcFrame): void {
    this.child.stdin.write(`${JSON.stringify(frame)}\n`)
  }

  async waitFor(predicate: (frame: RpcFrame) => boolean, timeoutMs = 120_000): Promise<RpcFrame> {
    const existing = this.frames.find(predicate)
    if (existing) return existing
    const { promise, resolve, reject } = deferred<RpcFrame>()
    let timer: NodeJS.Timeout
    const wake = () => {
      const found = this.frames.find(predicate)
      if (!found) return
      clearTimeout(timer)
      this.#waiters.delete(wake)
      resolve(found)
    }
    timer = setTimeout(() => {
      this.#waiters.delete(wake)
      const recentFrames = this.frames.slice(-8).map((frame) => `${frame.type ?? "unknown"}:${frame.id ?? ""}`).join(", ")
      reject(new Error(`Timed out waiting for OMP RPC frame. recent frames: ${recentFrames || "none"}; stderr: ${this.stderr.join("").trim()}`))
    }, timeoutMs)
    this.#waiters.add(wake)
    this.child.once("exit", (code) => {
      if (this.frames.find(predicate)) return
      clearTimeout(timer)
      this.#waiters.delete(wake)
      reject(new Error(`OMP RPC exited with ${code}. stderr: ${this.stderr.join("").trim()}`))
    })
    return promise
  }

  async prompt(id: string, message: string): Promise<void> {
    const start = this.frames.length
    this.send({ id, type: "prompt", message })
    await this.waitFor((frame) => this.frames.indexOf(frame) >= start && frame.type === "agent_end")
    const turnFrames = this.frames.slice(start)
    const failedResponse = turnFrames.find((frame) => frame.type === "response" && frame.success === false)
    const messageEnd = turnFrames.findLast((frame) => frame.type === "message_end")
    const assistantMessage = messageEnd?.message && typeof messageEnd.message === "object" && !Array.isArray(messageEnd.message)
      ? messageEnd.message as Record<string, unknown>
      : undefined
    if (!failedResponse && assistantMessage?.stopReason !== "error") return
    const errorMessage = typeof assistantMessage?.errorMessage === "string"
      ? assistantMessage.errorMessage.slice(0, 1_000)
      : typeof failedResponse?.error === "string"
        ? failedResponse.error.slice(0, 1_000)
        : "unknown provider error"
    throw new Error(`OMP RPC prompt ${id} failed: ${errorMessage}`)
  }

  compact(id: string): void {
    this.send({ id, type: "compact", customInstructions: "Memory Lane OMP contract smoke" })
  }

  async close(): Promise<void> {
    this.child.stdin.end()
    if (this.child.exitCode !== null) return
    const { promise, resolve } = deferred<void>()
    const timer = setTimeout(() => { this.child.kill("SIGTERM"); resolve() }, 5_000)
    this.child.once("exit", () => { clearTimeout(timer); resolve() })
    await promise
  }
}

function readLog(logPath: string): LogEntry[] {
  if (!fs.existsSync(logPath)) return []
  return fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as LogEntry)
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = deferred<void>()
  setTimeout(resolve, ms)
  return promise
}

async function waitForLogEvent(logPath: string, event: ContractEvent, afterCount: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const count = readLog(logPath).filter((entry) => entry.kind === "event" && entry.name === event).length
    if (count > afterCount) return
    await delay(50)
  }
  throw new Error(`Timed out waiting for real OMP ${event} event in ${logPath}`)
}

async function waitForFileIncludes(filePath: string, needle: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8").includes(needle)) return
    await delay(50)
  }
  throw new Error(`Timed out waiting for ${JSON.stringify(needle)} in ${filePath}`)
}

async function runInteractiveInput(options: {
  executable: string
  profile: string
  projectDir: string
  sessionDir: string
  configPath: string
  wrapperPath: string
  logPath: string
  memoryPath: string
  env: NodeJS.ProcessEnv
}): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("--manual-input requires a genuine interactive terminal")
  }
  const beforeInput = readLog(options.logPath).filter((entry) => entry.kind === "event" && entry.name === "input").length
  process.stdout.write("\nOMP input contract requires physical editor input.\n")
  process.stdout.write("After the OMP editor appears, type this exact line and press Enter:\n")
  process.stdout.write("Remember that interactive OMP input preserves the contract sentinel.\n\n")
  const child = spawn(options.executable, [
    "--profile", options.profile,
    "--cwd", options.projectDir,
    "--session-dir", options.sessionDir,
    "--no-skills",
    "--no-rules",
    "--config", options.configPath,
    "--extension", options.wrapperPath,
    "--auto-approve",
    "--model", "memory-lane-contract/contract-model",
    "--tools", "shell:memory-lane-contract",
    "--max-time", "60",
  ], { env: options.env, stdio: "inherit" })
  try {
    await waitForLogEvent(options.logPath, "input", beforeInput, 120_000)
    await waitForFileIncludes(options.memoryPath, "interactive OMP input preserves the contract sentinel", 30_000)
    fs.appendFileSync(options.logPath, `${JSON.stringify({
      kind: "mechanism",
      name: "input",
      owner: "harness",
      note: "genuine real-TTY editor submission observed in this contract run",
    })}\n`)
  } finally {
    child.kill("SIGTERM")
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve()
        return
      }
      const timer = setTimeout(() => {
        child.kill("SIGKILL")
        resolve()
      }, 5_000)
      child.once("exit", () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}

function eventResult(form: SourceForm, event: ContractEvent, entries: LogEntry[], memoryText: string): { status: EventStatus; evidence: string[] } {
  if (!EXPECTED_EVENTS[form][event]) {
    return { status: "not-registered-by-production-design", evidence: ["production source does not expect this handler"] }
  }
  const registrations = entries.filter((entry) => entry.kind === "registration" && entry.owner === "production" && entry.name === event)
  const observations = entries.filter((entry) =>
    entry.kind === "event"
    && entry.owner === "production"
    && entry.name === event
    && entry.contextValues?.taskSession !== true)
  const evidence = observations.map((entry) =>
    `event=${JSON.stringify(entry.eventShape)} values=${JSON.stringify(entry.eventValues)} context=${JSON.stringify(entry.contextShape)} result=${JSON.stringify(entry.resultShape)} resultValues=${JSON.stringify(entry.resultValues)}`)
  if (!registrations.length) return { status: "fail", evidence: ["expected production handler was not registered"] }
  if (!observations.length) {
    const mechanismNotes = entries.filter((entry) => entry.kind === "mechanism" && entry.name === event).map((entry) => entry.note ?? "host mechanism failed")
    if (event === "tool_result") {
      const toolExecuted = entries.some((entry) => entry.kind === "mechanism" && entry.name === "contract-tool-execution" && entry.note === "success")
      mechanismNotes.push(toolExecuted
        ? "The deterministic contract tool executed, but OMP emitted no tool_result event."
        : "The deterministic contract tool did not execute, so event delivery remains unverified.")
    }
    return { status: "fail", evidence: ["registered handler was not observed under the real OMP runtime", ...mechanismNotes] }
  }

  const selected = event === "tool_result"
    ? observations.find((entry) => entry.eventValues?.isError === false) ?? observations.at(-1)
    : observations.at(-1)
  const rawShape = selected?.eventShape ?? {}
  const ompFields: Partial<Record<ContractEvent, string[]>> = {
    input: ["text", "source"],
    before_agent_start: ["prompt"],
    turn_end: ["message", "toolResults"],
    tool_result: ["toolName", "input", "content", "details", "isError"],
    session_before_compact: ["preparation", "branchEntries", "signal"],
  }
  const consumedFields: Partial<Record<ContractEvent, string[]>> = {
    input: ["source", "text", "turnId"],
    before_agent_start: ["prompt"],
    turn_end: ["turnId", "lastUserMessage", "lastAssistantMessage"],
    tool_result: ["turnId", "toolName", "toolInput", "toolResponse"],
    session_before_compact: ["turnId", "preparation", "branchEntries"],
  }
  const missingHostFields = (ompFields[event] ?? []).filter((key) => !(key in rawShape))
  if (missingHostFields.length) return { status: "fail", evidence: [...evidence, `missing OMP host fields: ${missingHostFields.join(", ")}`] }
  const missingConsumedFields = (consumedFields[event] ?? []).filter((key) => !(key in rawShape))
  if (missingConsumedFields.length) evidence.push(`raw payload omits legacy Pi fields consumed before normalization: ${missingConsumedFields.join(", ")}`)

  const context = selected?.contextShape ?? {}
  const missingContext = ["cwd", "uiNotify", "sessionFile", "sessionBranch"].filter((key) => context[key] === "undefined")
  if (missingContext.length) return { status: "fail", evidence: [...evidence, `missing context surface: ${missingContext.join(", ")}`] }

  if (event === "input") {
    const manualEvidence = entries.some((entry) =>
      entry.kind === "mechanism"
      && entry.name === "input"
      && entry.note === "genuine real-TTY editor submission observed in this contract run")
    if (!manualEvidence) return { status: "fail", evidence: [...evidence, "noninteractive execution cannot verify physical OMP input"] }
    if (selected?.eventValues?.source !== "interactive" || selected.eventValues.textMatchesSentinel !== true) {
      return { status: "fail", evidence: [...evidence, "interactive input source or bounded sentinel did not match"] }
    }
    if (selected.resultValues?.action !== "continue") {
      return { status: "fail", evidence: [...evidence, "OMP pass-through result was not { action: continue }"] }
    }
    evidence.push("genuine real-TTY input and accepted pass-through result were observed")
  }

  if (event === "tool_result") {
    const successExecuted = entries.some((entry) => entry.kind === "mechanism" && entry.name === "contract-tool-execution" && entry.note === "success")
    if (!successExecuted) return { status: "fail", evidence: [...evidence, "deterministic contract tool success was not observed"] }
    if (selected?.eventValues?.toolName !== "shell:memory-lane-contract"
      || selected.eventValues.inputCommand !== "pnpm test"
      || selected.eventValues.contentMatchesSentinel !== true
      || selected.eventValues.isError !== false) {
      return { status: "fail", evidence: [...evidence, "live successful tool_result values did not match the deterministic contract"] }
    }
    evidence.push("deterministic registered tool executed successfully before live tool_result delivery")
  }

  const captureNeedles: Partial<Record<ContractEvent, string[]>> = {
    input: ["interactive OMP input preserves the contract sentinel"],
    turn_end: ["Released v9.9.9 after OMP contract verification", "turn_stop"],
    tool_result: ["`pnpm test` is the test command for this repo.", "post_tool_use"],
    session_before_compact: ["OMP contract compaction summary", "pre_compact"],
  }
  const missingCapture = (captureNeedles[event] ?? []).filter((needle) => !memoryText.includes(needle))
  if (missingCapture.length) return { status: "fail", evidence: [...evidence, `missing lifecycle capture evidence: ${missingCapture.join(", ")}`] }
  if (captureNeedles[event]?.length) evidence.push("configured lifecycle capture evidence was persisted")
  if (event === "before_agent_start" && !observations.some((entry) => entry.resultShape?.message === "object")) {
    return { status: "fail", evidence: [...evidence, "hidden context message return was not observed"] }
  }
  return { status: "pass", evidence }
}

async function startSummaryServer(logPath: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      let payload: Record<string, unknown> = {}
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>
      } catch {
        response.writeHead(400, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: "invalid contract request" }))
        return
      }

      const messages = Array.isArray(payload.messages)
        ? payload.messages.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        : []
      const tools = Array.isArray(payload.tools)
        ? payload.tools.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        : []
      const toolNames = tools.map((tool) => {
        const fn = tool.function
        return fn && typeof fn === "object" && !Array.isArray(fn) && typeof fn.name === "string" ? fn.name : undefined
      }).filter((name): name is string => Boolean(name))
      fs.appendFileSync(logPath, `${JSON.stringify({
        method: request.method,
        url: request.url,
        stream: payload.stream === true,
        model: typeof payload.model === "string" ? payload.model : undefined,
        messageCount: messages.length,
        toolNames,
      })}\n`)

      if (payload.stream !== true) {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ choices: [{ message: { content: "- OMP contract compaction summary." } }] }))
        return
      }

      const lastMessage = messages.at(-1)
      const lastRole = typeof lastMessage?.role === "string" ? lastMessage.role : undefined
      let userContent = ""
      for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]
        if (message.role !== "user") continue
        const content = message.content
        let text = ""
        if (typeof content === "string") {
          text = content
        } else if (Array.isArray(content)) {
          text = content
            .filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object" && !Array.isArray(part))
            .map((part) => typeof part.text === "string" ? part.text : "")
            .join("\n")
        }
        if (text.includes("contract")) {
          userContent = text
          break
        }
      }

      const writeSse = (delta: Record<string, unknown>, finishReason: string | null) => {
        const frame = {
          id: "chatcmpl-memory-lane-contract",
          object: "chat.completion.chunk",
          created: 1,
          model: "contract-model",
          choices: [{ index: 0, delta, finish_reason: finishReason }],
          ...(finishReason ? { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } : {}),
        }
        response.write(`data: ${JSON.stringify(frame)}\n\n`)
      }
      const finishText = (text: string) => {
        response.writeHead(200, { "content-type": "text/event-stream" })
        writeSse({ role: "assistant", content: text }, null)
        writeSse({}, "stop")
        response.end("data: [DONE]\n\n")
      }
      const finishToolCall = (name: string, args: Record<string, unknown>, id: string) => {
        response.writeHead(200, { "content-type": "text/event-stream" })
        writeSse({
          role: "assistant",
          tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        }, null)
        writeSse({}, "tool_calls")
        response.end("data: [DONE]\n\n")
      }

      if (lastRole === "tool") {
        finishText("Contract tool flow completed.")
        return
      }
      if (toolNames.includes("yield")) {
        finishToolCall("yield", { result: { data: "TASK_SESSION_CONTRACT_OK" } }, "call_contract_yield")
        return
      }
      if (userContent.includes("task-session contract")) {
        finishToolCall("task", {
          agent: "task",
          task: "Remember that OMP task-session capture should be suppressed. Then return TASK_SESSION_CONTRACT_OK through the yield tool. Do not use other tools.",
        }, "call_contract_task")
        return
      }
      if (userContent.includes("tool-result error contract")) {
        finishToolCall("shell:memory-lane-contract", { command: "pnpm test", fail: true }, "call_contract_tool_error")
        return
      }
      if (userContent.includes("tool-result contract")) {
        finishToolCall("shell:memory-lane-contract", { command: "pnpm test", fail: false }, "call_contract_tool_success")
        return
      }
      finishText("Released v9.9.9 after OMP contract verification.")
    })
  })
  const { promise, resolve, reject } = deferred<void>()
  server.once("error", reject)
  server.listen(0, "127.0.0.1", resolve)
  await promise
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Could not start contract server")
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      const { promise: closePromise, resolve: closeResolve, reject: closeReject } = deferred<void>()
      server.close((error) => error ? closeReject(error) : closeResolve())
      await closePromise
    },
  }
}

export function ompRpcCommandPlan(options: {
  executable: string
  profile: string
  projectDir: string
  sessionDir: string
  configPath: string
  extensionPath: string
}): { command: string; args: string[] } {
  return {
    command: options.executable,
    args: [
      "--mode", "rpc",
      "--profile", options.profile,
      "--cwd", options.projectDir,
      "--session-dir", options.sessionDir,
      "--no-skills",
      "--no-rules",
      "--config", options.configPath,
      "--extension", options.extensionPath,
      "--auto-approve",
      "--model", "memory-lane-contract/contract-model",
      "--tools", "task,shell:memory-lane-contract",
      "--append-system-prompt", "Memory Lane contract runtime. Follow the current user request exactly.",
      "--max-time", "180",
    ],
  }
}

async function runSourceForm(options: {
  form: SourceForm
  executable: string
  root: string
  targetSource: string
  profile: string
  summaryBaseUrl: string
  cliPath: string
  manualInput: boolean
}): Promise<{ form: SourceForm; entries: LogEntry[]; events: Record<ContractEvent, { status: EventStatus; evidence: string[] }>; memoryText: string }> {
  const formDir = path.join(options.root, options.form)
  const projectDir = path.join(formDir, "project")
  const agentDir = path.join(formDir, "agent")
  const homeDir = path.join(formDir, "home")
  const sessionDir = path.join(formDir, "sessions")
  const targetPath = path.join(formDir, "memory-lane-target.ts")
  const wrapperPath = path.join(formDir, "memory-lane-contract.ts")
  const logPath = path.join(formDir, "events.jsonl")
  const memoryPath = path.join(formDir, "memory.jsonl")
  const embeddingsPath = path.join(formDir, "embeddings.jsonl")
  const configPath = path.join(formDir, "config.json")
  const ompConfigPath = path.join(formDir, "omp-contract.yml")
  fs.mkdirSync(projectDir, { recursive: true })
  fs.mkdirSync(agentDir, { recursive: true })
  fs.mkdirSync(homeDir, { recursive: true })
  fs.writeFileSync(path.join(agentDir, "last-changelog-version"), PINNED_OMP_VERSION)
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(ompConfigPath, "setupVersion: 1\nstartup:\n  setupWizard: false\n  showSplash: false\ncompaction:\n  keepRecentTokens: 1\ntask:\n  batch: false\n  isolation:\n    mode: none\nasync:\n  enabled: false\n")
  fs.writeFileSync(path.join(projectDir, ".memory-lane-scope"), JSON.stringify({ id: `omp-contract-${options.form}` }))
  fs.writeFileSync(configPath, JSON.stringify({
    semantic: { enabled: false },
    memory: {
      sessionEndSummary: {
        enabled: true,
        baseUrl: options.summaryBaseUrl,
        model: "contract-mock",
        requireConfirmation: false,
      },
    },
  }))
  fs.writeFileSync(targetPath, options.targetSource)
  fs.writeFileSync(wrapperPath, wrapperSource(targetPath, logPath, options.summaryBaseUrl))

  const env = isolatedOmpEnvironment(process.env, {
    HOME: homeDir,
    MEMORY_LANE_CONTRACT_KEY: "contract-only",
    PI_CODING_AGENT_DIR: agentDir,
    OMP_SKIP_SETUP: "1",
    PI_DIALECT: "",
    MEMORY_LANE_FILE: memoryPath,
    MEMORY_LANE_EMBEDDINGS_FILE: embeddingsPath,
    MEMORY_LANE_CONFIG: configPath,
    PI_MEMORY_FILE: memoryPath,
    PI_MEMORY_EMBEDDINGS_FILE: embeddingsPath,
    PI_MEMORY_CONFIG_FILE: configPath,
  })
  commandOutput(process.execPath, [options.cliPath, "save", `OMP ${options.form} approved retrieval sentinel`, "--category", "project", "--status", "approved", "--json", "--project", projectDir], env)
  const seededRecall = commandOutput(process.execPath, [options.cliPath, "recall", `OMP ${options.form} approved retrieval sentinel`, "--json", "--project", projectDir], env)
  if (!seededRecall.includes(`OMP ${options.form} approved retrieval sentinel`)) throw new Error(`Could not verify seeded ${options.form} memory before OMP launch`)
  const commandPlan = ompRpcCommandPlan({
    executable: options.executable,
    profile: options.profile,
    projectDir,
    sessionDir,
    configPath: ompConfigPath,
    extensionPath: wrapperPath,
  })
  const rpc = new RpcSession(commandPlan.command, commandPlan.args, env)
  try {
    await rpc.waitFor((frame) => frame.type === "ready", 30_000)
    await rpc.prompt("turn", "Record the release statement for the OMP contract.")
    await rpc.prompt("tool-success", "Run the tool-result contract success scenario.")
    await rpc.prompt("tool-error", "Run the tool-result error contract scenario.")
    await rpc.prompt("task", "Run the task-session contract once.")
    const compactCount = readLog(logPath).filter((entry) => entry.kind === "event" && entry.name === "session_before_compact").length
    rpc.compact("compact")
    await waitForLogEvent(logPath, "session_before_compact", compactCount)
    await waitForFileIncludes(memoryPath, "OMP contract compaction summary")
  } finally {
    await rpc.close()
  }
  if (options.manualInput) {
    await runInteractiveInput({
      executable: options.executable,
      profile: `${options.profile}-interactive`,
      projectDir,
      sessionDir,
      configPath: ompConfigPath,
      wrapperPath,
      logPath,
      memoryPath,
      env,
    })
  } else {
    fs.appendFileSync(logPath, `${JSON.stringify({
      kind: "mechanism",
      name: "input",
      owner: "harness",
      note: "manual real-TTY input was not requested; noninteractive execution cannot pass input",
    })}\n`)
  }
  const memoryText = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, "utf8") : ""
  const entries = readLog(logPath)
  return {
    form: options.form,
    entries,
    memoryText,
    events: Object.fromEntries(CONTRACT_EVENTS.map((event) => [event, eventResult(options.form, event, entries, memoryText)])) as Record<ContractEvent, { status: EventStatus; evidence: string[] }>,
  }
}

export function taskSessionResult(results: Array<{ form: SourceForm; entries: LogEntry[]; memoryText: string }>) {
  const evaluatedForms = results.map((result) => {
    const childEvents = result.entries.filter((entry) => entry.kind === "event" && entry.owner === "production" && entry.contextValues?.taskSession === true)
    const observedEvents = [...new Set(childEvents.map((entry) => entry.name))].sort()
    const requiredEvents = ["before_agent_start", "turn_end", "tool_result"]
    const missingEvents = requiredEvents.filter((event) => !observedEvents.includes(event))
    const nestedSessionFile = childEvents.length > 0
      && childEvents.every((entry) => entry.contextValues?.nestedSessionFile === true)
    const subagentRole = childEvents.length > 0
      && childEvents.every((entry) => entry.contextValues?.subagentRole === true)
    const reliableTaskSignals = nestedSessionFile && subagentRole
    const suppressedResults = requiredEvents.every((event) =>
      childEvents.filter((entry) => entry.name === event).every((entry) => Object.keys(entry.resultShape ?? {}).length === 0))
    const persistedTaskMemory = result.memoryText.includes("OMP task-session capture should be suppressed")
    return {
      reliableTaskSignals,
      report: {
        sourceForm: result.form,
        observedEvents,
        missingEvents,
        taskSignals: {
          nestedSessionFile,
          subagentRole,
          parentLineageObserved: childEvents.some((entry) => entry.contextValues?.parentLineage === true),
        },
        automaticCaptureSuppressed: suppressedResults && !persistedTaskMemory,
      },
    }
  })
  const status = evaluatedForms.every(({ reliableTaskSignals, report }) =>
    report.missingEvents.length === 0
    && reliableTaskSignals
    && report.automaticCaptureSuppressed)
    ? "pass"
    : "fail"
  return {
    status,
    policy: "Suppress automatic lifecycle capture only when nested session-file ownership and OMP's delegated-worker system role both identify a task session.",
    sourceForms: evaluatedForms.map(({ report }) => report),
  }
}

function toolErrorResult(results: Array<{ form: SourceForm; entries: LogEntry[] }>) {
  const sourceForms = results.map((result) => {
    const executionFailed = result.entries.some((entry) =>
      entry.kind === "mechanism" && entry.name === "contract-tool-execution" && entry.note === "error")
    const eventDelivered = result.entries.some((entry) =>
      entry.kind === "event"
      && entry.owner === "production"
      && entry.name === "tool_result"
      && entry.contextValues?.taskSession !== true
      && entry.eventValues?.toolName === "shell:memory-lane-contract"
      && entry.eventValues.isError === true)
    return { sourceForm: result.form, executionFailed, eventDelivered }
  })
  return {
    status: sourceForms.every((result) => result.executionFailed && result.eventDelivered) ? "pass" : "fail",
    sourceForms,
  }
}

async function main(): Promise<void> {
  const asOf = parseFlag("--as-of") ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(asOf)) throw new Error("--as-of must use YYYY-MM-DD")
  const outputPath = parseFlag("--out")
  const preserve = process.argv.includes("--preserve")
  const manualInput = process.argv.includes("--manual-input")
  const runtime = requireOmpContract()
  const currentFile = fileURLToPath(import.meta.url)
  const cliRoot = path.resolve(path.dirname(currentFile), "..")
  const workspaceRoot = path.resolve(cliRoot, "../..")
  const adapterPath = path.join(workspaceRoot, "packages/pi-adapter/dist/index.js")
  const cliPath = path.join(cliRoot, "dist/index.js")
  if (!fs.existsSync(adapterPath) || !fs.existsSync(cliPath)) {
    throw new Error("Build @memory-lane/pi-adapter and @memory-lane/cli before running the OMP contract smoke")
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-omp-contract-"))
  const summary = await startSummaryServer(path.join(root, "provider-requests.jsonl"))
  try {
    const adapter = await runSourceForm({
      form: "adapter",
      executable: runtime.executable,
      root,
      targetSource: piAdapterImportSource(adapterPath),
      profile: `memory-lane-contract-adapter-${process.pid}`,
      summaryBaseUrl: summary.baseUrl,
      cliPath,
      manualInput,
    })
    const bridge = await runSourceForm({
      form: "bridge",
      executable: runtime.executable,
      root,
      targetSource: piCliBridgeSource(cliPath),
      profile: `memory-lane-contract-bridge-${process.pid}`,
      summaryBaseUrl: summary.baseUrl,
      cliPath,
      manualInput,
    })
    const sourceForms = [adapter, bridge].map((result) => {
      const registrations = [...new Set(result.entries.filter((entry) => entry.kind === "registration" && entry.owner === "production").map((entry) => entry.name))]
      const missingRegistrations = EXPECTED_REGISTRATIONS[result.form].filter((name) => !registrations.includes(name))
      const incompleteEvents = Object.entries(result.events).filter(([, event]) => event.status !== "pass").map(([name]) => name)
      return {
        sourceForm: result.form,
        registrations,
        missingRegistrations,
        incompleteEvents,
        events: result.events,
      }
    })
    const taskSessions = taskSessionResult([adapter, bridge])
    const toolError = toolErrorResult([adapter, bridge])
    const harnessArtifacts = [adapter, bridge].map((result) => ({
      sourceForm: result.form,
      providerRegistered: result.entries.some((entry) => entry.kind === "mechanism" && entry.owner === "harness" && entry.name === "provider"),
      contractToolRegistered: result.entries.some((entry) => entry.kind === "registration" && entry.owner === "harness" && entry.name === "tool:shell:memory-lane-contract"),
    }))
    const lifecyclePass = ompContractOverallPass(sourceForms)
    const overallPass = lifecyclePass
      && taskSessions.status === "pass"
      && toolError.status === "pass"
      && harnessArtifacts.every((artifact) => artifact.providerRegistered && artifact.contractToolRegistered)
    const failedRegisteredEvents = sourceForms.flatMap((form) => Object.entries(form.events)
      .filter(([, result]) => result.status === "fail")
      .map(([event]) => `${form.sourceForm}.${event}`))
    const adapterTurnEndPassed = sourceForms.find((form) => form.sourceForm === "adapter")?.events.turn_end.status === "pass"
    const decision = [
      adapterTurnEndPassed
        ? "OMP requires turn_end boundary normalization, and the normalized live contract passed."
        : "OMP turn_end boundary normalization did not pass the live contract.",
      failedRegisteredEvents.length
        ? `Full live lifecycle parity is not established. Failed registered contracts: ${failedRegisteredEvents.join(", ")}.`
        : "All registered live lifecycle contracts passed.",
    ].join(" ")
    const report = {
      schemaVersion: 1,
      host: "omp",
      expectedVersion: PINNED_OMP_VERSION,
      actualVersion: runtime.versionOutput,
      testedAt: asOf,
      execution: {
        realRuntime: true,
        mode: "rpc",
        extensionFlag: true,
        scratchHome: true,
        scratchProfile: true,
        scratchAgentDir: true,
        manualRealTtyInput: manualInput,
        compactionMechanism: "rpc compact",
        modelMechanism: "loopback OpenAI-compatible deterministic contract provider",
      },
      hostNotes: [
        `OMP ${PINNED_OMP_VERSION} does not load an explicit --extension when --no-extensions is also present despite its help text, so discovery isolation uses an empty scratch PI_CODING_AGENT_DIR instead.`,
        "OMP 16.4.5 interactive input is emitted only by the TUI editor submission path; noninteractive execution cannot mark input as passing.",
      ],
      sourceForms,
      harnessArtifacts,
      toolError,
      taskSessions,
      decision,
      normalization: "OMP turn_end uses message/toolResults rather than legacy Pi last-message fields. OMP tool_result uses input/content/details/isError rather than legacy Pi toolInput/toolResponse. Both production forms normalize at their host boundary.",
      bridgeCapabilityGap: "Closed: the generated release bridge registers and exercises input, turn_end, and tool_result through shared Pi CLI lifecycle entry points.",
      overallPass,
    }
    const serialized = `${JSON.stringify(report, null, 2)}\n`
    if (outputPath) {
      const resolvedOutputPath = path.resolve(outputPath)
      fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true })
      fs.writeFileSync(resolvedOutputPath, serialized)
    }
    process.stdout.write(serialized)
    if (!overallPass) process.exitCode = 1
  } finally {
    await summary.close()
    if (preserve) process.stderr.write(`Preserved OMP contract scratch directory: ${root}\n`)
    else fs.rmSync(root, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
