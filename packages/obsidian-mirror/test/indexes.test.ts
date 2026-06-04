import test from "node:test"
import assert from "node:assert/strict"
import type { MirrorMemoryRecord } from "../src/types.ts"
import { isGeneratedMirrorIndex, mirrorIndexFileNames, renderMirrorIndexes } from "../src/indexes.ts"

const base: MirrorMemoryRecord = {
  id: "11111111",
  status: "approved",
  category: "project",
  text: "Approved memory for pnpm installs",
  scope: { type: "global" },
  source: "manual",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
  kind: "project_fact",
}

const pending: MirrorMemoryRecord = {
  ...base,
  id: "22222222",
  status: "pending",
  category: "personal",
  text: "Pending memory for review",
  updatedAt: "2026-06-03T00:00:00.000Z",
  kind: "fact",
}

const project: MirrorMemoryRecord = {
  ...base,
  id: "33333333",
  text: "Project scoped memory",
  scope: { type: "project", key: "/repo/example" },
  updatedAt: "2026-06-04T00:00:00.000Z",
}

const rejected: MirrorMemoryRecord = {
  ...base,
  id: "44444444",
  status: "rejected",
  text: "Rejected memory",
}

const deleted: MirrorMemoryRecord = {
  ...base,
  id: "55555555",
  status: "deleted",
  text: "Deleted memory",
}

test("mirrorIndexFileNames returns stable first-slice paths", () => {
  assert.deepEqual(mirrorIndexFileNames(), [
    "index.md",
    "indexes/pending.md",
    "indexes/approved.md",
    "indexes/project.md",
    "indexes/recent.md",
  ])
})

test("renderMirrorIndexes renders generated markers tags and markdown links", () => {
  const indexes = renderMirrorIndexes([base, pending, project, rejected, deleted])
  const landing = indexes.find((index) => index.path === "index.md")
  const pendingIndex = indexes.find((index) => index.path === "indexes/pending.md")
  assert.ok(landing)
  assert.ok(pendingIndex)
  assert.match(landing.content, /memory_lane_mirror: true/)
  assert.match(landing.content, /memory_lane_index: true/)
  assert.match(landing.content, /title: "Memory Lane"/)
  assert.match(landing.content, /memory-lane\b/)
  assert.match(landing.content, /memory-lane\/index/)
  assert.match(landing.content, /\[Pending Memories\]\(indexes\/pending\.md\)/)
  assert.match(pendingIndex.content, /\[Pending memory for review\]\(\.\.\/memories\/22222222\.md\)/)
  assert.match(pendingIndex.content, /`pending` · `personal` · `fact` · `global` · updated 2026-06-03/)
  assert.doesNotMatch(pendingIndex.content, /44444444|55555555/)
})

test("renderMirrorIndexes groups project memories by project key", () => {
  const indexes = renderMirrorIndexes([base, project])
  const projectIndex = indexes.find((index) => index.path === "indexes/project.md")
  assert.ok(projectIndex)
  assert.match(projectIndex.content, /## \/repo\/example/)
  assert.match(projectIndex.content, /\[Project scoped memory\]\(\.\.\/memories\/33333333\.md\)/)
})

test("renderMirrorIndexes escapes markdown special characters in memory link text", () => {
  const memory: MirrorMemoryRecord = {
    ...base,
    id: "66666666",
    text: "[BUG] Fix parser (urgent)\nKeep the title link valid.",
  }
  const indexes = renderMirrorIndexes([memory])
  const approvedIndex = indexes.find((index) => index.path === "indexes/approved.md")
  assert.ok(approvedIndex)
  assert.ok(approvedIndex.content.includes("[\\[BUG\\] Fix parser \\(urgent\\)](../memories/66666666.md)"))
})

test("renderMirrorIndexes sorts recent memories by updatedAt descending", () => {
  const indexes = renderMirrorIndexes([base, pending, project])
  const recent = indexes.find((index) => index.path === "indexes/recent.md")
  assert.ok(recent)
  const text = recent.content
  assert.ok(text.indexOf("33333333.md") < text.indexOf("22222222.md"))
  assert.ok(text.indexOf("22222222.md") < text.indexOf("11111111.md"))
})

test("renderMirrorIndexes emits stable empty states", () => {
  const indexes = renderMirrorIndexes([])
  assert.equal(indexes.length, 5)
  assert.match(indexes.find((index) => index.path === "indexes/pending.md")!.content, /No pending memories\./)
  assert.match(indexes.find((index) => index.path === "indexes/approved.md")!.content, /No approved memories\./)
  assert.match(indexes.find((index) => index.path === "indexes/project.md")!.content, /No project-scoped memories\./)
  assert.match(indexes.find((index) => index.path === "indexes/recent.md")!.content, /No active memories\./)
})

test("isGeneratedMirrorIndex only matches top frontmatter with both generated markers", () => {
  const [landing] = renderMirrorIndexes([])
  assert.equal(isGeneratedMirrorIndex(landing.content), true)
  assert.equal(isGeneratedMirrorIndex("---\nmemory_lane_mirror: true\n---\n# Missing index marker"), false)
  assert.equal(isGeneratedMirrorIndex("---\nmemory_lane_index: true\n---\n# Missing mirror marker"), false)
  assert.equal(isGeneratedMirrorIndex("# Body\n\n---\nmemory_lane_mirror: true\nmemory_lane_index: true\n---"), false)
})
