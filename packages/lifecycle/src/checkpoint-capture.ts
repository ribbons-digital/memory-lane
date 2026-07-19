import { containsLikelySecret, normalizeMemoryText, type MemoryEngine, type MemoryRecord } from "@memory-lane/core"
import { isShellToolName } from "./tool-outcomes.js"
import type { MemoryCandidate, PostToolUseInput, StopInput } from "./types.js"

const MAX_CHECKPOINT_TEXT_CHARS = 280
const MAX_EVIDENCE_CHARS = 2_000

interface CheckpointMatch {
  key: string
  text: string
  reason: string
  confidence: number
}

export interface CheckpointCandidateResolution {
  candidates: MemoryCandidate[]
  revised: MemoryRecord[]
}

export interface CheckpointInspectionOptions {
  preserveUnrepresentedDiscards?: boolean
  seenIdentities?: Set<string>
}

const VERSION_PATTERN = /v?\d+\.\d+\.\d+(?:[-+][\w.]+)?/iu
const MERGE_PATTERN = /\b(?:merged\s+(?:PR|pull request)\s*#?(\d+)|(?:PR|pull request)\s*#?(\d+)\s+(?:(?:was|has\s+been)\s+)?merged)\b/iu
const BARE_MERGE_SUPPRESSION_REASON = "bare merge checkpoint lacks durable project context"
const REJECTED_CHECKPOINT_SUPPRESSION_REASON = "rejected equivalent checkpoint: Memory Lane suppression remains active until explicitly deleted"

function versionWithPrefix(version: string): string {
  return version.toLowerCase().startsWith("v") ? version : `v${version}`
}

function responseStatusCode(response: unknown): number | undefined {
  if (!response || typeof response !== "object") return undefined
  const obj = response as Record<string, unknown>
  for (const key of ["exit_code", "exitCode", "code", "status"]) {
    if (typeof obj[key] === "number") return obj[key] as number
  }
  return undefined
}

function successful(response: unknown): boolean {
  const statusCode = responseStatusCode(response)
  if (statusCode !== undefined) return statusCode === 0
  if (!response || typeof response !== "object") return false

  const obj = response as Record<string, unknown>
  for (const key of ["status", "result", "state"]) {
    if (typeof obj[key] === "string" && /^(?:ok|success|succeeded|passed|completed)$/iu.test(obj[key] as string)) return true
  }
  return false
}

function commandFromInput(input: unknown): string {
  if (typeof input === "string") return input
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>
    for (const key of ["command", "cmd", "script"]) {
      if (typeof obj[key] === "string") return obj[key] as string
    }
  }
  return ""
}

function primitivePreview(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
  return undefined
}

function previewResponse(response: unknown): string {
  const primitive = primitivePreview(response)
  if (primitive !== undefined) return primitive.slice(0, MAX_EVIDENCE_CHARS)
  if (!response || typeof response !== "object") return ""

  const obj = response as Record<string, unknown>
  return [obj.stdout, obj.output, obj.stderr, obj.message, obj.text]
    .map((value) => primitivePreview(value))
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .slice(0, MAX_EVIDENCE_CHARS)
}

function compactWhitespace(text: string): string {
  return text.trim().replace(/\s+/gu, " ")
}

function safeNormalize(text: string): string | undefined {
  const normalized = compactWhitespace(text)
  if (!normalizeMemoryText(normalized) || normalized.length > MAX_CHECKPOINT_TEXT_CHARS || containsLikelySecret(normalized)) return undefined
  return normalized
}

function isQuestion(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.endsWith("?") || /^(?:what|how|why|when|where|who|do|does|did|is|are|has|have|had|was|were|will|would|may|might|can|could|should)\b/iu.test(trimmed)
}

function isFutureOrReminder(text: string): boolean {
  return /\b(?:should|later|eventually|next time|remember to|need to|needs to|todo|plan to|planning to|will release|will merge|going to release|going to merge)\b/iu.test(text)
}

function isRequestWrapper(text: string): boolean {
  return /^(?:please\s+)?(?:confirm|check(?:\s+(?:if|whether))?|verify)\b/iu.test(text.trim())
}

function isAmbiguous(text: string): boolean {
  return isQuestion(text) || isFutureOrReminder(text) || isRequestWrapper(text)
}

function isNegativeCheckpointEvidence(text: string): boolean {
  return /\b(?:failed|failure|errors?|errored|unsuccessful(?:ly)?|aborted?|cancelled|canceled|rollback|reverted|revert)\b|\brolled\s+back\b|\bcould\s+not\b|\bcouldn't\b|\bcannot\b|\bunable\s+to\b|\bdid\s+not\b|\bdidn't\b|\bnot\s+(?:released|merged|published|tagged|successful|completed)\b|\bwas(?:n't|\s+not)\s+(?:successful|completed)\b/iu.test(text)
}

function candidateCheckpointText(text: string): string | undefined {
  const normalized = safeNormalize(text)
  if (!normalized || isAmbiguous(normalized) || isNegativeCheckpointEvidence(normalized)) return undefined
  return normalized
}

function sentenceContainingMatch(text: string, pattern: RegExp): string {
  const match = pattern.exec(text)
  if (!match) return text.trim()

  let sentenceStart = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (!char || !/[.!?]/u.test(char)) continue
    const nextChar = text[index + 1]
    if (nextChar !== undefined && !/\s/u.test(nextChar)) continue

    const sentenceEnd = index + 1
    if (match.index >= sentenceStart && match.index + match[0].length <= sentenceEnd) {
      return text.slice(sentenceStart, sentenceEnd).trim()
    }
    sentenceStart = sentenceEnd
    while (sentenceStart < text.length && /\s/u.test(text[sentenceStart] ?? "")) sentenceStart += 1
  }

  return text.slice(sentenceStart).trim() || text.trim()
}

function keyPhrase(text: string): string {
  return normalizeMemoryText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80)
}

function mergeDurableContextScore(text: string): number {
  if (!MERGE_PATTERN.test(text)) return 0
  const remainder = compactWhitespace(text)
    .replace(MERGE_PATTERN, " ")
    .replace(/^[-*]\s*/u, "")
    .replace(/\b(?:this\s+(?:repo|project|repository)|successfully|after\s+review)\b/giu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
  if (!remainder) return 0

  const words = remainder.split(/\s+/u).filter((word) => word.length > 1)
  const durableConnector = /\b(?:with|to|for|because|implemented?|fixed?|added?|removed?|prevented?|resolved?|enabled?|delivered?|shipped?|verified?|tests?|coverage|decision|invariant|outcome|next|continue)\b/iu.test(remainder)
  return durableConnector && words.length >= 2 ? words.length : 0
}

function checkpointCandidate(match: CheckpointMatch): MemoryCandidate[] {
  const normalized = candidateCheckpointText(match.text)
  if (!normalized) return []
  const bareMerge = match.key.startsWith("merge:") && mergeDurableContextScore(normalized) === 0

  return [{
    text: normalized,
    category: "project",
    scopeType: "project",
    kind: "project_checkpoint",
    confidence: match.confidence,
    decision: bareMerge ? "discard" : "save-pending",
    reason: bareMerge ? BARE_MERGE_SUPPRESSION_REASON : match.reason,
    source: "agent-suggested",
  }]
}

function releaseMatchFromText(text: string): CheckpointMatch | undefined {
  const releasePattern = new RegExp(`\\b(?:released|tagged|published)\\s+(${VERSION_PATTERN.source})\\b`, "iu")
  const match = releasePattern.exec(text)
  if (!match?.[1]) return undefined
  const sentence = sentenceContainingMatch(text, releasePattern)
  const version = versionWithPrefix(match[1])
  return {
    key: `release:${version}`,
    text: sentence,
    reason: "explicit release progress statement",
    confidence: 0.9,
  }
}

function mergeMatchFromText(text: string): CheckpointMatch | undefined {
  const match = MERGE_PATTERN.exec(text)
  const prNumber = match?.[1] ?? match?.[2]
  if (!prNumber) return undefined
  return {
    key: `merge:pr-${prNumber}`,
    text: sentenceContainingMatch(text, MERGE_PATTERN),
    reason: "explicit merged pull request progress statement",
    confidence: 0.9,
  }
}

function verificationMatchFromText(text: string): CheckpointMatch | undefined {
  const verificationPattern = /\b(?:(?:tests?|build|verification|release workflow)\s+(?:passed|verified)|verified\b(?=[^.]*\b(?:tests?|build|release workflow)\b)|(?:tests?|build|diff-check)\s+all\s+passed)\b/iu
  if (!verificationPattern.test(text)) return undefined
  return {
    key: `verification:${keyPhrase(sentenceContainingMatch(text, verificationPattern))}`,
    text: sentenceContainingMatch(text, verificationPattern),
    reason: "explicit verification milestone statement",
    confidence: 0.84,
  }
}

function docsSyncMatchFromText(text: string): CheckpointMatch | undefined {
  const docsPattern = /\b(?:updated\s+(?:ROADMAP(?:\.md)?|HANDOFF(?:\.md)?|README(?:\.md)?)|docs?\s+synced|documentation\s+synced)\b/iu
  if (!docsPattern.test(text)) return undefined
  return {
    key: `docs-sync:${keyPhrase(sentenceContainingMatch(text, docsPattern))}`,
    text: sentenceContainingMatch(text, docsPattern),
    reason: "explicit documentation sync statement",
    confidence: 0.82,
  }
}

function roadmapDecisionMatchFromText(text: string): CheckpointMatch | undefined {
  const roadmapPattern = /\b(?:roadmap\s+decision|decided\s+next\s+phase|phase\s+\d+\s+starts\s+with)\b/iu
  if (!roadmapPattern.test(text)) return undefined
  return {
    key: `roadmap-decision:${keyPhrase(sentenceContainingMatch(text, roadmapPattern))}`,
    text: sentenceContainingMatch(text, roadmapPattern),
    reason: "explicit roadmap decision statement",
    confidence: 0.82,
  }
}

function majorFixMatchFromText(text: string): CheckpointMatch | undefined {
  const fixPattern = /\b(?:fixed\s+(?:critical|blocker)|major\s+fix)\b/iu
  if (!fixPattern.test(text)) return undefined
  return {
    key: `major-fix:${keyPhrase(sentenceContainingMatch(text, fixPattern))}`,
    text: sentenceContainingMatch(text, fixPattern),
    reason: "explicit major fix statement",
    confidence: 0.82,
  }
}

function matchCheckpointText(text: string): CheckpointMatch | undefined {
  const normalized = compactWhitespace(text)
  if (!normalizeMemoryText(normalized) || containsLikelySecret(normalized) || isNegativeCheckpointEvidence(normalized)) return undefined

  const match = releaseMatchFromText(normalized)
    ?? mergeMatchFromText(normalized)
    ?? verificationMatchFromText(normalized)
    ?? docsSyncMatchFromText(normalized)
    ?? roadmapDecisionMatchFromText(normalized)
    ?? majorFixMatchFromText(normalized)
  if (!match) return undefined

  const candidateText = candidateCheckpointText(match.text)
  return candidateText ? { ...match, text: candidateText } : undefined
}

function releaseMatchFromToolEvidence(command: string, preview: string): CheckpointMatch | undefined {
  const commandMatch = /\bgh\s+release\s+create\s+(v?\d+\.\d+\.\d+(?:[-+][\w.]+)?)/iu.exec(command)
    ?? /\bgit\s+tag\s+(?:-a\s+|-s\s+)?(v?\d+\.\d+\.\d+(?:[-+][\w.]+)?)/iu.exec(command)
  const previewMatch = /\/releases\/tag\/(v?\d+\.\d+\.\d+(?:[-+][\w.]+)?)/iu.exec(preview)
    ?? /\b(?:released|created release|tagged)\s+(v?\d+\.\d+\.\d+(?:[-+][\w.]+)?)/iu.exec(preview)
  const version = commandMatch?.[1] ?? previewMatch?.[1]
  if (!version) return undefined
  const normalizedVersion = versionWithPrefix(version)
  return {
    key: `release:${normalizedVersion}`,
    text: `Released ${normalizedVersion}.`,
    reason: "successful release command",
    confidence: 0.93,
  }
}

function mergeMatchFromToolEvidence(command: string, preview: string): CheckpointMatch | undefined {
  const commandMatch = /\bgh\s+pr\s+merge\s+(\d+)\b/iu.exec(command)
  const previewMatch = /\bmerged\s+(?:pull request|PR)\s+#?(\d+)\b/iu.exec(preview)
    ?? /\/pull\/(\d+)\b/iu.exec(preview)
  const prNumber = commandMatch?.[1] ?? previewMatch?.[1]
  if (!prNumber) return undefined
  return {
    key: `merge:pr-${prNumber}`,
    text: `Merged PR #${prNumber}.`,
    reason: "successful pull request merge command",
    confidence: 0.93,
  }
}

export function checkpointKeysFromText(text: string): string[] {
  const normalized = compactWhitespace(text)
  if (!normalizeMemoryText(normalized) || containsLikelySecret(normalized) || isNegativeCheckpointEvidence(normalized)) return []

  const matches = [
    releaseMatchFromText(normalized),
    mergeMatchFromText(normalized),
    verificationMatchFromText(normalized),
    docsSyncMatchFromText(normalized),
    roadmapDecisionMatchFromText(normalized),
    majorFixMatchFromText(normalized),
  ]
  return [...new Set(matches.map((match) => match?.key).filter((key): key is string => Boolean(key)))]
}

export function checkpointKeyFromText(text: string): string | undefined {
  return checkpointKeysFromText(text)[0]
}

export function checkpointIdentityFromText(projectScope: string, text: string): string | undefined {
  const key = checkpointKeyFromText(text)
  return key ? `${projectScope}:${key}` : undefined
}

function checkpointIdentitiesFromText(scopeIdentity: string, text: string): string[] {
  return checkpointKeysFromText(text).map((key) => `${scopeIdentity}:${key}`)
}

function candidateScopeIdentity(candidate: MemoryCandidate, projectScope?: string): string {
  return candidate.scopeType === "global" ? "global" : projectScope ?? "global"
}

function splitCompoundCheckpointCandidate(candidate: MemoryCandidate): MemoryCandidate[] {
  if (candidate.decision === "discard" || checkpointKeysFromText(candidate.text).length <= 1) return [candidate]
  const parts = candidate.text
    .split(/\s+(?:and|but)\s+(?=(?:released|tagged|published|merged)\b|(?:PR|pull request)\s*#?\d+\s+(?:(?:was|has\s+been)\s+)?merged\b)/iu)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length <= 1) return [candidate]

  const split = parts.flatMap((text) => {
    const match = matchCheckpointText(text)
    const derived = match ? checkpointCandidate(match)[0] : undefined
    if (!derived) return []
    return [{
      ...derived,
      category: candidate.category,
      scopeType: candidate.scopeType,
      source: candidate.source,
      decision: derived.decision === "discard" ? "discard" : candidate.decision,
    }]
  })
  return split.length > 0 ? split : [candidate]
}

export function extractCheckpointCandidatesFromStop(input: StopInput): MemoryCandidate[] {
  const messages = [input.lastAssistantMessage, input.lastUserMessage]
    .map((message) => message?.trim() ?? "")
    .filter(Boolean)

  for (const text of messages) {
    const match = matchCheckpointText(text)
    const candidates = match ? checkpointCandidate(match) : []
    if (candidates.length > 0) return candidates
  }

  return []
}

export function extractCheckpointCandidatesFromPostToolUse(input: PostToolUseInput): MemoryCandidate[] {
  if (!isShellToolName(input.toolName) || !successful(input.toolResponse)) return []

  const command = commandFromInput(input.toolInput).trim()
  const preview = previewResponse(input.toolResponse)
  if (!command || containsLikelySecret(command) || containsLikelySecret(preview)) return []

  const match = releaseMatchFromToolEvidence(command, preview) ?? mergeMatchFromToolEvidence(command, preview)
  return match ? checkpointCandidate(match) : []
}

function visibleInCurrentProject(memory: MemoryRecord, projectScope?: string): boolean {
  if (memory.scope.type === "global") return true
  return Boolean(projectScope) && (memory.scope.key === projectScope || memory.project?.key === projectScope || memory.project?.root === projectScope)
}

function scopeIdentityForMemory(memory: MemoryRecord): string | undefined {
  if (memory.scope.type === "global") return "global"
  return memory.scope.key ?? memory.project?.key ?? memory.project?.root
}

function checkpointIdentitiesForMemory(memory: MemoryRecord): string[] {
  const scope = scopeIdentityForMemory(memory)
  return scope ? checkpointIdentitiesFromText(scope, memory.text) : []
}

function inspectOrResolveCheckpointCandidates(
  engine: MemoryEngine,
  candidates: MemoryCandidate[],
  options: { coalesce: boolean; preserveUnrepresentedDiscards?: boolean; seenIdentities?: Set<string> },
): CheckpointCandidateResolution {
  const projectScope = engine.getProjectScope()?.key
  const existingByIdentity = new Map<string, MemoryRecord[]>()
  for (const memory of engine.list({ all: true })) {
    if (memory.status !== "pending" && memory.status !== "approved" && memory.status !== "rejected") continue
    if (!visibleInCurrentProject(memory, projectScope)) continue
    for (const identity of checkpointIdentitiesForMemory(memory)) {
      const existing = existingByIdentity.get(identity) ?? []
      existing.push(memory)
      existingByIdentity.set(identity, existing)
    }
  }

  const seen = options.seenIdentities ?? new Set<string>()
  const resolved: MemoryCandidate[] = []
  const revised: MemoryRecord[] = []
  for (const candidate of candidates.flatMap(splitCompoundCheckpointCandidate)) {
    const scopeIdentity = candidateScopeIdentity(candidate, projectScope)
    const identities = checkpointIdentitiesFromText(scopeIdentity, candidate.text)
    if (identities.length === 0) {
      resolved.push(candidate)
      continue
    }
    if (identities.every((identity) => seen.has(identity))) continue
    for (const identity of identities) seen.add(identity)

    const existing = [...new Map(
      identities.flatMap((identity) => existingByIdentity.get(identity) ?? []).map((memory) => [memory.id, memory]),
    ).values()]
    if (candidate.decision === "discard") {
      if (existing.some((memory) => memory.status === "rejected")) {
        resolved.push({ ...candidate, reason: REJECTED_CHECKPOINT_SUPPRESSION_REASON })
      } else if (options.preserveUnrepresentedDiscards && existing.length === 0) {
        resolved.push({ ...candidate, decision: "save-pending" })
      } else {
        resolved.push(candidate)
      }
      continue
    }

    const representedIdentities = new Set(existing.flatMap((memory) => checkpointIdentitiesForMemory(memory)))
    if (identities.some((identity) => !representedIdentities.has(identity))) {
      resolved.push(candidate)
      continue
    }
    if (existing.some((memory) => memory.status === "rejected")) {
      resolved.push({ ...candidate, decision: "discard", reason: REJECTED_CHECKPOINT_SUPPRESSION_REASON })
      continue
    }

    const active = existing.filter((memory) => memory.status === "pending" || memory.status === "approved")
    const provisional = active.find((memory) =>
      memory.status === "pending" &&
      memory.kind === "project_checkpoint" &&
      mergeDurableContextScore(candidate.text) > mergeDurableContextScore(memory.text),
    )
    if (provisional) {
      if (options.coalesce) {
        try {
          const updated = engine.update(provisional.id, { text: candidate.text }, { actor: "lifecycle" })
          if (updated) revised.push(updated)
        } catch {
          // Coalescing is best-effort. The existing canonical checkpoint still suppresses a duplicate.
        }
      }
      continue
    }
    if (active.length > 0) continue

    resolved.push(candidate)
  }

  return { candidates: resolved, revised }
}

export function inspectCheckpointCandidates(
  engine: MemoryEngine,
  candidates: MemoryCandidate[],
  options: CheckpointInspectionOptions = {},
): CheckpointCandidateResolution {
  return inspectOrResolveCheckpointCandidates(engine, candidates, { coalesce: false, ...options })
}

export function resolveCheckpointCandidates(engine: MemoryEngine, candidates: MemoryCandidate[]): CheckpointCandidateResolution {
  return inspectOrResolveCheckpointCandidates(engine, candidates, { coalesce: true })
}

export function filterDuplicateCheckpointCandidates(engine: MemoryEngine, candidates: MemoryCandidate[]): MemoryCandidate[] {
  return inspectCheckpointCandidates(engine, candidates).candidates.filter((candidate) => candidate.decision !== "discard")
}
