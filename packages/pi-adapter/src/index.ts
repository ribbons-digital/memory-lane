import { Type } from "typebox"
import { handlePostToolUse, handleStop, handleUserPromptSubmit } from "@memory-lane/lifecycle"
import type { PostToolUseInput, SessionMessage } from "@memory-lane/lifecycle"
import {
  MemoryEngine, inferMemoryKind, initProjectLocalStorage, loadConfig, resolveWritableMemoryPaths, type SaveResult,
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
    getBranch?(): Array<{
      type: string
      message?: {
        role?: string
        content?: unknown
      }
    }>
  }
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
  const paths = resolveWritableMemoryPaths({ cwd, env: memoryEnv(), autoInitProjectLocalOnHomeFailure: true })
  const key = `${paths.memoryPath}\n${paths.embeddingsPath}\n${paths.configPath}`
  if (!engine || engineKey !== key) {
    engine = new MemoryEngine({
      memoryPath: paths.memoryPath,
      embeddingsPath: paths.embeddingsPath,
      configPath: paths.configPath,
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

function memoryLaneContextMessage(content: string) {
  return {
    customType: "memory-lane",
    content,
    display: false,
    details: {
      source: "memory-lane",
      lifecycleEvent: "user_prompt_submit",
    },
  }
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

// ── Main extension ───────────────────────────────────────────

export default function memoryLaneExtension(pi: ExtensionAPI) {
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

    notify(ctx, "Session summary generation is not available until the save path is enabled in the next implementation slice.", "warning")
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
        if (cmd === "list") {
        const allScope = parts.includes("--all")
        const mems = e.list({ all: allScope })
        notify(ctx, mems.length ? mems.map(formatMemory).join("\n") : "No memories.")
      } else if (cmd === "search") {
        const mems = e.search(rest)
        notify(ctx, mems.length ? mems.map(formatMemory).join("\n") : "No matches.")
      } else if (cmd === "delete") {
        const mem = e.delete(rest)
        notify(ctx, mem ? `Deleted memory ${rest}` : `Memory not found: ${rest}`, mem ? "info" : "warning")
      } else if (cmd === "use") {
        const result = await e.recall(rest)
        if (!result.memories.length) notify(ctx, "No matching memories.", "info")
        else notify(ctx, `Recalled ${result.memories.length} memories.\n` + result.memories.map(formatMemory).join("\n"))
      } else if (cmd === "review") {
        const pending = e.reviewPending()
        notify(ctx, pending.length ? pending.map(formatMemory).join("\n") : "No pending memories.")
      } else if (cmd === "compact") {
        const report = e.compact()
        notify(ctx, `Compact: removed ${report.removedMemories} memories, ${report.removedEmbeddings} embeddings`)
      } else if (cmd === "status" || cmd === "doctor") {
        const d = e.doctor()
        notify(ctx, Object.entries(d).map(([k, v]) => `${k}: ${v}`).join("\n"))
        } else {
          notify(ctx, "Usage: /memory list [--all] | search <q> | delete <id> | use [q] | review | compact | status | session-summary | init-project-local")
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
    const prompt = typeof event.prompt === "string" ? event.prompt.trim() : ""
    if (!prompt) return undefined

    try {
      const e = getEngine(ctx.cwd)
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

  // ── Input event handler (auto-save / suggest on user input) ──

  pi.on("input", async (event, ctx) => {
    // Skip extension-generated events to avoid loops
    if (event.source === "extension") return { action: "continue" }

    const text = typeof event.text === "string" ? event.text.trim() : ""
    if (!text) return { action: "continue" }

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
    const turnId = event.turnId ?? piSessionId(ctx)

    try {
      const e = getEngine(ctx.cwd)
      const result = handleStop(e, {
        cwd: ctx.cwd,
        sessionId: piSessionId(ctx),
        turnId,
        lastUserMessage: event.lastUserMessage,
        lastAssistantMessage: event.lastAssistantMessage,
      }, { adapter: "pi" })

      await runLifecycleWrite("turn_end", ctx, turnId, result)
    } catch (err) {
      notify(ctx, storageGuidance(err), "warning")
    }
  })

  // ── Tool result handler ────────────────────────────────────

  pi.on("tool_result", async (event, ctx) => {
    const turnId = event.turnId ?? piSessionId(ctx)

    try {
      const e = getEngine(ctx.cwd)
      const result = handlePostToolUse(e, {
        cwd: ctx.cwd,
        sessionId: piSessionId(ctx),
        turnId,
        toolName: event.toolName,
        toolInput: event.toolInput,
        toolResponse: event.toolResponse,
      } as PostToolUseInput, { adapter: "pi" })

      await runLifecycleWrite("tool_result", ctx, turnId, result)
    } catch (err) {
      notify(ctx, storageGuidance(err), "warning")
    }
  })
}

// Re-export for consumers
export { MemoryEngine } from "@memory-lane/core"
