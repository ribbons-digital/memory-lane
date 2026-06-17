import {
  containsLikelySecret,
  lexicalScore,
  normalizeMemoryText,
  type MemoryRecord,
  type RecallResult,
} from "@memory-lane/core"

export interface MemoryInjectionLimits {
  maxItems: number
  targetChars: number
  hardMaxChars: number
  absoluteMaxChars: number
}

export const CODEX_MEMORY_INJECTION_LIMITS: MemoryInjectionLimits = {
  maxItems: 6,
  targetChars: 1800,
  hardMaxChars: 3000,
  absoluteMaxChars: 6000,
}

export const CODEX_BASELINE_INJECTION_LIMITS: MemoryInjectionLimits = {
  maxItems: 4,
  targetChars: 1000,
  hardMaxChars: 1600,
  absoluteMaxChars: 2000,
}

const GENERIC_PROMPTS = new Set([
  "ok",
  "okay",
  "yes",
  "yep",
  "yeah",
  "sure",
  "sounds good",
  "go ahead",
  "continue",
  "proceed",
  "approved",
  "looks good",
  "thanks",
  "thank you",
])

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "did",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "off",
  "on",
  "or",
  "please",
  "that",
  "the",
  "this",
  "to",
  "use",
  "we",
  "what",
  "where",
  "with",
  "you",
])

function normalizedPrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ")
}

function meaningfulTokens(prompt: string): string[] {
  const normalized = normalizedPrompt(prompt)
  return normalized ? normalized.split(" ").filter((token) => token && !STOP_WORDS.has(token)) : []
}

export function shouldSkipAutomaticInjection(prompt: string): boolean {
  const normalized = normalizedPrompt(prompt)
  if (!normalized) return true
  if (GENERIC_PROMPTS.has(normalized)) return true
  return meaningfulTokens(prompt).length === 0
}

function normalizedMemoryKey(text: string): string {
  return normalizeMemoryText(text).toLowerCase().replace(/\s+/gu, " ").trim()
}

function capLimits(options?: Partial<MemoryInjectionLimits>): MemoryInjectionLimits {
  const merged = { ...CODEX_MEMORY_INJECTION_LIMITS, ...options }
  const absoluteMaxChars = Math.min(
    Math.max(1, merged.absoluteMaxChars),
    CODEX_MEMORY_INJECTION_LIMITS.absoluteMaxChars,
  )
  const hardMaxChars = Math.min(Math.max(0, merged.hardMaxChars), absoluteMaxChars)

  return {
    maxItems: Math.max(0, merged.maxItems),
    targetChars: Math.min(Math.max(0, merged.targetChars), absoluteMaxChars),
    hardMaxChars,
    absoluteMaxChars,
  }
}

function truncateAtBoundary(text: string, maxChars: number): string | undefined {
  if (maxChars <= 1) return undefined
  if (text.length <= maxChars) return text

  const slice = text.slice(0, maxChars - 1).trimEnd()
  if (!slice) return undefined

  const boundaries = [slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? ")]
  const boundary = Math.max(...boundaries)
  if (boundary >= 40) return `${slice.slice(0, boundary + 1)}…`
  return `${slice}…`
}

function fitMemoryWithinBudget(memory: MemoryRecord, remainingChars: number): MemoryRecord | undefined {
  if (remainingChars <= 0) return undefined
  if (memory.text.length <= remainingChars) return memory

  const truncated = truncateAtBoundary(memory.text, remainingChars)
  if (!truncated) return undefined
  return { ...memory, text: truncated }
}

function requiresLexicalOverlap(result: RecallResult): boolean {
  return !result.semantic.used || result.semantic.fallbackReason === "No semantic matches"
}

export function selectMemoriesForInjection(
  prompt: string,
  result: RecallResult,
  options?: Partial<MemoryInjectionLimits>,
): MemoryRecord[] {
  if (shouldSkipAutomaticInjection(prompt)) return []

  const limits = capLimits(options)
  const requireLexical = requiresLexicalOverlap(result)
  const seen = new Set<string>()
  const selected: MemoryRecord[] = []
  let chars = 0

  for (const memory of result.memories) {
    if (selected.length >= limits.maxItems) break
    if (containsLikelySecret(memory.text)) continue

    const overlap = lexicalScore(prompt, memory.text)
    if (requireLexical && overlap <= 0) continue

    const key = normalizedMemoryKey(memory.text)
    if (!key || seen.has(key)) continue

    const remainingChars = limits.hardMaxChars - chars
    const fitted = fitMemoryWithinBudget(memory, remainingChars)
    if (!fitted) continue

    selected.push(fitted)
    seen.add(key)
    chars += fitted.text.length
  }

  return selected
}

export function isMemoryManagementListIntent(prompt: string): boolean {
  const normalized = normalizedPrompt(prompt)
  if (!normalized) return false
  const asksForMemory = /\b(?:memory|memories|memory lane)\b/u.test(normalized)
  if (!asksForMemory) return false
  return /\b(?:list|show|current|review|status|all|pending|approved)\b/u.test(normalized)
}

export function renderMemoryManagementListGuidance(): string {
  return [
    "## Memory Lane command guidance",
    "",
    "The user is asking for an authoritative Memory Lane list/status/review, not a relevance-filtered memory injection.",
    "Use the authoritative Memory Lane surface instead of answering from injected Relevant Memory:",
    "- CLI: `memory-lane list --json` for visible current-scope memories.",
    "- CLI: `memory-lane review --json` for pending review items.",
    "- CLI: `memory-lane status --json` for counts and project scope.",
    "- MCP clients: use `memory_list`, `memory_review`, or `memory_status`; pass `projectPath` for project-scoped results.",
  ].join("\n")
}

export function renderMemoryBlock(memories: MemoryRecord[]): string {
  if (!memories.length) return ""
  return ["## Relevant Memory", "", ...memories.map((memory) => `- ${memory.text}`)].join("\n")
}

function compareBaselineRelevance(a: MemoryRecord, b: MemoryRecord): number {
  const dateCompare = b.updatedAt.localeCompare(a.updatedAt)
  if (dateCompare !== 0) return dateCompare
  const aProject = a.scope.type === "project" ? 1 : 0
  const bProject = b.scope.type === "project" ? 1 : 0
  return bProject - aProject
}

export function selectBaselineMemories(
  memories: MemoryRecord[],
  options?: Partial<MemoryInjectionLimits>,
): MemoryRecord[] {
  const limits = capLimits({ ...CODEX_BASELINE_INJECTION_LIMITS, ...options })
  const seen = new Set<string>()
  const selected: MemoryRecord[] = []
  let chars = 0

  const candidates = [...memories]
    .filter((memory) => memory.status === "approved" && !containsLikelySecret(memory.text))
    .sort(compareBaselineRelevance)

  for (const memory of candidates) {
    if (selected.length >= limits.maxItems) break

    const key = normalizedMemoryKey(memory.text)
    if (!key || seen.has(key)) continue

    const remainingChars = limits.hardMaxChars - chars
    const fitted = fitMemoryWithinBudget(memory, remainingChars)
    if (!fitted) continue

    selected.push(fitted)
    seen.add(key)
    chars += fitted.text.length
  }

  return selected
}
