import type { MemoryRecord, SaveResult } from "@memory-lane/core"

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

export interface PostToolUseInput extends LifecycleContext {
  toolName: string
  toolInput: unknown
  toolResponse: unknown
}

export interface LifecycleResult {
  additionalContext?: string
  saved: SaveResult[]
  discarded: Array<{ text: string; reason: string }>
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
}
