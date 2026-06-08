import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export interface HookCommandStatus {
  userPromptSubmit: boolean
  stop: boolean
  postToolUse: boolean
}

export interface SingleHookConfigDiagnostic {
  checkedPath: string | null
  exists: boolean
  configured: boolean
  commands: HookCommandStatus
  warnings: string[]
}

export interface MultiHookConfigDiagnostic {
  checkedPaths: string[]
  exists: boolean
  configured: boolean
  commands: HookCommandStatus
  warnings: string[]
}

export interface IntegrationDiagnosticPaths {
  claudeDesktopConfig: string
  codexUserHooks: string
  codexProjectHooks: string | null
  claudeCodeUserSettings: string[]
  claudeCodeProjectSettings: string | null
  piExtension: string
}

export interface IntegrationDiagnostics {
  summary: {
    mcpExplicitToolsOnly: true
    hooksAutomaticLifecycle: true
    piAutosaveEnabled: false
  }
  claudeDesktopMcp: {
    checkedPath: string
    exists: boolean
    configured: boolean
    hasCommand: boolean
    hasArgs: boolean
    warnings: string[]
  }
  codexHooks: {
    user: SingleHookConfigDiagnostic
    project: SingleHookConfigDiagnostic
  }
  claudeCodeHooks: {
    user: MultiHookConfigDiagnostic
    project: SingleHookConfigDiagnostic
  }
  piExtension: {
    checkedPath: string
    exists: boolean
    detected: boolean
    warnings: string[]
  }
  notes: string[]
}

export interface DiagnoseIntegrationsOptions {
  cwd?: string | null
  paths?: Partial<IntegrationDiagnosticPaths>
}

const emptyCommands = (): HookCommandStatus => ({ userPromptSubmit: false, stop: false, postToolUse: false })

export function defaultIntegrationDiagnosticPaths(cwd?: string | null): IntegrationDiagnosticPaths {
  const home = os.homedir()
  return {
    claudeDesktopConfig: path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    codexUserHooks: path.join(home, ".codex", "hooks.json"),
    codexProjectHooks: cwd ? path.join(cwd, ".codex", "hooks.json") : null,
    claudeCodeUserSettings: [path.join(home, ".claude", "settings.json"), path.join(home, ".claude", "settings.local.json")],
    claudeCodeProjectSettings: cwd ? path.join(cwd, ".claude", "settings.local.json") : null,
    piExtension: path.join(home, ".pi", "agent", "extensions", "memory-lane", "index.ts"),
  }
}

function mergePaths(cwd: string | null | undefined, overrides?: Partial<IntegrationDiagnosticPaths>): IntegrationDiagnosticPaths {
  const defaults = defaultIntegrationDiagnosticPaths(cwd)
  return { ...defaults, ...overrides }
}

function missingSingle(checkedPath: string | null): SingleHookConfigDiagnostic {
  return { checkedPath, exists: false, configured: false, commands: emptyCommands(), warnings: [] }
}

function readText(file: string): { exists: boolean; text?: string; warning?: string } {
  try {
    if (!fs.existsSync(file)) return { exists: false }
    const stat = fs.statSync(file)
    if (!stat.isFile()) return { exists: true, warning: `Path is not a file: ${file}` }
    return { exists: true, text: fs.readFileSync(file, "utf8") }
  } catch {
    return { exists: true, warning: `File is not accessible: ${file}` }
  }
}

function parseJson(file: string): { exists: boolean; value?: unknown; warnings: string[] } {
  const read = readText(file)
  if (!read.exists) return { exists: false, warnings: [] }
  if (read.warning) return { exists: true, warnings: [read.warning] }
  try {
    return { exists: true, value: JSON.parse(read.text ?? ""), warnings: [] }
  } catch {
    return { exists: true, warnings: [`Invalid JSON in integration config: ${file}`] }
  }
}

function stringifyForCommandScan(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(stringifyForCommandScan).join("\n")
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(stringifyForCommandScan).join("\n")
  return ""
}

function detectCommands(text: string, adapter: "codex" | "claude"): HookCommandStatus {
  return {
    userPromptSubmit: text.includes(`memory-lane ${adapter} user-prompt-submit`),
    stop: text.includes(`memory-lane ${adapter} stop`),
    postToolUse: text.includes(`memory-lane ${adapter} post-tool-use`),
  }
}

function anyCommand(commands: HookCommandStatus): boolean {
  return commands.userPromptSubmit || commands.stop || commands.postToolUse
}

function diagnoseJsonHookFile(file: string | null, adapter: "codex" | "claude"): SingleHookConfigDiagnostic {
  if (!file) return missingSingle(null)
  const parsed = parseJson(file)
  const commands = parsed.value ? detectCommands(stringifyForCommandScan(parsed.value), adapter) : emptyCommands()
  return { checkedPath: file, exists: parsed.exists, configured: anyCommand(commands), commands, warnings: parsed.warnings }
}

function diagnoseJsonHookFiles(files: string[], adapter: "codex" | "claude"): MultiHookConfigDiagnostic {
  const parts = files.map((file) => diagnoseJsonHookFile(file, adapter))
  const commands = parts.reduce((acc, part) => ({
    userPromptSubmit: acc.userPromptSubmit || part.commands.userPromptSubmit,
    stop: acc.stop || part.commands.stop,
    postToolUse: acc.postToolUse || part.commands.postToolUse,
  }), emptyCommands())
  return {
    checkedPaths: files,
    exists: parts.some((part) => part.exists),
    configured: anyCommand(commands),
    commands,
    warnings: parts.flatMap((part) => part.warnings),
  }
}

function diagnoseClaudeDesktopMcp(file: string): IntegrationDiagnostics["claudeDesktopMcp"] {
  const parsed = parseJson(file)
  const root = parsed.value && typeof parsed.value === "object" ? parsed.value as Record<string, unknown> : undefined
  const servers = root?.mcpServers && typeof root.mcpServers === "object" ? root.mcpServers as Record<string, unknown> : undefined
  const server = servers?.["memory-lane"] && typeof servers["memory-lane"] === "object" ? servers["memory-lane"] as Record<string, unknown> : undefined
  const hasCommand = typeof server?.command === "string" && server.command.length > 0
  const hasArgs = Array.isArray(server?.args)
  return { checkedPath: file, exists: parsed.exists, configured: Boolean(server), hasCommand, hasArgs, warnings: parsed.warnings }
}

function diagnosePiExtension(file: string): IntegrationDiagnostics["piExtension"] {
  const read = readText(file)
  const detected = Boolean(read.text && (
    read.text.includes("memory-lane")
    || read.text.includes("@memory-lane/pi-adapter")
    || read.text.includes("memoryLaneExtension")
  ))
  return { checkedPath: file, exists: read.exists, detected, warnings: read.warning ? [read.warning] : [] }
}

export function diagnoseIntegrations(options: DiagnoseIntegrationsOptions = {}): IntegrationDiagnostics {
  const paths = mergePaths(options.cwd, options.paths)
  return {
    summary: { mcpExplicitToolsOnly: true, hooksAutomaticLifecycle: true, piAutosaveEnabled: false },
    claudeDesktopMcp: diagnoseClaudeDesktopMcp(paths.claudeDesktopConfig),
    codexHooks: {
      user: diagnoseJsonHookFile(paths.codexUserHooks, "codex"),
      project: diagnoseJsonHookFile(paths.codexProjectHooks, "codex"),
    },
    claudeCodeHooks: {
      user: diagnoseJsonHookFiles(paths.claudeCodeUserSettings, "claude"),
      project: diagnoseJsonHookFile(paths.claudeCodeProjectSettings, "claude"),
    },
    piExtension: diagnosePiExtension(paths.piExtension),
    notes: [
      "MCP provides explicit Memory Lane tools only; it does not run lifecycle hooks.",
      "Codex and Claude Code hooks provide automatic lifecycle recall/save where configured.",
      "pi currently supports manual Memory Lane tools and read-only lifecycle recall; pi autosave/tool capture is deferred.",
    ],
  }
}
