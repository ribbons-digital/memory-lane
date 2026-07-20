import type { MemoryRecord } from "@memory-lane/core"

export type GroupedReviewMutationAction = "approve" | "reject"

export interface GroupedReviewMutationResult {
  status: "applied" | "partial"
  action: GroupedReviewMutationAction
  memoryIds: string[]
  appliedMemoryIds: string[]
  remainingMemoryIds: string[]
  uncertainMemoryIds?: string[]
  failedMemoryId?: string
  error?: string
}

export interface GroupedReviewMutationOptions {
  action: GroupedReviewMutationAction
  expected: MemoryRecord[]
  resolve: (id: string) => MemoryRecord | undefined
  mutate: (id: string) => unknown
}

function candidateFingerprint(memory: MemoryRecord): string {
  return JSON.stringify({
    id: memory.id,
    status: memory.status,
    text: memory.text,
    category: memory.category,
    scope: memory.scope,
    source: memory.source,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    project: memory.project,
    kind: memory.kind,
    provenance: memory.provenance,
    revision: memory.revision,
    freshness: memory.freshness,
    descriptor: memory.descriptor,
  })
}

/** Preflight the complete expected set before any mutation, then report recoverable partial writes. */
export function applyGroupedReviewMutation(options: GroupedReviewMutationOptions): GroupedReviewMutationResult {
  const memoryIds = options.expected.map((memory) => memory.id)
  const changedIds: string[] = []
  for (const expected of options.expected) {
    const current = options.resolve(expected.id)
    if (!current || current.status !== "pending" || candidateFingerprint(current) !== candidateFingerprint(expected)) changedIds.push(expected.id)
  }
  if (changedIds.length) {
    throw new Error(`Grouped review mutation preflight failed before any writes; changed or non-pending IDs: ${changedIds.join(",")}`)
  }

  const appliedMemoryIds: string[] = []
  for (const [index, id] of memoryIds.entries()) {
    try {
      const mutated = options.mutate(id)
      if (!mutated) throw new Error(`Memory was unavailable during ${options.action}`)
      appliedMemoryIds.push(id)
    } catch (error) {
      return {
        status: "partial",
        action: options.action,
        memoryIds,
        appliedMemoryIds,
        remainingMemoryIds: memoryIds.slice(index + 1),
        uncertainMemoryIds: [id],
        failedMemoryId: id,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return {
    status: "applied",
    action: options.action,
    memoryIds,
    appliedMemoryIds,
    remainingMemoryIds: [],
  }
}
