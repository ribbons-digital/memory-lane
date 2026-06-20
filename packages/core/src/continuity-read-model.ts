import { classifyCheckpointCandidate } from "./checkpoint-candidates.js"
import { containsLikelySecret } from "./secret-detection.js"
import { buildContinuityHints } from "./continuity-hints.js"
import { buildFreshnessStatus } from "./freshness.js"
import { selectOperatingAgreements, summarizeOperatingAgreements } from "./operating-agreements.js"
import type {
  ContinuityMemoryPreview,
  ContinuityReadModel,
  ContinuityReadModelOptions,
  ContinuityWarning,
  MemoryKind,
  MemoryRecord,
} from "./types.js"

const DEFAULT_PREVIEW_MAX_CHARS = 240
const DEFAULT_MAX_PENDING_CONTINUITY = 5
const CONTINUITY_KINDS = new Set<MemoryKind>(["project_checkpoint", "session_summary", "decision", "project_fact"])
const GLOBAL_WORKFLOW_TEXT_PATTERN = /\b(?:workflow|tool(?:s|ing)?|review|pr|pull request|release|project[- ]loop|harness|mcp|cli|memory-lane)\b/iu
const REQUIRED_CONTINUITY_ACTIONS = [
  "memory-lane continuity --json",
  "memory-lane review --json",
  "memory-lane list --json",
  "memory-lane agreements --json",
  "memory-lane status --json",
]
const REQUIRED_MCP_TOOLS = ["memory_continuity", "memory_review", "memory_list", "memory_status"]
const PROJECT_KIND_PRIORITY = new Map<MemoryKind, number>([
  ["project_checkpoint", 0],
  ["session_summary", 1],
  ["decision", 2],
  ["project_fact", 3],
])

function visibleInProject(memory: MemoryRecord, projectScopeKey?: string): boolean {
  if (memory.scope.type === "global") return true
  return Boolean(projectScopeKey) && memory.scope.key === projectScopeKey
}

function projectScoped(memory: MemoryRecord, projectScopeKey?: string): boolean {
  return Boolean(projectScopeKey) && memory.scope.type === "project" && memory.scope.key === projectScopeKey
}

function compactPreview(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/gu, " ").trim()
  if (normalized.length <= maxChars) return normalized
  if (maxChars <= 1) return "…"
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

function preview(memory: MemoryRecord, maxChars: number): ContinuityMemoryPreview | undefined {
  if (containsLikelySecret(memory.text)) return undefined
  const checkpointCandidate = classifyCheckpointCandidate(memory)
  return {
    id: memory.id,
    status: memory.status as "approved" | "pending",
    category: memory.category,
    scope: memory.scope,
    source: memory.source,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    kind: memory.kind,
    provenance: memory.provenance,
    preview: compactPreview(memory.text, maxChars),
    ...(checkpointCandidate ? { checkpointCandidate } : {}),
  }
}

function compareNewest(a: MemoryRecord, b: MemoryRecord): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
}

function compareApprovedProject(a: MemoryRecord, b: MemoryRecord): number {
  const priorityA = a.kind ? PROJECT_KIND_PRIORITY.get(a.kind) ?? 99 : 99
  const priorityB = b.kind ? PROJECT_KIND_PRIORITY.get(b.kind) ?? 99 : 99
  const time = b.updatedAt.localeCompare(a.updatedAt)
  if (time !== 0) return time
  return priorityA - priorityB || a.id.localeCompare(b.id)
}

function isPendingContinuity(memory: MemoryRecord): boolean {
  if (memory.status !== "pending") return false
  if (memory.kind === "project_checkpoint" || memory.kind === "session_summary") return true
  return Boolean(classifyCheckpointCandidate(memory))
}

function isWorkflowRelevantGlobal(memory: MemoryRecord): boolean {
  if (memory.scope.type !== "global") return false
  if (memory.kind === "workflow_rule") return true
  return GLOBAL_WORKFLOW_TEXT_PATTERN.test(memory.text)
}

function requiredContinuityActions(hasPendingContinuity: boolean): string[] {
  if (!hasPendingContinuity) return REQUIRED_CONTINUITY_ACTIONS
  return ["memory-lane review --json", ...REQUIRED_CONTINUITY_ACTIONS.filter((action) => action !== "memory-lane review --json")]
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function buildWarnings(input: {
  projectScope?: string
  latestProject?: ContinuityMemoryPreview
  pendingContinuity: ContinuityMemoryPreview[]
  hintCodes: Set<string>
  caller?: string
}): ContinuityWarning[] {
  const warnings: ContinuityWarning[] = []
  if (!input.projectScope) {
    warnings.push({
      code: "no-project-scope",
      severity: "warning",
      message: "No project scope is active; continuity may be global or incomplete. Pass projectPath in MCP clients or run from the project directory.",
    })
  }

  const latestApprovedAt = input.latestProject?.updatedAt
  const newerPending = latestApprovedAt
    ? input.pendingContinuity.filter((memory) => memory.updatedAt > latestApprovedAt)
    : input.pendingContinuity
  if (newerPending.length) {
    warnings.push({
      code: "pending-continuity-newer-than-approved",
      severity: "review",
      message: "Pending continuity candidates are newer than the latest approved project continuity memory; inspect review before answering as fact.",
      memoryIds: newerPending.map((memory) => memory.id),
    })
  }

  if (input.hintCodes.has("scope-hygiene-candidate")) {
    warnings.push({ code: "scope-hygiene-candidate", severity: "review", message: "Some visible global memories look project-specific; inspect scope hygiene before relying on them." })
  }
  if (input.hintCodes.has("operating-agreement-overlap")) {
    warnings.push({ code: "operating-agreement-overlap", severity: "review", message: "Multiple operating agreement candidates overlap; inspect agreements before applying workflow guidance." })
  }
  if (input.caller === "mcp") {
    warnings.push({ code: "mcp-explicit-tools-only", severity: "info", message: "MCP exposes explicit tools only; it does not run lifecycle hooks or automatic context injection." })
  }
  return warnings
}

export function buildContinuityReadModel(memories: MemoryRecord[], options: ContinuityReadModelOptions = {}): ContinuityReadModel {
  const projectScope = options.projectScopeKey
  const previewMaxChars = options.previewMaxChars ?? DEFAULT_PREVIEW_MAX_CHARS
  const maxPendingContinuity = options.maxPendingContinuity ?? DEFAULT_MAX_PENDING_CONTINUITY
  const visibleApproved = memories.filter((memory) => memory.status === "approved" && visibleInProject(memory, projectScope))
  const approvedProject = visibleApproved
    .filter((memory) => projectScoped(memory, projectScope) && (!memory.kind || CONTINUITY_KINDS.has(memory.kind)))
    .sort(compareApprovedProject)
  const approvedGlobal = visibleApproved
    .filter((memory) => isWorkflowRelevantGlobal(memory))
    .sort(compareNewest)
  const pendingReview = memories.filter((memory) => memory.status === "pending" && visibleInProject(memory, projectScope))
  const pendingContinuity = pendingReview
    .filter((memory) => projectScoped(memory, projectScope) && isPendingContinuity(memory))
    .sort(compareNewest)
    .slice(0, maxPendingContinuity)
    .map((memory) => preview(memory, previewMaxChars))
    .filter((item): item is ContinuityMemoryPreview => Boolean(item))

  const freshness = buildFreshnessStatus(memories, { projectScopeKey: projectScope })
  const continuityHints = buildContinuityHints(memories, { projectScopeKey: projectScope })
  const operatingAgreements = summarizeOperatingAgreements(selectOperatingAgreements(memories, { projectScopeKey: projectScope }))
  const latestProject = approvedProject.map((memory) => preview(memory, previewMaxChars)).find(Boolean)
  const latestGlobal = approvedGlobal.map((memory) => preview(memory, previewMaxChars)).find(Boolean)
  const hintCodes = new Set(continuityHints.hints.map((hint) => hint.code))
  const warnings = buildWarnings({ projectScope, latestProject, pendingContinuity, hintCodes, caller: options.caller })

  const suggestedActions = unique([
    ...requiredContinuityActions(Boolean(pendingContinuity.length)),
    ...continuityHints.suggestedActions,
  ])

  return {
    projectScope: projectScope ?? "none",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    status: {
      visibleApprovedCount: visibleApproved.length,
      pendingReviewCount: pendingReview.length,
      pendingContinuityCount: pendingContinuity.length,
    },
    latestApproved: {
      ...(latestProject ? { project: latestProject } : {}),
      ...(latestGlobal ? { global: latestGlobal } : {}),
    },
    pendingContinuity,
    freshness,
    continuityHints,
    operatingAgreements,
    warnings,
    suggestedActions,
    answerGuidance: [
      "Use this continuity read model before answering last-worked-on, accomplished, or next-action questions.",
      "Treat pending continuity as review candidates, not approved facts.",
      projectScope ? "If repository access is available, compare this result with current git state and roadmap/docs before finalizing the answer." : "Pass projectPath or run from a project directory for project-scoped continuity.",
    ],
    harnessGuidance: {
      summary: ["Memory Lane owns continuity semantics; harnesses should use this read model rather than recall alone."],
      cli: REQUIRED_CONTINUITY_ACTIONS.map((command) => `Run ${command} for authoritative Memory Lane inspection.`),
      mcp: REQUIRED_MCP_TOOLS.map((tool) => `Call ${tool} with projectPath when project-scoped results are needed in MCP clients.`),
    },
    notes: ["Continuity is read-only; no memory cleanup, approval, or mutation is performed."],
  }
}
