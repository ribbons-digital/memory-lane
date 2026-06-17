import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { installHarness } from "../installer/config.js"
import type { Harness, InitOptions, IntegrationResult } from "../installer/types.js"

const INSTALLER_URL = "https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh"
const WINDOWS_INSTALLER_URL = "https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.ps1"

export interface InstallManifest {
  version: string
  installedAt: string
  binaryPath: string
  dataDir: string
  integrations: Array<{ harness: Harness | string; configPath: string }>
}

export interface ReapplyInstallManifestResult {
  results: IntegrationResult[]
  configuredCount: number
  manifest: InstallManifest
}

function commandExists(cmd: string): boolean {
  return spawnSync(os.platform() === "win32" ? "where" : "command", ["-v", cmd], { stdio: "ignore" }).status === 0
}

function runInstaller(scriptPath: string): boolean {
  const isWindows = os.platform() === "win32"
  const result = isWindows
    ? spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], { stdio: "inherit" })
    : spawnSync("sh", [scriptPath], { stdio: "inherit" })
  return result.status === 0
}

function downloadWithCurl(url: string, dest: string): boolean {
  const result = spawnSync("curl", ["-fsSL", url, "-o", dest], { stdio: "inherit" })
  return result.status === 0
}

function downloadWithWget(url: string, dest: string): boolean {
  const result = spawnSync("wget", ["-q", url, "-O", dest], { stdio: "inherit" })
  return result.status === 0
}

function download(url: string, dest: string): boolean {
  if (commandExists("curl")) return downloadWithCurl(url, dest)
  if (commandExists("wget")) return downloadWithWget(url, dest)
  return false
}

function runInit(yes: boolean): boolean {
  const args = yes ? ["init", "--yes"] : ["init"]
  const result = spawnSync("memory-lane", args, { stdio: "inherit" })
  return result.status === 0
}

function readManifest(dataDir: string): InstallManifest | undefined {
  const manifestPath = path.join(dataDir, "install.json")
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as InstallManifest
  } catch {
    return undefined
  }
}

function writeManifest(manifest: InstallManifest): void {
  const manifestPath = path.join(manifest.dataDir, "install.json")
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8")
}

const KNOWN_HARNESSES: readonly Harness[] = ["claude-code-cli", "codex-cli", "claude-desktop", "codex-desktop", "pi"]

function isKnownHarness(harness: string): harness is Harness {
  return (KNOWN_HARNESSES as readonly string[]).includes(harness)
}

function installPreviouslyConfigured(options: InitOptions, manifest: InstallManifest): IntegrationResult[] {
  const results: IntegrationResult[] = []
  const seen = new Set<string>()
  for (const integration of manifest.integrations) {
    if (seen.has(integration.harness)) continue
    seen.add(integration.harness)
    if (!isKnownHarness(integration.harness)) {
      const message = `Unknown harness: ${integration.harness}`
      results.push({ harness: integration.harness as Harness, configured: false, message })
      console.log(`  - ${integration.harness} skipped: ${message}`)
      continue
    }
    try {
      results.push(installHarness(integration.harness, options))
      console.log(`  ✓ ${integration.harness} reconfigured`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({ harness: integration.harness, configured: false, message })
      console.log(`  ✗ ${integration.harness} failed: ${message}`)
    }
  }
  return results
}

export function reapplyInstallManifest(options: InitOptions, manifest: InstallManifest): ReapplyInstallManifestResult {
  const results = installPreviouslyConfigured(options, manifest)
  const configured = results.filter((r) => r.configured)
  const nextManifest: InstallManifest = {
    ...manifest,
    installedAt: new Date().toISOString(),
    binaryPath: options.binaryPath,
    dataDir: options.dataDir,
    integrations: configured.map((r) => ({
      harness: r.harness,
      configPath: r.configPath || "",
    })),
  }
  writeManifest(nextManifest)

  return {
    results,
    configuredCount: configured.length,
    manifest: nextManifest,
  }
}

export async function handleUpgrade(argv: string[]): Promise<void> {
  const yes = argv.includes("--yes")
  const isWindows = os.platform() === "win32"
  const url = isWindows ? WINDOWS_INSTALLER_URL : INSTALLER_URL
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(),
 "memory-lane-upgrade-"))
  const scriptName = isWindows ? "install.ps1" : "install.sh"
  const scriptPath = path.join(tmpDir, scriptName)
  const homeDir = process.env.HOME || os.homedir()
  const dataDir = path.join(homeDir, ".memory-lane")

  try {
    console.log("Downloading latest installer...")
    if (!download(url, scriptPath)) {
      console.error("Failed to download installer. Please upgrade manually:")
      console.error(`  ${isWindows ? "irm" : "curl -fsSL"} ${url} ${isWindows ? "| iex" : "| sh"}`)
      console.error("  memory-lane init --yes")
      process.exit(1)
    }

    console.log("Running installer...")
    if (!runInstaller(scriptPath)) {
      console.error("Installer failed. Please check the output above.")
      process.exit(1)
    }

    const manifest = readManifest(dataDir)
    if (manifest && manifest.integrations.length > 0) {
      console.log("\nRe-configuring previously installed harnesses...")
      const binaryPath = isWindows ? path.join(homeDir, "bin", "memory-lane.exe") : path.join(homeDir, ".local", "bin", "memory-lane")
      const options: InitOptions = {
        binaryPath,
        dataDir,
        projectMode: false,
        yes: true,
        homeDir,
      }
      const { configuredCount } = reapplyInstallManifest(options, manifest)

      if (configuredCount === 0) {
        console.log("\nNo previous harness configs were reapplied. Run `memory-lane init` to set up integrations.")
      } else {
        console.log(`\nReapplied ${configuredCount} harness configuration(s).`)
      }
      console.log("Upgrade complete.")
      return
    }

    if (isWindows) {
      console.log("\nUpgrade script downloaded the new binary.")
      console.log("Because Windows locks the running executable, please close this terminal and run:")
      console.log("  memory-lane init --yes")
      return
    }

    console.log("\nNo previous install manifest found. Running first-time setup...")
    if (!runInit(yes)) {
      console.error("Init failed after upgrade. Please run manually:")
      console.error(`  memory-lane init${yes ? " --yes" : ""}`)
      process.exit(1)
    }

    console.log("\nUpgrade complete.")
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
