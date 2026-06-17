import type { MemoryEngine, MemoryProvenance, MemorySource, SaveResult } from "@memory-lane/core"
import { isMemoryManagementListIntent, renderMemoryBlock, renderMemoryManagementListGuidance, selectBaselineMemories, selectMemoriesForInjection, type MemoryInjectionLimits } from "./injection.js"
import { extractStopCandidates } from "./candidates.js"
import { summarizeToolOutcome } from "./tool-outcomes.js"
import type { LifecycleResult, MemoryCandidate, PostToolUseInput, SessionStartInput, StopInput, UserPromptInput } from "./types.js"

function createResult(additionalContext?: string): LifecycleResult {
  return { additionalContext, saved: [], discarded: [] }
}

function candidateSource(candidate: MemoryCandidate, fallback: MemorySource): MemorySource {
  return candidate.source ?? fallback
}

interface LifecycleHandlerOptions {
  adapter?: string
}

function provenance(
  input: { sessionId?: string; turnId?: string },
  lifecycleEvent: MemoryProvenance["lifecycleEvent"],
  toolName?: string,
  adapter = "codex",
): MemoryProvenance {
  return {
    adapter,
    lifecycleEvent,
    sessionId: input.sessionId,
    turnId: input.turnId,
    toolName,
  }
}

function persistCandidates(
  engine: MemoryEngine,
  candidates: MemoryCandidate[],
  input: StopInput | PostToolUseInput,
  lifecycleEvent: "turn_stop" | "post_tool_use",
  options?: LifecycleHandlerOptions,
): LifecycleResult {
  const saved: SaveResult[] = []
  const discarded: LifecycleResult["discarded"] = []

  for (const candidate of candidates) {
    if (candidate.decision === "discard") {
      discarded.push({ text: candidate.text, reason: candidate.reason })
      continue
    }

    saved.push(engine.save({
      text: candidate.text,
      category: candidate.category,
      scopeType: candidate.scopeType,
      kind: candidate.kind,
      status: candidate.decision === "save-approved" ? "approved" : "pending",
      source: candidateSource(candidate, "agent-suggested"),
      provenance: provenance(input, lifecycleEvent, "toolName" in input ? input.toolName : undefined, options?.adapter),
    }))
  }

  return { saved, discarded }
}

export async function handleUserPromptSubmit(
  engine: MemoryEngine,
  input: UserPromptInput,
  options?: Partial<MemoryInjectionLimits>,
): Promise<LifecycleResult> {
  engine.refreshScope(input.cwd)
  if (isMemoryManagementListIntent(input.prompt)) return createResult(renderMemoryManagementListGuidance())
  const recalled = await engine.recall(input.prompt)
  const selected = selectMemoriesForInjection(input.prompt, recalled, options)
  const rendered = renderMemoryBlock(selected)
  return createResult(rendered || undefined)
}

export function handleSessionStart(
  engine: MemoryEngine,
  input: SessionStartInput,
  options?: Partial<MemoryInjectionLimits>,
): LifecycleResult {
  engine.refreshScope(input.cwd)
  const approved = engine.list({ status: "approved" })
  const selected = selectBaselineMemories(approved, options)
  const rendered = renderMemoryBlock(selected)
  return createResult(rendered || undefined)
}

export function handleStop(engine: MemoryEngine, input: StopInput, options?: LifecycleHandlerOptions): LifecycleResult {
  engine.refreshScope(input.cwd)
  return persistCandidates(engine, extractStopCandidates(input), input, "turn_stop", options)
}

export function handlePostToolUse(engine: MemoryEngine, input: PostToolUseInput, options?: LifecycleHandlerOptions): LifecycleResult {
  engine.refreshScope(input.cwd)
  return persistCandidates(engine, summarizeToolOutcome(input), input, "post_tool_use", options)
}
