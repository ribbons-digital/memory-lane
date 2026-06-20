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

const VERSION_PATTERN = /v?\d+\.\d+\.\d+(?:[-+][\w.]+)?/iu

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

function safeNormalize(text: string): string | undefined {
  const normalized = text.trim().replace(/\s+/gu, " ")
  if (!normalizeMemoryText(normalized) || normalized.length > MAX_CHECKPOINT_TEXT_CHARS || containsLikelySecret(normalized)) return undefined
  return normalized
}

function isQuestion(text: string): boolean {
  return /^(?:what|how|why|when|where|who|do|does|did|is|are|can|could|should)\b/iu.test(text.trim())
}

function isFutureOrReminder(text: string): boolean {
  return /\b(?:should|later|eventually|next time|remember to|need to|needs to|todo|plan to|planning to|will release|will merge|going to release|going to merge)\b/iu.test(text)
}

function isAmbiguous(text: string): boolean {
  return isQuestion(text) || isFutureOrReminder(text)
}

function sentenceContainingMatch(text: string, pattern: RegExp): string {
  const sentences = text.match(/[^.!?]+[.!?]?/gu) ?? [text]
  return sentences.find((sentence) => pattern.test(sentence))?.trim() ?? text.trim()
}

function keyPhrase(text: string): string {
  return normalizeMemoryText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80)
}

function checkpointCandidate(match: CheckpointMatch): MemoryCandidate[] {
  const normalized = safeNormalize(match.text)
  if (!normalized || isAmbiguous(normalized)) return []

  return [{
    text: normalized,
    category: "project",
    scopeType: "project",
    kind: "project_checkpoint",
    confidence: match.confidence,
    decision: "save-pending",
    reason: match.reason,
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
  const mergePattern = /\b(?:merged\s+(?:PR|pull request)\s*#?(\d+)|(?:PR|pull request)\s*#?(\d+)\s+merged)\b/iu
  const match = mergePattern.exec(text)
  const prNumber = match?.[1] ?? match?.[2]
  if (!prNumber) return undefined
  return {
    key: `merge:pr-${prNumber}`,
    text: sentenceContainingMatch(text, mergePattern),
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
  const normalized = safeNormalize(text)
  if (!normalized || isAmbiguous(normalized)) return undefined
  return releaseMatchFromText(normalized)
    ?? mergeMatchFromText(normalized)
    ?? verificationMatchFromText(normalized)
    ?? docsSyncMatchFromText(normalized)
    ?? roadmapDecisionMatchFromText(normalized)
    ?? majorFixMatchFromText(normalized)
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

export function checkpointKeyFromText(text: string): string | undefined {
  const match = matchCheckpointText(text)
  if (match) return match.key

  const normalized = safeNormalize(text)
  if (!normalized) return undefined
  const lower = normalized.toLowerCase()
  const release = /\b(?:released|tagged|published)\s+(v?\d+\.\d+\.\d+(?:[-+][\w.]+)?)/iu.exec(lower)
  if (release?.[1]) return `release:${versionWithPrefix(release[1])}`
  const merge = /\b(?:merged\s+(?:pr|pull request)\s*#?(\d+)|(?:pr|pull request)\s*#?(\d+)\s+merged)\b/iu.exec(lower)
  const prNumber = merge?.[1] ?? merge?.[2]
  if (prNumber) return `merge:pr-${prNumber}`
  return undefined
}

export function extractCheckpointCandidatesFromStop(input: StopInput): MemoryCandidate[] {
  const text = input.lastUserMessage?.trim() ?? input.lastAssistantMessage?.trim() ?? ""
  if (!text) return []
  const match = matchCheckpointText(text)
  return match ? checkpointCandidate(match) : []
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

export function filterDuplicateCheckpointCandidates(engine: MemoryEngine, candidates: MemoryCandidate[]): MemoryCandidate[] {
  const projectScope = engine.getProjectScope()?.key
  const existingKeys = new Set(
    engine.list({ all: true })
      .filter((memory) => (memory.status === "pending" || memory.status === "approved") && visibleInCurrentProject(memory, projectScope))
      .filter((memory) => memory.kind === "project_checkpoint")
      .map((memory) => checkpointKeyFromText(memory.text))
      .filter((key): key is string => Boolean(key)),
  )

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = checkpointKeyFromText(candidate.text)
    if (!key) return true
    if (existingKeys.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
