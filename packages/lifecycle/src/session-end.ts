import { createHash } from "node:crypto"
import { analyzeSummaryHygiene, classifySummaryClaims, containsLikelySecret, normalizeMemoryText, type MemoryEngine, type MemoryFreshness, type MemoryKind, type MemoryLifecycleEvent, type MemoryRecord, type SaveResult, type SummaryClaim, type SummaryClaimClassification } from "@memory-lane/core"
import { extractCheckpointCandidatesFromStop, inspectCheckpointCandidates } from "./checkpoint-capture.js"
import { createOpenAICompatibleProvider } from "./llm-provider.js"
import { captureLifecycleTrace } from "./trace-capture.js"
import { persistGovernedLifecycleCandidates } from "./automatic-capture.js"
import type { LifecycleCaptureResult, LLMProvider, MemoryCandidate, PreCompactInput, PreCompactOptions, SessionEndInput, SessionEndOptions } from "./types.js"

export const DEFAULT_SESSION_END_PROMPT = `You are summarizing an AI-assisted coding session for a memory system.
Read the session transcript and produce a concise, structured summary.

Include only these sections if they have content:
- Decisions made
- Procedures
- Key project facts
- Checkpoints
- Temporary handoff state

Rules:
- Do not include secrets, API keys, passwords, or private data.
- Do not include transient commands or raw tool output.
- Do not include Memory Lane review-queue management, memory IDs, approval/rejection instructions, or commands like memory-lane review unless the user explicitly made review decisions that are themselves durable project outcomes.
- Be specific but brief. Use Markdown bullet lists.
- If the session had no durable takeaways, return exactly NO_DURABLE_MEMORY.

Transcript:
{{transcript}}`

export const DEFAULT_PRE_COMPACT_PROMPT = `You are summarizing an AI-assisted coding session for a memory system immediately before the host compacts its conversation context.
Read the session transcript and produce a concise, structured summary.

Include only these sections if they have content:
- Decisions made
- Procedures
- Key project facts
- Checkpoints
- Temporary handoff state

Rules:
- Focus on information needed to continue after compaction.
- When a prior summary conflicts with later Turn Context, split-turn context, or continuation content, treat the later section as authoritative for progress and next steps.
- Do not include secrets, API keys, passwords, or private data.
- Do not include transient commands or raw tool output.
- Do not include Memory Lane review-queue management, memory IDs, approval/rejection instructions, or commands like memory-lane review unless the user explicitly made review decisions that are themselves durable project outcomes.
- Be specific but brief. Use Markdown bullet lists.
- If the session had no durable takeaways, return exactly NO_DURABLE_MEMORY.

Transcript:
{{transcript}}`

function renderTranscript(messages: SessionEndInput["messages"], includeToolOutputs: boolean): string {
  return messages
    .filter((m) => includeToolOutputs || m.role !== "tool")
    .map((m) => {
      const prefix = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : `Tool (${m.toolName ?? "unknown"})`
      const safeContent = m.content.split("\n").map((line) => (containsLikelySecret(line) ? "[redacted]" : line)).join("\n")
      return `[${prefix}]: ${safeContent}`
    })
    .join("\n\n")
}

function createPrompt(template: string, transcript: string): string {
  return template.replace("{{transcript}}", transcript)
}

function isReviewManagementChatter(line: string): boolean {
  const normalized = line.trim().replace(/^[-*]\s*/u, "")
  if (!normalized) return false
  return /^(?:run|use|open|check|inspect)\s+`?(?:memory-lane|\/memory)\s+review`?\b/iu.test(normalized)
    || /^(?:approve|reject|review)\s+(?:these\s+)?(?:memory\s+)?(?:ids?|memories|pending\s+memories)\b/iu.test(normalized)
}

function stripSessionSummaryHeading(text: string): string {
  return text.replace(/^\s*#{1,3}\s*Session Summary(?:\s*\([^)]*\))?\s*\n+/iu, "")
}

function cleanGeneratedSummary(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => !isReviewManagementChatter(line))
    .join("\n")
    .trim()
}

function capitalizeCheckpointProse(text: string): string {
  return text.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase("en-US"))
}

function reconcileSummaryCheckpointLines(engine: MemoryEngine, text: string): string {
  const reconciled: string[] = []
  const seenIdentities = new Set<string>()
  for (const line of text.split("\n")) {
    const listPrefix = /^(\s*[-*]\s*)/u.exec(line)?.[1] ?? ""
    const checkpointText = line.trim().replace(/^[-*]\s*/u, "")
    if (!checkpointText) {
      reconciled.push(line)
      continue
    }

    const extracted = extractCheckpointCandidatesFromStop({ cwd: engine.getProjectScope()?.root ?? process.cwd(), lastAssistantMessage: checkpointText })
    if (extracted.length === 0) {
      reconciled.push(line)
      continue
    }

    const inspection = inspectCheckpointCandidates(engine, extracted, {
      preserveUnrepresentedDiscards: true,
      seenIdentities,
    })
    for (const candidate of inspection.candidates) {
      if (candidate.decision !== "discard") reconciled.push(`${listPrefix}${capitalizeCheckpointProse(candidate.text)}`)
    }
  }
  return reconciled.join("\n").trim()
}

function sessionSummaryContentKey(text: string): string | undefined {
  const stripped = cleanGeneratedSummary(stripSessionSummaryHeading(text))
  const normalized = normalizeMemoryText(stripped).toLowerCase().replace(/\s+/gu, " ").trim()
  return normalized || undefined
}

function sessionSummaryProvenanceKey(input: { adapter?: string; sessionId?: string; turnId?: string; lifecycleEvent?: string; sourceSummaryId?: string; summaryClaimIndex?: number }): string | undefined {
  const lifecycleEvent = input.lifecycleEvent
  if (lifecycleEvent !== "session_end" && lifecycleEvent !== "pre_compact") return undefined

  const sessionId = input.sessionId?.trim()
  if (!sessionId) return undefined

  const parts = [input.adapter ?? "unknown", lifecycleEvent, sessionId]
  if (lifecycleEvent === "pre_compact") parts.push(input.turnId?.trim() || "unknown-turn")
  if (input.sourceSummaryId) parts.push(input.sourceSummaryId, String(input.summaryClaimIndex ?? "unknown-claim"))
  return parts.join(":")
}

function visibleInCurrentScope(memory: MemoryRecord, projectScopeKey?: string): boolean {
  if (memory.scope.type === "global") return true
  return Boolean(projectScopeKey) && (memory.scope.key === projectScopeKey || memory.project?.key === projectScopeKey || memory.project?.root === projectScopeKey)
}

function existingSessionSummaryKeys(engine: MemoryEngine): { provenance: Set<string>; content: Set<string> } {
  const projectScopeKey = engine.getProjectScope()?.key
  const provenance = new Set<string>()
  const content = new Set<string>()

  for (const memory of engine.list({ all: true })) {
    if (memory.kind !== "session_summary" && memory.source !== "session-summary") continue
    if (memory.status !== "pending" && memory.status !== "approved") continue
    if (memory.revision?.supersededBy) continue
    if (!visibleInCurrentScope(memory, projectScopeKey)) continue

    const provenanceInput = {
      adapter: memory.provenance?.adapter,
      lifecycleEvent: memory.provenance?.lifecycleEvent,
      sessionId: memory.provenance?.sessionId,
      turnId: memory.provenance?.turnId,
    }
    const provenanceKey = sessionSummaryProvenanceKey({
      ...provenanceInput,
      sourceSummaryId: memory.provenance?.sourceSummaryId,
      summaryClaimIndex: memory.provenance?.summaryClaimIndex,
    })
    if (provenanceKey) provenance.add(provenanceKey)
    const sessionProvenanceKey = sessionSummaryProvenanceKey(provenanceInput)
    if (sessionProvenanceKey) provenance.add(sessionProvenanceKey)

    const contentKey = sessionSummaryContentKey(memory.text)
    if (contentKey) content.add(contentKey)
  }

  return { provenance, content }
}

function hasSessionSummaryProvenance(existing: { provenance: Set<string> }, provenance: { adapter?: string; sessionId?: string; turnId?: string; lifecycleEvent?: string; sourceSummaryId?: string; summaryClaimIndex?: number }): boolean {
  const provenanceKey = sessionSummaryProvenanceKey(provenance)
  return Boolean(provenanceKey && existing.provenance.has(provenanceKey))
}

export function hasExistingSessionSummaryProvenance(engine: MemoryEngine, provenance: { adapter?: string; sessionId?: string; turnId?: string; lifecycleEvent?: string; sourceSummaryId?: string; summaryClaimIndex?: number }): boolean {
  return hasSessionSummaryProvenance(existingSessionSummaryKeys(engine), provenance)
}

function filterDuplicateSessionSummariesWithExisting(existing: { provenance: Set<string>; content: Set<string> }, candidates: SessionEndCandidate[]): SessionEndCandidate[] {
  const seenProvenance = new Set<string>()
  const seenContent = new Set<string>()

  return candidates.filter((candidate) => {
    const provenanceKey = sessionSummaryProvenanceKey(candidate.provenance)
    if (provenanceKey) {
      if (existing.provenance.has(provenanceKey) || seenProvenance.has(provenanceKey)) return false
      seenProvenance.add(provenanceKey)
    }

    const contentKey = sessionSummaryContentKey(candidate.text)
    if (contentKey) {
      if (existing.content.has(contentKey) || seenContent.has(contentKey)) return false
      seenContent.add(contentKey)
    }

    return true
  })
}

function filterDuplicateSessionSummaries(engine: MemoryEngine, candidates: SessionEndCandidate[]): SessionEndCandidate[] {
  return filterDuplicateSessionSummariesWithExisting(existingSessionSummaryKeys(engine), candidates)
}

function resolveProvider(options: SessionEndOptions, env: NodeJS.ProcessEnv): LLMProvider | undefined {
  if (options.provider) return options.provider
  if (options.providerConfig) return createOpenAICompatibleProvider(options.providerConfig, env)
  return undefined
}

function validIsoTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined
  return new Date(timestamp).toISOString() === value ? value : undefined
}

function latestMessageTimestamp(messages: SessionEndInput["messages"]): string | undefined {
  let latest: string | undefined
  let latestMs = Number.NEGATIVE_INFINITY
  for (const message of messages) {
    const timestamp = validIsoTimestamp(message.timestamp)
    if (!timestamp) continue
    const ms = Date.parse(timestamp)
    if (ms > latestMs) {
      latest = timestamp
      latestMs = ms
    }
  }
  return latest
}

export function preCompactTurnIdFallback(input: SessionEndInput): string | undefined {
  const digest = createHash("sha256")
    .update(JSON.stringify(input.messages.map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      toolName: message.toolName,
    }))))
    .digest("hex")
    .slice(0, 16)
  return `messages-${digest}`
}

export interface SessionEndCandidate {
  text: string
  category: "project"
  scopeType: "project" | "global"
  kind: MemoryKind
  status: "pending"
  source: "session-summary"
  provenance: {
    adapter: string
    lifecycleEvent: MemoryLifecycleEvent
    sessionId?: string
    turnId?: string
    sourceSummaryId?: string
    summaryClaimIndex?: number
  }
  freshness?: MemoryFreshness
}

const SUMMARY_REVIEW_UNIT_MAX_CHARS = 600
const SUMMARY_REVIEW_UNIT_MAX_COUNT = 8
const TEMPORARY_HANDOFF_TTL_DAYS = 7

const STRUCTURED_SECTIONS = new Set([
  "decisions made",
  "decisions",
  "procedures",
  "procedure",
  "key project facts",
  "project facts",
  "checkpoints",
  "checkpoint",
  "temporary handoff state",
  "handoff state",
])

function hasStructuredClaimSections(text: string): boolean {
  return text.split(/\r?\n/u).some((line) => {
    const match = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)
    return Boolean(match && STRUCTURED_SECTIONS.has(match[1].trim().toLowerCase()))
  })
}

function boundReviewUnit(text: string, maxChars = SUMMARY_REVIEW_UNIT_MAX_CHARS): string {
  const normalized = text.replace(/\s+/gu, " ").trim()
  if (normalized.length <= maxChars) return normalized
  const slice = normalized.slice(0, maxChars - 1).trimEnd()
  const boundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("; "), slice.lastIndexOf(" "))
  return `${slice.slice(0, boundary >= 80 ? boundary : slice.length).trimEnd()}…`
}

function sourceSummaryId(text: string): string {
  return createHash("sha256").update(normalizeMemoryText(text)).digest("hex").slice(0, 32)
}

function claimKind(classification: SummaryClaimClassification): MemoryKind {
  switch (classification) {
    case "decision": return "decision"
    case "procedure": return "procedure"
    case "project_fact": return "project_fact"
    case "checkpoint": return "project_checkpoint"
    case "temporary_handoff": return "session_summary"
  }
}

function completionReferences(claims: SummaryClaim[]): Set<string> {
  const references = new Set<string>()
  for (const claim of claims) {
    if (claim.classification !== "checkpoint") continue
    const completed = /\b(?:merged|closed|completed|released|published|shipped)\b/iu.test(claim.text)
    if (!completed) continue
    for (const match of claim.text.matchAll(/\b(PR|pull\s+request|issue)\s*#?(\d+)\b/giu)) {
      const type = /issue/iu.test(match[1]) ? "issue" : "pr"
      references.add(`${type}:${match[2]}`)
    }
  }
  return references
}

function claimReferences(claim: SummaryClaim): Set<string> {
  const references = new Set<string>()
  for (const match of claim.text.matchAll(/\b(PR|pull\s+request|issue)\s*#?(\d+)\b/giu)) {
    const type = /issue/iu.test(match[1]) ? "issue" : "pr"
    references.add(`${type}:${match[2]}`)
  }
  return references
}

function isSupersededHandoffClaim(claim: SummaryClaim, completed: Set<string>): boolean {
  if (claim.classification !== "temporary_handoff") return false
  return [...claimReferences(claim)].some((reference) => completed.has(reference))
}

function temporaryExpiry(capturedAt: string | undefined): string {
  const base = capturedAt ? Date.parse(capturedAt) : Date.now()
  return new Date(base + TEMPORARY_HANDOFF_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

function extractedSummaryCandidates(input: {
  cleaned: string
  scopeType: "project" | "global"
  adapter: string
  lifecycleEvent: MemoryLifecycleEvent
  sessionId?: string
  turnId?: string
  capturedAt?: string
}): SessionEndCandidate[] | undefined {
  if (!hasStructuredClaimSections(input.cleaned)) return undefined
  const claims = classifySummaryClaims(input.cleaned)
  const completed = completionReferences(claims)
  const sourceId = sourceSummaryId(input.cleaned)
  const candidates: SessionEndCandidate[] = []

  for (const [claimIndex, claim] of claims.entries()) {
    if (candidates.length >= SUMMARY_REVIEW_UNIT_MAX_COUNT) break
    if (isSupersededHandoffClaim(claim, completed)) continue
    if (claim.classification === "temporary_handoff" && claim.operationalReasons.length > 0) continue
    const text = boundReviewUnit(claim.text)
    if (!text || containsLikelySecret(text)) continue
    const temporary = claim.classification === "temporary_handoff"
    candidates.push({
      text,
      category: "project",
      scopeType: input.scopeType,
      kind: claimKind(claim.classification),
      status: "pending",
      source: "session-summary",
      provenance: {
        adapter: input.adapter,
        lifecycleEvent: input.lifecycleEvent,
        sessionId: input.sessionId,
        turnId: input.turnId,
        sourceSummaryId: sourceId,
        summaryClaimIndex: claimIndex,
      },
      ...(temporary
        ? { freshness: { ...(input.capturedAt ? { capturedAt: input.capturedAt } : {}), expiresAt: temporaryExpiry(input.capturedAt) } }
        : input.capturedAt ? { freshness: { capturedAt: input.capturedAt } } : {}),
    })
  }
  return candidates
}

function boundedLegacySummary(cleaned: string): string {
  const heading = `## Session Summary (${new Date().toISOString().slice(0, 10)})`
  const boundedLines: string[] = []
  let sections = 0
  let bullets = 0
  for (const line of cleaned.split(/\r?\n/u)) {
    if (/^\s*#{1,6}\s/u.test(line) && ++sections > 4) continue
    if (/^\s*[-*+]\s/u.test(line) && ++bullets > 8) continue
    boundedLines.push(line)
  }
  const available = SUMMARY_REVIEW_UNIT_MAX_CHARS - heading.length - 2
  const content = boundedLines.join("\n").trim()
  const bounded = content.length <= available ? content : `${content.slice(0, available - 1).trimEnd()}…`
  return [heading, "", bounded].join("\n")
}

export async function handleSessionEnd(
  engine: MemoryEngine,
  input: SessionEndInput,
  options: SessionEndOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionEndCandidate[]> {
  engine.refreshScope(input.cwd)
  const scope = engine.getProjectScope()
  if (options.captureTrace !== false) {
    captureLifecycleTrace(input, {
      adapter: options.adapter,
      lifecycleEvent: options.lifecycleEvent === "pre_compact" ? "pre_compact" : "session_end",
      trigger: options.trigger,
      fidelity: options.traceFidelity,
      configPath: options.configPath,
      env,
    })
  }

  if (options.requireConfirmation !== false && !options.confirmed) {
    return []
  }

  const provider = resolveProvider(options, env)
  if (!provider) {
    throw new Error("Session-end summarization is enabled but no LLM provider is configured")
  }

  const lifecycleEvent = options.lifecycleEvent ?? "session_end"
  const adapter = options.adapter ?? options.providerConfig?.provider ?? "manual"
  const turnId = options.turnId ?? (lifecycleEvent === "pre_compact" ? preCompactTurnIdFallback(input) : undefined)
  const existingSummaries = existingSessionSummaryKeys(engine)
  if (hasSessionSummaryProvenance(existingSummaries, { adapter, lifecycleEvent, sessionId: input.sessionId, turnId })) return []

  const transcript = renderTranscript(input.messages, options.includeToolOutputs ?? false)
  if (!transcript.trim()) return []

  const prompt = createPrompt(options.promptTemplate ?? DEFAULT_SESSION_END_PROMPT, transcript)
  const raw = await provider.complete(prompt, { maxTokens: options.maxTokens })

  if (/^NO_DURABLE_MEMORY[.\s]*$/iu.test(raw.trim())) return []

  const cleaned = reconcileSummaryCheckpointLines(engine, cleanGeneratedSummary(raw))
  if (!sessionSummaryContentKey(cleaned)) return []
  const hygiene = analyzeSummaryHygiene(cleaned, { kind: "session_summary", source: "session-summary" })
  const capturedAt = latestMessageTimestamp(input.messages)
  const scopeType = scope ? "project" : "global"
  const extracted = extractedSummaryCandidates({
    cleaned,
    scopeType,
    adapter,
    lifecycleEvent,
    sessionId: input.sessionId,
    turnId,
    capturedAt,
  })
  if (extracted) return filterDuplicateSessionSummariesWithExisting(existingSummaries, extracted)
  if (hygiene.action === "suppress") return []

  return filterDuplicateSessionSummariesWithExisting(existingSummaries, [{
    text: boundedLegacySummary(cleaned),
    category: "project",
    scopeType,
    kind: "session_summary",
    status: "pending",
    source: "session-summary",
    provenance: {
      adapter,
      lifecycleEvent,
      sessionId: input.sessionId,
      turnId,
    },
    ...(capturedAt ? { freshness: { capturedAt } } : {}),
  }])
}

function completedCandidateReferences(candidate: SessionEndCandidate): Set<string> {
  if (candidate.kind !== "project_checkpoint" || !/\b(?:merged|closed|completed|released|published|shipped)\b/iu.test(candidate.text)) return new Set()
  const claim: SummaryClaim = { text: candidate.text, classification: "checkpoint", operationalReasons: [] }
  return claimReferences(claim)
}

function isMatchingPreCompletionHandoff(memory: MemoryRecord, references: Set<string>): boolean {
  if (memory.status !== "pending" || memory.kind !== "session_summary" || memory.source !== "session-summary" || memory.revision?.supersededBy) return false
  if (!/\b(?:in progress|awaiting (?:merge|review)|uncommitted|branch|checked out|next (?:turn|step|action))\b/iu.test(memory.text)) return false
  const claim: SummaryClaim = { text: memory.text, classification: "temporary_handoff", operationalReasons: [] }
  return [...claimReferences(claim)].some((reference) => references.has(reference))
}

export type GovernedSessionSummarySaveResults = SaveResult[] & { capture: LifecycleCaptureResult }

function governedCandidateKey(candidate: { kind?: MemoryKind; text: string }): string {
  const normalizedText = candidate.text.toLocaleLowerCase().replace(/\s+/gu, " ").trim()
  return `${candidate.kind ?? "misc"}\u0000${normalizedText}`
}

export function saveSessionSummaryCandidates(engine: MemoryEngine, candidates: SessionEndCandidate[]): GovernedSessionSummarySaveResults {
  const existing = engine.list()
  const originals = new Map<string, SessionEndCandidate[]>()
  for (const candidate of candidates) {
    const key = governedCandidateKey(candidate)
    const matches = originals.get(key) ?? []
    matches.push(candidate)
    originals.set(key, matches)
  }
  const savedOriginals = new Map<string, SessionEndCandidate>()
  const first = candidates[0]
  const input = {
    cwd: engine.getProjectScope()?.cwd ?? process.cwd(),
    sessionId: first?.provenance.sessionId,
    turnId: first?.provenance.turnId,
    lastAssistantMessage: undefined,
  }
  const governed = persistGovernedLifecycleCandidates({
    engine,
    input,
    candidates: candidates.map((candidate): MemoryCandidate => ({
      text: candidate.text,
      category: candidate.category,
      scopeType: candidate.scopeType,
      kind: candidate.kind,
      confidence: 1,
      decision: "save-pending",
      reason: "generated lifecycle session summary",
      source: candidate.source,
    })),
    save(candidate) {
      const original = originals.get(governedCandidateKey(candidate))?.shift()
      if (!original) return { status: "skipped", reason: "metadata unavailable" }
      const result = engine.save({
        text: original.text,
        category: original.category,
        scopeType: original.scopeType,
        status: "pending",
        source: original.source,
        kind: original.kind,
        provenance: original.provenance,
        freshness: original.freshness,
      })
      if (result.status === "saved") savedOriginals.set(result.memory.id, original)
      return result
    },
  })
  const results = Object.assign(governed.saved, { capture: governed.capture })

  for (const result of results) {
    if (result.status !== "saved") continue
    const savedCandidate = savedOriginals.get(result.memory.id)
    const references = savedCandidate ? completedCandidateReferences(savedCandidate) : new Set<string>()
    if (references.size === 0) continue
    const oldIds = existing.filter((memory) => isMatchingPreCompletionHandoff(memory, references)).map((memory) => memory.id)
    if (oldIds.length === 0) continue
    try {
      engine.supersedePendingHandoffs(result.memory.id, oldIds, "Corresponding issue or pull request completed")
    } catch {
      // Lifecycle supersession is best-effort; the new pending checkpoint remains independently reviewable.
    }
  }
  return results
}

/**
 * Generate pending session-summary candidates immediately before host context compaction.
 * This reuses session-end summary hygiene and duplicate filtering while tagging provenance as pre_compact.
 */
export async function handlePreCompact(
  engine: MemoryEngine,
  input: PreCompactInput,
  options: PreCompactOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionEndCandidate[]> {
  return handleSessionEnd(engine, {
    cwd: input.cwd,
    sessionId: input.sessionId,
    transcriptPath: input.transcriptPath,
    messages: input.messages ?? [],
  }, {
    ...options,
    promptTemplate: options.promptTemplate ?? DEFAULT_PRE_COMPACT_PROMPT,
    lifecycleEvent: "pre_compact",
    trigger: options.trigger ?? input.trigger,
    turnId: options.turnId ?? input.turnId,
  }, env)
}
