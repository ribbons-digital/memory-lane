export function isMetaTaskPromptText(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false

  const reviewerStatusRequest = /\bAPPROVED\s+or\s+CHANGES_REQUESTED\b/iu.test(normalized)
  const subagentStatusRequest = /\bDONE_WITH_CONCERNS\b|\bNEEDS_CONTEXT\b|\bBLOCKED\b/iu.test(normalized)
  const taskReviewPrompt = /^task:\s+/iu.test(normalized) && /\b(?:code quality|docs quality|review|task\s+\d+\s+only|do not modify files)\b/iu.test(normalized)
  const commitReviewPrompt = /^review\s+commit\b/iu.test(normalized)
  const planTaskPrompt = /^implement\s+plan\s+task\s+\d+\s+only\b/iu.test(normalized)
  const subagentStatusPrompt = /^report\s+status\s+as\b/iu.test(normalized) && subagentStatusRequest
  const delegatedSubagentTask = /^task:\s+you\s+are\s+a\s+delegated\s+subagent\b/iu.test(normalized)
  const acceptanceFinalizationTask = /^task:\s+##\s+acceptance\s+finalization\b/iu.test(normalized)

  return (
    taskReviewPrompt
    || commitReviewPrompt
    || reviewerStatusRequest
    || subagentStatusPrompt
    || delegatedSubagentTask
    || acceptanceFinalizationTask
    || (planTaskPrompt && subagentStatusRequest)
  )
}
