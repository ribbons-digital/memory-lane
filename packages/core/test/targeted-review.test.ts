import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { MemoryEngine, TARGETED_REVIEW_MAX_REVISION_ATTEMPTS } from "../src/index.js"
import { tempDir } from "./helpers.js"

function engine() {
  const dir = tempDir()
  const memoryPath = path.join(dir, "memory.jsonl")
  return { engine: new MemoryEngine({ memoryPath, embeddingsPath: path.join(dir, "embeddings.jsonl") }), memoryPath }
}

function savedId(result: ReturnType<MemoryEngine["save"]>): string {
  assert.equal(result.status, "saved")
  if (result.status !== "saved") throw new Error("expected saved")
  return result.memory.id
}

test("targeted review returns a stable clean receipt for exactly one current candidate without writes", () => {
  const { engine: e, memoryPath } = engine()
  const id = savedId(e.save({ text: "Across all projects, prefer concise status updates.", status: "pending", category: "preference", kind: "preference", source: "agent-suggested", scopeType: "global" }))
  savedId(e.save({ text: "What should we do with this?", status: "pending", category: "project", source: "agent-suggested" }))
  const before = fs.readFileSync(memoryPath, "utf8")

  const first = e.reviewSuggestion(id)
  const second = e.reviewSuggestion(id)

  assert.deepEqual(first, second)
  assert.deepEqual(first, {
    id,
    currentText: "Across all projects, prefer concise status updates.",
    scope: { type: "global" },
    kind: "preference",
    qualitySignals: [],
    reasons: [],
    suggestedAction: "none",
    attemptState: { revisionAttempts: 0, maxRevisionAttempts: TARGETED_REVIEW_MAX_REVISION_ATTEMPTS, remainingRevisionAttempts: TARGETED_REVIEW_MAX_REVISION_ATTEMPTS },
    outcome: "clean",
  })
  assert.equal(fs.readFileSync(memoryPath, "utf8"), before)
})

test("targeted review returns flagged structured output and excludes unrelated pending records", () => {
  const { engine: e } = engine()
  const id = savedId(e.save({ text: "What should we do with this?", status: "pending", source: "agent-suggested", kind: "misc" }))
  const unrelated = savedId(e.save({ text: "```sh\npnpm test\n```", status: "pending", source: "agent-suggested" }))

  const receipt = e.reviewSuggestion(id)

  assert.equal(receipt?.id, id)
  assert.equal(JSON.stringify(receipt).includes(unrelated), false)
  assert.deepEqual(receipt?.qualitySignals.map((signal) => signal.code), ["contains-question", "ambiguous-reference"])
  assert.deepEqual(receipt?.reasons, receipt?.qualitySignals.map((signal) => signal.reason))
  assert.equal(receipt?.suggestedAction, "revise")
  assert.equal(receipt?.outcome, "revise")
})

test("targeted review routes non-text-fixable rescoping signals directly to human review", () => {
  const { engine: e } = engine()
  e.refreshScope(tempDir())
  const rescopingOnlyId = savedId(e.save({
    text: "The project uses pnpm for package installation.",
    status: "pending",
    category: "project",
    kind: "project_fact",
    source: "agent-suggested",
    scopeType: "global",
  }))
  const mixedId = savedId(e.save({
    text: "What should we do with this project?",
    status: "pending",
    category: "project",
    kind: "project_fact",
    source: "agent-suggested",
    scopeType: "global",
  }))

  const rescopingOnly = e.reviewSuggestion(rescopingOnlyId)
  assert.deepEqual(rescopingOnly?.qualitySignals.map((signal) => [signal.code, signal.suggestedAction]), [
    ["cross-project-global-candidate", "consider-rescoping"],
  ])
  assert.equal(rescopingOnly?.attemptState.remainingRevisionAttempts, TARGETED_REVIEW_MAX_REVISION_ATTEMPTS)
  assert.equal(rescopingOnly?.outcome, "needs-human-review")
  assert.equal(rescopingOnly?.suggestedAction, "request-human-review")

  const mixed = e.reviewSuggestion(mixedId)
  assert.ok(mixed?.qualitySignals.some((signal) => signal.suggestedAction === "inspect"))
  assert.ok(mixed?.qualitySignals.some((signal) => signal.suggestedAction === "consider-rescoping"))
  assert.equal(mixed?.outcome, "needs-human-review")
  assert.equal(mixed?.suggestedAction, "request-human-review")
})

test("same-id pending revision preserves provenance and scope, records attempts, and never approves", () => {
  const { engine: e } = engine()
  const provenance = { adapter: "claude-code", lifecycleEvent: "turn_stop" as const, sessionId: "session-1" }
  const id = savedId(e.save({ text: "What should we do with this?", status: "pending", category: "preference", kind: "preference", source: "agent-suggested", provenance, scopeType: "global" }))

  const receipt = e.revisePendingSuggestion(id, { text: "Across all projects, prefer pnpm for package installation.", reason: "automatic quality revision", revisedBy: "lifecycle" })
  const current = e.list({ status: "pending" }).find((memory) => memory.id === id)

  assert.equal(receipt.id, id)
  assert.equal(receipt.outcome, "clean")
  assert.equal(receipt.attemptState.revisionAttempts, 1)
  assert.equal(current?.id, id)
  assert.equal(current?.status, "pending")
  assert.deepEqual(current?.provenance, provenance)
  assert.deepEqual(current?.scope, { type: "global" })
  assert.equal(current?.revision?.automaticReviewAttempts, 1)
  assert.equal(current?.revision?.reason, "automatic quality revision")
  assert.equal(e.list({ status: "approved" }).length, 0)
})

test("repeated flagged revisions exhaust the finite retry limit and stabilize at human review", () => {
  const { engine: e, memoryPath } = engine()
  const id = savedId(e.save({ text: "What should we do with this?", status: "pending", source: "agent-suggested" }))

  for (let attempt = 1; attempt <= TARGETED_REVIEW_MAX_REVISION_ATTEMPTS; attempt += 1) {
    const receipt = e.revisePendingSuggestion(id, { text: `What should we do with this task ${attempt}?`, reason: `attempt ${attempt}`, revisedBy: "lifecycle" })
    assert.equal(receipt.attemptState.revisionAttempts, attempt)
  }
  const before = fs.readFileSync(memoryPath, "utf8")
  const exhausted = e.reviewSuggestion(id)
  assert.equal(exhausted?.outcome, "needs-human-review")
  assert.equal(exhausted?.suggestedAction, "request-human-review")
  assert.equal(exhausted?.attemptState.remainingRevisionAttempts, 0)
  assert.deepEqual(e.reviewSuggestion(id), exhausted)
  assert.equal(fs.readFileSync(memoryPath, "utf8"), before)
  assert.throws(() => e.revisePendingSuggestion(id, { text: "Still ambiguous, what now?" }), /automatic revision attempt limit/iu)
})

test("targeted review and revision enforce pending-only and current scope boundaries", () => {
  const { engine: e } = engine()
  const projectA = tempDir()
  const projectB = tempDir()
  e.refreshScope(projectA)
  const hiddenId = savedId(e.save({ text: "What should we do with this?", status: "pending", scopeType: "project", source: "agent-suggested" }))
  const approvedId = savedId(e.save({ text: "Approved durable fact.", status: "approved", scopeType: "global" }))
  e.refreshScope(projectB)

  assert.equal(e.reviewSuggestion(hiddenId), undefined)
  assert.equal(e.reviewSuggestion(approvedId), undefined)
  assert.equal(e.revisePendingSuggestion(hiddenId, { text: "Safe replacement." }), undefined)
  assert.equal(e.revisePendingSuggestion(approvedId, { text: "Safe replacement." }), undefined)
  assert.ok(e.reviewSuggestion(hiddenId, { all: true }))
})
