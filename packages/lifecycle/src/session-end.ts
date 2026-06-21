import { containsLikelySecret, normalizeMemoryText, type MemoryEngine, type MemoryRecord } from "@memory-lane/core"
import { createOpenAICompatibleProvider } from "./llm-provider.js"
import type { LLMProvider, SessionEndInput, SessionEndOptions } from "./types.js"

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

function sessionSummaryProvenanceKey(input: { adapter?: string; sessionId?: string; lifecycleEvent?: string }): string | undefined {
  const sessionId = input.sessionId?.trim()
  if (!sessionId || input.lifecycleEvent !== "session_end") return undefined
  return `${input.adapter ?? "unknown"}:session_end:${sessionId}`
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
    })
    if (provenanceKey) provenance.add(provenanceKey)

    const contentKey = sessionSummaryContentKey(memory.text)
    if (contentKey) content.add(contentKey)
  }

  return { provenance, content }
}

function filterDuplicateSessionSummaries(engine: MemoryEngine, candidates: SessionEndCandidate[]): SessionEndCandidate[] {
  const existing = existingSessionSummaryKeys(engine)
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

function resolveProvider(options: SessionEndOptions, env: NodeJS.ProcessEnv): LLMProvider | undefined {
  if (options.provider) return options.provider
  if (options.providerConfig) return createOpenAICompatibleProvider(options.providerConfig, env)
  return undefined
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
    lifecycleEvent: "session_end"
    sessionId?: string
  }
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

  const transcript = renderTranscript(input.messages, options.includeToolOutputs ?? false)
  if (!transcript.trim()) return []

  const prompt = createPrompt(options.promptTemplate ?? DEFAULT_SESSION_END_PROMPT, transcript)
  const raw = await provider.complete(prompt, { maxTokens: options.maxTokens })

  if (/^NO_DURABLE_MEMORY[.\s]*$/iu.test(raw.trim())) return []

  const cleaned = cleanGeneratedSummary(raw)
  if (!sessionSummaryContentKey(cleaned)) return []

  const heading = `## Session Summary (${new Date().toISOString().slice(0, 10)})`
  const text = [heading, "", cleaned].join("\n")

  return filterDuplicateSessionSummaries(engine, [{
    text,
    category: "project",
    scopeType: scope ? "project" : "global",
    kind: "session_summary",
    status: "pending",
    source: "session-summary",
    provenance: {
      adapter: options.adapter ?? options.providerConfig?.provider ?? "manual",
      lifecycleEvent: "session_end",
      sessionId: input.sessionId,
    },
  }])
}
