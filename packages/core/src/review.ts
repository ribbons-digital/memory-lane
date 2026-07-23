import { classifyCheckpointCandidate } from "./checkpoint-candidates.js"
import { resolveProjectScope } from "./project-scope.js"
import type { MemoryLifecycleEvent, MemoryRecord, MemorySource } from "./types.js"

export const qualitySignalCodes = [
  "bare-checkpoint",
  "previously-rejected-equivalent",
  "contains-question",
  "contains-code-fence",
  "ambiguous-reference",
  "cross-project-global-candidate",
  "mixed-durable-transient-summary",
] as const

export type ReviewQualitySignalCode = typeof qualitySignalCodes[number]
export type ReviewQualitySuggestedAction = "inspect" | "consider-rejecting" | "consider-rescoping"

export interface ReviewQualitySignal {
  code: ReviewQualitySignalCode
  label: string
  reason: string
  suggestedAction: ReviewQualitySuggestedAction
}

export interface ReviewQualityContext {
  rejectedMemories?: MemoryRecord[]
  activeProjectScope?: string
  projectScopeKeysByRoot?: ReadonlyMap<string, string>
}

export const TARGETED_REVIEW_MAX_REVISION_ATTEMPTS = 2

export type TargetedReviewOutcome = "clean" | "revise" | "needs-human-review"
export type TargetedReviewSuggestedAction = "none" | "revise" | "request-human-review"

export interface TargetedReviewAttemptState {
  revisionAttempts: number
  maxRevisionAttempts: number
  remainingRevisionAttempts: number
}

/** Stable single-candidate contract for automatic advisory review. It never implies approval or rejection. */
export interface TargetedReviewReceipt {
  id: string
  currentText: string
  scope: MemoryRecord["scope"]
  kind: NonNullable<MemoryRecord["kind"]>
  qualitySignals: ReviewQualitySignal[]
  reasons: string[]
  suggestedAction: TargetedReviewSuggestedAction
  attemptState: TargetedReviewAttemptState
  outcome: TargetedReviewOutcome
}

export interface ReviewGroup {
  key: string
  label: string
  projectScope: string
  source: MemorySource
  kind: string
  adapter: string
  lifecycleEvent: MemoryLifecycleEvent | "none"
  count: number
  memoryIds: string[]
}

const DURABLE_SUMMARY_PATTERN = /\b(?:decided|decision|implemented|fixed|resolved|released|merged|verified|completed|adopted|configured|now uses?|must|always|never)\b/iu
const TRANSIENT_SUMMARY_PATTERN = /\b(?:next (?:step|action)|todo|follow[- ]?up|for now|tomorrow|later|in progress|awaiting|review this|run (?:the )?(?:tests?|command)|open (?:a )?pr)\b/iu
const RESOLVED_REFERENCE_NOUNS = "project|repository|repo|workflow|process|preference|rule|command|tool|package|file|branch|pr|pull request|release|test|tests|issue|memory|candidate|summary|task"
const AMBIGUOUS_REFERENCE_PATTERN = new RegExp(`\\b(?:it|this|that|these|those)\\b(?!\\s+(?:${RESOLVED_REFERENCE_NOUNS})\\b)`, "iu")
const PROJECT_KINDS = new Set(["project_fact", "project_checkpoint", "decision", "correction", "procedure", "session_summary"])

function normalizedEquivalentText(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/gu, " ").trim()
}

const BARE_CHECKPOINT_PATTERNS: Array<{ event: string; pattern: RegExp }> = [
  { event: "merge", pattern: /^merged\s+(?:pull request|pr)\s*#?\d+$/iu },
  { event: "release", pattern: /^(?:released|tagged|published)\s+v?\d+\.\d+\.\d+(?:[-+][\w.]+)?$/iu },
  { event: "verification", pattern: /^(?:(?:tests?|build|verification)(?:\s+and\s+(?:tests?|build|verification))?\s+passed|verified\s+release(?:\s+v?\d+\.\d+\.\d+(?:[-+][\w.]+)?)?)$/iu },
  { event: "docs sync", pattern: /^(?:(?:docs?|documentation)\s+(?:synced|updated)|updated\s+(?:roadmap|handoff)(?:\.md)?)$/iu },
  { event: "project", pattern: /^(?:(?:project\s+)?checkpoint(?:\s+(?:created|saved|complete(?:d)?))?|phase\s+\d+\s+complete(?:d)?|(?:milestone|deployment|migration)(?:\s+[\p{L}\p{N}_.-]+)?\s+complete(?:d)?)$/iu },
]

function bareCheckpointReason(memory: MemoryRecord): string | undefined {
  if (!classifyCheckpointCandidate(memory)) return undefined
  const firstSentence = memory.text.trim().split(/(?<=[.!?])\s+/u)[0]?.trim().replace(/[.!]+$/u, "") ?? ""
  const words = firstSentence.match(/[\p{L}\p{N}#_.+-]+/gu) ?? []
  if (!firstSentence || words.length > 8) return undefined
  const bare = BARE_CHECKPOINT_PATTERNS.find((candidate) => candidate.pattern.test(firstSentence))
  if (!bare) return undefined
  return `The ${bare.event} checkpoint identifies only an artifact or event and does not explain the durable outcome.`
}

type ProjectScopeResolver = (root: string) => { key: string } | null

/** Resolve unique legacy project roots once before deterministic per-memory quality analysis. */
export function resolveReviewProjectScopeKeys(
  memories: MemoryRecord[],
  resolver: ProjectScopeResolver = resolveProjectScope,
): ReadonlyMap<string, string> {
  const scopeKeys = new Map<string, string>()
  const legacyRoots = memories
    .filter((memory) => !memory.project?.key)
    .map((memory) => memory.project?.root)
    .filter((value): value is string => Boolean(value))
  for (const root of new Set(legacyRoots)) {
    const scope = resolver(root)
    if (scope) scopeKeys.set(root, scope.key)
  }
  return scopeKeys
}

function crossProjectGlobalReason(memory: MemoryRecord, context: ReviewQualityContext): string | undefined {
  const activeProjectScope = context.activeProjectScope
  if (memory.scope.type !== "global" || !activeProjectScope) return undefined
  const originScopeKey = memory.project?.key
    ?? (memory.project?.root ? context.projectScopeKeysByRoot?.get(memory.project.root) : undefined)
  if (originScopeKey && originScopeKey !== activeProjectScope) {
    return `The global candidate originated from project ${originScopeKey}, outside the active review project ${activeProjectScope}.`
  }
  if (memory.category === "project" || PROJECT_KINDS.has(memory.kind ?? "")) {
    return "The project-oriented candidate is global and would be visible across project boundaries."
  }
  return undefined
}

/** Deterministic, side-effect-free advisory analysis for one review candidate. */
export function analyzeReviewQuality(memory: MemoryRecord, context: ReviewQualityContext = {}): ReviewQualitySignal[] {
  const signals: ReviewQualitySignal[] = []
  const text = memory.text
  const bareReason = bareCheckpointReason(memory)
  if (bareReason) signals.push({
    code: "bare-checkpoint",
    label: "bare checkpoint",
    reason: bareReason,
    suggestedAction: "inspect",
  })

  const normalized = normalizedEquivalentText(text)
  const rejectedEquivalent = context.rejectedMemories?.find((candidate) =>
    candidate.id !== memory.id && candidate.status === "rejected" && normalizedEquivalentText(candidate.text) === normalized,
  )
  if (rejectedEquivalent) signals.push({
    code: "previously-rejected-equivalent",
    label: "rejected equivalent",
    reason: `The candidate text exactly matches previously rejected memory ${rejectedEquivalent.id} after whitespace and case normalization.`,
    suggestedAction: "consider-rejecting",
  })

  if (/\?/u.test(text)) signals.push({
    code: "contains-question",
    label: "question",
    reason: "The candidate contains a question and may include transient conversational text.",
    suggestedAction: "inspect",
  })

  if (/(?:```|~~~)/u.test(text)) signals.push({
    code: "contains-code-fence",
    label: "code fence",
    reason: "The candidate contains a fenced code block and may be a raw prompt or copied specification.",
    suggestedAction: "inspect",
  })

  if (AMBIGUOUS_REFERENCE_PATTERN.test(text) || /\b(?:for now|this task)\b/iu.test(text)) signals.push({
    code: "ambiguous-reference",
    label: "ambiguous reference",
    reason: "The candidate contains a reference whose meaning may depend on missing conversational context.",
    suggestedAction: "inspect",
  })

  const globalReason = crossProjectGlobalReason(memory, context)
  if (globalReason) signals.push({
    code: "cross-project-global-candidate",
    label: "cross-project global",
    reason: globalReason,
    suggestedAction: "consider-rescoping",
  })

  if (memory.kind === "session_summary" && DURABLE_SUMMARY_PATTERN.test(text) && TRANSIENT_SUMMARY_PATTERN.test(text)) signals.push({
    code: "mixed-durable-transient-summary",
    label: "mixed durable/transient",
    reason: "The session summary mixes durable outcomes with transient next-step or execution state.",
    suggestedAction: "inspect",
  })

  return signals
}

/** Build a deterministic receipt for exactly the supplied candidate. No storage is read or written. */
export function buildTargetedReviewReceipt(memory: MemoryRecord, context: ReviewQualityContext = {}): TargetedReviewReceipt {
  const qualitySignals = analyzeReviewQuality(memory, context)
  const revisionAttempts = Math.max(0, Math.min(
    memory.revision?.automaticReviewAttempts ?? 0,
    TARGETED_REVIEW_MAX_REVISION_ATTEMPTS,
  ))
  const remainingRevisionAttempts = TARGETED_REVIEW_MAX_REVISION_ATTEMPTS - revisionAttempts
  const outcome: TargetedReviewOutcome = qualitySignals.length === 0
    ? "clean"
    : remainingRevisionAttempts > 0 ? "revise" : "needs-human-review"
  return {
    id: memory.id,
    currentText: memory.text,
    scope: memory.scope,
    kind: memory.kind ?? "misc",
    qualitySignals,
    reasons: qualitySignals.map((signal) => signal.reason),
    suggestedAction: outcome === "clean" ? "none" : outcome === "revise" ? "revise" : "request-human-review",
    attemptState: {
      revisionAttempts,
      maxRevisionAttempts: TARGETED_REVIEW_MAX_REVISION_ATTEMPTS,
      remainingRevisionAttempts,
    },
    outcome,
  }
}

export function reviewProjectScope(memory: MemoryRecord): string {
  if (memory.scope.type === "global") return "global"
  return memory.scope.key ?? memory.project?.key ?? memory.project?.root ?? "project:unknown"
}

export function reviewProvenance(memory: MemoryRecord): { adapter: string; lifecycleEvent: MemoryLifecycleEvent | "none" } {
  return {
    adapter: memory.provenance?.adapter ?? "none",
    lifecycleEvent: memory.provenance?.lifecycleEvent ?? "none",
  }
}

export function groupReviewMemories(memories: MemoryRecord[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>()
  for (const memory of memories) {
    const projectScope = reviewProjectScope(memory)
    const kind = memory.kind ?? "misc"
    const provenance = reviewProvenance(memory)
    const key = [projectScope, memory.source, kind, provenance.adapter, provenance.lifecycleEvent].join("\u0000")
    const label = `Project: ${projectScope} | Source: ${memory.source} | Kind: ${kind} | Provenance: ${provenance.adapter === "none" ? "none" : `${provenance.adapter}/${provenance.lifecycleEvent}`}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      existing.memoryIds.push(memory.id)
      continue
    }
    groups.set(key, {
      key,
      label,
      projectScope,
      source: memory.source,
      kind,
      adapter: provenance.adapter,
      lifecycleEvent: provenance.lifecycleEvent,
      count: 1,
      memoryIds: [memory.id],
    })
  }
  return [...groups.values()]
}
