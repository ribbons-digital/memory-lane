import {
  classifyFreshness,
  containsLikelySecret,
  isPreferenceLikeMemory,
  lexicalScore,
  normalizeMemoryText,
  type ContinuityHintCode,
  type ContinuityHintSummary,
  type FreshnessClassification,
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
  preferenceMaxItems?: number
  preferenceMaxChars?: number
}

export interface MemorySelectionOptions extends Partial<MemoryInjectionLimits> {
  projectScope?: string
}

export interface BaselineSelectionOptions extends MemorySelectionOptions {
  priorityMemories?: MemoryRecord[]
}

export interface AutomaticHandoffAnalysis {
  eligible: MemoryRecord[]
  eligibleCount: number
  omittedReasons: string[]
}

export interface AutomaticHandoffAnalysisOptions {
  projectScope?: string
  referenceNow?: string
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

export interface MemoryBlockRenderOptions {
  projectScope?: string
  latestHandoffIds?: Set<string>
}

type MemoryContextGroupKey =
  | "latest-handoff"
  | "current-project"
  | "project-specific"
  | "global-preferences"
  | "global-memory"
  | "other-project"
  | "other"

interface MemoryContextGroup {
  key: MemoryContextGroupKey
  title: string
  memories: MemoryRecord[]
}

export type ResolvedMemoryContextPolicy = Required<MemoryContextPolicyConfig> & {
  maxItems: { sessionStart: number; prompt: number }
  maxChars: { sessionStart: number; prompt: number }
}

export const DEFAULT_CONTEXT_POLICY: ResolvedMemoryContextPolicy = {
  mode: "selective",
  maxItems: { sessionStart: 4, prompt: 6 },
  maxChars: { sessionStart: 1600, prompt: 3000 },
  preferenceMaxItems: { sessionStart: 2, prompt: 2 },
  preferenceMaxChars: { sessionStart: 600, prompt: 900 },
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
    preferenceMaxItems: {
      sessionStart: policy?.preferenceMaxItems?.sessionStart ?? DEFAULT_CONTEXT_POLICY.preferenceMaxItems.sessionStart,
      prompt: policy?.preferenceMaxItems?.prompt ?? DEFAULT_CONTEXT_POLICY.preferenceMaxItems.prompt,
    },
    preferenceMaxChars: {
      sessionStart: policy?.preferenceMaxChars?.sessionStart ?? DEFAULT_CONTEXT_POLICY.preferenceMaxChars.sessionStart,
      prompt: policy?.preferenceMaxChars?.prompt ?? DEFAULT_CONTEXT_POLICY.preferenceMaxChars.prompt,
    },
    includePending: policy?.includePending ?? DEFAULT_CONTEXT_POLICY.includePending,
    fallbackToSearch: policy?.fallbackToSearch ?? DEFAULT_CONTEXT_POLICY.fallbackToSearch,
  }
}

export function limitsFromContextPolicy(event: MemoryContextEvent, policy?: MemoryContextPolicyConfig, overrides?: MemorySelectionOptions): MemorySelectionOptions {
  const resolved = resolveContextPolicy(policy)
  const key = event === "sessionStart" ? "sessionStart" : "prompt"
  return {
    maxItems: resolved.maxItems[key],
    targetChars: resolved.maxChars[key],
    hardMaxChars: resolved.maxChars[key],
    absoluteMaxChars: resolved.maxChars[key],
    preferenceMaxItems: resolved.preferenceMaxItems[key],
    preferenceMaxChars: resolved.preferenceMaxChars[key],
    ...overrides,
  }
}

function capLimits(options?: MemorySelectionOptions): MemoryInjectionLimits {
  const merged = { ...CODEX_MEMORY_INJECTION_LIMITS, ...options }
  const absoluteMaxChars = Math.min(
    Math.max(1, merged.absoluteMaxChars),
    CODEX_MEMORY_INJECTION_LIMITS.absoluteMaxChars,
  )
  const hardMaxChars = Math.min(Math.max(0, merged.hardMaxChars), absoluteMaxChars)
  const preferenceMaxItems = merged.preferenceMaxItems === undefined ? undefined : Math.max(0, merged.preferenceMaxItems)
  const preferenceMaxChars = merged.preferenceMaxChars === undefined ? undefined : Math.min(Math.max(0, merged.preferenceMaxChars), absoluteMaxChars)

  return {
    maxItems: Math.max(0, merged.maxItems),
    targetChars: Math.min(Math.max(0, merged.targetChars), absoluteMaxChars),
    hardMaxChars,
    absoluteMaxChars,
    ...(preferenceMaxItems === undefined ? {} : { preferenceMaxItems }),
    ...(preferenceMaxChars === undefined ? {} : { preferenceMaxChars }),
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

interface LayeredSelectionState {
  selected: MemoryRecord[]
  seen: Set<string>
  seenIds: Set<string>
  chars: number
  preferenceChars: number
  preferenceCount: number
}

function preferenceBudget(limits: MemoryInjectionLimits): { maxItems: number; maxChars: number } {
  return {
    maxItems: Math.max(0, limits.preferenceMaxItems ?? 2),
    maxChars: Math.max(0, limits.preferenceMaxChars ?? Math.min(limits.hardMaxChars, 900)),
  }
}

function appendLayeredMemory(memory: MemoryRecord, limits: MemoryInjectionLimits, state: LayeredSelectionState): void {
  if (state.selected.length >= limits.maxItems) return
  if (containsLikelySecret(memory.text)) return

  const key = normalizedMemoryKey(memory.text)
  if (!key || state.seen.has(key) || state.seenIds.has(memory.id)) return

  const isPreference = isPreferenceLikeMemory(memory)
  const preferences = preferenceBudget(limits)
  if (isPreference && state.preferenceCount >= preferences.maxItems) return

  const remainingTotalChars = limits.hardMaxChars - state.chars
  const remainingPreferenceChars = isPreference ? preferences.maxChars - state.preferenceChars : remainingTotalChars
  const remainingChars = Math.min(remainingTotalChars, remainingPreferenceChars)
  const fitted = fitMemoryWithinBudget(memory, remainingChars)
  if (!fitted) return

  state.selected.push(fitted)
  state.seen.add(key)
  state.seenIds.add(memory.id)
  state.chars += fitted.text.length
  if (isPreference) {
    state.preferenceCount += 1
    state.preferenceChars += fitted.text.length
  }
}

function appendLayer(state: LayeredSelectionState, limits: MemoryInjectionLimits, memories: MemoryRecord[]): void {
  for (const memory of memories) {
    if (state.selected.length >= limits.maxItems) break
    appendLayeredMemory(memory, limits, state)
  }
}

function sortByUpdatedAtDesc(memories: MemoryRecord[]): MemoryRecord[] {
  return [...memories].sort((a, b) => {
    const updated = b.updatedAt.localeCompare(a.updatedAt)
    if (updated !== 0) return updated
    const created = b.createdAt.localeCompare(a.createdAt)
    if (created !== 0) return created
    return b.id.localeCompare(a.id)
  })
}

function isHandoffPointer(memory: MemoryRecord): boolean {
  return memory.kind === "session_summary" || memory.kind === "project_checkpoint"
}

export function isUnsafeAutomaticHandoffPointer(memory: MemoryRecord, projectScope: string | undefined, referenceNow = new Date().toISOString()): boolean {
  if (!projectScope) return false
  if (memory.scope.type !== "project" || memory.scope.key !== projectScope) return false
  if (!isHandoffPointer(memory)) return false
  if (memory.revision?.supersededBy) return true
  return classifyFreshness(memory, referenceNow) === "expired"
}

function handoffFreshnessReason(classification: FreshnessClassification): string | undefined {
  if (classification === "expired") return "expired"
  if (classification === "stale") return "stale-handoff"
  return undefined
}

export function analyzeAutomaticHandoff(memories: MemoryRecord[], options: AutomaticHandoffAnalysisOptions = {}): AutomaticHandoffAnalysis {
  if (!options.projectScope) return { eligible: [], eligibleCount: 0, omittedReasons: ["no-project-scope"] }

  const referenceNow = options.referenceNow ?? new Date().toISOString()
  const omittedReasons = new Set<string>()
  const eligible: MemoryRecord[] = []

  for (const memory of memories) {
    if (memory.status !== "approved") continue
    if (memory.scope.type !== "project" || memory.scope.key !== options.projectScope) continue
    if (!isHandoffPointer(memory)) continue
    if (containsLikelySecret(memory.text)) {
      omittedReasons.add("secret")
      continue
    }
    if (memory.revision?.supersededBy) {
      omittedReasons.add("superseded")
      continue
    }
    const freshness = classifyFreshness(memory, referenceNow)
    const freshnessReason = handoffFreshnessReason(freshness)
    if (freshnessReason === "expired") {
      omittedReasons.add(freshnessReason)
      continue
    }
    if (freshnessReason) omittedReasons.add(freshnessReason)
    eligible.push(memory)
  }

  return {
    eligible: sortByUpdatedAtDesc(eligible).slice(0, 1),
    eligibleCount: eligible.length,
    omittedReasons: [...omittedReasons],
  }
}

function layeredMemoryGroups(memories: MemoryRecord[], projectScope?: string): MemoryRecord[][] {
  const currentProjectPreferences = projectScope
    ? memories.filter((memory) => memory.scope.type === "project" && memory.scope.key === projectScope && isPreferenceLikeMemory(memory))
    : []
  const currentProjectContent = projectScope
    ? memories.filter((memory) => memory.scope.type === "project" && memory.scope.key === projectScope && !isPreferenceLikeMemory(memory))
    : []
  const globalPreferences = memories.filter((memory) => memory.scope.type === "global" && isPreferenceLikeMemory(memory))
  const globalMemory = memories.filter((memory) => memory.scope.type === "global" && !isPreferenceLikeMemory(memory))
  const otherProject = memories.filter((memory) => memory.scope.type === "project" && (!projectScope || memory.scope.key !== projectScope))
  const other = memories.filter((memory) => memory.scope.type !== "project" && memory.scope.type !== "global")

  return [
    currentProjectPreferences,
    currentProjectContent,
    globalPreferences,
    globalMemory,
    otherProject,
    other,
  ]
}

export function selectMemoriesForInjection(
  prompt: string,
  result: RecallResult,
  options?: MemorySelectionOptions,
): MemoryRecord[] {
  if (shouldSkipAutomaticInjection(prompt)) return []

  const limits = capLimits(options)
  const requireLexical = requiresLexicalOverlap(result)
  const eligible = result.memories.filter((memory) => {
    if (containsLikelySecret(memory.text)) return false
    const overlap = lexicalScore(prompt, memory.text)
    return !requireLexical || overlap > 0
  })
  const state: LayeredSelectionState = {
    selected: [],
    seen: new Set<string>(),
    seenIds: new Set<string>(),
    chars: 0,
    preferenceChars: 0,
    preferenceCount: 0,
  }

  for (const layer of layeredMemoryGroups(eligible, options?.projectScope)) {
    appendLayer(state, limits, layer)
  }

  return state.selected
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
    || /\bwhere\s+did\s+we\s+leave\s+off\b/iu.test(normalized)
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

function shellQuoteRecallTopic(topic: string): string {
  return `'${topic.replace(/'/gu, `'\\''`)}'`
}

export function renderContinuityIntentGuidance(intent: ContinuityIntent): string {
  if (!intent.detected) return ""

  const lines = [
    "## Memory Lane continuity guidance",
    "",
    "This prompt appears to ask about prior or ongoing project work.",
    "Before answering from chat context alone, inspect the canonical Memory Lane continuity state and current project workflow when available.",
    "",
    "Suggested inspection:",
    "- CLI: memory-lane continuity --json",
    "- MCP: memory_continuity({ projectPath })",
    "- Do not answer from memory_recall alone; use recall only for topic-specific follow-up after continuity inspection.",
    "- memory-lane status --json",
    "- memory-lane dashboard",
  ]

  if (intent.topic) lines.push(`- memory-lane recall ${shellQuoteRecallTopic(intent.topic)}`)
  if (intent.family === "project-position" || intent.family === "next-work") lines.push("- review current plan, roadmap, and review queue when present")

  return lines.join("\n")
}

const MEMORY_CONTEXT_GROUPS: Array<{ key: MemoryContextGroupKey; title: string }> = [
  { key: "latest-handoff", title: "Latest approved handoff" },
  { key: "current-project", title: "Current project" },
  { key: "project-specific", title: "Project-specific memory" },
  { key: "global-preferences", title: "Global preferences and workflow rules" },
  { key: "global-memory", title: "Global memory" },
  { key: "other-project", title: "Other visible project memory" },
  { key: "other", title: "Other visible memory" },
]

function titleCaseKind(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function readableMemoryKind(memory: MemoryRecord): string {
  switch (memory.kind) {
    case "project_checkpoint":
      return "Project checkpoint"
    case "workflow_rule":
      return "Workflow rule"
    case "session_summary":
      return "Session summary"
    case "project_fact":
      return "Project fact"
    case "preference":
      return "Preference"
    default:
      return memory.kind ? titleCaseKind(memory.kind) : titleCaseKind(memory.category)
  }
}

function isGlobalPreferenceLike(memory: MemoryRecord): boolean {
  return memory.scope.type === "global" && isPreferenceLikeMemory(memory)
}

function groupKeyForMemory(memory: MemoryRecord, options?: MemoryBlockRenderOptions): MemoryContextGroupKey {
  if (options?.latestHandoffIds?.has(memory.id)) return "latest-handoff"
  if (memory.scope.type === "project") {
    if (!options?.projectScope) return "project-specific"
    return memory.scope.key === options.projectScope ? "current-project" : "other-project"
  }

  if (memory.scope.type === "global") return isGlobalPreferenceLike(memory) ? "global-preferences" : "global-memory"
  return "other"
}

function groupMemoriesForContext(memories: MemoryRecord[], options?: MemoryBlockRenderOptions): MemoryContextGroup[] {
  const grouped = new Map<MemoryContextGroupKey, MemoryRecord[]>()
  for (const memory of memories) {
    const key = groupKeyForMemory(memory, options)
    grouped.set(key, [...(grouped.get(key) ?? []), memory])
  }

  return MEMORY_CONTEXT_GROUPS
    .map((group) => ({ ...group, memories: grouped.get(group.key) ?? [] }))
    .filter((group) => group.memories.length > 0)
}

export function renderMemoryBlock(memories: MemoryRecord[], options?: MemoryBlockRenderOptions): string {
  if (!memories.length) return ""

  const lines = [
    "## Relevant Memory",
    "",
    "Memory Lane selected these approved memories for this turn. They may include current-project memories and global preferences or workflow rules.",
  ]

  for (const group of groupMemoriesForContext(memories, options)) {
    lines.push("", `### ${group.title}`, "")
    for (const memory of group.memories) {
      lines.push(`- **${readableMemoryKind(memory)}**`, `  ${memory.text}`)
    }
  }

  return lines.join("\n")
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

export function renderMemoryContext(input: { event: MemoryContextEvent; memories: MemoryRecord[]; policy?: MemoryContextPolicyConfig; projectScope?: string; latestHandoffIds?: Set<string> }): string {
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
    renderMemoryBlock(input.memories, { projectScope: input.projectScope, latestHandoffIds: input.latestHandoffIds }),
    footer,
  ].join("\n")
}

export function selectBaselineMemories(
  memories: MemoryRecord[],
  options?: BaselineSelectionOptions,
): MemoryRecord[] {
  const limits = capLimits({ ...CODEX_BASELINE_INJECTION_LIMITS, ...options })
  const candidates = memories.filter((memory) => memory.status === "approved" && !containsLikelySecret(memory.text))
  const state: LayeredSelectionState = {
    selected: [],
    seen: new Set<string>(),
    seenIds: new Set<string>(),
    chars: 0,
    preferenceChars: 0,
    preferenceCount: 0,
  }

  appendLayer(state, limits, options?.priorityMemories ?? [])

  for (const layer of layeredMemoryGroups(candidates, options?.projectScope).map(sortByUpdatedAtDesc)) {
    appendLayer(state, limits, layer)
  }

  return state.selected
}
