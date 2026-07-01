import { createHash, randomBytes } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { compact as compactStores, shouldCompact } from "./compact.js"
import { defaultContinuityBaselinePath } from "./continuity-baseline.js"
import { createEmbeddingStore, foldEmbeddings, type EmbeddingLine, type EmbeddingStore } from "./embedding-store.js"
import { ensureProjectLocalStorageFiles, type MemoryPaths } from "./storage-locations.js"
import { createMemoryStore, type MemoryStore, type MemoryStoreDiagnostics } from "./storage.js"
import type { CompactReport, EmbeddingInvalidationRecord, EmbeddingRecord, MemoryRecord } from "./types.js"

/**
 * Storage facade used by MemoryEngine.
 * The single-store implementation preserves legacy JSONL paths, while future implementations can merge multiple stores and route writes by memory origin or scope.
 */
export interface MemoryEngineStorage {
  /** Primary memory JSONL path reported by diagnostics for the active facade. */
  readonly memoryFile: string
  /** Primary embedding JSONL path reported by diagnostics for the active facade. */
  readonly embeddingFile: string
  /** Path for continuity baseline markers associated with this storage facade. */
  readonly continuityBaselinePath: string
  appendMemory(record: MemoryRecord): void
  /** Append records atomically per underlying store and refresh memory caches. */
  appendMemories(records: MemoryRecord[]): void
  readMemoryLog(): MemoryRecord[]
  listMemories(): MemoryRecord[]
  memoryDiagnostics(): MemoryStoreDiagnostics
  appendEmbedding(record: EmbeddingLine): void
  listEmbeddings(): EmbeddingRecord[]
  listEmbeddingInvalidations(): EmbeddingInvalidationRecord[]
  shouldCompact(): boolean
  compact(): CompactReport
}

interface StoreEntry {
  name: "home" | "project"
  paths: MemoryPaths
  scopeKey?: string
  memoryStore?: MemoryStore
  embeddingStore?: EmbeddingStore
}

interface LocatedMemoryRecord {
  entry: StoreEntry
  record: MemoryRecord
  logIndex: number
}

interface LocatedEmbeddingRecord {
  entry: StoreEntry
  record: EmbeddingRecord
}

function storePrecedence(entry: StoreEntry): number {
  return entry.name === "project" ? 1 : 0
}

function compareLocatedMemory(a: LocatedMemoryRecord, b: LocatedMemoryRecord): number {
  const updated = a.record.updatedAt.localeCompare(b.record.updatedAt)
  if (updated !== 0) return updated
  const created = a.record.createdAt.localeCompare(b.record.createdAt)
  if (created !== 0) return created
  if (a.entry === b.entry) {
    const log = a.logIndex - b.logIndex
    if (log !== 0) return log
  }
  const store = storePrecedence(a.entry) - storePrecedence(b.entry)
  if (store !== 0) return store
  return a.record.id.localeCompare(b.record.id)
}

function foldMergedMemoryRecords(records: LocatedMemoryRecord[]): MemoryRecord[] {
  const latest = new Map<string, LocatedMemoryRecord>()
  for (const record of records) {
    const existing = latest.get(record.record.id)
    if (!existing || compareLocatedMemory(existing, record) < 0) latest.set(record.record.id, record)
  }
  return Array.from(latest.values()).map((entry) => entry.record).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function emptyDiagnostics(): MemoryStoreDiagnostics {
  return { totalRows: 0, validRows: 0, skippedRows: 0, malformedRows: 0, invalidRows: 0 }
}

function addDiagnostics(a: MemoryStoreDiagnostics, b: MemoryStoreDiagnostics): MemoryStoreDiagnostics {
  return {
    totalRows: a.totalRows + b.totalRows,
    validRows: a.validRows + b.validRows,
    skippedRows: a.skippedRows + b.skippedRows,
    malformedRows: a.malformedRows + b.malformedRows,
    invalidRows: a.invalidRows + b.invalidRows,
  }
}

function addReports(a: CompactReport, b: CompactReport): CompactReport {
  return {
    removedMemories: a.removedMemories + b.removedMemories,
    removedEmbeddings: a.removedEmbeddings + b.removedEmbeddings,
    removedInvalidations: a.removedInvalidations + b.removedInvalidations,
  }
}

function existingFile(path: string): boolean {
  try { return fs.existsSync(path) } catch { return false }
}

function writeJsonl(pathname: string, records: unknown[]): void {
  fs.mkdirSync(path.dirname(pathname), { recursive: true })
  const tmp = pathname + ".tmp." + randomBytes(4).toString("hex")
  fs.writeFileSync(tmp, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""), "utf8")
  fs.renameSync(tmp, pathname)
}

function embeddingKey(record: EmbeddingRecord): string {
  return [record.memoryId, record.contentHash, record.profileName, record.model].join("\0")
}

function createStoreEntry(name: StoreEntry["name"], paths: MemoryPaths, opts?: { scopeKey?: string }): StoreEntry {
  return { name, paths, scopeKey: opts?.scopeKey }
}

function memoryStore(entry: StoreEntry, forWrite = false): MemoryStore | undefined {
  if (!forWrite && !entry.memoryStore && !existingFile(entry.paths.memoryPath)) return undefined
  if (forWrite && entry.name === "project") ensureProjectLocalStorageFiles(entry.paths.root, entry.scopeKey)
  entry.memoryStore ??= createMemoryStore(entry.paths.memoryPath)
  return entry.memoryStore
}

function embeddingStore(entry: StoreEntry, forWrite = false): EmbeddingStore | undefined {
  if (!forWrite && !entry.embeddingStore && !existingFile(entry.paths.embeddingsPath)) return undefined
  if (forWrite && entry.name === "project") ensureProjectLocalStorageFiles(entry.paths.root, entry.scopeKey)
  entry.embeddingStore ??= createEmbeddingStore(entry.paths.embeddingsPath)
  return entry.embeddingStore
}

function refresh(entry: StoreEntry): void {
  entry.memoryStore = undefined
  entry.embeddingStore = undefined
}

/** Create the backward-compatible single JSONL store facade for MemoryEngine. */
export function createSingleStoreEngineStorage(memoryPath: string, embeddingsPath: string): MemoryEngineStorage {
  let memoryStore: MemoryStore = createMemoryStore(memoryPath)
  let embeddingStore: EmbeddingStore = createEmbeddingStore(embeddingsPath)

  function refreshMemoryStore(): void {
    memoryStore = createMemoryStore(memoryPath)
  }

  function refreshEmbeddingStore(): void {
    embeddingStore = createEmbeddingStore(embeddingsPath)
  }

  return {
    memoryFile: memoryPath,
    embeddingFile: embeddingsPath,
    continuityBaselinePath: defaultContinuityBaselinePath(memoryPath),
    appendMemory(record) {
      memoryStore.append(record)
    },
    appendMemories(records) {
      memoryStore.appendMany(records)
    },
    readMemoryLog() {
      return memoryStore.readLog()
    },
    listMemories() {
      return memoryStore.list()
    },
    memoryDiagnostics() {
      return memoryStore.diagnostics()
    },
    appendEmbedding(record) {
      embeddingStore.append(record)
    },
    listEmbeddings() {
      return embeddingStore.listEmbeddings()
    },
    listEmbeddingInvalidations() {
      return embeddingStore.listInvalidations()
    },
    shouldCompact() {
      return shouldCompact(memoryPath)
    },
    compact() {
      const report = compactStores(memoryPath, embeddingsPath)
      refreshMemoryStore()
      refreshEmbeddingStore()
      return report
    },
  }
}

export function createTwoTierEngineStorage(homePaths: MemoryPaths, projectPaths?: MemoryPaths, projectScopeKey?: string): MemoryEngineStorage {
  const home = createStoreEntry("home", homePaths)
  const project = projectPaths ? createStoreEntry("project", projectPaths, { scopeKey: projectScopeKey }) : undefined
  const entries = project ? [home, project] : [home]

  function readLog(entry: StoreEntry): MemoryRecord[] {
    return memoryStore(entry)?.readLog() ?? []
  }

  function ownerEntry(memoryId: string): StoreEntry | undefined {
    // JSONL stores are small today; if multi-store batches become large, cache this owner index per appendMany call.
    let owner: LocatedMemoryRecord | undefined
    for (const entry of entries) {
      readLog(entry).forEach((record, logIndex) => {
        if (record.id !== memoryId) return
        const candidate = { entry, record, logIndex }
        if (!owner || compareLocatedMemory(owner, candidate) < 0) owner = candidate
      })
    }
    return owner?.entry
  }

  function routeForNew(record: MemoryRecord): StoreEntry {
    return project && record.scope.type === "project" && record.scope.key === project.scopeKey ? project : home
  }

  function routeForRecord(record: MemoryRecord): StoreEntry {
    return ownerEntry(record.id) ?? routeForNew(record)
  }

  function appendTo(entry: StoreEntry, records: MemoryRecord[]): void {
    if (!records.length) return
    memoryStore(entry, true)!.appendMany(records)
  }

  function allMemoryLogs(): MemoryRecord[] {
    return entries.flatMap((entry) => readLog(entry))
  }

  function allLocatedMemoryLogs(): LocatedMemoryRecord[] {
    return entries.flatMap((entry) => readLog(entry).map((record, logIndex) => ({ entry, record, logIndex })))
  }

  function routeForEmbedding(record: EmbeddingLine): StoreEntry {
    return ownerEntry(record.memoryId) ?? home
  }

  function existingEntries(): StoreEntry[] {
    return entries.filter((entry) => existingFile(entry.paths.memoryPath) || existingFile(entry.paths.embeddingsPath))
  }

  function compactMemoryLogs(compactedEntries: StoreEntry[]): { report: CompactReport; aliveById: Map<string, LocatedMemoryRecord> } {
    const latest = new Map<string, LocatedMemoryRecord>()
    for (const located of allLocatedMemoryLogs()) {
      const existing = latest.get(located.record.id)
      if (!existing || compareLocatedMemory(existing, located) < 0) latest.set(located.record.id, located)
    }

    const aliveById = new Map<string, LocatedMemoryRecord>()
    for (const [id, located] of latest) {
      if (located.record.status !== "deleted" && located.record.status !== "rejected") aliveById.set(id, located)
    }

    const grouped = new Map<StoreEntry, MemoryRecord[]>()
    for (const located of Array.from(aliveById.values()).sort((a, b) => a.record.createdAt.localeCompare(b.record.createdAt))) {
      grouped.set(located.entry, [...(grouped.get(located.entry) ?? []), located.record])
    }
    for (const entry of compactedEntries) {
      const group = grouped.get(entry) ?? []
      if (existingFile(entry.paths.memoryPath) || group.length) writeJsonl(entry.paths.memoryPath, group)
    }

    return {
      report: { removedMemories: latest.size - aliveById.size, removedEmbeddings: 0, removedInvalidations: 0 },
      aliveById,
    }
  }

  function compactEmbeddingLogs(compactedEntries: StoreEntry[], aliveById: Map<string, LocatedMemoryRecord>): CompactReport {
    const aliveHashes = new Map<string, string>()
    for (const [id, located] of aliveById) aliveHashes.set(id, createHash("sha256").update(located.record.text, "utf8").digest("hex"))

    const latest = new Map<string, LocatedEmbeddingRecord>()
    let invalidationCount = 0
    let totalBefore = 0
    for (const entry of compactedEntries) {
      for (const line of embeddingStore(entry)?.readLog() ?? []) {
        totalBefore += 1
        if ((line as EmbeddingInvalidationRecord).type === "invalidation") {
          invalidationCount += 1
          continue
        }
        const record = line as EmbeddingRecord
        if (!Array.isArray(record.vector)) continue
        const key = embeddingKey(record)
        const existing = latest.get(key)
        if (!existing || existing.record.createdAt <= record.createdAt) latest.set(key, { entry, record })
      }
    }

    const validByEntry = new Map<StoreEntry, EmbeddingRecord[]>()
    const validEmbeddings = foldEmbeddings(Array.from(latest.values()).map((located) => located.record)).filter((record) => {
      const owner = aliveById.get(record.memoryId)
      return Boolean(owner) && aliveHashes.get(record.memoryId) === record.contentHash
    })
    for (const record of validEmbeddings) {
      const entry = aliveById.get(record.memoryId)!.entry
      validByEntry.set(entry, [...(validByEntry.get(entry) ?? []), record])
    }
    for (const entry of compactedEntries) {
      const group = validByEntry.get(entry) ?? []
      if (existingFile(entry.paths.embeddingsPath) || group.length) writeJsonl(entry.paths.embeddingsPath, group)
    }

    return {
      removedMemories: 0,
      removedEmbeddings: totalBefore - validEmbeddings.length,
      removedInvalidations: invalidationCount,
    }
  }

  return {
    memoryFile: homePaths.memoryPath,
    embeddingFile: homePaths.embeddingsPath,
    continuityBaselinePath: defaultContinuityBaselinePath(homePaths.memoryPath),
    appendMemory(record) {
      appendTo(routeForRecord(record), [record])
    },
    appendMemories(records) {
      const grouped = new Map<StoreEntry, MemoryRecord[]>()
      for (const record of records) {
        const entry = routeForRecord(record)
        grouped.set(entry, [...(grouped.get(entry) ?? []), record])
      }
      for (const [entry, group] of grouped) appendTo(entry, group)
    },
    readMemoryLog() {
      return allMemoryLogs()
    },
    listMemories() {
      return foldMergedMemoryRecords(allLocatedMemoryLogs())
    },
    memoryDiagnostics() {
      return entries.reduce((sum, entry) => addDiagnostics(sum, memoryStore(entry)?.diagnostics() ?? emptyDiagnostics()), emptyDiagnostics())
    },
    appendEmbedding(record) {
      embeddingStore(routeForEmbedding(record), true)!.append(record)
    },
    listEmbeddings() {
      return entries.flatMap((entry) => embeddingStore(entry)?.listEmbeddings() ?? [])
    },
    listEmbeddingInvalidations() {
      return entries.flatMap((entry) => embeddingStore(entry)?.listInvalidations() ?? [])
    },
    shouldCompact() {
      return existingEntries().some((entry) => shouldCompact(entry.paths.memoryPath))
    },
    compact() {
      const compactedEntries = existingEntries()
      const memoryResult = compactMemoryLogs(compactedEntries)
      const report = addReports(memoryResult.report, compactEmbeddingLogs(compactedEntries, memoryResult.aliveById))
      for (const entry of compactedEntries) refresh(entry)
      return report
    },
  }
}
