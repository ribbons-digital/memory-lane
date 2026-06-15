import type { LifecycleResult } from "@memory-lane/lifecycle"

export function debugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MEMORY_LANE_HOOK_DEBUG === "1" || env.MEMORY_LANE_HOOK_DEBUG === "true"
}

export function noopOutput(message?: string, debug = debugEnabled()): string {
  if (debug && message) return JSON.stringify({ systemMessage: `Memory Lane: ${message}` })
  return "{}"
}

export function additionalContextOutput(
  result: LifecycleResult,
  hookEventName: "UserPromptSubmit" | "SessionStart",
  debug = debugEnabled(),
): string {
  if (!result.additionalContext) return noopOutput(undefined, debug)
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName,
      additionalContext: result.additionalContext,
    },
    ...(debug ? { systemMessage: "Memory Lane: injected relevant memories." } : {}),
  })
}

export function userPromptSubmitOutput(result: LifecycleResult, debug = debugEnabled()): string {
  return additionalContextOutput(result, "UserPromptSubmit", debug)
}

export function sessionStartOutput(result: LifecycleResult, debug = debugEnabled()): string {
  return additionalContextOutput(result, "SessionStart", debug)
}

export function lifecycleNoopOutput(result: LifecycleResult, debug = debugEnabled()): string {
  const saved = result.saved.filter((saveResult) => saveResult.status === "saved").length
  const skipped = result.saved.filter((saveResult) => saveResult.status === "skipped").length
  const discarded = result.discarded.length
  return noopOutput(`saved ${saved}, skipped ${skipped}, discarded ${discarded}.`, debug)
}
