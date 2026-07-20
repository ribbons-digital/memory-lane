export * from "./types.js"
export { classifyCheckpointCandidate, type CheckpointCandidateKind, type CheckpointCandidateMetadata } from "./checkpoint-candidates.js"
export { buildFreshnessStatus, classifyFreshness } from "./freshness.js"
export { buildContinuityHints } from "./continuity-hints.js"
export { buildContinuityReadModel } from "./continuity-read-model.js"
export { buildContinuityWarningRenderPlan, continuityWarningInspectionActions, requiresContinuityWarningAction, type ContinuityWarningRenderPlan, type ContinuityWarningRenderPlanOptions } from "./continuity-warning-rendering.js"
export { discoverWorkstreams, type WorkstreamDiscoveryOptions } from "./workstream-discovery.js"
export { buildPreferenceDiagnostics, isPreferenceLikeMemory } from "./preference-diagnostics.js"
export { revisionNow, sameIdRevision, revisionLabel, hasRealUpdateChange } from "./revisions.js"
export {
  WORKFLOW_AREAS,
  classifyWorkflowArea,
  isWorkflowArea,
  selectOperatingAgreements,
  summarizeOperatingAgreements,
} from "./operating-agreements.js"
export { MemoryEngine } from "./engine.js"
export { createMemoryStore, createMemoryId, foldMemoryRecords } from "./storage.js"
export { createSingleStoreEngineStorage, createTwoTierEngineStorage, type MemoryEngineStorage } from "./storage-facade.js"
export { containsLikelySecret } from "./secret-detection.js"
export { memoryDescriptorPreview, structuredDescriptorText, hasSecretDescriptorMetadata, type DescriptorPreviewResult } from "./descriptor-preview.js"
export { isMetaTaskPromptText } from "./meta-task-filter.js"
export {
  analyzeSummaryHygiene,
  classifySummaryClaims,
  withReviewHygiene,
  type SummaryClaim,
  type SummaryClaimClassification,
  type SummaryHygieneAnalysis,
  type ReviewHygieneMetadata,
  type MemoryRecordWithReviewHygiene,
} from "./summary-hygiene.js"
export {
  analyzeReviewQuality,
  groupReviewMemories,
  qualitySignalCodes,
  reviewProjectScope,
  reviewProvenance,
  type ReviewGroup,
  type ReviewQualityContext,
  type ReviewQualitySignal,
  type ReviewQualitySignalCode,
  type ReviewQualitySuggestedAction,
} from "./review.js"
export {
  inferCategory, inferMemoryKind, effectiveMemoryKind,
  memoryMatchesContext, filterMemoriesForContext, searchMemories, findDuplicateMemory,
  isCheckpointRecallQuery, isCurrentnessRecallQuery, normalizeMemoryText,
  parseExplicitMemoryRequest, detectUserMemorySuggestion, isCheckpointMemorySaveRequest,
} from "./search.js"
export { resolveProjectScope } from "./project-scope.js"
export {
  loadConfig, DEFAULT_CONFIG, getDefaultConfigPath, isLocalBaseUrl, validateConfig,
  writeConfig, readRawConfig, deepMergeConfig,
} from "./config.js"
export { createEmbeddingStore, foldEmbeddings, type EmbeddingLine } from "./embedding-store.js"
export { createOpenAIEmbeddingProvider } from "./embedding-provider.js"
export { cosineSimilarity, lexicalScore, recencyScore, findMatchingEmbedding } from "./scoring.js"
export { retrieveSemanticMemories } from "./retrieval.js"
export { compact, shouldCompact } from "./compact.js"
export {
  hookDebugEnabled, defaultHookDebugLogPath, appendHookDebugLog, skippedSecretCount,
  type HookDebugLogRecord, type HookDebugLogStatus, type AppendHookDebugLogOptions,
} from "./hook-debug-log.js"
export * from "./integration-diagnostics.js"
export {
  resolveMemoryPaths, resolveWritableMemoryPaths, resolveEngineStoragePaths, resolveWritableEngineStoragePaths,
  initProjectLocalStorage, ensureProjectLocalStorageFiles, assertWritableMemoryPath,
  type MemoryPaths, type InitProjectLocalStorageResult, type EngineStoragePaths,
} from "./storage-locations.js"
