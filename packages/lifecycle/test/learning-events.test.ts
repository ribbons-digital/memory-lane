import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { MemoryEngine, type LocalLearningEventInput, type MemoryRecord } from "@memory-lane/core"
import { tempDir } from "../../core/test/helpers.js"
import { createLearningEventSink, TRIGGER_CONTEXT_MAX_CHARS, type LearningEventV1 } from "../src/learning-events.ts"
import { localLearningProjectHash, purgeTraces, traceStatus, TRACE_RETENTION_DAYS, TRACE_RETENTION_MAX_BYTES } from "../src/trace-capture.ts"

function writeConfig(configPath: string, learning: { capture: "on" | "off"; excludedProjects?: string[] }): void {
  fs.writeFileSync(configPath, JSON.stringify({ learning }), "utf8")
}

function memory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "private-memory-id",
    text: "PRIVATE MEMORY TEXT must never enter an event",
    category: "project",
    scope: { type: "project", key: "owner-project" },
    source: "agent-suggested",
    status: "pending",
    kind: "project_fact",
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-10T10:00:00.000Z",
    project: { key: "owner-project", root: "/private/absolute/project/path" },
    provenance: {
      adapter: "codex",
      lifecycleEvent: "turn_stop",
      sessionId: "private-session-id",
      turnId: "private-turn-id",
      transcriptPath: "/private/absolute/transcript.jsonl",
    },
    ...overrides,
  }
}

function eventFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "_projects.json") files.push(child)
    }
  }
  visit(root)
  return files.sort()
}

function readEvents(root: string): LearningEventV1[] {
  return eventFiles(root).map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as LearningEventV1)
}

function capture(root: string, configPath: string, input: LocalLearningEventInput, now = "2026-07-10T12:00:00.000Z"): void {
  createLearningEventSink({ traceRoot: root, configPath, now: () => new Date(now) })(input)
}

test("explicitly disabled learning creates no event directory", () => {
  const dir = tempDir()
  const root = path.join(dir, "traces")
  const configPath = path.join(dir, "config.json")
  writeConfig(configPath, { capture: "off" })

  capture(root, configPath, { eventType: "suggestion-created", memory: memory(), actingProjectKey: "owner-project" })

  assert.equal(fs.existsSync(root), false)
})

test("event consent is conservative across owning and acting project exclusions", () => {
  const cases = [
    { name: "excluded owner", excluded: "owner-project", actingProjectKey: "caller-project" },
    { name: "excluded caller", excluded: "caller-project", actingProjectKey: "caller-project" },
  ]

  for (const item of cases) {
    const dir = tempDir()
    const root = path.join(dir, "traces")
    const configPath = path.join(dir, "config.json")
    writeConfig(configPath, { capture: "on", excludedProjects: [item.excluded] })

    capture(root, configPath, {
      eventType: "suggestion-approved",
      memory: memory({ status: "approved", updatedAt: "2026-07-10T11:00:00.000Z" }),
      previousMemory: memory(),
      actingProjectKey: item.actingProjectKey,
      actor: "cli",
    })

    assert.deepEqual(eventFiles(root), [], item.name)
  }
})

test("decision events route by subject ownership and global subjects route to the global ledger", () => {
  const dir = tempDir()
  const root = path.join(dir, "traces")
  const configPath = path.join(dir, "config.json")
  writeConfig(configPath, { capture: "on" })

  capture(root, configPath, {
    eventType: "suggestion-approved",
    memory: memory({ status: "approved", updatedAt: "2026-07-10T11:00:00.000Z" }),
    previousMemory: memory(),
    actingProjectKey: "different-caller-project",
    actor: "mcp",
  })
  capture(root, configPath, {
    eventType: "suggestion-deleted",
    memory: memory({ id: "global-private-id", scope: { type: "global" }, status: "deleted", updatedAt: "2026-07-10T11:01:00.000Z" }),
    actingProjectKey: "different-caller-project",
    actor: "mcp",
  })

  assert.equal(fs.readdirSync(path.join(root, localLearningProjectHash("owner-project"), "events")).length, 1)
  assert.equal(fs.readdirSync(path.join(root, "_global", "events")).length, 1)
})

test("suggestion capture is content-free, stable, and bounds trigger and reason inputs before digesting", () => {
  const dir = tempDir()
  const root = path.join(dir, "traces")
  const configPath = path.join(dir, "config.json")
  writeConfig(configPath, { capture: "on" })
  const prefix = "x".repeat(TRIGGER_CONTEXT_MAX_CHARS)
  const first = memory()

  capture(root, configPath, {
    eventType: "suggestion-created",
    memory: first,
    actingProjectKey: "owner-project",
    triggerContext: `${prefix} FIRST PRIVATE SUFFIX`,
  })
  const created = readEvents(root)[0]
  assert.ok(created)

  capture(root, configPath, {
    eventType: "suggestion-created",
    memory: first,
    actingProjectKey: "owner-project",
    triggerContext: `${prefix} SECOND PRIVATE SUFFIX`,
  })
  capture(root, configPath, {
    eventType: "suggestion-rejected",
    memory: memory({ status: "rejected", updatedAt: "2026-07-10T11:00:00.000Z" }),
    previousMemory: first,
    actingProjectKey: "owner-project",
    actor: "cli",
    reason: "PRIVATE FREE TEXT REASON",
  })

  const events = readEvents(root)
  assert.equal(events.length, 2)
  assert.equal(events.find((event) => event.eventType === "suggestion-created")?.eventId, created.eventId)
  assert.equal(events.find((event) => event.eventType === "suggestion-created")?.triggerContextDigest, created.triggerContextDigest)
  const bytes = eventFiles(root).map((file) => fs.readFileSync(file, "utf8")).join("\n")
  for (const forbidden of [
    first.text,
    first.id,
    "owner-project",
    "private-session-id",
    "private-turn-id",
    "/private/absolute/project/path",
    "/private/absolute/transcript.jsonl",
    "PRIVATE FREE TEXT REASON",
    "FIRST PRIVATE SUFFIX",
    "SECOND PRIVATE SUFFIX",
  ]) assert.equal(bytes.includes(forbidden), false, forbidden)
  assert.match(created.eventId, /^[a-f0-9]{64}$/u)
  assert.match(created.triggerContextDigest ?? "", /^[a-f0-9]{64}$/u)
  assert.match(events.find((event) => event.eventType === "suggestion-rejected")?.decision?.reasonDigest ?? "", /^[a-f0-9]{64}$/u)
})

test("memory compaction cannot erase captured suggestion and terminal decision events", () => {
  const dir = tempDir()
  const root = path.join(dir, "traces")
  const configPath = path.join(dir, "config.json")
  writeConfig(configPath, { capture: "on" })
  const engine = new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath,
    learningEventSink: createLearningEventSink({ configPath, traceRoot: root, now: () => new Date("2026-07-10T12:00:00.000Z") }),
    autoCompact: false,
  })
  const saved = engine.save({ text: "PRIVATE compaction outcome", status: "pending", scopeType: "global", source: "agent-suggested" })
  assert.equal(saved.status, "saved")
  if (saved.status !== "saved") throw new Error("expected saved fixture")
  assert.equal(engine.reject(saved.memory.id, { actor: "cli" })?.status, "rejected")
  const before = eventFiles(root).map((file) => fs.readFileSync(file, "utf8"))

  engine.compact()

  assert.equal(engine.list({ all: true }).some((record) => record.id === saved.memory.id), false)
  assert.deepEqual(eventFiles(root).map((file) => fs.readFileSync(file, "utf8")), before)
  assert.deepEqual(readEvents(root).map((event) => event.eventType).sort(), ["suggestion-created", "suggestion-rejected"])
})

test("repeated agreement display keeps one recommendation identity until the subject version changes", () => {
  const dir = tempDir()
  const root = path.join(dir, "traces")
  const configPath = path.join(dir, "config.json")
  writeConfig(configPath, { capture: "on" })
  const shown: LocalLearningEventInput = {
    eventType: "agreement-recommendation-shown",
    memory: memory(),
    actingProjectKey: "owner-project",
    actor: "cli",
    recommendedAction: "update-kind-workflow-rule",
  }

  capture(root, configPath, shown, "2026-07-10T12:00:00.000Z")
  capture(root, configPath, shown, "2026-07-10T12:00:00.000Z")
  capture(root, configPath, { ...shown, memory: memory({ updatedAt: "2026-07-12T12:00:00.000Z" }) }, "2026-07-12T12:00:00.000Z")

  const events = readEvents(root)
  assert.equal(events.length, 3)
  assert.equal(new Set(events.map((event) => event.eventId)).size, 3)
  assert.equal(new Set(events.map((event) => event.recommendationId)).size, 2)
  assert.equal(events.every((event) => event.eventType === "agreement-recommendation-shown"), true)

  const accepted = memory({ status: "approved", kind: "workflow_rule", updatedAt: "2026-07-13T12:00:00.000Z" })
  for (const recommendedAction of ["replace", "supersede"] as const) {
    capture(root, configPath, {
      eventType: "agreement-recommendation-accepted",
      memory: accepted,
      previousMemory: shown.memory,
      actingProjectKey: "owner-project",
      actor: "cli",
      recommendedAction,
    })
  }
  assert.deepEqual(
    readEvents(root)
      .filter((event) => event.eventType === "agreement-recommendation-accepted")
      .map((event) => event.recommendedAction?.type)
      .sort(),
    ["replace", "supersede"],
  )
})

test("event files participate in combined age retention, status counts, and privacy purge", () => {
  const dir = tempDir()
  const root = path.join(dir, "traces")
  const configPath = path.join(dir, "config.json")
  writeConfig(configPath, { capture: "on" })
  const eventDir = path.join(root, localLearningProjectHash("owner-project"), "events")
  fs.mkdirSync(eventDir, { recursive: true })
  const expiredEvent = path.join(eventDir, "expired.json")
  fs.writeFileSync(expiredEvent, "{}", "utf8")
  const now = new Date("2026-07-10T12:00:00.000Z")
  const expiredAt = new Date(now.getTime() - (TRACE_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000)
  fs.utimesSync(expiredEvent, expiredAt, expiredAt)
  const oversizedEvent = path.join(eventDir, "oversized-oldest.json")
  fs.writeFileSync(oversizedEvent, "{}", "utf8")
  fs.truncateSync(oversizedEvent, TRACE_RETENTION_MAX_BYTES + 1)
  const oversizedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  fs.utimesSync(oversizedEvent, oversizedAt, oversizedAt)

  capture(root, configPath, { eventType: "suggestion-created", memory: memory(), actingProjectKey: "owner-project" }, now.toISOString())

  assert.equal(fs.existsSync(expiredEvent), false)
  assert.equal(fs.existsSync(oversizedEvent), false)
  const beforePurge = traceStatus(configPath, root)
  assert.equal(beforePurge.fileCount, 1)
  assert.ok(beforePurge.totalBytes > 0)
  const purged = purgeTraces(undefined, root)
  assert.equal(purged.removedFiles, 1)
  assert.equal(purged.removedBytes, beforePurge.totalBytes)
  assert.deepEqual(traceStatus(configPath, root).fileCount, 0)
})
