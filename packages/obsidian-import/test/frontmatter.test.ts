import test from "node:test"
import assert from "node:assert/strict"
import { parseObsidianMarkdown } from "../src/frontmatter.ts"

test("parseObsidianMarkdown parses recognized top-of-file scalar frontmatter and trims body", () => {
  const parsed = parseObsidianMarkdown(`---
memory_lane: true
memory_lane_mirror: false
memory_lane_id: "abc12345"
category: project
scope: 'global'
status: pending
kind: "project_fact"
plugin_field: ignored
---

  Remember this body.  
`)

  assert.deepEqual(parsed.warnings, [])
  assert.deepEqual(parsed.frontmatter, {
    memory_lane: true,
    memory_lane_mirror: false,
    memory_lane_id: "abc12345",
    category: "project",
    scope: "global",
    status: "pending",
    kind: "project_fact",
  })
  assert.equal(parsed.body, "Remember this body.")
})

test("parseObsidianMarkdown only parses the first top-of-file frontmatter block", () => {
  const parsed = parseObsidianMarkdown(`---
memory_lane: true
---
Body before.
---
category: project
---
Body after.
`)

  assert.deepEqual(parsed.frontmatter, { memory_lane: true })
  assert.equal(parsed.body, "Body before.\n---\ncategory: project\n---\nBody after.")
})

test("parseObsidianMarkdown reports missing and malformed frontmatter", () => {
  const missing = parseObsidianMarkdown("memory_lane: true\nBody")
  assert.equal(missing.frontmatter, null)
  assert.deepEqual(missing.warnings, ["missing top-of-file frontmatter"])
  assert.equal(missing.body, "memory_lane: true\nBody")

  const malformed = parseObsidianMarkdown("---\nmemory_lane: true\nBody")
  assert.equal(malformed.frontmatter, null)
  assert.deepEqual(malformed.warnings, ["malformed frontmatter: missing closing delimiter"])
})

test("parseObsidianMarkdown warns about malformed recognized frontmatter lines", () => {
  const parsed = parseObsidianMarkdown(`---
memory_lane: true
not a scalar
---
Body
`)

  assert.deepEqual(parsed.frontmatter, { memory_lane: true })
  assert.deepEqual(parsed.warnings, ["malformed frontmatter line: not a scalar"])
})
