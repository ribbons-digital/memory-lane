import { buildFreshnessStatus } from "./freshness.js"
import { selectOperatingAgreements } from "./operating-agreements.js"
import type {
  ContinuityHint,
  ContinuityHintMemoryMetadata,
  ContinuityHintOptions,
  ContinuityHintSummary,
  MemoryRecord,
  OperatingAgreementSelection,
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

export function buildContinuityHints(memories: MemoryRecord[], options: ContinuityHintOptions = {}): ContinuityHintSummary {
  const maxIds = options.maxIds ?? 5
  const projectScope = options.projectScopeKey ?? "none"
  const visible = memories.filter((memory) => visibleApproved(memory, options.projectScopeKey))
  const hints: ContinuityHint[] = []

  const supersededVisible = [...visible]
    .filter((memory) => Boolean(memory.revision?.supersededBy))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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

  const freshness = options.since
    ? buildFreshnessStatus(memories, {
      projectScopeKey: options.projectScopeKey,
      since: options.since,
      maxNewerMetadata: maxIds,
    })
    : undefined
  const newerApproved = freshness && freshness.newerApprovedCount > 0
    ? {
      referenceTime: freshness.referenceTime!,
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
    operatingAgreementOverlaps,
    projectGlobalPreferenceOverlaps,
    newerApproved,
    suggestedActions,
    notes,
  }
}
