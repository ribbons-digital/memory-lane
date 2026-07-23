import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import { MemoryEngine, writeConfig } from "@memory-lane/core"
import { tempDir } from "../../core/test/helpers.js"
import { persistGovernedLifecycleCandidates } from "../src/automatic-capture.ts"
import type { MemoryCandidate, StopInput } from "../src/types.ts"

function engineFor(mode: "off" | "conservative" | "aggressive" = "conservative", limits?: Record<string, number>): { engine: MemoryEngine; cwd: string } {
  const cwd = tempDir()
  const configPath = path.join(cwd, "config.json")
  writeConfig(configPath, { memory: { lifecycleCapture: { mode, ...(limits ? { limits } : {}) } } })
  const engine = new MemoryEngine({
    memoryPath: path.join(cwd, "memory.jsonl"),
    embeddingsPath: path.join(cwd, "embeddings.jsonl"),
    configPath,
  })
  engine.refreshScope(cwd)
  return { engine, cwd }
}

function candidate(text: string, kind: MemoryCandidate["kind"]): MemoryCandidate {
  return { text, kind, category: "project", scopeType: "project", confidence: 0.9, decision: "save-approved", reason: "test", source: "agent-suggested" }
}

function persist(engine: MemoryEngine, input: StopInput, candidates: MemoryCandidate[]) {
  return persistGovernedLifecycleCandidates({
    engine,
    input,
    candidates,
    save(item) {
      return engine.save({
        text: item.text,
        category: item.category,
        scopeType: item.scopeType,
        kind: item.kind,
        status: item.decision === "save-approved" ? "approved" : "pending",
        source: item.source,
        provenance: { adapter: "test", lifecycleEvent: "turn_stop", sessionId: input.sessionId, turnId: input.turnId },
      })
    },
  })
}

test("governed persistence derives admission state from one shared memory list", () => {
  const { engine, cwd } = engineFor("conservative")
  const originalList = engine.list.bind(engine)
  let listCalls = 0
  engine.list = ((options) => {
    listCalls += 1
    return originalList(options)
  }) as typeof engine.list

  const result = persist(engine, { cwd, sessionId: "shared-list-session", turnId: "shared-list-turn" }, [
    candidate("The durable shared-list outcome is verified.", "project_fact"),
  ])

  assert.equal(result.capture.pendingWritten, 1)
  assert.equal(listCalls, 1)
})

test("conservative and aggressive modes apply stable quality behavior", () => {
  const conservative = engineFor("conservative")
  const aggressive = engineFor("aggressive")
  const ambiguous = candidate("This is the selected project workflow.", "project_fact")

  assert.equal(persist(conservative.engine, { cwd: conservative.cwd, sessionId: "s", turnId: "t" }, [ambiguous]).capture.qualitySuppressed, 1)
  assert.equal(persist(aggressive.engine, { cwd: aggressive.cwd, sessionId: "s", turnId: "t" }, [ambiguous]).capture.pendingWritten, 1)
})

test("per-turn admission is deterministic and prioritizes corrections and procedures", () => {
  const { engine, cwd } = engineFor("conservative", { perTurn: 2, perSession: 8, pendingBacklog: 20 })
  const result = persist(engine, { cwd, sessionId: "s", turnId: "t" }, [
    candidate("Merged PR #88 with cache safety and a documented durable outcome.", "project_checkpoint"),
    candidate("Procedure: Run pnpm test before completion and verify the output.", "procedure"),
    candidate("Workflow correction: Always wait for approval before merging.", "correction"),
  ])

  assert.equal(result.capture.pendingWritten, 2)
  assert.equal(result.capture.limitSuppressed, 1)
  assert.deepEqual(engine.reviewPending().map((memory) => memory.kind), ["correction", "procedure"])
})

test("per-session admission remains bounded across turns", () => {
  const { engine, cwd } = engineFor("conservative", { perTurn: 5, perSession: 2, pendingBacklog: 20 })
  for (let index = 0; index < 3; index += 1) {
    persist(engine, { cwd, sessionId: "bounded-session", turnId: `turn-${index}` }, [candidate(`Durable project outcome ${index} is now verified.`, "project_fact")])
  }
  assert.equal(engine.reviewPending().length, 2)
})

test("multi-session automatic stream stays bounded while useful candidates survive", () => {
  const { engine, cwd } = engineFor("conservative", { perTurn: 2, perSession: 4, pendingBacklog: 5 })
  let advisoryCount = 0
  for (let session = 0; session < 6; session += 1) {
    const result = persist(engine, { cwd, sessionId: `stream-${session}`, turnId: `turn-${session}` }, [
      candidate(`Released v1.0.${session}.`, "project_checkpoint"),
      candidate(`Durable project outcome ${session} records verified behavior for the release workflow.`, "project_fact"),
      ...(session === 0 ? [candidate("Workflow correction: Always obtain review approval before merging.", "correction")] : []),
      ...(session === 1 ? [candidate("Procedure: Run pnpm test, inspect failures, and verify the successful retry.", "procedure")] : []),
    ])
    if (result.capture.advisory) advisoryCount += 1
  }

  const pending = engine.reviewPending()
  assert.ok(pending.length <= 5)
  assert.ok(pending.some((memory) => memory.kind === "correction"))
  assert.ok(pending.some((memory) => memory.kind === "procedure"))
  assert.ok(pending.every((memory) => !/^Released v/iu.test(memory.text)))
  assert.ok(advisoryCount > 0)
})

test("backlog ceiling returns one actionable advisory and explicit suggestions remain exempt", () => {
  const { engine, cwd } = engineFor("conservative", { perTurn: 5, perSession: 8, pendingBacklog: 2 })
  persist(engine, { cwd, sessionId: "s1", turnId: "t1" }, [candidate("Durable outcome one is verified.", "project_fact")])
  persist(engine, { cwd, sessionId: "s2", turnId: "t2" }, [candidate("Durable outcome two is verified.", "project_fact")])

  const blocked = persist(engine, { cwd, sessionId: "s3", turnId: "t3" }, [
    candidate("Durable outcome three is verified.", "project_fact"),
    candidate("Durable outcome four is verified.", "project_fact"),
  ])
  assert.equal(blocked.capture.pendingWritten, 0)
  assert.equal(blocked.capture.limitSuppressed, 2)
  assert.equal(blocked.capture.advisory?.reviewAction, "memory-lane review")

  const explicit = engine.suggest("Explicit tool suggestion remains reviewable.", "project", "project")
  assert.equal(explicit.status, "saved")
  assert.equal(engine.reviewPending().length, 3)
})
