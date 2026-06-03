export type MemoryStatus = "pending" | "approved" | "rejected" | "deleted"
export type MemoryCategory = "preference" | "personal" | "project"
export type MemoryScopeType = "global" | "project"
export type MemorySource = "manual" | "user-suggested" | "agent-suggested"

export type MemoryLifecycleEvent =
  | "user_prompt"
  | "turn_stop"
  | "post_tool_use"
  | "session_start"
  | "pre_compact"

export interface MemoryProvenance {
  adapter: string
  lifecycleEvent: MemoryLifecycleEvent
  sessionId?: string
  turnId?: string
  toolName?: string
}

export type MemoryKind =
  | "preference"
  | "personal_context"
  | "project_fact"
  | "project_checkpoint"
  | "workflow_rule"
  | "decision"
  | "misc"

export interface MemoryScope {
  type: MemoryScopeType
  key?: string
}

export interface ProjectInfo {
  cwd: string
  root?: string
  key?: string
}

export interface MemoryRecord {
  id: string
  status: MemoryStatus
  text: string
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  project?: ProjectInfo
  kind?: MemoryKind
  provenance?: MemoryProvenance
}

export interface ProjectScope {
  cwd: string
  root: string
  key: string
}

export interface SaveInput {
  text: string
  category?: MemoryCategory
  scopeType?: MemoryScopeType
  source?: MemorySource
  status?: MemoryStatus
  kind?: MemoryKind
  provenance?: MemoryProvenance
}

export type SaveResult =
  | { status: "saved"; memory: MemoryRecord; warnings?: string[] }
  | { status: "skipped"; reason: "empty" | "secret" | "duplicate"; warnings?: string[] }

export type MemoryMutationResult = MemoryRecord & { warnings?: string[] }

export interface RecallOptions {
  topK?: number
  projectScope?: ProjectScope
}

export interface RecallResult {
  memories: MemoryRecord[]
  semantic: { enabled: boolean; used: boolean; fallbackReason?: string }
  notice?: string
}

export interface EmbeddingRecord {
  memoryId: string
  memoryUpdatedAt: string
  contentHash: string
  profileName: string
  model: string
  dimensions: number
  vector: number[]
  createdAt: string
}

export interface EmbeddingInvalidationRecord {
  type: "invalidation"
  memoryId: string
  invalidatedAt: string
  reason: "updated" | "deleted" | "stale"
}

export interface EmbeddingProvider {
  embed(inputs: string[], signal?: AbortSignal): Promise<number[][]>
}

export interface EmbeddingProfileConfig {
  provider: "openai-compatible-embeddings"
  baseUrl: string
  model: string
  apiKeyEnv?: string | null
  batchSize?: number
  timeoutMs?: number
}

export interface ObsidianMirrorConfig {
  enabled: boolean
  vaultPath?: string
  folder?: string
  mode?: "mirror"
}

export interface SemanticMemoryConfig {
  semantic: {
    enabled: boolean
    activeEmbeddingProfile: string
    embeddings: { profiles: Record<string, EmbeddingProfileConfig> }
    retrieval: {
      topK: number
      minSimilarity: number
      semanticWeight: number
      lexicalWeight: number
      recencyWeight: number
      fallbackToAllVisibleOnMiss: boolean
    }
    privacy: { allowRemoteEmbeddings: boolean }
  }
  obsidian?: ObsidianMirrorConfig
}

export interface MemoryEngineConfig {
  memoryPath?: string
  embeddingsPath?: string
  configPath?: string
  embeddingProvider?: EmbeddingProvider
}

export interface CompactReport {
  removedMemories: number
  removedEmbeddings: number
  removedInvalidations: number
}
