import {
  analyzeReviewQuality,
  type EffectiveLifecycleCaptureConfig,
  type MemoryEngine,
  type MemoryRecord,
  type ReviewQualitySignalCode,
  type SaveResult,
} from "@memory-lane/core"
import type { LifecycleCaptureResult, LifecycleResult, MemoryCandidate, PostToolUseInput, StopInput } from "./types.js"

const CONSERVATIVE_QUALITY_BLOCKERS = new Set<ReviewQualitySignalCode>([
  "bare-checkpoint",
  "previously-rejected-equivalent",
  "contains-question",
  "contains-code-fence",
  "ambiguous-reference",
])
const AGGRESSIVE_QUALITY_BLOCKERS = new Set<ReviewQualitySignalCode>([
  "bare-checkpoint",
  "previously-rejected-equivalent",
])

function automaticLifecycleMemory(memory: MemoryRecord): boolean {
  if (memory.source !== "agent-suggested" && memory.source !== "session-summary") return false
  return memory.provenance?.lifecycleEvent === "turn_stop"
    || memory.provenance?.lifecycleEvent === "post_tool_use"
    || memory.provenance?.lifecycleEvent === "pre_compact"
    || memory.provenance?.lifecycleEvent === "session_end"
}

function projectIdentity(memory: MemoryRecord): string | undefined {
  return memory.scope.key ?? memory.project?.key ?? memory.project?.root
}

function automaticPendingBacklogCountFromRecords(records: MemoryRecord[], projectScope: string | undefined): number {
  if (!projectScope) return 0
  return records.filter((memory) =>
    memory.status === "pending"
    && automaticLifecycleMemory(memory)
    && projectIdentity(memory) === projectScope,
  ).length
}

export function automaticPendingBacklogCount(engine: MemoryEngine): number {
  const projectScope = engine.getProjectScope()?.key
  if (!projectScope) return 0
  return automaticPendingBacklogCountFromRecords(engine.list({ all: true }), projectScope)
}

function priority(candidate: MemoryCandidate): number {
  if (candidate.kind === "correction") return 0
  if (candidate.kind === "procedure") return 1
  if (candidate.kind === "decision" || candidate.kind === "workflow_rule") return 2
  if (candidate.kind === "project_checkpoint" || candidate.kind === "session_summary") return 3
  if (candidate.kind === "project_fact") return 4
  return 4
}

function candidateRecord(engine: MemoryEngine, candidate: MemoryCandidate, input: StopInput | PostToolUseInput): MemoryRecord {
  const now = "1970-01-01T00:00:00.000Z"
  const projectScope = engine.getProjectScope()
  return {
    id: "automatic-capture-candidate",
    status: "pending",
    text: candidate.text,
    category: candidate.category,
    scope: candidate.scopeType === "project"
      ? { type: "project", key: projectScope?.key }
      : { type: "global" },
    source: "agent-suggested",
    kind: candidate.kind,
    createdAt: now,
    updatedAt: now,
    ...(projectScope ? { project: { cwd: input.cwd, root: projectScope.root, key: projectScope.key } } : {}),
  }
}

function captureState(config: EffectiveLifecycleCaptureConfig, backlog: number): LifecycleCaptureResult {
  return {
    mode: config.mode,
    limits: config.limits,
    pendingWritten: 0,
    approvedWritten: 0,
    explicitWritten: 0,
    suppressed: 0,
    qualitySuppressed: 0,
    limitSuppressed: 0,
    automaticPendingBacklog: backlog,
  }
}

function admittedCounts(records: MemoryRecord[], projectScope: string | undefined, input: StopInput | PostToolUseInput): { turn: number; session: number } {
  const scopedRecords = records.filter((memory) =>
    automaticLifecycleMemory(memory)
    && (!projectScope || projectIdentity(memory) === projectScope),
  )
  return {
    turn: input.turnId ? scopedRecords.filter((memory) =>
      memory.provenance?.turnId === input.turnId
      && (!input.sessionId || memory.provenance?.sessionId === input.sessionId),
    ).length : 0,
    session: input.sessionId ? scopedRecords.filter((memory) => memory.provenance?.sessionId === input.sessionId).length : 0,
  }
}

export interface PersistAutomaticCaptureOptions {
  engine: MemoryEngine
  candidates: MemoryCandidate[]
  input: StopInput | PostToolUseInput
  save(candidate: MemoryCandidate): SaveResult
}

/** Deterministic quality and backpressure admission shared by turn-stop and post-tool-use persistence. */
export function persistGovernedLifecycleCandidates(options: PersistAutomaticCaptureOptions): {
  saved: SaveResult[]
  discarded: LifecycleResult["discarded"]
  capture: LifecycleCaptureResult
} {
  const { engine, input } = options
  const config = engine.getLifecycleCaptureConfig()
  const projectScope = engine.getProjectScope()?.key
  const records = engine.list({ all: true })
  const initialBacklog = automaticPendingBacklogCountFromRecords(records, projectScope)
  const capture = captureState(config, initialBacklog)
  const saved: SaveResult[] = []
  const discarded: LifecycleResult["discarded"] = []

  const explicit = options.candidates.filter((candidate) => candidate.source === "user-suggested")
  const seenAutomaticText = new Set<string>()
  const automatic = options.candidates
    .filter((candidate) => candidate.source !== "user-suggested")
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => priority(a.candidate) - priority(b.candidate) || a.index - b.index)
    .map(({ candidate }) => candidate)
    .filter((candidate) => {
      const key = candidate.text.toLocaleLowerCase().replace(/\s+/gu, " ").trim()
      if (seenAutomaticText.has(key)) return false
      seenAutomaticText.add(key)
      return true
    })

  for (const candidate of explicit) {
    if (candidate.decision === "discard") {
      discarded.push({ text: candidate.text, reason: candidate.reason })
      continue
    }
    const result = options.save(candidate)
    saved.push(result)
    if (result.status === "saved") {
      capture.explicitWritten += 1
      if (result.memory.status === "pending") capture.pendingWritten += 1
      if (result.memory.status === "approved") capture.approvedWritten += 1
    }
  }

  let admitted = admittedCounts(records, projectScope, input)
  let backlog = initialBacklog
  const rejected = records.filter((memory) => memory.status === "rejected")
  const blockerCodes = config.mode === "aggressive" ? AGGRESSIVE_QUALITY_BLOCKERS : CONSERVATIVE_QUALITY_BLOCKERS

  for (const originalCandidate of automatic) {
    if (originalCandidate.decision === "discard") {
      discarded.push({ text: originalCandidate.text, reason: originalCandidate.reason })
      capture.suppressed += 1
      capture.qualitySuppressed += 1
      continue
    }

    const signals = analyzeReviewQuality(candidateRecord(engine, originalCandidate, input), { rejectedMemories: rejected })
    const candidateBlockers = originalCandidate.kind === "correction" || originalCandidate.kind === "procedure" || originalCandidate.source === "session-summary"
      ? AGGRESSIVE_QUALITY_BLOCKERS
      : blockerCodes
    const blocker = signals.find((signal) => candidateBlockers.has(signal.code))
    if (blocker) {
      discarded.push({ text: originalCandidate.text, reason: blocker.reason })
      capture.suppressed += 1
      capture.qualitySuppressed += 1
      continue
    }

    const limitReason = config.mode === "off"
      ? "automatic lifecycle capture is off"
      : admitted.turn >= config.limits.perTurn
        ? `automatic lifecycle per-turn limit (${config.limits.perTurn}) reached`
        : admitted.session >= config.limits.perSession
          ? `automatic lifecycle per-session limit (${config.limits.perSession}) reached`
          : backlog >= config.limits.pendingBacklog
            ? `automatic pending backlog limit (${config.limits.pendingBacklog}) reached`
            : undefined
    if (limitReason) {
      discarded.push({ text: originalCandidate.text, reason: limitReason })
      capture.suppressed += 1
      capture.limitSuppressed += 1
      if (backlog >= config.limits.pendingBacklog && config.mode !== "off" && !capture.advisory) {
        capture.advisory = {
          code: "automatic-pending-backlog-full",
          message: `Automatic capture paused at ${backlog} pending suggestions. Review the queue before more automatic suggestions can be admitted.`,
          reviewAction: "memory-lane review",
        }
      }
      continue
    }

    const candidate: MemoryCandidate = { ...originalCandidate, decision: "save-pending" }
    const result = options.save(candidate)
    saved.push(result)
    if (result.status === "saved") {
      capture.pendingWritten += 1
      admitted = { turn: admitted.turn + 1, session: admitted.session + 1 }
      backlog += 1
    }
  }

  capture.automaticPendingBacklog = backlog
  return { saved, discarded, capture }
}
