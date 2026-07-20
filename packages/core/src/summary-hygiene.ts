import type { MemoryKind, MemoryRecord, MemorySource } from "./types.js"

export type SummaryClaimClassification = "decision" | "procedure" | "project_fact" | "checkpoint" | "temporary_handoff"

export interface SummaryClaim {
  text: string
  classification: SummaryClaimClassification
  section?: string
  operationalReasons: string[]
}

export interface SummaryHygieneAnalysis {
  operationalChatter: boolean
  durableOutcome: boolean
  action: "keep" | "suppress" | "hint"
  reasons: string[]
  claims: SummaryClaim[]
  claimCount: number
  durableClaimCount: number
  temporaryClaimCount: number
  durableContentDensity: number
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
  { reason: "review-status-label", pattern: /\b(?:reviewer\s+returned|reviewer\s+reported|review\s+status|reported\s+status|report\s+status|status|verdict)\s*(?::|=|\s+as|\s+is|\s+was)?\s*(?:approved|changes[_\s-]?requested|done[_\s-]?with[_\s-]?concerns|needs[_\s-]?context|blocked)\b/iu },
  { reason: "memory-review-management", pattern: MEMORY_REVIEW_MANAGEMENT_PATTERN },
  { reason: "orchestration-status", pattern: /\b(?:task\s+\d+\s+only|coordinator\s+should\s+collect|collect\s+(?:the\s+)?results|reported\s+status)\b/iu },
  { reason: "branch-state", pattern: /\b(?:current\s+)?branch\b|\buncommitted\b|\bworking\s+tree\b|\bchecked\s+out\b/iu },
  { reason: "reviewer-instruction", pattern: /\b(?:ask|use|have)\s+(?:the\s+|a\s+)?[\w-]*reviewer\b|\breviewer\s+should\b/iu },
  { reason: "next-turn-instruction", pattern: /\bnext\s+(?:turn|step|action|task)s?\b|\bcontinue\s+(?:with|by|on)\b/iu },
  { reason: "command-state", pattern: /^(?:run|use|open|check|inspect|execute)\s+(?:`?(?:git|gh|pnpm|npm|yarn|bun|memory-lane)\b|`[^`]+`)/iu },
  { reason: "incomplete-state", pattern: /\b(?:still\s+in\s+progress|awaiting\s+(?:merge|review)|remains?\s+to\s+be|verification\s+(?:is\s+)?(?:still\s+)?pending|implementation\s+(?:has\s+)?not\s+started|scope\s+is\s+unknown)\b/iu },
]

const SECTION_CLASSIFICATIONS: Array<{ pattern: RegExp; classification: SummaryClaimClassification }> = [
  { pattern: /^(?:decisions? made|decisions?)$/iu, classification: "decision" },
  { pattern: /^(?:procedures?|recovery procedures?|steps)$/iu, classification: "procedure" },
  { pattern: /^(?:key )?(?:project )?facts?(?: about .+)?$/iu, classification: "project_fact" },
  { pattern: /^(?:checkpoints?|completed outcomes?)$/iu, classification: "checkpoint" },
  { pattern: /^(?:temporary handoff state|handoff state|blockers? or failures?|blockers?|failures?|open questions?|next steps?)$/iu, classification: "temporary_handoff" },
]

const CHECKPOINT_PATTERN = /\b(?:(?:PR|pull\s+request|issue)\s*#?\d+\s+(?:was\s+|has\s+been\s+)?(?:merged|closed|completed)|(?:merged|closed|completed)\s+(?:PR|pull\s+request|issue)\s*#?\d+|released\s+v?\d+\.\d+\.\d+|tagged\s+v?\d+\.\d+\.\d+|published\s+v?\d+\.\d+\.\d+)\b/iu
const PROCEDURE_PATTERN = /^(?:procedure|steps?|when|pitfall|verify):|\b(?:to recover|recovery procedure|follow these steps|before release,? verify)\b/iu
const DECISION_PATTERN = /\b(?:decision|decided|chose|must|invariant|will use|should use)\b/iu
const FACT_PATTERN = /\b(?:root cause|project|codebase|package|path|uses?|includes?|implemented|added|removed|prevents?|supports?)\b/iu

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function isSessionSummaryLike(options?: { kind?: MemoryKind; source?: MemorySource }): boolean {
  return options?.kind === "session_summary" || options?.source === "session-summary"
}

function normalizedHeading(line: string): string | undefined {
  const match = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)
  if (!match) return undefined
  return match[1].replace(/\s*\([^)]*\)\s*$/u, "").trim()
}

function sectionClassification(section: string | undefined): SummaryClaimClassification | undefined {
  if (!section) return undefined
  return SECTION_CLASSIFICATIONS.find(({ pattern }) => pattern.test(section))?.classification
}

function operationalReasons(text: string): string[] {
  return OPERATIONAL_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ reason }) => reason)
}

function classifyClaim(text: string, section?: string): SummaryClaimClassification {
  const classifiedSection = sectionClassification(section)
  if (classifiedSection) return classifiedSection
  if (operationalReasons(text).length > 0) return "temporary_handoff"
  if (CHECKPOINT_PATTERN.test(text)) return "checkpoint"
  if (PROCEDURE_PATTERN.test(text)) return "procedure"
  if (DECISION_PATTERN.test(text)) return "decision"
  if (FACT_PATTERN.test(text)) return "project_fact"
  return "project_fact"
}

export function classifySummaryClaims(text: string): SummaryClaim[] {
  const claims: SummaryClaim[] = []
  let section: string | undefined
  for (const rawLine of text.split(/\r?\n/u)) {
    const heading = normalizedHeading(rawLine)
    if (heading) {
      if (!/^session summary(?:\s+claim)?$/iu.test(heading)) section = heading
      continue
    }
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    const claimText = trimmed.replace(/^[-*+]\s+/u, "").replace(/^\d+[.)]\s+/u, "").trim()
    if (!claimText) continue
    const reasons = operationalReasons(claimText)
    claims.push({
      text: claimText,
      classification: classifyClaim(claimText, section),
      ...(section ? { section } : {}),
      operationalReasons: reasons,
    })
  }
  return claims
}

export function analyzeSummaryHygiene(text: string, options?: { kind?: MemoryKind; source?: MemorySource }): SummaryHygieneAnalysis {
  const claims = classifySummaryClaims(text)
  const operationalReasonsFound = unique(claims.flatMap((claim) => claim.operationalReasons))
  const operationalClaimCount = claims.filter((claim) => claim.operationalReasons.length > 0).length
  const durableClaimCount = claims.filter((claim) => claim.classification !== "temporary_handoff").length
  const temporaryClaimCount = claims.length - durableClaimCount
  const durableContentDensity = claims.length === 0 ? 0 : durableClaimCount / claims.length
  const operationalDominance = claims.length > 0 && operationalClaimCount / claims.length > 0.5
  const operationalChatter = operationalReasonsFound.length > 0
  const durableOutcome = durableClaimCount > 0
  const reasons = [...operationalReasonsFound]
  if (operationalDominance) reasons.push("operational-dominance")
  if (durableOutcome) reasons.push("durable-outcome")

  const suppress = isSessionSummaryLike(options) && (!durableOutcome || operationalDominance)
  const action: SummaryHygieneAnalysis["action"] = suppress
    ? "suppress"
    : operationalChatter && !durableOutcome
      ? "hint"
      : "keep"

  return {
    operationalChatter,
    durableOutcome,
    action,
    reasons: unique(reasons),
    claims,
    claimCount: claims.length,
    durableClaimCount,
    temporaryClaimCount,
    durableContentDensity,
  }
}

export function withReviewHygiene(memory: MemoryRecord): MemoryRecordWithReviewHygiene {
  if (memory.status !== "pending") return memory
  const analysis = analyzeSummaryHygiene(memory.text, { kind: memory.kind, source: memory.source })
  if (!analysis.operationalChatter || (analysis.durableOutcome && analysis.action === "keep")) return memory
  return {
    ...memory,
    reviewHygiene: {
      operationalChatter: true,
      reasons: analysis.reasons,
      suggestedAction: analysis.action === "suppress" ? "consider-rejecting" : "inspect",
    },
  }
}
