import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { contentHash } from "../src/engine-helpers.js"
import { createSingleStoreEngineStorage, createTwoTierEngineStorage } from "../src/storage-facade.js"
import { createMemoryId } from "../src/storage.js"
import { projectLocalPaths, type MemoryPaths } from "../src/storage-locations.js"
import type { MemoryRecord } from "../src/types.js"
import { tempDir } from "./helpers.js"

function rec(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString()
  return {
    id: createMemoryId(),
    status: "approved",
    text: "test",
    category: "project",
    scope: { type: "project", key: "/p" },
    source: "manual",
    createdAt: now,
    updatedAt: now,
    project: { cwd: "/p", root: "/p", key: "/p" },
    ...overrides,
  }
}

describe("MemoryEngineStorage single-store facade", () => {
  let dir: string
  let memoryFile: string
  let embeddingFile: string

  beforeEach(() => {
    dir = tempDir()
    memoryFile = path.join(dir, "memories.jsonl")
    embeddingFile = path.join(dir, "embeddings.jsonl")
  })

  it("routes memory append, appendMany, list, read log, and diagnostics through one store", () => {
    const storage = createSingleStoreEngineStorage(memoryFile, embeddingFile)
    const first = rec({ id: "a", text: "first", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })
    storage.appendMemory(first)
    const cached = storage.listMemories()

    storage.appendMemories([
      rec({ id: "a", text: "updated", createdAt: first.createdAt, updatedAt: "2026-01-02T00:00:00.000Z" }),
      rec({ id: "b", text: "second", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" }),
    ])

    const listed = storage.listMemories()
    assert.notEqual(listed, cached)
    assert.deepEqual(listed.map((memory) => [memory.id, memory.text]), [["a", "updated"], ["b", "second"]])
    assert.equal(storage.readMemoryLog().length, 3)
    assert.equal(storage.memoryDiagnostics().validRows, 3)
  })

  it("routes embedding appends and invalidations through the facade", () => {
    const storage = createSingleStoreEngineStorage(memoryFile, embeddingFile)
    storage.appendEmbedding({
      memoryId: "a",
      memoryUpdatedAt: "2026-01-01T00:00:00.000Z",
      contentHash: contentHash("hello"),
      profileName: "default",
      model: "test-model",
      dimensions: 2,
      vector: [0.1, 0.2],
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    storage.appendEmbedding({ type: "invalidation", memoryId: "a", invalidatedAt: "2026-01-02T00:00:00.000Z", reason: "updated" })

    assert.equal(storage.listEmbeddings().length, 1)
    assert.equal(storage.listEmbeddingInvalidations().length, 1)
  })

  it("refreshes facade memory reads after compaction", () => {
    const storage = createSingleStoreEngineStorage(memoryFile, embeddingFile)
    storage.appendMemories([
      rec({ id: "a", text: "old", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }),
      rec({ id: "a", text: "new", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" }),
    ])
    const cached = storage.listMemories()
    assert.equal(cached[0].text, "new")
    assert.equal(storage.readMemoryLog().length, 2)

    const report = storage.compact()
    assert.equal(report.removedMemories, 0)
    assert.equal(storage.listMemories()[0].text, "new")
    assert.notEqual(storage.listMemories(), cached)
    assert.equal(storage.readMemoryLog().length, 1)
  })
})

function homePathsFor(root: string): MemoryPaths {
  return {
    kind: "home",
    root,
    memoryPath: path.join(root, "memory.jsonl"),
    embeddingsPath: path.join(root, "embeddings.jsonl"),
    configPath: path.join(root, "config.json"),
  }
}

describe("MemoryEngineStorage two-tier facade", () => {
  it("routes new project memories project-side and global memories home-side", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const projectRoot = path.join(dir, "project")
    const project = projectLocalPaths(projectRoot)
    const storage = createTwoTierEngineStorage(home, project, "scope-key")

    const projectMemory = rec({ id: "project", scope: { type: "project", key: "scope-key" }, project: { cwd: projectRoot, root: projectRoot, key: "scope-key" } })
    const globalMemory = rec({ id: "global", category: "preference", scope: { type: "global" }, project: undefined })

    storage.appendMemory(projectMemory)
    storage.appendMemory(globalMemory)

    assert.ok(fs.readFileSync(project.memoryPath, "utf8").includes('"id":"project"'))
    assert.ok(fs.readFileSync(home.memoryPath, "utf8").includes('"id":"global"'))
    assert.equal(fs.existsSync(path.join(projectRoot, ".gitignore")), true)
    assert.ok(fs.readFileSync(path.join(projectRoot, ".gitignore"), "utf8").includes(".memory-lane/"))
  })

  it("folds duplicate ids across stores by updatedAt rather than store order", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")

    const oldHome = rec({ id: "same", text: "old", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", scope: { type: "global" }, project: undefined })
    const newProject = rec({ id: "same", text: "new", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", scope: { type: "project", key: "scope-key" }, project: { cwd: project.root, root: project.root, key: "scope-key" } })

    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(oldHome)
    createSingleStoreEngineStorage(project.memoryPath, project.embeddingsPath).appendMemory(newProject)

    assert.deepEqual(storage.listMemories().map((memory) => [memory.id, memory.text]), [["same", "new"]])
  })

  it("preserves append-order last-write-wins within a store for same-timestamp duplicate ids", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const sameTime = "2026-01-01T00:00:00.000Z"
    const original = rec({ id: "same-store", text: "old", createdAt: sameTime, updatedAt: sameTime, scope: { type: "global" }, project: undefined })
    const updated = rec({ ...original, text: "new" })

    storage.appendMemories([original, updated])

    assert.deepEqual(storage.listMemories().map((memory) => [memory.id, memory.text]), [["same-store", "new"]])
    storage.compact()
    assert.deepEqual(storage.listMemories().map((memory) => [memory.id, memory.text]), [["same-store", "new"]])
  })

  it("uses stable project-store precedence for same-timestamp cross-store duplicate ids", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const sameTime = "2026-01-01T00:00:00.000Z"

    const projectRecord = rec({ id: "same-time", text: "project wins", createdAt: sameTime, updatedAt: sameTime, scope: { type: "project", key: "scope-key" }, project: { cwd: project.root, root: project.root, key: "scope-key" } })
    const homeRecord = rec({ id: "same-time", text: "home loses", createdAt: sameTime, updatedAt: sameTime, scope: { type: "global" }, project: undefined })

    createSingleStoreEngineStorage(project.memoryPath, project.embeddingsPath).appendMemory(projectRecord)
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(homeRecord)

    assert.deepEqual(storage.listMemories().map((memory) => [memory.id, memory.text]), [["same-time", "project wins"]])
    storage.appendMemory(rec({ ...homeRecord, text: "same-time update" }))
    assert.equal(fs.readFileSync(project.memoryPath, "utf8").includes("same-time update"), true)
  })

  it("does not route another project's new memory into the active project store", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project-a"))
    const storage = createTwoTierEngineStorage(home, project, "project-a")

    storage.appendMemory(rec({ id: "project-b", scope: { type: "project", key: "project-b" }, project: { cwd: "/b", root: "/b", key: "project-b" } }))

    assert.ok(fs.readFileSync(home.memoryPath, "utf8").includes('"id":"project-b"'))
    assert.equal(fs.existsSync(project.memoryPath), false)
  })

  it("routes existing ids to their origin store and embeddings to the owning side", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")

    const homeOrigin = rec({ id: "home-origin", text: "home old", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", scope: { type: "global" }, project: undefined })
    storage.appendMemory(homeOrigin)
    storage.appendMemory(rec({ ...homeOrigin, text: "home updated", updatedAt: "2026-01-02T00:00:00.000Z", scope: { type: "project", key: "scope-key" }, project: { cwd: project.root, root: project.root, key: "scope-key" } }))
    storage.appendEmbedding({
      memoryId: "home-origin",
      memoryUpdatedAt: "2026-01-02T00:00:00.000Z",
      contentHash: contentHash("home updated"),
      profileName: "default",
      model: "test-model",
      dimensions: 1,
      vector: [1],
      createdAt: "2026-01-02T00:00:00.000Z",
    })

    assert.equal(fs.readFileSync(home.memoryPath, "utf8").match(/home-origin/g)?.length, 2)
    assert.equal(fs.existsSync(project.memoryPath), false)
    assert.ok(fs.readFileSync(home.embeddingsPath, "utf8").includes("home-origin"))
    assert.equal(fs.existsSync(project.embeddingsPath), false)
  })

  it("compacts active home and project stores", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")

    storage.appendMemory(rec({ id: "home-live", scope: { type: "global" }, project: undefined }))
    storage.appendMemory(rec({ id: "project-live", scope: { type: "project", key: "scope-key" }, project: { cwd: project.root, root: project.root, key: "scope-key" } }))
    storage.appendMemory(rec({ id: "project-deleted", status: "deleted", scope: { type: "project", key: "scope-key" }, project: { cwd: project.root, root: project.root, key: "scope-key" } }))

    const report = storage.compact()

    assert.equal(report.removedMemories, 1)
    assert.equal(storage.listMemories().some((memory) => memory.id === "project-deleted"), false)
    assert.ok(fs.readFileSync(project.memoryPath, "utf8").includes("project-live"))
  })

  it("preserves invalid rows when compacting two-tier stores", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const projectLive = rec({ id: "project-live", scope: { type: "project", key: "scope-key" }, project: { cwd: project.root, root: project.root, key: "scope-key" } })
    const invalidRecord = JSON.stringify({ foo: 1 })
    const invalidJson = "{bad json"

    storage.appendMemory(projectLive)
    fs.appendFileSync(project.memoryPath, invalidRecord + "\n" + invalidJson + "\n", "utf8")
    fs.appendFileSync(project.embeddingsPath, "{bad embedding\n", "utf8")

    storage.compact()

    const memoryLines = fs.readFileSync(project.memoryPath, "utf8").split("\n").filter(Boolean)
    assert.equal(memoryLines.length, 3)
    assert.ok(memoryLines.includes(invalidRecord))
    assert.ok(memoryLines.includes(invalidJson))
    assert.ok(fs.readFileSync(project.embeddingsPath, "utf8").includes("{bad embedding"))
  })

  it("does not resurrect older cross-store records after compacting a newer tombstone", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const oldHome = rec({ id: "same", text: "old", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", scope: { type: "global" }, project: undefined })
    const deletedProject = rec({ id: "same", text: "deleted", status: "deleted", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", scope: { type: "project", key: "scope-key" }, project: { cwd: project.root, root: project.root, key: "scope-key" } })

    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(oldHome)
    createSingleStoreEngineStorage(project.memoryPath, project.embeddingsPath).appendMemory(deletedProject)

    const report = storage.compact()

    assert.equal(report.removedMemories, 2)
    assert.deepEqual(storage.listMemories(), [])
    assert.equal(fs.readFileSync(home.memoryPath, "utf8"), "")
    assert.equal(fs.readFileSync(project.memoryPath, "utf8"), "")
  })

  it("reports legacy home-stored current-project candidates without mutating stores", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const projectRoot = path.join(dir, "project")
    const project = projectLocalPaths(projectRoot)
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacyApproved = rec({ id: "legacy-approved", text: "Legacy approved project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-04T00:00:00.000Z" })
    const legacyPending = rec({ id: "legacy-pending", status: "pending", text: "Legacy pending project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    const otherProject = rec({ id: "other-project", scope: { type: "project", key: "other" } })
    const global = rec({ id: "global", category: "preference", scope: { type: "global" }, project: undefined })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemories([legacyPending, otherProject, global, legacyApproved])
    const beforeHome = fs.readFileSync(home.memoryPath, "utf8")

    const report = storage.legacyProjectMemoryDiagnostics("scope-key")

    assert.equal(report.status, "ok")
    assert.equal(report.totalLegacyCandidateCount, 2)
    assert.equal(report.approvedLegacyCandidateCount, 1)
    assert.equal(report.pendingLegacyCandidateCount, 1)
    assert.equal(report.hazards.pending, 1)
    assert.deepEqual(report.samples.map((sample) => sample.id), ["legacy-approved", "legacy-pending"])
    assert.equal(fs.readFileSync(home.memoryPath, "utf8"), beforeHome)
    assert.equal(fs.existsSync(path.join(projectRoot, ".memory-lane")), false)
    assert.equal(fs.existsSync(path.join(projectRoot, ".gitignore")), false)
  })

  it("classifies duplicate-id and home-side embedding hazards", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacy = rec({ id: "duplicate", text: "home winner", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    const projectLoser = rec({ id: "duplicate", text: "project loser", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-02T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    createSingleStoreEngineStorage(project.memoryPath, project.embeddingsPath).appendMemory(projectLoser)
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendEmbedding({
      memoryId: "duplicate",
      memoryUpdatedAt: legacy.updatedAt,
      contentHash: contentHash(legacy.text),
      profileName: "default",
      model: "test-model",
      dimensions: 1,
      vector: [1],
      createdAt: "2026-01-03T00:00:00.000Z",
    })

    const report = storage.legacyProjectMemoryDiagnostics("scope-key")

    assert.equal(report.totalLegacyCandidateCount, 1)
    assert.equal(report.hazards.duplicateIdInProjectStore, 1)
    assert.equal(report.hazards.homeSideEmbeddings, 1)
    assert.equal(report.hazards.mixedOriginRevisionChains, 1)
    assert.deepEqual(report.samples[0].hazards, ["duplicate-id-in-project-store", "home-side-embeddings", "mixed-origin-revision-chain"])
  })

  it("bounds and deterministically orders legacy diagnostic samples", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const records = Array.from({ length: 15 }, (_, index) => rec({
      id: `legacy-${String(index).padStart(2, "0")}`,
      text: `Legacy ${index} `.repeat(40),
      scope: { type: "project", key: "scope-key" },
      createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
      updatedAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
    }))
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemories(records)

    const report = storage.legacyProjectMemoryDiagnostics("scope-key")

    assert.equal(report.totalLegacyCandidateCount, 15)
    assert.equal(report.samples.length, 10)
    assert.deepEqual(report.samples.map((sample) => sample.id), ["legacy-14", "legacy-13", "legacy-12", "legacy-11", "legacy-10", "legacy-09", "legacy-08", "legacy-07", "legacy-06", "legacy-05"])
    assert.ok(report.samples.every((sample) => sample.preview.length <= report.previewLimit))
  })

  it("plans and applies legacy project migration with explicit project-side destination", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key", { producerVersion: "test-version" })
    const legacy = rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendEmbedding({
      memoryId: "legacy",
      memoryUpdatedAt: legacy.updatedAt,
      contentHash: contentHash(legacy.text),
      profileName: "default",
      model: "test-model",
      dimensions: 1,
      vector: [1],
      createdAt: "2026-01-03T00:00:00.000Z",
    })

    const plan = storage.createLegacyProjectMigrationPlan("scope-key")
    assert.equal(plan.candidateCount, 1)
    assert.equal(plan.producerVersion, "test-version")
    assert.equal(plan.blockerCount, 0)
    assert.equal(plan.embeddingActions.copyCompatible, 1)

    const beforeApply = new Date().toISOString()
    const result = storage.applyLegacyProjectMigrationPlan(plan)

    assert.equal(result.migrated, 1)
    assert.equal(result.blocked, 0)
    assert.ok(fs.readFileSync(project.memoryPath, "utf8").includes('"id":"legacy"'))
    const projectEmbedding = JSON.parse(fs.readFileSync(project.embeddingsPath, "utf8").trim())
    assert.equal(projectEmbedding.memoryId, "legacy")
    assert.equal(projectEmbedding.memoryUpdatedAt, plan.candidates[0].destinationRecord.updatedAt)
    assert.ok(projectEmbedding.createdAt >= beforeApply)
    const homeRows = fs.readFileSync(home.memoryPath, "utf8")
    assert.ok(homeRows.includes("Migrated to project-local storage."))
    assert.equal(storage.listMemories().find((memory) => memory.id === "legacy")?.text, "Legacy project memory")
    assert.equal(storage.legacyProjectMemoryDiagnostics("scope-key").totalLegacyCandidateCount, 0)
  })

  it("reapplies migration plans idempotently and treats compacted home rows as complete", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacy = rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    const plan = storage.createLegacyProjectMigrationPlan("scope-key")

    storage.applyLegacyProjectMigrationPlan(plan)
    const firstRerun = storage.applyLegacyProjectMigrationPlan(plan)
    storage.compact()
    const compactedRerun = storage.applyLegacyProjectMigrationPlan(plan)

    assert.equal(firstRerun.completedBeforeRun, 1)
    assert.equal(firstRerun.blocked, 0)
    assert.equal(compactedRerun.completedBeforeRun, 1)
    assert.equal(compactedRerun.blocked, 0)
    assert.equal(fs.readFileSync(home.memoryPath, "utf8"), "")
  })

  it("blocks stale completed candidates before mutating other migration items", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const stale = rec({ id: "stale", text: "Stale project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    const pending = rec({ id: "pending", text: "Pending project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-04T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemories([stale, pending])
    const plan = storage.createLegacyProjectMigrationPlan("scope-key")
    const staleItem = plan.candidates.find((item) => item.id === "stale")!
    createSingleStoreEngineStorage(project.memoryPath, project.embeddingsPath).appendMemory(staleItem.destinationRecord)
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemories([
      staleItem.sourceTombstone,
      { ...stale, text: "Changed after migration", updatedAt: "2099-01-01T00:00:00.000Z" },
    ])

    const result = storage.applyLegacyProjectMigrationPlan(plan)

    assert.equal(result.migrated, 0)
    assert.equal(result.blocked, 1)
    assert.equal(result.items.find((item) => item.id === "stale")?.state, "conflict")
    assert.ok(result.items.find((item) => item.id === "stale")?.blockers.includes("source-fingerprint-mismatch"))
    assert.equal(fs.readFileSync(project.memoryPath, "utf8").includes('"id":"pending"'), false)
    assert.equal(fs.readFileSync(home.memoryPath, "utf8").includes('"id":"pending","status":"deleted"'), false)
  })

  it("repairs destination-written partial migrations by appending the source tombstone", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacy = rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    const plan = storage.createLegacyProjectMigrationPlan("scope-key")
    createSingleStoreEngineStorage(project.memoryPath, project.embeddingsPath).appendMemory(plan.candidates[0].destinationRecord)

    const repaired = storage.applyLegacyProjectMigrationPlan(plan)

    assert.equal(repaired.repaired, 1)
    assert.equal(repaired.blocked, 0)
    assert.ok(fs.readFileSync(home.memoryPath, "utf8").includes("Migrated to project-local storage."))
  })

  it("blocks destination-written repairs when the home source changed", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacy = rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    const plan = storage.createLegacyProjectMigrationPlan("scope-key")
    createSingleStoreEngineStorage(project.memoryPath, project.embeddingsPath).appendMemory(plan.candidates[0].destinationRecord)
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory({ ...legacy, text: "Changed", updatedAt: "2026-01-04T00:00:00.000Z" })

    const repaired = storage.applyLegacyProjectMigrationPlan(plan)

    assert.equal(repaired.repaired, 0)
    assert.equal(repaired.blocked, 1)
    assert.equal(repaired.items[0].state, "conflict")
    assert.ok(repaired.items[0].blockers.includes("source-fingerprint-mismatch"))
    assert.equal(fs.readFileSync(home.memoryPath, "utf8").includes("Migrated to project-local storage."), false)
  })

  it("blocks unplanned same-text project-side duplicates before applying migration", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacy = rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    const plan = storage.createLegacyProjectMigrationPlan("scope-key")
    createSingleStoreEngineStorage(project.memoryPath, project.embeddingsPath).appendMemory(rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-02T00:00:00.000Z" }))

    const result = storage.applyLegacyProjectMigrationPlan(plan)

    assert.equal(result.blocked, 1)
    assert.ok(result.items[0].blockers.includes("mixed-origin-revision-chain"))
    assert.equal(fs.readFileSync(home.memoryPath, "utf8").includes("Migrated to project-local storage."), false)
  })

  it("blocks divergent project-side duplicates before applying migration", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacy = rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    const plan = storage.createLegacyProjectMigrationPlan("scope-key")
    createSingleStoreEngineStorage(project.memoryPath, project.embeddingsPath).appendMemory(rec({ id: "legacy", text: "Divergent project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-02T00:00:00.000Z" }))

    const result = storage.applyLegacyProjectMigrationPlan(plan)

    assert.equal(result.blocked, 1)
    assert.ok(result.items[0].blockers.includes("duplicate-active-project-record"))
    assert.equal(fs.readFileSync(home.memoryPath, "utf8").includes("Migrated to project-local storage."), false)
  })

  it("validates hand-edited migration plans before mutating files", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacy = rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    const plan = storage.createLegacyProjectMigrationPlan("scope-key")
    plan.candidates[0].destinationRecord.text = "Tampered text"

    const result = storage.applyLegacyProjectMigrationPlan(plan)

    assert.notEqual(result.blocked, 0)
    assert.equal(fs.existsSync(project.memoryPath), false)
    assert.equal(fs.readFileSync(home.memoryPath, "utf8").includes("Migrated to project-local storage."), false)
  })

  it("validates malformed migration plan shape before mutating files", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacy = rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    const plan = storage.createLegacyProjectMigrationPlan("scope-key")
    const malformed = { ...plan, candidates: undefined }

    const result = storage.applyLegacyProjectMigrationPlan(malformed as never)

    assert.notEqual(result.blocked, 0)
    assert.ok(result.items[0].blockers.includes("invalid-plan-candidates"))
    assert.equal(fs.existsSync(project.memoryPath), false)
    assert.equal(fs.readFileSync(home.memoryPath, "utf8").includes("Migrated to project-local storage."), false)
  })

  it("validates missing and blank migration producer versions before mutating files", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacy = rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    const plan = storage.createLegacyProjectMigrationPlan("scope-key")

    for (const producerVersion of [undefined, ""] as const) {
      const invalidPlan = { ...plan, producerVersion } as never
      const result = storage.applyLegacyProjectMigrationPlan(invalidPlan)

      assert.notEqual(result.blocked, 0)
      assert.ok(result.items[0].blockers.includes("invalid-producer-version"))
      assert.equal(fs.existsSync(project.memoryPath), false)
      assert.equal(fs.readFileSync(home.memoryPath, "utf8").includes("Migrated to project-local storage."), false)
    }
  })

  it("validates malformed migration plan item arrays before mutating files", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacy = rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    const plan = storage.createLegacyProjectMigrationPlan("scope-key")
    const malformed = { ...plan, candidates: [{ ...plan.candidates[0], blockers: undefined }] }

    const result = storage.applyLegacyProjectMigrationPlan(malformed as never)

    assert.notEqual(result.blocked, 0)
    assert.ok(result.items[0].blockers.includes("invalid-plan-blockers:legacy"))
    assert.equal(fs.existsSync(project.memoryPath), false)
    assert.equal(fs.readFileSync(home.memoryPath, "utf8").includes("Migrated to project-local storage."), false)
  })

  it("validates migration tombstones are strictly after the source", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacy = rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    const plan = storage.createLegacyProjectMigrationPlan("scope-key")
    plan.candidates[0].sourceTombstone.updatedAt = legacy.updatedAt

    const result = storage.applyLegacyProjectMigrationPlan(plan)

    assert.notEqual(result.blocked, 0)
    assert.ok(result.items[0].blockers.includes("invalid-migration-timestamp-order:legacy"))
    assert.equal(fs.existsSync(project.memoryPath), false)
    assert.equal(fs.readFileSync(home.memoryPath, "utf8").includes("Migrated to project-local storage."), false)
  })

  it("validates copy-compatible migration embedding records", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacy = rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendEmbedding({
      memoryId: "legacy",
      memoryUpdatedAt: legacy.updatedAt,
      contentHash: contentHash(legacy.text),
      profileName: "default",
      model: "test-model",
      dimensions: 1,
      vector: [1],
      createdAt: legacy.updatedAt,
    })
    const plan = storage.createLegacyProjectMigrationPlan("scope-key")
    plan.candidates[0].embeddingRecord = { ...plan.candidates[0].embeddingRecord!, memoryId: "other", contentHash: "wrong", memoryUpdatedAt: legacy.updatedAt, dimensions: 2, vector: [1] }

    const result = storage.applyLegacyProjectMigrationPlan(plan)

    assert.notEqual(result.blocked, 0)
    assert.ok(result.items[0].blockers.includes("embedding-memory-id-mismatch:legacy"))
    assert.ok(result.items[0].blockers.includes("embedding-content-hash-mismatch:legacy"))
    assert.ok(result.items[0].blockers.includes("embedding-memory-updated-at-mismatch:legacy"))
    assert.ok(result.items[0].blockers.includes("invalid-embedding-vector:legacy"))
    assert.equal(fs.existsSync(project.embeddingsPath), false)
  })

  it("blocks apply when source fingerprint changed before migration", () => {
    const dir = tempDir()
    const home = homePathsFor(path.join(dir, "home", ".memory-lane"))
    const project = projectLocalPaths(path.join(dir, "project"))
    const storage = createTwoTierEngineStorage(home, project, "scope-key")
    const legacy = rec({ id: "legacy", text: "Legacy project memory", scope: { type: "project", key: "scope-key" }, updatedAt: "2026-01-03T00:00:00.000Z" })
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory(legacy)
    const plan = storage.createLegacyProjectMigrationPlan("scope-key")
    createSingleStoreEngineStorage(home.memoryPath, home.embeddingsPath).appendMemory({ ...legacy, text: "Changed", updatedAt: "2026-01-04T00:00:00.000Z" })

    const result = storage.applyLegacyProjectMigrationPlan(plan)

    assert.equal(result.blocked, 1)
    assert.equal(result.items[0].state, "conflict")
    assert.ok(result.items[0].blockers.includes("source-fingerprint-mismatch"))
    assert.equal(fs.existsSync(project.memoryPath), false)
  })

  it("reports single-store legacy diagnostics as not applicable", () => {
    const dir = tempDir()
    const storage = createSingleStoreEngineStorage(path.join(dir, "memory.jsonl"), path.join(dir, "embeddings.jsonl"))

    const report = storage.legacyProjectMemoryDiagnostics("scope-key")

    assert.equal(report.status, "not-applicable")
    assert.equal(report.notApplicableReason, "single-store")
    assert.equal(report.totalLegacyCandidateCount, 0)
  })
})
