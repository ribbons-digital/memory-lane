import type { MemoryRecord, MemoryStatus, MemoryCategory, MemoryScopeType, MemorySource } from "./types.js"

const VALID_STATUSES = new Set<MemoryStatus>(["pending", "approved", "rejected", "deleted"])
const VALID_CATEGORIES = new Set<MemoryCategory>(["preference", "personal", "project"])
const VALID_SCOPE_TYPES = new Set<MemoryScopeType>(["global", "project"])
const VALID_SOURCES = new Set<MemorySource>(["manual", "user-suggested", "agent-suggested"])

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

export function isMemoryRecord(value: unknown): value is MemoryRecord {
  return isPlainObject(value)
    && hasValidRequiredFields(value)
    && hasValidScope(value)
    && hasValidProject(value)
}
