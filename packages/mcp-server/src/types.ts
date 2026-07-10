import type { MemoryCategory, MemoryKind, MemoryScopeType, MemoryStatus } from "@memory-lane/core"

export interface ReviewFilters {
  kind?: MemoryKind
  source?: string
  provenance?: string
}

export type ToolEnvelope<T> =
  | { ok: true; data: T; meta?: { count?: number; projectScope?: string | "none"; filters?: ReviewFilters } }
  | { ok: false; error: string }

export interface ProjectPathInput {
  projectPath?: string
}

export interface SaveToolInput extends ProjectPathInput {
  text: string
  category?: MemoryCategory
  scope?: MemoryScopeType
  kind?: MemoryKind
  expiresAt?: string
  staleAfterDays?: number
  capturedAt?: string
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

export interface ReviewToolInput extends ProjectPathInput, ReviewFilters {
  all?: boolean
}

export interface StatusToolInput extends ProjectPathInput {
  since?: string
}

export interface ContinuityToolInput extends ProjectPathInput {
  query?: string
}

export interface MemoryIdToolInput extends ProjectPathInput {
  id: string
  all?: boolean
}

export interface MemoryGetToolInput extends MemoryIdToolInput {
  all?: boolean
}
