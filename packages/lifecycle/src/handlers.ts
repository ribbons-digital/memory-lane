import type { MemoryEngine, MemoryProvenance, MemorySource, SaveResult } from "@memory-lane/core"
import { isMemoryManagementListIntent, limitsFromContextPolicy, renderMemoryContext, renderMemoryManagementListGuidance, resolveContextPolicy, selectBaselineMemories, selectMemoriesForInjection, type MemoryInjectionLimits } from "./injection.js"
import { extractStopCandidates } from "./candidates.js"
import { summarizeToolOutcome } from "./tool-outcomes.js"
import type { LifecycleResult, MemoryCandidate, MemoryContextDecision, PostToolUseInput, SessionStartInput, StopInput, UserPromptInput } from "./types.js"

function createResult(additionalContext?: string, contextDecision?: MemoryContextDecision): LifecycleResult {
  return { additionalContext, saved: [], discarded: [], contextDecision }
}

function contextDecision(input: Omit<MemoryContextDecision, "omittedReasons"> & { omittedReasons?: string[] }): MemoryContextDecision {
  return { ...input, omittedReasons: input.omittedReasons ?? (input.omitted > 0 ? ["budget-or-filter"] : []) }
}

function contextBudget(event: "prompt" | "sessionStart", policy: ReturnType<typeof resolveContextPolicy>): { maxItems: number; maxChars: number } {
  const key = event === "sessionStart" ? "sessionStart" : "prompt"
  return { maxItems: policy.maxItems[key], maxChars: policy.maxChars[key] }
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
  const policy = resolveContextPolicy(engine.getContextPolicy())
  const budget = contextBudget("prompt", policy)
  if (policy.mode === "off") return createResult(undefined, contextDecision({ event: "prompt", mode: policy.mode, ...budget, selected: 0, omitted: 0, omittedReasons: ["off"] }))
  if (policy.mode === "policy-only") return createResult(renderMemoryContext({ event: "prompt", memories: [], policy }), contextDecision({ event: "prompt", mode: policy.mode, ...budget, selected: 0, omitted: 0, omittedReasons: ["policy-only"] }))
  const recalled = await engine.recall(input.prompt)
  const selected = selectMemoriesForInjection(input.prompt, recalled, limitsFromContextPolicy("prompt", policy, options))
  const rendered = renderMemoryContext({ event: "prompt", memories: selected, policy })
  return createResult(rendered || undefined, contextDecision({ event: "prompt", mode: policy.mode, ...budget, selected: selected.length, omitted: Math.max(0, recalled.memories.length - selected.length) }))
}

export function handleSessionStart(
  engine: MemoryEngine,
  input: SessionStartInput,
  options?: Partial<MemoryInjectionLimits>,
): LifecycleResult {
  engine.refreshScope(input.cwd)
  const policy = resolveContextPolicy(engine.getContextPolicy())
  const budget = contextBudget("sessionStart", policy)
  if (policy.mode === "off") return createResult(undefined, contextDecision({ event: "sessionStart", mode: policy.mode, ...budget, selected: 0, omitted: 0, omittedReasons: ["off"] }))
  if (policy.mode === "policy-only") return createResult(renderMemoryContext({ event: "sessionStart", memories: [], policy }), contextDecision({ event: "sessionStart", mode: policy.mode, ...budget, selected: 0, omitted: 0, omittedReasons: ["policy-only"] }))
  const approved = engine.list({ status: "approved" })
  const selected = selectBaselineMemories(approved, limitsFromContextPolicy("sessionStart", policy, options))
  const rendered = renderMemoryContext({ event: "sessionStart", memories: selected, policy })
  return createResult(rendered || undefined, contextDecision({ event: "sessionStart", mode: policy.mode, ...budget, selected: selected.length, omitted: Math.max(0, approved.length - selected.length) }))
}

export function handleStop(engine: MemoryEngine, input: StopInput, options?: LifecycleHandlerOptions): LifecycleResult {
  engine.refreshScope(input.cwd)
  return persistCandidates(engine, extractStopCandidates(input), input, "turn_stop", options)
}

export function handlePostToolUse(engine: MemoryEngine, input: PostToolUseInput, options?: LifecycleHandlerOptions): LifecycleResult {
  engine.refreshScope(input.cwd)
  return persistCandidates(engine, summarizeToolOutcome(input), input, "post_tool_use", options)
}
