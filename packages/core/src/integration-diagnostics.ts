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

function missingMulti(checkedPaths: string[]): MultiHookConfigDiagnostic {
  return { checkedPaths, exists: false, configured: false, commands: emptyCommands(), warnings: [] }
}

export function diagnoseIntegrations(options: DiagnoseIntegrationsOptions = {}): IntegrationDiagnostics {
  const paths = mergePaths(options.cwd, options.paths)
  return {
    summary: { mcpExplicitToolsOnly: true, hooksAutomaticLifecycle: true, piAutosaveEnabled: false },
    claudeDesktopMcp: { checkedPath: paths.claudeDesktopConfig, exists: false, configured: false, hasCommand: false, hasArgs: false, warnings: [] },
    codexHooks: { user: missingSingle(paths.codexUserHooks), project: missingSingle(paths.codexProjectHooks) },
    claudeCodeHooks: { user: missingMulti(paths.claudeCodeUserSettings), project: missingSingle(paths.claudeCodeProjectSettings) },
    piExtension: { checkedPath: paths.piExtension, exists: false, detected: false, warnings: [] },
    notes: [
      "MCP provides explicit Memory Lane tools only; it does not run lifecycle hooks.",
      "Codex and Claude Code hooks provide automatic lifecycle recall/save where configured.",
      "pi currently supports manual Memory Lane tools and read-only lifecycle recall; pi autosave/tool capture is deferred.",
    ],
  }
}
