import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as readline from "node:readline/promises"
import { HARNESS_ALIASES } from "./init.js"
import {
  integrationConfigPath,
  integrationHarness,
  readInstallManifest,
  validateAbsoluteManifestPath,
  validateManifestOmpConfigPaths,
  validateOmpExtensionConfigPath,
  writeInstallManifest,
} from "../installer/manifest.js"
import type { InstallManifest, InstallManifestEntry } from "../installer/manifest.js"

async function prompt(question: string, defaultValue: string = ""): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const suffix = defaultValue ? ` [${defaultValue}]: ` : ": "
    const answer = await rl.question(question + suffix)
    return answer.trim() || defaultValue
  } finally {
    rl.close()
  }
}

async function confirm(question: string, defaultValue: boolean = true): Promise<boolean> {
  const suffix = defaultValue ? " [Y/n]: " : " [y/N]: "
  const answer = await prompt(question + suffix, defaultValue ? "Y" : "N")
  return answer.toLowerCase().startsWith("y")
}

function resolveHomeDir(): string {
  return process.env.HOME || os.homedir()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function readJson(filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"))
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8")
}

function hookCommand(hook: unknown): string {
  if (!isRecord(hook) || !Array.isArray(hook.hooks) || !isRecord(hook.hooks[0])) return ""
  return typeof hook.hooks[0].command === "string" ? hook.hooks[0].command : ""
}

function removeMemoryLaneHooks(configPath: string, harness: string): boolean {
  if (!fs.existsSync(configPath)) return false
  const data = readJson(configPath)
  const hooks = isRecord(data.hooks) ? data.hooks : {}
  const prefix = harness.includes("claude") ? "memory-lane claude" : "memory-lane codex"

  let changed = false
  for (const [event, candidate] of Object.entries(hooks)) {
    if (!Array.isArray(candidate)) continue
    const filtered = candidate.filter((hook) => {
      if (hookCommand(hook).includes(prefix)) {
        changed = true
        return false
      }
      return true
    })
    if (filtered.length === 0) {
      delete hooks[event]
      changed = true
    } else {
      hooks[event] = filtered
    }
  }

  if (Object.keys(hooks).length === 0) delete data.hooks
  else data.hooks = hooks

  if (changed) {
    if (Object.keys(data).length === 0) fs.unlinkSync(configPath)
    else writeJson(configPath, data)
  }
  return changed
}

function removeMemoryLaneMcp(configPath: string): boolean {
  if (!fs.existsSync(configPath)) return false
  const data = readJson(configPath)
  const mcpServers = isRecord(data.mcpServers) ? data.mcpServers : {}
  if (!("memory-lane" in mcpServers)) return false

  delete mcpServers["memory-lane"]
  if (Object.keys(mcpServers).length === 0) delete data.mcpServers
  else data.mcpServers = mcpServers
  if (Object.keys(data).length === 0) fs.unlinkSync(configPath)
  else writeJson(configPath, data)
  return true
}

function removeTomlSection(content: string, sectionName: string): string {
  const lines = content.split("\n")
  const startRegex = new RegExp(`^\\[${sectionName.replace(/\./g, "\\.")}\\]$`)
  const startIndex = lines.findIndex((line) => startRegex.test(line.trim()))
  if (startIndex === -1) return content

  let endIndex = lines.length
  for (let index = startIndex + 1; index < lines.length; index++) {
    if (/^\[/u.test(lines[index].trim())) {
      endIndex = index
      break
    }
  }
  return lines.slice(0, startIndex).concat(lines.slice(endIndex)).join("\n").replace(/\n{3,}/gu, "\n\n")
}

function removeMemoryLaneCodexMcp(configPath: string): boolean {
  if (!fs.existsSync(configPath)) return false
  const content = fs.readFileSync(configPath, "utf8")
  const cleaned = removeTomlSection(content, "mcp_servers.memory-lane")
  if (cleaned === content) return false
  if (cleaned.trim().length === 0) fs.unlinkSync(configPath)
  else fs.writeFileSync(configPath, cleaned, "utf8")
  return true
}

function removePiExtension(piPath: string): boolean {
  if (!fs.existsSync(piPath)) return false
  fs.rmSync(path.dirname(piPath), { recursive: true, force: true })
  return true
}

function removeOmpExtension(configPath: string): boolean {
  const validated = validateOmpExtensionConfigPath(configPath)
  if (!validated.ok) throw new Error(validated.warning)
  const extensionDir = path.dirname(validated.value)
  if (!fs.existsSync(extensionDir)) return false
  const stat = fs.lstatSync(extensionDir)
  if (stat.isSymbolicLink()) fs.unlinkSync(extensionDir)
  else fs.rmSync(extensionDir, { recursive: true, force: true })
  return true
}

function validateOnlySelection(argv: string[]): string | undefined {
  const values: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (!argument.startsWith("--only")) continue
    if (argument === "--only") {
      const value = argv[index + 1]
      if (!value || value.startsWith("--")) throw new Error("Usage: memory-lane uninstall --only omp [--yes]")
      values.push(value)
      continue
    }
    if (argument.startsWith("--only=")) {
      const value = argument.slice("--only=".length)
      if (!value.trim()) throw new Error("Usage: memory-lane uninstall --only omp [--yes]")
      values.push(value)
      continue
    }
    throw new Error("Usage: memory-lane uninstall --only omp [--yes]")
  }
  if (values.length === 0) return undefined
  if (values.length > 1) throw new Error("Usage: memory-lane uninstall --only omp [--yes]")
  const selected = values[0].trim().toLowerCase()
  const harness = HARNESS_ALIASES[selected]
  if (harness !== "omp") throw new Error("Slice 2 selective uninstall supports only: memory-lane uninstall --only omp")
  return selected
}

function validateFullManifest(manifest: InstallManifest): string {
  const binary = validateAbsoluteManifestPath(manifest.binaryPath, "Install manifest binaryPath")
  if (!binary.ok) throw new Error(binary.warning)
  const data = validateAbsoluteManifestPath(manifest.dataDir, "Install manifest dataDir")
  if (!data.ok) throw new Error(data.warning)
  return binary.value
}

function preflightIntegration(entry: InstallManifestEntry): void {
  const harness = integrationHarness(entry)
  if (!harness) return
  const config = integrationConfigPath(entry)
  if (!config.ok) throw new Error(config.warning)
  if (harness === "omp") {
    const ompConfig = validateOmpExtensionConfigPath(config.value)
    if (!ompConfig.ok) throw new Error(ompConfig.warning)
  }
}

function removeIntegration(entry: InstallManifestEntry, homeDir: string): boolean {
  const harness = integrationHarness(entry)
  if (!harness) return false
  const config = integrationConfigPath(entry)
  if (!config.ok) throw new Error(config.warning)

  if (harness === "claude-code-cli") {
    let removed = removeMemoryLaneHooks(config.value, harness)
    const skillDir = path.join(homeDir, ".claude/skills/memory-lane")
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true })
      removed = true
    }
    return removed
  }
  if (harness === "codex-cli") {
    let removed = removeMemoryLaneHooks(config.value, harness)
    const skillDir = path.join(homeDir, ".agents/skills/memory-lane")
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true })
      removed = true
    }
    return removed
  }
  if (harness === "claude-desktop") return removeMemoryLaneMcp(config.value)
  if (harness === "codex-desktop") return removeMemoryLaneCodexMcp(config.value)
  if (harness === "pi") return removePiExtension(config.value)
  if (harness === "omp") return removeOmpExtension(config.value)
  return false
}

async function uninstallOnlyOmp(
  manifest: InstallManifest,
  dataDir: string,
  homeDir: string,
  yes: boolean,
): Promise<void> {
  const ompEntries = manifest.integrations.filter((entry) => integrationHarness(entry) === "omp")
  if (ompEntries.length === 0) {
    console.log("No manifest-recorded OMP integration found. Nothing to uninstall.")
    return
  }
  if (!yes && !await confirm("Remove the OMP (Oh My Pi) integration?", true)) {
    console.log("OMP uninstall cancelled.")
    return
  }

  const configPaths = validateManifestOmpConfigPaths({ ...manifest, integrations: ompEntries })

  let removed = 0
  for (const configPath of configPaths) {
    if (removeOmpExtension(configPath)) {
      console.log("  ✓ Removed omp configuration")
      removed++
    } else {
      console.log("  - omp configuration not found or already removed")
    }
  }

  const remaining = manifest.integrations.filter((entry) => integrationHarness(entry) !== "omp")
  writeInstallManifest(dataDir, { ...manifest, integrations: remaining })
  console.log(`\nOMP uninstall complete. Removed ${removed} integration(s).`)
  console.log(`Memory data preserved at: ${dataDir}`)
  console.log(`Memory Lane binary preserved at: ${String(manifest.binaryPath)}`)
}

export async function handleUninstall(argv: string[]): Promise<void> {
  const yes = argv.includes("--yes")
  const selected = validateOnlySelection(argv)

  const homeDir = resolveHomeDir()
  const dataDir = path.join(homeDir, ".memory-lane")
  const read = readInstallManifest(dataDir)
  if (read.status === "missing") {
    console.log("No Memory Lane install manifest found. Nothing to uninstall.")
    return
  }
  if (read.status === "malformed" || read.status === "partial") throw new Error(read.warnings.join(" "))
  const manifest = read.manifest

  if (selected) {
    await uninstallOnlyOmp(manifest, dataDir, homeDir, yes)
    return
  }

  const binaryPath = validateFullManifest(manifest)
  const removeIntegrations = yes || await confirm("Remove configured integrations?", true)
  const removeData = yes ? false : await confirm("Remove memory data?", false)
  let removed = 0

  if (removeIntegrations) {
    for (const integration of manifest.integrations) preflightIntegration(integration)
    for (const integration of manifest.integrations) {
      const harness = integrationHarness(integration) ?? "unknown"
      const ok = removeIntegration(integration, homeDir)
      if (ok) {
        console.log(`  ✓ Removed ${harness} configuration`)
        removed++
      } else {
        console.log(`  - ${harness} configuration not found or already removed`)
      }
    }
  }

  if (removeIntegrations) {
    if (fs.existsSync(binaryPath)) {
      fs.unlinkSync(binaryPath)
      console.log(`  ✓ Removed binary: ${binaryPath}`)
    }
    fs.rmSync(read.path, { force: true })
  }

  if (removeData && fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true })
    console.log(`  ✓ Removed data directory: ${dataDir}`)
  }

  console.log(`\nUninstall complete. Removed ${removed} integration(s).`)
  if (!removeData) console.log(`Memory data preserved at: ${dataDir}`)
}
