import type { ContinuityHintCode, MemoryLifecycleEvent, MemoryRecord, MemorySource, ResolvedContinuityBaseline, SaveResult } from "@memory-lane/core"

export interface LifecycleContext {
  cwd: string
  sessionId?: string
  turnId?: string
  transcriptPath?: string
  model?: string
}

export interface UserPromptInput extends LifecycleContext {
  prompt: string
}

export interface StopInput extends LifecycleContext {
  lastUserMessage?: string
  lastAssistantMessage?: string
}

export interface RecentToolUse {
  toolName: string
  toolInput: unknown
  toolResponse: unknown
}

export interface PostToolUseInput extends LifecycleContext {
  toolName: string
  toolInput: unknown
  toolResponse: unknown
  recentToolUses?: RecentToolUse[]
}

export interface SessionStartInput extends LifecycleContext {
  since?: string
}

export interface ContinuityContextDecision {
  generated: boolean
  injected: boolean
  omittedReasons: string[]
  hintCount: number
  hintCodes: ContinuityHintCode[]
  newerApprovedCount?: number
  operatingAgreementPrimaryCount?: number
  suggestedActions: string[]
  continuityBaseline?: ResolvedContinuityBaseline
}

export interface PromptContinuityIntentDecision {
  detected: boolean
  family?: "resume" | "lookup" | "project-position" | "next-work"
  topic?: string
  confidence?: number
  reasons?: string[]
  guidanceInjected: boolean
}

export interface AutomaticHandoffContextDecision {
  active: boolean
  eligibleCount: number
  selectedCount: number
  omittedCount: number
  omittedReasons: string[]
}

export interface MemoryContextDecision {
  event: "prompt" | "sessionStart"
  mode: "off" | "policy-only" | "selective"
  maxItems: number
  maxChars: number
  selected: number
  omitted: number
  omittedReasons: string[]
  continuity?: ContinuityContextDecision
  continuityIntent?: PromptContinuityIntentDecision
  automaticHandoff?: AutomaticHandoffContextDecision
  descriptorIndex?: {
    injected: boolean
    maxItems: number
    maxChars: number
    effectiveMaxChars: number
    selected: number
    omitted: number
    generatedFallbackCount: number
    fullBodySelected: number
    fullBodyOmitted: number
  }
}

export interface LifecycleResult {
  additionalContext?: string
  saved: SaveResult[]
  discarded: Array<{ text: string; reason: string }>
  contextDecision?: MemoryContextDecision
}

export type CandidateDecision = "save-approved" | "save-pending" | "discard"

export interface MemoryCandidate {
  text: string
  category: "preference" | "personal" | "project"
  scopeType: "global" | "project"
  kind?: MemoryRecord["kind"]
  confidence: number
  decision: CandidateDecision
  reason: string
  source?: MemorySource
}

export interface LLMProvider {
  complete(prompt: string, options?: { maxTokens?: number; model?: string }): Promise<string>
}

export interface LLMProviderConfig {
  provider: "openai-compatible"
  baseUrl: string
  apiKeyEnv?: string | null
  model: string
  /** Per-provider request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number
}

export interface SessionMessage {
  role: "user" | "assistant" | "tool"
  content: string
  timestamp?: string
  toolName?: string
}

export interface SessionEndInput {
  cwd: string
  sessionId?: string
  messages: SessionMessage[]
  transcriptPath?: string
}

export interface SessionEndOptions {
  provider?: LLMProvider
  providerConfig?: LLMProviderConfig
  promptTemplate?: string
  maxTokens?: number
  requireConfirmation?: boolean
  confirmed?: boolean
  includeToolOutputs?: boolean
  adapter?: string
  lifecycleEvent?: MemoryLifecycleEvent
  trigger?: string
  turnId?: string
}

export interface PreCompactInput extends LifecycleContext {
  /** Host compaction trigger, such as manual or auto. */
  trigger?: string
  /** Compactable transcript messages supplied by the host, or adapter-read transcript fallback when omitted. */
  messages?: SessionMessage[]
}

/** Options for pre-compact summaries; adapters must pass confirmed true only after config disables confirmation. */
export type PreCompactOptions = SessionEndOptions
