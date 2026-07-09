import { skippedSecretCount } from "@memory-lane/core"
import type { LifecycleResult } from "./types.js"

export interface LifecycleDebugCounts extends Record<string, unknown> {
  saved: number
  skipped: number
  discarded: number
  skippedSecret?: number
  additionalContext: boolean
  warningCount: number
  contextPolicyMode?: string
  contextEvent?: string
  contextSelected?: number
  contextOmitted?: number
  contextMaxItems?: number
  contextMaxChars?: number
  contextOmittedReasons?: string[]
}

export function lifecycleDebugCounts(result: LifecycleResult): LifecycleDebugCounts {
  const decision = result.contextDecision
  const totalSkippedSecret = result.skippedSecret ?? skippedSecretCount(result.saved) ?? 0
  return {
    saved: result.saved.filter((saveResult) => saveResult.status === "saved").length,
    skipped: result.saved.filter((saveResult) => saveResult.status === "skipped").length,
    skippedSecret: totalSkippedSecret > 0 ? totalSkippedSecret : undefined,
    discarded: result.discarded.length,
    additionalContext: Boolean(result.additionalContext),
    warningCount: result.saved.reduce((count, saveResult) => count + (saveResult.warnings?.length ?? 0), 0),
    ...(decision ? {
      contextPolicyMode: decision.mode,
      contextEvent: decision.event,
      contextSelected: decision.selected,
      contextOmitted: decision.omitted,
      contextMaxItems: decision.maxItems,
      contextMaxChars: decision.maxChars,
      contextOmittedReasons: decision.omittedReasons,
    } : {}),
  }
}
