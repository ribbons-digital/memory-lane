import type { MemoryEngine, MemoryRecord, RecallResult, SaveResult } from "@memory-lane/core"
import type {
  ListToolInput, RecallToolInput, ReviewToolInput, SaveToolInput, SuggestToolInput, ToolEnvelope,
} from "./types.js"

type ToolResult<T> = {
  content: Array<{ type: "text"; text: string }>
  structuredContent: ToolEnvelope<T>
}

function envelope<T>(engine: MemoryEngine, data: T, count?: number): ToolEnvelope<T> {
  const meta: { count?: number; projectScope?: string | "none" } = { projectScope: currentProjectScope(engine) }
  if (count !== undefined) meta.count = count
  return { ok: true, data, meta }
}

function errorEnvelope(error: unknown): ToolEnvelope<never> {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: message }
}

export function jsonContent<T>(payload: ToolEnvelope<T>): ToolResult<T> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

export function currentProjectScope(engine: MemoryEngine): string | "none" {
  return engine.getProjectScope()?.key ?? "none"
}

export function applyProjectPath(engine: MemoryEngine, projectPath?: string): void {
  if (projectPath) engine.refreshScope(projectPath)
}

function saveData(result: SaveResult): { status: "saved"; memory: MemoryRecord; warnings?: string[] } | { status: "skipped"; reason: string; warnings?: string[] } {
  const warnings = result.warnings ? { warnings: result.warnings } : {}
  if (result.status === "saved") return { status: "saved", memory: result.memory, ...warnings }
  return { status: "skipped", reason: result.reason, ...warnings }
}

export async function handleMemorySave(engine: MemoryEngine, input: SaveToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const result = engine.save({
      text: input.text,
      category: input.category,
      scopeType: input.scope,
      kind: input.kind,
      status: "approved",
      source: "manual",
    })
    return jsonContent(envelope(engine, saveData(result)))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemorySuggest(engine: MemoryEngine, input: SuggestToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const result = engine.suggest(input.text, input.category, input.scope, input.kind, input.status)
    return jsonContent(envelope(engine, saveData(result)))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemoryRecall(engine: MemoryEngine, input: RecallToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const result: RecallResult = await engine.recall(input.query ?? "")
    return jsonContent(envelope(engine, result, result.memories.length))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemoryList(engine: MemoryEngine, input: ListToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const memories = engine.list({ status: input.status, all: input.all ?? false })
    return jsonContent(envelope(engine, { memories }, memories.length))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemoryReview(engine: MemoryEngine, input: ReviewToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const memories = engine.reviewPending()
    return jsonContent(envelope(engine, { memories }, memories.length))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}
