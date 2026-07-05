export interface EvalResultWithFailureTags<Tag extends string = string> {
  passed?: boolean
  failureTags: readonly Tag[]
}

export interface EvalGateSummary {
  scenarioCount: number
  passCount: number
  failCount: number
  zeroToleranceFailures: number
  failureTagCounts: Record<string, number>
  satisfactory: boolean
}

export function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? Number.NaN : numerator / denominator
}

export function countFailureTags(results: readonly EvalResultWithFailureTags[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const result of results) {
    for (const tag of result.failureTags) counts[tag] = (counts[tag] ?? 0) + 1
  }
  return counts
}

export function isEvalResultPassed(result: EvalResultWithFailureTags): boolean {
  return result.passed ?? result.failureTags.length === 0
}

export function summarizeEvalGate<Tag extends string>(
  results: readonly EvalResultWithFailureTags<Tag>[],
  zeroToleranceFailureTags: ReadonlySet<Tag> | Record<Tag, true | undefined>,
): EvalGateSummary {
  const isZeroTolerance = zeroToleranceFailureTags instanceof Set
    ? (tag: Tag) => zeroToleranceFailureTags.has(tag)
    : (tag: Tag) => zeroToleranceFailureTags[tag] === true
  const failCount = results.filter((result) => !isEvalResultPassed(result)).length
  const zeroToleranceFailures = results.reduce((sum, result) => sum + result.failureTags.filter(isZeroTolerance).length, 0)
  return {
    scenarioCount: results.length,
    passCount: results.length - failCount,
    failCount,
    zeroToleranceFailures,
    failureTagCounts: countFailureTags(results),
    satisfactory: results.length > 0 && failCount === 0 && zeroToleranceFailures === 0,
  }
}
