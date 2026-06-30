import { compact as compactStores, shouldCompact } from "./compact.js"
import { defaultContinuityBaselinePath } from "./continuity-baseline.js"
import { createEmbeddingStore, type EmbeddingLine } from "./embedding-store.js"
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

/** Create the backward-compatible single JSONL store facade for MemoryEngine. */
export function createSingleStoreEngineStorage(memoryPath: string, embeddingsPath: string): MemoryEngineStorage {
  let memoryStore: MemoryStore = createMemoryStore(memoryPath)

  function refreshMemoryStore(): void {
    memoryStore = createMemoryStore(memoryPath)
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
      createEmbeddingStore(embeddingsPath).append(record)
    },
    listEmbeddings() {
      return createEmbeddingStore(embeddingsPath).listEmbeddings()
    },
    listEmbeddingInvalidations() {
      return createEmbeddingStore(embeddingsPath).listInvalidations()
    },
    shouldCompact() {
      return shouldCompact(memoryPath)
    },
    compact() {
      const report = compactStores(memoryPath, embeddingsPath)
      refreshMemoryStore()
      return report
    },
  }
}
