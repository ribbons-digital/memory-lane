import test from "node:test"
import assert from "node:assert/strict"
import type { MemoryRecord } from "@memory-lane/core"
import { formatReviewMutation } from "../src/formatters.js"
import { applyGroupedReviewMutation } from "../src/review-mutation.js"

function memory(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    text: `Pending candidate ${id}`,
    category: "project",
    scope: { type: "project", key: "review-project" },
    status: "pending",
    source: "agent-suggested",
    kind: "project_fact",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }
}

test("grouped review mutation preflights every candidate before the first write", () => {
  const expected = [memory("first"), memory("second")]
  const current = new Map(expected.map((candidate) => [candidate.id, candidate]))
  current.set("second", memory("second", { status: "approved", updatedAt: "2026-07-01T01:00:00.000Z" }))
  const mutated: string[] = []

  assert.throws(() => applyGroupedReviewMutation({
    action: "reject",
    expected,
    resolve: (id) => current.get(id),
    mutate: (id) => mutated.push(id),
  }), /preflight failed before any writes.*second/u)
  assert.deepEqual(mutated, [])
})

test("grouped review mutation rejects same-status candidate changes before writing", () => {
  const expected = [memory("first"), memory("second")]
  const current = new Map(expected.map((candidate) => [candidate.id, candidate]))
  current.set("second", memory("second", { text: "Changed pending candidate", updatedAt: "2026-07-01T01:00:00.000Z" }))
  const mutated: string[] = []

  assert.throws(() => applyGroupedReviewMutation({
    action: "approve",
    expected,
    resolve: (id) => current.get(id),
    mutate: (id) => mutated.push(id),
  }), /preflight failed before any writes.*second/u)
  assert.deepEqual(mutated, [])
})

test("grouped review mutation reports exact applied and remaining IDs after a storage failure", () => {
  const expected = [memory("first"), memory("second"), memory("third")]
  const current = new Map(expected.map((candidate) => [candidate.id, candidate]))

  const result = applyGroupedReviewMutation({
    action: "reject",
    expected,
    resolve: (id) => current.get(id),
    mutate: (id) => {
      if (id === "second") throw new Error("simulated storage failure")
      return memory(id, { status: "rejected" })
    },
  })

  assert.deepEqual(result, {
    status: "partial",
    action: "reject",
    memoryIds: ["first", "second", "third"],
    appliedMemoryIds: ["first"],
    remainingMemoryIds: ["third"],
    uncertainMemoryIds: ["second"],
    failedMemoryId: "second",
    error: "simulated storage failure",
  })

  const rendered = JSON.parse(formatReviewMutation({
    ...result,
    broadScopeMemoryIds: [],
    requiresBroadScopeConfirmation: false,
    confirmationIds: "first,second,third",
  }, true))
  assert.equal(rendered.ok, false)
  assert.match(rendered.error, /partially applied/u)
  assert.equal(rendered.data.reviewMutation.status, "partial")
  assert.deepEqual(rendered.data.reviewMutation.appliedMemoryIds, ["first"])
  assert.deepEqual(rendered.data.reviewMutation.uncertainMemoryIds, ["second"])
  assert.deepEqual(rendered.data.reviewMutation.remainingMemoryIds, ["third"])
})
