import {
  containsLikelySecret,
  lexicalScore,
  normalizeMemoryText,
  type ContinuityHintCode,
  type ContinuityHintSummary,
  type MemoryContextPolicyConfig,
  type MemoryRecord,
  type OperatingAgreementSummary,
  type RecallResult,
} from "@memory-lane/core"
import type { ContinuityContextDecision } from "./types.js"

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

export type MemoryContextEvent = "prompt" | "sessionStart"

export type ResolvedMemoryContextPolicy = Required<MemoryContextPolicyConfig> & {
  maxItems: { sessionStart: number; prompt: number }
  maxChars: { sessionStart: number; prompt: number }
}

export const DEFAULT_CONTEXT_POLICY: ResolvedMemoryContextPolicy = {
  mode: "selective",
  maxItems: { sessionStart: 4, prompt: 6 },
  maxChars: { sessionStart: 1600, prompt: 3000 },
  includePending: false,
  fallbackToSearch: true,
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

export function resolveContextPolicy(policy?: MemoryContextPolicyConfig): ResolvedMemoryContextPolicy {
  return {
    mode: policy?.mode ?? DEFAULT_CONTEXT_POLICY.mode,
    maxItems: {
      sessionStart: policy?.maxItems?.sessionStart ?? DEFAULT_CONTEXT_POLICY.maxItems.sessionStart,
      prompt: policy?.maxItems?.prompt ?? DEFAULT_CONTEXT_POLICY.maxItems.prompt,
    },
    maxChars: {
      sessionStart: policy?.maxChars?.sessionStart ?? DEFAULT_CONTEXT_POLICY.maxChars.sessionStart,
      prompt: policy?.maxChars?.prompt ?? DEFAULT_CONTEXT_POLICY.maxChars.prompt,
    },
    includePending: policy?.includePending ?? DEFAULT_CONTEXT_POLICY.includePending,
    fallbackToSearch: policy?.fallbackToSearch ?? DEFAULT_CONTEXT_POLICY.fallbackToSearch,
  }
}

export function limitsFromContextPolicy(event: MemoryContextEvent, policy?: MemoryContextPolicyConfig, overrides?: Partial<MemoryInjectionLimits>): Partial<MemoryInjectionLimits> {
  const resolved = resolveContextPolicy(policy)
  const key = event === "sessionStart" ? "sessionStart" : "prompt"
  return {
    maxItems: resolved.maxItems[key],
    targetChars: resolved.maxChars[key],
    hardMaxChars: resolved.maxChars[key],
    absoluteMaxChars: resolved.maxChars[key],
    ...overrides,
  }
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

export type ContinuityIntentFamily = "resume" | "lookup" | "project-position" | "next-work"

export type ContinuityIntent =
  | { detected: false }
  | { detected: true; family: ContinuityIntentFamily; topic?: string }

function cleanContinuityTopic(topic: string | undefined): string | undefined {
  const cleaned = (topic ?? "")
    .replace(/[?.!]+$/u, "")
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/gu, "")
    .replace(/^the\s+/iu, "")
    .trim()
    .replace(/\s+/gu, " ")
  return cleaned.length > 0 ? cleaned : undefined
}

export function detectContinuityIntent(prompt: string): ContinuityIntent {
  const input = prompt.trim()
  const normalized = normalizedPrompt(prompt)
  if (!normalized) return { detected: false }

  const resumePatterns = [
    /^(?:let'?s\s+)?resume\s+(?:building|working\s+on|work\s+on)\s+(.+?)\s*$/iu,
    /^continue\s+(?:building|working\s+on|work\s+on)\s+(.+?)\s*$/iu,
    /^pick\s+up\s+(.+?)(?:\s+again)?[?.!]*\s*$/iu,
  ]
  for (const pattern of resumePatterns) {
    const match = input.match(pattern)
    const topic = cleanContinuityTopic(match?.[1])
    if (topic) return { detected: true, family: "resume", topic }
  }

  const lookupPatterns = [
    /^where\s+was\s+(.+?)\s+implemented\??$/iu,
    /^when\s+did\s+we\s+implement\s+(.+?)\??$/iu,
    /^where\s+did\s+we\s+(?:build|implement)\s+(.+?)\??$/iu,
    /^find\s+the\s+(?:thread|session)\s+where\s+we\s+(?:built|implemented)\s+(.+?)\??$/iu,
    /^find\s+the\s+(?:thread|session)\s+where\s+(.+?)\s+(?:was\s+built|was\s+implemented|happened)\??$/iu,
  ]
  for (const pattern of lookupPatterns) {
    const match = input.match(pattern)
    const topic = cleanContinuityTopic(match?.[1])
    if (topic) return { detected: true, family: "lookup", topic }
  }

  if (/\bwhere\s+are\s+we\s+(?:in|on)\s+(?:the\s+)?project\b/iu.test(normalized)
    || /\bwhat(?:\s+s|\s+is)\s+the\s+latest\s+progress\b/iu.test(normalized)
    || /\bwhat\s+were\s+we\s+last\s+working\s+on\b/iu.test(normalized)) {
    return { detected: true, family: "project-position" }
  }

  if (/\bwhat\s+should\s+we\s+work\s+on\s+next\b/iu.test(normalized)
    || /\bwhat(?:\s+s|\s+is)\s+next\b/iu.test(normalized)
    || /\bwhat(?:\s+s|\s+is)\s+the\s+next\s+slice\b/iu.test(normalized)) {
    return { detected: true, family: "next-work" }
  }

  return { detected: false }
}

function escapedRecallTopic(topic: string): string {
  return topic.replace(/"/gu, "\\\"")
}

export function renderContinuityIntentGuidance(intent: ContinuityIntent): string {
  if (!intent.detected) return ""

  const lines = [
    "## Memory Lane continuity guidance",
    "",
    "This prompt appears to ask about prior or ongoing project work.",
    "Before answering from chat context alone, inspect Memory Lane project state and current project workflow when available.",
    "",
    "Suggested inspection:",
    "- memory-lane status --json",
    "- memory-lane dashboard",
  ]

  if (intent.topic) lines.push(`- memory-lane recall "${escapedRecallTopic(intent.topic)}"`)
  if (intent.family === "project-position" || intent.family === "next-work") lines.push("- review current plan, roadmap, and review queue when present")

  return lines.join("\n")
}

export function renderMemoryBlock(memories: MemoryRecord[]): string {
  if (!memories.length) return ""
  return ["## Relevant Memory", "", ...memories.map((memory) => `- ${memory.text}`)].join("\n")
}

export interface ContinuityNoticeResult extends ContinuityContextDecision {
  text: string
}

export interface ContinuityNoticeInput {
  hints?: ContinuityHintSummary
  operatingAgreements?: OperatingAgreementSummary
  since?: string
  maxChars: number
}

const SAFE_INSPECTION_ACTIONS = [
  /^memory-lane status(?: --json)?(?: --since \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/u,
  /^memory-lane dashboard$/u,
  /^memory-lane agreements$/u,
  /^memory-lane list(?: --json)?$/u,
  /^memory-lane review(?: --json)?$/u,
] as const

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function collectContinuityMetadataIds(input: ContinuityNoticeInput): string[] {
  return uniqueValues([
    ...(input.hints?.hints.flatMap((hint) => hint.memoryIds) ?? []),
    ...(input.hints?.supersededVisible.flatMap((memory) => [memory.id, memory.supersededBy].filter((id): id is string => Boolean(id))) ?? []),
    ...(input.hints?.operatingAgreementOverlaps.flatMap((overlap) => [...overlap.primaryIds, ...overlap.relatedIds]) ?? []),
    ...(input.hints?.projectGlobalPreferenceOverlaps.flatMap((overlap) => [...overlap.projectIds, ...overlap.globalIds]) ?? []),
    ...(input.hints?.newerApproved?.newestIds ?? []),
    ...(input.operatingAgreements?.primary.map((agreement) => agreement.id) ?? []),
    ...(input.operatingAgreements?.relatedCandidates.map((agreement) => agreement.id) ?? []),
  ])
}

function isInspectionAction(action: string, blockedSubstrings: string[]): boolean {
  const trimmed = action.trim()
  if (!trimmed) return false
  if (!SAFE_INSPECTION_ACTIONS.some((pattern) => pattern.test(trimmed))) return false
  return !blockedSubstrings.some((blocked) => blocked && trimmed.includes(blocked))
}

function continuitySuggestedActions(input: ContinuityNoticeInput): string[] {
  const blockedSubstrings = collectContinuityMetadataIds(input)
  const actions = [
    ...(input.hints?.suggestedActions ?? []),
    ...(input.hints?.hints.flatMap((hint) => hint.suggestedActions) ?? []),
  ]

  if (input.hints?.newerApproved && input.since) actions.unshift(`memory-lane status --json --since ${input.since}`)
  if ((input.operatingAgreements?.primaryCount ?? 0) > 0) actions.push("memory-lane agreements")

  return uniqueValues(actions.map((action) => action.trim()).filter((action) => isInspectionAction(action, blockedSubstrings)))
}

function continuityHintCodes(hints?: ContinuityHintSummary): ContinuityHintCode[] {
  return uniqueValues(hints?.hints.map((hint) => hint.code) ?? [])
}

function hasContinuitySignals(input: ContinuityNoticeInput): boolean {
  return (input.hints?.hintCount ?? 0) > 0
    || (input.hints?.newerApproved?.count ?? 0) > 0
    || (input.hints?.supersededVisible.length ?? 0) > 0
    || (input.operatingAgreements?.primaryCount ?? 0) > 0
}

export function renderContinuityNotice(input: ContinuityNoticeInput): ContinuityNoticeResult {
  const hintCount = input.hints?.hintCount ?? 0
  const hintCodes = continuityHintCodes(input.hints)
  const newerApprovedCount = input.hints?.newerApproved?.count
  const operatingAgreementPrimaryCount = input.operatingAgreements?.primaryCount
  const suggestedActions = continuitySuggestedActions(input)

  if (!hasContinuitySignals(input)) {
    return {
      generated: false,
      injected: false,
      text: "",
      omittedReasons: [],
      hintCount,
      hintCodes,
      newerApprovedCount,
      operatingAgreementPrimaryCount,
      suggestedActions: [],
    }
  }

  const lines = ["Continuity notice:"]

  if ((newerApprovedCount ?? 0) > 0 || hintCodes.includes("newer-approved")) {
    lines.push(input.since
      ? `- There is newer approved Memory Lane state since ${input.since}. Inspect Memory Lane before relying on older session context.`
      : "- There is newer approved Memory Lane state. Inspect Memory Lane before relying on older session context.")
  }

  if ((operatingAgreementPrimaryCount ?? 0) > 0 || hintCodes.includes("operating-agreement-overlap")) {
    lines.push("- Current workflow agreements are available. Inspect them before changing project process or operating agreements.")
  }

  if (hintCodes.includes("superseded-visible") || (input.hints?.supersededVisible.length ?? 0) > 0) {
    lines.push("- Some approved memories are superseded historical guidance. Inspect current Memory Lane state before following older guidance.")
  }

  if (hintCodes.includes("project-global-overlap")) {
    lines.push("- Project and global preferences may overlap. Inspect Memory Lane before choosing which preference applies.")
  }

  if (suggestedActions.length) {
    lines.push("If relevant, inspect before proceeding:")
    lines.push(...suggestedActions.map((action) => `- ${action}`))
  }

  const text = lines.join("\n")
  if (text.length > input.maxChars) {
    return {
      generated: true,
      injected: false,
      text: "",
      omittedReasons: ["continuity-budget"],
      hintCount,
      hintCodes,
      newerApprovedCount,
      operatingAgreementPrimaryCount,
      suggestedActions,
    }
  }

  return {
    generated: true,
    injected: true,
    text,
    omittedReasons: [],
    hintCount,
    hintCodes,
    newerApprovedCount,
    operatingAgreementPrimaryCount,
    suggestedActions,
  }
}

export function renderMemoryContext(input: { event: MemoryContextEvent; memories: MemoryRecord[]; policy?: MemoryContextPolicyConfig }): string {
  const policy = resolveContextPolicy(input.policy)
  if (policy.mode === "off") return ""

  const header = `<memory-context mode="${policy.mode}" event="${input.event}">`
  const footer = "</memory-context>"

  if (policy.mode === "policy-only") {
    return [
      header,
      "Memory Lane is available, but automatic memory-body injection is disabled by policy.",
      "Use Memory Lane recall/list tools when durable preferences, project facts, or prior-session context would help.",
      policy.fallbackToSearch ? "Prefer targeted recall/search before assuming missing context." : undefined,
      footer,
    ].filter((line): line is string => Boolean(line)).join("\n")
  }

  if (!input.memories.length) return ""
  return [
    header,
    "These are selected Memory Lane memories for this turn. They are not an authoritative full memory list.",
    "",
    ...input.memories.map((memory) => `- ${memory.text}`),
    footer,
  ].join("\n")
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
