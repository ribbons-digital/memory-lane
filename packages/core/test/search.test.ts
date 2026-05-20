import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  containsLikelySecret, inferCategory, inferMemoryKind, effectiveMemoryKind,
  memoryMatchesContext, searchMemories, findDuplicateMemory, isCheckpointRecallQuery,
  parseExplicitMemoryRequest, detectUserMemorySuggestion, isCheckpointMemorySaveRequest,
} from "../src/search.js"
import type { MemoryRecord } from "../src/types.js"

function rec(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: overrides.id ?? "test",
    status: overrides.status ?? "approved",
    text: overrides.text ?? "x",
    category: overrides.category ?? "project",
    scope: overrides.scope ?? { type: "project", key: "/p" },
    source: overrides.source ?? "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    project: { cwd: "/p", root: "/p", key: "/p" },
    kind: overrides.kind,
  }
}

describe("containsLikelySecret", () => {
  it("detects api keys", () => assert.equal(containsLikelySecret("key is sk-abc123def456ghi789jkl"), true))
  it("detects private key header", () => assert.equal(containsLikelySecret("-----BEGIN RSA PRIVATE KEY-----"), true))
  it("passes normal text", () => assert.equal(containsLikelySecret("I prefer pnpm"), false))
})

describe("inferCategory", () => {
  it("detects project", () => assert.equal(inferCategory("Run tests with --watch"), "project"))
  it("detects preference", () => assert.equal(inferCategory("I prefer tabs"), "preference"))
  it("defaults to personal", () => assert.equal(inferCategory("My name is X"), "personal"))
})

describe("inferMemoryKind", () => {
  it("detects checkpoint", () => assert.equal(inferMemoryKind("Current progress: done", "project"), "project_checkpoint"))
  it("detects workflow", () => assert.equal(inferMemoryKind("always use pnpm", "project"), "workflow_rule"))
  it("maps category", () => assert.equal(inferMemoryKind("cats", "preference"), "preference"))
})

describe("effectiveMemoryKind", () => {
  it("uses explicit kind", () => assert.equal(effectiveMemoryKind({ text: "x", category: "project", kind: "decision" }), "decision"))
  it("infers when missing", () => assert.equal(effectiveMemoryKind({ text: "Current progress: done", category: "project" }), "project_checkpoint"))
})

describe("memoryMatchesContext", () => {
  it("rejects non-approved", () => assert.equal(memoryMatchesContext(rec({ status: "pending" }), "/p"), false))
  it("passes global", () => assert.equal(memoryMatchesContext(rec({ scope: { type: "global" } }), "/any"), true))
  it("matches project", () => assert.equal(memoryMatchesContext(rec({ scope: { type: "project", key: "/p" } }), "/p"), true))
})

describe("searchMemories", () => {
  it("filters by text", () => {
    const r = searchMemories([rec({ id: "a", text: "pnpm" }), rec({ id: "b", text: "docker" })], "pnpm", "/p")
    assert.equal(r.length, 1)
    assert.equal(r[0].id, "a")
  })
})

describe("findDuplicateMemory", () => {
  it("finds exact text", () =>
    assert.equal(findDuplicateMemory([rec({ id: "a", text: "pnpm" })], "pnpm", "project", "project", "/p")?.id, "a"))
})

describe("isCheckpointRecallQuery", () => {
  it("matches", () => {
    assert.equal(isCheckpointRecallQuery("where did we leave off"), true)
    assert.equal(isCheckpointRecallQuery("resume work"), true)
    assert.equal(isCheckpointRecallQuery("how do I run tests"), false)
  })
})

describe("regex detection", () => {
  it("parseExplicitMemoryRequest extracts text", () => {
    assert.equal(parseExplicitMemoryRequest("remember that I prefer pnpm"), "I prefer pnpm")
    assert.equal(parseExplicitMemoryRequest("Please remember: tests use vitest"), "tests use vitest")
    assert.equal(parseExplicitMemoryRequest("save this to memory: use strict mode"), "use strict mode")
  })
  it("detectUserMemorySuggestion finds facts", () => {
    assert.equal(detectUserMemorySuggestion("I prefer tabs")?.category, "preference")
    assert.equal(detectUserMemorySuggestion("in this repo we use pnpm")?.category, "project")
    assert.equal(detectUserMemorySuggestion("my name is Alice")?.category, "personal")
    assert.equal(detectUserMemorySuggestion("how do I run tests"), undefined)
  })
  it("isCheckpointMemorySaveRequest detects progress saves", () => {
    assert.equal(isCheckpointMemorySaveRequest("remember our current progress"), true)
    assert.equal(isCheckpointMemorySaveRequest("save where we left off"), true)
    assert.equal(isCheckpointMemorySaveRequest("how do I deploy?"), false)
  })
})
