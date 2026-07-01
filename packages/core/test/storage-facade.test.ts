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
})
