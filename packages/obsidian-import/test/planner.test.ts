import test from "node:test"
import assert from "node:assert/strict"
import type { ExistingImportMemory, ObsidianImportCandidate } from "../src/types.ts"
import { planObsidianImport } from "../src/planner.ts"

function note(frontmatter: string, body = "Remember this."): string {
  return `---\n${frontmatter}\n---\n\n${body}\n`
}

const existing: ExistingImportMemory[] = [
  {
    id: "pending-1",
    status: "pending",
    text: "Old pending text",
    category: "personal",
    scope: { type: "global" },
    source: "manual",
  },
  {
    id: "pending-2",
    status: "pending",
    text: "Another pending text",
    category: "personal",
    scope: { type: "global" },
    source: "manual",
  },
  {
    id: "approved-1",
    status: "approved",
    text: "Old approved text",
    category: "project",
    scope: { type: "project", key: "repo-a" },
    kind: "project_fact",
    source: "manual",
  },
  {
    id: "rejected-1",
    status: "rejected",
    text: "Rejected text",
    category: "personal",
    scope: { type: "global" },
  },
  {
    id: "deleted-1",
    status: "deleted",
    text: "Deleted text",
    category: "personal",
    scope: { type: "global" },
  },
]

test("planObsidianImport ignores unmarked notes, skips generated mirrors, and plans default creates", () => {
  const candidates: ObsidianImportCandidate[] = [
    { path: "Memory Lane/imports/no-frontmatter.md", content: "Just an Obsidian note" },
    { path: "Memory Lane/imports/unmarked.md", content: note("category: project") },
    { path: "Memory Lane/imports/mirror.md", content: note("memory_lane_mirror: true\nmemory_lane: true") },
    { path: "Memory Lane/imports/create.md", content: note("memory_lane: true", "New personal memory") },
  ]

  const plan = planObsidianImport({ candidates, existingMemories: [] })

  assert.deepEqual(plan.summary, { wouldCreate: 1, wouldUpdate: 0, skipped: 1, ignored: 2 })
  assert.equal(plan.results.length, 2)
  assert.deepEqual(plan.results.map((result) => result.path), [
    "Memory Lane/imports/mirror.md",
    "Memory Lane/imports/create.md",
  ])
  assert.equal(plan.results[0]?.action, "skip")
  assert.match(plan.warnings[0] ?? "", /generated mirror files cannot be imported/u)

  const create = plan.results[1]
  assert.equal(create?.action, "create")
  if (create?.action === "create") {
    assert.equal(create.text, "New personal memory")
    assert.equal(create.category, "personal")
    assert.deepEqual(create.scope, { type: "global" })
    assert.equal(create.status, "pending")
  }
})

test("planObsidianImport validates create metadata and requires project scope identity", () => {
  const candidates: ObsidianImportCandidate[] = [
    { path: "Memory Lane/imports/bad-category.md", content: note("memory_lane: true\ncategory: team") },
    { path: "Memory Lane/imports/bad-status.md", content: note("memory_lane: true\nstatus: rejected") },
    { path: "Memory Lane/imports/bad-kind.md", content: note("memory_lane: true\nkind: unknown") },
    { path: "Memory Lane/imports/project.md", content: note("memory_lane: true\ncategory: project\nscope: project") },
    { path: "Memory Lane/imports/empty.md", content: note("memory_lane: true", "   ") },
  ]

  const plan = planObsidianImport({ candidates, existingMemories: [] })

  assert.deepEqual(plan.summary, { wouldCreate: 0, wouldUpdate: 0, skipped: 5, ignored: 0 })
  assert.deepEqual(plan.results.map((result) => result.action), ["skip", "skip", "skip", "skip", "skip"])
  assert.match(plan.warnings.join("\n"), /bad-category\.md: invalid category value/u)
  assert.match(plan.warnings.join("\n"), /bad-status\.md: invalid status for import/u)
  assert.match(plan.warnings.join("\n"), /bad-kind\.md: invalid kind value/u)
  assert.match(plan.warnings.join("\n"), /project\.md: project-scoped import requires project scope/u)
  assert.match(plan.warnings.join("\n"), /empty\.md: missing memory body/u)
})

test("planObsidianImport plans active-memory updates and skips invalid update targets or transitions", () => {
  const candidates: ObsidianImportCandidate[] = [
    {
      path: "Memory Lane/imports/update-pending.md",
      content: note("memory_lane: true\nmemory_lane_id: pending-1\nstatus: approved\ncategory: preference\nkind: workflow_rule", "Updated pending text"),
    },
    { path: "Memory Lane/imports/missing.md", content: note("memory_lane: true\nmemory_lane_id: missing-1", "Missing target") },
    { path: "Memory Lane/imports/rejected.md", content: note("memory_lane: true\nmemory_lane_id: rejected-1", "Rejected target") },
    { path: "Memory Lane/imports/scope-change.md", content: note("memory_lane: true\nmemory_lane_id: pending-2\nscope: project", "Scope change") },
    { path: "Memory Lane/imports/demotion.md", content: note("memory_lane: true\nmemory_lane_id: approved-1\nstatus: pending", "Demotion") },
  ]

  const plan = planObsidianImport({ candidates, existingMemories: existing, projectScopeKey: "repo-a" })

  assert.deepEqual(plan.summary, { wouldCreate: 0, wouldUpdate: 1, skipped: 4, ignored: 0 })
  const update = plan.results[0]
  assert.equal(update?.action, "update")
  if (update?.action === "update") {
    assert.equal(update.memoryId, "pending-1")
    assert.equal(update.text, "Updated pending text")
    assert.equal(update.status, "approved")
    assert.equal(update.category, "preference")
    assert.equal(update.kind, "workflow_rule")
  }
  assert.match(plan.warnings.join("\n"), /missing\.md: memory_lane_id does not match an existing memory/u)
  assert.match(plan.warnings.join("\n"), /rejected\.md: memory_lane_id points to rejected memory/u)
  assert.match(plan.warnings.join("\n"), /scope-change\.md: scope changes are not supported for updates/u)
  assert.match(plan.warnings.join("\n"), /demotion\.md: approved memories cannot be demoted to pending/u)
})

test("planObsidianImport skips all duplicate target IDs and duplicate create text conflicts", () => {
  const candidates: ObsidianImportCandidate[] = [
    { path: "Memory Lane/imports/dup-id-a.md", content: note("memory_lane: true\nmemory_lane_id: pending-1", "A") },
    { path: "Memory Lane/imports/dup-id-b.md", content: note("memory_lane: true\nmemory_lane_id: pending-1", "B") },
    { path: "Memory Lane/imports/dup-text-a.md", content: note("memory_lane: true", "Same text!") },
    { path: "Memory Lane/imports/dup-text-b.md", content: note("memory_lane: true\ncategory: project", "same text") },
    { path: "Memory Lane/imports/existing-dup.md", content: note("memory_lane: true\ncategory: personal", "Old pending text.") },
    { path: "Memory Lane/imports/ok.md", content: note("memory_lane: true\nscope: project", "Project scoped create") },
  ]

  const plan = planObsidianImport({ candidates, existingMemories: existing, projectScopeKey: "repo-a" })

  assert.deepEqual(plan.summary, { wouldCreate: 1, wouldUpdate: 0, skipped: 5, ignored: 0 })
  assert.deepEqual(plan.results.map((result) => result.action), ["skip", "skip", "skip", "skip", "skip", "create"])
  assert.match(plan.warnings.join("\n"), /dup-id-a\.md: duplicate memory_lane_id in import run/u)
  assert.match(plan.warnings.join("\n"), /dup-id-b\.md: duplicate memory_lane_id in import run/u)
  assert.match(plan.warnings.join("\n"), /dup-text-a\.md: duplicate create text in import run/u)
  assert.match(plan.warnings.join("\n"), /dup-text-b\.md: duplicate create text in import run/u)
  assert.match(plan.warnings.join("\n"), /existing-dup\.md: duplicate existing memory/u)

  const create = plan.results[5]
  assert.equal(create?.action, "create")
  if (create?.action === "create") {
    assert.deepEqual(create.scope, { type: "project", key: "repo-a" })
  }
})
