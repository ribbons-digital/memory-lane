import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { buildContinuityReadModel, MemoryEngine, type MemoryRecord } from "../src/index.js"
import { tempDir } from "./helpers.js"

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
  }
}

test("continuity read model selects latest approved project continuity with bounded preview", () => {
  const result = buildContinuityReadModel([
    memory({ id: "old", text: "Old project fact", kind: "project_fact", updatedAt: "2026-06-18T08:00:00.000Z" }),
    memory({ id: "checkpoint", text: "Released v0.2.11 with unified release assets and checks passing.", kind: "project_checkpoint", updatedAt: "2026-06-18T10:00:00.000Z" }),
    memory({ id: "global-workflow", text: "Global workflow preference", category: "preference", scope: { type: "global" }, kind: "workflow_rule", updatedAt: "2026-06-18T11:00:00.000Z" }),
    memory({ id: "global-personal", text: "My favorite coffee is espresso.", category: "personal", scope: { type: "global" }, kind: "personal_context", updatedAt: "2026-06-18T12:00:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.projectScope, "project-a")
  assert.equal(result.latestApproved.project?.id, "checkpoint")
  assert.equal(result.latestApproved.project?.preview, "Released v0.2.11 with unified release assets and checks passing.")
  assert.equal(result.latestApproved.global?.id, "global-workflow")
  assert.equal(result.status.visibleApprovedCount, 4)
})


test("continuity read model omits arbitrary non-workflow global approved memory", () => {
  const result = buildContinuityReadModel([
    memory({ id: "checkpoint", text: "Approved project checkpoint", kind: "project_checkpoint" }),
    memory({ id: "global-personal", text: "My favorite coffee is espresso.", category: "personal", scope: { type: "global" }, kind: "personal_context", updatedAt: "2026-06-18T12:00:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.latestApproved.global, undefined)
})

test("continuity read model includes pending checkpoint and session-summary candidates", () => {
  const result = buildContinuityReadModel([
    memory({ id: "approved", text: "Approved checkpoint", kind: "project_checkpoint", updatedAt: "2026-06-18T08:00:00.000Z" }),
    memory({ id: "pending-checkpoint", text: "Merged PR #18 adding global hygiene hints.", status: "pending", kind: "project_fact", updatedAt: "2026-06-18T09:00:00.000Z" }),
    memory({ id: "pending-summary", text: "## Session Summary\nNext action: cut release.", status: "pending", source: "session-summary", kind: "session_summary", updatedAt: "2026-06-18T10:00:00.000Z" }),
    memory({ id: "pending-random", text: "Remember maybe something", status: "pending", kind: "misc" }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.pendingContinuity.map((item) => item.id), ["pending-summary", "pending-checkpoint"])
  assert.equal(result.status.pendingContinuityCount, 2)
  assert.equal(result.pendingContinuity[1].checkpointCandidate?.kind, "merge")
  assert.equal(result.suggestedActions[0], "memory-lane review --json")
  assert.ok(result.suggestedActions.includes("memory-lane review --json"))
})


test("continuity read model includes authoritative inspection actions and MCP guidance", () => {
  const result = buildContinuityReadModel([
    memory({ id: "approved", text: "Approved checkpoint", kind: "project_checkpoint" }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.suggestedActions.slice(0, 5), [
    "memory-lane continuity --json",
    "memory-lane review --json",
    "memory-lane list --json",
    "memory-lane agreements --json",
    "memory-lane status --json",
  ])
  for (const command of result.suggestedActions.slice(0, 5)) {
    assert.ok(result.harnessGuidance.cli.some((item) => item.includes(command)), `missing CLI guidance for ${command}`)
  }
  for (const tool of ["memory_continuity", "memory_review", "memory_list", "memory_status"]) {
    assert.ok(result.harnessGuidance.mcp.some((item) => item.includes(tool)), `missing MCP guidance for ${tool}`)
  }
})


test("continuity read model scopes pending review count to visible current-scope memories", () => {
  const memories = [
    memory({ id: "current-project", status: "pending", scope: { type: "project", key: "project-a" }, kind: "session_summary" }),
    memory({ id: "global", status: "pending", category: "preference", scope: { type: "global" }, kind: "workflow_rule" }),
    memory({ id: "other-project", status: "pending", scope: { type: "project", key: "project-b" }, kind: "session_summary" }),
  ]

  assert.equal(buildContinuityReadModel(memories, { projectScopeKey: "project-a" }).status.pendingReviewCount, 2)
  assert.equal(buildContinuityReadModel(memories).status.pendingReviewCount, 1)
})

test("continuity read model warns when pending continuity is newer than approved project continuity", () => {
  const result = buildContinuityReadModel([
    memory({ id: "approved", text: "Approved checkpoint", kind: "project_checkpoint", updatedAt: "2026-06-18T08:00:00.000Z" }),
    memory({ id: "pending", text: "Pending newer session summary", status: "pending", kind: "session_summary", source: "session-summary", updatedAt: "2026-06-18T11:00:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  const warning = result.warnings.find((item) => item.code === "pending-continuity-newer-than-approved")
  assert.equal(warning?.severity, "review")
  assert.deepEqual(warning?.memoryIds, ["pending"])
})

test("continuity read model warns when no project scope is active", () => {
  const result = buildContinuityReadModel([
    memory({ id: "global", text: "Global preference", category: "preference", scope: { type: "global" }, kind: "preference" }),
  ])

  assert.equal(result.projectScope, "none")
  assert.ok(result.warnings.some((item) => item.code === "no-project-scope"))
  assert.match(result.answerGuidance.join("\n"), /Pass projectPath/u)
})

test("continuity previews are bounded and omit likely secrets", () => {
  const longText = `${"A".repeat(260)} end`
  const result = buildContinuityReadModel([
    memory({ id: "long", text: longText, kind: "project_checkpoint" }),
    memory({ id: "secret", text: "api_key = sk-1234567890abcdef1234567890abcdef", status: "pending", kind: "session_summary", updatedAt: "2026-06-18T10:00:00.000Z" }),
  ], { projectScopeKey: "project-a", previewMaxChars: 80 })

  assert.equal(result.latestApproved.project?.preview.length, 80)
  assert.equal(result.latestApproved.project?.preview.endsWith("…"), true)
  assert.equal(result.pendingContinuity.some((item) => item.id === "secret"), false)
  assert.doesNotMatch(JSON.stringify(result), /sk-1234567890/u)
})

test("memory engine continuity returns canonical read model for current scope", () => {
  const dir = tempDir()
  const project = path.join(dir, "project")
  fs.mkdirSync(project)
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "engine-project" }))
  const memoryPath = path.join(dir, "memory.jsonl")
  fs.writeFileSync(memoryPath, [
    JSON.stringify(memory({ id: "approved", text: "Approved engine checkpoint", scope: { type: "project", key: "engine-project" }, kind: "project_checkpoint", updatedAt: "2026-06-18T08:00:00.000Z" })),
    JSON.stringify(memory({ id: "pending", text: "## Session Summary\nNext action: verify engine continuity.", scope: { type: "project", key: "engine-project" }, status: "pending", source: "session-summary", kind: "session_summary", updatedAt: "2026-06-18T09:00:00.000Z" })),
  ].join("\n") + "\n")

  const engine = new MemoryEngine({
    memoryPath,
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath: path.join(dir, "config.json"),
  })
  engine.refreshScope(project)

  const result = engine.continuity({ caller: "core" })

  assert.equal(result.projectScope, "engine-project")
  assert.equal(result.latestApproved.project?.id, "approved")
  assert.deepEqual(result.pendingContinuity.map((item) => item.id), ["pending"])
  assert.ok(result.warnings.some((item) => item.code === "pending-continuity-newer-than-approved"))
  assert.match(result.harnessGuidance.summary.join("\n"), /read model/u)
})
