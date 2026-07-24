import { spawn, spawnSync } from "node:child_process"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import * as fs from "node:fs"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { piCliBridgeSource } from "../src/installer/config.js"
import { isolatedOmpEnvironment } from "./omp-contract-runner.js"

export const DISCOVERY_OMP_VERSION = "17.1.0"
export const DISCOVERY_EXPECTED_TOOLS = [
  "memory_save",
  "memory_suggest",
  "memory_revise",
  "memory_continuity",
  "memory_recall",
  "memory_get",
] as const
const DISCOVERY_MEMORY_TEXT = "OMP 17.1.0 ordinary discovery executed memory_save."

type RpcFrame = Record<string, unknown> & { id?: string; type?: string; command?: string; success?: boolean }

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function parseFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function commandOutput(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(command, args, { encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

export function validateOmpDiscoveryVersion(versionOutput: string): void {
  const match = versionOutput.match(/(?:omp\/|omp v)(\d+\.\d+\.\d+)/u)
  if (match?.[1] !== DISCOVERY_OMP_VERSION) {
    throw new Error(`OMP discovery requires exactly ${DISCOVERY_OMP_VERSION}; received ${versionOutput || "no version output"}`)
  }
}

function requireDiscoveryOmp(): { executable: string; versionOutput: string } {
  const executable = parseFlag("--omp") ?? "omp"
  const versionOutput = commandOutput(executable, ["--version"])
  validateOmpDiscoveryVersion(versionOutput)
  return { executable, versionOutput }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function toolNamesFromPayload(payload: Record<string, unknown>): string[] {
  if (!Array.isArray(payload.tools)) return []
  const names: string[] = []
  for (const tool of payload.tools) {
    if (!isRecord(tool) || !isRecord(tool.function) || typeof tool.function.name !== "string") continue
    names.push(tool.function.name)
  }
  return names
}

async function startLoopbackProvider(logPath: string): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      let payload: Record<string, unknown> = {}
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        if (isRecord(parsed)) payload = parsed
      } catch {
        response.writeHead(400, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: "invalid discovery request" }))
        return
      }
      const toolNames = toolNamesFromPayload(payload)
      const messages = Array.isArray(payload.messages) ? payload.messages.filter(isRecord) : []
      const lastRole = typeof messages.at(-1)?.role === "string" ? messages.at(-1)?.role : undefined
      const selectedTool = lastRole === "tool" ? undefined : "memory_save"
      fs.appendFileSync(logPath, `${JSON.stringify({ toolNames, selectedTool, lastRole })}\n`)
      response.writeHead(200, { "content-type": "text/event-stream" })
      const frame = (delta: Record<string, unknown>, finishReason: string | null) => JSON.stringify({
        id: "chatcmpl-memory-lane-discovery",
        object: "chat.completion.chunk",
        created: 1,
        model: "discovery-model",
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...(finishReason ? { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } : {}),
      })
      if (selectedTool) {
        response.write(`data: ${frame({
          role: "assistant",
          tool_calls: [{
            index: 0,
            id: "call_memory_lane_discovery_save",
            type: "function",
            function: { name: selectedTool, arguments: JSON.stringify({ text: DISCOVERY_MEMORY_TEXT, category: "project" }) },
          }],
        }, null)}\n\n`)
        response.write(`data: ${frame({}, "tool_calls")}\n\n`)
      } else {
        response.write(`data: ${frame({ role: "assistant", content: "Memory Lane discovery and tool execution complete." }, null)}\n\n`)
        response.write(`data: ${frame({}, "stop")}\n\n`)
      }
      response.end("data: [DONE]\n\n")
    })
  })
  const listening = deferred<void>()
  server.once("error", listening.reject)
  server.listen(0, "127.0.0.1", listening.resolve)
  await listening.promise
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Could not start OMP discovery provider")
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      const closing = deferred<void>()
      server.close((error) => error ? closing.reject(error) : closing.resolve())
      await closing.promise
    },
  }
}

function providerExtensionSource(baseUrl: string): string {
  return `export default function discoveryProvider(api: { registerProvider(name: string, config: unknown): void }) {
  api.registerProvider("memory-lane-discovery", {
    baseUrl: ${JSON.stringify(baseUrl)},
    apiKey: "MEMORY_LANE_DISCOVERY_KEY",
    api: "openai-completions",
    models: [{
      id: "discovery-model",
      name: "Memory Lane Discovery Model",
      api: "openai-completions",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 128,
    }],
  })
}
`
}

export function ompDiscoveryCommandPlan(options: {
  executable: string
  projectDir: string
  sessionDir: string
  configPath: string
}): { command: string; args: string[] } {
  return {
    command: options.executable,
    args: [
      "--mode", "rpc",
      "--cwd", options.projectDir,
      "--session-dir", options.sessionDir,
      "--no-skills",
      "--no-rules",
      "--config", options.configPath,
      "--auto-approve",
      "--model", "memory-lane-discovery/discovery-model",
      "--max-time", "60",
    ],
  }
}

export async function closeRpcChild(
  child: ChildProcessWithoutNullStreams,
  graceMs = 5_000,
): Promise<void> {
  child.stdin.end()
  if (child.exitCode !== null) return
  const closed = deferred<void>()
  let terminateTimer: NodeJS.Timeout | undefined
  let killTimer: NodeJS.Timeout | undefined
  const onExit = () => {
    clearTimeout(terminateTimer)
    clearTimeout(killTimer)
    closed.resolve()
  }
  child.once("exit", onExit)
  if (child.exitCode !== null) {
    child.removeListener("exit", onExit)
    return
  }
  terminateTimer = setTimeout(() => {
    child.kill("SIGTERM")
    killTimer = setTimeout(() => child.kill("SIGKILL"), graceMs)
  }, graceMs)
  await closed.promise
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
        try {
          const parsed: unknown = JSON.parse(line)
          this.frames.push(isRecord(parsed) ? parsed : { type: "unparsed", line })
        } catch {
          this.frames.push({ type: "unparsed", line })
        }
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
      pending.reject(new Error(`Timed out waiting for OMP discovery RPC frame. stderr: ${this.stderr.join("").trim()}`))
    }, timeoutMs)
    this.#waiters.add(wake)
    this.child.once("exit", (code) => {
      if (!this.frames.find(predicate)) pending.reject(new Error(`OMP discovery RPC exited with ${code}. stderr: ${this.stderr.join("").trim()}`))
    })
    return await pending.promise
  }

  async close(): Promise<void> {
    return closeRpcChild(this.child)
  }
}


async function runDiscoveryCase(options: {
  form: "source-default" | "source-override"
  executable: string
  root: string
  baseUrl: string
  providerLog: string
  cliPath: string
  override: boolean
}): Promise<{
  sourceForm: "cli-bridge"
  installMode: "default" | "override"
  commands: string[]
  tools: string[]
  selectedTools: string[]
  persistedMemory: string
}> {
  const caseRoot = path.join(options.root, options.form)
  const homeDir = path.join(caseRoot, "home")
  const projectDir = path.join(caseRoot, "project")
  const sessionDir = path.join(caseRoot, "sessions")
  const agentDir = options.override ? path.join(caseRoot, "custom-agent") : path.join(homeDir, ".omp", "agent")
  const configPath = path.join(caseRoot, "omp-discovery.yml")
  const memoryPath = path.join(caseRoot, "memory.jsonl")
  const embeddingsPath = path.join(caseRoot, "embeddings.jsonl")
  const memoryConfigPath = path.join(caseRoot, "memory-config.json")
  fs.mkdirSync(projectDir, { recursive: true })
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.mkdirSync(agentDir, { recursive: true })
  fs.mkdirSync(path.join(agentDir, "extensions"), { recursive: true })
  fs.writeFileSync(path.join(agentDir, "last-changelog-version"), DISCOVERY_OMP_VERSION)
  fs.writeFileSync(configPath, "setupVersion: 1\nstartup:\n  setupWizard: false\n  showSplash: false\n")
  fs.writeFileSync(memoryConfigPath, JSON.stringify({ semantic: { enabled: false } }))
  fs.writeFileSync(path.join(agentDir, "extensions", "00-memory-lane-discovery-provider.ts"), providerExtensionSource(options.baseUrl), { encoding: "utf8", flag: "w" })
  const providerEntryCount = fs.existsSync(options.providerLog)
    ? fs.readFileSync(options.providerLog, "utf8").trim().split("\n").filter(Boolean).length
    : 0

  const binaryPath = options.cliPath
  const expectedSource = piCliBridgeSource(binaryPath)

  const env = isolatedOmpEnvironment(process.env, {
    HOME: homeDir,
    OMP_SKIP_SETUP: "1",
    MEMORY_LANE_DISCOVERY_KEY: "discovery-only",
    MEMORY_LANE_FILE: memoryPath,
    MEMORY_LANE_EMBEDDINGS_FILE: embeddingsPath,
    MEMORY_LANE_CONFIG: memoryConfigPath,
    PI_MEMORY_FILE: memoryPath,
    PI_MEMORY_EMBEDDINGS_FILE: embeddingsPath,
    PI_MEMORY_CONFIG_FILE: memoryConfigPath,
    MEMORY_LANE_INSTALL_BINARY: options.cliPath,
  })
  if (options.override) env.PI_CODING_AGENT_DIR = agentDir
  else delete env.PI_CODING_AGENT_DIR

  commandOutput(process.execPath, [options.cliPath, "init", "--only", "omp", "--yes"], env)
  const installedConfigPath = path.join(agentDir, "extensions", "memory-lane", "index.ts")
  if (!fs.existsSync(installedConfigPath)) throw new Error(`OMP discovery init did not write ${installedConfigPath}`)
  if (fs.readFileSync(installedConfigPath, "utf8") !== expectedSource) throw new Error(`${options.form} installed artifact differs from production source`)

  const plan = ompDiscoveryCommandPlan({ executable: options.executable, projectDir, sessionDir, configPath })
  for (const forbiddenFlag of ["--tools", "--extension", "--profile"]) {
    if (plan.args.includes(forbiddenFlag)) throw new Error(`OMP discovery plan must not pass ${forbiddenFlag}`)
  }
  const rpc = new RpcSession(plan.command, plan.args, env)
  let commands: string[] = []
  try {
    await rpc.waitFor((frame) => frame.type === "ready")
    rpc.send({ id: "commands", type: "get_available_commands" })
    const response = await rpc.waitFor((frame) => frame.type === "response" && frame.id === "commands" && frame.command === "get_available_commands")
    const data = isRecord(response.data) ? response.data : {}
    commands = Array.isArray(data.commands)
      ? data.commands.filter(isRecord).map((command) => typeof command.name === "string" ? command.name : "").filter(Boolean)
      : []
    rpc.send({ id: "prompt", type: "prompt", message: "Verify installed Memory Lane discovery." })
    await rpc.waitFor((frame) => frame.type === "agent_end")
  } finally {
    await rpc.close()
  }

  const providerEntries = fs.existsSync(options.providerLog)
    ? fs.readFileSync(options.providerLog, "utf8").trim().split("\n").filter(Boolean).slice(providerEntryCount).map((line) => JSON.parse(line) as { toolNames?: unknown; selectedTool?: unknown })
    : []
  const tools = [...new Set(providerEntries.flatMap((entry) => Array.isArray(entry.toolNames) ? entry.toolNames.filter((name): name is string => typeof name === "string") : []))]
  const selectedTools = providerEntries.map((entry) => entry.selectedTool).filter((name): name is string => typeof name === "string")
  for (const command of ["memory", "remember"]) {
    if (!commands.includes(command)) throw new Error(`${options.form} discovery did not register /${command}`)
  }
  for (const tool of DISCOVERY_EXPECTED_TOOLS) {
    if (!tools.includes(tool)) throw new Error(`${options.form} discovery did not expose ${tool}`)
  }
  if (!selectedTools.includes("memory_save")) throw new Error(`${options.form} provider did not select memory_save`)
  if (!fs.existsSync(memoryPath)) throw new Error(`${options.form} memory_save did not create isolated memory storage`)
  const persistedRecords = fs.readFileSync(memoryPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { text?: unknown; status?: unknown })
  const persisted = persistedRecords.find((record) => record.text === DISCOVERY_MEMORY_TEXT && record.status === "approved")
  if (!persisted) throw new Error(`${options.form} memory_save did not persist the expected approved memory in isolated storage`)
  return {
    sourceForm: "cli-bridge",
    installMode: options.override ? "override" : "default",
    commands,
    tools,
    selectedTools,
    persistedMemory: DISCOVERY_MEMORY_TEXT,
  }
}

async function main(): Promise<void> {
  const runtime = requireDiscoveryOmp()
  const currentFile = fileURLToPath(import.meta.url)
  const cliRoot = path.resolve(path.dirname(currentFile), "..")
  const cliPath = path.join(cliRoot, "dist", "index.js")
  if (!fs.existsSync(cliPath)) throw new Error("Build @memory-lane/cli before running OMP discovery")

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-omp-discovery-"))
  const providerLog = path.join(root, "provider.jsonl")
  const provider = await startLoopbackProvider(providerLog)
  try {
    const cases = [
      await runDiscoveryCase({ form: "source-default", executable: runtime.executable, root, baseUrl: provider.baseUrl, providerLog, cliPath, override: false }),
      await runDiscoveryCase({ form: "source-override", executable: runtime.executable, root, baseUrl: provider.baseUrl, providerLog, cliPath, override: true }),
    ]
    console.log(JSON.stringify({
      schemaVersion: 1,
      host: "omp",
      expectedVersion: DISCOVERY_OMP_VERSION,
      actualVersion: runtime.versionOutput,
      extensionFlag: false,
      toolsFlag: false,
      profileFlag: false,
      networkModelRequired: false,
      scratchHome: true,
      scratchAgentRoots: true,
      cases,
      overallPass: true,
    }, null, 2))
  } finally {
    await provider.close()
    if (!process.argv.includes("--preserve")) fs.rmSync(root, { recursive: true, force: true })
    else console.error(`Preserved OMP discovery scratch root: ${root}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
