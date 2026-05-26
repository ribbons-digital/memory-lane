import type { MemoryEngine, MemoryProvenance, MemorySource, SaveResult } from "@memory-lane/core"
import { renderMemoryBlock, selectMemoriesForInjection, type MemoryInjectionLimits } from "./injection.js"
import { extractStopCandidates } from "./candidates.js"
import { summarizeToolOutcome } from "./tool-outcomes.js"
import type { LifecycleResult, MemoryCandidate, PostToolUseInput, StopInput, UserPromptInput } from "./types.js"

function createResult(additionalContext?: string): LifecycleResult {
  return { additionalContext, saved: [], discarded: [] }
}

function candidateSource(candidate: MemoryCandidate, fallback: MemorySource): MemorySource {
  return candidate.source ?? fallback
}

function provenance(
  input: { sessionId?: string; turnId?: string },
  lifecycleEvent: MemoryProvenance["lifecycleEvent"],
  toolName?: string,
): MemoryProvenance {
  return {
    adapter: "codex",
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
      provenance: provenance(input, lifecycleEvent, "toolName" in input ? input.toolName : undefined),
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
  const recalled = await engine.recall(input.prompt)
  const selected = selectMemoriesForInjection(input.prompt, recalled, options)
  const rendered = renderMemoryBlock(selected)
  return createResult(rendered || undefined)
}

export function handleStop(engine: MemoryEngine, input: StopInput): LifecycleResult {
  engine.refreshScope(input.cwd)
  return persistCandidates(engine, extractStopCandidates(input), input, "turn_stop")
}

export function handlePostToolUse(engine: MemoryEngine, input: PostToolUseInput): LifecycleResult {
  engine.refreshScope(input.cwd)
  return persistCandidates(engine, summarizeToolOutcome(input), input, "post_tool_use")
}
