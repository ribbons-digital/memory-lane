import * as fs from "node:fs"
import * as path from "node:path"
import type { Harness, InitOptions, IntegrationResult } from "./types.js"

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function readJson(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(filePath)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8")
}

function mergeHooks(existing: Record<string, unknown>, harness: "claude" | "codex", binaryPath: string): Record<string, unknown> {
  const isClaude = harness === "claude"
  const timeoutKey = isClaude ? "timeout" : "timeoutSec"
  const postToolMatcher = isClaude ? "Bash" : "Bash|shell:*"

  const hooks = {
    SessionStart: [
      {
        matcher: "startup",
        hooks: [
          {
            type: "command",
            command: `${binaryPath} ${harness} session-start`,
            [timeoutKey]: 10,
            statusMessage: "Loading baseline memory",
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: `${binaryPath} ${harness} user-prompt-submit`,
            [timeoutKey]: 10,
            statusMessage: "Retrieving relevant memory",
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: `${binaryPath} ${harness} stop`,
            [timeoutKey]: 10,
            statusMessage: "Saving useful memory",
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: postToolMatcher,
        hooks: [
          {
            type: "command",
            command: `${binaryPath} ${harness} post-tool-use`,
            [timeoutKey]: 10,
            statusMessage: "Capturing useful tool outcome",
          },
        ],
      },
    ],
  }

  return { ...existing, hooks: { ...((existing.hooks as Record<string, unknown>) ?? {}), ...hooks } }
}

export function installClaudeCodeCli(options: InitOptions): IntegrationResult {
  const configPath = options.projectMode
    ? path.join(options.projectPath ?? process.cwd(), ".claude/settings.local.json")
    : path.join(options.homeDir, ".claude/settings.json")
  const existing = readJson(configPath)
  const merged = mergeHooks(existing, "claude", options.binaryPath)
  writeJson(configPath, merged)
  return { harness: "claude-code-cli", configured: true, configPath }
}

export function installCodexCli(options: InitOptions): IntegrationResult {
  const configPath = options.projectMode
    ? path.join(options.projectPath ?? process.cwd(), ".codex/hooks.json")
    : path.join(options.homeDir, ".codex/hooks.json")
  const existing = readJson(configPath)
  const merged = mergeHooks(existing, "codex", options.binaryPath)
  writeJson(configPath, merged)
  return { harness: "codex-cli", configured: true, configPath }
}

export function installClaudeDesktop(options: InitOptions): IntegrationResult {
  const platform = process.platform
  const configPath =
    platform === "darwin"
      ? path.join(options.homeDir, "Library/Application Support/Claude/settings.json")
      : path.join(options.homeDir, ".config/claude/settings.json")
  const existing = readJson(configPath)
  const mcpServers = (existing.mcpServers as Record<string, unknown>) ?? {}
  mcpServers["memory-lane"] = {
    command: options.binaryPath,
    args: ["mcp"],
  }
  writeJson(configPath, { ...existing, mcpServers })
  return { harness: "claude-desktop", configured: true, configPath }
}

export function installCodexDesktop(options: InitOptions): IntegrationResult {
  const configPath = path.join(options.homeDir, ".codex/config.toml")
  // Codex Desktop uses TOML. For now we write a simple TOML snippet.
  ensureDir(configPath)
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : ""
  const section = `\n[mcpServers.memory-lane]\ncommand = "${options.binaryPath.replace(/"/g, '\\"')}"\nargs = ["mcp"]\n`
  const withoutExisting = existing.replace(/\n?\[mcpServers\.memory-lane\][\s\S]*?(?=\n\[|$)/, "")
  fs.writeFileSync(configPath, withoutExisting + section, "utf8")
  return { harness: "codex-desktop", configured: true, configPath }
}

export function installPi(options: InitOptions): IntegrationResult {
  const configPath = path.join(options.homeDir, ".pi/agent/extensions/memory-lane/index.ts")
  ensureDir(configPath)
  const source = `export default async function memoryLaneExtension(pi: any) {\n  const mod = await import("file://${options.binaryPath}?reload=" + Date.now());\n  return mod.default(pi);\n}\n`
  fs.writeFileSync(configPath, source, "utf8")
  return { harness: "pi", configured: true, configPath }
}

export function installHarness(harness: Harness, options: InitOptions): IntegrationResult {
  switch (harness) {
    case "claude-code-cli":
      return installClaudeCodeCli(options)
    case "codex-cli":
      return installCodexCli(options)
    case "claude-desktop":
      return installClaudeDesktop(options)
    case "codex-desktop":
      return installCodexDesktop(options)
    case "pi":
      return installPi(options)
  }
}
