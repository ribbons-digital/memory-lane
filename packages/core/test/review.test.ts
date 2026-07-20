import test from "node:test"
import assert from "node:assert/strict"
import { analyzeReviewQuality, qualitySignalCodes, resolveReviewProjectScopeKeys, type MemoryRecord } from "../src/index.js"

function memory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "pending",
    text: "Use pnpm for package installation in this project.",
    category: "project",
    scope: { type: "project", key: "review-project" },
    status: "pending",
    source: "agent-suggested",
    kind: "workflow_rule",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }
}

test("review quality analysis assigns every supported signal in stable order", () => {
  const candidate = memory({
    text: "Merged PR #216. What should we do with it?\n```sh\npnpm test\n```\nNext step: review this task tomorrow.",
    category: "project",
    scope: { type: "global" },
    kind: "session_summary",
  })
  const rejected = memory({
    id: "rejected",
    status: "rejected",
    text: "  merged PR #216. What should we do with it? ```sh pnpm test ``` Next step: review this task tomorrow.  ",
    scope: { type: "global" },
    kind: "session_summary",
  })

  const result = analyzeReviewQuality(candidate, { rejectedMemories: [rejected], activeProjectScope: "review-project" })

  assert.deepEqual(result.map((signal) => signal.code), qualitySignalCodes)
  for (const signal of result) {
    assert.equal(typeof signal.reason, "string")
    assert.ok(signal.reason.length > 0)
    assert.equal(typeof signal.suggestedAction, "string")
  }
})

test("review quality analysis identifies terse checkpoint events without durable outcomes", () => {
  const cases = [
    "Merged PR #216.",
    "Released v1.2.3.",
    "Tests passed.",
    "Docs synced.",
    "Updated ROADMAP.md.",
    "Project checkpoint.",
    "Phase 12 completed.",
    "Deployment completed.",
  ]
  for (const text of cases) {
    const result = analyzeReviewQuality(memory({ text, kind: "project_checkpoint" }))
    assert.deepEqual(result.map((signal) => signal.code), ["bare-checkpoint"], text)
    assert.match(result[0].reason, /does not explain the durable outcome/u)
  }
  assert.deepEqual(
    analyzeReviewQuality(memory({ text: "Released v1.2.3.", kind: "project_fact" })).map((signal) => signal.code),
    ["bare-checkpoint"],
  )
})

test("review quality analysis does not mark checkpoints that state a durable outcome", () => {
  const cases = [
    "Merged PR #216 adding deterministic quality signals.",
    "Released v1.2.3 with project-local migration safeguards.",
    "Tests passed for the grouped review confirmation boundary.",
    "Docs synced with the new review workflow.",
    "Updated ROADMAP.md to record the completed review slice.",
    "Project checkpoint completed after grouped review verification.",
    "Phase 12 completed with deterministic project scope handling.",
    "Deployment completed with rollback safeguards enabled.",
  ]
  for (const text of cases) {
    const result = analyzeReviewQuality(memory({ text, kind: "project_checkpoint" }))
    assert.equal(result.some((signal) => signal.code === "bare-checkpoint"), false, text)
  }
})

test("review quality analysis uses conservative exact normalized rejected equivalence", () => {
  const rejected = memory({ id: "rejected", status: "rejected", text: "Use pnpm for package installation in this project." })
  assert.deepEqual(
    analyzeReviewQuality(memory(), { rejectedMemories: [rejected] }).map((signal) => signal.code),
    ["previously-rejected-equivalent"],
  )
  assert.equal(analyzeReviewQuality(memory({ text: "Use pnpm for all package installation." }), { rejectedMemories: [rejected] }).length, 0)
})

test("review quality analysis uses only explicit legacy project-root mappings", () => {
  const legacyGlobal = memory({
    category: "preference",
    scope: { type: "global" },
    kind: "preference",
    text: "Prefer concise status updates.",
    project: { cwd: "/legacy/same", root: "/legacy/same" },
  })

  const sameProjectSignals = analyzeReviewQuality(legacyGlobal, {
    activeProjectScope: "review-project",
    projectScopeKeysByRoot: new Map([["/legacy/same", "review-project"]]),
  })
  assert.equal(sameProjectSignals.some((signal) => signal.code === "cross-project-global-candidate"), false)

  const otherProjectSignals = analyzeReviewQuality(legacyGlobal, {
    activeProjectScope: "review-project",
    projectScopeKeysByRoot: new Map([["/legacy/same", "other-project"]]),
  })
  assert.deepEqual(otherProjectSignals.map((signal) => signal.code), ["cross-project-global-candidate"])
  assert.match(otherProjectSignals[0].reason, /other-project.*outside the active review project review-project/u)

  assert.deepEqual(analyzeReviewQuality(legacyGlobal, { activeProjectScope: "review-project" }), [])
})

test("review quality scope precomputation resolves each unique unkeyed legacy root once", () => {
  const roots = ["/legacy/one", "/legacy/one", "/legacy/two"]
  const calls: string[] = []
  const memories = [
    ...roots.map((root, index) => memory({ id: `memory-${index}`, project: { cwd: root, root } })),
    memory({ id: "keyed", project: { cwd: "/legacy/keyed", root: "/legacy/keyed", key: "project-keyed" } }),
  ]

  const result = resolveReviewProjectScopeKeys(memories, (root) => {
    calls.push(root)
    return { key: root === "/legacy/one" ? "project-one" : "project-two" }
  })

  assert.deepEqual(calls, ["/legacy/one", "/legacy/two"])
  assert.deepEqual([...result], [["/legacy/one", "project-one"], ["/legacy/two", "project-two"]])
})

test("review quality analysis leaves clear valid candidates unannotated", () => {
  assert.deepEqual(analyzeReviewQuality(memory()), [])
  assert.deepEqual(analyzeReviewQuality(memory({
    category: "preference",
    scope: { type: "global" },
    kind: "preference",
    text: "Across all projects, prefer concise status updates.",
  }), { activeProjectScope: "review-project" }), [])
})
