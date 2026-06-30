import { compact as compactStores, shouldCompact } from "./compact.js"
import { defaultContinuityBaselinePath } from "./continuity-baseline.js"
import { createEmbeddingStore, type EmbeddingLine } from "./embedding-store.js"
import { createMemoryStore, type MemoryStore, type MemoryStoreDiagnostics } from "./storage.js"
import type { CompactReport, EmbeddingInvalidationRecord, EmbeddingRecord, MemoryRecord } from "./types.js"

export interface MemoryEngineStorage {
  readonly memoryFile: string
  readonly embeddingFile: string
  readonly continuityBaselinePath: string
  appendMemory(record: MemoryRecord): void
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
