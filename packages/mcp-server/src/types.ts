import type { MemoryCategory, MemoryKind, MemoryScopeType, MemoryStatus } from "@memory-lane/core"

export type ToolEnvelope<T> =
  | { ok: true; data: T; meta?: { count?: number; projectScope?: string | "none" } }
  | { ok: false; error: string }

export interface ProjectPathInput {
  projectPath?: string
}

export interface SaveToolInput extends ProjectPathInput {
  text: string
  category?: MemoryCategory
  scope?: MemoryScopeType
  kind?: MemoryKind
}

export interface SuggestToolInput extends SaveToolInput {
  status?: Extract<MemoryStatus, "pending" | "approved">
}

export interface RecallToolInput extends ProjectPathInput {
  query?: string
}

export interface ListToolInput extends ProjectPathInput {
  status?: MemoryStatus
  all?: boolean
}

export type ReviewToolInput = ProjectPathInput
