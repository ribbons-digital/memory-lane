import { containsLikelySecret, isMetaTaskPromptText, normalizeMemoryText, parseExplicitMemoryRequest, type MemoryEngine, type MemoryRecord } from "@memory-lane/core"
import type { MemoryCandidate, StopInput } from "./types.js"

const MAX_POSTMORTEM_TEXT_CHARS = 700

const USER_CHALLENGE_SIGNALS = /\b(?:you\s+(?:missed|forgot|skipped|ignored|assumed|broke|failed)|we\s+already\s+learned|don'?t\s+rely|do\s+not\s+rely|not\s+just\s+pi|future\s+adapters|actual\s+guardrail|reviewer\s+inspection\s+was\s+not\s+enough)\b/iu
const SYMPTOM_SIGNALS = /\b(?:failed|failure|crash(?:ed)?|bug|regression|broke|didn'?t\s+work|issue|problem|error|exited|violated|missed|skipped|incorrect|wrong|stale|mismatch|different\s+behavior)\b/iu
const CAUSE_SIGNALS = /\b(?:root\s+cause|because|caused\s+by|turned\s+out|reason|mistaken\s+assumption|assumed|missing|stale|unsupported|wrong|mismatch|violat(?:ed|ing).{0,80}contract|expected.{0,80}but|different\s+behavior)\b/iu
const PREVENTION_SIGNALS = /\b(?:future|next\s+time|should|must|need\s+to|avoid|guardrail|contract\s+tests?|dogfood|verify|before\s+release|do\s+not\s+rely|don'?t\s+rely)\b/iu
const VERIFICATION_SIGNALS = /\b(?:verified|verify|passed|passes|dogfood(?:ed)?|smoke(?:-tested|\s+tested|\s+loaded)?|confirmed|tests?\s+added|reproduced|fixed\s+by|validated)\b/iu

function compactText(...parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => normalizeMemoryText(part).replace(/\s+/gu, " ").trim())
    .join(" ")
    .slice(0, MAX_POSTMORTEM_TEXT_CHARS)
}

function safeInput(text: string): boolean {
  if (!text.trim()) return true
  if (containsLikelySecret(text)) return false
  if (isMetaTaskPromptText(text)) return false
  return true
}

function isExplicitMemoryRequest(text: string): boolean {
  return Boolean(text.trim() && parseExplicitMemoryRequest(text))
}

function evidence(text: string): { symptom: boolean; cause: boolean; prevention: boolean; verification: boolean; userChallenge: boolean } {
  return {
    symptom: SYMPTOM_SIGNALS.test(text),
    cause: CAUSE_SIGNALS.test(text),
    prevention: PREVENTION_SIGNALS.test(text),
    verification: VERIFICATION_SIGNALS.test(text),
    userChallenge: USER_CHALLENGE_SIGNALS.test(text),
  }
}

function shouldCapture(combined: ReturnType<typeof evidence>, assistantEvidence: ReturnType<typeof evidence>): boolean {
  if (combined.symptom && combined.cause && combined.prevention && combined.verification) return true
  return combined.userChallenge && assistantEvidence.cause && assistantEvidence.prevention && combined.symptom
}

function generatedAdapterProcedure(): string {
  return "Procedure: Dogfood generated harness adapter changes through the installed artifact before release. When: changing generated harness adapters or templates. Steps: add contract tests for generated lifecycle branches; compare generated behavior with repo-local adapters when both exist; run installed-artifact dogfood. Pitfall: reviewer inspection or load-smoke tests can miss host API shape regressions. Verify: the installed artifact exercised the lifecycle event users trigger."
}

function adapterReturnShapeProcedure(): string {
  return "Procedure: Verify generated harness adapter return shapes with executable contract tests and installed-artifact dogfood. When: changing generated harness adapters or templates. Steps: invoke each generated lifecycle branch with realistic fake harness inputs; assert host API return shape; compare generated behavior with repo-local adapter behavior when both exist; dogfood the installed artifact through the user-triggered lifecycle event. Pitfall: load-smoke tests and reviewer inspection can miss host API shape regressions. Verify: the installed artifact exercises the lifecycle event without crashing."
}

function upgradeReapplyProcedure(): string {
  return "Procedure: Reapply harness configuration through the freshly installed binary after self-upgrade. When: changing installer or upgrade reconfiguration behavior. Steps: replace the binary; invoke the new binary for manifest reapply; smoke the generated harness artifact. Pitfall: the old in-memory process can rewrite stale adapter templates after replacement. Verify: the generated artifact contains the new bridge behavior after upgrade."
}

function genericCorrection(): string {
  return "Workflow correction: The agent learned from a debugging postmortem that durable project failures should become reviewable prevention rules; future work should capture only concrete symptom, cause, prevention, and verification evidence as pending correction or procedure memories."
}

function candidateText(combinedText: string): { text: string; kind: MemoryCandidate["kind"] } {
  const normalized = combinedText.toLowerCase()
  if (/self-upgrade|reapply|freshly installed binary|stale in-memory/u.test(normalized)) {
    return { text: upgradeReapplyProcedure(), kind: "procedure" }
  }
  if (/custom-message|return shape|host api|raw string|prompt submit|prompt-submit/u.test(normalized)) {
    return { text: adapterReturnShapeProcedure(), kind: "procedure" }
  }
  if (/generated|harness|adapter|template|installed artifact|dogfood|repo-local|contract test/u.test(normalized)) {
    return { text: generatedAdapterProcedure(), kind: "procedure" }
  }
  return { text: genericCorrection(), kind: "correction" }
}

function projectCandidate(text: string, kind: MemoryCandidate["kind"], confidence: number): MemoryCandidate[] {
  if (!text || text.length > MAX_POSTMORTEM_TEXT_CHARS || containsLikelySecret(text)) return []
  return [{
    text,
    category: "project",
    scopeType: "project",
    kind,
    confidence,
    decision: "save-pending",
    reason: "high-confidence postmortem learning",
    source: "agent-suggested",
  }]
}

export function extractPostmortemLearningCandidatesFromStop(input: StopInput): MemoryCandidate[] {
  const userText = compactText(input.lastUserMessage)
  const assistantText = compactText(input.lastAssistantMessage)
  if (!safeInput(userText) || !safeInput(assistantText)) return []
  if (isExplicitMemoryRequest(userText) || isExplicitMemoryRequest(assistantText)) return []

  const combinedText = compactText(userText, assistantText)
  if (!combinedText || containsLikelySecret(combinedText)) return []

  const combinedEvidence = evidence(combinedText)
  const assistantEvidence = evidence(assistantText)
  if (!shouldCapture(combinedEvidence, assistantEvidence)) return []

  const candidate = candidateText(combinedText)
  return projectCandidate(candidate.text, candidate.kind, combinedEvidence.verification ? 0.86 : 0.8)
}

export function postmortemLearningKeyFromText(text: string): string | undefined {
  const normalized = normalizeMemoryText(text).toLowerCase().replace(/\s+/gu, " ").trim()
  if (!normalized) return undefined
  if (/self-upgrade|freshly installed binary|stale in-memory/u.test(normalized)) return "postmortem:upgrade-reapply-fresh-installed-binary"
  if (/generated harness adapter return shapes|generated harness adapter|installed-artifact dogfood|installed artifact dogfood|contract tests?/u.test(normalized)) return "postmortem:harness-generated-adapter-contract-tests"
  if (/custom-message|return shape|host api|raw string|prompt submit|prompt-submit/u.test(normalized)) return "postmortem:pi-custom-message-shape"
  if (/verify before claiming completion|verification before completion|run and report.*verification/u.test(normalized)) return "postmortem:workflow-correction:verify-before-completion"
  return normalized.startsWith("workflow correction:") || normalized.startsWith("procedure:") ? normalized : undefined
}

function memoryProjectKey(memory: MemoryRecord): string | undefined {
  return memory.scope.key ?? memory.project?.key ?? memory.project?.root
}

function visibleProjectLearning(memory: MemoryRecord, projectScopeKey?: string): boolean {
  if (memory.status !== "pending" && memory.status !== "approved") return false
  if (memory.scope.type !== "project") return false
  if (!projectScopeKey || memoryProjectKey(memory) !== projectScopeKey) return false
  return memory.kind === "correction" || memory.kind === "procedure" || memory.kind === "workflow_rule"
}

export function filterDuplicatePostmortemLearningCandidates(engine: MemoryEngine, candidates: MemoryCandidate[]): MemoryCandidate[] {
  const projectScopeKey = engine.getProjectScope()?.key
  const existingKeys = new Set(
    engine.list()
      .filter((memory) => visibleProjectLearning(memory, projectScopeKey))
      .map((memory) => postmortemLearningKeyFromText(memory.text))
      .filter((key): key is string => Boolean(key)),
  )
  const seen = new Set<string>()
  const result: MemoryCandidate[] = []

  for (const candidate of candidates) {
    const key = postmortemLearningKeyFromText(candidate.text)
    if (!key || existingKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }

  return result
}

export function filterSameTurnPostmortemLearningCandidates(existingCandidates: MemoryCandidate[], postmortemCandidates: MemoryCandidate[]): MemoryCandidate[] {
  const existingKeys = new Set(
    existingCandidates
      .map((candidate) => postmortemLearningKeyFromText(candidate.text))
      .filter((key): key is string => Boolean(key)),
  )
  if (existingKeys.size === 0) return postmortemCandidates
  return postmortemCandidates.filter((candidate) => {
    const key = postmortemLearningKeyFromText(candidate.text)
    return !key || !existingKeys.has(key)
  })
}
