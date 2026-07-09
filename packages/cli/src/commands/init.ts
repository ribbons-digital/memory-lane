import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as readline from "node:readline"
import { detectHarnesses, findDetected, harnessName } from "../installer/detect.js"
import { hasExistingMemoryLaneConfig, installHarness } from "../installer/config.js"
import type { DetectedHarness, Harness, InitOptions, InitResult, IntegrationResult } from "../installer/types.js"
import { VERSION } from "../version.js"

export const INIT_SKIPPED_BY_USER = "skipped by user"

export function failedInitIntegrations(integrations: IntegrationResult[]): IntegrationResult[] {
  return integrations.filter((integration) => !integration.configured && integration.message !== INIT_SKIPPED_BY_USER)
}

async function prompt(question: string, defaultValue: string = ""): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await new Promise((resolve) => {
      const suffix = defaultValue ? ` [${defaultValue}]: ` : ": "
      rl.question(question + suffix, (answer) => {
        resolve(answer.trim() || defaultValue)
      })
    })
  } finally {
    rl.close()
  }
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

const HARNESS_ALIASES: Record<string, Harness> = {
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

function writeInstallManifest(options: InitOptions, result: InitResult): void {
  const manifestPath = path.join(options.dataDir, "install.json")
  const manifest = {
    version: VERSION,
    installedAt: new Date().toISOString(),
    binaryPath: options.binaryPath,
    dataDir: options.dataDir,
    integrations: result.integrations.filter((i) => i.configured).map((i) => ({
      harness: i.harness,
      configPath: i.configPath,
    })),
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8")
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
  }

  const harnesses = detectHarnesses({ homeDir })
  if (listOnly) {
    console.log("Memory Lane integrations:")
    console.log(renderHarnessList(harnesses))
    return { binaryPath, dataDir, integrations: [] }
  }

  const selected = only
    ? parseHarnessTokens(only, harnesses)
    : all
      ? harnesses.map((h) => h.harness)
      : (yes || recommended)
        ? findDetected(harnesses).map((h) => h.harness)
        : await runInteractive(options, harnesses)

  const integrations: IntegrationResult[] = []
  for (const harness of selected) {
    try {
      const detected = findDetected(harnesses).find((h) => h.harness === harness)
      const configPath = detected?.configPath
      if (!options.yes && configPath && hasExistingMemoryLaneConfig(harness, configPath)) {
        const ok = await confirm(`${harnessName(harness)} already has a Memory Lane configuration. Overwrite?`, true)
        if (!ok) {
          integrations.push({ harness, configured: false, message: INIT_SKIPPED_BY_USER })
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

  const result: InitResult = { binaryPath, dataDir, integrations }
  writeInstallManifest(options, result)

  const failedIntegrations = failedInitIntegrations(integrations)
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
}
