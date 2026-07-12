import { test } from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import { MemoryEngine } from "../src/engine.ts"
import type { LocalLearningEventInput, LocalLearningEventSink } from "../src/types.ts"
import { tempDir } from "./helpers.ts"

function eventEngine(): { engine: MemoryEngine; events: LocalLearningEventInput[] } {
  const dir = tempDir()
  const events: LocalLearningEventInput[] = []
  const learningEventSink: LocalLearningEventSink = (event) => { events.push(event) }
  return {
    engine: new MemoryEngine({
      memoryPath: path.join(dir, "memory.jsonl"),
      embeddingsPath: path.join(dir, "embeddings.jsonl"),
      configPath: path.join(dir, "config.json"),
      learningEventSink,
      autoCompact: false,
    }),
    events,
  }
}

test("CLI and MCP review mutations emit the same decision contract from the engine boundary", () => {
  const cases = [
    { name: "CLI approve", actor: "cli" as const, eventType: "suggestion-approved" as const, mutate: (engine: MemoryEngine, id: string) => engine.approve(id, { actor: "cli" }) },
    { name: "MCP reject", actor: "mcp" as const, eventType: "suggestion-rejected" as const, mutate: (engine: MemoryEngine, id: string) => engine.reject(id, { actor: "mcp" }) },
    { name: "CLI delete", actor: "cli" as const, eventType: "suggestion-deleted" as const, mutate: (engine: MemoryEngine, id: string) => engine.delete(id, { actor: "cli" }) },
    { name: "MCP delete", actor: "mcp" as const, eventType: "suggestion-deleted" as const, mutate: (engine: MemoryEngine, id: string) => engine.delete(id, { actor: "mcp" }) },
  ]

  for (const item of cases) {
    const { engine, events } = eventEngine()
    const saved = engine.save({ text: `Pending decision for ${item.name}`, status: "pending", source: "agent-suggested" })
    assert.equal(saved.status, "saved", item.name)
    if (saved.status !== "saved") continue

    const result = item.mutate(engine, saved.memory.id)
    assert.ok(result, item.name)
    assert.deepEqual(events.map((event) => event.eventType), ["suggestion-created", item.eventType], item.name)
    const decision = events[1]
    assert.equal(decision?.actor, item.actor, item.name)
    assert.equal(decision?.memory.id, saved.memory.id, item.name)
    assert.equal(decision?.previousMemory?.status, "pending", item.name)
  }
})

test("approval, rejection, reactivation, replacement, and supersession remain an ordered observable chain after compaction", () => {
  const { engine, events } = eventEngine()
  const saved = engine.save({
    text: "Original reviewed suggestion",
    status: "pending",
    source: "agent-suggested",
    kind: "project_fact",
  })
  assert.equal(saved.status, "saved")
  if (saved.status !== "saved") throw new Error("expected saved suggestion")

  assert.equal(engine.approve(saved.memory.id, { actor: "cli" })?.status, "approved")
  assert.equal(engine.reject(saved.memory.id, { actor: "mcp" })?.status, "rejected")
  assert.equal(engine.approve(saved.memory.id, { actor: "cli" })?.status, "approved")
  const replacement = engine.replace([saved.memory.id], {
    text: "Replacement reviewed suggestion",
    status: "approved",
    kind: "workflow_rule",
    reason: "PRIVATE replacement rationale",
    revisedBy: "mcp",
  })

  const beforeCompaction = events.map((event) => ({
    eventType: event.eventType,
    memoryId: event.memory.id,
    relatedMemoryId: event.relatedMemory?.id,
    previousStatus: event.previousMemory?.status,
    actor: event.actor,
  }))
  assert.deepEqual(beforeCompaction.map((event) => event.eventType), [
    "suggestion-created",
    "suggestion-approved",
    "suggestion-rejected",
    "suggestion-reactivated",
    "suggestion-created",
    "suggestion-replaced",
    "suggestion-superseded",
    "agreement-recommendation-accepted",
  ])
  assert.equal(beforeCompaction[3]?.previousStatus, "rejected")
  assert.equal(beforeCompaction[5]?.relatedMemoryId, replacement.successor.id)
  assert.equal(beforeCompaction[6]?.relatedMemoryId, replacement.successor.id)
  assert.equal(beforeCompaction[5]?.actor, "mcp")

  engine.compact()

  assert.deepEqual(events.map((event) => ({
    eventType: event.eventType,
    memoryId: event.memory.id,
    relatedMemoryId: event.relatedMemory?.id,
    previousStatus: event.previousMemory?.status,
    actor: event.actor,
  })), beforeCompaction)
  assert.equal(engine.list({ all: true }).find((record) => record.id === saved.memory.id)?.revision?.supersededBy, replacement.successor.id)
  assert.equal(engine.list({ all: true }).some((record) => record.id === replacement.successor.id), true)
})

test("failed and dry-run mutations do not claim learning outcomes", () => {
  const { engine, events } = eventEngine()
  const old = engine.save({ text: "Old approved memory", status: "approved" })
  const successor = engine.save({ text: "New approved memory", status: "approved" })
  assert.equal(old.status, "saved")
  assert.equal(successor.status, "saved")
  if (old.status !== "saved" || successor.status !== "saved") throw new Error("expected saved fixtures")
  const createdEvents = events.length

  engine.supersede(successor.memory.id, [old.memory.id], { dryRun: true, revisedBy: "cli" })
  assert.equal(engine.approve("missing", { actor: "mcp" }), undefined)
  assert.equal(engine.reject("missing", { actor: "cli" }), undefined)
  assert.equal(engine.delete("missing", { actor: "mcp" }), undefined)

  assert.equal(events.length, createdEvents)
})
