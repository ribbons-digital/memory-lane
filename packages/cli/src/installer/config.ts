import * as fs from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import type { Harness, InitOptions, IntegrationResult } from "./types.js"

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function readJson(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {}
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not parse JSON config ${filePath}: ${message}`)
  }
}

function writeBackupIfNeeded(filePath: string): void {
  if (!fs.existsSync(filePath)) return
  const backupPath = `${filePath}.memory-lane.bak`
  if (!fs.existsSync(backupPath)) fs.copyFileSync(filePath, backupPath)
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(filePath)
  writeBackupIfNeeded(filePath)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8")
}

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function resolveDestinationPath(filePath: string): string {
  if (fs.existsSync(filePath)) return fs.realpathSync.native(filePath)

  const parts: string[] = []
  let current = filePath
  while (!fs.existsSync(current)) {
    parts.unshift(path.basename(current))
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  const resolvedParent = fs.existsSync(current) ? fs.realpathSync.native(current) : path.resolve(current)
  return path.join(resolvedParent, ...parts)
}

function findMemoryLaneSourceRoot(resolvedPath: string): string | undefined {
  let current = path.dirname(resolvedPath)
  while (true) {
    const packagePath = path.join(current, "package.json")
    if (fs.existsSync(packagePath)) {
      let pkg: Record<string, unknown> = {}
      try {
        pkg = readJson(packagePath)
      } catch {
        pkg = {}
      }
      const sourceSkillPath = path.join(current, "skills", "memory-lane", "SKILL.md")
      if (pkg.name === "memory-lane" && fs.existsSync(sourceSkillPath) && pathContains(path.join(current, "skills", "memory-lane"), resolvedPath)) {
        return current
      }
    }
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function writeGeneratedSkill(skillPath: string, content: string): { written: boolean; warning?: string } {
  const resolvedPath = resolveDestinationPath(skillPath)
  const sourceRoot = findMemoryLaneSourceRoot(resolvedPath)
  if (sourceRoot) {
    return {
      written: false,
      warning: `Warning: skipped Memory Lane skill write because ${skillPath} resolves into the Memory Lane source checkout at ${sourceRoot}. Remove or repoint the symlink if you want init/upgrade to manage the installed skill.`,
    }
  }

  ensureDir(skillPath)
  fs.writeFileSync(skillPath, content, "utf8")
  return { written: true }
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
- memory-lane review --suspect-meta --include-approved
- memory-lane status
- memory-lane doctor

For explicit user requests, save as approved. For proactive observations, suggest as pending.

For requests to list, show, review, or count current Memory Lane memories, use the authoritative list/status/review surface instead of answering from injected relevant-memory context. Prefer \`memory-lane list --json --project "$PWD"\` for the authoritative current-project list, \`memory-lane review --json --project "$PWD"\` for pending memories, \`memory-lane review --suspect-meta --json --project "$PWD"\` for likely old pending operational prompt pollution, \`memory-lane review --suspect-meta --include-approved --json --project "$PWD"\` for approved suspect pollution that may affect recall, and \`memory-lane status --json --project "$PWD"\` for counts/scope. Check JSON \`meta.projectScope\`; if it is \`none\`, ask for or pass the project path instead of presenting the result as project-scoped.

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

  const existingHooks = isRecord(existing.hooks) ? existing.hooks : {}
  const mergedHooks: Record<string, unknown> = { ...existingHooks }
  for (const [event, entries] of Object.entries(hooks)) {
    mergedHooks[event] = mergeHookEvent(existingHooks[event], entries, binaryPath)
  }
  return { ...existing, hooks: mergedHooks }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function commandText(value: unknown): string | undefined {
  return isRecord(value) && typeof value.command === "string" ? value.command : undefined
}

function isMemoryLaneCommand(command: string, binaryPath: string): boolean {
  return command.includes(binaryPath) || /(^|[\s"'/\\])memory-lane(?:\.exe)?([\s"']|$)/u.test(command)
}

function withoutMemoryLaneCommands(entry: unknown, binaryPath: string): unknown | undefined {
  if (!isRecord(entry)) return entry
  if (!Array.isArray(entry.hooks)) return entry
  const hooks = entry.hooks.filter((hook) => {
    const command = commandText(hook)
    return !command || !isMemoryLaneCommand(command, binaryPath)
  })
  if (!hooks.length) return undefined
  return { ...entry, hooks }
}

function mergeHookEvent(existingEvent: unknown, memoryLaneEntries: unknown[], binaryPath: string): unknown[] {
  const existingEntries = Array.isArray(existingEvent) ? existingEvent : []
  const preserved = existingEntries
    .map((entry) => withoutMemoryLaneCommands(entry, binaryPath))
    .filter((entry): entry is unknown => entry !== undefined)
  return [...preserved, ...memoryLaneEntries]
}

export function installClaudeCodeCli(options: InitOptions): IntegrationResult {
  const configPath = options.projectMode
    ? path.join(options.projectPath ?? process.cwd(), ".claude/settings.local.json")
    : path.join(options.homeDir, ".claude/settings.json")
  const existing = readJson(configPath)
  const merged = mergeHooks(existing, "claude", options.binaryPath)
  writeJson(configPath, merged)

  let message: string | undefined
  if (!options.projectMode) {
    const skillPath = path.join(options.homeDir, ".claude/skills/memory-lane/SKILL.md")
    message = writeGeneratedSkill(skillPath, skillContent(options.binaryPath)).warning
  }

  return { harness: "claude-code-cli", configured: true, configPath, message }
}

export function installCodexCli(options: InitOptions): IntegrationResult {
  const configPath = options.projectMode
    ? path.join(options.projectPath ?? process.cwd(), ".codex/hooks.json")
    : path.join(options.homeDir, ".codex/hooks.json")
  const existing = readJson(configPath)
  const merged = mergeHooks(existing, "codex", options.binaryPath)
  writeJson(configPath, merged)

  let message: string | undefined
  if (!options.projectMode) {
    const skillPath = path.join(options.homeDir, ".agents/skills/memory-lane/SKILL.md")
    message = writeGeneratedSkill(skillPath, skillContent(options.binaryPath)).warning
  }

  return { harness: "codex-cli", configured: true, configPath, message }
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

function localPiAdapterPath(binaryPath: string): string | undefined {
  const normalized = path.normalize(binaryPath)
  const expectedSuffix = path.join("packages", "cli", "dist", "index.js")
  if (!normalized.endsWith(expectedSuffix)) return undefined
  const candidate = path.resolve(path.dirname(binaryPath), "../../pi-adapter/dist/index.js")
  return fs.existsSync(candidate) ? candidate : undefined
}

function piAdapterImportSource(adapterPath: string): string {
  const adapterUrl = pathToFileURL(adapterPath).href
  return `export default async function memoryLaneExtension(pi: any) {\n  const mod = await import(${JSON.stringify(`${adapterUrl}?reload=`)} + Date.now());\n  return mod.default(pi);\n}\n`
}

function piCliBridgeSource(binaryPath: string): string {
  return `import { execFile as execFileCallback } from "node:child_process"\nimport { promisify } from "node:util"\n\nconst execFile = promisify(execFileCallback)\nconst MEMORY_LANE_BINARY = ${JSON.stringify(binaryPath)}\n\nfunction commandFor(args: string[]): { command: string; args: string[] } {\n  if (/\\.[cm]?[jt]s$/u.test(MEMORY_LANE_BINARY)) return { command: process.execPath, args: [MEMORY_LANE_BINARY, ...args] }\n  return { command: MEMORY_LANE_BINARY, args }\n}\n\nasync function runMemoryLane(args: string[], ctx: any): Promise<string> {\n  const fullArgs = [...args]\n  if (ctx?.cwd && !fullArgs.includes("--project")) fullArgs.push("--project", ctx.cwd)\n  const command = commandFor(fullArgs)\n  const { stdout } = await execFile(command.command, command.args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })\n  return stdout.trim()\n}\n\nfunction notify(ctx: any, message: string, level: "info" | "warning" = "info"): void {\n  ctx?.ui?.notify?.(message, level)\n}\n\nfunction parseJson(stdout: string): any {\n  try { return JSON.parse(stdout) } catch { return undefined }\n}\n\nfunction memoryText(record: any): string {\n  const id = record?.id ? "[" + record.id + "] " : ""\n  return id + (record?.text ?? "")\n}\n\nasync function routeForPrompt(prompt: string, ctx: any): Promise<any> {\n  const stdout = await runMemoryLane(["route", "--prompt", prompt, "--json"], ctx)\n  return parseJson(stdout)?.data?.route\n}\n\nfunction renderContinuityGuidance(): string {\n  return [\n    "## Memory Lane continuity guidance",\n    "",\n    "This prompt appears to ask about prior or ongoing project work.",\n    "Before answering from chat context alone, inspect the canonical Memory Lane continuity state and current project workflow when available.",\n    "",\n    "Suggested inspection:",\n    "- CLI: memory-lane continuity --json",\n    "- Do not answer from memory_recall alone; use recall only for topic-specific follow-up after continuity inspection.",\n    "- memory-lane status --json",\n    "- memory-lane dashboard",\n  ].join("\\n")\n}\n\nfunction renderMemoryManagementListGuidance(): string {\n  return [\n    "## Memory Lane command guidance",\n    "",\n    "The user is asking for an authoritative Memory Lane list/status/review, not a relevance-filtered memory injection.",\n    "Use the authoritative Memory Lane surface instead of answering from injected Relevant Memory:",\n    "- CLI: memory-lane list --json for visible current-scope memories.",\n    "- CLI: memory-lane review --json for pending review items.",\n    "- CLI: memory-lane status --json for counts and project scope.",\n  ].join("\\n")\n}\n\nconst LOW_SIGNAL_PROMPTS = new Set(["ok", "okay", "yes", "yep", "yeah", "sure", "sounds good", "go ahead", "continue", "proceed", "approved", "looks good", "thanks", "thank you", "hi", "hello", "hello there", "hey", "hey there", "hiya", "yo", "good morning", "good afternoon", "good evening"])\nconst STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "can", "did", "do", "does", "for", "from", "how", "i", "in", "is", "it", "of", "off", "on", "or", "please", "that", "the", "this", "to", "use", "we", "what", "where", "with", "you"])\n\nfunction normalizePrompt(prompt: string): string {\n  return prompt.toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, " ").trim().replace(/\\s+/gu, " ")\n}\n\nfunction shouldSkipAutomaticInjection(prompt: string): boolean {\n  const normalized = normalizePrompt(prompt)\n  if (!normalized) return true\n  if (LOW_SIGNAL_PROMPTS.has(normalized)) return true\n  const tokens = normalized.split(" ").filter((token) => token && !STOP_WORDS.has(token))\n  return tokens.length === 0\n}\n\nfunction truncateAtBoundary(text: string, maxChars: number): string | undefined {\n  if (maxChars <= 1) return undefined\n  if (text.length <= maxChars) return text\n  const slice = text.slice(0, maxChars - 1).trimEnd()\n  if (!slice) return undefined\n  const boundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "))\n  if (boundary >= 40) return slice.slice(0, boundary + 1) + "…"\n  return slice + "…"\n}\n\nfunction fitMemoriesWithinBudget(memories: any[], maxItems: number, maxChars: number): any[] {\n  const selected: any[] = []\n  let chars = 0\n  const itemLimit = Number.isFinite(maxItems) && maxItems > 0 ? Math.floor(maxItems) : 8\n  const charLimit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 3000\n  for (const memory of memories) {\n    if (selected.length >= itemLimit) break\n    const remaining = charLimit - chars\n    if (remaining <= 0) break\n    const text = typeof memory?.text === "string" ? memory.text : ""\n    const fitted = truncateAtBoundary(text, remaining)\n    if (!fitted) continue\n    selected.push({ ...memory, text: fitted })\n    chars += fitted.length\n  }\n  return selected\n}\n\nfunction isContinuityPrompt(prompt: string): boolean {\n  const input = prompt.trim()\n  const normalized = input.toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, " ").trim().replace(/\\s+/gu, " ")\n  return /^(?:let'?s\\s+)?resume\\s+(?:building|working\\s+on|work\\s+on)\\s+(.+?)\\s*$/iu.test(input)\n    || /^continue\\s+(?:building|working\\s+on|work\\s+on)\\s+(.+?)\\s*$/iu.test(input)\n    || /^pick\\s+up\\s+(.+?)(?:\\s+again)?[?.!]*\\s*$/iu.test(input)\n    || /^where\\s+was\\s+(.+?)\\s+implemented\\??$/iu.test(input)\n    || /^when\\s+did\\s+we\\s+implement\\s+(.+?)\\??$/iu.test(input)\n    || /^where\\s+did\\s+we\\s+(?:build|implement)\\s+(.+?)\\??$/iu.test(input)\n    || /^find\\s+the\\s+(?:thread|session)\\s+where\\s+we\\s+(?:built|implemented)\\s+(.+?)\\??$/iu.test(input)\n    || /^find\\s+the\\s+(?:thread|session)\\s+where\\s+(.+?)\\s+(?:was\\s+built|was\\s+implemented|happened)\\??$/iu.test(input)\n    || /\\bwhere\\s+are\\s+we\\s+(?:in|on)\\s+(?:the\\s+)?project\\b/iu.test(normalized)\n    || /\\bwhere\\s+did\\s+we\\s+leave\\s+off\\b/iu.test(normalized)\n    || /\\bwhat(?:\\s+s|\\s+is)\\s+the\\s+latest\\s+progress\\b/iu.test(normalized)\n    || /\\bwhat\\s+were\\s+we\\s+last\\s+working\\s+on\\b/iu.test(normalized)\n    || /\\bwhat\\s+should\\s+we\\s+work\\s+on\\s+next\\b/iu.test(normalized)\n    || /\\bwhat(?:\\s+s|\\s+is)\\s+next\\b/iu.test(normalized)\n    || /\\bwhat(?:\\s+s|\\s+is)\\s+the\\s+next\\s+slice\\b/iu.test(normalized)\n}\n\nfunction renderPolicyOnlyContext(): string {\n  return [\n    "## Memory Lane command guidance",\n    "",\n    "Memory Lane context policy is policy-only, so do not rely on injected memory bodies.",\n    "Use explicit Memory Lane commands when memory context is needed:",\n    "- memory-lane recall <query>",\n    "- memory-lane list --json",\n    "- memory-lane status --json",\n  ].join("\\n")\n}\n\nfunction renderContinuityContext(model: any): string {\n  const lines = [\n    "Memory Lane continuity context",\n    "",\n    "Use this read-only continuity state before answering prior-work, next-action, or project-status questions. Verify against current repository state when available.",\n  ]\n  const latestProgress = model?.latestProgress\n  const latestProject = model?.latestApproved?.project\n  if (latestProgress) lines.push("", "Latest project progress: [" + latestProgress.id + "] " + latestProgress.preview)\n  if (latestProject && latestProject.id !== latestProgress?.id) lines.push("", "Latest approved project continuity: [" + latestProject.id + "] " + latestProject.preview)\n  const operatingGuidance = model?.operatingGuidance ?? []\n  if (operatingGuidance.length) {\n    lines.push("", "Operating guidance:")\n    for (const item of operatingGuidance.slice(0, 5)) lines.push("- [" + item.id + "] " + item.preview)\n  }\n  const latestGlobal = model?.latestApproved?.global\n  if (latestGlobal) lines.push("", "Relevant global workflow context: [" + latestGlobal.id + "] " + latestGlobal.preview)\n  const candidates = model?.workstreamDiscovery?.candidates ?? []\n  if (candidates.length) {\n    lines.push("", "Workstream candidates:")\n    for (const candidate of candidates.slice(0, 3)) lines.push("- [" + candidate.id + "] " + candidate.preview)\n  }\n  const pending = model?.pendingContinuity ?? []\n  if (pending.length) {\n    lines.push("", "Pending continuity candidates require review before treating as fact:")\n    for (const item of pending.slice(0, 3)) lines.push("- [" + item.id + "] " + item.preview)\n  }\n  const warnings = model?.warnings ?? []\n  if (warnings.length) {\n    lines.push("", "Continuity warnings:")\n    for (const warning of warnings.slice(0, 3)) lines.push("- " + warning.code + ": " + warning.message)\n  }\n  const answerGuidance = model?.answerGuidance ?? []\n  if (answerGuidance.length) {\n    lines.push("", "Answer guidance:")\n    for (const guidance of answerGuidance.slice(0, 5)) lines.push("- " + guidance)\n  }\n  const actions = model?.suggestedActions ?? []\n  if (actions.length) {\n    lines.push("", "Suggested authoritative inspection:")\n    for (const action of actions.slice(0, 4)) lines.push("- " + action)\n  }\n  return lines.join("\\n")\n}\n\nconst categorySchema = { type: "string", enum: ["preference", "personal", "project"] }\nconst saveParameters = { type: "object", properties: { text: { type: "string" }, category: categorySchema }, required: ["text"] }\nconst suggestParameters = { type: "object", properties: { text: { type: "string" }, category: categorySchema, status: { type: "string", enum: ["approved", "pending"] } }, required: ["text"] }\nconst continuityParameters = { type: "object", properties: { query: { type: "string" } } }\nconst recallParameters = { type: "object", properties: { query: { type: "string" } }, required: ["query"] }\nconst getParameters = { type: "object", properties: { id: { type: "string" }, all: { type: "boolean" } }, required: ["id"] }\n\nexport default function memoryLaneCliBridge(pi: any) {\n  pi.registerCommand("remember", {\n    description: "Save an approved persistent memory",\n    handler: async (args: string, ctx: any) => {\n      const text = args?.trim() ?? ""\n      if (!text) { notify(ctx, "Text required", "warning"); return }\n      try {\n        const stdout = await runMemoryLane(["save", text, "--status", "approved"], ctx)\n        notify(ctx, stdout || "Memory saved")\n      } catch (error) {\n        notify(ctx, error instanceof Error ? error.message : String(error), "warning")\n      }\n    },\n  })\n\n  pi.registerCommand("memory", {\n    description: "Run Memory Lane CLI commands",\n    handler: async (args: string, ctx: any) => {\n      const parts = (args ?? "").trim().split(/\\s+/u).filter(Boolean)\n      if (!parts.length) { notify(ctx, "Usage: /memory list | recall <query> | show <id> | review | status", "info"); return }\n      const mapped = parts[0] === "use" ? ["recall", ...parts.slice(1)] : parts\n      try {\n        const stdout = await runMemoryLane(mapped, ctx)\n        notify(ctx, stdout || "Memory Lane command completed")\n      } catch (error) {\n        notify(ctx, error instanceof Error ? error.message : String(error), "warning")\n      }\n    },\n  })\n\n  pi.registerTool({\n    name: "memory_save",\n    label: "Save Memory",\n    description: "Save an approved persistent memory directly.",\n    parameters: saveParameters,\n    async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {\n      const args = ["save", params.text, "--status", "approved", "--json"]\n      if (params.category) args.push("--category", params.category)\n      const stdout = await runMemoryLane(args, ctx)\n      const parsed = parseJson(stdout)\n      const saved = parsed?.data?.saved ?? parsed?.data?.memory\n      return { content: [{ type: "text", text: saved?.id ? "Saved memory " + saved.id : stdout }], details: saved ? { id: saved.id } : {} }\n    },\n  })\n\n  pi.registerTool({\n    name: "memory_suggest",\n    label: "Suggest Memory",\n    description: "Queue a durable project-specific memory suggestion for user review.",\n    parameters: suggestParameters,\n    async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {\n      const args = ["suggest", params.text, "--json"]\n      if (params.category) args.push("--category", params.category)\n      if (params.status) args.push("--status", params.status)\n      const stdout = await runMemoryLane(args, ctx)\n      const parsed = parseJson(stdout)\n      const saved = parsed?.data?.saved ?? parsed?.data?.memory\n      return { content: [{ type: "text", text: saved?.id ? "Queued memory " + saved.id : stdout }], details: saved ? { id: saved.id } : {} }\n    },\n  })\n\n  pi.registerTool({\n    name: "memory_continuity",\n    label: "Memory Continuity",\n    description: "Read canonical Memory Lane continuity state for broad prior-work, next-action, or project-status questions. Use before memory_recall for handoff-style prompts.",\n    parameters: continuityParameters,\n    async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {\n      const args = ["continuity", "--json"]\n      if (params.query) args.splice(1, 0, "--query", params.query)\n      const stdout = await runMemoryLane(args, ctx)\n      const parsed = parseJson(stdout)\n      const continuity = parsed?.data?.continuity ?? parsed?.data\n      const text = continuity ? renderContinuityContext(continuity) : stdout\n      return { content: [{ type: "text", text }], details: continuity ? { projectScope: continuity.projectScope, latestApproved: continuity.latestApproved, pendingContinuityCount: continuity.status?.pendingContinuityCount } : {} }\n    },\n  })\n\n  pi.registerTool({\n    name: "memory_recall",\n    label: "Recall Memory",\n    description: "Recall approved persistent memories.",\n    parameters: recallParameters,\n    async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {\n      const stdout = await runMemoryLane(["recall", params.query ?? "", "--json"], ctx)\n      const parsed = parseJson(stdout)\n      const memories = parsed?.data?.memories ?? []\n      const text = memories.length ? memories.map(memoryText).join("\\n") : stdout\n      return { content: [{ type: "text", text }], details: { ids: memories.map((memory: any) => memory.id) } }\n    },\n  })\n\n  pi.registerTool({\n    name: "memory_get",\n    label: "Get Memory",\n    description: "Show one Memory Lane memory by exact id.",\n    parameters: getParameters,\n    async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {\n      const args = ["show", params.id, "--json"]\n      if (params.all) args.push("--all")\n      const stdout = await runMemoryLane(args, ctx)\n      const parsed = parseJson(stdout)\n      const memory = parsed?.data?.memory\n      return { content: [{ type: "text", text: memory ? memoryText(memory) : stdout }], details: memory ? { id: memory.id } : {} }\n    },\n  })\n\n  pi.on("before_agent_start", async (event: any, ctx: any) => {\n    const prompt = typeof event?.prompt === "string" ? event.prompt.trim() : ""\n    if (!prompt) return undefined\n    try {\n      const status = parseJson(await runMemoryLane(["status", "--json"], ctx))\n      const mode = status?.data?.contextPolicyMode\n      if (mode === "off") return undefined\n      let route: any\n      try { route = await routeForPrompt(prompt, ctx) } catch { route = undefined }\n      if (mode === "policy-only") {\n        const content = route?.route === "memory-management" ? renderMemoryManagementListGuidance() : route?.route === "continuity" ? renderContinuityGuidance() : renderPolicyOnlyContext()\n        return { message: { customType: "memory-lane", content, display: false, details: { source: "memory-lane", lifecycleEvent: "user_prompt_submit", surface: "policy-only" } } }\n      }\n      if (route?.route === "memory-management") {\n        return { message: { customType: "memory-lane", content: renderMemoryManagementListGuidance(), display: false, details: { source: "memory-lane", lifecycleEvent: "user_prompt_submit", surface: "memory-management" } } }\n      }\n      if (route?.route === "continuity" || (!route && isContinuityPrompt(prompt))) {\n        const stdout = await runMemoryLane(["continuity", "--query", prompt, "--json"], ctx)\n        const parsed = parseJson(stdout)\n        const continuity = parsed?.data?.continuity ?? parsed?.data\n        const content = renderContinuityContext(continuity)\n        return { message: { customType: "memory-lane", content, display: false, details: { source: "memory-lane", lifecycleEvent: "user_prompt_submit", surface: "continuity" } } }\n      }\n\n      if (route?.route === "low-signal" || shouldSkipAutomaticInjection(prompt)) return undefined\n      const topK = Number(status?.data?.contextPolicyPromptMaxItems ?? 8)\n      const maxChars = Number(status?.data?.contextPolicyPromptMaxChars ?? 3000)\n      const recallArgs = ["recall", prompt, "--json"]\n      if (Number.isFinite(topK) && topK > 0) recallArgs.push("--top-k", String(topK))\n      const stdout = await runMemoryLane(recallArgs, ctx)\n      const parsed = parseJson(stdout)\n      const memories = fitMemoriesWithinBudget(parsed?.data?.memories ?? [], topK, maxChars)\n      if (!memories.length) return undefined\n      return { message: { customType: "memory-lane", content: "Relevant Memory Lane memories:\\n" + memories.map(memoryText).join("\\n"), display: false, details: { source: "memory-lane", lifecycleEvent: "user_prompt_submit" } } }\n    } catch {\n      return undefined\n    }\n  })\n}\n`
}

function piExtensionSource(binaryPath: string): string {
  const adapterPath = localPiAdapterPath(binaryPath)
  return adapterPath ? piAdapterImportSource(adapterPath) : piCliBridgeSource(binaryPath)
}

export function installPi(options: InitOptions): IntegrationResult {
  const configPath = path.join(options.homeDir, ".pi/agent/extensions/memory-lane/index.ts")
  ensureDir(configPath)
  fs.writeFileSync(configPath, piExtensionSource(options.binaryPath), "utf8")
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
