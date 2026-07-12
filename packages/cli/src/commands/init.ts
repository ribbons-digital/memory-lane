import { getDefaultConfigPath, readRawConfig, writeConfig } from "@memory-lane/core"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as readline from "node:readline"
import { detectHarnesses, findDetected, harnessName } from "../installer/detect.js"
import { hasExistingMemoryLaneConfig, installHarness } from "../installer/config.js"
import {
  mergeManifestIntegrations,
  readInstallManifest,
  writeInstallManifest,
} from "../installer/manifest.js"
import type { DetectedHarness, Harness, InitOptions, InitResult, IntegrationResult } from "../installer/types.js"
import { VERSION } from "../version.js"

type PromiseResolvers<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function promiseWithResolvers<T>(): PromiseResolvers<T> {
  const promiseConstructor = Promise as PromiseConstructor & { withResolvers?: <Value>() => PromiseResolvers<Value> }
  if (promiseConstructor.withResolvers) return promiseConstructor.withResolvers<T>()
  let resolve!: PromiseResolvers<T>["resolve"]
  let reject!: PromiseResolvers<T>["reject"]
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const INIT_SKIPPED_BY_USER = "skipped by user"

interface PromptResult {
  answer: string
  answered: boolean
}

let promptInterface: readline.Interface | undefined
let promptInputClosed = false
let closingPromptInterface = false

function getPromptInterface(): readline.Interface {
  if (!promptInterface) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.once("close", () => {
      if (promptInterface === rl) promptInterface = undefined
      if (!closingPromptInterface) promptInputClosed = true
    })
    promptInterface = rl
  }
  return promptInterface
}

function closePromptInterface(): void {
  if (!promptInterface) return
  closingPromptInterface = true
  try {
    promptInterface.close()
  } finally {
    promptInterface = undefined
    closingPromptInterface = false
  }
}

async function promptResult(question: string, defaultValue: string = ""): Promise<PromptResult> {
  if (promptInputClosed) return { answer: defaultValue, answered: false }
  const rl = getPromptInterface()
  const { promise, resolve } = promiseWithResolvers<PromptResult>()
  const suffix = defaultValue ? ` [${defaultValue}]: ` : ": "
  let settled = false
  const finish = (answer: string, answered: boolean) => {
    if (settled) return
    settled = true
    rl.off("close", onClose)
    resolve({ answer: answer.trim() || defaultValue, answered })
  }
  const onClose = () => {
    promptInputClosed = true
    if (promptInterface === rl) promptInterface = undefined
    finish(defaultValue, false)
  }
  rl.once("close", onClose)
  rl.question(question + suffix, (answer) => finish(answer, true))
  return await promise
}

async function prompt(question: string, defaultValue: string = ""): Promise<string> {
  return (await promptResult(question, defaultValue)).answer
}

async function confirm(question: string, defaultValue: boolean = true): Promise<boolean> {
  const suffix = defaultValue ? " [Y/n]: " : " [y/N]: "
  const answer = await prompt(question + suffix, defaultValue ? "Y" : "N")
  return answer.toLowerCase().startsWith("y")
}

function resolveBinaryPath(): string {
  if (process.env.MEMORY_LANE_INSTALL_BINARY) return path.resolve(process.env.MEMORY_LANE_INSTALL_BINARY)
  // When compiled, process.execPath is the binary itself.
  return process.execPath
}

function resolveHomeDir(): string {
  return process.env.HOME || os.homedir()
}

function ensureDataDir(dataDir: string): void {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
}

function learningCaptureConfigured(configPath: string): boolean {
  const raw = readRawConfig(configPath)
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false
  const learning = "learning" in raw ? raw.learning : undefined
  if (!learning || typeof learning !== "object" || Array.isArray(learning)) return false
  return "capture" in learning
}

async function askLearningConsent(configPath: string): Promise<void> {
  if (learningCaptureConfigured(configPath)) return
  console.log("")
  console.log("Memory Lane can learn from how you use it - locally, on this machine.")
  console.log("Sessions are redacted and never leave your computer. You approve every change it proposes.")
  const result = await promptResult("Enable local learning? [y/N]", "")
  if (!result.answered) return
  writeConfig(configPath, { learning: { capture: result.answer.toLowerCase().startsWith("y") ? "on" : "off" } })
}


function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`)
}

function flagValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const inline = argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const idx = argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  const next = argv[idx + 1]
  return next && !next.startsWith("--") ? next : undefined
}

export const HARNESS_ALIASES: Record<string, Harness> = {
  "claude-code": "claude-code-cli",
  "claude-code-cli": "claude-code-cli",
  claude: "claude-code-cli",
  "codex-cli": "codex-cli",
  codex: "codex-cli",
  "claude-desktop": "claude-desktop",
  "claude-desktop-mcp": "claude-desktop",
  "codex-desktop": "codex-desktop",
  "codex-desktop-mcp": "codex-desktop",
  pi: "pi",
  omp: "omp",
}

function dedupeHarnesses(harnesses: Harness[]): Harness[] {
  const seen = new Set<Harness>()
  const result: Harness[] = []
  for (const harness of harnesses) {
    if (seen.has(harness)) continue
    seen.add(harness)
    result.push(harness)
  }
  return result
}

function parseHarnessTokens(raw: string, harnesses: DetectedHarness[]): Harness[] {
  const byNumber = new Map(harnesses.map((h, index) => [String(index + 1), h.harness]))
  const selected = raw
    .split(/[\s,]+/u)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .map((token) => byNumber.get(token) ?? HARNESS_ALIASES[token])
    .filter((harness): harness is Harness => Boolean(harness))
  return dedupeHarnesses(selected)
}

function renderHarnessList(harnesses: DetectedHarness[]): string {
  return harnesses
    .map((h, index) => `  ${index + 1}. ${h.name.padEnd(20)} ${h.detected ? "detected" : "not detected"}`)
    .join("\n")
}

function persistInstallManifest(
  options: InitOptions,
  result: InitResult,
  previousIntegrations: Record<string, unknown>[],
): void {
  const configured = result.integrations
    .filter((integration) => integration.configured && integration.configPath)
    .map((integration) => ({
      harness: integration.harness,
      configPath: integration.configPath,
    }))
  writeInstallManifest(options.dataDir, {
    version: VERSION,
    installedAt: new Date().toISOString(),
    binaryPath: options.binaryPath,
    dataDir: options.dataDir,
    integrations: mergeManifestIntegrations(previousIntegrations, configured),
  })
}

async function runInteractive(options: InitOptions, harnesses: DetectedHarness[]): Promise<Harness[]> {
  console.log("Memory Lane helps your AI remember useful context. Let's wire it up.\n")
  console.log("Integrations:")
  console.log(renderHarnessList(harnesses))
  console.log("\nSelect integrations to configure:")
  console.log("  recommended = all detected integrations")
  console.log("  all         = every supported integration")
  console.log("  none        = skip integration setup")
  console.log("  numbers     = e.g. 1,3,4")

  const answer = await prompt("Select integrations", "recommended")
  const normalized = answer.trim().toLowerCase()
  if (normalized === "" || normalized === "r" || normalized === "recommended") return findDetected(harnesses).map((h) => h.harness)
  if (normalized === "a" || normalized === "all") return harnesses.map((h) => h.harness)
  if (normalized === "n" || normalized === "none") return []
  return parseHarnessTokens(normalized, harnesses)
}

export async function handleInit(argv: string[]): Promise<InitResult> {
  const yes = hasFlag(argv, "yes")
  const listOnly = hasFlag(argv, "list")
  const only = flagValue(argv, "only")
  const all = hasFlag(argv, "all")
  const recommended = hasFlag(argv, "recommended")
  const projectMode = argv.includes("--project")
  const projectPathFlag = argv[argv.indexOf("--project") + 1]
  const projectPath = projectMode && projectPathFlag && !projectPathFlag.startsWith("-") ? projectPathFlag : process.cwd()

  const binaryPath = resolveBinaryPath()
  const homeDir = resolveHomeDir()
  const dataDir = path.join(homeDir, ".memory-lane")
  ensureDataDir(dataDir)

  const options: InitOptions = {
    binaryPath,
    dataDir,
    projectMode,
    projectPath,
    yes,
    homeDir,
    env: process.env,
  }

  const harnesses = detectHarnesses({ homeDir, env: process.env })
  if (listOnly) {
    console.log("Memory Lane integrations:")
    console.log(renderHarnessList(harnesses))
    return { binaryPath, dataDir, integrations: [], failedIntegrations: [] }
  }
  const existingManifest = readInstallManifest(dataDir)
  if (existingManifest.status === "malformed" || existingManifest.status === "partial") {
    throw new Error(existingManifest.warnings.join(" "))
  }
  const previousIntegrations = existingManifest.status === "valid"
    ? existingManifest.manifest.integrations
    : []

  try {
    const selected = only
      ? parseHarnessTokens(only, harnesses)
      : all
        ? harnesses.map((h) => h.harness)
        : (yes || recommended)
          ? findDetected(harnesses).map((h) => h.harness)
          : await runInteractive(options, harnesses)
    if (!yes && !recommended && !all && !only) {
      await askLearningConsent(getDefaultConfigPath())
    }

    const integrations: IntegrationResult[] = []
    for (const harness of selected) {
      try {
        const detected = findDetected(harnesses).find((h) => h.harness === harness)
        const configPath = detected?.configPath
        if (!options.yes && configPath && hasExistingMemoryLaneConfig(harness, configPath)) {
          const ok = await confirm(`${harnessName(harness)} already has a Memory Lane configuration. Overwrite?`, true)
          if (!ok) {
            integrations.push({ harness, configured: false, skipped: true, message: INIT_SKIPPED_BY_USER })
            console.log(`  - ${harnessName(harness)} skipped`)
            continue
          }
        }
        const result = installHarness(harness, options)
        integrations.push(result)
        console.log(`  ✓ ${harnessName(harness)} configured`)
        if (result.message) console.log(`    ${result.message}`)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        integrations.push({ harness, configured: false, message })
        console.log(`  ✗ ${harnessName(harness)} failed: ${message}`)
      }
    }

    const failedIntegrations = integrations.filter((integration) => !integration.configured && !integration.skipped)
    const result: InitResult = { binaryPath, dataDir, integrations, failedIntegrations }
    persistInstallManifest(options, result, previousIntegrations)
    if (failedIntegrations.length) {
      console.log("\nMemory Lane init completed with errors.")
      console.log(`Failed integrations: ${failedIntegrations.map((integration) => harnessName(integration.harness)).join(", ")}`)
      console.log(`Data directory: ${dataDir}`)
      return result
    }

    console.log("\nDone. Memory Lane is ready.")
    console.log(`Data directory: ${dataDir}`)
    console.log("Try: memory-lane save \"always use pnpm\" --status approved")
    return result
  } finally {
    closePromptInterface()
  }
}
