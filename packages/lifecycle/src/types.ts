import type { ContinuityHintCode, MemoryRecord, MemorySource, SaveResult } from "@memory-lane/core"

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
}

export interface PromptContinuityIntentDecision {
  detected: boolean
  family?: "resume" | "lookup" | "project-position" | "next-work"
  topic?: string
  guidanceInjected: boolean
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
}
