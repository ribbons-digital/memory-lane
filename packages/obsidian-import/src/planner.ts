import { parseObsidianMarkdown } from "./frontmatter.js"
import type {
  ExistingImportMemory,
  ImportMemoryCategory,
  ImportMemoryKind,
  ImportMemoryScope,
  ImportMemoryScopeType,
  ObsidianImportPlan,
  ObsidianImportResult,
  ParsedObsidianFrontmatter,
  PlanObsidianImportOptions,
} from "./types.js"

const CATEGORIES = new Set<ImportMemoryCategory>(["preference", "personal", "project"])
const SCOPES = new Set<ImportMemoryScopeType>(["global", "project"])
const IMPORT_STATUSES = new Set(["pending", "approved"])
const ALL_STATUSES = new Set(["pending", "approved", "rejected", "deleted"])
const KINDS = new Set<ImportMemoryKind>([
  "preference",
  "personal_context",
  "project_fact",
  "project_checkpoint",
  "workflow_rule",
  "decision",
  "misc",
])

interface ActiveCandidate {
  index: number
  path: string
  body: string
  fields: ParsedObsidianFrontmatter
}

interface PendingSkip {
  index: number
  path: string
  warnings: string[]
}

function warning(path: string, message: string): string {
  return `${path}: ${message}`
}

function addSkip(skips: Map<number, PendingSkip>, candidate: Pick<ActiveCandidate, "index" | "path">, message: string): void {
  const existing = skips.get(candidate.index)
  const prefixed = warning(candidate.path, message)
  if (existing) {
    existing.warnings.push(prefixed)
    return
  }
  skips.set(candidate.index, { index: candidate.index, path: candidate.path, warnings: [prefixed] })
}

function asOptionalString(fields: ParsedObsidianFrontmatter, key: keyof ParsedObsidianFrontmatter): string | undefined {
  const value = fields[key]
  return typeof value === "string" ? value.trim() : undefined
}

function validateCandidate(candidate: ActiveCandidate): string[] {
  const messages: string[] = []
  const fields = candidate.fields

  if (fields.memory_lane !== undefined && typeof fields.memory_lane !== "boolean") {
    messages.push("invalid memory_lane value")
  }
  if (fields.memory_lane_mirror !== undefined && typeof fields.memory_lane_mirror !== "boolean") {
    messages.push("invalid memory_lane_mirror value")
  }
  if (fields.memory_lane_id !== undefined && typeof fields.memory_lane_id !== "string") {
    messages.push("invalid memory_lane_id value")
  }

  const category = fields.category
  if (category !== undefined && (typeof category !== "string" || !CATEGORIES.has(category.trim() as ImportMemoryCategory))) {
    messages.push("invalid category value")
  }

  const scope = fields.scope
  if (scope !== undefined && (typeof scope !== "string" || !SCOPES.has(scope.trim() as ImportMemoryScopeType))) {
    messages.push("invalid scope value")
  }

  const status = fields.status
  if (status !== undefined) {
    if (typeof status !== "string") {
      messages.push("invalid status value")
    } else if (ALL_STATUSES.has(status.trim()) && !IMPORT_STATUSES.has(status.trim())) {
      messages.push("invalid status for import")
    } else if (!IMPORT_STATUSES.has(status.trim())) {
      messages.push("invalid status value")
    }
  }

  const kind = fields.kind
  if (kind !== undefined && (typeof kind !== "string" || !KINDS.has(kind.trim() as ImportMemoryKind))) {
    messages.push("invalid kind value")
  }

  return messages
}

function normalizeMemoryText(text: string): string {
  return text.trim().replace(/[.!?]+$/u, "").trim()
}

function normalizeForDuplicate(text: string): string {
  return normalizeMemoryText(text).toLowerCase().replace(/\s+/gu, " ").trim()
}

function foldExistingMemories(memories: ExistingImportMemory[]): ExistingImportMemory[] {
  return Array.from(new Map(memories.map((memory) => [memory.id, memory])).values())
}

function existingProjectKey(memory: ExistingImportMemory): string | undefined {
  return memory.scope.key ?? memory.project?.key ?? memory.project?.root
}

function findExistingDuplicate(
  memories: ExistingImportMemory[],
  text: string,
  category: ImportMemoryCategory,
  scope: ImportMemoryScope,
): ExistingImportMemory | undefined {
  const normalizedText = normalizeForDuplicate(text)
  if (!normalizedText) return undefined

  return memories.find((memory) => {
    if (memory.status === "deleted" || memory.status === "rejected") return false
    if (memory.category !== category || memory.scope.type !== scope.type) return false
    if (scope.type === "project") {
      const key = existingProjectKey(memory)
      if (!scope.key || !key || key !== scope.key) return false
    }
    return normalizeForDuplicate(memory.text) === normalizedText
  })
}

function createScope(scopeType: ImportMemoryScopeType, projectScopeKey: string | undefined): ImportMemoryScope {
  return scopeType === "project" ? { type: "project", key: projectScopeKey } : { type: "global" }
}

function pushResult(results: ObsidianImportResult[], result: ObsidianImportResult): void {
  results.push(result)
}

export function planObsidianImport(options: PlanObsidianImportOptions): ObsidianImportPlan {
  const ignoredWarnings = new Set(["missing top-of-file frontmatter"])
  const active: ActiveCandidate[] = []
  const earlySkips = new Map<number, PendingSkip>()
  let ignored = 0

  options.candidates.forEach((candidate, index) => {
    const parsed = parseObsidianMarkdown(candidate.content)
    const parseWarnings = parsed.warnings.filter((message) => !ignoredWarnings.has(message))

    if (!parsed.frontmatter) {
      if (parseWarnings.length === 0) {
        ignored += 1
        return
      }
      earlySkips.set(index, {
        index,
        path: candidate.path,
        warnings: parseWarnings.map((message) => warning(candidate.path, message)),
      })
      return
    }

    if (parsed.frontmatter.memory_lane_mirror === true) {
      earlySkips.set(index, {
        index,
        path: candidate.path,
        warnings: [warning(candidate.path, "generated mirror files cannot be imported")],
      })
      return
    }

    if (parsed.frontmatter.memory_lane === undefined || parsed.frontmatter.memory_lane === false) {
      ignored += 1
      return
    }

    const activeCandidate: ActiveCandidate = {
      index,
      path: candidate.path,
      body: parsed.body,
      fields: parsed.frontmatter,
    }

    const validationMessages = [
      ...parseWarnings,
      ...validateCandidate(activeCandidate),
      ...(parsed.body.length === 0 ? ["missing memory body"] : []),
    ]

    if (validationMessages.length > 0) {
      earlySkips.set(index, {
        index,
        path: candidate.path,
        warnings: validationMessages.map((message) => warning(candidate.path, message)),
      })
      return
    }

    active.push(activeCandidate)
  })

  const conflictSkips = new Map<number, PendingSkip>()
  const targetIds = new Map<string, ActiveCandidate[]>()

  for (const candidate of active) {
    const id = asOptionalString(candidate.fields, "memory_lane_id")
    if (candidate.fields.memory_lane_id !== undefined && !id) {
      addSkip(conflictSkips, candidate, "memory_lane_id is empty")
      continue
    }
    if (!id) continue
    const existing = targetIds.get(id) ?? []
    existing.push(candidate)
    targetIds.set(id, existing)
  }

  for (const duplicates of targetIds.values()) {
    if (duplicates.length <= 1) continue
    for (const candidate of duplicates) {
      addSkip(conflictSkips, candidate, "duplicate memory_lane_id in import run")
    }
  }

  const createTexts = new Map<string, ActiveCandidate[]>()
  for (const candidate of active) {
    if (conflictSkips.has(candidate.index)) continue
    const id = asOptionalString(candidate.fields, "memory_lane_id")
    if (id) continue
    const normalizedText = normalizeForDuplicate(candidate.body)
    const duplicates = createTexts.get(normalizedText) ?? []
    duplicates.push(candidate)
    createTexts.set(normalizedText, duplicates)
  }

  for (const duplicates of createTexts.values()) {
    if (duplicates.length <= 1) continue
    for (const candidate of duplicates) {
      addSkip(conflictSkips, candidate, "duplicate create text in import run")
    }
  }

  const existingMemories = foldExistingMemories(options.existingMemories)
  const existingById = new Map(existingMemories.map((memory) => [memory.id, memory]))
  const results: ObsidianImportResult[] = []

  for (const candidate of active) {
    const pendingSkip = conflictSkips.get(candidate.index)
    if (pendingSkip) {
      pushResult(results, { path: candidate.path, action: "skip", warnings: pendingSkip.warnings })
      continue
    }

    const id = asOptionalString(candidate.fields, "memory_lane_id")
    if (!id) {
      const category = (asOptionalString(candidate.fields, "category") as ImportMemoryCategory | undefined) ?? "personal"
      const scopeType = (asOptionalString(candidate.fields, "scope") as ImportMemoryScopeType | undefined) ?? "global"
      const status = (asOptionalString(candidate.fields, "status") as "pending" | "approved" | undefined) ?? "pending"
      const kind = asOptionalString(candidate.fields, "kind") as ImportMemoryKind | undefined

      if (scopeType === "project" && !options.projectScopeKey) {
        pushResult(results, {
          path: candidate.path,
          action: "skip",
          warnings: [warning(candidate.path, "project-scoped import requires project scope")],
        })
        continue
      }

      const scope = createScope(scopeType, options.projectScopeKey)
      const duplicate = findExistingDuplicate(existingMemories, candidate.body, category, scope)
      if (duplicate) {
        pushResult(results, {
          path: candidate.path,
          action: "skip",
          warnings: [warning(candidate.path, "duplicate existing memory")],
        })
        continue
      }

      pushResult(results, {
        path: candidate.path,
        action: "create",
        text: candidate.body,
        category,
        scope,
        status,
        kind,
        warnings: [],
      })
      continue
    }

    const existing = existingById.get(id)
    if (!existing) {
      pushResult(results, {
        path: candidate.path,
        action: "skip",
        warnings: [warning(candidate.path, "memory_lane_id does not match an existing memory")],
      })
      continue
    }

    if (existing.status === "rejected" || existing.status === "deleted") {
      pushResult(results, {
        path: candidate.path,
        action: "skip",
        warnings: [warning(candidate.path, `memory_lane_id points to ${existing.status} memory`)],
      })
      continue
    }

    const explicitScope = asOptionalString(candidate.fields, "scope") as ImportMemoryScopeType | undefined
    if (explicitScope && explicitScope !== existing.scope.type) {
      pushResult(results, {
        path: candidate.path,
        action: "skip",
        warnings: [warning(candidate.path, "scope changes are not supported for updates")],
      })
      continue
    }

    if (existing.scope.type === "project" && options.projectScopeKey && existingProjectKey(existing) !== options.projectScopeKey) {
      pushResult(results, {
        path: candidate.path,
        action: "skip",
        warnings: [warning(candidate.path, "memory_lane_id project scope does not match current project")],
      })
      continue
    }

    const explicitStatus = asOptionalString(candidate.fields, "status") as "pending" | "approved" | undefined
    if (existing.status === "approved" && explicitStatus === "pending") {
      pushResult(results, {
        path: candidate.path,
        action: "skip",
        warnings: [warning(candidate.path, "approved memories cannot be demoted to pending")],
      })
      continue
    }

    pushResult(results, {
      path: candidate.path,
      action: "update",
      memoryId: id,
      text: candidate.body,
      category: asOptionalString(candidate.fields, "category") as ImportMemoryCategory | undefined,
      status: explicitStatus,
      kind: asOptionalString(candidate.fields, "kind") as ImportMemoryKind | undefined,
      warnings: [],
    })
  }

  const earlySkipResults: ObsidianImportResult[] = Array.from(earlySkips.values())
    .sort((left, right) => left.index - right.index)
    .map((skip) => ({ path: skip.path, action: "skip", warnings: skip.warnings }))

  const allResults = [...earlySkipResults, ...results].sort((left, right) => {
    const leftIndex = options.candidates.findIndex((candidate) => candidate.path === left.path)
    const rightIndex = options.candidates.findIndex((candidate) => candidate.path === right.path)
    return leftIndex - rightIndex
  })

  const summary = {
    wouldCreate: allResults.filter((result) => result.action === "create").length,
    wouldUpdate: allResults.filter((result) => result.action === "update").length,
    skipped: allResults.filter((result) => result.action === "skip").length,
    ignored,
  }

  return {
    summary,
    results: allResults,
    warnings: allResults.flatMap((result) => result.warnings),
  }
}
