import type { MemoryEngine } from "@memory-lane/core"
import type {
  ListToolInput, RecallToolInput, ReviewToolInput, SaveToolInput, SuggestToolInput, ToolEnvelope,
} from "./types.js"

function notImplemented(): never {
  throw new Error("MCP handlers not implemented")
}

export function jsonContent<T>(payload: ToolEnvelope<T>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

export function currentProjectScope(engine: MemoryEngine): string | "none" {
  return engine.getProjectScope()?.key ?? "none"
}

export function applyProjectPath(engine: MemoryEngine, projectPath?: string): void {
  if (projectPath) engine.refreshScope(projectPath)
}

export async function handleMemorySave(_engine: MemoryEngine, _input: SaveToolInput) {
  return jsonContent(notImplemented())
}

export async function handleMemorySuggest(_engine: MemoryEngine, _input: SuggestToolInput) {
  return jsonContent(notImplemented())
}

export async function handleMemoryRecall(_engine: MemoryEngine, _input: RecallToolInput) {
  return jsonContent(notImplemented())
}

export async function handleMemoryList(_engine: MemoryEngine, _input: ListToolInput) {
  return jsonContent(notImplemented())
}

export async function handleMemoryReview(_engine: MemoryEngine, _input: ReviewToolInput) {
  return jsonContent(notImplemented())
}
