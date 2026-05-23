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

function resolveCategory(input: SaveInput, text: string): MemoryCategory {
  return input.category ?? inferCategory(text)
}

function resolveScopeType(input: SaveInput, category: MemoryCategory): MemoryScopeType {
  return input.scopeType ?? (category === "project" ? "project" : "global")
}

function resolveKind(input: SaveInput, text: string, category: MemoryCategory): MemoryKind {
  return input.kind ?? inferMemoryKind(text, category)
}

export function saveContext(input: SaveInput, text: string, projectScope: ProjectScope | null): SaveContext {
  const category = resolveCategory(input, text)
  const scopeType = resolveScopeType(input, category)
  return {
    text,
    category,
    scopeType,
    kind: resolveKind(input, text, category),
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

function memoryScopeKey(memory: MemoryRecord): string | undefined {
  return memory.scope.key ?? memory.project?.key ?? memory.project?.root
}

export function visibleInScope(memory: MemoryRecord, scopeKey: string): boolean {
  return memory.scope.type === "global" || memoryScopeKey(memory) === scopeKey
}

export function timestamp(now?: string | Date): string {
  if (now instanceof Date) return now.toISOString()
  if (typeof now === "string") return now
  return new Date().toISOString()
}
