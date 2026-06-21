import type {
  MemoryRecord, MemoryStatus, MemoryCategory, MemoryScopeType, MemorySource,
  MemoryLifecycleEvent, MemoryKind, MemoryRevisionActor, SaveInput,
} from "./types.js"

export const VALID_STATUSES = new Set<MemoryStatus>(["pending", "approved", "rejected", "deleted"])
export const VALID_CATEGORIES = new Set<MemoryCategory>(["preference", "personal", "project"])
export const VALID_SCOPE_TYPES = new Set<MemoryScopeType>(["global", "project"])
export const VALID_SOURCES = new Set<MemorySource>(["manual", "user-suggested", "agent-suggested", "session-summary"])
export const VALID_KINDS = new Set<MemoryKind>([
  "preference",
  "personal_context",
  "project_fact",
  "project_checkpoint",
  "workflow_rule",
  "decision",
  "correction",
  "procedure",
  "session_summary",
  "misc",
])
export const VALID_LIFECYCLE_EVENTS = new Set<MemoryLifecycleEvent>([
  "user_prompt",
  "turn_stop",
  "post_tool_use",
  "session_start",
  "session_end",
  "pre_compact",
])
export const VALID_REVISION_ACTORS = new Set<MemoryRevisionActor>(["manual", "cli", "mcp"])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string"
}

function isEnumValue<T extends string>(value: unknown, allowed: Set<T>): value is T {
  return typeof value === "string" && allowed.has(value as T)
}

function hasValidRequiredFields(value: Record<string, unknown>): boolean {
  const required = [value.id, value.text, value.createdAt, value.updatedAt]
  return required.every(isNonEmptyString)
    && isEnumValue(value.status, VALID_STATUSES)
    && isEnumValue(value.category, VALID_CATEGORIES)
    && isEnumValue(value.source, VALID_SOURCES)
}

function hasValidScope(value: Record<string, unknown>): boolean {
  const scope = value.scope
  return isPlainObject(scope)
    && isEnumValue(scope.type, VALID_SCOPE_TYPES)
    && isOptionalString(scope.key)
}

function hasValidProject(value: Record<string, unknown>): boolean {
  const project = value.project
  if (project === undefined) return true
  return isPlainObject(project)
    && typeof project.cwd === "string"
    && isOptionalString(project.root)
    && isOptionalString(project.key)
}

function hasValidKind(value: Record<string, unknown>): boolean {
  return value.kind === undefined || isEnumValue(value.kind, VALID_KINDS)
}

function hasValidProvenance(value: Record<string, unknown>): boolean {
  const provenance = value.provenance
  if (provenance === undefined) return true
  return isPlainObject(provenance)
    && isNonEmptyString(provenance.adapter)
    && isEnumValue(provenance.lifecycleEvent, VALID_LIFECYCLE_EVENTS)
    && isOptionalString(provenance.sessionId)
    && isOptionalString(provenance.turnId)
    && isOptionalString(provenance.toolName)
}

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function hasValidRevision(value: Record<string, unknown>): boolean {
  const revision = value.revision
  if (revision === undefined) return true
  if (!isPlainObject(revision)) return false
  const supersedes = revision.supersedes
  return (supersedes === undefined || (Array.isArray(supersedes) && supersedes.every(isNonEmptyString)))
    && isOptionalString(revision.supersededBy)
    && isOptionalString(revision.reason)
    && isValidIsoTimestamp(revision.revisedAt)
    && isEnumValue(revision.revisedBy, VALID_REVISION_ACTORS)
}

function allowedValues<T extends string>(allowed: Set<T>): string {
  return [...allowed].join(", ")
}

function displayValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value)
}

function validateOptionalEnum<T extends string>(field: string, value: unknown, allowed: Set<T>): void {
  if (value === undefined) return
  if (!isEnumValue(value, allowed)) {
    throw new Error(`Invalid ${field}: ${displayValue(value)}. Expected one of: ${allowedValues(allowed)}`)
  }
}

export function validateSaveInput(input: SaveInput): void {
  validateOptionalEnum("category", input.category, VALID_CATEGORIES)
  validateOptionalEnum("scopeType", input.scopeType, VALID_SCOPE_TYPES)
  validateOptionalEnum("status", input.status, VALID_STATUSES)
  validateOptionalEnum("source", input.source, VALID_SOURCES)
  validateOptionalEnum("kind", input.kind, VALID_KINDS)
  if (input.provenance !== undefined && !hasValidProvenance({ provenance: input.provenance })) {
    throw new Error("Invalid provenance. Expected adapter, lifecycleEvent, and optional string sessionId/turnId/toolName")
  }
  if (input.revision !== undefined && !hasValidRevision({ revision: input.revision })) {
    throw new Error("Invalid revision. Expected optional supersedes/supersededBy/reason, ISO revisedAt, and revisedBy manual|cli|mcp")
  }
}

function normalizeScope(value: Record<string, unknown>): MemoryRecord["scope"] | undefined {
  if (value.scope !== undefined) return hasValidScope(value) ? value.scope as MemoryRecord["scope"] : undefined
  const project = value.project
  if (isPlainObject(project) && typeof project.key === "string" && project.key.length > 0) {
    return { type: "project", key: project.key }
  }
  return { type: "global" }
}

function normalizeSource(value: Record<string, unknown>): MemorySource | undefined {
  if (value.source === undefined) return "manual"
  return isEnumValue(value.source, VALID_SOURCES) ? value.source : undefined
}

export function normalizeMemoryRecord(value: unknown): MemoryRecord | undefined {
  if (!isPlainObject(value)) return undefined
  if (!hasValidRequiredFields({ ...value, source: normalizeSource(value) })) return undefined
  const source = normalizeSource(value)
  const scope = normalizeScope(value)
  if (source === undefined || scope === undefined) return undefined
  if (!hasValidProject(value) || !hasValidKind(value) || !hasValidProvenance(value) || !hasValidRevision(value)) return undefined
  return { ...value, source, scope } as MemoryRecord
}

export function isMemoryRecord(value: unknown): value is MemoryRecord {
  return normalizeMemoryRecord(value) !== undefined
}
