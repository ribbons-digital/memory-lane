export * from "./types.js"
export { MemoryEngine } from "./engine.js"
export { createMemoryStore, createMemoryId, foldMemoryRecords } from "./storage.js"
export { containsLikelySecret } from "./secret-detection.js"
export { isMetaTaskPromptText } from "./meta-task-filter.js"
export {
  inferCategory, inferMemoryKind, effectiveMemoryKind,
  memoryMatchesContext, filterMemoriesForContext, searchMemories, findDuplicateMemory,
  isCheckpointRecallQuery, normalizeMemoryText,
  parseExplicitMemoryRequest, detectUserMemorySuggestion, isCheckpointMemorySaveRequest,
} from "./search.js"
export { resolveProjectScope } from "./project-scope.js"
export {
  loadConfig, DEFAULT_CONFIG, getDefaultConfigPath, isLocalBaseUrl, validateConfig,
  writeConfig, readRawConfig,
} from "./config.js"
export { createEmbeddingStore, foldEmbeddings } from "./embedding-store.js"
export { createOpenAIEmbeddingProvider } from "./embedding-provider.js"
export { cosineSimilarity, lexicalScore, recencyScore, findMatchingEmbedding } from "./scoring.js"
export { retrieveSemanticMemories } from "./retrieval.js"
export { compact, shouldCompact } from "./compact.js"
export {
  hookDebugEnabled, defaultHookDebugLogPath, appendHookDebugLog,
  type HookDebugLogRecord, type HookDebugLogStatus, type AppendHookDebugLogOptions,
} from "./hook-debug-log.js"
export * from "./integration-diagnostics.js"
export {
  resolveMemoryPaths, resolveWritableMemoryPaths, initProjectLocalStorage, assertWritableMemoryPath,
  type MemoryPaths, type InitProjectLocalStorageResult,
} from "./storage-locations.js"
