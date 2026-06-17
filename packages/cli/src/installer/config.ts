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

function skillContent(binaryPath: string): string {
  return `---
name: memory-lane
description: Persistent project-specific memory with semantic retrieval. Use when the user wants to save, recall, search, or manage durable memories across sessions.
---

# Memory Lane

You have access to Memory Lane, a local-first persistent memory system.

Use it to:
- Save durable memories explicitly requested by the user
- Recall past context relevant to the current task
- Suggest memories for later review

When the user says things like "remember that...", "don't forget...", or asks "what were we working on?", use Memory Lane.

Available CLI commands:
- memory-lane save "<text>" --status approved
- memory-lane suggest "<text>"
- memory-lane recall "<query>"
- memory-lane list
- memory-lane review
- memory-lane review --suspect-meta
- memory-lane status
- memory-lane doctor

For explicit user requests, save as approved. For proactive observations, suggest as pending.

For requests to list, show, review, or count current Memory Lane memories, use the authoritative list/status/review surface instead of answering from injected relevant-memory context. Prefer \`memory-lane list --json --project "$PWD"\` for the authoritative current-project list, \`memory-lane review --json --project "$PWD"\` for pending memories, \`memory-lane review --suspect-meta --json --project "$PWD"\` for likely old operational prompt pollution, and \`memory-lane status --json --project "$PWD"\` for counts/scope. Check JSON \`meta.projectScope\`; if it is \`none\`, ask for or pass the project path instead of presenting the result as project-scoped.

Automatic context injection is controlled by \`memory.contextPolicy\`: \`selective\` injects bounded selected approved memories inside a guarded \`<memory-context>\` block, \`policy-only\` injects guidance to use Memory Lane tools without memory bodies, and \`off\` disables automatic context injection while preserving explicit CLI/MCP tools and save hooks.

When running inside an MCP client with Memory Lane MCP configured, prefer the MCP tools.
If MCP is not available, fall back to the CLI commands above.
The binary is available at: ${binaryPath}
`
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

  if (!options.projectMode) {
    const skillPath = path.join(options.homeDir, ".claude/skills/memory-lane/SKILL.md")
    ensureDir(skillPath)
    fs.writeFileSync(skillPath, skillContent(options.binaryPath), "utf8")
  }

  return { harness: "claude-code-cli", configured: true, configPath }
}

export function installCodexCli(options: InitOptions): IntegrationResult {
  const configPath = options.projectMode
    ? path.join(options.projectPath ?? process.cwd(), ".codex/hooks.json")
    : path.join(options.homeDir, ".codex/hooks.json")
  const existing = readJson(configPath)
  const merged = mergeHooks(existing, "codex", options.binaryPath)
  writeJson(configPath, merged)

  if (!options.projectMode) {
    const skillPath = path.join(options.homeDir, ".agents/skills/memory-lane/SKILL.md")
    ensureDir(skillPath)
    fs.writeFileSync(skillPath, skillContent(options.binaryPath), "utf8")
  }

  return { harness: "codex-cli", configured: true, configPath }
}

export function installClaudeDesktop(options: InitOptions): IntegrationResult {
  const platform = process.platform
  const configPath =
    platform === "darwin"
      ? path.join(options.homeDir, "Library/Application Support/Claude/claude_desktop_config.json")
      : path.join(options.homeDir, ".config/Claude/claude_desktop_config.json")
  const existing = readJson(configPath)
  const mcpServers = (existing.mcpServers as Record<string, unknown>) ?? {}
  mcpServers["memory-lane"] = {
    command: options.binaryPath,
    args: ["mcp"],
  }
  writeJson(configPath, { ...existing, mcpServers })
  return { harness: "claude-desktop", configured: true, configPath }
}

function tomlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
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

export function installCodexDesktop(options: InitOptions): IntegrationResult {
  const configPath = path.join(options.homeDir, ".codex/config.toml")
  ensureDir(configPath)
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : ""
  const withoutExisting = removeTomlSection(existing, "mcp_servers.memory-lane")
  const section = `\n[mcp_servers.memory-lane]\nenabled = true\ncommand = "${tomlEscape(options.binaryPath)}"\nargs = ["mcp"]\n`
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

export function hasExistingMemoryLaneConfig(harness: Harness, configPath: string): boolean {
  if (!fs.existsSync(configPath)) return false

  if (harness === "claude-code-cli" || harness === "codex-cli") {
    const homeDir = path.dirname(path.dirname(configPath))
    const skillDir = harness === "claude-code-cli"
      ? path.join(homeDir, ".claude/skills/memory-lane")
      : path.join(homeDir, ".agents/skills/memory-lane")
    if (fs.existsSync(path.join(skillDir, "SKILL.md"))) return true

    const data = readJson(configPath)
    const hooks = (data.hooks as Record<string, unknown[]>) ?? {}
    const prefix = harness === "claude-code-cli" ? "memory-lane claude" : "memory-lane codex"
    for (const hookList of Object.values(hooks)) {
      for (const hook of hookList as unknown[]) {
        const command = (hook as any)?.hooks?.[0]?.command ?? ""
        if (typeof command === "string" && command.includes(prefix)) return true
      }
    }
    return false
  }

  if (harness === "claude-desktop" || harness === "codex-desktop") {
    const data = readJson(configPath)
    return !!(data.mcpServers as Record<string, unknown> | undefined)?.["memory-lane"]
  }

  if (harness === "pi") {
    return fs.existsSync(configPath)
  }

  return false
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
