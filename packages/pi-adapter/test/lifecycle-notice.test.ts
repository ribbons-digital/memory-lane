import * as assert from "node:assert/strict"
import { test } from "node:test"
import type { LifecycleCaptureResult } from "@memory-lane/lifecycle"
import type { MemoryRecord, SaveResult } from "@memory-lane/core"
import { lifecyclePendingWritten } from "../src/lifecycle-notice.js"

function pendingSave(): SaveResult {
  return {
    status: "saved",
    memory: {
      id: "pending-1",
      text: "A pending lifecycle candidate.",
      category: "project",
      scope: { type: "project", key: "project" },
      status: "pending",
      source: "agent-suggested",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } satisfies MemoryRecord,
  }
}

function capture(pendingWritten: number): LifecycleCaptureResult {
  return {
    mode: "conservative",
    limits: { perTurn: 2, perSession: 8, pendingBacklog: 20 },
    pendingWritten,
    approvedWritten: 0,
    explicitWritten: 0,
    suppressed: 0,
    qualitySuppressed: 0,
    limitSuppressed: 0,
    automaticPendingBacklog: pendingWritten,
  }
}

test("lifecycle pending notice count prefers the authoritative capture result", () => {
  assert.equal(lifecyclePendingWritten([pendingSave()], capture(3)), 3)
})

test("lifecycle pending notice count falls back to newly saved pending records", () => {
  assert.equal(lifecyclePendingWritten([pendingSave(), { status: "skipped", reason: "duplicate" }]), 1)
})
