import * as path from "node:path"
import * as os from "node:os"
import { Type } from "typebox"
import {
  MemoryEngine, parseExplicitMemoryRequest, detectUserMemorySuggestion,
  isCheckpointMemorySaveRequest, inferCategory, inferMemoryKind,
  normalizeMemoryText, type SaveResult,
} from "@memory-lane/core"

// ── pi ExtensionAPI / ExtensionContext interfaces (shim) ──────
// These are the interfaces we expect from the pi harness. The adapter
// is designed to be used with pi's extension system via dynamic import.

export interface ExtensionContext {
  cwd: string
  ui?: { notify(message: string, level?: "info" | "warning" | "error"): void }
  llmProvider?: { generate(prompt: string, options?: any): Promise<string> }
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

function getEngine(cwd: string): MemoryEngine {
  if (!engine) {
    engine = new MemoryEngine({
      memoryPath: process.env.PI_MEMORY_FILE ?? path.join(os.homedir(), ".memory-lane", "memory.jsonl"),
      embeddingsPath: process.env.PI_MEMORY_EMBEDDINGS_FILE ?? path.join(os.homedir(), ".memory-lane", "embeddings.jsonl"),
      configPath: process.env.PI_MEMORY_CONFIG_FILE ?? path.join(os.homedir(), ".pi", "agent", "memory.config.json"),
    })
  }
  engine.refreshScope(cwd)
  return engine
}

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
  ctx?.ui?.notify?.(message, level)
}

function formatMemory(m: { id: string; scope: { type: string }; category: string; text: string; status?: string }): string {
  const statusTag = m.status && m.status !== "approved" ? ` [${m.status}]` : ""
  return `[${m.id}] (${m.scope.type}/${m.category})${statusTag} ${m.text}`
}

function formatSaveResult(r: SaveResult): string {
  if (r.status === "saved") return `Saved memory ${formatMemory(r.memory)}`
  return `Memory not saved: ${r.reason}`
}

// ── LLM intent classifier (fallback if LLM provider unavailable) ──

interface IntentResult {
  intent: "save" | "recall" | "none"
  text?: string
  category?: string
  confidence?: number
}

async function classifyIntent(text: string, ctx: ExtensionContext): Promise<IntentResult> {
  // Try regex detection first
  const explicit = parseExplicitMemoryRequest(text)
  if (explicit) return { intent: "save", text: explicit }

  const suggestion = detectUserMemorySuggestion(text)
  if (suggestion) return { intent: "save", text: suggestion.text, category: suggestion.category }

  const checkpoint = isCheckpointMemorySaveRequest(text)
  if (checkpoint) return { intent: "save", text: normalizeMemoryText(text) }

  // LLM fallback
  if (!ctx.llmProvider) return { intent: "none" }

  try {
    const prompt = `Analyze this user message. Determine if the user wants to:
- Save a memory ("save")
- Recall a memory ("recall") 
- Neither ("none")

Message: "${text}"

Reply ONLY with JSON: {"intent": "save|recall|none", "text": "extracted memory text if save", "confidence": 0-1}`
    const response = await ctx.llmProvider.generate(prompt, { maxTokens: 100 })
    const result = JSON.parse(response)
    if (result.intent === "save" || result.intent === "recall") return result
    return { intent: "none" }
  } catch {
    return { intent: "none" }
  }
}

// ── Main extension ───────────────────────────────────────────

export default function memoryLaneExtension(pi: ExtensionAPI) {
  // ── Commands ─────────────────────────────────────────────

  pi.registerCommand("remember", {
    description: "Save an approved persistent memory",
    handler: async (args, ctx) => {
      const e = getEngine(ctx.cwd)
      const text = args?.trim() ?? ""
      if (!text) { notify(ctx, "Text required", "warning"); return }
      const result = e.save({ text, status: "approved", source: "manual" })
      notify(ctx, formatSaveResult(result))
    },
  })

  pi.registerCommand("memory", {
    description: "List, search, delete, or recall persistent memories",
    handler: async (args, ctx) => {
      const e = getEngine(ctx.cwd)
      const trimmed = (args ?? "").trim()
      const parts = trimmed.split(/\s+/)
      const cmd = parts[0]
      const rest = parts.slice(1).join(" ")

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
        notify(ctx, "Usage: /memory list [--all] | search <q> | delete <id> | use [q] | review | compact | status")
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
      const e = getEngine(ctx.cwd)
      const result = await e.recall(params.query ?? "")
      const text = result.memories.length === 0
        ? "No matching approved memories."
        : `Recalled ${result.memories.length} memories.\n` + result.memories.map(formatMemory).join("\n")
      return {
        content: [{ type: "text", text }],
        details: { ids: result.memories.map((m) => m.id) },
      }
    },
  })

  // ── Input event handler (auto-save / suggest on user input) ──

  pi.on("input", async (event, ctx) => {
    // Skip extension-generated events to avoid loops
    if (event.source === "extension") return { action: "continue" }

    const text = typeof event.text === "string" ? event.text.trim() : ""
    if (!text) return { action: "continue" }

    const intent = await classifyIntent(text, ctx)

    if (intent.intent === "save" && intent.text) {
      const e = getEngine(ctx.cwd)
      const category = (intent.category as any) ?? inferCategory(intent.text)
      const kind = inferMemoryKind(intent.text, category)
      const result = e.save({ text: intent.text, category, status: "approved", kind })
      if (result.status === "saved") {
        notify(ctx, `Auto-saved memory: ${formatMemory(result.memory)}`, "info")
      }
    }

    return { action: "continue" }
  })
}

// Re-export for consumers
export { MemoryEngine } from "@memory-lane/core"
