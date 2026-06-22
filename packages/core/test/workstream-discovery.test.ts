import test from "node:test"
import assert from "node:assert/strict"
import { discoverWorkstreams, type MemoryRecord } from "../src/index.js"

function memory(overrides: Partial<MemoryRecord> & { id: string; text?: string }): MemoryRecord {
  return {
    id: overrides.id,
    text: overrides.text ?? `Memory ${overrides.id}`,
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
    freshness: overrides.freshness,
  }
}

test("discovers approved current-project checkpoint for resume query", () => {
  const result = discoverWorkstreams([
    memory({ id: "global", text: "Global automatic handoff workflow rule", scope: { type: "global" }, category: "preference", kind: "workflow_rule" }),
    memory({ id: "other-project", text: "Automatic handoff mode landed elsewhere", scope: { type: "project", key: "other" }, kind: "project_checkpoint" }),
    memory({ id: "pending", text: "Automatic handoff pending candidate", status: "pending", kind: "session_summary" }),
    memory({ id: "checkpoint", text: "PR #38 merged automatic handoff validation; next action: resume workstream discovery implementation.", kind: "project_checkpoint", updatedAt: "2026-06-18T10:00:00.000Z" }),
  ], { projectScopeKey: "project-a", query: "resume building automatic handoff" })

  assert.equal(result.projectScope, "project-a")
  assert.equal(result.query, "resume building automatic handoff")
  assert.equal(result.intent, "resume")
  assert.deepEqual(result.topicTerms.slice(0, 2), ["automatic", "handoff"])
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["checkpoint"])
  assert.ok(result.candidates[0]?.matchReasons.includes("topic:automatic"))
  assert.equal(result.candidates[0]?.kind, "project_checkpoint")
})

test("extracts PR branch commit and release references", () => {
  const result = discoverWorkstreams([
    memory({
      id: "refs",
      kind: "project_checkpoint",
      text: "Merged PR #39 from branch docs/phase-21-workstream-discovery at commit 84692b9 and released v0.2.21 for workstream discovery.",
    }),
  ], { projectScopeKey: "project-a", query: "where was workstream discovery implemented" })

  assert.deepEqual(result.candidates[0]?.references.pullRequests, ["#39"])
  assert.deepEqual(result.candidates[0]?.references.branches, ["docs/phase-21-workstream-discovery"])
  assert.deepEqual(result.candidates[0]?.references.commits, ["84692b9"])
  assert.deepEqual(result.candidates[0]?.references.releases, ["v0.2.21"])
})

test("returns no-project-scope warning without broadening to globals", () => {
  const result = discoverWorkstreams([
    memory({ id: "global", text: "Global memory mentions workstream discovery", scope: { type: "global" }, category: "project", kind: "project_fact" }),
  ], { query: "resume workstream discovery" })

  assert.equal(result.projectScope, "none")
  assert.deepEqual(result.candidates, [])
  assert.ok(result.warnings.some((warning) => warning.code === "no-project-scope"))
})

test("demotes stale and superseded candidates while keeping revision pointers", () => {
  const result = discoverWorkstreams([
    memory({ id: "superseded", text: "Workstream discovery implementation plan", kind: "project_checkpoint", updatedAt: "2026-06-18T12:00:00.000Z", revision: { supersededBy: "successor", revisedAt: "2026-06-18T12:30:00.000Z", revisedBy: "cli" } }),
    memory({ id: "stale", text: "Workstream discovery implementation details", kind: "project_checkpoint", updatedAt: "2026-06-18T11:00:00.000Z", freshness: { staleAfterDays: 1, capturedAt: "2026-06-18T11:00:00.000Z" } }),
    memory({ id: "successor", text: "Workstream discovery implementation completed", kind: "project_checkpoint", updatedAt: "2026-06-18T10:00:00.000Z" }),
  ], { projectScopeKey: "project-a", query: "workstream discovery implementation", referenceNow: "2026-06-20T11:00:00.000Z" })

  assert.equal(result.candidates[0]?.id, "successor")
  assert.ok(result.candidates.find((candidate) => candidate.id === "superseded")?.matchReasons.includes("superseded-record"))
  assert.equal(result.candidates.find((candidate) => candidate.id === "superseded")?.revision?.supersededBy, "successor")
  assert.ok(result.candidates.find((candidate) => candidate.id === "stale")?.matchReasons.includes("stale-freshness"))
})

test("omits secret-like discovery candidates", () => {
  const result = discoverWorkstreams([
    memory({ id: "secret", text: "Workstream discovery api_key = sk-1234567890abcdef1234567890abcdef", kind: "project_checkpoint" }),
    memory({ id: "safe", text: "Workstream discovery safe checkpoint", kind: "project_checkpoint" }),
  ], { projectScopeKey: "project-a", query: "workstream discovery" })

  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["safe"])
  assert.doesNotMatch(JSON.stringify(result), /sk-1234567890|api_key/u)
})

test("classifies where-are-we phrasing as status intent", () => {
  const result = discoverWorkstreams([
    memory({ id: "status", text: "Workstream discovery is implemented", kind: "project_checkpoint" }),
  ], { projectScopeKey: "project-a", query: "where are we on workstream discovery" })

  assert.equal(result.intent, "status")
})
