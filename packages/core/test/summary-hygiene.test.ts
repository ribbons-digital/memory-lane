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

test("summary hygiene suppresses an operationally dominated summary despite a durable project outcome", () => {
  const result = analyzeSummaryHygiene(`## Session Summary\n\n- Subagent reviewed the implementation.\n- Merged PR #62 and released v0.2.33 after tests passed.\n- Next step: design Phase 21 Slice 7 summary hygiene.`, { kind: "session_summary", source: "session-summary" })

  assert.equal(result.operationalChatter, true)
  assert.equal(result.durableOutcome, true)
  assert.equal(result.action, "suppress")
  assert.ok(result.reasons.includes("durable-outcome"))
  assert.ok(result.reasons.includes("operational-dominance"))
})

test("summary hygiene hints memory-review-management summaries", () => {
  const result = analyzeSummaryHygiene(`## Session Summary\n\n- Reviewed pending Memory Lane memories.\n- Next steps: approve memory IDs 33428846, 44dfe8a5, and reject 7d2a32a9.\n- Run memory-lane review.`, { kind: "session_summary", source: "session-summary" })

  assert.equal(result.operationalChatter, true)
  assert.equal(result.action, "suppress")
  assert.ok(result.reasons.includes("memory-review-management"))
})

test("summary hygiene detects memory review management short forms", () => {
  const rejectId = analyzeSummaryHygiene("Next step: reject 7d2a32a9", { kind: "session_summary", source: "session-summary" })
  assert.equal(rejectId.operationalChatter, true)
  assert.equal(rejectId.durableOutcome, false)
  assert.equal(rejectId.action, "suppress")
  assert.ok(rejectId.reasons.includes("memory-review-management"))

  const approveMemory = analyzeSummaryHygiene("Approve memory 33428846 after checking the queue.", { kind: "session_summary", source: "session-summary" })
  assert.equal(approveMemory.operationalChatter, true)
  assert.equal(approveMemory.action, "suppress")

  const rejectThose = analyzeSummaryHygiene("Reject those memories because they are duplicate review chatter.", { kind: "session_summary", source: "session-summary" })
  assert.equal(rejectThose.operationalChatter, true)
  assert.equal(rejectThose.action, "suppress")
})

test("summary hygiene detects slash review command and spaced review status", () => {
  const slashReview = analyzeSummaryHygiene("Run /memory review and approve memory 33428846.", { kind: "session_summary", source: "session-summary" })
  assert.equal(slashReview.operationalChatter, true)
  assert.ok(slashReview.reasons.includes("memory-review-management"))

  const changesRequested = analyzeSummaryHygiene("Reviewer returned changes requested for task 2 only.", { kind: "session_summary", source: "session-summary" })
  assert.equal(changesRequested.operationalChatter, true)
  assert.ok(changesRequested.reasons.includes("review-status-label"))
})

test("summary hygiene ignores ordinary project summary", () => {
  const result = analyzeSummaryHygiene(`## Session Summary\n\n- Implemented continuity read-model fields.\n- Tests and build passed.\n- Next step: cut release.`, { kind: "session_summary", source: "session-summary" })

  assert.equal(result.operationalChatter, true)
  assert.equal(result.durableOutcome, true)
  assert.equal(result.action, "keep")
})

test("summary hygiene does not treat standalone approval prose as review-status label", () => {
  const result = analyzeSummaryHygiene("Approved the proposed onboarding copy after comparing it with the product goals.", { kind: "session_summary", source: "session-summary" })

  assert.equal(result.operationalChatter, false)
  assert.equal(result.action, "keep")
})

test("summary hygiene treats section headers as durable outcomes", () => {
  const result = analyzeSummaryHygiene("Procedure:\n- Run memory-lane review before approving memories.", { kind: "session_summary", source: "session-summary" })

  assert.equal(result.operationalChatter, true)
  assert.equal(result.durableOutcome, true)
  assert.equal(result.action, "keep")
  assert.ok(result.reasons.includes("durable-outcome"))
})

test("summary hygiene returns hint for operational chatter without session-summary options", () => {
  const result = analyzeSummaryHygiene("Delegated subagent completed task 3 only and reported status as blocked.")

  assert.equal(result.operationalChatter, true)
  assert.equal(result.durableOutcome, false)
  assert.equal(result.action, "hint")
  assert.ok(result.reasons.includes("delegated-subagent"))
})

test("summary hygiene returns hint for non-summary operational memories", () => {
  const result = analyzeSummaryHygiene("Delegated subagent completed task 3 only and reported status as blocked.", { kind: "project_fact", source: "agent-suggested" })

  assert.equal(result.operationalChatter, true)
  assert.equal(result.durableOutcome, false)
  assert.equal(result.action, "hint")
})

test("summary hygiene measures durable density by claim instead of broad outcome keywords", () => {
  const result = analyzeSummaryHygiene([
    "- Fixed the current branch.",
    "- Reviewer should inspect the patch next turn.",
    "- Run git status and preserve the branch.",
    "- Verification is still pending.",
  ].join("\n"), { kind: "session_summary", source: "session-summary" })

  assert.equal(result.durableClaimCount, 0)
  assert.equal(result.claimCount, 4)
  assert.equal(result.durableContentDensity, 0)
  assert.equal(result.action, "suppress")
  assert.ok(result.reasons.includes("operational-dominance"))
})

test("summary hygiene classifies durable and temporary claims by section", () => {
  const result = analyzeSummaryHygiene([
    "## Decisions made",
    "- Windows recovery must preserve quoted arguments.",
    "## Procedures",
    "- Resolve the launcher and verify the recovered exit code.",
    "## Key project facts",
    "- The Windows package includes a native executable fallback.",
    "## Checkpoints",
    "- PR #212 merged with regression coverage.",
    "## Temporary handoff state",
    "- Branch fix/windows remains checked out for the next turn.",
  ].join("\n"), { kind: "session_summary", source: "session-summary" })

  assert.deepEqual(result.claims.map((claim) => claim.classification), [
    "decision",
    "procedure",
    "project_fact",
    "checkpoint",
    "temporary_handoff",
  ])
  assert.equal(result.durableClaimCount, 4)
  assert.equal(result.claimCount, 5)
  assert.equal(result.durableContentDensity, 0.8)
})

test("withReviewHygiene adds read-only metadata only for suspect pending memories", () => {
  const suspect = withReviewHygiene(memory({ text: "## Session Summary\nDelegated subagent completed task 2 only. Report status as APPROVED." }))
  assert.equal(suspect.reviewHygiene?.operationalChatter, true)
  assert.equal(suspect.reviewHygiene?.suggestedAction, "consider-rejecting")

  const normal = withReviewHygiene(memory({ id: "m2", text: "## Session Summary\nReleased v0.2.33 and verified the release workflow." }))
  assert.equal(normal.reviewHygiene, undefined)

  const operationalWithOutcome = withReviewHygiene(memory({ id: "m4", text: "## Session Summary\nSubagent reviewed the implementation. Merged PR #62 and released v0.2.33." }))
  assert.equal(operationalWithOutcome.reviewHygiene?.suggestedAction, "consider-rejecting")

  const approved = withReviewHygiene(memory({ id: "m3", status: "approved", text: "Delegated subagent completed task only." }))
  assert.equal(approved.reviewHygiene, undefined)
})
