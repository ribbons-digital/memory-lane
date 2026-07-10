import { classifyCheckpointCandidate, groupReviewMemories, withReviewHygiene, type CheckpointCandidateMetadata, type MemoryEngine, type MemoryMutationResult, type MemoryRecord, type MemoryRecordWithReviewHygiene, type RecallResult, type SaveResult } from "@memory-lane/core"
import type {
  ContinuityToolInput, ListToolInput, MemoryGetToolInput, MemoryIdToolInput, RecallToolInput, ReviewFilters, ReviewToolInput, SaveToolInput, StatusToolInput, SuggestToolInput, ToolEnvelope,
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

function inputFreshness(input: { expiresAt?: string; staleAfterDays?: number; capturedAt?: string }) {
  const freshness = {
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    ...(input.staleAfterDays !== undefined ? { staleAfterDays: input.staleAfterDays } : {}),
    ...(input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
  }
  return Object.keys(freshness).length ? freshness : undefined
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
  "Preference diagnostics in memory_status are counts/metadata only; use memory_list or memory_recall when you need preference text.",
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
      freshness: inputFreshness(input),
    })
    return jsonContent(envelope(engine, saveData(result)))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemorySuggest(engine: MemoryEngine, input: SuggestToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const result = engine.suggest(input.text, input.category, input.scope, input.kind, input.status, inputFreshness(input))
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

export async function handleMemoryContinuity(engine: MemoryEngine, input: ContinuityToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    return jsonContent(envelope(engine, {
      continuity: engine.continuity({ caller: "mcp", query: input.query }),
      notes: [
        "Use memory_continuity for last-worked-on, accomplished, next-action, resume, and project-status questions.",
        "MCP provides explicit tools only; it does not run lifecycle hooks or automatic context injection.",
        ...scopeNotes(engine),
      ],
    }))
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

export async function handleMemoryGet(engine: MemoryEngine, input: MemoryGetToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const memory = engine.getById(input.id, { all: input.all ?? false })
    if (!memory) {
      return jsonContent(envelope(engine, {
        status: "not_found" as const,
        id: input.id,
        hint: input.all ? undefined : "Use all: true to search across projects and deleted/rejected memories.",
      }))
    }
    return jsonContent(envelope(engine, { memory }, 1))
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

type ReviewMemoryOutput = MemoryRecordWithReviewHygiene & { checkpointCandidate?: CheckpointCandidateMetadata }

function withCheckpointCandidate(memory: MemoryRecord): ReviewMemoryOutput {
  const withHygiene = withReviewHygiene(memory)
  const checkpointCandidate = classifyCheckpointCandidate(memory)
  return checkpointCandidate ? { ...withHygiene, checkpointCandidate } : withHygiene
}

export async function handleMemoryReview(engine: MemoryEngine, input: ReviewToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const filters = activeReviewFilters(input)
    const memories = filterReviewMemories(engine.reviewPending({ all: input.all ?? false }), filters)
    return jsonContent(envelope(engine, { memories: memories.map(withCheckpointCandidate), groups: groupReviewMemories(memories), notes: scopeNotes(engine) }, memories.length, filters))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemoryApprove(engine: MemoryEngine, input: MemoryIdToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    return jsonContent(envelope(engine, mutationData(input.id, engine.approve(input.id, { all: input.all ?? false }))))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemoryReject(engine: MemoryEngine, input: MemoryIdToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    return jsonContent(envelope(engine, mutationData(input.id, engine.reject(input.id, { all: input.all ?? false }))))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemoryDelete(engine: MemoryEngine, input: MemoryIdToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    return jsonContent(envelope(engine, mutationData(input.id, engine.delete(input.id, { all: input.all ?? false }))))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}
