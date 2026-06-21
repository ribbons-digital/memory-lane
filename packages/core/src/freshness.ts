import type { FreshnessClassification, FreshnessMemoryMetadata, FreshnessStatus, FreshnessStatusOptions, MemoryRecord } from "./types.js"

function isValidIsoTimestamp(value: string): boolean {
  const ms = Date.parse(value)
  return Number.isFinite(ms) && new Date(ms).toISOString() === value
}

function assertValidIsoOption(name: string, value?: string): void {
  if (value !== undefined && !isValidIsoTimestamp(value)) {
    throw new Error(`Invalid ${name} timestamp: ${value}. Expected an ISO timestamp such as 2026-06-18T00:00:00.000Z`)
  }
}

function visibleApproved(memory: MemoryRecord, projectScopeKey?: string): boolean {
  if (memory.status !== "approved") return false
  if (memory.scope.type === "global") return true
  return Boolean(projectScopeKey) && memory.scope.key === projectScopeKey
}

function classifyFreshness(memory: MemoryRecord, referenceNow: string): FreshnessClassification {
  if (!memory.freshness || (!memory.freshness.expiresAt && !memory.freshness.staleAfterDays && !memory.freshness.capturedAt)) {
    return "none"
  }
  if (memory.freshness.expiresAt && memory.freshness.expiresAt <= referenceNow) return "expired"
  if (memory.freshness.staleAfterDays !== undefined) {
    const staleAnchor = memory.freshness.capturedAt ?? memory.updatedAt
    const staleAt = new Date(Date.parse(staleAnchor) + memory.freshness.staleAfterDays * 24 * 60 * 60 * 1000).toISOString()
    if (staleAt <= referenceNow) return "stale"
  }
  return "current"
}

function metadata(memory: MemoryRecord, referenceNow?: string): FreshnessMemoryMetadata {
  const classification = referenceNow ? classifyFreshness(memory, referenceNow) : "none"
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
    ...(referenceNow && classification !== "none"
      ? {
        freshness: {
          classification,
          expiresAt: memory.freshness?.expiresAt,
          staleAfterDays: memory.freshness?.staleAfterDays,
          capturedAt: memory.freshness?.capturedAt,
          staleAnchor: memory.freshness?.staleAfterDays !== undefined ? memory.freshness?.capturedAt ?? memory.updatedAt : undefined,
        },
      }
      : {}),
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
  assertValidIsoOption("since", options.since)
  assertValidIsoOption("referenceNow", options.referenceNow)

  const maxNewerMetadata = options.maxNewerMetadata ?? 5
  const referenceNow = options.referenceNow ?? new Date().toISOString()
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
  const visibleWithClassifications = visible.map((memory) => ({ memory, classification: classifyFreshness(memory, referenceNow) }))
  const withFreshness = visibleWithClassifications.filter((item) => item.classification !== "none")
  const stale = visibleWithClassifications
    .filter((item) => item.classification === "stale")
    .sort((a, b) => b.memory.updatedAt.localeCompare(a.memory.updatedAt))
  const expired = visibleWithClassifications
    .filter((item) => item.classification === "expired")
    .sort((a, b) => b.memory.updatedAt.localeCompare(a.memory.updatedAt))

  return {
    projectScope: options.projectScopeKey ?? "none",
    referenceTime: options.since,
    advisory: {
      referenceNow,
      withFreshnessCount: withFreshness.length,
      currentCount: withFreshness.filter((item) => item.classification === "current").length,
      staleCount: stale.length,
      expiredCount: expired.length,
      stale: stale.slice(0, maxNewerMetadata).map((item) => metadata(item.memory, referenceNow)),
      expired: expired.slice(0, maxNewerMetadata).map((item) => metadata(item.memory, referenceNow)),
    },
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
    newestNewerApproved: newerSorted.slice(0, maxNewerMetadata).map((memory) => metadata(memory, referenceNow)),
    notice: options.since && newer.length > 0
      ? `${newer.length} approved Memory Lane ${newer.length === 1 ? "memory has" : "memories have"} changed since ${options.since}. Use memory-lane list/recall for details if relevant.`
      : undefined,
  }
}
