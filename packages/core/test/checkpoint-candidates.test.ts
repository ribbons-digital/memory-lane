import test from "node:test"
import assert from "node:assert/strict"
import { classifyCheckpointCandidate } from "../src/checkpoint-candidates.ts"
import type { MemoryRecord } from "../src/types.ts"

function memory(text: string, kind?: MemoryRecord["kind"]): MemoryRecord {
  return {
    id: "mem-1",
    status: "pending",
    text,
    category: "project",
    scope: { type: "project", key: "test-project" },
    source: "user-suggested",
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
    ...(kind ? { kind } : {}),
  }
}

test("classifies release checkpoint candidates", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Released v0.2.9.")), {
    detected: true,
    kind: "release",
    reason: "matched release version phrase",
  })
  assert.deepEqual(classifyCheckpointCandidate(memory("Tagged v1.0.0 after release verification."))?.kind, "release")
})

test("classifies merge checkpoint candidates", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Merged PR #13 adding prompt continuity intents.")), {
    detected: true,
    kind: "merge",
    reason: "matched merged pull request phrase",
  })
  assert.deepEqual(classifyCheckpointCandidate(memory("PR #14 merged after review."))?.kind, "merge")
})

test("classifies verification checkpoint candidates", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Tests passed and build passed for the lifecycle package.")), {
    detected: true,
    kind: "verification",
    reason: "matched verification passed phrase",
  })
})

test("classifies docs-sync checkpoint candidates", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Updated ROADMAP.md and HANDOFF.md after release docs sync.")), {
    detected: true,
    kind: "docs-sync",
    reason: "matched docs sync phrase",
  })
})

test("classifies roadmap-decision checkpoint candidates", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Roadmap decision: Phase 17 starts with checkpoint candidate review labeling.")), {
    detected: true,
    kind: "roadmap-decision",
    reason: "matched roadmap decision phrase",
  })
})

test("classifies major-fix checkpoint candidates", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Fixed blocker in prompt continuity guidance shell quoting.")), {
    detected: true,
    kind: "major-fix",
    reason: "matched major fix phrase",
  })
})

test("labels project_checkpoint kind even with simple text", () => {
  assert.deepEqual(classifyCheckpointCandidate(memory("Prompt continuity checkpoint recorded.", "project_checkpoint")), {
    detected: true,
    kind: "project",
    reason: "kind is project_checkpoint",
  })
})

test("does not classify ambiguous memories", () => {
  assert.equal(classifyCheckpointCandidate(memory("Please test the release command later.")), undefined)
  assert.equal(classifyCheckpointCandidate(memory("We may merge this eventually.")), undefined)
  assert.equal(classifyCheckpointCandidate(memory("Remember to update docs sometime.")), undefined)
})
