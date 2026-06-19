import type { MemoryEngine, MemoryProvenance, MemorySource, SaveResult } from "@memory-lane/core"
import { detectContinuityIntent, isMemoryManagementListIntent, limitsFromContextPolicy, renderContinuityIntentGuidance, renderContinuityNotice, renderMemoryContext, renderMemoryManagementListGuidance, resolveContextPolicy, selectBaselineMemories, selectMemoriesForInjection, type MemoryInjectionLimits } from "./injection.js"
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

function composeSessionStartContext(input: {
  noticeText: string
  memoryContext: string
  policy: ReturnType<typeof resolveContextPolicy>
}): string {
  const noticeText = input.noticeText.trim()
  const memoryContext = input.memoryContext.trim()
  if (!noticeText && !memoryContext) return ""

  const header = `<memory-context mode="${input.policy.mode}" event="sessionStart">`
  const footer = "</memory-context>"
  const rawInner = memoryContext.startsWith("<memory-context")
    ? memoryContext
      .replace(/^<memory-context[^>]*>\n?/u, "")
      .replace(/\n?<\/memory-context>$/u, "")
    : memoryContext
  const inner = input.policy.mode === "selective" && rawInner && !rawInner.includes("## Relevant Memory")
    ? `## Relevant Memory\n\n${rawInner}`
    : rawInner
  const body = [noticeText, inner].filter((part) => part.trim().length > 0).join("\n\n")
  return [header, body, footer].join("\n")
}

function continuityDecision(notice: ReturnType<typeof renderContinuityNotice>): MemoryContextDecision["continuity"] {
  const { text: _text, ...decision } = notice
  return decision
}

function promptContinuityDecision(intent: ReturnType<typeof detectContinuityIntent>, guidanceInjected: boolean): MemoryContextDecision["continuityIntent"] {
  if (!intent.detected) return undefined
  return {
    detected: true,
    family: intent.family,
    ...(intent.topic ? { topic: intent.topic } : {}),
    guidanceInjected,
  }
}

function composePromptContext(input: {
  guidance: string
  memoryContext: string
  policy: ReturnType<typeof resolveContextPolicy>
}): string {
  const guidance = input.guidance.trim()
  const memoryContext = input.memoryContext.trim()
  if (!guidance && !memoryContext) return ""
  if (!guidance) return memoryContext

  const rawInner = memoryContext.startsWith("<memory-context")
    ? memoryContext
      .replace(/^<memory-context[^>]*>\n?/u, "")
      .replace(/\n?<\/memory-context>$/u, "")
    : memoryContext
  const inner = input.policy.mode === "selective" && rawInner && !rawInner.includes("## Relevant Memory")
    ? `## Relevant Memory\n\n${rawInner}`
    : rawInner
  const body = [guidance, inner].filter((part) => part.trim().length > 0).join("\n\n")
  return [`<memory-context mode="${input.policy.mode}" event="prompt">`, body, "</memory-context>"].join("\n")
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

  const intent = detectContinuityIntent(input.prompt)
  const guidance = renderContinuityIntentGuidance(intent)
  const continuityIntent = promptContinuityDecision(intent, Boolean(guidance))

  if (policy.mode === "policy-only") {
    const policyGuidance = renderMemoryContext({ event: "prompt", memories: [], policy })
    const rendered = composePromptContext({ guidance, memoryContext: policyGuidance, policy })
    return createResult(rendered || undefined, contextDecision({
      event: "prompt",
      mode: policy.mode,
      ...budget,
      selected: 0,
      omitted: 0,
      omittedReasons: ["policy-only"],
      ...(continuityIntent ? { continuityIntent } : {}),
    }))
  }

  const recallQuery = intent.detected && intent.topic ? intent.topic : input.prompt
  const recalled = await engine.recall(recallQuery)
  const selected = selectMemoriesForInjection(recallQuery, recalled, limitsFromContextPolicy("prompt", policy, options))
  const memoryContext = renderMemoryContext({ event: "prompt", memories: selected, policy })
  const rendered = composePromptContext({ guidance, memoryContext, policy })
  return createResult(rendered || undefined, contextDecision({
    event: "prompt",
    mode: policy.mode,
    ...budget,
    selected: selected.length,
    omitted: Math.max(0, recalled.memories.length - selected.length),
    ...(continuityIntent ? { continuityIntent } : {}),
  }))
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

  const hints = engine.continuityHints({ since: input.since })
  const operatingAgreements = engine.operatingAgreementSummary()
  const notice = renderContinuityNotice({ hints, operatingAgreements, since: input.since, maxChars: budget.maxChars })

  if (policy.mode === "policy-only") {
    const guidance = renderMemoryContext({ event: "sessionStart", memories: [], policy })
    const rendered = composeSessionStartContext({ noticeText: notice.text, memoryContext: guidance, policy })
    return createResult(rendered || undefined, contextDecision({
      event: "sessionStart",
      mode: policy.mode,
      ...budget,
      selected: 0,
      omitted: 0,
      omittedReasons: ["policy-only", ...notice.omittedReasons],
      continuity: continuityDecision(notice),
    }))
  }

  const remainingChars = Math.max(0, budget.maxChars - (notice.injected ? notice.text.length + 2 : 0))
  const approved = engine.list({ status: "approved" })
  const operatingAgreementIds = new Set([
    ...operatingAgreements.primary.map((agreement) => agreement.id),
    ...operatingAgreements.relatedCandidates.map((agreement) => agreement.id),
  ])
  const baselineCandidates = approved.filter((memory) => !operatingAgreementIds.has(memory.id))
  const selected = selectBaselineMemories(baselineCandidates, limitsFromContextPolicy("sessionStart", policy, {
    ...options,
    hardMaxChars: remainingChars,
    targetChars: remainingChars,
    absoluteMaxChars: remainingChars,
  }))
  const memoryContext = renderMemoryContext({ event: "sessionStart", memories: selected, policy })
  const rendered = composeSessionStartContext({ noticeText: notice.text, memoryContext, policy })
  return createResult(rendered || undefined, contextDecision({
    event: "sessionStart",
    mode: policy.mode,
    ...budget,
    selected: selected.length,
    omitted: Math.max(0, baselineCandidates.length - selected.length),
    continuity: continuityDecision(notice),
  }))
}

export function handleStop(engine: MemoryEngine, input: StopInput, options?: LifecycleHandlerOptions): LifecycleResult {
  engine.refreshScope(input.cwd)
  return persistCandidates(engine, extractStopCandidates(input), input, "turn_stop", options)
}

export function handlePostToolUse(engine: MemoryEngine, input: PostToolUseInput, options?: LifecycleHandlerOptions): LifecycleResult {
  engine.refreshScope(input.cwd)
  return persistCandidates(engine, summarizeToolOutcome(input), input, "post_tool_use", options)
}
