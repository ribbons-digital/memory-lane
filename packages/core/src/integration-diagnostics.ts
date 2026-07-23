import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { LifecycleCaptureMode } from "./types.js"

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
  ompExtension: string | null
}

export type IntegrationDiagnosticWarnings = Partial<Record<keyof IntegrationDiagnosticPaths, string[]>>

export interface OmpContractDiagnostic {
  testedVersion: string
  testedAt: string
  overallPass: true
}

export const OMP_CONTRACT_DIAGNOSTIC: Readonly<OmpContractDiagnostic> = Object.freeze({
  testedVersion: "16.4.8",
  testedAt: "2026-07-13",
  overallPass: true,
})

export interface IntegrationDiagnostics {
  summary: {
    mcpExplicitToolsOnly: true
    hooksAutomaticLifecycle: boolean
    piAutosaveEnabled: false
    lifecycleCaptureMode: LifecycleCaptureMode
    automaticPendingWritesEnabled: boolean
    automaticPendingBacklog: number
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
    warnings: string[]
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
  ompExtension: {
    checkedPath: string | null
    exists: boolean
    detected: boolean
    warnings: string[]
    contract: OmpContractDiagnostic
  }
  notes: string[]
}

export interface DiagnoseIntegrationsOptions {
  cwd?: string | null
  paths?: Partial<IntegrationDiagnosticPaths>
  warnings?: IntegrationDiagnosticWarnings
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  homeDir?: string
  lifecycleCaptureMode?: LifecycleCaptureMode
  automaticPendingBacklog?: number
}

const emptyCommands = (): HookCommandStatus => ({ userPromptSubmit: false, stop: false, postToolUse: false })

/**
 * Resolve OMP's default-profile agent directory.
 * Relative overrides intentionally follow OMP's cwd-dependent path.resolve behavior.
 */
export function resolveOmpAgentDir(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  homeDir: string,
): string {
  const override = env.PI_CODING_AGENT_DIR?.trim()
  return override ? path.resolve(override) : path.join(homeDir, ".omp", "agent")
}

export function defaultIntegrationDiagnosticPaths(
  cwd?: string | null,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  homeDir: string = env.HOME || os.homedir(),
): IntegrationDiagnosticPaths {
  const ompAgentDir = resolveOmpAgentDir(env, homeDir)
  return {
    claudeDesktopConfig: path.join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    codexUserHooks: path.join(homeDir, ".codex", "hooks.json"),
    codexProjectHooks: cwd ? path.join(cwd, ".codex", "hooks.json") : null,
    claudeCodeUserSettings: [path.join(homeDir, ".claude", "settings.json"), path.join(homeDir, ".claude", "settings.local.json")],
    claudeCodeProjectSettings: cwd ? path.join(cwd, ".claude", "settings.local.json") : null,
    piExtension: path.join(homeDir, ".pi", "agent", "extensions", "memory-lane", "index.ts"),
    ompExtension: path.join(ompAgentDir, "extensions", "memory-lane", "index.ts"),
  }
}

function mergePaths(
  cwd: string | null | undefined,
  overrides: Partial<IntegrationDiagnosticPaths> | undefined,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  homeDir: string,
): IntegrationDiagnosticPaths {
  const defaults = defaultIntegrationDiagnosticPaths(cwd, env, homeDir)
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

function commandLabel(command: keyof HookCommandStatus): string {
  switch (command) {
    case "userPromptSubmit": return "user-prompt-submit"
    case "postToolUse": return "post-tool-use"
    case "stop": return "stop"
  }
}

function duplicateCodexHookWarnings(user: SingleHookConfigDiagnostic, project: SingleHookConfigDiagnostic): string[] {
  if (!user.checkedPath || !project.checkedPath) return []
  const warnings: string[] = []
  const commands: Array<keyof HookCommandStatus> = ["userPromptSubmit", "stop", "postToolUse"]
  for (const command of commands) {
    if (!user.commands[command] || !project.commands[command]) continue
    warnings.push(`Memory Lane Codex ${commandLabel(command)} hook is configured in both user (${user.checkedPath}) and project (${project.checkedPath}) scopes; both hooks may run and create duplicate saves. Keep only one scope enabled unless this is intentional.`)
  }
  return warnings
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

function diagnoseExtension(
  file: string | null,
  extraWarnings: string[] = [],
): Omit<IntegrationDiagnostics["ompExtension"], "contract"> {
  if (!file) {
    return { checkedPath: null, exists: false, detected: false, warnings: [...extraWarnings] }
  }
  const read = readText(file)
  const detected = Boolean(read.text && (
    read.text.includes("memory-lane")
    || read.text.includes("@memory-lane/pi-adapter")
    || read.text.includes("memoryLaneExtension")
  ))
  return {
    checkedPath: file,
    exists: read.exists,
    detected,
    warnings: [...extraWarnings, ...(read.warning ? [read.warning] : [])],
  }
}

export function diagnoseIntegrations(options: DiagnoseIntegrationsOptions = {}): IntegrationDiagnostics {
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? env.HOME ?? os.homedir()
  const paths = mergePaths(options.cwd, options.paths, env, homeDir)
  const codexUserHooks = diagnoseJsonHookFile(paths.codexUserHooks, "codex")
  const codexProjectHooks = diagnoseJsonHookFile(paths.codexProjectHooks, "codex")
  const claudeUserHooks = diagnoseJsonHookFiles(paths.claudeCodeUserSettings, "claude")
  const claudeProjectHooks = diagnoseJsonHookFile(paths.claudeCodeProjectSettings, "claude")
  const piExtension = diagnoseExtension(paths.piExtension, options.warnings?.piExtension) as IntegrationDiagnostics["piExtension"]
  const ompExtension = diagnoseExtension(paths.ompExtension, options.warnings?.ompExtension)
  const lifecycleCaptureMode = options.lifecycleCaptureMode ?? "conservative"
  const writeHooksDetected = codexUserHooks.commands.stop || codexUserHooks.commands.postToolUse
    || codexProjectHooks.commands.stop || codexProjectHooks.commands.postToolUse
    || claudeUserHooks.commands.stop || claudeUserHooks.commands.postToolUse
    || claudeProjectHooks.commands.stop || claudeProjectHooks.commands.postToolUse
    || piExtension.detected || ompExtension.detected
  const automaticPendingWritesEnabled = lifecycleCaptureMode !== "off" && writeHooksDetected
  return {
    summary: {
      mcpExplicitToolsOnly: true,
      hooksAutomaticLifecycle: automaticPendingWritesEnabled,
      piAutosaveEnabled: false,
      lifecycleCaptureMode,
      automaticPendingWritesEnabled,
      automaticPendingBacklog: options.automaticPendingBacklog ?? 0,
    },
    claudeDesktopMcp: diagnoseClaudeDesktopMcp(paths.claudeDesktopConfig),
    codexHooks: {
      user: codexUserHooks,
      project: codexProjectHooks,
      warnings: duplicateCodexHookWarnings(codexUserHooks, codexProjectHooks),
    },
    claudeCodeHooks: {
      user: claudeUserHooks,
      project: claudeProjectHooks,
    },
    piExtension,
    ompExtension: {
      ...ompExtension,
      contract: OMP_CONTRACT_DIAGNOSTIC,
    },
    notes: [
      "MCP provides explicit Memory Lane tools only; it does not run lifecycle hooks.",
      "Codex and Claude Code hooks provide automatic lifecycle recall/save where configured.",
      "Pi and OMP extensions provide Memory Lane tools and lifecycle integration when installed.",
    ],
  }
}
