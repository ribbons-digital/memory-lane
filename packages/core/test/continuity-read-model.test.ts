import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { buildContinuityReadModel, buildContinuityWarningRenderPlan, MemoryEngine, type ContinuityWarning, type MemoryRecord } from "../src/index.js"
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
    freshness: overrides.freshness,
    descriptor: overrides.descriptor,
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

test("continuity read model does not select global personal memory via workflow keyword", () => {
  const result = buildContinuityReadModel([
    memory({ id: "checkpoint", text: "Approved project checkpoint", kind: "project_checkpoint" }),
    memory({ id: "global-personal-review", text: "Remember to review my medical bill.", category: "personal", scope: { type: "global" }, kind: "personal_context", updatedAt: "2026-06-18T12:00:00.000Z" }),
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


test("continuity read model includes pending correction candidates", () => {
  const result = buildContinuityReadModel([
    memory({ id: "approved", text: "Approved checkpoint", kind: "project_checkpoint", updatedAt: "2026-06-18T08:00:00.000Z" }),
    memory({ id: "pending-correction", text: "Workflow correction: follow the PR-protected workflow before cleanup.", status: "pending", kind: "correction", updatedAt: "2026-06-18T11:00:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.pendingContinuity.map((item) => item.id), ["pending-correction"])
  assert.equal(result.pendingContinuity[0].kind, "correction")
  assert.equal(result.status.pendingContinuityCount, 1)
  assert.equal(result.suggestedActions[0], "memory-lane review --json")
})


test("continuity read model separates latest progress from newer correction guidance", () => {
  const result = buildContinuityReadModel([
    memory({
      id: "release-checkpoint",
      text: "Released v0.2.30 and Pi Slice D installed-artifact dogfood passed at commit a8e7167.",
      kind: "project_checkpoint",
      updatedAt: "2026-06-25T10:00:00.000Z",
    }),
    memory({
      id: "c78cdc00",
      text: "Workflow correction: when editing GitHub PR Markdown with gh, use --body-file instead of escaped newline shell strings.",
      kind: "correction",
      updatedAt: "2026-06-25T11:00:00.000Z",
    }),
  ], { projectScopeKey: "project-a", query: "What were we last working on?" })

  assert.equal(result.latestApproved.project?.id, "c78cdc00")
  assert.equal(result.latestProgress?.id, "release-checkpoint")
  assert.deepEqual(result.operatingGuidance?.map((item) => item.id), ["c78cdc00"])
  assert.doesNotMatch(JSON.stringify(result), /roleSummary|latestProgressRole|excludedFromLatestProgress/u)
})


test("continuity read model allows checkpoint-like corrections to count as latest progress", () => {
  const result = buildContinuityReadModel([
    memory({ id: "older", text: "Older checkpoint", kind: "project_checkpoint", updatedAt: "2026-06-25T09:00:00.000Z" }),
    memory({
      id: "checkpoint-correction",
      text: "Correction after failed release: merged PR #57, released v0.2.31, and verification passed.",
      kind: "correction",
      updatedAt: "2026-06-25T12:00:00.000Z",
    }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.latestApproved.project?.id, "checkpoint-correction")
  assert.equal(result.latestProgress?.id, "checkpoint-correction")
  assert.equal(result.operatingGuidance?.some((item) => item.id === "checkpoint-correction") ?? false, false)
})


test("continuity read model includes procedure-only memories as operating guidance", () => {
  const result = buildContinuityReadModel([
    memory({ id: "checkpoint", text: "Implemented continuity typing fixtures.", kind: "project_checkpoint", updatedAt: "2026-06-25T10:00:00.000Z" }),
    memory({
      id: "procedure",
      text: "Procedure: when editing PR bodies, write the body to a temporary markdown file and run gh pr edit --body-file.",
      kind: "procedure",
      updatedAt: "2026-06-25T12:00:00.000Z",
    }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.latestApproved.project?.id, "procedure")
  assert.equal(result.latestProgress?.id, "checkpoint")
  assert.deepEqual(result.operatingGuidance?.map((item) => item.id), ["procedure"])
})


test("continuity read model bounds operating guidance and filters secret-like guidance", () => {
  const result = buildContinuityReadModel([
    memory({ id: "checkpoint", text: "Released v0.2.30 with Pi continuity dogfood complete.", kind: "project_checkpoint", updatedAt: "2026-06-25T10:00:00.000Z" }),
    memory({ id: "secret-guidance", text: "Procedure: use API_KEY=sk-test-secret-secret-secret-secret-secret-secret when editing PRs.", kind: "procedure", updatedAt: "2026-06-25T16:00:00.000Z" }),
    memory({ id: "guidance-6", text: "Procedure: review PR body formatting before merge.", kind: "procedure", updatedAt: "2026-06-25T15:00:00.000Z" }),
    memory({ id: "guidance-5", text: "Procedure: review PR checklist before merge.", kind: "procedure", updatedAt: "2026-06-25T14:00:00.000Z" }),
    memory({ id: "guidance-4", text: "Procedure: review release notes before publish.", kind: "procedure", updatedAt: "2026-06-25T13:00:00.000Z" }),
    memory({ id: "guidance-3", text: "Procedure: review build output before release.", kind: "procedure", updatedAt: "2026-06-25T12:00:00.000Z" }),
    memory({ id: "guidance-2", text: "Procedure: review test output before release.", kind: "procedure", updatedAt: "2026-06-25T11:00:00.000Z" }),
    memory({ id: "guidance-1", text: "Procedure: review git status before release.", kind: "procedure", updatedAt: "2026-06-25T10:30:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.operatingGuidance?.map((item) => item.id), ["guidance-6", "guidance-4"])
  assert.equal(result.operatingGuidance?.length, 2)
  assert.doesNotMatch(JSON.stringify(result), /sk-test-secret/u)
})


test("continuity read model uses lower-ranked safe operating guidance for an area", () => {
  const result = buildContinuityReadModel([
    memory({ id: "checkpoint", text: "Released v0.2.30 with Pi continuity dogfood complete.", kind: "project_checkpoint", updatedAt: "2026-06-25T10:00:00.000Z" }),
    memory({ id: "unsafe-pr-guidance", text: "Procedure: use token ghp_1234567890abcdef1234567890abcdef123456 when editing PRs.", kind: "procedure", updatedAt: "2026-06-25T16:00:00.000Z" }),
    memory({ id: "safe-pr-guidance", text: "Procedure: review PR body formatting before merge.", kind: "procedure", updatedAt: "2026-06-25T15:00:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.operatingGuidance?.map((item) => item.id), ["safe-pr-guidance"])
  assert.doesNotMatch(JSON.stringify(result), /ghp_123456/u)
})


test("continuity read model prefers correction guidance over newer generic procedure in the same area", () => {
  const result = buildContinuityReadModel([
    memory({ id: "procedure", text: "Procedure: review PR body formatting before merge.", kind: "procedure", updatedAt: "2026-06-25T16:00:00.000Z" }),
    memory({ id: "correction", text: "Correction: when editing PR bodies, use a temp markdown body file.", kind: "correction", updatedAt: "2026-06-25T15:00:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.operatingGuidance?.map((item) => item.id), ["correction"])
})


test("continuity read model excludes superseded memories from selected slots", () => {
  const result = buildContinuityReadModel([
    memory({ id: "old-checkpoint", text: "Released v0.1.0 with old continuity.", kind: "project_checkpoint", updatedAt: "2026-06-20T10:00:00.000Z", revision: { supersededBy: "new-checkpoint", revisedAt: "2026-06-20T12:00:00.000Z", revisedBy: "manual" } }),
    memory({ id: "new-checkpoint", text: "Released v0.2.0 with current continuity.", kind: "project_checkpoint", updatedAt: "2026-06-19T10:00:00.000Z" }),
    memory({ id: "old-guidance", text: "Procedure: old PR process before merge.", kind: "procedure", updatedAt: "2026-06-20T11:00:00.000Z", revision: { supersededBy: "new-guidance", revisedAt: "2026-06-20T12:00:00.000Z", revisedBy: "manual" } }),
    memory({ id: "new-guidance", text: "Procedure: current PR process before merge.", kind: "procedure", updatedAt: "2026-06-19T11:00:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.latestProgress?.id, "new-checkpoint")
  assert.notEqual(result.latestApproved.project?.id, "old-checkpoint")
  assert.deepEqual(result.operatingGuidance?.map((item) => item.id), ["new-guidance"])
})


test("continuity read model excludes superseded memories from workstream discovery", () => {
  const result = buildContinuityReadModel([
    memory({ id: "old-checkpoint", text: "Workstream discovery implementation plan", kind: "project_checkpoint", updatedAt: "2026-06-20T10:00:00.000Z", revision: { supersededBy: "new-checkpoint", revisedAt: "2026-06-20T12:00:00.000Z", revisedBy: "manual" } }),
    memory({ id: "new-checkpoint", text: "Workstream discovery implementation completed", kind: "project_checkpoint", updatedAt: "2026-06-19T10:00:00.000Z" }),
  ], { projectScopeKey: "project-a", query: "resume workstream discovery implementation" })

  assert.deepEqual(result.workstreamDiscovery?.candidates.map((item) => item.id), ["new-checkpoint"])
  assert.doesNotMatch(JSON.stringify(result.workstreamDiscovery), /old-checkpoint/u)
})


test("continuity read model uses safe descriptor metadata for previews", () => {
  const result = buildContinuityReadModel([
    memory({
      id: "descriptor-checkpoint",
      text: "Long body that should not be used when descriptor metadata is available for continuity previews.",
      kind: "project_checkpoint",
      updatedAt: "2026-06-20T10:00:00.000Z",
      descriptor: { description: "Compact checkpoint descriptor", fetchHint: "when checking current release status" },
    }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.latestProgress?.preview, "Compact checkpoint descriptor Fetch when: when checking current release status")
  assert.doesNotMatch(result.latestProgress?.preview ?? "", /Long body/u)
})


test("continuity read model excludes skill body dumps from operating guidance", () => {
  const skillDump = `<skill>
<name>ytai-cli</name>
---
name: ytai-cli
description: Use the ytai YouTube AI-ingestion CLI to prepare, ingest, scout, summarize, clip, and extract frames from YouTube videos.
---

# ytai CLI

\`ytai\` is a globally installed TypeScript CLI for local YouTube AI ingestion.

## Quick Reference

| Command | Purpose |
| --- | --- |
| \`ytai prepare\` | Full workflow: ingest then summarize |
| \`ytai ingest\` | Download assets |

### Safety Rules

- Never shell-interpolate YouTube URLs.
- Use command arrays when wrapping CLI calls.
`

  const result = buildContinuityReadModel([
    memory({ id: "checkpoint", text: "Released v0.2.32 with Pi continuity dogfood complete.", kind: "project_checkpoint", updatedAt: "2026-06-26T10:00:00.000Z" }),
    memory({
      id: "ytai-skill-dump",
      text: skillDump,
      category: "preference",
      scope: { type: "global" },
      source: "manual",
      kind: "preference",
      updatedAt: "2026-06-26T12:00:00.000Z",
    }),
    memory({
      id: "ytai-workflow-rule-dump",
      text: skillDump,
      category: "preference",
      scope: { type: "global" },
      source: "manual",
      kind: "workflow_rule",
      updatedAt: "2026-06-26T13:00:00.000Z",
    }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.operatingGuidance?.some((item) => item.id === "ytai-skill-dump" || item.id === "ytai-workflow-rule-dump") ?? false, false)
  assert.equal(result.latestApproved.global?.id, undefined)
})


test("continuity read model keeps legitimate XML-ish workflow guidance eligible", () => {
  const result = buildContinuityReadModel([
    memory({ id: "checkpoint", text: "Released v0.2.32 with Pi continuity dogfood complete.", kind: "project_checkpoint", updatedAt: "2026-06-26T10:00:00.000Z" }),
    memory({
      id: "opus-workflow",
      text: "Workflow rule: <review>Before presenting a design, run claude -p --model=claude-opus-4-8 and ask for high-effort thinking.</review>",
      category: "preference",
      scope: { type: "global" },
      source: "manual",
      kind: "workflow_rule",
      updatedAt: "2026-06-26T12:00:00.000Z",
    }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.operatingGuidance?.some((item) => item.id === "opus-workflow"), true)
})


test("continuity read model marks truncated operating guidance and instructs full inspection", () => {
  const filler = "Review workflow requires Opus before design approval and before PR. ".repeat(6)
  const result = buildContinuityReadModel([
    memory({ id: "checkpoint", text: "Released v0.2.32 with Pi continuity dogfood complete.", kind: "project_checkpoint", updatedAt: "2026-06-26T10:00:00.000Z" }),
    memory({
      id: "opus-review-rule",
      text: `${filler}Do not summon Opus 4.8 through subagents; invoke it with claude -p --model=claude-opus-4-8 and request high-effort thinking in the prompt.`,
      category: "preference",
      scope: { type: "global" },
      source: "manual",
      kind: "workflow_rule",
      updatedAt: "2026-06-26T12:00:00.000Z",
    }),
  ], { projectScopeKey: "project-a" })

  const guidance = result.operatingGuidance?.find((item) => item.id === "opus-review-rule")
  assert.equal(guidance?.truncated, true)
  assert.doesNotMatch(guidance?.preview ?? "", /claude -p --model=claude-opus-4-8/u)
  assert.match(result.answerGuidance.join("\n"), /opus-review-rule/u)
  assert.match(result.answerGuidance.join("\n"), /memory-lane show opus-review-rule/u)
})

test("continuity read model adds actionable overlap warning metadata", () => {
  const result = buildContinuityReadModel([
    memory({ id: "checkpoint", text: "Released v0.2.32 with Pi continuity dogfood complete.", kind: "project_checkpoint", updatedAt: "2026-06-26T10:00:00.000Z" }),
    memory({ id: "project-loop", text: "Project loop workflow: run review before implementation.", kind: "procedure", updatedAt: "2026-06-26T11:00:00.000Z" }),
    memory({ id: "global-loop", text: "Global project loop workflow preference: run review before implementation.", category: "preference", scope: { type: "global" }, kind: "workflow_rule", updatedAt: "2026-06-26T12:00:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  const warning = result.warnings.find((item) => item.code === "operating-agreement-overlap")
  assert.deepEqual(warning?.workflowAreas, ["project-loop"])
  assert.deepEqual(warning?.suggestedActions, ["memory-lane agreements --area project-loop --json"])
  assert.ok(result.suggestedActions.includes("memory-lane agreements --area project-loop --json"))
})


test("continuity warning render plan groups by severity and reports omitted warnings", () => {
  const warnings: ContinuityWarning[] = [
    { code: "mcp-explicit-tools-only", severity: "info", message: "MCP note." },
    { code: "operating-agreement-overlap", severity: "review", message: "Overlap.", suggestedActions: ["memory-lane agreements --area project-loop --json", "memory-lane agreements --area review-gate --json", "memory-lane agreements --area pr-process --json", "memory-lane agreements --area release-process --json"] },
    { code: "scope-hygiene-candidate", severity: "review", message: "Scope." },
    { code: "freshness-advisory", severity: "review", message: "Freshness." },
  ]

  const plan = buildContinuityWarningRenderPlan(warnings)

  assert.deepEqual(plan.infoWarnings.map((warning) => warning.code), ["mcp-explicit-tools-only"])
  assert.deepEqual(plan.actionRequiredWarnings.map((warning) => warning.code), ["operating-agreement-overlap", "scope-hygiene-candidate"])
  assert.equal(plan.omittedWarningCount, 1)
  assert.deepEqual([...plan.renderedInspectionActions], [
    "memory-lane agreements --area project-loop --json",
    "memory-lane agreements --area review-gate --json",
    "memory-lane agreements --area pr-process --json",
  ])
})


test("continuity read model excludes non-manual global preferences from operating guidance", () => {
  const result = buildContinuityReadModel([
    memory({ id: "checkpoint", text: "Released v0.2.30 with Pi continuity dogfood complete.", kind: "project_checkpoint", updatedAt: "2026-06-25T10:00:00.000Z" }),
    memory({
      id: "generated-global-workflow",
      text: "Global workflow preference: always use a PR before merge.",
      category: "preference",
      scope: { type: "global" },
      source: "user-suggested",
      kind: "preference",
      updatedAt: "2026-06-25T12:00:00.000Z",
    }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.latestApproved.global, undefined)
  assert.equal(result.operatingGuidance?.some((item) => item.id === "generated-global-workflow") ?? false, false)
})


test("continuity read model keeps global workflow out of latest progress", () => {
  const result = buildContinuityReadModel([
    memory({ id: "checkpoint", text: "Released v0.2.30 with Pi continuity dogfood complete.", kind: "project_checkpoint", updatedAt: "2026-06-25T10:00:00.000Z" }),
    memory({
      id: "global-pr",
      text: "Global workflow: use PR-protected workflow and wait for merge.",
      category: "preference",
      scope: { type: "global" },
      kind: "workflow_rule",
      updatedAt: "2026-06-25T13:00:00.000Z",
    }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.latestProgress?.id, "checkpoint")
  assert.equal(result.operatingGuidance?.some((item) => item.id === "global-pr"), true)
  assert.notEqual(result.latestProgress?.id, result.latestApproved.global?.id)
})


test("continuity read model still allows topic-specific workstream discovery to return corrections", () => {
  const records = [
    memory({ id: "checkpoint", text: "Released v0.2.30 with Pi continuity dogfood complete.", kind: "project_checkpoint", updatedAt: "2026-06-25T10:00:00.000Z" }),
    memory({
      id: "c78cdc00",
      text: "Workflow correction: PR body formatting fix uses gh pr edit --body-file for GitHub Markdown.",
      kind: "correction",
      updatedAt: "2026-06-25T11:00:00.000Z",
    }),
  ]

  const bodyQuery = buildContinuityReadModel(records, { projectScopeKey: "project-a", query: "where did we fix PR body formatting?" })
  const currentQuery = buildContinuityReadModel(records, { projectScopeKey: "project-a", query: "current PR formatting" })

  assert.equal(bodyQuery.latestProgress?.id, "checkpoint")
  assert.equal(bodyQuery.workstreamDiscovery?.candidates[0]?.id, "c78cdc00")
  assert.equal(currentQuery.workstreamDiscovery?.candidates[0]?.id, "c78cdc00")
})


test("continuity read model keeps release and checkpoint progress out of operating guidance", () => {
  const result = buildContinuityReadModel([
    memory({
      id: "1098781c",
      text: "Cross-harness Memory Lane review checkpoint (2026-06-16): reviewing pending memories from Pi, Claude Desktop, and Codex Desktop exposed useful installer/onboarding preferences and hygiene issues. Durable takeaways: approve/retain preferences for one-line install, menu-driven low-friction first-run setup, broad harness support, ~/.local/bin binary location, uninstall support, and non-breaking future-harness/token-aware enhancements; ignore/reject the intentionally duplicated/truncated 7d2a32a9; treat duplicate session-summary pairs as evidence for debounce/review hygiene hardening. Product lesson: Memory Lane must preserve cross-harness continuity while avoiding context pollution and oversized injected memories.",
      kind: "project_fact",
      updatedAt: "2026-06-26T10:00:00.000Z",
    }),
    memory({
      id: "7eab3ad9",
      text: "Released Memory Lane `v0.2.34` from main commit `f84ee46` after PR #63 (Phase 21 Slice 7 summary hygiene). Local validation before tagging passed: `pnpm build`, `pnpm test`, `git diff --check`. Release workflow `28223214725` succeeded, built packages, ran tests, built binaries, smoke-tested current-platform binary, generated notes, and published 8 assets. Release URL: https://github.com/ribbons-digital/memory-lane/releases/tag/v0.2.34",
      kind: "project_fact",
      updatedAt: "2026-06-26T11:00:00.000Z",
    }),
    memory({
      id: "0b56ed5d",
      text: "Released Memory Lane v0.2.33 from `main` at `5046d8d` after PR #61 continuity hygiene and PR #62 handoff sync. Release workflow `28211638059` passed: packages built, tests ran, binaries built, current-platform binary smoke-tested, and GitHub Release published with install scripts, SHA256SUMS, and macOS/Linux/Windows assets. Next recommended roadmap slice: Phase 21 Slice 7 design/spec for orchestrator/session-level summary hygiene to prevent subagent/task chatter and duplicate parallel-session summaries from becoming durable continuity noise.",
      kind: "project_fact",
      updatedAt: "2026-06-26T12:00:00.000Z",
    }),
    memory({
      id: "1f373bd2",
      text: "Project workflow rule: At every Memory Lane phase/slice completion, release, merge, or recommendation of next work, sync project status docs before calling the work complete. Required docs include HANDOFF.md, ROADMAP.md, README.md, and the Memory Lane skill docs. Verify these docs reflect the current branch/release/status and next step; do not rely only on memory checkpoints.",
      kind: "project_fact",
      updatedAt: "2026-06-26T13:00:00.000Z",
    }),
    memory({
      id: "d0dd92ee",
      text: "Memory Lane PR #67 merged as `78ea89e docs: compact handoff and memory lane skill guidance (#67)`. Post-merge cleanup completed and no runtime behavior changed.",
      kind: "project_checkpoint",
      updatedAt: "2026-06-26T14:00:00.000Z",
    }),
  ], { projectScopeKey: "project-a", query: "what should we work on next?" })

  assert.equal(result.latestProgress?.id, "d0dd92ee")
  assert.deepEqual(result.operatingGuidance?.map((item) => item.id), ["1f373bd2"])
  assert.deepEqual(result.workstreamDiscovery?.candidates, [])
  assert.ok(result.workstreamDiscovery?.warnings.some((warning) => warning.code === "no-topic"))
})


test("continuity read model includes newer session summary as latest progress", () => {
  const result = buildContinuityReadModel([
    memory({ id: "fact", text: "Older project fact", kind: "project_fact", updatedAt: "2026-06-25T09:00:00.000Z" }),
    memory({
      id: "summary",
      text: "## Session Summary\nCompleted continuity typing eval spec. Next step: implement fixtures.",
      kind: "session_summary",
      source: "session-summary",
      updatedAt: "2026-06-25T12:00:00.000Z",
    }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.latestProgress?.id, "summary")
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

test("continuity read model warns when freshness advisory hints exist", () => {
  const result = buildContinuityReadModel([
    memory({ id: "expired", text: "SECRET expired text", freshness: { expiresAt: "2026-06-18T00:00:00.000Z" } }),
  ], { projectScopeKey: "project-a" })

  assert.ok(result.continuityHints.hints.some((item) => item.code === "freshness-advisory"))
  assert.ok(result.warnings.some((item) => item.code === "freshness-advisory" && item.severity === "review"))
  assert.doesNotMatch(JSON.stringify(result.freshness), /SECRET expired text/u)
  assert.doesNotMatch(JSON.stringify(result.continuityHints), /SECRET expired text/u)
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

test("continuity accounts for secret-filtered pending continuity candidates without unsafe preview text", () => {
  const result = buildContinuityReadModel([
    memory({ id: "approved", text: "Approved checkpoint", kind: "project_checkpoint", updatedAt: "2026-06-18T08:00:00.000Z" }),
    memory({ id: "secret-pending", text: "## Session Summary\nNext token = sk-1234567890abcdef1234567890abcdef", status: "pending", kind: "session_summary", source: "session-summary", updatedAt: "2026-06-18T11:00:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.status.pendingContinuityCount, 1)
  assert.equal(result.pendingContinuity.some((item) => item.id === "secret-pending"), false)
  assert.equal(result.suggestedActions[0], "memory-lane review --json")
  const warning = result.warnings.find((item) => item.code === "pending-continuity-newer-than-approved")
  assert.equal(warning?.severity, "review")
  assert.deepEqual(warning?.memoryIds, ["secret-pending"])
  assert.doesNotMatch(JSON.stringify(result), /sk-1234567890/u)
  assert.doesNotMatch(JSON.stringify(result), /Next token/u)
})

test("review handoff proposal is gated to review mode with active project pending continuity", () => {
  const memories = [
    memory({ id: "approved", text: "Approved checkpoint", kind: "project_checkpoint", updatedAt: "2026-06-18T08:00:00.000Z" }),
    memory({ id: "pending", text: "## Session Summary\nNext action: verify review proposal.", status: "pending", kind: "session_summary", source: "session-summary", updatedAt: "2026-06-18T11:00:00.000Z" }),
  ]

  const manual = buildContinuityReadModel(memories, { projectScopeKey: "project-a", handoffMode: "manual" })
  const automatic = buildContinuityReadModel(memories, { projectScopeKey: "project-a", handoffMode: "automatic" })
  const review = buildContinuityReadModel(memories, { projectScopeKey: "project-a", handoffMode: "review" })

  assert.equal(manual.handoffProposal, undefined)
  assert.equal(automatic.handoffProposal, undefined)
  assert.equal(review.handoffProposal?.mode, "review")
  assert.equal(review.handoffProposal?.status, "pending-review")
  assert.equal(review.handoffProposal?.projectScope, "project-a")
  assert.equal(review.handoffProposal?.pendingCount, 1)
  assert.deepEqual(review.handoffProposal?.items.map((item) => item.id), ["pending"])
  assert.equal(review.handoffProposal?.omittedCount, 0)
  assert.deepEqual(review.handoffProposal?.suggestedActions, ["memory-lane review --json", "memory-lane approve pending"])
  assert.ok(review.suggestedActions.includes("memory-lane approve pending"))
})

test("review handoff proposal is bounded and reports omitted pending continuity", () => {
  const result = buildContinuityReadModel([
    memory({ id: "pending-1", text: "## Session Summary\nFirst", status: "pending", kind: "session_summary", source: "session-summary", updatedAt: "2026-06-18T09:00:00.000Z" }),
    memory({ id: "pending-2", text: "## Session Summary\nSecond", status: "pending", kind: "session_summary", source: "session-summary", updatedAt: "2026-06-18T10:00:00.000Z" }),
    memory({ id: "pending-3", text: "## Session Summary\nThird", status: "pending", kind: "session_summary", source: "session-summary", updatedAt: "2026-06-18T11:00:00.000Z" }),
  ], { projectScopeKey: "project-a", handoffMode: "review", maxPendingContinuity: 2 })

  assert.equal(result.handoffProposal?.pendingCount, 3)
  assert.deepEqual(result.handoffProposal?.items.map((item) => item.id), ["pending-3", "pending-2"])
  assert.equal(result.handoffProposal?.omittedCount, 1)
  assert.deepEqual(result.handoffProposal?.suggestedActions, [
    "memory-lane review --json",
    "memory-lane approve pending-3",
    "memory-lane approve pending-2",
  ])
  assert.equal(result.suggestedActions.includes("memory-lane approve pending-1"), false)
})

test("continuity read model omits workstream discovery without query", () => {
  const result = buildContinuityReadModel([
    memory({ id: "checkpoint", text: "PR #39 merged workstream discovery design.", kind: "project_checkpoint" }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.workstreamDiscovery, undefined)
})

test("continuity read model includes workstream discovery for query", () => {
  const result = buildContinuityReadModel([
    memory({ id: "checkpoint", text: "PR #39 merged workstream discovery design; next action: implement Slice 6a.", kind: "project_checkpoint" }),
  ], { projectScopeKey: "project-a", query: "resume workstream discovery" })

  assert.equal(result.workstreamDiscovery?.query, "resume workstream discovery")
  assert.equal(result.workstreamDiscovery?.intent, "resume")
  assert.deepEqual(result.workstreamDiscovery?.candidates.map((candidate) => candidate.id), ["checkpoint"])
})

test("memory engine continuity query is read-only", () => {
  const dir = tempDir()
  const project = path.join(dir, "project")
  fs.mkdirSync(project)
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "engine-project" }))
  const memoryPath = path.join(dir, "memory.jsonl")
  const row = JSON.stringify(memory({ id: "checkpoint", text: "PR #39 merged workstream discovery design.", scope: { type: "project", key: "engine-project" }, kind: "project_checkpoint" }))
  fs.writeFileSync(memoryPath, `${row}\n`)

  const engine = new MemoryEngine({
    memoryPath,
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath: path.join(dir, "config.json"),
  })
  engine.refreshScope(project)

  const before = fs.readFileSync(memoryPath, "utf8")
  const result = engine.continuity({ caller: "core", query: "where was workstream discovery implemented" })
  const after = fs.readFileSync(memoryPath, "utf8")

  assert.equal(result.workstreamDiscovery?.candidates[0]?.id, "checkpoint")
  assert.equal(after, before)
})

test("review handoff proposal is omitted without project scope or pending continuity", () => {
  const noScope = buildContinuityReadModel([
    memory({ id: "global-pending", text: "## Session Summary\nGlobal", status: "pending", category: "preference", scope: { type: "global" }, kind: "session_summary", source: "session-summary" }),
  ], { handoffMode: "review" })
  const noPending = buildContinuityReadModel([
    memory({ id: "approved", text: "Approved checkpoint", kind: "project_checkpoint" }),
  ], { projectScopeKey: "project-a", handoffMode: "review" })

  assert.equal(noScope.handoffProposal, undefined)
  assert.equal(noPending.handoffProposal, undefined)
})

test("review handoff proposal omits secret-filtered candidates", () => {
  const result = buildContinuityReadModel([
    memory({ id: "secret-pending", text: "## Session Summary\napi_key = sk-1234567890abcdef1234567890abcdef", status: "pending", kind: "session_summary", source: "session-summary", updatedAt: "2026-06-18T11:00:00.000Z" }),
  ], { projectScopeKey: "project-a", handoffMode: "review" })

  assert.equal(result.status.pendingContinuityCount, 1)
  assert.equal(result.pendingContinuity.length, 0)
  assert.equal(result.handoffProposal, undefined)
  assert.equal(result.suggestedActions.includes("memory-lane approve secret-pending"), false)
  assert.doesNotMatch(JSON.stringify(result), /sk-1234567890|api_key/u)
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
