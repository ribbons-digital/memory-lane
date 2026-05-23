import * as crypto from "node:crypto"
import {
  inferCategory, inferMemoryKind,
} from "./search.js"
import type {
  MemoryRecord, MemoryCategory, MemoryScopeType, MemoryKind, SaveInput,
  ProjectScope, EmbeddingProvider,
} from "./types.js"
import type { loadConfig } from "./config.js"
import { createMemoryId } from "./storage.js"

export type SemanticConfig = ReturnType<typeof loadConfig>["semantic"]
export type SaveContext = {
  text: string
  category: MemoryCategory
  scopeType: MemoryScopeType
  kind: MemoryKind
  scope: MemoryRecord["scope"]
}

export function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex")
}

function projectSnapshot(scope: ProjectScope | null): MemoryRecord["project"] {
  return scope ? { cwd: scope.cwd, root: scope.root, key: scope.key } : undefined
}

function memoryScope(scopeType: MemoryScopeType, projectScope: ProjectScope | null): MemoryRecord["scope"] {
  return scopeType === "project" ? { type: scopeType, key: projectScope?.key } : { type: scopeType }
}

export function saveContext(input: SaveInput, text: string, projectScope: ProjectScope | null): SaveContext {
  const category = input.category ?? inferCategory(text)
  const scopeType = input.scopeType ?? (category === "project" ? "project" : "global")
  return {
    text,
    category,
    scopeType,
    kind: input.kind ?? inferMemoryKind(text, category),
    scope: memoryScope(scopeType, projectScope),
  }
}

export function createNewMemory(input: SaveInput, ctx: SaveContext, scope: ProjectScope | null): MemoryRecord {
  const now = timestamp()
  return {
    id: createMemoryId(),
    status: input.status ?? "pending",
    text: ctx.text,
    category: ctx.category,
    scope: ctx.scope,
    source: input.source ?? "manual",
    createdAt: now,
    updatedAt: now,
    project: projectSnapshot(scope),
    kind: ctx.kind,
  }
}

export function shouldAutoEmbed(memory: MemoryRecord, semantic: SemanticConfig, provider?: EmbeddingProvider): boolean {
  return memory.status === "approved" && Boolean(provider) && semantic.enabled
}

export function visibleInScope(memory: MemoryRecord, scopeKey: string): boolean {
  if (memory.scope.type === "global") return true
  const memoryScopeKey = memory.scope.key ?? memory.project?.key ?? memory.project?.root
  return memoryScopeKey === scopeKey
}

export function timestamp(now?: string | Date): string {
  if (now instanceof Date) return now.toISOString()
  if (typeof now === "string") return now
  return new Date().toISOString()
}
