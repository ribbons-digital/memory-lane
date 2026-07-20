import * as path from "node:path"
import { Type } from "typebox"
import { classifyPromptRoute, createLearningEventSink, createOpenAICompatibleProvider, handlePostToolUse, handlePreCompact, handleSessionEnd, handleStop, handleUserPromptSubmit, resolveContextPolicy, saveSessionSummaryCandidates as persistSessionSummaryCandidates } from "@memory-lane/lifecycle"
import type { PostToolUseInput, SessionMessage } from "@memory-lane/lifecycle"
import {
  MemoryEngine, buildContinuityWarningRenderPlan, continuityWarningInspectionActions, createSingleStoreEngineStorage, createTwoTierEngineStorage, inferMemoryKind, initProjectLocalStorage, loadConfig, parseExplicitMemoryRequest, resolveWritableEngineStoragePaths, type SaveResult,
} from "@memory-lane/core"
import { isPiDebugEnabled, piDebugPath, writePiDebugLog } from "./debug.js"

// ── pi ExtensionAPI / ExtensionContext interfaces (shim) ──────
// These are the interfaces we expect from the pi harness. The adapter
// is designed to be used with pi's extension system via dynamic import.

export interface ExtensionContext {
  cwd: string
  ui?: {
    notify(message: string, level?: "info" | "warning" | "error"): void
    confirm?(title: string, message?: string): Promise<boolean> | boolean
  }
  sessionManager?: {
    getSessionFile?(): string | undefined
    getHeader?(): unknown
    getArtifactsDir?(): string | undefined
    getBranch?(): Array<{
      type: string
      message?: {
        role?: string
        content?: unknown
      }
    }>
  }
  getSystemPrompt?(): string[]
}

export interface ExtensionAPI {
  registerCommand(name: string, handler: {
    description: string
    handler: (args: string | undefined, ctx: ExtensionContext) => Promise<void> | void
  }): void
  registerTool(tool: {
    name: string
    label: string
    description: string
    parameters: import("typebox").TObject<any>
    execute: (
      id: string,
      params: Record<string, string>,
      signal: AbortSignal | undefined,
      onUpdate: (update: any) => void,
      ctx: ExtensionContext,
    ) => Promise<{ content: Array<{ type: string; text: string }>; details?: Record<string, any> }>
  }): void
  on(event: string, handler: (event: any, ctx: ExtensionContext) => Promise<any> | any): void
}

// ── Engine singleton ─────────────────────────────────────────

let engine: MemoryEngine | null = null
let engineKey: string | null = null

let lastProcessedTurnId: string | undefined
let savedThisTurn = new Set<string>()

function resetTurnState(turnId?: string): void {
  if (turnId && turnId !== lastProcessedTurnId) {
    lastProcessedTurnId = turnId
    savedThisTurn = new Set<string>()
  }
}

function normalizeForDedupe(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/gu, " ")
}

function markSaved(text: string): void {
  savedThisTurn.add(normalizeForDedupe(text))
}

function wasSaved(text: string): boolean {
  return savedThisTurn.has(normalizeForDedupe(text))
}

function memoryEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MEMORY_LANE_FILE: process.env.PI_MEMORY_FILE ?? process.env.MEMORY_LANE_FILE,
    MEMORY_LANE_EMBEDDINGS_FILE: process.env.PI_MEMORY_EMBEDDINGS_FILE ?? process.env.MEMORY_LANE_EMBEDDINGS_FILE,
    MEMORY_LANE_CONFIG: process.env.PI_MEMORY_CONFIG_FILE ?? process.env.MEMORY_LANE_CONFIG,
  }
}

function getEngine(cwd: string): MemoryEngine {
  const paths = resolveWritableEngineStoragePaths({ cwd, env: memoryEnv(), autoInitProjectLocalOnHomeFailure: true })
  const key = `${paths.kind}\n${paths.home.memoryPath}\n${paths.home.embeddingsPath}\n${paths.configPath}\n${paths.project?.memoryPath ?? ""}`
  if (!engine || engineKey !== key) {
    const storage = paths.kind === "default-two-tier"
      ? createTwoTierEngineStorage(paths.home, paths.project, paths.projectScopeKey)
      : createSingleStoreEngineStorage(paths.home.memoryPath, paths.home.embeddingsPath)
    engine = new MemoryEngine({
      memoryPath: paths.home.memoryPath,
      embeddingsPath: paths.home.embeddingsPath,
      storage,
      configPath: paths.configPath,
      learningEventSink: createLearningEventSink({ configPath: paths.configPath, env: memoryEnv() }),
    })
    engineKey = key
  }
  engine.refreshScope(cwd)
  return engine
}

function resetEngine(): void {
  engine = null
  engineKey = null
}

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
  ctx?.ui?.notify?.(message, level)
}

function storageGuidance(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return [
    `Memory Lane could not write to its current storage location (${message}).`,
    "",
    "Preferred: approve write access to ~/.memory-lane when your harness asks, then retry so memories stay global across projects.",
    "",
    "If you do not want to grant home-directory access, run `/memory init-project-local` to create .memory-lane/ in this project and retry using project-local storage.",
  ].join("\n")
}

function piSessionId(ctx: ExtensionContext): string | undefined {
  try {
    return ctx.sessionManager?.getSessionFile?.()
  } catch {
    return undefined
  }
}

const OMP_TASK_ROLE_SENTENCE = "You are a worker agent for delegated tasks."

function isOmpTaskSession(ctx: ExtensionContext): boolean {
  try {
    const sessionFile = ctx.sessionManager?.getSessionFile?.()
    const artifactsDir = ctx.sessionManager?.getArtifactsDir?.()
    const systemPrompt = ctx.getSystemPrompt?.()
    if (typeof sessionFile !== "string" || typeof artifactsDir !== "string" || !Array.isArray(systemPrompt)) return false
    const nestedSessionFile = path.resolve(path.dirname(sessionFile)) === path.resolve(artifactsDir)
    const delegatedWorkerRole = systemPrompt.some((part) => typeof part === "string" && part.includes(OMP_TASK_ROLE_SENTENCE))
    return nestedSessionFile && delegatedWorkerRole
  } catch {
    return false
  }
}

function memoryLaneContextMessage(content: string, details: Record<string, unknown> = {}) {
  return {
    customType: "memory-lane",
    content,
    display: false,
    details: {
      source: "memory-lane",
      lifecycleEvent: "user_prompt_submit",
      ...details,
    },
  }
}

function piRenderedWarningInspectionActions(warnings: any[]): Set<string> {
  return buildContinuityWarningRenderPlan(warnings).renderedInspectionActions
}

function renderPiWarningBlock(warnings: any[]): string[] {
  if (!warnings.length) return []
  const plan = buildContinuityWarningRenderPlan(warnings)
  const lines: string[] = []
  const renderWarning = (warning: any) => {
    lines.push(`- ${warning.code}: ${warning.message}`)
    if (warning.code === "operating-agreement-overlap") lines.push("  Do not treat overlapping workflow guidance as authoritative until inspected.")
    for (const action of continuityWarningInspectionActions(warning).slice(0, 3)) lines.push(`  Inspect: ${action}`)
  }
  if (plan.actionRequiredWarnings.length) {
    lines.push("", "Action required before applying continuity guidance:")
    for (const warning of plan.actionRequiredWarnings) renderWarning(warning)
  }
  if (plan.infoWarnings.length) {
    lines.push("", "Continuity notes:")
    for (const warning of plan.infoWarnings) renderWarning(warning)
  }
  if (plan.omittedWarningCount > 0) lines.push(`${plan.omittedWarningCount} more warnings omitted`)
  return lines
}

function renderPiContinuityContext(model: any): string {
  const lines = [
    "Memory Lane continuity context",
    "",
    "Use this read-only continuity state before answering prior-work, next-action, or project-status questions. Verify against current repository state when available.",
  ]
  const renderedIds = new Set<string>()

  const latestProgress = model?.latestProgress
  const latestProject = model?.latestApproved?.project
  if (latestProgress) {
    lines.push("", `Latest project progress: [${latestProgress.id}] ${latestProgress.preview}`)
    renderedIds.add(latestProgress.id)
  }
  if (latestProject && !renderedIds.has(latestProject.id)) {
    lines.push("", `Latest approved project continuity: [${latestProject.id}] ${latestProject.preview}`)
    renderedIds.add(latestProject.id)
  }

  const warnings = model?.warnings ?? []
  lines.push(...renderPiWarningBlock(warnings))

  const operatingGuidance = model?.operatingGuidance ?? []
  const operatingGuidanceLines: string[] = []
  for (const item of operatingGuidance) {
    if (renderedIds.has(item.id)) continue
    operatingGuidanceLines.push(`- [${item.id}] ${item.preview}`)
    renderedIds.add(item.id)
    if (operatingGuidanceLines.length >= 5) break
  }
  if (operatingGuidanceLines.length) lines.push("", "Operating guidance:", ...operatingGuidanceLines)

  const latestGlobal = model?.latestApproved?.global
  if (latestGlobal && !renderedIds.has(latestGlobal.id)) lines.push("", `Relevant global workflow context: [${latestGlobal.id}] ${latestGlobal.preview}`)

  const candidates = model?.workstreamDiscovery?.candidates ?? []
  if (candidates.length) {
    lines.push("", "Workstream candidates:")
    for (const candidate of candidates.slice(0, 3)) lines.push(`- [${candidate.id}] ${candidate.preview}`)
  }

  const pending = model?.pendingContinuity ?? []
  if (pending.length) {
    lines.push("", "Pending continuity candidates require review before treating as fact:")
    for (const item of pending.slice(0, 3)) lines.push(`- [${item.id}] ${item.preview}`)
  }

  const answerGuidance = model?.answerGuidance ?? []
  if (answerGuidance.length) {
    lines.push("", "Answer guidance:")
    for (const guidance of answerGuidance.slice(0, 5)) lines.push(`- ${guidance}`)
  }

  const warningActions = piRenderedWarningInspectionActions(warnings)
  const actions = (model?.suggestedActions ?? []).filter((action: string) => !warningActions.has(action))
  if (actions.length) {
    lines.push("", "Suggested authoritative inspection:")
    for (const action of actions.slice(0, 4)) lines.push(`- ${action}`)
  }

  return lines.join("\n")
}

function formatMemory(m: { id: string; scope: { type: string }; category: string; text: string; status?: string }): string {
  const statusTag = m.status && m.status !== "approved" ? ` [${m.status}]` : ""
  return `[${m.id}] (${m.scope.type}/${m.category})${statusTag} ${m.text}`
}

function formatSaveResult(r: SaveResult): string {
  if (r.status === "saved") return `Saved memory ${formatMemory(r.memory)}`
  return `Memory not saved: ${r.reason}`
}

type PiBranchEntry = NonNullable<ExtensionContext["sessionManager"]> extends { getBranch?: () => infer Entries }
  ? Entries extends Array<infer Entry> ? Entry : never
  : never

function textPartsFromContent(content: unknown): string[] {
  if (typeof content === "string") return [content]
  if (!Array.isArray(content)) return []
  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== "object") continue
    const block = part as { type?: string; text?: unknown }
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text)
  }
  return parts
}

function sessionMessagesFromPiBranch(branch: PiBranchEntry[]): SessionMessage[] {
  const messages: SessionMessage[] = []
  for (const entry of branch) {
    if (!entry || entry.type !== "message") continue
    const role = entry.message?.role
    if (role !== "user" && role !== "assistant") continue
    const content = textPartsFromContent(entry.message?.content).join("\n").trim()
    if (!content) continue
    messages.push({ role, content })
  }
  return messages
}

function sessionMessagesFromUnknownMessages(values: unknown): SessionMessage[] {
  if (!Array.isArray(values)) return []
  const messages: SessionMessage[] = []
  for (const value of values) {
    if (!value || typeof value !== "object") continue
    const record = value as { role?: unknown; content?: unknown; message?: { role?: unknown; content?: unknown }; type?: unknown }
    const nested = record.message
    const role = typeof record.role === "string" ? record.role : typeof nested?.role === "string" ? nested.role : undefined
    if (role !== "user" && role !== "assistant" && role !== "tool") continue
    const rawContent = record.content ?? nested?.content
    const content = textPartsFromContent(rawContent).join("\n").trim()
    if (!content) continue
    messages.push({ role, content })
  }
  return messages
}

function eventRecord(event: unknown): Record<string, unknown> {
  return event && typeof event === "object" ? event as Record<string, unknown> : {}
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function lastBranchMessage(ctx: ExtensionContext, role: "user" | "assistant"): string | undefined {
  try {
    const branch = ctx.sessionManager?.getBranch?.()
    if (!Array.isArray(branch)) return undefined
    return sessionMessagesFromPiBranch(branch).filter((message) => message.role === role).at(-1)?.content
  } catch {
    return undefined
  }
}

function normalizedTurnEnd(event: unknown, ctx: ExtensionContext): { turnId?: string; lastUserMessage?: string; lastAssistantMessage?: string } {
  const record = eventRecord(event)
  const message = eventRecord(record.message)
  const turnIndex = typeof record.turnIndex === "number" ? String(record.turnIndex) : undefined
  const assistantContent = textPartsFromContent(message.content).join("\n").trim()
  return {
    turnId: stringField(record, "turnId") ?? turnIndex,
    lastUserMessage: stringField(record, "lastUserMessage") ?? lastBranchMessage(ctx, "user"),
    lastAssistantMessage: stringField(record, "lastAssistantMessage") ?? (assistantContent || lastBranchMessage(ctx, "assistant")),
  }
}

function normalizedToolResult(event: unknown): { turnId?: string; toolName?: string; toolInput: unknown; toolResponse: unknown } {
  const record = eventRecord(event)
  const turnIndex = typeof record.turnIndex === "number" ? String(record.turnIndex) : undefined
  const contentText = textPartsFromContent(record.content).join("\n").trim()
  const isError = typeof record.isError === "boolean" ? record.isError : undefined
  return {
    turnId: stringField(record, "turnId") ?? turnIndex,
    toolName: stringField(record, "toolName"),
    toolInput: "toolInput" in record ? record.toolInput : record.input,
    toolResponse: "toolResponse" in record
      ? record.toolResponse
      : {
          content: record.content,
          details: record.details,
          isError,
          text: contentText || undefined,
          exitCode: isError === undefined ? undefined : isError ? 1 : 0,
        },
  }
}

function compactionValues(event: any): unknown[] {
  const preparation = event?.preparation
  return [
    ...(Array.isArray(preparation?.messagesToSummarize) ? preparation.messagesToSummarize : []),
    ...(Array.isArray(preparation?.turnPrefixMessages) ? preparation.turnPrefixMessages : []),
    ...(Array.isArray(event?.messages) ? event.messages : []),
    ...(Array.isArray(event?.branchEntries) ? event.branchEntries : []),
  ]
}

function compactionWouldDiscardSplitTurnEvidence(event: any): boolean {
  return compactionValues(event).some((value) => {
    if (!value || typeof value !== "object") return false
    const record = value as { role?: unknown; message?: { role?: unknown; content?: unknown }; content?: unknown; type?: unknown }
    const role = typeof record.role === "string" ? record.role : typeof record.message?.role === "string" ? record.message.role : undefined
    if (role === "toolResult" || role === "tool_result") return true
    const content = record.content ?? record.message?.content
    if (!Array.isArray(content)) return false
    return content.some((part) => {
      if (!part || typeof part !== "object") return false
      const type = (part as { type?: unknown }).type
      return type !== "text"
    })
  })
}

function compactionSummary(event: any): string | undefined {
  const summary = event?.compactionEntry?.summary
  return typeof summary === "string" && summary.trim() ? summary.trim() : undefined
}

function sessionMessagesFromPiCompactionEvent(event: any): SessionMessage[] {
  const preparation = event?.preparation
  const preparedMessages = [
    ...sessionMessagesFromUnknownMessages(preparation?.messagesToSummarize),
    ...sessionMessagesFromUnknownMessages(preparation?.turnPrefixMessages),
  ]
  if (preparedMessages.length) return preparedMessages

  const branchEntries = Array.isArray(event?.branchEntries) ? event.branchEntries : []
  const branchMessages = sessionMessagesFromPiBranch(branchEntries as PiBranchEntry[])
  if (branchMessages.length) return branchMessages

  return sessionMessagesFromUnknownMessages(event?.messages)
}

function preCompactSummaryEnabled(config: ReturnType<typeof loadConfig>): boolean {
  return config.memory?.sessionEndSummary?.enabled === true && config.memory?.preCompactSummary?.enabled !== false
}

function piPreCompactTrigger(event: any): "manual" | "auto" {
  return event?.reason === "manual" ? "manual" : "auto"
}

// ── Main extension ───────────────────────────────────────────

export default function memoryLaneExtension(pi: ExtensionAPI) {
  const deferredPreCompact = new Map<string, { turnId?: string; trigger: "manual" | "auto" }>()
  const maxDeferredSessions = 32

  function sessionDeferralKey(ctx: ExtensionContext): string {
    return piSessionId(ctx) ?? `cwd:${path.resolve(ctx.cwd)}`
  }

  function deferPreCompact(ctx: ExtensionContext, turnId: string | undefined, trigger: "manual" | "auto"): void {
    const key = sessionDeferralKey(ctx)
    deferredPreCompact.delete(key)
    deferredPreCompact.set(key, { turnId, trigger })
    while (deferredPreCompact.size > maxDeferredSessions) {
      const oldest = deferredPreCompact.keys().next().value
      if (typeof oldest !== "string") break
      deferredPreCompact.delete(oldest)
    }
  }

  function clearDeferredPreCompact(ctx?: ExtensionContext): void {
    if (ctx) deferredPreCompact.delete(sessionDeferralKey(ctx))
    else deferredPreCompact.clear()
  }
  // ── Commands ─────────────────────────────────────────────

  async function runPiSessionSummaryCommand(ctx: ExtensionContext): Promise<void> {
    const config = loadConfig(process.env.PI_MEMORY_CONFIG_FILE ?? process.env.MEMORY_LANE_CONFIG)
    const summaryConfig = config.memory?.sessionEndSummary

    if (!summaryConfig?.enabled) {
      notify(ctx, "Session-end summarization is not enabled. Configure memory.sessionEndSummary.enabled first.", "warning")
      return
    }
    if (!summaryConfig.baseUrl || !summaryConfig.model) {
      notify(ctx, "Session-end summarization requires memory.sessionEndSummary.baseUrl and model.", "warning")
      return
    }

    const branch = ctx.sessionManager?.getBranch?.() ?? []
    const messages = sessionMessagesFromPiBranch(branch as PiBranchEntry[])
    if (!messages.length) {
      notify(ctx, "No conversation text found to summarize.", "warning")
      return
    }

    if (!ctx.ui?.confirm) {
      notify(ctx, "/memory session-summary requires interactive confirmation in pi.", "warning")
      return
    }

    const ok = await ctx.ui.confirm("Summarize this pi session?", "Memory Lane will send a compact transcript to your configured session summary provider and save the result as a pending memory.")
    if (!ok) {
      notify(ctx, "Session summary cancelled.", "info")
      return
    }

    notify(ctx, "Generating session summary...", "info")
    const e = getEngine(ctx.cwd)
    const provider = createOpenAICompatibleProvider({
      provider: "openai-compatible",
      baseUrl: summaryConfig.baseUrl,
      apiKeyEnv: summaryConfig.apiKeyEnv,
      model: summaryConfig.model,
      timeoutMs: summaryConfig.timeoutMs,
    }, memoryEnv())
    const candidates = await handleSessionEnd(e, {
      cwd: ctx.cwd,
      sessionId: piSessionId(ctx),
      messages,
    }, {
      provider,
      promptTemplate: summaryConfig.promptTemplate ?? undefined,
      maxTokens: summaryConfig.maxTokens,
      requireConfirmation: false,
      confirmed: true,
      includeToolOutputs: summaryConfig.includeToolOutputs,
      adapter: "pi",
    }, memoryEnv())
    const saved = saveSessionSummaryCandidates(e, candidates)

    if (!saved.length) {
      notify(ctx, "No durable session summary was generated.", "info")
      return
    }
    notify(ctx, `Saved ${saved.length} pending session summary${saved.length === 1 ? "" : "ies"}. Run /memory review to inspect.`, "info")
  }

  pi.registerCommand("remember", {
    description: "Save an approved persistent memory",
    handler: async (args, ctx) => {
      try {
        const e = getEngine(ctx.cwd)
        const text = args?.trim() ?? ""
        if (!text) { notify(ctx, "Text required", "warning"); return }
        const result = e.save({ text, status: "approved", source: "manual" })
        notify(ctx, formatSaveResult(result))
      } catch (err) {
        notify(ctx, storageGuidance(err), "warning")
      }
    },
  })

  pi.registerCommand("memory", {
    description: "List, search, delete, or recall persistent memories",
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim()
      const parts = trimmed.split(/\s+/)
      const cmd = parts[0]
      const rest = parts.slice(1).join(" ")
      const allScope = parts.includes("--all")

      if (cmd === "init-project-local" || (cmd === "init" && rest === "--project-local")) {
        const result = initProjectLocalStorage(ctx.cwd)
        resetEngine()
        notify(ctx, `Initialized project-local Memory Lane storage at ${result.paths.root}. Future memory commands in this project will use .memory-lane/ unless explicit environment paths are set.`)
        return
      }

      if (cmd === "session-summary" || cmd === "summarize-session") {
        try {
          await runPiSessionSummaryCommand(ctx)
        } catch (err) {
          notify(ctx, err instanceof Error ? `Session summary failed: ${err.message}` : "Session summary failed", "warning")
        }
        return
      }

      try {
        const e = getEngine(ctx.cwd)
        if (cmd === "continuity") {
          const query = rest.trim() || undefined
          const continuity = e.continuity({ caller: "core", query })
          notify(ctx, renderPiContinuityContext(continuity))
        } else if (cmd === "list") {
          const mems = e.list({ all: allScope })
          notify(ctx, mems.length ? mems.map(formatMemory).join("\n") : "No memories.")
        } else if (cmd === "search") {
          const mems = e.search(rest)
          notify(ctx, mems.length ? mems.map(formatMemory).join("\n") : "No matches.")
        } else if (cmd === "delete") {
          const id = parts.slice(1).filter((part) => part !== "--all").join(" ")
          const mem = e.delete(id, { all: allScope })
          notify(ctx, mem ? `Deleted memory ${id}` : `Memory not found: ${id}`, mem ? "info" : "warning")
        } else if (cmd === "use") {
          const result = await e.recall(rest)
          if (!result.memories.length) notify(ctx, "No matching memories.", "info")
          else notify(ctx, `Recalled ${result.memories.length} memories.\n` + result.memories.map(formatMemory).join("\n"))
        } else if (cmd === "review") {
          const pending = e.reviewPending({ all: allScope })
          e.recordSuggestionsShown(pending, "lifecycle")
          notify(ctx, pending.length ? pending.map(formatMemory).join("\n") : "No pending memories.")
        } else if (cmd === "compact") {
          const report = e.compact()
          notify(ctx, `Compact: removed ${report.removedMemories} memories, ${report.removedEmbeddings} embeddings`)
        } else if (cmd === "status" || cmd === "doctor") {
          const d = e.doctor()
          notify(ctx, Object.entries(d).map(([k, v]) => `${k}: ${v}`).join("\n"))
        } else {
          notify(ctx, "Usage: /memory list [--all] | search <q> | continuity [q] | delete <id> [--all] | use [q] | review [--all] | compact | status | session-summary | init-project-local")
        }
      } catch (err) {
        notify(ctx, storageGuidance(err), "warning")
      }
    },
  })

  // ── Tools ────────────────────────────────────────────────

  const memorySuggestSchema = Type.Object({
    text: Type.String({ description: "The memory text to suggest" }),
    category: Type.Optional(Type.String({ description: "Category: preference, personal, or project", enum: ["preference", "personal", "project"] })),
    status: Type.Optional(Type.String({ description: "Status: 'approved' to bypass review, or omitted for pending", enum: ["approved", "pending"] })),
  })

  pi.registerTool({
    name: "memory_suggest",
    label: "Suggest Memory",
    description: "Queue a durable project-specific memory suggestion for user review. Use when you proactively identify something worth remembering. For pending suggestions. When the user explicitly asks you to remember something, use memory_save instead.",
    parameters: memorySuggestSchema,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        const e = getEngine(ctx.cwd)
        const cat = params.category ?? "project"
        const status = params.status === "approved" ? "approved" as const : "pending" as const
        const result = e.suggest(params.text, cat as any, "project", undefined, status)
        if (result.status === "saved") {
          const reviewMsg = status === "pending" ? " Run /memory review." : ""
          notify(ctx, `Memory ${result.memory.id} ${status === "approved" ? "saved" : "suggested"}${reviewMsg}`)
          return {
            content: [{ type: "text", text: `Memory ${result.memory.id} ${status === "approved" ? "saved" : "queued"}${reviewMsg}` }],
            details: { id: result.memory.id },
          }
        }
        return {
          content: [{ type: "text", text: `Skipped: ${result.reason}` }],
          details: { skipped: result.reason },
        }
      } catch (err) {
        return { content: [{ type: "text", text: storageGuidance(err) }], details: { error: "storage-unavailable" } }
      }
    },
  })

  const memorySaveSchema = Type.Object({
    text: Type.String({ description: "The memory text to save" }),
    category: Type.Optional(Type.String({ description: "Category: preference, personal, or project", enum: ["preference", "personal", "project"] })),
  })

  pi.registerTool({
    name: "memory_save",
    label: "Save Memory",
    description: "Save an approved persistent memory directly. Use when the user explicitly asks you to remember something — bypasses the approval step.",
    parameters: memorySaveSchema,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        const e = getEngine(ctx.cwd)
        const cat = params.category ?? "project"
        const kind = inferMemoryKind(params.text, cat as any)
        const result = e.save({ text: params.text, category: cat as any, status: "approved", source: "manual", kind })
        if (result.status === "saved") {
          notify(ctx, `Memory ${result.memory.id} saved: ${result.memory.text.slice(0, 60)}...`)
          return {
            content: [{ type: "text", text: `Saved memory ${result.memory.id}: ${result.memory.text.slice(0, 100)}` }],
            details: { id: result.memory.id },
          }
        }
        return {
          content: [{ type: "text", text: `Skipped: ${result.reason}` }],
          details: { skipped: result.reason },
        }
      } catch (err) {
        return { content: [{ type: "text", text: storageGuidance(err) }], details: { error: "storage-unavailable" } }
      }
    },
  })

  const memoryContinuitySchema = Type.Object({
    query: Type.Optional(Type.String({ description: "Optional broad continuity question, e.g. what were we last working on?" })),
  })

  pi.registerTool({
    name: "memory_continuity",
    label: "Memory Continuity",
    description: "Read canonical Memory Lane continuity state for broad prior-work, next-action, or project-status questions. Use before memory_recall for handoff-style prompts.",
    parameters: memoryContinuitySchema,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        const e = getEngine(ctx.cwd)
        const continuity = e.continuity({ caller: "core", query: params.query })
        return {
          content: [{ type: "text", text: renderPiContinuityContext(continuity) }],
          details: {
            projectScope: continuity.projectScope,
            latestApproved: continuity.latestApproved,
            pendingContinuityCount: continuity.status?.pendingContinuityCount,
          },
        }
      } catch (err) {
        return { content: [{ type: "text", text: storageGuidance(err) }], details: { error: "storage-unavailable" } }
      }
    },
  })

  const memoryRecallSchema = Type.Object({
    query: Type.String({ description: "Search query to find relevant memories" }),
  })

  pi.registerTool({
    name: "memory_recall",
    label: "Recall Memory",
    description: "Recall approved persistent memories.",
    parameters: memoryRecallSchema,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        const e = getEngine(ctx.cwd)
        const result = await e.recall(params.query ?? "")
        const text = result.memories.length === 0
          ? "No matching approved memories."
          : `Recalled ${result.memories.length} memories.\n` + result.memories.map(formatMemory).join("\n")
        return {
          content: [{ type: "text", text }],
          details: { ids: result.memories.map((m) => m.id) },
        }
      } catch (err) {
        return { content: [{ type: "text", text: storageGuidance(err) }], details: { error: "storage-unavailable" } }
      }
    },
  })

  // ── Read-only lifecycle recall injection ─────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    if (isOmpTaskSession(ctx)) return undefined
    const prompt = typeof event.prompt === "string" ? event.prompt.trim() : ""
    if (!prompt) return undefined

    try {
      const e = getEngine(ctx.cwd)
      const policy = resolveContextPolicy(e.getContextPolicy())
      const routeDecision = classifyPromptRoute(prompt)
      if (routeDecision.route === "continuity" && policy.mode === "selective") {
        e.refreshScope(ctx.cwd)
        const continuity = e.continuity({ caller: "lifecycle", query: prompt })
        return { message: memoryLaneContextMessage(renderPiContinuityContext(continuity), { surface: "continuity" }) }
      }

      const result = await handleUserPromptSubmit(e, {
        cwd: ctx.cwd,
        prompt,
        sessionId: piSessionId(ctx),
      })

      if (!result.additionalContext) return undefined
      return { message: memoryLaneContextMessage(result.additionalContext) }
    } catch (err) {
      notify(ctx, storageGuidance(err), "warning")
      return undefined
    }
  })

  // ── Shared lifecycle write helper ─────────────────────────

  function isSaved(result: SaveResult): result is Extract<SaveResult, { status: "saved" }> {
    return result.status === "saved"
  }

  async function runLifecycleWrite(
    eventName: string,
    ctx: ExtensionContext,
    turnId: string | undefined,
    result: { saved: SaveResult[]; discarded: Array<{ text: string; reason: string }> },
  ): Promise<void> {
    resetTurnState(turnId)

    const newlySaved = result.saved.filter(isSaved).filter((s) => !wasSaved(s.memory.text))
    for (const save of newlySaved) markSaved(save.memory.text)

    if (isPiDebugEnabled()) {
      writePiDebugLog(piDebugPath(), {
        event: eventName,
        sessionId: piSessionId(ctx),
        turnId,
        savedCount: newlySaved.length,
        discardedCount: result.discarded.length,
      })
    }

    for (const save of newlySaved) {
      notify(ctx, `Auto-saved memory: ${formatMemory(save.memory)}`, "info")
    }
  }

  function saveSessionSummaryCandidates(e: MemoryEngine, candidates: Awaited<ReturnType<typeof handleSessionEnd>>): Array<Extract<SaveResult, { status: "saved" }>> {
    return persistSessionSummaryCandidates(e, candidates)
      .filter((result): result is Extract<SaveResult, { status: "saved" }> => result.status === "saved")
  }

  // ── Pre-compaction summary handler ───────────────────────

  pi.on("session_before_compact", async (event, ctx) => {
    if (isOmpTaskSession(ctx)) return undefined
    try {
      const config = loadConfig(process.env.PI_MEMORY_CONFIG_FILE ?? process.env.MEMORY_LANE_CONFIG)
      if (!preCompactSummaryEnabled(config)) return undefined

      const summaryConfig = config.memory?.sessionEndSummary
      const trigger = piPreCompactTrigger(event)
      if (!summaryConfig?.baseUrl || !summaryConfig.model) {
        if (trigger !== "auto" || isPiDebugEnabled()) notify(ctx, "Pre-compact summarization requires memory.sessionEndSummary.baseUrl and model.", "warning")
        return undefined
      }
      if (summaryConfig.requireConfirmation !== false) {
        if (trigger !== "auto" || isPiDebugEnabled()) notify(ctx, "Pre-compact summarization requires memory.sessionEndSummary.requireConfirmation to be false because PreCompact hooks cannot ask for confirmation.", "warning")
        return undefined
      }

      if (compactionWouldDiscardSplitTurnEvidence(event)) {
        deferPreCompact(ctx, typeof event?.turnId === "string" ? event.turnId : undefined, trigger)
        return undefined
      }

      clearDeferredPreCompact(ctx)
      const messages = sessionMessagesFromPiCompactionEvent(event)
      if (!messages.length) return undefined

      const e = getEngine(ctx.cwd)
      const provider = createOpenAICompatibleProvider({
        provider: "openai-compatible",
        baseUrl: summaryConfig.baseUrl,
        apiKeyEnv: summaryConfig.apiKeyEnv,
        model: summaryConfig.model,
        timeoutMs: summaryConfig.timeoutMs,
      }, memoryEnv())
      const candidates = await handlePreCompact(e, {
        cwd: ctx.cwd,
        sessionId: piSessionId(ctx),
        turnId: event?.turnId,
        trigger,
        messages,
      }, {
        provider,
        promptTemplate: summaryConfig.promptTemplate ?? undefined,
        maxTokens: summaryConfig.maxTokens,
        requireConfirmation: false,
        confirmed: true,
        includeToolOutputs: summaryConfig.includeToolOutputs,
        adapter: "pi",
        trigger,
      }, memoryEnv())
      const saved = saveSessionSummaryCandidates(e, candidates)
      if (saved.length) {
        notify(ctx, `Memory Lane suggested ${saved.length} pending pre-compact summar${saved.length === 1 ? "y" : "ies"} for review. Run /memory review to inspect.`, "info")
      }
      return undefined
    } catch (err) {
      if (isPiDebugEnabled()) notify(ctx, err instanceof Error ? `Pre-compact summary failed: ${err.message}` : "Pre-compact summary failed", "warning")
      return undefined
    }
  })

  pi.on("session_compact", async (event, ctx) => {
    if (isOmpTaskSession(ctx)) return undefined
    const key = sessionDeferralKey(ctx)
    const deferred = deferredPreCompact.get(key)
    if (!deferred) return undefined
    deferredPreCompact.delete(key)
    const summary = compactionSummary(event)
    if (!summary) return undefined

    try {
      const config = loadConfig(process.env.PI_MEMORY_CONFIG_FILE ?? process.env.MEMORY_LANE_CONFIG)
      if (!preCompactSummaryEnabled(config)) return undefined
      const summaryConfig = config.memory?.sessionEndSummary
      if (!summaryConfig?.baseUrl || !summaryConfig.model || summaryConfig.requireConfirmation !== false) return undefined
      const e = getEngine(ctx.cwd)
      const provider = createOpenAICompatibleProvider({
        provider: "openai-compatible",
        baseUrl: summaryConfig.baseUrl,
        apiKeyEnv: summaryConfig.apiKeyEnv,
        model: summaryConfig.model,
        timeoutMs: summaryConfig.timeoutMs,
      }, memoryEnv())
      const candidates = await handlePreCompact(e, {
        cwd: ctx.cwd,
        sessionId: piSessionId(ctx),
        turnId: deferred.turnId,
        trigger: deferred.trigger,
        messages: [{ role: "assistant", content: summary }],
      }, {
        provider,
        promptTemplate: summaryConfig.promptTemplate ?? undefined,
        maxTokens: summaryConfig.maxTokens,
        requireConfirmation: false,
        confirmed: true,
        includeToolOutputs: false,
        adapter: "pi",
        trigger: deferred.trigger,
      }, memoryEnv())
      const saved = saveSessionSummaryCandidates(e, candidates)
      if (saved.length) notify(ctx, `Memory Lane suggested ${saved.length} pending pre-compact summar${saved.length === 1 ? "y" : "ies"} for review. Run /memory review to inspect.`, "info")
      return undefined
    } catch (err) {
      if (isPiDebugEnabled()) notify(ctx, err instanceof Error ? `Deferred pre-compact summary failed: ${err.message}` : "Deferred pre-compact summary failed", "warning")
      return undefined
    }
  })

  pi.on("session_switch", async (_event, ctx) => {
    clearDeferredPreCompact(ctx)
    return undefined
  })

  pi.on("session_shutdown", async (_event, _ctx) => {
    clearDeferredPreCompact()
    return undefined
  })

  // ── Input event handler (auto-save / suggest on user input) ──

  pi.on("input", async (event, ctx) => {
    if (isOmpTaskSession(ctx)) return { action: "continue" }
    // Skip extension-generated events to avoid loops
    if (event.source === "extension") return { action: "continue" }

    const text = typeof event.text === "string" ? event.text.trim() : ""
    if (!text) return { action: "continue" }
    if (!parseExplicitMemoryRequest(text)) return { action: "continue" }

    try {
      const e = getEngine(ctx.cwd)
      const result = handleStop(e, {
        cwd: ctx.cwd,
        sessionId: piSessionId(ctx),
        turnId: event.turnId ?? piSessionId(ctx),
        lastUserMessage: text,
      }, { adapter: "pi" })

      await runLifecycleWrite("input", ctx, event.turnId ?? piSessionId(ctx), result)
    } catch (err) {
      notify(ctx, storageGuidance(err), "warning")
    }

    return { action: "continue" }
  })

  // ── Turn end handler ───────────────────────────────────────

  pi.on("turn_end", async (event, ctx) => {
    if (isOmpTaskSession(ctx)) return undefined
    const normalized = normalizedTurnEnd(event, ctx)
    const turnId = normalized.turnId ?? piSessionId(ctx)

    try {
      const e = getEngine(ctx.cwd)
      const result = handleStop(e, {
        cwd: ctx.cwd,
        sessionId: piSessionId(ctx),
        turnId,
        lastUserMessage: normalized.lastUserMessage,
        lastAssistantMessage: normalized.lastAssistantMessage,
      }, { adapter: "pi" })

      await runLifecycleWrite("turn_end", ctx, turnId, result)
    } catch (err) {
      notify(ctx, storageGuidance(err), "warning")
    }
  })

  // ── Tool result handler ────────────────────────────────────

  pi.on("tool_result", async (event, ctx) => {
    if (isOmpTaskSession(ctx)) return undefined
    const normalized = normalizedToolResult(event)
    const turnId = normalized.turnId ?? piSessionId(ctx)

    try {
      const e = getEngine(ctx.cwd)
      const result = handlePostToolUse(e, {
        cwd: ctx.cwd,
        sessionId: piSessionId(ctx),
        turnId,
        toolName: normalized.toolName ?? "unknown",
        toolInput: normalized.toolInput,
        toolResponse: normalized.toolResponse,
      } as PostToolUseInput, { adapter: "pi" })

      await runLifecycleWrite("tool_result", ctx, turnId, result)
    } catch (err) {
      notify(ctx, storageGuidance(err), "warning")
    }
  })
}

// Re-export for consumers
export { MemoryEngine } from "@memory-lane/core"
