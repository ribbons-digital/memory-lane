import type { FreshnessMemoryMetadata, FreshnessStatus, FreshnessStatusOptions, MemoryRecord } from "./types.js"

function isValidIsoTimestamp(value: string): boolean {
  const ms = Date.parse(value)
  return Number.isFinite(ms) && new Date(ms).toISOString() === value
}

function assertValidSince(since?: string): void {
  if (since !== undefined && !isValidIsoTimestamp(since)) {
    throw new Error(`Invalid since timestamp: ${since}. Expected an ISO timestamp such as 2026-06-18T00:00:00.000Z`)
  }
}

function visibleApproved(memory: MemoryRecord, projectScopeKey?: string): boolean {
  if (memory.status !== "approved") return false
  if (memory.scope.type === "global") return true
  return Boolean(projectScopeKey) && memory.scope.key === projectScopeKey
}

function metadata(memory: MemoryRecord): FreshnessMemoryMetadata {
  return {
    id: memory.id,
    status: "approved",
    category: memory.category,
    scope: memory.scope,
    source: memory.source,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    kind: memory.kind,
    provenance: memory.provenance,
  }
}

function provenanceKey(memory: MemoryRecord): string {
  return memory.provenance ? `${memory.provenance.adapter}/${memory.provenance.lifecycleEvent}` : "none"
}

function increment(counts: Record<string, number>, key: string | undefined): void {
  const countKey = key ?? "misc"
  counts[countKey] = (counts[countKey] ?? 0) + 1
}

function latest(memories: MemoryRecord[]): FreshnessMemoryMetadata | undefined {
  const [first] = [...memories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return first ? metadata(first) : undefined
}

export function buildFreshnessStatus(memories: MemoryRecord[], options: FreshnessStatusOptions = {}): FreshnessStatus {
  assertValidSince(options.since)

  const maxNewerMetadata = options.maxNewerMetadata ?? 5
  const visible = memories.filter((memory) => visibleApproved(memory, options.projectScopeKey))
  const newer = options.since ? visible.filter((memory) => memory.updatedAt > options.since!) : []
  const newerSorted = [...newer].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const newerByKind: Record<string, number> = {}
  const newerBySource: Record<string, number> = {}
  const newerByProvenance: Record<string, number> = {}
  for (const memory of newer) {
    increment(newerByKind, memory.kind)
    increment(newerBySource, memory.source)
    increment(newerByProvenance, provenanceKey(memory))
  }

  const newerProjectApprovedCount = newer.filter((memory) => memory.scope.type === "project").length
  const newerGlobalApprovedCount = newer.filter((memory) => memory.scope.type === "global").length
  const newerGlobalPreferenceCount = newer.filter((memory) => memory.scope.type === "global" && memory.category === "preference").length

  return {
    projectScope: options.projectScopeKey ?? "none",
    referenceTime: options.since,
    visibleApprovedCount: visible.length,
    latestApproved: latest(visible),
    latestProjectApproved: latest(visible.filter((memory) => memory.scope.type === "project")),
    latestGlobalApproved: latest(visible.filter((memory) => memory.scope.type === "global")),
    newerApprovedCount: newer.length,
    newerProjectApprovedCount,
    newerGlobalApprovedCount,
    newerGlobalPreferenceCount,
    newerByKind,
    newerBySource,
    newerByProvenance,
    newestNewerApproved: newerSorted.slice(0, maxNewerMetadata).map(metadata),
    notice: options.since && newer.length > 0
      ? `${newer.length} approved Memory Lane ${newer.length === 1 ? "memory has" : "memories have"} changed since ${options.since}. Use memory-lane list/recall for details if relevant.`
      : undefined,
  }
}
