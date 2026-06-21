import type {
  MemoryKind,
  MemoryRecord,
  OperatingAgreementList,
  OperatingAgreementMetadata,
  OperatingAgreementOptions,
  OperatingAgreementSelection,
  OperatingAgreementSummary,
  WorkflowArea,
} from "./types.js"

export const WORKFLOW_AREAS: readonly WorkflowArea[] = [
  "project-loop",
  "review-gate",
  "pr-process",
  "release-process",
  "tooling-preference",
  "other",
]

const DEFAULT_LIMIT = 5
const DEFAULT_RELATED_LIMIT = 10
const AGREEMENT_COMPATIBLE_KINDS = new Set<MemoryKind>(["preference", "project_fact", "correction", "procedure"])

const AREA_PATTERNS: Array<{ area: WorkflowArea; pattern: RegExp }> = [
  { area: "project-loop", pattern: /\b(project loop|workflow loop|collaboration workflow|loop-engineering|review-gated loop|plan\/spec|roadmap)\b/iu },
  { area: "review-gate", pattern: /\b(review gate|code review|spec review|quality review|approval gate|approved? before|review\/?approve)\b/iu },
  { area: "pr-process", pattern: /\b(pr|pull request|feature branch|branch|merge|merged|worktree cleanup|delete local|delete remote)\b/iu },
  { area: "release-process", pattern: /\b(release|tag|version|publish|published|npm publish|github releases?)\b/iu },
  { area: "tooling-preference", pattern: /\b(package manager|installer|installation|onboarding|harness setup|setup wizard|pnpm|npm|bun|command preference|use sfw)\b/iu },
  { area: "project-loop", pattern: /\b(working preference|operating agreement|workflow)\b/iu },
]

const OPERATING_AGREEMENT_PATTERN = /\b(workflow|loop|operating agreement|working preference|review gate|code review|spec review|quality review|approval gate|pr|pull request|branch|merge|worktree|release|tag|version|publish|package manager|installer|onboarding|harness setup|setup wizard|pnpm|use sfw|process)\b/iu

export function isWorkflowArea(value: string): value is WorkflowArea {
  return WORKFLOW_AREAS.includes(value as WorkflowArea)
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! >= 0 ? value! : fallback
}

function visibleApproved(memory: MemoryRecord, projectScopeKey: string | undefined, all: boolean): boolean {
  if (memory.status !== "approved") return false
  if (all) return true
  if (memory.scope.type === "global") return true
  return Boolean(projectScopeKey) && memory.scope.key === projectScopeKey
}

function matchReason(memory: MemoryRecord): "explicit-kind" | "heuristic" | undefined {
  if (memory.kind === "workflow_rule") return "explicit-kind"
  if (!memory.kind || !AGREEMENT_COMPATIBLE_KINDS.has(memory.kind)) return undefined
  return OPERATING_AGREEMENT_PATTERN.test(memory.text) ? "heuristic" : undefined
}

function classifyWorkflowArea(text: string): WorkflowArea {
  for (const { area, pattern } of AREA_PATTERNS) {
    if (pattern.test(text)) return area
  }
  return "other"
}

function metadata(selection: OperatingAgreementSelection): OperatingAgreementMetadata {
  return {
    id: selection.memory.id,
    category: selection.memory.category,
    scope: selection.memory.scope,
    source: selection.memory.source,
    createdAt: selection.memory.createdAt,
    updatedAt: selection.memory.updatedAt,
    kind: selection.memory.kind,
    provenance: selection.memory.provenance,
    workflowArea: selection.workflowArea,
    matchReason: selection.matchReason,
    recommendedKind: selection.recommendedKind,
  }
}

function matchRank(selection: OperatingAgreementSelection): number {
  return selection.matchReason === "explicit-kind" ? 0 : 1
}

function scopeRank(selection: OperatingAgreementSelection): number {
  return selection.memory.scope.type === "project" ? 0 : 1
}

function compareSelections(a: OperatingAgreementSelection, b: OperatingAgreementSelection): number {
  return matchRank(a) - matchRank(b)
    || scopeRank(a) - scopeRank(b)
    || b.memory.updatedAt.localeCompare(a.memory.updatedAt)
    || a.memory.id.localeCompare(b.memory.id)
}

function notes(projectScopeKey: string | undefined, all: boolean, relatedTotal: number): string[] {
  const values: string[] = []
  if (!projectScopeKey && !all) {
    values.push("No project scope is active; operating agreement selection is limited to global memories. Pass --project <path> for project-aware agreements.")
  }
  if (relatedTotal > 0) {
    values.push("Related candidates are informational only; no memory mutation is performed.")
  }
  return values
}

export function selectOperatingAgreements(memories: MemoryRecord[], options: OperatingAgreementOptions = {}): OperatingAgreementList {
  const limit = positiveInteger(options.limit, DEFAULT_LIMIT)
  const relatedLimit = positiveInteger(options.relatedLimit, DEFAULT_RELATED_LIMIT)
  const all = options.all ?? false

  const candidates = memories
    .filter((memory) => visibleApproved(memory, options.projectScopeKey, all))
    .map((memory): OperatingAgreementSelection | undefined => {
      const reason = matchReason(memory)
      if (!reason) return undefined
      const workflowArea = classifyWorkflowArea(memory.text)
      if (options.area && workflowArea !== options.area) return undefined
      return {
        memory,
        workflowArea,
        matchReason: reason,
        recommendedKind: reason === "heuristic" ? "workflow_rule" : undefined,
      }
    })
    .filter((selection): selection is OperatingAgreementSelection => Boolean(selection))
    .sort(compareSelections)

  const selectedAreas = new Set<WorkflowArea>()
  const primaryCandidates: OperatingAgreementSelection[] = []
  const relatedCandidates: OperatingAgreementSelection[] = []

  for (const candidate of candidates) {
    if (!selectedAreas.has(candidate.workflowArea) && primaryCandidates.length < limit) {
      primaryCandidates.push(candidate)
      selectedAreas.add(candidate.workflowArea)
    } else {
      relatedCandidates.push(candidate)
    }
  }

  const primary = primaryCandidates.slice(0, limit)
  const related = relatedCandidates.slice(0, relatedLimit)

  return {
    projectScope: options.projectScopeKey ?? "none",
    workflowAreas: [...new Set(primary.map((selection) => selection.workflowArea))],
    primary,
    relatedCandidates: related,
    omittedPrimaryCount: Math.max(0, primaryCandidates.length - primary.length),
    omittedRelatedCandidateCount: Math.max(0, relatedCandidates.length - related.length),
    notes: notes(options.projectScopeKey, all, relatedCandidates.length),
  }
}

export function summarizeOperatingAgreements(list: OperatingAgreementList): OperatingAgreementSummary {
  return {
    projectScope: list.projectScope,
    primaryCount: list.primary.length,
    relatedCandidateCount: list.relatedCandidates.length,
    omittedPrimaryCount: list.omittedPrimaryCount,
    omittedRelatedCandidateCount: list.omittedRelatedCandidateCount,
    workflowAreas: list.workflowAreas,
    primary: list.primary.map(metadata),
    relatedCandidates: list.relatedCandidates.map(metadata),
    notes: list.notes,
  }
}
