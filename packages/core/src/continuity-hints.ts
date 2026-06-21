import { buildFreshnessStatus } from "./freshness.js"
import { selectOperatingAgreements } from "./operating-agreements.js"
import type {
  ContinuityHint,
  ContinuityHintMemoryMetadata,
  ContinuityHintOptions,
  ContinuityHintSummary,
  MemoryKind,
  MemoryRecord,
  OperatingAgreementSelection,
  ScopeHygieneCandidateMetadata,
  ScopeHygieneReason,
  WorkflowArea,
} from "./types.js"

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function visibleApproved(memory: MemoryRecord, projectScopeKey?: string): boolean {
  if (memory.status !== "approved") return false
  if (memory.scope.type === "global") return true
  return Boolean(projectScopeKey) && memory.scope.key === projectScopeKey
}

function memoryMetadata(memory: MemoryRecord): ContinuityHintMemoryMetadata {
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
    supersededBy: memory.revision?.supersededBy,
  }
}

function action(values: string[]): string[] {
  return unique(values)
}

function selectionsByArea(selections: OperatingAgreementSelection[]): Map<WorkflowArea, OperatingAgreementSelection[]> {
  const map = new Map<WorkflowArea, OperatingAgreementSelection[]>()
  for (const selection of selections) {
    const existing = map.get(selection.workflowArea) ?? []
    existing.push(selection)
    map.set(selection.workflowArea, existing)
  }
  return map
}

function ids(selections: OperatingAgreementSelection[]): string[] {
  return selections.map((selection) => selection.memory.id)
}

const PROJECT_SPECIFIC_KINDS = new Set<MemoryKind>(["project_fact", "project_checkpoint", "session_summary"])

const PROJECT_PATH_PATTERNS = [
  /(?:^|\s)(?:~|\/Users\/[^\s]+)\/projects\/[^\s]+/iu,
  /(?:^|\s)packages\/[\w.-]+\/src\//iu,
  /(?:^|\s)docs\/superpowers\//iu,
] as const

function scopeHygieneReason(memory: MemoryRecord): ScopeHygieneReason | undefined {
  if (memory.status !== "approved" || memory.scope.type !== "global") return undefined
  if (memory.category === "project") return "project-category-global-scope"
  if (memory.kind && PROJECT_SPECIFIC_KINDS.has(memory.kind)) return "project-kind-global-scope"
  if (PROJECT_PATH_PATTERNS.some((pattern) => pattern.test(memory.text))) return "project-path-global-scope"
  return undefined
}

function scopeHygieneMetadata(memory: MemoryRecord, reason: ScopeHygieneReason): ScopeHygieneCandidateMetadata {
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
    reason,
  }
}

export function buildContinuityHints(memories: MemoryRecord[], options: ContinuityHintOptions = {}): ContinuityHintSummary {
  const maxIds = options.maxIds ?? 5
  const projectScope = options.projectScopeKey ?? "none"
  const visible = memories.filter((memory) => visibleApproved(memory, options.projectScopeKey))
  const hints: ContinuityHint[] = []

  const allScopeHygieneCandidates = memories
    .map((memory): ScopeHygieneCandidateMetadata | undefined => {
      const reason = scopeHygieneReason(memory)
      return reason ? scopeHygieneMetadata(memory, reason) : undefined
    })
    .filter((candidate): candidate is ScopeHygieneCandidateMetadata => Boolean(candidate))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const scopeHygieneCandidates = allScopeHygieneCandidates.slice(0, maxIds)

  const supersededVisible = [...visible]
    .filter((memory) => Boolean(memory.revision?.supersededBy))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, maxIds)
    .map(memoryMetadata)

  if (supersededVisible.length) {
    hints.push({
      code: "superseded-visible",
      severity: "review",
      message: `${supersededVisible.length} approved ${supersededVisible.length === 1 ? "memory is" : "memories are"} marked superseded and still visible as historical records.`,
      count: supersededVisible.length,
      memoryIds: supersededVisible.map((memory) => memory.id),
      suggestedActions: ["memory-lane list --json"],
    })
  }

  if (allScopeHygieneCandidates.length) {
    hints.push({
      code: "scope-hygiene-candidate",
      severity: "review",
      message: "Some global memories look project-specific and may need manual scope review.",
      count: allScopeHygieneCandidates.length,
      memoryIds: scopeHygieneCandidates.map((memory) => memory.id),
      suggestedActions: ["memory-lane list --json"],
    })
  }

  const agreements = selectOperatingAgreements(memories, { projectScopeKey: options.projectScopeKey })
  const operatingAgreementOverlaps = [...selectionsByArea(agreements.relatedCandidates).entries()]
    .map(([workflowArea, related]) => {
      const primary = agreements.primary.filter((item) => item.workflowArea === workflowArea)
      return {
        workflowArea,
        primaryIds: ids(primary),
        relatedIds: ids(related),
      }
    })
    .filter((overlap) => overlap.primaryIds.length > 0)

  for (const overlap of operatingAgreementOverlaps) {
    hints.push({
      code: "operating-agreement-overlap",
      severity: "review",
      message: `Multiple operating agreement candidates found for ${overlap.workflowArea}.`,
      count: overlap.primaryIds.length + overlap.relatedIds.length,
      memoryIds: [...overlap.primaryIds, ...overlap.relatedIds].slice(0, maxIds),
      workflowArea: overlap.workflowArea,
      suggestedActions: [`memory-lane agreements --area ${overlap.workflowArea}`],
    })
  }

  const allAgreementCandidates = [...agreements.primary, ...agreements.relatedCandidates]
  const projectGlobalPreferenceOverlaps = [...selectionsByArea(allAgreementCandidates).entries()]
    .map(([workflowArea, selections]) => {
      const projectIds = selections
        .filter((selection) => selection.memory.scope.type === "project")
        .map((selection) => selection.memory.id)
      const globalIds = selections
        .filter((selection) => selection.memory.scope.type === "global" && selection.memory.category === "preference")
        .map((selection) => selection.memory.id)
      return { workflowArea, projectIds, globalIds }
    })
    .filter((overlap) => overlap.projectIds.length > 0 && overlap.globalIds.length > 0)

  for (const overlap of projectGlobalPreferenceOverlaps) {
    hints.push({
      code: "project-global-overlap",
      severity: "info",
      message: `Project and global preference guidance both exist for ${overlap.workflowArea}.`,
      count: overlap.projectIds.length + overlap.globalIds.length,
      memoryIds: [...overlap.projectIds, ...overlap.globalIds].slice(0, maxIds),
      workflowArea: overlap.workflowArea,
      suggestedActions: ["memory-lane agreements --all"],
    })
  }

  const freshness = buildFreshnessStatus(memories, {
    projectScopeKey: options.projectScopeKey,
    since: options.since,
    maxNewerMetadata: maxIds,
  })
  const advisoryCount = freshness.advisory.expiredCount + freshness.advisory.staleCount
  if (advisoryCount) {
    hints.push({
      code: "freshness-advisory",
      severity: "review",
      message: `${advisoryCount} approved ${advisoryCount === 1 ? "memory has" : "memories have"} expired or stale freshness metadata; inspect before relying on time-sensitive guidance.`,
      count: advisoryCount,
      memoryIds: [...freshness.advisory.expired, ...freshness.advisory.stale].map((memory) => memory.id).slice(0, maxIds),
      suggestedActions: ["memory-lane status --json"],
    })
  }
  const freshnessReferenceTime = freshness?.referenceTime
  const newerApproved = freshness.newerApprovedCount > 0 && freshnessReferenceTime
    ? {
      referenceTime: freshnessReferenceTime,
      count: freshness.newerApprovedCount,
      newestIds: freshness.newestNewerApproved.map((memory) => memory.id),
    }
    : undefined

  if (newerApproved) {
    hints.push({
      code: "newer-approved",
      severity: "info",
      message: `${newerApproved.count} approved ${newerApproved.count === 1 ? "memory has" : "memories have"} changed since ${newerApproved.referenceTime}.`,
      count: newerApproved.count,
      memoryIds: newerApproved.newestIds,
      suggestedActions: [`memory-lane status --json --since ${newerApproved.referenceTime}`],
    })
  }

  const suggestedActions = action(hints.flatMap((hint) => hint.suggestedActions))
  const notes = hints.length
    ? ["Continuity hints are read-only inspection signals; no memory cleanup or mutation is performed."]
    : []

  return {
    projectScope,
    hintCount: hints.length,
    hints,
    supersededVisible,
    scopeHygieneCandidates,
    operatingAgreementOverlaps,
    projectGlobalPreferenceOverlaps,
    newerApproved,
    suggestedActions,
    notes,
  }
}
