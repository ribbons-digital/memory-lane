import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as readline from "node:readline"

interface InstallManifest {
  version: string
  installedAt: string
  binaryPath: string
  dataDir: string
  integrations: Array<{ harness: string; configPath: string }>
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

function resolveHomeDir(): string {
  return process.env.HOME || os.homedir()
}

function readManifest(dataDir: string): InstallManifest | undefined {
  const manifestPath = path.join(dataDir, "install.json")
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as InstallManifest
  } catch {
    return undefined
  }
}

function readJson(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8")
}

function removeMemoryLaneHooks(configPath: string, harness: string): boolean {
  if (!fs.existsSync(configPath)) return false
  const data = readJson(configPath)
  const hooks = (data.hooks as Record<string, unknown[]>) ?? {}
  const prefix = harness.includes("claude") ? "memory-lane claude" : "memory-lane codex"

  let changed = false
  for (const [event, hookList] of Object.entries(hooks)) {
    const filtered = (hookList as unknown[]).filter((hook: any) => {
      const command = hook?.hooks?.[0]?.command ?? ""
      if (typeof command === "string" && command.includes(prefix)) {
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

  if (Object.keys(hooks).length === 0) {
    delete data.hooks
  } else {
    data.hooks = hooks
  }

  if (changed) {
    if (Object.keys(data).length === 0) {
      fs.unlinkSync(configPath)
    } else {
      writeJson(configPath, data)
    }
  }
  return changed
}

function removeMemoryLaneMcp(configPath: string): boolean {
  if (!fs.existsSync(configPath)) return false
  const data = readJson(configPath)
  const mcpServers = (data.mcpServers as Record<string, unknown>) ?? {}
  if ("memory-lane" in mcpServers) {
    delete mcpServers["memory-lane"]
    if (Object.keys(mcpServers).length === 0) {
      delete data.mcpServers
    } else {
      data.mcpServers = mcpServers
    }
    if (Object.keys(data).length === 0) {
      fs.unlinkSync(configPath)
    } else {
      writeJson(configPath, data)
    }
    return true
  }
  return false
}

function removeTomlSection(content: string, sectionName: string): string {
  const lines = content.split("\n")
  const startRegex = new RegExp(`^\\[${sectionName.replace(/\./g, "\\.")}\\]$`)
  const startIndex = lines.findIndex((line) => startRegex.test(line.trim()))
  if (startIndex === -1) return content

  let endIndex = lines.length
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^\[/.test(lines[i].trim())) {
      endIndex = i
      break
    }
  }

  const before = lines.slice(0, startIndex)
  const after = lines.slice(endIndex)
  return before.concat(after).join("\n").replace(/\n{3,}/g, "\n\n")
}

function removeMemoryLaneCodexMcp(configPath: string): boolean {
  if (!fs.existsSync(configPath)) return false
  const content = fs.readFileSync(configPath, "utf8")
  const cleaned = removeTomlSection(content, "mcp_servers.memory-lane")
  if (cleaned === content) return false
  if (cleaned.trim().length === 0) {
    fs.unlinkSync(configPath)
  } else {
    fs.writeFileSync(configPath, cleaned, "utf8")
  }
  return true
}

function removePiExtension(piPath: string): boolean {
  if (!fs.existsSync(piPath)) return false
  fs.rmSync(path.dirname(piPath), { recursive: true, force: true })
  return true
}

export async function handleUninstall(argv: string[]): Promise<void> {
  const yes = argv.includes("--yes")
  const homeDir = resolveHomeDir()
  const dataDir = path.join(homeDir, ".memory-lane")
  const manifest = readManifest(dataDir)

  if (!manifest) {
    console.log("No Memory Lane install manifest found. Nothing to uninstall.")
    return
  }

  const removeIntegrations = yes || await confirm("Remove configured integrations?", true)
  const removeData = yes ? false : await confirm("Remove memory data?", false)

  let removed = 0

  if (removeIntegrations) {
    for (const integration of manifest.integrations) {
      const configPath = integration.configPath
      let ok = false
      if (integration.harness === "claude-code-cli") {
        ok = removeMemoryLaneHooks(configPath, integration.harness)
        const skillDir = path.join(homeDir, ".claude/skills/memory-lane")
        if (fs.existsSync(skillDir)) {
          fs.rmSync(skillDir, { recursive: true, force: true })
          ok = true
        }
      } else if (integration.harness === "codex-cli") {
        ok = removeMemoryLaneHooks(configPath, integration.harness)
        const skillDir = path.join(homeDir, ".agents/skills/memory-lane")
        if (fs.existsSync(skillDir)) {
          fs.rmSync(skillDir, { recursive: true, force: true })
          ok = true
        }
      } else if (integration.harness === "claude-desktop") {
        ok = removeMemoryLaneMcp(configPath)
      } else if (integration.harness === "codex-desktop") {
        ok = removeMemoryLaneCodexMcp(configPath)
      } else if (integration.harness === "pi") {
        ok = removePiExtension(configPath)
      }
      if (ok) {
        console.log(`  ✓ Removed ${integration.harness} configuration`)
        removed++
      } else {
        console.log(`  - ${integration.harness} configuration not found or already removed`)
      }
    }
  }

  if (fs.existsSync(manifest.binaryPath)) {
    fs.unlinkSync(manifest.binaryPath)
    console.log(`  ✓ Removed binary: ${manifest.binaryPath}`)
  }

  const manifestPath = path.join(dataDir, "install.json")
  if (fs.existsSync(manifestPath)) {
    fs.unlinkSync(manifestPath)
  }

  if (removeData && fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true })
    console.log(`  ✓ Removed data directory: ${dataDir}`)
  }

  console.log(`\nUninstall complete. Removed ${removed} integration(s).`)
  if (!removeData) {
    console.log(`Memory data preserved at: ${dataDir}`)
  }
}
