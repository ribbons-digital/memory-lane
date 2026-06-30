import { containsLikelySecret } from "./secret-detection.js"
import type {
  MemoryRecord, MemoryStatus, MemoryCategory, MemoryScopeType, MemorySource,
  MemoryLifecycleEvent, MemoryKind, MemoryRevisionActor, MemoryFreshness, SaveInput,
  MemoryDescriptorMetadata,
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

const DESCRIPTOR_TEXT_MAX_CHARS = 240
const DESCRIPTOR_KEYWORD_MAX_CHARS = 40
const DESCRIPTOR_KEYWORD_MAX_ITEMS = 12

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

function hasAnyFreshnessField(freshness: MemoryFreshness): boolean {
  return freshness.expiresAt !== undefined
    || freshness.staleAfterDays !== undefined
    || freshness.capturedAt !== undefined
}

function hasValidFreshness(value: Record<string, unknown>): boolean {
  const freshness = value.freshness
  if (freshness === undefined) return true
  if (!isPlainObject(freshness)) return false
  const candidate = freshness as MemoryFreshness
  return hasAnyFreshnessField(candidate)
    && (candidate.expiresAt === undefined || isValidIsoTimestamp(candidate.expiresAt))
    && (candidate.capturedAt === undefined || isValidIsoTimestamp(candidate.capturedAt))
    && (candidate.staleAfterDays === undefined || (Number.isInteger(candidate.staleAfterDays) && candidate.staleAfterDays >= 1))
}

function assertDescriptorText(field: "description" | "fetchHint", value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`Invalid descriptor.${field}. Expected a string`)
  const normalized = value.trim()
  if (!normalized) throw new Error(`Invalid descriptor.${field}. Expected a non-empty string`)
  if (normalized.length > DESCRIPTOR_TEXT_MAX_CHARS) throw new Error(`Invalid descriptor.${field}. Expected at most ${DESCRIPTOR_TEXT_MAX_CHARS} characters`)
  if (containsLikelySecret(normalized)) throw new Error(`Invalid descriptor.${field}. Value contains a likely secret`)
  return normalized
}

function normalizeDescriptorKeywords(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error("Invalid descriptor.keywords. Expected an array of strings")
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const item of value) {
    if (typeof item !== "string") throw new Error("Invalid descriptor.keywords. Expected an array of strings")
    const trimmedKeyword = item.trim()
    if (!trimmedKeyword) throw new Error("Invalid descriptor.keywords. Expected non-empty strings")
    if (trimmedKeyword.length > DESCRIPTOR_KEYWORD_MAX_CHARS) throw new Error(`Invalid descriptor.keywords. Expected each keyword to be at most ${DESCRIPTOR_KEYWORD_MAX_CHARS} characters`)
    if (containsLikelySecret(trimmedKeyword)) throw new Error("Invalid descriptor.keywords. Value contains a likely secret")
    const keyword = trimmedKeyword.toLowerCase()
    if (!seen.has(keyword)) {
      seen.add(keyword)
      keywords.push(keyword)
    }
  }
  if (keywords.length > DESCRIPTOR_KEYWORD_MAX_ITEMS) throw new Error(`Invalid descriptor.keywords. Expected at most ${DESCRIPTOR_KEYWORD_MAX_ITEMS} items`)
  return keywords.length ? keywords : undefined
}

export function normalizeMemoryDescriptor(value: unknown): MemoryDescriptorMetadata | undefined {
  if (value === undefined) return undefined
  if (!isPlainObject(value)) throw new Error("Invalid descriptor. Expected an object")
  const description = assertDescriptorText("description", value.description)
  const fetchHint = assertDescriptorText("fetchHint", value.fetchHint)
  const keywords = normalizeDescriptorKeywords(value.keywords)
  const descriptor: MemoryDescriptorMetadata = {
    ...(description ? { description } : {}),
    ...(fetchHint ? { fetchHint } : {}),
    ...(keywords ? { keywords } : {}),
  }
  return Object.keys(descriptor).length ? descriptor : undefined
}

function hasValidDescriptor(value: Record<string, unknown>): boolean {
  try {
    normalizeMemoryDescriptor(value.descriptor)
    return true
  } catch {
    return false
  }
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
  if (input.freshness !== undefined && !hasValidFreshness({ freshness: input.freshness })) {
    if (!isPlainObject(input.freshness)) {
      throw new Error("Invalid freshness. Expected at least one freshness field")
    }
    const freshness = input.freshness as Record<string, unknown>
    if (freshness.expiresAt !== undefined && !isValidIsoTimestamp(freshness.expiresAt)) {
      throw new Error("Invalid freshness.expiresAt. Expected an ISO timestamp")
    }
    if (freshness.capturedAt !== undefined && !isValidIsoTimestamp(freshness.capturedAt)) {
      throw new Error("Invalid freshness.capturedAt. Expected an ISO timestamp")
    }
    if (freshness.staleAfterDays !== undefined && (!Number.isInteger(freshness.staleAfterDays) || (freshness.staleAfterDays as number) < 1)) {
      throw new Error("Invalid freshness.staleAfterDays. Expected a positive integer")
    }
    throw new Error("Invalid freshness. Expected at least one freshness field")
  }
  if (input.descriptor !== undefined) normalizeMemoryDescriptor(input.descriptor)
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
  if (!hasValidProject(value) || !hasValidKind(value) || !hasValidProvenance(value) || !hasValidRevision(value) || !hasValidFreshness(value) || !hasValidDescriptor(value)) return undefined
  const descriptor = normalizeMemoryDescriptor(value.descriptor)
  const record = { ...value, source, scope } as MemoryRecord
  if (descriptor) record.descriptor = descriptor
  else delete record.descriptor
  return record
}

export function isMemoryRecord(value: unknown): value is MemoryRecord {
  return normalizeMemoryRecord(value) !== undefined
}
