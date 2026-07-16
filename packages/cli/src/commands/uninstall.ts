import { spawn, spawnSync } from "node:child_process"
import type { ChildProcess, SpawnOptions } from "node:child_process"
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

export interface BinaryRemovalSpawner {
  (command: string, args: readonly string[], options: SpawnOptions): ChildProcess
}

export interface ProcessStartTimeReader {
  (processId: number): string
}

export type ProcessIdentityInspection = "active" | "inactive" | "unknown"

export interface ProcessIdentityInspector {
  (processId: number, startedAt: string): ProcessIdentityInspection
}

interface PendingBinaryRemoval {
  binaryPath: string
  pendingPath: string
  parentPid: number
  parentStartedAt: string
}

function readWindowsProcessStartTime(processId: number): string {
  const command = [
    "$processId = [int]$env:MEMORY_LANE_UNINSTALL_PARENT_PID",
    "$process = Get-Process -Id $processId -ErrorAction Stop",
    "[Console]::Out.Write($process.StartTime.ToUniversalTime().Ticks)",
  ].join("; ")
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      env: { ...process.env, MEMORY_LANE_UNINSTALL_PARENT_PID: String(processId) },
    },
  )
  const startedAt = typeof result.stdout === "string" ? result.stdout.trim() : ""
  if (result.status !== 0 || !/^\d+$/u.test(startedAt)) {
    throw new Error("Could not identify the running uninstall process")
  }
  return startedAt
}

function inspectWindowsProcessIdentity(processId: number, startedAt: string): ProcessIdentityInspection {
  const command = [
    "$process = $null",
    "try {",
    "  $process = Get-Process -Id ([int]$env:MEMORY_LANE_UNINSTALL_PARENT_PID) -ErrorAction Stop",
    "} catch {",
    "  if (\"$($_.FullyQualifiedErrorId)\" -like 'NoProcessFoundForGivenId*') { [Console]::Out.Write('inactive') } else { [Console]::Out.Write('unknown') }",
    "  exit 0",
    "}",
    "try {",
    "  if (\"$($process.StartTime.ToUniversalTime().Ticks)\" -eq $env:MEMORY_LANE_UNINSTALL_PARENT_STARTED_AT) { [Console]::Out.Write('active') } else { [Console]::Out.Write('inactive') }",
    "} catch { [Console]::Out.Write('unknown') }",
  ].join("; ")
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      env: {
        ...process.env,
        MEMORY_LANE_UNINSTALL_PARENT_PID: String(processId),
        MEMORY_LANE_UNINSTALL_PARENT_STARTED_AT: startedAt,
      },
    },
  )
  const identity = typeof result.stdout === "string" ? result.stdout.trim() : ""
  return result.status === 0 && (identity === "active" || identity === "inactive") ? identity : "unknown"
}

export function pendingBinaryRemovalPath(homeDir: string): string {
  return path.join(homeDir, ".memory-lane-uninstall.json")
}

export function sweepPendingBinaryRemoval(
  recoveryPath: string,
  platform: NodeJS.Platform = process.platform,
  inspectProcessIdentity: ProcessIdentityInspector = inspectWindowsProcessIdentity,
): "none" | "removed" | "retained" {
  if (platform !== "win32" || !fs.existsSync(recoveryPath)) return "none"
  let pending: PendingBinaryRemoval
  try {
    pending = JSON.parse(fs.readFileSync(recoveryPath, "utf8")) as PendingBinaryRemoval
  } catch {
    return "retained"
  }
  if (typeof pending.binaryPath !== "string"
    || !path.isAbsolute(pending.binaryPath)
    || typeof pending.pendingPath !== "string"
    || !Number.isInteger(pending.parentPid)
    || pending.parentPid <= 0
    || typeof pending.parentStartedAt !== "string"
    || !/^\d+$/u.test(pending.parentStartedAt)
    || pending.pendingPath !== `${pending.binaryPath}.uninstall.${pending.parentPid}.${pending.parentStartedAt}`) {
    return "retained"
  }
  if (!fs.existsSync(pending.pendingPath)) {
    fs.rmSync(recoveryPath, { force: true })
    return "removed"
  }
  if (inspectProcessIdentity(pending.parentPid, pending.parentStartedAt) !== "inactive") return "retained"
  fs.rmSync(pending.pendingPath, { force: true })
  fs.rmSync(recoveryPath, { force: true })
  return "removed"
}

export async function removeInstalledBinary(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform,
  parentPid: number = process.pid,
  spawnProcess: BinaryRemovalSpawner = spawn,
  readProcessStartTime: ProcessStartTimeReader = readWindowsProcessStartTime,
  recoveryPath?: string,
): Promise<"removed" | "scheduled"> {
  if (platform !== "win32") {
    fs.unlinkSync(binaryPath)
    return "removed"
  }

  if (recoveryPath && fs.existsSync(recoveryPath)
    && sweepPendingBinaryRemoval(recoveryPath, platform) === "retained") {
    throw new Error(`A prior Windows binary removal still requires cleanup: ${recoveryPath}`)
  }
  const parentStartedAt = readProcessStartTime(parentPid)
  const pendingPath = `${binaryPath}.uninstall.${parentPid}.${parentStartedAt}`
  let recoveryWritten = false
  let renamed = false
  const helperCommand = [
    "$parentPid = $env:MEMORY_LANE_UNINSTALL_PARENT_PID",
    "$parentStartedAt = $env:MEMORY_LANE_UNINSTALL_PARENT_STARTED_AT",
    "$identityDeadline = [DateTime]::UtcNow.AddSeconds(30)",
    "$inactive = $false",
    "while ($parentPid -match '^\\d+$' -and $parentStartedAt -match '^\\d+$' -and [DateTime]::UtcNow -lt $identityDeadline) {",
    "  $identity = 'unknown'",
    "  try {",
    "    $parent = Get-Process -Id ([int]$parentPid) -ErrorAction Stop",
    "    try {",
    "      $identity = if (\"$($parent.StartTime.ToUniversalTime().Ticks)\" -eq $parentStartedAt) { 'active' } else { 'inactive' }",
    "    } catch {}",
    "  } catch {",
    "    if (\"$($_.FullyQualifiedErrorId)\" -like 'NoProcessFoundForGivenId*') { $identity = 'inactive' }",
    "  }",
    "  if ($identity -eq 'inactive') { $inactive = $true; break }",
    "  Start-Sleep -Milliseconds 100",
    "}",
    "if (-not $inactive) { exit 0 }",
    "$retryDelays = @(100, 200, 400, 800, 1600, 3200, 5000, 5000, 5000, 5000, 5000)",
    "$removed = $false",
    "for ($attempt = 0; $attempt -le $retryDelays.Count; $attempt++) {",
    "  try {",
    "    if (Test-Path -LiteralPath $env:MEMORY_LANE_UNINSTALL_PENDING_PATH) {",
    "      Remove-Item -LiteralPath $env:MEMORY_LANE_UNINSTALL_PENDING_PATH -Force -ErrorAction Stop",
    "    }",
    "    $removed = $true",
    "    break",
    "  } catch {",
    "    if ($_.Exception -is [System.Management.Automation.ItemNotFoundException]) { $removed = $true; break }",
    "    $retryable = $_.Exception -is [System.IO.IOException] -or $_.Exception -is [System.UnauthorizedAccessException]",
    "    if (-not $retryable -or $attempt -ge $retryDelays.Count) { exit 1 }",
    "    Start-Sleep -Milliseconds ([int]$retryDelays[$attempt])",
    "  }",
    "}",
    "if (-not $removed) { exit 1 }",
    "if ($env:MEMORY_LANE_UNINSTALL_RECOVERY_PATH) {",
    "  Remove-Item -LiteralPath $env:MEMORY_LANE_UNINSTALL_RECOVERY_PATH -Force -ErrorAction SilentlyContinue",
    "}",
  ].join("\n")
  const encodedCommand = Buffer.from(helperCommand, "utf16le").toString("base64")

  try {
    if (recoveryPath) {
      fs.mkdirSync(path.dirname(recoveryPath), { recursive: true })
      const temporaryRecoveryPath = `${recoveryPath}.${process.pid}.tmp`
      try {
        const recovery: PendingBinaryRemoval = { binaryPath, pendingPath, parentPid, parentStartedAt }
        fs.writeFileSync(temporaryRecoveryPath, JSON.stringify(recovery), { encoding: "utf8", flag: "wx" })
        fs.renameSync(temporaryRecoveryPath, recoveryPath)
        recoveryWritten = true
      } finally {
        fs.rmSync(temporaryRecoveryPath, { force: true })
      }
    }
    fs.renameSync(binaryPath, pendingPath)
    renamed = true
    const child = spawnProcess(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encodedCommand],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: {
          ...process.env,
          MEMORY_LANE_UNINSTALL_PARENT_PID: String(parentPid),
          MEMORY_LANE_UNINSTALL_PARENT_STARTED_AT: parentStartedAt,
          MEMORY_LANE_UNINSTALL_PENDING_PATH: pendingPath,
          MEMORY_LANE_UNINSTALL_RECOVERY_PATH: recoveryPath,
        },
      },
    )
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve)
      child.once("error", reject)
    })
    child.unref()
    return "scheduled"
  } catch (error) {
    if (renamed && fs.existsSync(pendingPath) && !fs.existsSync(binaryPath)) fs.renameSync(pendingPath, binaryPath)
    if (recoveryWritten && recoveryPath) fs.rmSync(recoveryPath, { force: true })
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not schedule Windows binary removal: ${message}`)
  }
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
  const removalRecoveryPath = pendingBinaryRemovalPath(homeDir)
  sweepPendingBinaryRemoval(removalRecoveryPath)
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
      const binaryRemoval = await removeInstalledBinary(
        binaryPath,
        process.platform,
        process.pid,
        spawn,
        readWindowsProcessStartTime,
        removalRecoveryPath,
      )
      console.log(binaryRemoval === "scheduled"
        ? `  ✓ Scheduled binary removal after exit: ${binaryPath}`
        : `  ✓ Removed binary: ${binaryPath}`)
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
