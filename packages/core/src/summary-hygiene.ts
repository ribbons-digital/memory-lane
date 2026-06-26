import type { MemoryKind, MemoryRecord, MemorySource } from "./types.js"

export interface SummaryHygieneAnalysis {
  operationalChatter: boolean
  durableOutcome: boolean
  action: "keep" | "suppress" | "hint"
  reasons: string[]
}

export interface ReviewHygieneMetadata {
  operationalChatter: true
  reasons: string[]
  suggestedAction: "inspect" | "consider-rejecting"
}

export type MemoryRecordWithReviewHygiene = MemoryRecord & { reviewHygiene?: ReviewHygieneMetadata }

const MEMORY_REVIEW_MANAGEMENT_PATTERN = /\b(?:approve|reject|review)\s+(?:(?:these|those)\s+(?:memory\s+)?(?:ids?|memories)|(?:pending\s+)?memories|(?:memory\s+)?ids?|memory\s+[0-9a-f]{6,}|[0-9a-f]{6,})\b|\bmemory-lane\s+review\b|\/memory\s+review\b/iu

const OPERATIONAL_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "delegated-subagent", pattern: /\b(?:delegated\s+subagent|subagent\s+session|subagent\s+(?:reported|completed|reviewed)|worker\s+\d+|agent\s+\d+)\b/iu },
  { reason: "acceptance-finalization", pattern: /\b(?:acceptance\s+finalization|acceptance\s+contract|compare\s+the\s+current\s+work\s+to\s+the\s+acceptance\s+contract)\b/iu },
  { reason: "review-status-label", pattern: /\b(?:approved|changes[_\s-]?requested|done[_\s-]?with[_\s-]?concerns|needs[_\s-]?context|blocked)\b/iu },
  { reason: "memory-review-management", pattern: MEMORY_REVIEW_MANAGEMENT_PATTERN },
  { reason: "orchestration-status", pattern: /\b(?:task\s+\d+\s+only|coordinator\s+should\s+collect|collect\s+(?:the\s+)?results|reported\s+status)\b/iu },
]

const DURABLE_OUTCOME_PATTERNS: RegExp[] = [
  /\b(?:merged|released|tagged|published|shipped|implemented|fixed|landed|validated|verified)\b/iu,
  /\bcompleted\b(?!\s+task\b)/iu,
  /\b(?:PR|pull\s+request)\s*#?\d+\b/iu,
  /\bv\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?\b/u,
  /\b(?:root\s+cause|blocker|decision|decided|user\s+prefers|preference)\b/iu,
  /^\s*[-*]?\s*next\s+(?:step|action)s?\s*:\s*(?!.*(?:\b(?:approve|reject|review)\s+(?:(?:these|those)\s+(?:memory\s+)?(?:ids?|memories)|(?:pending\s+)?memories|(?:memory\s+)?ids?|memory\s+[0-9a-f]{6,}|[0-9a-f]{6,})\b|\bmemory-lane\s+review\b|\/memory\s+review\b)).+$/imu,
  /\b(?:Procedure|When|Steps|Pitfall|Verify):\b/u,
]

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function isSessionSummaryLike(options?: { kind?: MemoryKind; source?: MemorySource }): boolean {
  return options?.kind === "session_summary" || options?.source === "session-summary"
}

export function analyzeSummaryHygiene(text: string, options?: { kind?: MemoryKind; source?: MemorySource }): SummaryHygieneAnalysis {
  const reasons = unique(OPERATIONAL_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ reason }) => reason))
  const operationalChatter = reasons.length > 0
  const durableOutcome = DURABLE_OUTCOME_PATTERNS.some((pattern) => pattern.test(text))
  if (durableOutcome) reasons.push("durable-outcome")

  const action: SummaryHygieneAnalysis["action"] = operationalChatter && !durableOutcome && isSessionSummaryLike(options)
    ? "suppress"
    : operationalChatter && !durableOutcome
      ? "hint"
      : "keep"

  return { operationalChatter, durableOutcome, action, reasons: unique(reasons) }
}

export function withReviewHygiene(memory: MemoryRecord): MemoryRecordWithReviewHygiene {
  if (memory.status !== "pending") return memory
  const analysis = analyzeSummaryHygiene(memory.text, { kind: memory.kind, source: memory.source })
  if (!analysis.operationalChatter || analysis.durableOutcome) return memory
  return {
    ...memory,
    reviewHygiene: {
      operationalChatter: true,
      reasons: analysis.reasons,
      suggestedAction: analysis.action === "suppress" ? "consider-rejecting" : "inspect",
    },
  }
}
