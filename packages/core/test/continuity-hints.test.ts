import test from "node:test"
import assert from "node:assert/strict"
import { buildContinuityHints, type MemoryRecord } from "../src/index.js"

function memory(overrides: Partial<MemoryRecord> & { id: string; text?: string }): MemoryRecord {
  return {
    id: overrides.id,
    text: overrides.text ?? `PRIVATE TEXT ${overrides.id}`,
    category: overrides.category ?? "project",
    scope: overrides.scope ?? { type: "project", key: "project-a" },
    status: overrides.status ?? "approved",
    source: overrides.source ?? "manual",
    kind: overrides.kind ?? "project_fact",
    createdAt: overrides.createdAt ?? "2026-06-18T08:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-18T08:00:00.000Z",
    provenance: overrides.provenance,
    revision: overrides.revision,
    project: overrides.project,
  }
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

test("continuity hints report superseded approved visible memories without text", () => {
  const result = buildContinuityHints([
    memory({ id: "old-loop", text: "SECRET OLD LOOP TEXT", revision: { supersededBy: "new-loop", revisedAt: "2026-06-18T09:00:00.000Z", revisedBy: "cli" } }),
    memory({ id: "new-loop", text: "SECRET NEW LOOP TEXT", kind: "workflow_rule" }),
    memory({ id: "pending-old", status: "pending", revision: { supersededBy: "new-loop", revisedAt: "2026-06-18T09:00:00.000Z", revisedBy: "cli" } }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.projectScope, "project-a")
  assert.equal(result.supersededVisible.length, 1)
  assert.equal(result.supersededVisible[0].id, "old-loop")
  assert.equal(result.supersededVisible[0].supersededBy, "new-loop")
  assert.ok(result.hints.some((hint) => hint.code === "superseded-visible"))
  assert.match(result.suggestedActions.join("\n"), /memory-lane list --json/u)
  assert.doesNotMatch(json(result), /SECRET OLD LOOP TEXT|SECRET NEW LOOP TEXT/u)
})

test("continuity hints report operating agreement overlap by workflow area", () => {
  const result = buildContinuityHints([
    memory({ id: "project-loop-current", text: "Project workflow loop: spec approval then implementation", kind: "workflow_rule", updatedAt: "2026-06-18T10:00:00.000Z" }),
    memory({ id: "project-loop-related", text: "Project workflow loop: older spec approval process", kind: "project_fact", updatedAt: "2026-06-18T09:00:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.operatingAgreementOverlaps, [{
    workflowArea: "project-loop",
    primaryIds: ["project-loop-current"],
    relatedIds: ["project-loop-related"],
  }])
  assert.ok(result.hints.some((hint) => hint.code === "operating-agreement-overlap" && hint.workflowArea === "project-loop"))
  assert.match(result.suggestedActions.join("\n"), /memory-lane agreements --area project-loop/u)
})

test("continuity hints report project global preference overlap", () => {
  const result = buildContinuityHints([
    memory({ id: "project-pr", text: "PR process: open a pull request and wait for merge", kind: "workflow_rule", category: "project", scope: { type: "project", key: "project-a" } }),
    memory({ id: "global-pr", text: "PR process: use feature branch and pull request", kind: "workflow_rule", category: "preference", scope: { type: "global" } }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.projectGlobalPreferenceOverlaps, [{
    workflowArea: "pr-process",
    projectIds: ["project-pr"],
    globalIds: ["global-pr"],
  }])
  assert.ok(result.hints.some((hint) => hint.code === "project-global-overlap" && hint.workflowArea === "pr-process"))
  assert.match(result.suggestedActions.join("\n"), /memory-lane agreements --all/u)
})

test("continuity hints include newer approved metadata when since is provided", () => {
  const result = buildContinuityHints([
    memory({ id: "newer-project", updatedAt: "2026-06-18T10:00:00.000Z", provenance: { adapter: "pi", lifecycleEvent: "session_end" } }),
    memory({ id: "old-project", updatedAt: "2026-06-17T10:00:00.000Z" }),
  ], { projectScopeKey: "project-a", since: "2026-06-18T09:00:00.000Z" })

  assert.deepEqual(result.newerApproved, {
    referenceTime: "2026-06-18T09:00:00.000Z",
    count: 1,
    newestIds: ["newer-project"],
  })
  assert.ok(result.hints.some((hint) => hint.code === "newer-approved"))
  assert.match(result.suggestedActions.join("\n"), /memory-lane status --json --since 2026-06-18T09:00:00.000Z/u)
})

test("continuity hints respect project scope plus global visibility", () => {
  const result = buildContinuityHints([
    memory({ id: "visible-old", revision: { supersededBy: "new", revisedAt: "2026-06-18T09:00:00.000Z", revisedBy: "cli" } }),
    memory({ id: "other-project-old", scope: { type: "project", key: "project-b" }, revision: { supersededBy: "new", revisedAt: "2026-06-18T09:00:00.000Z", revisedBy: "cli" } }),
    memory({ id: "global-old", scope: { type: "global" }, revision: { supersededBy: "new", revisedAt: "2026-06-18T09:00:00.000Z", revisedBy: "cli" } }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.supersededVisible.map((item) => item.id), ["global-old", "visible-old"])
})
