import {
  containsLikelySecret,
  detectUserMemorySuggestion,
  inferCategory,
  inferMemoryKind,
  normalizeMemoryText,
  parseExplicitMemoryRequest,
} from "@memory-lane/core"
import type { MemoryCandidate, StopInput } from "./types.js"

function isQuestion(text: string): boolean {
  return /^(?:what|how|why|when|where|who|do|does|did|is|are|can|could|should)\b/iu.test(text.trim())
}

function decisionFor(category: MemoryCandidate["category"], explicit: boolean): MemoryCandidate["decision"] {
  if (explicit) return "save-approved"
  if (category === "project") return "save-approved"
  if (category === "preference") return "save-pending"
  return "discard"
}

function candidateFromText(text: string, explicit: boolean): MemoryCandidate | undefined {
  const normalized = normalizeMemoryText(text)
  if (!normalized || containsLikelySecret(normalized) || isQuestion(normalized)) return undefined

  const category = inferCategory(normalized)
  const decision = decisionFor(category, explicit)
  if (decision === "discard") return undefined

  return {
    text: normalized,
    category,
    scopeType: category === "project" ? "project" : "global",
    kind: inferMemoryKind(normalized, category),
    confidence: explicit ? 0.95 : category === "project" ? 0.9 : 0.7,
    decision,
    reason: explicit ? "explicit memory request" : "durable user statement",
    source: explicit ? "user-suggested" : "agent-suggested",
  }
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

  if (isQuestion(userMessage)) return []

  const suggestion = detectUserMemorySuggestion(userMessage)
  if (suggestion) {
    const candidate = candidateFromText(suggestion.text, false)
    return candidate ? [candidate] : []
  }

  return dedupeCandidates([candidateFromText(userMessage, false)].filter((candidate): candidate is MemoryCandidate => Boolean(candidate)))
}
