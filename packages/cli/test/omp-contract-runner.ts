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
type EventStatus = "pass" | "fail" | "not-registered-by-production-design"

type LogEntry = {
  kind: "registration" | "event" | "mechanism"
  name: string
  eventShape?: Record<string, string>
  contextShape?: Record<string, string>
  resultShape?: Record<string, string>
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
  ],
}


const EXPECTED_EVENTS: Record<SourceForm, ReadonlySet<ContractEvent>> = {
  adapter: new Set(CONTRACT_EVENTS),
  bridge: new Set(["before_agent_start", "session_before_compact"]),
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
  commandOutput("expect", ["-v"])
  return { executable, versionOutput }
}

function wrapperSource(targetPath: string, logPath: string): string {
  return `import * as fs from "node:fs"\n\nconst TARGET = ${JSON.stringify(pathToFileURL(targetPath).href)}\nconst LOG = ${JSON.stringify(logPath)}\n\nfunction shape(value) {\n  if (!value || typeof value !== "object") return {}\n  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Array.isArray(item) ? "array" : item === null ? "null" : typeof item]))\n}\n\nfunction record(entry) { fs.appendFileSync(LOG, JSON.stringify(entry) + "\\n") }\n\nexport default async function instrumentedMemoryLaneExtension(api) {\n  // Runtime-selected scratch artifact intentionally exercises OMP's real extension loader.\n  const mod = await import(TARGET + "?contract=" + Date.now())\n  const factory = typeof mod.default === "function" ? mod.default : mod.default?.default\n  if (typeof factory !== "function") throw new Error("Memory Lane extension factory missing")\n  const proxy = new Proxy(api, {\n    get(target, property, receiver) {\n      if (property === "on") return (name, handler) => {\n        record({ kind: "registration", name })\n        return target.on(name, async (event, ctx) => {\n          const contextShape = { ...shape(ctx), uiNotify: typeof ctx?.ui?.notify, sessionFile: typeof ctx?.sessionManager?.getSessionFile, sessionBranch: typeof ctx?.sessionManager?.getBranch }\n          const result = await handler(event, ctx)\n          record({ kind: "event", name, eventShape: shape(event), contextShape, resultShape: shape(result) })\n          return result\n        })\n      }\n      if (property === "registerCommand") return (name, command) => { record({ kind: "registration", name: "command:" + name }); return target.registerCommand(name, command) }\n      if (property === "registerTool") return (tool) => { record({ kind: "registration", name: "tool:" + tool.name }); return target.registerTool(tool) }\n      const value = Reflect.get(target, property, receiver)\n      return typeof value === "function" ? value.bind(target) : value\n    },\n  })\n  return factory(proxy)\n}\n`
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
  wrapperPath: string
  logPath: string
  env: NodeJS.ProcessEnv
}): Promise<void> {
  const beforeInput = readLog(options.logPath).filter((entry) => entry.kind === "event" && entry.name === "input").length
  const beforeStart = readLog(options.logPath).filter((entry) => entry.kind === "event" && entry.name === "before_agent_start").length
  const expectPath = path.join(path.dirname(options.logPath), "interactive-input.exp")
  fs.writeFileSync(expectPath, [
    "set timeout 30",
    "log_user 0",
    "spawn $env(OMP_CONTRACT_EXECUTABLE) --profile $env(OMP_CONTRACT_PROFILE) --cwd $env(OMP_CONTRACT_CWD) --session-dir $env(OMP_CONTRACT_SESSION_DIR) --no-skills --no-rules --extension $env(OMP_CONTRACT_EXTENSION) --auto-approve --max-time 30",
    "after 5000",
    "send -- \"Remember that interactive OMP input preserves the contract sentinel.\\r\"",
    "after 10000",
    "send -- \\003",
    "after 200",
    "send -- \"/exit\\r\"",
    "expect eof",
  ].join("\n"))
  const child = spawn("expect", ["-f", expectPath], {
    env: {
      ...options.env,
      OMP_CONTRACT_EXECUTABLE: options.executable,
      OMP_CONTRACT_PROFILE: options.profile,
      OMP_CONTRACT_CWD: options.projectDir,
      OMP_CONTRACT_SESSION_DIR: options.sessionDir,
      OMP_CONTRACT_EXTENSION: options.wrapperPath,
    },
    stdio: ["ignore", "ignore", "pipe"],
  })
  const stderr: string[] = []
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => stderr.push(chunk))
  try {
    await waitForLogEvent(options.logPath, "input", beforeInput)
    await waitForLogEvent(options.logPath, "before_agent_start", beforeStart)
  } catch (error) {
    const note = "OMP interactive PTY loaded and registered the adapter, but no input event was observed within 30 seconds."
    fs.appendFileSync(options.logPath, `${JSON.stringify({ kind: "mechanism", name: "input", note })}\n`)
  } finally {
    child.kill("SIGTERM")
  }
}

function eventResult(form: SourceForm, event: ContractEvent, entries: LogEntry[], memoryText: string, toolExecuted: boolean): { status: EventStatus; evidence: string[] } {
  if (!EXPECTED_EVENTS[form].has(event)) {
    return { status: "not-registered-by-production-design", evidence: ["packages/cli/src/installer/config.ts: piCliBridgeSource omits this handler"] }
  }
  const registrations = entries.filter((entry) => entry.kind === "registration" && entry.name === event)
  const observations = entries.filter((entry) => entry.kind === "event" && entry.name === event)
  const evidence = observations.map((entry) => `event=${JSON.stringify(entry.eventShape)} context=${JSON.stringify(entry.contextShape)} result=${JSON.stringify(entry.resultShape)}`)
  if (!registrations.length) return { status: "fail", evidence: ["expected handler was not registered"] }
  if (!observations.length) {
    const mechanismNotes = entries.filter((entry) => entry.kind === "mechanism" && entry.name === event).map((entry) => entry.note ?? "host mechanism failed")
    if (event === "tool_result") {
      mechanismNotes.push(toolExecuted
        ? "The pnpm test sentinel proves bash executed, but OMP emitted no tool_result event; this is a host contract failure."
        : "The pnpm test sentinel was absent, so the configured model did not execute the forced tool; OMP source confirms tool_result emission only after execution and the live payload remains unverified.")
    }
    return { status: "fail", evidence: ["registered handler was not observed under the real OMP runtime", ...mechanismNotes] }
  }

  const rawShape = observations.at(-1)?.eventShape ?? {}
  const ompFields: Partial<Record<ContractEvent, string[]>> = {
    input: ["text", "source"],
    before_agent_start: ["prompt"],
    turn_end: ["message", "toolResults"],
    tool_result: ["toolName", "input", "content", "isError"],
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

  const context = observations.at(-1)?.contextShape ?? {}
  const missingContext = ["cwd", "uiNotify", "sessionFile", "sessionBranch"].filter((key) => context[key] === "undefined")
  if (missingContext.length) return { status: "fail", evidence: [...evidence, `missing context surface: ${missingContext.join(", ")}`] }

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

async function startSummaryServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    request.resume()
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ choices: [{ message: { content: "- OMP contract compaction summary." } }] }))
    })
  })
  const { promise, resolve, reject } = deferred<void>()
  server.once("error", reject)
  server.listen(0, "127.0.0.1", resolve)
  await promise
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Could not start summary server")
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
      "--tools", "bash",
      "--append-system-prompt", "Contract instruction: obey explicit requests to call the bash tool exactly once.",
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
}): Promise<{ form: SourceForm; entries: LogEntry[]; events: Record<ContractEvent, { status: EventStatus; evidence: string[] }> }> {
  const formDir = path.join(options.root, options.form)
  const projectDir = path.join(formDir, "project")
  const agentDir = path.join(formDir, "agent")
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
  fs.writeFileSync(path.join(agentDir, "last-changelog-version"), PINNED_OMP_VERSION)
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(ompConfigPath, "compaction:\n  keepRecentTokens: 1\n")
  fs.writeFileSync(path.join(projectDir, ".memory-lane-scope"), JSON.stringify({ id: `omp-contract-${options.form}` }))
  fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ private: true, scripts: { test: "node -e \"require('node:fs').writeFileSync('omp-tool-executed', 'yes')\" && printf 'OMP_CONTRACT_TEST_PASSED\\n'" } }))
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
  fs.writeFileSync(wrapperPath, wrapperSource(targetPath, logPath))

  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    MEMORY_LANE_FILE: memoryPath,
    MEMORY_LANE_EMBEDDINGS_FILE: embeddingsPath,
    MEMORY_LANE_CONFIG: configPath,
    PI_MEMORY_FILE: memoryPath,
    PI_MEMORY_EMBEDDINGS_FILE: embeddingsPath,
    PI_MEMORY_CONFIG_FILE: configPath,
  }
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
    await rpc.prompt("turn", "Reply exactly with this durable statement and nothing else: Released v9.9.9 after OMP contract verification.")
    await rpc.prompt("tool", "You MUST call the bash tool exactly once with the command `pnpm test`. After it succeeds, reply briefly.")
    const compactCount = readLog(logPath).filter((entry) => entry.kind === "event" && entry.name === "session_before_compact").length
    rpc.compact("compact")
    await waitForLogEvent(logPath, "session_before_compact", compactCount)
    await waitForFileIncludes(memoryPath, "OMP contract compaction summary")
  } finally {
    await rpc.close()
  }
  if (options.form === "adapter") {
    await runInteractiveInput({ executable: options.executable, profile: `${options.profile}-interactive`, projectDir, sessionDir, wrapperPath, logPath, env })
  }
  const memoryText = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, "utf8") : ""
  const entries = readLog(logPath)
  return {
    form: options.form,
    entries,
    events: Object.fromEntries(CONTRACT_EVENTS.map((event) => [event, eventResult(options.form, event, entries, memoryText, fs.existsSync(path.join(projectDir, "omp-tool-executed")))])) as Record<ContractEvent, { status: EventStatus; evidence: string[] }>,
  }
}

async function main(): Promise<void> {
  const asOf = parseFlag("--as-of") ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(asOf)) throw new Error("--as-of must use YYYY-MM-DD")
  const outputPath = parseFlag("--out")
  const preserve = process.argv.includes("--preserve")
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
  const summary = await startSummaryServer()
  try {
    const adapter = await runSourceForm({
      form: "adapter",
      executable: runtime.executable,
      root,
      targetSource: piAdapterImportSource(adapterPath),
      profile: `memory-lane-contract-adapter-${process.pid}`,
      summaryBaseUrl: summary.baseUrl,
      cliPath,
    })
    const bridge = await runSourceForm({
      form: "bridge",
      executable: runtime.executable,
      root,
      targetSource: piCliBridgeSource(cliPath),
      profile: `memory-lane-contract-bridge-${process.pid}`,
      summaryBaseUrl: summary.baseUrl,
      cliPath,
    })
    const sourceForms = [adapter, bridge].map((result) => ({
      sourceForm: result.form,
      registrations: [...new Set(result.entries.filter((entry) => entry.kind === "registration").map((entry) => entry.name))],
      events: result.events,
    }))
    const overallPass = sourceForms.every((form) => Object.values(form.events).every((event) => event.status !== "fail"))
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
      execution: { realRuntime: true, mode: "rpc", extensionFlag: true, scratchProfile: true, scratchAgentDir: true, compactionMechanism: "rpc compact" },
      hostNotes: [`OMP ${PINNED_OMP_VERSION} does not load an explicit --extension when --no-extensions is also present despite its help text, so discovery isolation uses an empty scratch PI_CODING_AGENT_DIR instead.`],
      sourceForms,
      taskSessions: { status: "unobserved", reason: "Deterministic task-session invocation is not part of the five-event host contract." },
      decision,
      normalization: "OMP turn_end uses message/toolResults rather than legacy Pi last-message fields; the adapter normalizes from the OMP message and session branch. Both source forms already normalize OMP compaction preparation and omit unavailable turnId safely.",
      bridgeCapabilityGap: "The production release bridge does not register input, turn_end, or tool_result. Slice 1 records this existing gap without adding capability handlers.",
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
