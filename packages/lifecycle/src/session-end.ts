import { createHash } from "node:crypto"
import { analyzeSummaryHygiene, containsLikelySecret, normalizeMemoryText, type MemoryEngine, type MemoryFreshness, type MemoryLifecycleEvent, type MemoryRecord } from "@memory-lane/core"
import { createOpenAICompatibleProvider } from "./llm-provider.js"
import type { LLMProvider, PreCompactInput, PreCompactOptions, SessionEndInput, SessionEndOptions } from "./types.js"

export const DEFAULT_SESSION_END_PROMPT = `You are summarizing an AI-assisted coding session for a memory system.
Read the session transcript and produce a concise, structured summary.

Include only these sections if they have content:
- Decisions made
- Blockers or failures
- Open questions
- Next steps
- Key facts about the project, codebase, or user preferences

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
- Blockers or failures
- Open questions
- Next steps
- Key facts about the project, codebase, or user preferences

Rules:
- Focus on information needed to continue after compaction.
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

function sessionSummaryContentKey(text: string): string | undefined {
  const stripped = cleanGeneratedSummary(stripSessionSummaryHeading(text))
  const normalized = normalizeMemoryText(stripped).toLowerCase().replace(/\s+/gu, " ").trim()
  return normalized || undefined
}

function sessionSummaryProvenanceKey(input: { adapter?: string; sessionId?: string; turnId?: string; lifecycleEvent?: string }): string | undefined {
  const lifecycleEvent = input.lifecycleEvent
  if (lifecycleEvent !== "session_end" && lifecycleEvent !== "pre_compact") return undefined

  const sessionId = input.sessionId?.trim()
  if (!sessionId) return undefined

  const parts = [input.adapter ?? "unknown", lifecycleEvent, sessionId]
  if (lifecycleEvent === "pre_compact") parts.push(input.turnId?.trim() || "unknown-turn")
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
    if (memory.kind !== "session_summary") continue
    if (memory.status !== "pending" && memory.status !== "approved") continue
    if (!visibleInCurrentScope(memory, projectScopeKey)) continue

    const provenanceKey = sessionSummaryProvenanceKey({
      adapter: memory.provenance?.adapter,
      lifecycleEvent: memory.provenance?.lifecycleEvent,
      sessionId: memory.provenance?.sessionId,
      turnId: memory.provenance?.turnId,
    })
    if (provenanceKey) provenance.add(provenanceKey)

    const contentKey = sessionSummaryContentKey(memory.text)
    if (contentKey) content.add(contentKey)
  }

  return { provenance, content }
}

function hasSessionSummaryProvenance(existing: { provenance: Set<string> }, provenance: { adapter?: string; sessionId?: string; turnId?: string; lifecycleEvent?: string }): boolean {
  const provenanceKey = sessionSummaryProvenanceKey(provenance)
  return Boolean(provenanceKey && existing.provenance.has(provenanceKey))
}

export function hasExistingSessionSummaryProvenance(engine: MemoryEngine, provenance: { adapter?: string; sessionId?: string; turnId?: string; lifecycleEvent?: string }): boolean {
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
  kind: "session_summary"
  status: "pending"
  source: "session-summary"
  provenance: {
    adapter: string
    lifecycleEvent: MemoryLifecycleEvent
    sessionId?: string
    turnId?: string
  }
  freshness?: MemoryFreshness
}

export async function handleSessionEnd(
  engine: MemoryEngine,
  input: SessionEndInput,
  options: SessionEndOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionEndCandidate[]> {
  engine.refreshScope(input.cwd)
  const scope = engine.getProjectScope()

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

  const cleaned = cleanGeneratedSummary(raw)
  if (!sessionSummaryContentKey(cleaned)) return []
  const hygiene = analyzeSummaryHygiene(cleaned, { kind: "session_summary", source: "session-summary" })
  if (hygiene.action === "suppress") return []

  const heading = `## Session Summary (${new Date().toISOString().slice(0, 10)})`
  const text = [heading, "", cleaned].join("\n")
  const capturedAt = latestMessageTimestamp(input.messages)

  return filterDuplicateSessionSummariesWithExisting(existingSummaries, [{
    text,
    category: "project",
    scopeType: scope ? "project" : "global",
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
