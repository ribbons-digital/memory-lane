import { containsLikelySecret, isMetaTaskPromptText, normalizeMemoryText, parseExplicitMemoryRequest, type MemoryEngine, type MemoryRecord } from "@memory-lane/core"
import type { MemoryCandidate, StopInput } from "./types.js"

const CORRECTION_SIGNALS = /\b(?:you\s+(?:forgot|violated|skipped|ignored|missed|broke|didn'?t\s+follow|failed\s+to\s+follow)|don'?t\s+(?:merge|start|proceed|continue|delete|cleanup)|do\s+not\s+(?:merge|start|proceed|continue|delete|cleanup)|should\s+(?:not|have)|we\s+(?:already\s+)?agreed|remember,?\s+(?:wait|do\s+not|don'?t)|must\s+(?:wait|not)|need\s+to\s+(?:wait|ask|review|open))\b/iu

const WORKFLOW_TARGETS = /\b(?:pr|pull\s+request|merge|merged|main|branch|worktree|cleanup|delete\s+(?:local|remote|branch)|spec|design|plan|approval|approve|review\s+gate|review|verification|verify|tests?|build|diff-check|roadmap|phase|next\s+item|release|tag|workflow|process|procedure|guardrail|operating\s+agreement)\b/iu

const FACTUAL_CORRECTION_ONLY = /\b(?:date|name|package\s+name|version|number|spelling|typo|wrong\s+file|wrong\s+path)\b/iu

const EXPLICIT_PREFERENCE = /\b(?:i\s+prefer|my\s+preference|remember\s+that\s+i|remember\s+that\s+my|save\s+this\s+preference)\b/iu

function normalizedKey(text: string): string {
  return normalizeMemoryText(text).toLowerCase().replace(/\s+/gu, " ").trim()
}

export function correctionKeyFromText(text: string): string | undefined {
  const normalized = normalizedKey(text)
  if (!normalized) return undefined

  if (/\bpr|pull\s+request|merge|main|branch|worktree|cleanup|delete\b/iu.test(normalized)) return "pr-protected-workflow"
  if (/\bspec|design|plan|approval|approve|review\s+gate|review\b/iu.test(normalized)) return "review-gate"
  if (/\bverification|verify|tests?|build|diff-check\b/iu.test(normalized)) return "verification-before-completion"
  if (/\broadmap|phase|next\s+item\b/iu.test(normalized)) return "phase-approval"
  if (/\brelease|tag\b/iu.test(normalized)) return "release-process"
  if (/\bworkflow|process|procedure|guardrail|operating\s+agreement\b/iu.test(normalized)) return normalized
  return undefined
}

function correctionText(userMessage: string): string {
  const normalized = normalizeMemoryText(userMessage).replace(/\s+/gu, " ").trim()
  if (/\bpr|pull\s+request|merge|main|branch|worktree|cleanup|delete\b/iu.test(normalized)) {
    return "Workflow correction: When working in this project, follow the PR-protected workflow: open a PR and wait for the user to merge before syncing main, deleting branches or worktrees, or starting the next item."
  }
  if (/\bspec|design|plan|approval|approve|review\s+gate|review\b/iu.test(normalized)) {
    return "Workflow correction: The user corrected the agent for skipping an agreed review gate; future work should pause for explicit user approval before continuing past that gate."
  }
  if (/\bverification|verify|tests?|build|diff-check\b/iu.test(normalized)) {
    return "Workflow correction: The user corrected the agent for skipping verification; future work should run and report the required verification before claiming completion."
  }
  if (/\broadmap|phase|next\s+item\b/iu.test(normalized)) {
    return "Workflow correction: The user corrected the agent for proceeding too far; future work should wait for explicit user approval before starting the next roadmap phase or item."
  }
  if (/\brelease|tag\b/iu.test(normalized)) {
    return "Workflow correction: The user corrected the agent about release process; future release work should follow the approved project release workflow and wait at review gates."
  }
  return "Workflow correction: The user corrected the agent for skipping an agreed workflow or process; future work should pause and follow the established project operating agreement before continuing."
}

function isCorrectionCandidateText(userMessage: string): boolean {
  const normalized = normalizeMemoryText(userMessage).trim()
  if (!normalized) return false
  if (containsLikelySecret(normalized)) return false
  if (isMetaTaskPromptText(normalized)) return false
  if (parseExplicitMemoryRequest(normalized)) return false
  if (EXPLICIT_PREFERENCE.test(normalized)) return false
  if (!CORRECTION_SIGNALS.test(normalized)) return false
  if (!WORKFLOW_TARGETS.test(normalized)) return false
  if (FACTUAL_CORRECTION_ONLY.test(normalized) && !WORKFLOW_TARGETS.test(normalized)) return false
  return true
}

export function extractCorrectionCandidatesFromStop(input: StopInput): MemoryCandidate[] {
  const userMessage = input.lastUserMessage?.trim() ?? ""
  if (!isCorrectionCandidateText(userMessage)) return []

  return [{
    text: correctionText(userMessage),
    category: "project",
    scopeType: "project",
    kind: "correction",
    confidence: 0.9,
    decision: "save-pending",
    reason: "explicit workflow correction",
    source: "agent-suggested",
  }]
}

function memoryProjectKey(memory: MemoryRecord): string | undefined {
  return memory.scope.key ?? memory.project?.key ?? memory.project?.root
}

function visibleProjectCorrection(memory: MemoryRecord, projectScopeKey?: string): boolean {
  if (memory.status !== "pending" && memory.status !== "approved") return false
  if (memory.scope.type !== "project") return false
  if (!projectScopeKey || memoryProjectKey(memory) !== projectScopeKey) return false
  return memory.kind === "correction" || memory.kind === "procedure" || memory.kind === "workflow_rule"
}

export function filterDuplicateCorrectionCandidates(engine: MemoryEngine, candidates: MemoryCandidate[]): MemoryCandidate[] {
  const projectScopeKey = engine.getProjectScope()?.key
  const existingKeys = new Set(
    engine.list()
      .filter((memory) => visibleProjectCorrection(memory, projectScopeKey))
      .map((memory) => correctionKeyFromText(memory.text))
      .filter((key): key is string => Boolean(key)),
  )
  const seen = new Set<string>()
  const result: MemoryCandidate[] = []

  for (const candidate of candidates) {
    const key = correctionKeyFromText(candidate.text)
    if (!key || existingKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }

  return result
}

export function filterSameTurnCorrectionCandidates(existingCandidates: MemoryCandidate[], correctionCandidates: MemoryCandidate[]): MemoryCandidate[] {
  const explicitKeys = new Set(
    existingCandidates
      .filter((candidate) => candidate.source === "user-suggested")
      .map((candidate) => correctionKeyFromText(candidate.text))
      .filter((key): key is string => Boolean(key)),
  )
  if (explicitKeys.size === 0) return correctionCandidates
  return correctionCandidates.filter((candidate) => {
    const key = correctionKeyFromText(candidate.text)
    return !key || !explicitKeys.has(key)
  })
}
