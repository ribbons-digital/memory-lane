import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as readline from "node:readline"
import { detectHarnesses, findDetected, harnessName } from "../installer/detect.js"
import { hasExistingMemoryLaneConfig, installHarness } from "../installer/config.js"
import type { DetectedHarness, Harness, InitOptions, InitResult, IntegrationResult } from "../installer/types.js"

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

function writeInstallManifest(options: InitOptions, result: InitResult): void {
  const manifestPath = path.join(options.dataDir, "install.json")
  const manifest = {
    version: "0.1.0",
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

  const detected = findDetected(harnesses)
  if (detected.length === 0) {
    console.log("No supported harnesses detected. Install Claude Code, Codex, Claude Desktop, Codex Desktop, or pi first.")
    return []
  }

  console.log("Detected integrations:")
  for (const h of harnesses) {
    console.log(`  [${h.detected ? "x" : " "}] ${h.name}${h.detected ? "" : " (not found)"}`)
  }

  const selected: Harness[] = []
  for (const h of detected) {
    if (await confirm(`Set up ${h.name}?`, true)) {
      selected.push(h.harness)
    }
  }

  return selected
}

export async function handleInit(argv: string[]): Promise<InitResult> {
  const yes = argv.includes("--yes")
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
  const selected = yes ? findDetected(harnesses).map((h) => h.harness) : await runInteractive(options, harnesses)

  const integrations: IntegrationResult[] = []
  for (const harness of selected) {
    try {
      const detected = findDetected(harnesses).find((h) => h.harness === harness)
      const configPath = detected?.configPath
      if (!options.yes && configPath && hasExistingMemoryLaneConfig(harness, configPath)) {
        const ok = await confirm(`${harnessName(harness)} already has a Memory Lane configuration. Overwrite?`, true)
        if (!ok) {
          integrations.push({ harness, configured: false, message: "skipped by user" })
          console.log(`  - ${harnessName(harness)} skipped`)
          continue
        }
      }
      integrations.push(installHarness(harness, options))
      console.log(`  ✓ ${harnessName(harness)} configured`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      integrations.push({ harness, configured: false, message })
      console.log(`  ✗ ${harnessName(harness)} failed: ${message}`)
    }
  }

  const result: InitResult = { binaryPath, dataDir, integrations }
  writeInstallManifest(options, result)

  console.log("\nDone. Memory Lane is ready.")
  console.log(`Data directory: ${dataDir}`)
  console.log("Try: memory-lane save \"always use pnpm\" --status approved")

  return result
}
