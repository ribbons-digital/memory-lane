import {
  containsLikelySecret,
  detectUserMemorySuggestion,
  inferCategory,
  inferMemoryKind,
  isCheckpointMemorySaveRequest,
  isMetaTaskPromptText,
  normalizeMemoryText,
  parseExplicitMemoryRequest,
} from "@memory-lane/core"
import type { MemoryCandidate, StopInput } from "./types.js"

const MAX_INFERRED_PREFERENCE_CHARS = 240
const MAX_INFERRED_PREFERENCE_WORDS = 32
const EXECUTION_VERB_SOURCE = "add|build|change|check|create|debug|delete|deploy|draft|fix|implement|install|investigate|make|remove|refactor|review|run|test|update|write"
const PREFERENCE_CUE_SOURCE = "i\\s+(?:(?:globally\\s+)?prefer|like|usually)|my\\s+(?:global\\s+)?preference\\s+is|always\\s+use|never\\s+(?:use|commit)|please\\s+(?:always|never)|(?:do\\s+not|don't)\\s+use|i\\s+use\\s+\\S+(?:\\s+\\S+)*?\\s+for\\s+\\S+"
const TRANSIENT_IMPERATIVE_PATTERN = new RegExp(`^(?:please\\s+)?(?:${EXECUTION_VERB_SOURCE})\\b`, "iu")
const PREFERENCE_STATEMENT_PATTERN = new RegExp(`\\b(?:${PREFERENCE_CUE_SOURCE})\\b`, "iu")
const TASK_SPECIFIC_PREFERENCE_PATTERN = new RegExp(`\\bi\\s+prefer\\s+(?:that\\s+)?you\\s+(?:${EXECUTION_VERB_SOURCE})\\b`, "iu")
const TRAILING_EXECUTION_PATTERN = new RegExp(`(?:[,;]|\\band\\s+then\\b)\\s*(?:and|but)?\\s*(?:please\\s+)?(?:${EXECUTION_VERB_SOURCE})\\b`, "iu")
const NON_TERMINAL_ABBREVIATION_PATTERN = /\b(?:e\.g|i\.e|a\.m|p\.m|u\.s|u\.k|mr|mrs|ms|dr|prof|sr|jr|vs|etc|approx|fig|no)\.$/iu

function isOpeningQuestion(text: string): boolean {
  return /^(?:what|how|why|when|where|who|do|does|did|is|are|can|could|should)\b/iu.test(text.trim())
}

function isQuestion(text: string): boolean {
  const normalized = text.trim()
  return normalized.includes("?") ||
    /(?:^|[.!;,]\s+)(?:what|how|why|when|where|who|which|do|does|did|is|are|can|could|should|would|will)\b/iu.test(normalized) ||
    /\b(?:can|could|would|will)\s+you\b/iu.test(normalized)
}

function isObviousTransientImperative(text: string): boolean {
  return TRANSIENT_IMPERATIVE_PATTERN.test(text.trim())
}

function isExplicitlyCrossProject(text: string): boolean {
  return /\b(?:globally|global\s+preference|global(?:ly)?\s+preferred|across\s+(?:all|every)\s+(?:projects?|repositor(?:y|ies)|repos?)|in\s+(?:all|every|any)\s+(?:projects?|repositor(?:y|ies)|repos?)|for\s+(?:all|every)\s+(?:projects?|repositor(?:y|ies)|repos?)|regardless\s+of\s+(?:the\s+)?(?:project|repo|repository))\b/iu.test(text)
}

function containsUnresolvedReference(text: string): boolean {
  const withoutClearlyBoundReferences = text
    .replace(/\bthis\s+(?:project|repo|repository)\b/giu, "")
    .replace(/\b(?!(?:it|this|that|these|those|prefer|like|use|commit)\b)([\p{L}\p{N}_-]+)\s+(because|as)\s+it\b(?=\s+(?:is|was|has|does|will|would|can|could|should|[\p{L}]+s)\b)/giu, "$1 $2 ")
    .replace(/\b(?!(?:it|this|that|these|those|prefer|like|use|commit)\b)([\p{L}\p{N}_-]+[,;]\s*)(?:this|that)(?=\s+is\s+\S+)/giu, "$1")

  if (/\b(?:it|for\s+now|this\s+task|the\s+current\s+(?:task|request)|above|below)\b/iu.test(withoutClearlyBoundReferences)) return true

  return /\b(?:this|that|these|those)\b(?=\s*(?:$|[.!?,;:]|(?:is|are|was|were|has|have|had|does|do|did|will|would|can|could|should|works?|looks?|seems?)\b|(?:task|request|command|example|option|approach|suggestion|change|issue)\b))/iu.test(withoutClearlyBoundReferences)
}

function isTaskSpecificPreference(text: string): boolean {
  return TASK_SPECIFIC_PREFERENCE_PATTERN.test(text) ||
    TRAILING_EXECUTION_PATTERN.test(text) ||
    /\b(?:new-session|session-start)\s+prompt\b/iu.test(text)
}

function hasCopiedSpecificationStructure(text: string): boolean {
  const normalized = text.trim()
  return /^(?:#{1,6}\s+|(?:task|requirements?|deliverables?|acceptance(?:\s+criteria)?|specification|examples?|non-goals?|steps?|commands?)\s*:)/iu.test(normalized) ||
    /^\|.*\|$/u.test(normalized) || normalized.endsWith(":")
}

function passesInferredPreferenceGates(text: string): boolean {
  const normalized = text.trim()
  const words = normalized.split(/\s+/u)
  if (normalized.length > MAX_INFERRED_PREFERENCE_CHARS || words.length > MAX_INFERRED_PREFERENCE_WORDS) return false
  if (/\r|\n/u.test(normalized) || /```|~~~/u.test(normalized)) return false
  if (/\b(?:https?:\/\/|www\.)/iu.test(normalized)) return false
  if (isQuestion(normalized) || isObviousTransientImperative(normalized)) return false
  if (containsUnresolvedReference(normalized) || isTaskSpecificPreference(normalized)) return false
  if (hasCopiedSpecificationStructure(normalized) || isMetaTaskPromptText(normalized)) return false
  return true
}

function isPreferenceStatement(text: string): boolean {
  return PREFERENCE_STATEMENT_PATTERN.test(text)
}

function splitInferredLine(line: string): string[] {
  const units: string[] = []
  const boundaryPattern = /([.!?]+)\s+/gu
  let start = 0

  for (const match of line.matchAll(boundaryPattern)) {
    const punctuation = match[1] ?? ""
    const boundaryIndex = match.index ?? 0
    if (/^\.+$/u.test(punctuation) && NON_TERMINAL_ABBREVIATION_PATTERN.test(line.slice(0, boundaryIndex + punctuation.length))) continue

    units.push(line.slice(start, boundaryIndex + punctuation.length))
    start = boundaryIndex + match[0].length
  }

  units.push(line.slice(start))
  return units
}

function inferredUnits(text: string): string[] {
  const withoutFencedCode = text
    .replace(/```[\s\S]*?```/gu, "\n")
    .replace(/~~~[\s\S]*?~~~/gu, "\n")
    .replace(/(?:```|~~~)[\s\S]*$/gu, "\n")

  return withoutFencedCode
    .split(/\r?\n/u)
    .flatMap(splitInferredLine)
    .map((unit) => unit.trim())
    .filter((unit) => !/^(?:[-*+]|\d+[.)])\s+/u.test(unit))
    .map((unit) => unit.replace(/^>\s*/u, "").trim())
    .filter(Boolean)
}

function decisionFor(category: MemoryCandidate["category"], explicit: boolean): MemoryCandidate["decision"] {
  if (explicit) return "save-approved"
  if (category === "project") return "save-approved"
  if (category === "preference") return "save-pending"
  return "discard"
}

function candidateFromText(
  text: string,
  explicit: boolean,
  options: { category?: MemoryCandidate["category"]; scopeType?: MemoryCandidate["scopeType"] } = {},
): MemoryCandidate | undefined {
  const normalized = normalizeMemoryText(text)
  if (!normalized || containsLikelySecret(normalized)) return undefined
  if (explicit ? isOpeningQuestion(normalized) : isQuestion(normalized)) return undefined
  if (!explicit && isObviousTransientImperative(normalized)) return undefined

  const category = options.category ?? inferCategory(normalized)
  const decision = decisionFor(category, explicit)
  if (decision === "discard") return undefined

  return {
    text: normalized,
    category,
    scopeType: options.scopeType ?? (category === "project" ? "project" : "global"),
    kind: inferMemoryKind(normalized, category),
    confidence: explicit ? 0.95 : category === "project" ? 0.9 : 0.7,
    decision,
    reason: explicit ? "explicit memory request" : "atomic durable user statement",
    source: explicit ? "user-suggested" : "agent-suggested",
  }
}

function inferredCandidateFromUnit(unit: string): MemoryCandidate | undefined {
  if (!passesInferredPreferenceGates(unit)) return undefined

  const suggestion = detectUserMemorySuggestion(unit)
  const inferredCategory = inferCategory(unit)
  const category = isPreferenceStatement(unit)
    ? "preference"
    : suggestion?.category === "project" || inferredCategory === "project"
      ? "project"
      : undefined

  if (!category) return undefined

  const scopeType = category === "preference" && isExplicitlyCrossProject(unit) ? "global" : "project"
  return candidateFromText(unit, false, { category, scopeType })
}

function dedupeCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const seen = new Set<string>()
  const result: MemoryCandidate[] = []
  for (const candidate of candidates) {
    const key = normalizeMemoryText(candidate.text).toLowerCase().replace(/\s+/gu, " ").trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }
  return result
}

export function extractStopCandidates(input: StopInput): MemoryCandidate[] {
  const userMessage = input.lastUserMessage?.trim() ?? ""
  if (!userMessage || containsLikelySecret(userMessage)) return []

  const explicit = parseExplicitMemoryRequest(userMessage)
  if (explicit) {
    const candidate = candidateFromText(explicit, true)
    return candidate ? [candidate] : []
  }

  if (isCheckpointMemorySaveRequest(userMessage)) {
    const normalized = normalizeMemoryText(userMessage)
    if (normalized && !containsLikelySecret(normalized)) {
      return [{
        text: normalized,
        category: "project",
        scopeType: "project",
        kind: "project_checkpoint",
        confidence: 0.85,
        decision: "save-approved",
        reason: "checkpoint save request",
        source: "user-suggested",
      }]
    }
    return []
  }

  return dedupeCandidates(
    inferredUnits(userMessage)
      .map(inferredCandidateFromUnit)
      .filter((candidate): candidate is MemoryCandidate => Boolean(candidate)),
  )
}
