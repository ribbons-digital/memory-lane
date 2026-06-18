import { groupReviewMemories, type MemoryEngine, type MemoryMutationResult, type MemoryRecord, type RecallResult, type SaveResult } from "@memory-lane/core"
import type {
  ListToolInput, MemoryIdToolInput, RecallToolInput, ReviewFilters, ReviewToolInput, SaveToolInput, StatusToolInput, SuggestToolInput, ToolEnvelope,
} from "./types.js"

type ToolResult<T> = {
  content: Array<{ type: "text"; text: string }>
  structuredContent: ToolEnvelope<T>
}

function envelope<T>(engine: MemoryEngine, data: T, count?: number, filters?: ReviewFilters): ToolEnvelope<T> {
  const meta: { count?: number; projectScope?: string | "none"; filters?: ReviewFilters } = { projectScope: currentProjectScope(engine) }
  if (count !== undefined) meta.count = count
  if (filters && Object.keys(filters).length) meta.filters = filters
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

function mutationData(id: string, result: MemoryMutationResult | undefined): { status: "updated"; memory: MemoryRecord; warnings?: string[] } | { status: "not_found"; id: string } {
  if (!result) return { status: "not_found", id }
  const { warnings, ...memory } = result
  return warnings ? { status: "updated", memory, warnings } : { status: "updated", memory }
}

const STATUS_NOTES = [
  "MCP provides explicit Memory Lane tools only; it does not run lifecycle hooks.",
  "Use memory-lane doctor in a terminal for the same read-only diagnostics outside MCP.",
]

function scopeNotes(engine: MemoryEngine): string[] {
  if (currentProjectScope(engine) !== "none") return []
  return ["No projectPath was provided and no project scope is active; pass projectPath to scope project-specific recall/list/review/status in MCP clients such as Claude Desktop."]
}

function statusData(engine: MemoryEngine, since?: string): { status: Record<string, unknown>; notes: string[] } {
  return { status: engine.doctor({ freshnessSince: since }), notes: [...STATUS_NOTES, ...scopeNotes(engine)] }
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

export async function handleMemoryStatus(engine: MemoryEngine, input: StatusToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    return jsonContent(envelope(engine, statusData(engine, input.since)))
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

function activeReviewFilters(input: ReviewToolInput): ReviewFilters {
  return Object.fromEntries(
    Object.entries({ kind: input.kind, source: input.source, provenance: input.provenance })
      .filter(([, value]) => Boolean(value)),
  ) as ReviewFilters
}

function reviewProvenanceLabel(memory: MemoryRecord): string {
  return memory.provenance ? `${memory.provenance.adapter}/${memory.provenance.lifecycleEvent}` : "none"
}

function filterReviewMemories(memories: MemoryRecord[], filters: ReviewFilters): MemoryRecord[] {
  return memories.filter((memory) => {
    if (filters.kind && (memory.kind ?? "misc") !== filters.kind) return false
    if (filters.source && memory.source !== filters.source) return false
    if (filters.provenance && reviewProvenanceLabel(memory) !== filters.provenance) return false
    return true
  })
}

export async function handleMemoryReview(engine: MemoryEngine, input: ReviewToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const filters = activeReviewFilters(input)
    const memories = filterReviewMemories(engine.reviewPending(), filters)
    return jsonContent(envelope(engine, { memories, groups: groupReviewMemories(memories), notes: scopeNotes(engine) }, memories.length, filters))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemoryApprove(engine: MemoryEngine, input: MemoryIdToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    return jsonContent(envelope(engine, mutationData(input.id, engine.approve(input.id))))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemoryReject(engine: MemoryEngine, input: MemoryIdToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    return jsonContent(envelope(engine, mutationData(input.id, engine.reject(input.id))))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemoryDelete(engine: MemoryEngine, input: MemoryIdToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    return jsonContent(envelope(engine, mutationData(input.id, engine.delete(input.id))))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}
