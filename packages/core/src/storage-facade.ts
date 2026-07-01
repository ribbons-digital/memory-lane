import * as fs from "node:fs"
import { compact as compactStores, shouldCompact } from "./compact.js"
import { defaultContinuityBaselinePath } from "./continuity-baseline.js"
import { createEmbeddingStore, type EmbeddingLine, type EmbeddingStore } from "./embedding-store.js"
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

function compareUpdatedAt(a: MemoryRecord, b: MemoryRecord): number {
  const updated = a.updatedAt.localeCompare(b.updatedAt)
  if (updated !== 0) return updated
  const created = a.createdAt.localeCompare(b.createdAt)
  if (created !== 0) return created
  return a.id.localeCompare(b.id)
}

function foldMergedMemoryRecords(records: MemoryRecord[]): MemoryRecord[] {
  const latest = new Map<string, MemoryRecord>()
  for (const record of records) {
    const existing = latest.get(record.id)
    if (!existing || compareUpdatedAt(existing, record) <= 0) latest.set(record.id, record)
  }
  return Array.from(latest.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
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
    let owner: { entry: StoreEntry; record: MemoryRecord } | undefined
    for (const entry of entries) {
      for (const record of readLog(entry).filter((candidate) => candidate.id === memoryId)) {
        if (!owner || compareUpdatedAt(owner.record, record) <= 0) owner = { entry, record }
      }
    }
    return owner?.entry
  }

  function routeForNew(record: MemoryRecord): StoreEntry {
    return project && record.scope.type === "project" && Boolean(record.scope.key) ? project : home
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

  function routeForEmbedding(record: EmbeddingLine): StoreEntry {
    return ownerEntry(record.memoryId) ?? home
  }

  function existingEntries(): StoreEntry[] {
    return entries.filter((entry) => existingFile(entry.paths.memoryPath) || existingFile(entry.paths.embeddingsPath))
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
      return foldMergedMemoryRecords(allMemoryLogs())
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
      let report: CompactReport = { removedMemories: 0, removedEmbeddings: 0, removedInvalidations: 0 }
      for (const entry of existingEntries()) {
        report = addReports(report, compactStores(entry.paths.memoryPath, entry.paths.embeddingsPath))
        refresh(entry)
      }
      return report
    },
  }
}
