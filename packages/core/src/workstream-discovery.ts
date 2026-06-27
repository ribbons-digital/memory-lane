import { containsLikelySecret } from "./secret-detection.js"
import type {
  MemoryKind,
  MemoryRecord,
  WorkstreamCandidate,
  WorkstreamDiscoveryIntent,
  WorkstreamDiscoveryResult,
  WorkstreamDiscoveryWarning,
  WorkstreamReferences,
} from "./types.js"

const DEFAULT_PREVIEW_MAX_CHARS = 240
const DEFAULT_MAX_CANDIDATES = 5
const ELIGIBLE_KINDS = new Set<MemoryKind>([
  "project_checkpoint",
  "session_summary",
  "project_fact",
  "decision",
  "correction",
  "procedure",
])
const STRONG_MATCH_KINDS = new Set<MemoryKind>(["correction", "procedure"])
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "building", "by", "current", "did", "do", "for", "from", "how", "i", "in", "is", "it", "item", "latest", "me", "next", "of", "on", "or", "please", "progress", "project", "resume", "should", "show", "slice", "status", "tell", "the", "to", "was", "we", "were", "what", "when", "where", "with", "work", "worked", "working",
])
const KIND_WEIGHT = new Map<MemoryKind, number>([
  ["project_checkpoint", 8],
  ["session_summary", 7],
  ["decision", 5],
  ["project_fact", 4],
  ["correction", 3],
  ["procedure", 3],
])

export interface WorkstreamDiscoveryOptions {
  projectScopeKey?: string
  query: string
  previewMaxChars?: number
  maxCandidates?: number
  referenceNow?: string
}

function compactPreview(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/gu, " ").trim()
  if (normalized.length <= maxChars) return normalized
  if (maxChars <= 1) return "…"
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function tokenize(text: string): string[] {
  return unique((text.toLowerCase().match(/[a-z0-9][a-z0-9._-]{1,}/gu) ?? [])
    .map((token) => token.replace(/^#+/u, ""))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token)))
}

function inferIntent(query: string): WorkstreamDiscoveryIntent {
  const normalized = query.toLowerCase()
  if (/\bwhere\s+(?:are\s+we|things\s+stand)\b/u.test(normalized)) return "status"
  if (/\b(?:status|state|progress|happened|done|accomplished)\b/u.test(normalized)) return "status"
  if (/\b(?:resume|continue|next|pick\s+up)\b/u.test(normalized)) return "resume"
  if (/\b(?:where|implemented|landed|merged|pr|pull request|commit|branch|release)\b/u.test(normalized)) return "lookup"
  return "unknown"
}

function isExpired(memory: MemoryRecord, referenceNow: string): boolean {
  if (!memory.freshness?.expiresAt) return false
  const expiresAt = Date.parse(memory.freshness.expiresAt)
  const now = Date.parse(referenceNow)
  return Number.isFinite(expiresAt) && Number.isFinite(now) && expiresAt <= now
}

function isStale(memory: MemoryRecord, referenceNow: string): boolean {
  if (!memory.freshness?.staleAfterDays) return false
  const anchor = Date.parse(memory.freshness.capturedAt ?? memory.updatedAt)
  const now = Date.parse(referenceNow)
  if (!Number.isFinite(anchor) || !Number.isFinite(now)) return false
  const staleAfterMs = memory.freshness.staleAfterDays * 24 * 60 * 60 * 1000
  return anchor + staleAfterMs <= now
}

function extractReferences(text: string): WorkstreamReferences {
  const pullRequests = unique(text.match(/(?:\bPR\s*#|pull request\s*#|github\.com\/[^\s/]+\/[^\s/]+\/pull\/)(\d+)/giu)?.map((value) => {
    const id = value.match(/(\d+)$/u)?.[1] ?? value.replace(/\D/gu, "")
    return `#${id}`
  }) ?? [])
  const branches = unique(text.match(/\b(?:branch|from branch|on branch)\s+([A-Za-z0-9._/-]+)\b/giu)?.map((value) => value.replace(/^.*?\s+([A-Za-z0-9._/-]+)$/iu, "$1").replace(/[),.;:]+$/u, "")) ?? [])
  const commits = unique(text.match(/\b(?:commit\s+)?[a-f0-9]{7,40}\b/giu)?.map((value) => value.replace(/^commit\s+/iu, "")) ?? [])
  const releases = unique(text.match(/\bv\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?\b/gu) ?? [])
  return { pullRequests, branches, commits, releases }
}

function countReferences(refs: WorkstreamReferences): number {
  return refs.pullRequests.length + refs.branches.length + refs.commits.length + refs.releases.length
}

function scoreMemory(memory: MemoryRecord, topicTerms: string[], intent: WorkstreamDiscoveryIntent, referenceNow: string): { score: number; reasons: string[]; references: WorkstreamReferences; matched: boolean } {
  const text = memory.text.toLowerCase()
  const references = extractReferences(memory.text)
  const reasons: string[] = []
  let positiveReasons = 0
  let score = memory.kind ? KIND_WEIGHT.get(memory.kind) ?? 1 : 1

  for (const term of topicTerms) {
    if (text.includes(term.toLowerCase())) {
      score += 12
      positiveReasons += 1
      reasons.push(`topic:${term}`)
    }
  }

  const refs = countReferences(references)
  if (refs) {
    score += Math.min(8, refs * 2)
    positiveReasons += 1
    reasons.push("references")
  }
  if (intent === "resume" && /\b(?:next action|next step|resume|continue|remaining|todo)\b/iu.test(memory.text)) {
    score += 5
    positiveReasons += 1
    reasons.push("resume-cue")
  }
  if (intent === "lookup" && refs) {
    score += 3
    positiveReasons += 1
    reasons.push("lookup-reference")
  }
  if (intent === "status" && /\b(?:merged|released|completed|validated|implemented|done|landed)\b/iu.test(memory.text)) {
    score += 4
    positiveReasons += 1
    reasons.push("status-cue")
  }
  if (memory.revision?.supersededBy) {
    score -= 30
    reasons.push("superseded-record")
  }
  if (isStale(memory, referenceNow)) {
    score -= 10
    reasons.push("stale-freshness")
  }
  return { score, reasons: unique(reasons), references, matched: positiveReasons > 0 }
}

function compareCandidates(a: WorkstreamCandidate, b: WorkstreamCandidate): number {
  return b.score - a.score || b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
}

export function discoverWorkstreams(memories: MemoryRecord[], options: WorkstreamDiscoveryOptions): WorkstreamDiscoveryResult {
  const query = options.query.trim()
  const projectScope = options.projectScopeKey
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES
  const previewMaxChars = options.previewMaxChars ?? DEFAULT_PREVIEW_MAX_CHARS
  const referenceNow = options.referenceNow ?? new Date().toISOString()
  const intent = inferIntent(query)
  const topicTerms = tokenize(query)
  const warnings: WorkstreamDiscoveryWarning[] = []

  if (!projectScope) {
    warnings.push({ code: "no-project-scope", severity: "warning", message: "No project scope is active; workstream discovery does not broaden to global memories." })
  }
  if (!topicTerms.length) {
    warnings.push({ code: "no-topic", severity: "info", message: "No specific topic terms were detected in the query." })
  }

  const candidates = projectScope
    ? memories
      .filter((memory) => memory.status === "approved")
      .filter((memory) => memory.scope.type === "project" && memory.scope.key === projectScope)
      .filter((memory) => !memory.kind || ELIGIBLE_KINDS.has(memory.kind))
      .filter((memory) => !containsLikelySecret(memory.text))
      .filter((memory) => !isExpired(memory, referenceNow))
      .map((memory) => {
        if (!topicTerms.length) return undefined
        const { score, reasons, references, matched } = scoreMemory(memory, topicTerms, intent, referenceNow)
        if (!matched) return undefined
        if (memory.kind && STRONG_MATCH_KINDS.has(memory.kind) && !reasons.some((reason) => reason.startsWith("topic:"))) return undefined
        const candidate: WorkstreamCandidate = {
          id: memory.id,
          status: "approved",
          category: memory.category,
          scope: memory.scope,
          source: memory.source,
          createdAt: memory.createdAt,
          updatedAt: memory.updatedAt,
          kind: memory.kind,
          provenance: memory.provenance,
          revision: memory.revision,
          preview: compactPreview(memory.text, previewMaxChars),
          score,
          matchReasons: reasons,
          references,
        }
        return candidate
      })
      .filter((candidate): candidate is WorkstreamCandidate => Boolean(candidate))
      .sort(compareCandidates)
    : []

  if (projectScope && topicTerms.length && !candidates.length) {
    warnings.push({ code: "no-matches", severity: "info", message: "No approved current-project continuity memories matched the query." })
  }

  const returned = candidates.slice(0, maxCandidates)
  return {
    projectScope: projectScope ?? "none",
    query,
    intent,
    topicTerms,
    candidates: returned,
    omittedCount: Math.max(0, candidates.length - returned.length),
    warnings,
    suggestedActions: ["memory-lane continuity --json", "memory-lane list --json"],
    notes: [
      "Workstream discovery is read-only and derived from approved current-project memories only.",
      "Candidates are pointers with evidence, not authoritative answers; verify against repository state when available.",
    ],
  }
}
