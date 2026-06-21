import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildFreshnessStatus } from "../src/freshness.js"
import type { MemoryRecord } from "../src/types.js"

function memory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: overrides.id ?? "mem-1",
    status: overrides.status ?? "approved",
    text: overrides.text ?? "Private memory body that must never be returned",
    category: overrides.category ?? "project",
    scope: overrides.scope ?? { type: "project", key: "project-a" },
    source: overrides.source ?? "manual",
    createdAt: overrides.createdAt ?? "2026-06-18T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-18T00:00:00.000Z",
    project: overrides.project,
    kind: overrides.kind ?? "project_fact",
    provenance: overrides.provenance,
    freshness: overrides.freshness,
  }
}

describe("buildFreshnessStatus", () => {
  it("reports visible approved freshness metadata without memory text", () => {
    const memories = [
      memory({
        id: "project-new",
        text: "Private project memory body",
        updatedAt: "2026-06-18T10:00:00.000Z",
        scope: { type: "project", key: "project-a" },
        kind: "project_checkpoint",
        source: "session-summary",
        provenance: { adapter: "pi", lifecycleEvent: "session_end" },
      }),
      memory({
        id: "global-pref",
        text: "Private global preference body",
        updatedAt: "2026-06-18T09:00:00.000Z",
        scope: { type: "global" },
        category: "preference",
        kind: "preference",
      }),
      memory({ id: "old", updatedAt: "2026-06-17T09:00:00.000Z", scope: { type: "project", key: "project-a" } }),
      memory({ id: "other-project", updatedAt: "2026-06-18T11:00:00.000Z", scope: { type: "project", key: "project-b" } }),
      memory({ id: "pending", status: "pending", updatedAt: "2026-06-18T12:00:00.000Z", scope: { type: "project", key: "project-a" } }),
    ]

    const status = buildFreshnessStatus(memories, { projectScopeKey: "project-a", since: "2026-06-18T08:00:00.000Z" })
    const serialized = JSON.stringify(status)

    assert.equal(status.projectScope, "project-a")
    assert.equal(status.referenceTime, "2026-06-18T08:00:00.000Z")
    assert.equal(status.visibleApprovedCount, 3)
    assert.equal(status.newerApprovedCount, 2)
    assert.equal(status.newerProjectApprovedCount, 1)
    assert.equal(status.newerGlobalApprovedCount, 1)
    assert.equal(status.newerGlobalPreferenceCount, 1)
    assert.equal(status.latestApproved?.id, "project-new")
    assert.equal(status.latestProjectApproved?.id, "project-new")
    assert.equal(status.latestGlobalApproved?.id, "global-pref")
    assert.deepEqual(status.newerByKind, { project_checkpoint: 1, preference: 1 })
    assert.deepEqual(status.newerBySource, { "session-summary": 1, manual: 1 })
    assert.deepEqual(status.newerByProvenance, { "pi/session_end": 1, none: 1 })
    assert.deepEqual(status.newestNewerApproved.map((m) => m.id), ["project-new", "global-pref"])
    assert.equal(status.newestNewerApproved[0]?.status, "approved")
    assert.ok(status.notice?.includes("2 approved Memory Lane memories"))
    assert.doesNotMatch(serialized, /Private project memory body/u)
    assert.doesNotMatch(serialized, /Private global preference body/u)
    assert.doesNotMatch(serialized, /Private memory body/u)
    assert.doesNotMatch(serialized, /other-project/u)
    assert.doesNotMatch(serialized, /pending/u)
  })

  it("reports no-project scope as global-only visibility", () => {
    const status = buildFreshnessStatus([
      memory({ id: "global", scope: { type: "global" }, updatedAt: "2026-06-18T01:00:00.000Z" }),
      memory({ id: "project", scope: { type: "project", key: "project-a" }, updatedAt: "2026-06-18T02:00:00.000Z" }),
    ], { projectScopeKey: undefined, since: "2026-06-18T00:00:00.000Z" })

    assert.equal(status.projectScope, "none")
    assert.equal(status.visibleApprovedCount, 1)
    assert.equal(status.newerApprovedCount, 1)
    assert.equal(status.newestNewerApproved[0]?.id, "global")
    assert.equal(status.latestProjectApproved, undefined)
  })

  it("caps newest newer metadata to five by default", () => {
    const memories = Array.from({ length: 6 }, (_, index) => memory({
      id: `newer-${index}`,
      scope: { type: "global" },
      updatedAt: `2026-06-18T0${index + 1}:00:00.000Z`,
    }))

    const status = buildFreshnessStatus(memories, { since: "2026-06-18T00:00:00.000Z" })

    assert.equal(status.newerApprovedCount, 6)
    assert.deepEqual(status.newestNewerApproved.map((m) => m.id), ["newer-5", "newer-4", "newer-3", "newer-2", "newer-1"])
  })

  it("supports custom newest newer metadata caps", () => {
    const memories = [
      memory({ id: "first", scope: { type: "global" }, updatedAt: "2026-06-18T01:00:00.000Z" }),
      memory({ id: "second", scope: { type: "global" }, updatedAt: "2026-06-18T02:00:00.000Z" }),
      memory({ id: "third", scope: { type: "global" }, updatedAt: "2026-06-18T03:00:00.000Z" }),
    ]

    const status = buildFreshnessStatus(memories, {
      since: "2026-06-18T00:00:00.000Z",
      maxNewerMetadata: 2,
    })

    assert.deepEqual(status.newestNewerApproved.map((m) => m.id), ["third", "second"])
  })

  it("does not include a notice without newer memories", () => {
    const status = buildFreshnessStatus([
      memory({ id: "old-global", scope: { type: "global" }, updatedAt: "2026-06-17T00:00:00.000Z" }),
    ], { since: "2026-06-18T00:00:00.000Z" })

    assert.equal(status.newerApprovedCount, 0)
    assert.equal(status.notice, undefined)
  })

  it("classifies expired stale current and none advisories without memory text", () => {
    const status = buildFreshnessStatus([
      memory({ id: "expired", text: "SECRET expired", freshness: { expiresAt: "2026-06-18T00:00:00.000Z" } }),
      memory({ id: "stale", text: "SECRET stale", updatedAt: "2026-06-10T00:00:00.000Z", freshness: { staleAfterDays: 3 } }),
      memory({ id: "current", text: "SECRET current", freshness: { staleAfterDays: 10, capturedAt: "2026-06-17T00:00:00.000Z" } }),
      memory({ id: "none", text: "SECRET none" }),
    ], { projectScopeKey: "project-a", referenceNow: "2026-06-19T00:00:00.000Z" })

    assert.equal(status.advisory.referenceNow, "2026-06-19T00:00:00.000Z")
    assert.equal(status.advisory.withFreshnessCount, 3)
    assert.equal(status.advisory.expiredCount, 1)
    assert.equal(status.advisory.staleCount, 1)
    assert.equal(status.advisory.currentCount, 1)
    assert.equal(status.advisory.expired[0]?.id, "expired")
    assert.equal(status.advisory.expired[0]?.freshness?.classification, "expired")
    assert.deepEqual(status.advisory.expired[0]?.freshness?.suggestedActions, [
      "memory-lane update expired --text <updated-memory-text> --dry-run",
      "memory-lane replace expired --text <new-memory-text> --dry-run",
      "memory-lane supersede <new-id> expired --dry-run",
    ])
    assert.equal(status.advisory.stale[0]?.id, "stale")
    assert.equal(status.advisory.stale[0]?.freshness?.classification, "stale")
    assert.equal(status.advisory.stale[0]?.freshness?.staleAnchor, "2026-06-10T00:00:00.000Z")
    assert.deepEqual(status.advisory.stale[0]?.freshness?.suggestedActions, ["memory-lane update stale --text <updated-memory-text> --dry-run"])
    assert.doesNotMatch(JSON.stringify(status), /SECRET/u)
    assert.doesNotMatch(JSON.stringify(status), /memory-lane reject|memory-lane delete/u)
  })

  it("uses capturedAt before updatedAt for stale windows", () => {
    const status = buildFreshnessStatus([
      memory({
        id: "captured-current",
        updatedAt: "2026-06-01T00:00:00.000Z",
        freshness: { staleAfterDays: 10, capturedAt: "2026-06-18T00:00:00.000Z" },
      }),
    ], { projectScopeKey: "project-a", referenceNow: "2026-06-19T00:00:00.000Z" })

    assert.equal(status.advisory.staleCount, 0)
    assert.equal(status.advisory.currentCount, 1)
    assert.equal(status.advisory.withFreshnessCount, 1)
    assert.deepEqual(status.advisory.stale, [])
    assert.deepEqual(status.advisory.expired, [])
  })

  it("caps stale and expired advisory metadata", () => {
    const memories = Array.from({ length: 4 }, (_, index) => memory({
      id: `expired-${index}`,
      updatedAt: `2026-06-18T0${index}:00:00.000Z`,
      freshness: { expiresAt: "2026-06-18T00:00:00.000Z" },
    }))

    const status = buildFreshnessStatus(memories, { projectScopeKey: "project-a", referenceNow: "2026-06-19T00:00:00.000Z", maxNewerMetadata: 2 })

    assert.equal(status.advisory.expiredCount, 4)
    assert.deepEqual(status.advisory.expired.map((item) => item.id), ["expired-3", "expired-2"])
  })

  it("rejects invalid since and referenceNow timestamps", () => {
    assert.throws(
      () => buildFreshnessStatus([], { projectScopeKey: "project-a", since: "not-a-date" }),
      /Invalid since timestamp/u,
    )
    assert.throws(
      () => buildFreshnessStatus([], { projectScopeKey: "project-a", referenceNow: "not-a-date" }),
      /Invalid referenceNow timestamp/u,
    )
  })
})
