import test from "node:test"
import assert from "node:assert/strict"
import { analyzeSummaryHygiene, withReviewHygiene } from "../src/summary-hygiene.ts"
import type { MemoryRecord } from "../src/types.ts"

function memory(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "m1",
    text: "Summary text",
    category: "project",
    scope: { type: "project", key: "repo" },
    status: "pending",
    source: "session-summary",
    kind: "session_summary",
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
    ...overrides,
  }
}

test("summary hygiene suppresses operational-only delegated subagent summary", () => {
  const result = analyzeSummaryHygiene(`## Session Summary\n\n- Delegated subagent completed task 3 only.\n- Acceptance finalization compared the current work to the acceptance contract.\n- Reviewer returned APPROVED.`, { kind: "session_summary", source: "session-summary" })

  assert.equal(result.operationalChatter, true)
  assert.equal(result.durableOutcome, false)
  assert.equal(result.action, "suppress")
  assert.ok(result.reasons.includes("delegated-subagent"))
  assert.ok(result.reasons.includes("acceptance-finalization"))
})

test("summary hygiene keeps subagent summary with durable project outcome", () => {
  const result = analyzeSummaryHygiene(`## Session Summary\n\n- Subagent reviewed the implementation.\n- Merged PR #62 and released v0.2.33 after tests passed.\n- Next step: design Phase 21 Slice 7 summary hygiene.`, { kind: "session_summary", source: "session-summary" })

  assert.equal(result.operationalChatter, true)
  assert.equal(result.durableOutcome, true)
  assert.equal(result.action, "keep")
  assert.ok(result.reasons.includes("durable-outcome"))
})

test("summary hygiene hints memory-review-management summaries", () => {
  const result = analyzeSummaryHygiene(`## Session Summary\n\n- Reviewed pending Memory Lane memories.\n- Next steps: approve memory IDs 33428846, 44dfe8a5, and reject 7d2a32a9.\n- Run memory-lane review.`, { kind: "session_summary", source: "session-summary" })

  assert.equal(result.operationalChatter, true)
  assert.equal(result.action, "suppress")
  assert.ok(result.reasons.includes("memory-review-management"))
})

test("summary hygiene ignores ordinary project summary", () => {
  const result = analyzeSummaryHygiene(`## Session Summary\n\n- Implemented continuity read-model fields.\n- Tests and build passed.\n- Next step: cut release.`, { kind: "session_summary", source: "session-summary" })

  assert.equal(result.operationalChatter, false)
  assert.equal(result.durableOutcome, true)
  assert.equal(result.action, "keep")
})

test("withReviewHygiene adds read-only metadata only for suspect pending memories", () => {
  const suspect = withReviewHygiene(memory({ text: "## Session Summary\nDelegated subagent completed task 2 only. Report status as APPROVED." }))
  assert.equal(suspect.reviewHygiene?.operationalChatter, true)
  assert.equal(suspect.reviewHygiene?.suggestedAction, "consider-rejecting")

  const normal = withReviewHygiene(memory({ id: "m2", text: "## Session Summary\nReleased v0.2.33 and verified the release workflow." }))
  assert.equal(normal.reviewHygiene, undefined)

  const approved = withReviewHygiene(memory({ id: "m3", status: "approved", text: "Delegated subagent completed task only." }))
  assert.equal(approved.reviewHygiene, undefined)
})
