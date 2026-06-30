import type { MemoryEngine, MemoryProvenance, MemorySource, SaveResult } from "@memory-lane/core"
import { analyzeAutomaticHandoff, detectContinuityIntent, isAlwaysOnMemory, isMemoryManagementListIntent, isUnsafeAutomaticHandoffPointer, limitsFromContextPolicy, renderContinuityIntentGuidance, renderContinuityNotice, renderMemoryContext, renderMemoryManagementListGuidance, renderSessionStartMemoryContext, resolveContextPolicy, selectAlwaysOnMemories, selectDescriptorMemories, selectMemoriesForInjection, shouldSkipAutomaticInjection, SESSION_START_DESCRIPTOR_MAX_CHARS, SESSION_START_DESCRIPTOR_MAX_ITEMS, type AutomaticHandoffAnalysis, type MemoryInjectionLimits } from "./injection.js"
import { extractStopCandidates } from "./candidates.js"
import { checkpointKeyFromText, extractCheckpointCandidatesFromPostToolUse, extractCheckpointCandidatesFromStop, filterDuplicateCheckpointCandidates } from "./checkpoint-capture.js"
import { correctionKeyFromText, extractCorrectionCandidatesFromStop, filterDuplicateCorrectionCandidates, filterSameTurnCorrectionCandidates } from "./correction-capture.js"
import { extractPostmortemLearningCandidatesFromStop, filterDuplicatePostmortemLearningCandidates, filterSameTurnPostmortemLearningCandidates, postmortemLearningKeyFromText } from "./postmortem-learning.js"
import { filterDuplicateProcedureCandidates, summarizeToolOutcome } from "./tool-outcomes.js"
import type { AutomaticHandoffContextDecision, LifecycleResult, MemoryCandidate, MemoryContextDecision, PostToolUseInput, SessionStartInput, StopInput, UserPromptInput } from "./types.js"

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
  const hasSessionStartSections = rawInner.includes("## Relevant Memory") || rawInner.includes("## Always-on Memory") || rawInner.includes("## Memory Index")
  const inner = input.policy.mode === "selective" && rawInner && !hasSessionStartSections
    ? `## Relevant Memory\n\n${rawInner}`
    : rawInner
  const body = [noticeText, inner].filter((part) => part.trim().length > 0).join("\n\n")
  return [header, body, footer].join("\n")
}

function automaticHandoffNotice(analysis: AutomaticHandoffAnalysis): string {
  return analysis.eligibleCount > 0
    ? "Continuity notice:\n- An approved handoff pointer is available for this project. Inspect Memory Lane continuity before relying on older session context."
    : ""
}

function automaticHandoffDecision(input: {
  active: boolean
  analysis: AutomaticHandoffAnalysis
  selectedCount: number
  budgetOmitted?: boolean
}): AutomaticHandoffContextDecision {
  const omittedReasons = [...input.analysis.omittedReasons]
  if (input.budgetOmitted) omittedReasons.push("budget-or-filter")
  return {
    active: input.active,
    eligibleCount: input.analysis.eligibleCount,
    selectedCount: input.selectedCount,
    omittedCount: Math.max(0, input.analysis.eligibleCount - input.selectedCount),
    omittedReasons: [...new Set(omittedReasons)],
  }
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

function filterSameTurnCheckpointCandidates(existingCandidates: MemoryCandidate[], checkpointCandidates: MemoryCandidate[]): MemoryCandidate[] {
  const explicitSameTurnKeys = new Set(
    existingCandidates
      .filter((candidate) => candidate.source === "user-suggested")
      .map((candidate) => checkpointKeyFromText(candidate.text))
      .filter((key): key is string => Boolean(key)),
  )
  if (explicitSameTurnKeys.size === 0) return checkpointCandidates

  return checkpointCandidates.filter((candidate) => {
    const key = checkpointKeyFromText(candidate.text)
    return !key || !explicitSameTurnKeys.has(key)
  })
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
  if (shouldSkipAutomaticInjection(input.prompt)) return createResult(undefined, contextDecision({ event: "prompt", mode: policy.mode, ...budget, selected: 0, omitted: 0, omittedReasons: ["low-signal-prompt"] }))

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

  if (intent.detected && (intent.family === "project-position" || intent.family === "next-work")) {
    const rendered = composePromptContext({ guidance, memoryContext: "", policy })
    return createResult(rendered || undefined, contextDecision({
      event: "prompt",
      mode: policy.mode,
      ...budget,
      selected: 0,
      omitted: 0,
      omittedReasons: ["broad-continuity-no-recall"],
      ...(continuityIntent ? { continuityIntent } : {}),
    }))
  }

  const recallQuery = intent.detected && intent.topic ? intent.topic : input.prompt
  const recalled = await engine.recall(recallQuery)
  const projectScope = engine.getProjectScope()?.key
  const selected = selectMemoriesForInjection(recallQuery, recalled, {
    ...limitsFromContextPolicy("prompt", policy, options),
    projectScope,
  })
  const memoryContext = renderMemoryContext({ event: "prompt", memories: selected, policy, projectScope })
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

  const continuityBaseline = engine.resolveContinuityBaseline(input.since)
  const hints = engine.continuityHints({ since: continuityBaseline.since })
  const operatingAgreements = engine.operatingAgreementSummary()
  const notice = renderContinuityNotice({ hints, operatingAgreements, since: continuityBaseline.since, maxChars: budget.maxChars })
  notice.continuityBaseline = continuityBaseline
  const projectScope = engine.getProjectScope()?.key
  const automaticActive = engine.getHandoffMode() === "automatic"
  const approvedForAutomatic = automaticActive ? engine.list({ status: "approved" }) : []
  const automaticAnalysis = automaticActive
    ? analyzeAutomaticHandoff(approvedForAutomatic, { projectScope })
    : { eligible: [], eligibleCount: 0, omittedReasons: [] }
  const noticeText = notice.text

  if (policy.mode === "policy-only") {
    const policyOnlyNoticeText = [notice.text, automaticActive ? automaticHandoffNotice(automaticAnalysis) : ""].filter((text) => text.trim().length > 0).join("\n")
    const guidance = renderMemoryContext({ event: "sessionStart", memories: [], policy })
    const rendered = composeSessionStartContext({ noticeText: policyOnlyNoticeText, memoryContext: guidance, policy })
    const result = createResult(rendered || undefined, contextDecision({
      event: "sessionStart",
      mode: policy.mode,
      ...budget,
      selected: 0,
      omitted: 0,
      omittedReasons: ["policy-only", ...notice.omittedReasons],
      continuity: continuityDecision(notice),
      ...(automaticActive ? { automaticHandoff: automaticHandoffDecision({ active: true, analysis: automaticAnalysis, selectedCount: 0 }) } : {}),
    }))
    engine.recordContinuityBaseline(input.since)
    return result
  }

  const remainingChars = Math.max(0, budget.maxChars - (noticeText ? noticeText.length + 2 : 0))
  const approved = automaticActive ? approvedForAutomatic : engine.list({ status: "approved" })
  const operatingAgreementIds = new Set([
    ...operatingAgreements.primary.map((agreement) => agreement.id),
    ...operatingAgreements.relatedCandidates.map((agreement) => agreement.id),
  ])
  const baselineCandidates = approved.filter((memory) => !operatingAgreementIds.has(memory.id) && !(automaticActive && isUnsafeAutomaticHandoffPointer(memory, projectScope)))
  const sessionStartPreferenceMaxChars = policy.preferenceMaxChars.sessionStart ?? 600
  const sessionStartPreferenceMaxItems = policy.preferenceMaxItems.sessionStart ?? 2
  const fullBodyBudgetChars = Math.min(remainingChars, sessionStartPreferenceMaxChars)
  const fullBodySelectionLimits = limitsFromContextPolicy("sessionStart", policy, {
    ...options,
    maxItems: Math.min(options?.maxItems ?? sessionStartPreferenceMaxItems, sessionStartPreferenceMaxItems),
    hardMaxChars: fullBodyBudgetChars,
    targetChars: fullBodyBudgetChars,
    absoluteMaxChars: fullBodyBudgetChars,
  })
  let fullBodySelected = selectAlwaysOnMemories(baselineCandidates, { ...fullBodySelectionLimits, projectScope })
  const latestHandoffIds = new Set(automaticAnalysis.eligible.map((memory) => memory.id))
  let bodyContext = renderSessionStartMemoryContext({ fullBodyMemories: fullBodySelected, descriptorMemories: [], policy, projectScope, latestHandoffIds })
  while (bodyContext.length > remainingChars && fullBodySelected.length > 0) {
    fullBodySelected = fullBodySelected.slice(0, -1)
    bodyContext = renderSessionStartMemoryContext({ fullBodyMemories: fullBodySelected, descriptorMemories: [], policy, projectScope, latestHandoffIds })
  }
  const fullBodySelectedIds = new Set(fullBodySelected.map((memory) => memory.id))
  const descriptorRemainingChars = Math.max(0, remainingChars - (bodyContext ? bodyContext.length + 2 : 0))
  const descriptorMaxChars = Math.min(SESSION_START_DESCRIPTOR_MAX_CHARS, descriptorRemainingChars)
  const descriptorCandidates = baselineCandidates.filter((memory) => !fullBodySelectedIds.has(memory.id))
  const descriptorSelection = selectDescriptorMemories(descriptorCandidates, {
    projectScope,
    priorityMemories: automaticAnalysis.eligible.filter((memory) => !fullBodySelectedIds.has(memory.id)),
    maxItems: SESSION_START_DESCRIPTOR_MAX_ITEMS,
    hardMaxChars: descriptorMaxChars,
  })
  let descriptorMemories = descriptorSelection.memories
  let memoryContext = renderSessionStartMemoryContext({ fullBodyMemories: fullBodySelected, descriptorMemories, policy, projectScope, latestHandoffIds })
  while (memoryContext.length > remainingChars && descriptorMemories.length > 0) {
    descriptorMemories = descriptorMemories.slice(0, -1)
    memoryContext = renderSessionStartMemoryContext({ fullBodyMemories: fullBodySelected, descriptorMemories, policy, projectScope, latestHandoffIds })
  }
  const generatedFallbackCount = descriptorMemories.filter((memory) => descriptorSelection.generatedFallbackMemoryIds.has(memory.id)).length
  const selectedAutomaticCount = automaticAnalysis.eligible.filter((memory) => fullBodySelected.some((selectedMemory) => selectedMemory.id === memory.id) || descriptorMemories.some((selectedMemory) => selectedMemory.id === memory.id)).length
  const rendered = composeSessionStartContext({ noticeText, memoryContext, policy })
  const fullBodyOmitted = Math.max(0, baselineCandidates.filter((memory) => !fullBodySelectedIds.has(memory.id) && isAlwaysOnMemory(memory)).length)
  const descriptorOmitted = Math.max(0, descriptorCandidates.length - descriptorMemories.length)
  const result = createResult(rendered || undefined, contextDecision({
    event: "sessionStart",
    mode: policy.mode,
    ...budget,
    selected: fullBodySelected.length + descriptorMemories.length,
    omitted: Math.max(0, baselineCandidates.length - fullBodySelected.length - descriptorMemories.length),
    continuity: continuityDecision(notice),
    descriptorIndex: {
      injected: descriptorMemories.length > 0,
      maxItems: SESSION_START_DESCRIPTOR_MAX_ITEMS,
      maxChars: SESSION_START_DESCRIPTOR_MAX_CHARS,
      effectiveMaxChars: descriptorMaxChars,
      selected: descriptorMemories.length,
      omitted: descriptorOmitted,
      generatedFallbackCount,
      fullBodySelected: fullBodySelected.length,
      fullBodyOmitted,
    },
    ...(automaticActive ? {
      automaticHandoff: automaticHandoffDecision({
        active: true,
        analysis: automaticAnalysis,
        selectedCount: selectedAutomaticCount,
        budgetOmitted: automaticAnalysis.eligibleCount > 0 && selectedAutomaticCount === 0,
      }),
    } : {}),
  }))
  engine.recordContinuityBaseline(input.since)
  return result
}

export function handleStop(engine: MemoryEngine, input: StopInput, options?: LifecycleHandlerOptions): LifecycleResult {
  engine.refreshScope(input.cwd)
  const stopCandidates = extractStopCandidates(input)
  const checkpointCandidates = filterSameTurnCheckpointCandidates(
    stopCandidates,
    filterDuplicateCheckpointCandidates(engine, extractCheckpointCandidatesFromStop(input)),
  )
  const correctionCandidates = filterSameTurnCorrectionCandidates(
    stopCandidates,
    filterDuplicateCorrectionCandidates(engine, extractCorrectionCandidatesFromStop(input)),
  )
  const learningCandidates = filterSameTurnPostmortemLearningCandidates(
    stopCandidates,
    filterDuplicatePostmortemLearningCandidates(engine, extractPostmortemLearningCandidatesFromStop(input)),
  )
  const learningPostmortemKeys = new Set(
    learningCandidates
      .map((candidate) => postmortemLearningKeyFromText(candidate.text))
      .filter((key): key is string => Boolean(key)),
  )
  // When both fire in one stop event, keep one learning item and prefer the richer
  // postmortem procedure only over corrections that overlap with that learning key.
  const effectiveCorrectionCandidates = correctionCandidates.filter((candidate) => {
    const postmortemKey = postmortemLearningKeyFromText(candidate.text)
    if (postmortemKey && learningPostmortemKeys.has(postmortemKey)) return false
    const correctionKey = correctionKeyFromText(candidate.text)
    if (!correctionKey) return true
    const generatedAdapterLearning = learningPostmortemKeys.has("postmortem:harness-generated-adapter-contract-tests")
    return !(generatedAdapterLearning && (correctionKey === "review-gate" || correctionKey === "verification-before-completion"))
  })
  return persistCandidates(engine, [...effectiveCorrectionCandidates, ...learningCandidates, ...checkpointCandidates, ...stopCandidates], input, "turn_stop", options)
}

export function handlePostToolUse(engine: MemoryEngine, input: PostToolUseInput, options?: LifecycleHandlerOptions): LifecycleResult {
  engine.refreshScope(input.cwd)
  const candidates = [
    ...filterDuplicateProcedureCandidates(engine, summarizeToolOutcome(input)),
    ...filterDuplicateCheckpointCandidates(engine, extractCheckpointCandidatesFromPostToolUse(input)),
  ]
  return persistCandidates(engine, candidates, input, "post_tool_use", options)
}
