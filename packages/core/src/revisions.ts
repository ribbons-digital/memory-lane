import type {
  MemoryRecord, MemoryRevision, MemoryRevisionActor, RevisionWarning, UpdateInput,
} from "./types.js"

export function revisionNow(reason?: string, revisedBy: MemoryRevisionActor = "manual"): MemoryRevision {
  return {
    ...(reason ? { reason: reason.trim() } : {}),
    revisedAt: new Date().toISOString(),
    revisedBy,
  }
}

export function sameIdRevision(input: Pick<UpdateInput, "reason" | "revisedBy">): MemoryRevision | undefined {
  const reason = input.reason?.trim()
  if (!reason && !input.revisedBy) return undefined
  return revisionNow(reason, input.revisedBy ?? "manual")
}

export function revisionLabel(memory: MemoryRecord): string | undefined {
  const revision = memory.revision
  if (!revision) return undefined
  const parts: string[] = []
  if (revision.supersedes?.length) parts.push(`supersedes: ${revision.supersedes.join(", ")}`)
  if (revision.supersededBy) parts.push(`superseded by: ${revision.supersededBy}`)
  return parts.length ? `[${parts.join("; ")}]` : undefined
}

export function hasRealUpdateChange(
  current: MemoryRecord,
  proposed: Pick<MemoryRecord, "text" | "category" | "status"> & { kind?: MemoryRecord["kind"] },
): boolean {
  return current.text !== proposed.text
    || current.category !== proposed.category
    || current.status !== proposed.status
    || (current.kind ?? "misc") !== (proposed.kind ?? "misc")
}

export function revisionForSuccessor(
  oldIds: string[],
  reason?: string,
  revisedBy: MemoryRevisionActor = "manual",
): MemoryRevision {
  return { ...revisionNow(reason, revisedBy), supersedes: oldIds }
}

export function revisionForSuperseded(
  newId: string,
  reason?: string,
  revisedBy: MemoryRevisionActor = "manual",
): MemoryRevision {
  return { ...revisionNow(reason, revisedBy), supersededBy: newId }
}

export function revisionWarnings(successor: MemoryRecord, oldRecords: MemoryRecord[]): RevisionWarning[] {
  const warnings: RevisionWarning[] = []
  for (const old of oldRecords) {
    if (successor.scope.type !== old.scope.type || successor.scope.key !== old.scope.key) {
      warnings.push({
        code: "cross-scope",
        memoryId: old.id,
        message: `Successor ${successor.id} and old memory ${old.id} have different scopes.`,
      })
    }
    if (successor.category !== old.category) {
      warnings.push({
        code: "cross-category",
        memoryId: old.id,
        message: `Successor ${successor.id} and old memory ${old.id} have different categories.`,
      })
    }
  }
  return warnings
}
