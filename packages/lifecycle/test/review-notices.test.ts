import test from "node:test"
import assert from "node:assert/strict"
import type { LifecycleResult } from "../src/types.ts"
import { pendingReviewCount, renderPendingReviewNotice } from "../src/review-notices.ts"

function lifecycleResult(statuses: Array<"pending" | "approved">): LifecycleResult {
  return {
    saved: statuses.map((status, index) => ({
      status: "saved" as const,
      memory: {
        id: `secret-id-${index}`,
        status,
        text: `PRIVATE MEMORY BODY ${index}`,
        category: "project" as const,
        scope: { type: "project" as const, key: "/tmp/project" },
        source: "agent-suggested" as const,
        createdAt: "2026-06-19T00:00:00.000Z",
        updatedAt: "2026-06-19T00:00:00.000Z",
        kind: "project_fact" as const,
      },
    })),
    discarded: [],
  }
}

test("pendingReviewCount counts only newly saved pending memories", () => {
  assert.equal(pendingReviewCount(lifecycleResult(["pending", "approved", "pending"])), 2)
  assert.equal(pendingReviewCount({ saved: [{ status: "skipped", reason: "duplicate" }], discarded: [] }), 0)

  const revisedOnly = lifecycleResult([])
  revisedOnly.revised = lifecycleResult(["pending"]).saved.flatMap((entry) => entry.status === "saved" ? [entry.memory] : [])
  assert.equal(pendingReviewCount(revisedOnly), 0)
  assert.equal(renderPendingReviewNotice(revisedOnly), undefined)
})

test("renderPendingReviewNotice returns undefined when nothing pending was saved", () => {
  assert.equal(renderPendingReviewNotice(lifecycleResult(["approved"])), undefined)
})

test("renderPendingReviewNotice renders singular and plural review guidance", () => {
  assert.equal(
    renderPendingReviewNotice(lifecycleResult(["pending"])),
    "suggested 1 pending memory for review. Run `memory-lane review` to approve or reject it.",
  )
  assert.equal(
    renderPendingReviewNotice(lifecycleResult(["pending", "pending"])),
    "suggested 2 pending memories for review. Run `memory-lane review` to approve or reject them.",
  )
})

test("renderPendingReviewNotice is text-free", () => {
  const notice = renderPendingReviewNotice(lifecycleResult(["pending"])) ?? ""
  assert.doesNotMatch(notice, /PRIVATE MEMORY BODY/u)
  assert.doesNotMatch(notice, /secret-id/u)
  assert.match(notice, /memory-lane review/u)
})
