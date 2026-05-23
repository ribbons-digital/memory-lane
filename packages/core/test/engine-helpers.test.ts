import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  contentHash, createNewMemory, saveContext, shouldAutoEmbed, timestamp, visibleInScope,
} from "../src/engine-helpers.js"
import type { EmbeddingProvider, MemoryRecord, ProjectScope } from "../src/types.js"

const PROJECT_SCOPE: ProjectScope = {
  cwd: "/repo/app",
  root: "/repo",
  key: "/repo",
}

const SEMANTIC_ENABLED = {
  enabled: true,
  activeEmbeddingProfile: "test",
  embeddings: { profiles: {} },
  retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
  privacy: { allowRemoteEmbeddings: false },
}

const PROVIDER: EmbeddingProvider = {
  async embed() { return [[1, 0]] },
}

function rec(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: overrides.id ?? "m1",
    status: overrides.status ?? "approved",
    text: overrides.text ?? "use pnpm",
    category: overrides.category ?? "project",
    scope: overrides.scope ?? { type: "project", key: "/repo" },
    source: overrides.source ?? "manual",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    project: overrides.project,
    kind: overrides.kind,
  }
}

describe("engine helper functions", () => {
  it("builds project save context from inferred category", () => {
    const ctx = saveContext({ text: "this project uses pnpm" }, "this project uses pnpm", PROJECT_SCOPE)
    assert.equal(ctx.category, "project")
    assert.equal(ctx.scopeType, "project")
    assert.deepEqual(ctx.scope, { type: "project", key: "/repo" })
    assert.equal(ctx.kind, "project_fact")
  })

  it("builds global preference save context", () => {
    const ctx = saveContext({ text: "I prefer tabs", category: "preference" }, "I prefer tabs", PROJECT_SCOPE)
    assert.equal(ctx.category, "preference")
    assert.equal(ctx.scopeType, "global")
    assert.deepEqual(ctx.scope, { type: "global" })
    assert.equal(ctx.kind, "preference")
  })

  it("creates a memory record from save context and project scope", () => {
    const ctx = saveContext({ text: "this project uses pnpm", status: "approved" }, "this project uses pnpm", PROJECT_SCOPE)
    const memory = createNewMemory({ text: ctx.text, status: "approved" }, ctx, PROJECT_SCOPE)
    assert.equal(memory.status, "approved")
    assert.equal(memory.text, "this project uses pnpm")
    assert.deepEqual(memory.project, { cwd: "/repo/app", root: "/repo", key: "/repo" })
    assert.ok(memory.id)
    assert.ok(memory.createdAt)
  })

  it("decides whether approved memories should auto-embed", () => {
    assert.equal(shouldAutoEmbed(rec({ status: "approved" }), SEMANTIC_ENABLED, PROVIDER), true)
    assert.equal(shouldAutoEmbed(rec({ status: "pending" }), SEMANTIC_ENABLED, PROVIDER), false)
    assert.equal(shouldAutoEmbed(rec({ status: "approved" }), { ...SEMANTIC_ENABLED, enabled: false }, PROVIDER), false)
    assert.equal(shouldAutoEmbed(rec({ status: "approved" }), SEMANTIC_ENABLED, undefined), false)
  })

  it("checks memory visibility for global and project scope", () => {
    assert.equal(visibleInScope(rec({ scope: { type: "global" } }), "/elsewhere"), true)
    assert.equal(visibleInScope(rec({ scope: { type: "project", key: "/repo" } }), "/repo"), true)
    assert.equal(visibleInScope(rec({ scope: { type: "project" }, project: { cwd: "/repo/app", root: "/repo", key: "/repo" } }), "/repo"), true)
    assert.equal(visibleInScope(rec({ scope: { type: "project", key: "/repo" } }), "/other"), false)
  })

  it("returns stable timestamps and content hashes", () => {
    assert.equal(timestamp("2026-01-01T00:00:00.000Z"), "2026-01-01T00:00:00.000Z")
    assert.equal(timestamp(new Date("2026-01-01T00:00:00.000Z")), "2026-01-01T00:00:00.000Z")
    assert.equal(contentHash("use pnpm"), "962d19749afe5a8fb511ea7b17458065dbf11a89ee104a67d0e5cb89d16485c7")
  })
})
