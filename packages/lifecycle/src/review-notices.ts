import type { LifecycleResult } from "./types.js"

export function pendingReviewCount(result: LifecycleResult): number {
  return result.saved.filter((saveResult) => saveResult.status === "saved" && saveResult.memory.status === "pending").length
}

export function renderPendingReviewNotice(result: LifecycleResult): string | undefined {
  const count = pendingReviewCount(result)
  if (count <= 0) return undefined

  const memoryWord = count === 1 ? "memory" : "memories"
  const pronoun = count === 1 ? "it" : "them"
  return `suggested ${count} pending ${memoryWord} for review. Run \`memory-lane review\` to approve or reject ${pronoun}.`
}
