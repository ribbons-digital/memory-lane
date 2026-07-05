import assert from "node:assert/strict"

// Test-only benchmark taxonomy attached to local eval fixtures and copied into reports.
// It keeps report grouping separate from runtime route names, recall lanes, and production APIs.

export type BenchmarkLane = "retrieval" | "continuity" | "prompt-routing" | "lifecycle-injection"

export type BenchmarkAbility =
  | "direct-recall"
  | "continuity-status"
  | "prompt-routing"
  | "lifecycle-injection"
  | "temporal-currentness"
  | "knowledge-update"
  | "false-premise-abstention"
  | "cross-scope-safety"
  | "privacy-secret-suppression"

export interface BenchmarkMetadata {
  ability: BenchmarkAbility
  lane: BenchmarkLane
}

export function assertBenchmarkMetadata(metadata: BenchmarkMetadata, expectedLane: BenchmarkLane, id = "benchmark"): void {
  assert.ok(metadata.ability, `${id} needs benchmark ability`)
  assert.equal(metadata.lane, expectedLane, `${id} benchmark lane`)
}

export function assertBenchmarkParity(
  results: readonly { id: string; benchmark: BenchmarkMetadata }[],
  sources: readonly { id: string; benchmark: BenchmarkMetadata }[],
): void {
  for (const result of results) {
    const source = sources.find((item) => item.id === result.id)
    assert.ok(source, `${result.id} has no source benchmark metadata`)
    assert.deepEqual(result.benchmark, source.benchmark)
  }
}

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

export type EvalGateFields = Pick<EvalGateSummary, "scenarioCount" | "passCount" | "failCount" | "zeroToleranceFailures" | "satisfactory">

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

export function isGateSatisfactory(summary: EvalGateFields): boolean {
  return summary.scenarioCount > 0
    && summary.passCount + summary.failCount === summary.scenarioCount
    && summary.failCount === 0
    && summary.zeroToleranceFailures === 0
    && summary.satisfactory === true
}

export function summarizeEvalGate<Tag extends string>(
  results: readonly EvalResultWithFailureTags<Tag>[],
  zeroToleranceFailureTags: ReadonlySet<Tag> | Partial<Record<Tag, true>>,
): EvalGateSummary {
  const isZeroTolerance = zeroToleranceFailureTags instanceof Set
    ? (tag: Tag) => zeroToleranceFailureTags.has(tag)
    : (tag: Tag) => zeroToleranceFailureTags[tag] === true
  const failCount = results.filter((result) => !isEvalResultPassed(result)).length
  const zeroToleranceFailures = results.reduce((sum, result) => sum + result.failureTags.filter(isZeroTolerance).length, 0)
  const summary = {
    scenarioCount: results.length,
    passCount: results.length - failCount,
    failCount,
    zeroToleranceFailures,
    failureTagCounts: countFailureTags(results),
    satisfactory: true,
  }
  return {
    ...summary,
    satisfactory: isGateSatisfactory(summary),
  }
}
