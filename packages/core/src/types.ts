import type { IntegrationDiagnosticPaths } from "./integration-diagnostics.js"

export type MemoryStatus = "pending" | "approved" | "rejected" | "deleted"
export type MemoryCategory = "preference" | "personal" | "project"
export type MemoryScopeType = "global" | "project"
export type MemorySource = "manual" | "user-suggested" | "agent-suggested" | "session-summary"

export type MemoryLifecycleEvent =
  | "user_prompt"
  | "turn_stop"
  | "post_tool_use"
  | "session_start"
  | "session_end"
  | "pre_compact"

export interface MemoryProvenance {
  adapter: string
  lifecycleEvent: MemoryLifecycleEvent
  sessionId?: string
  turnId?: string
  toolName?: string
}

export type MemoryRevisionActor = "manual" | "cli" | "mcp"

export interface MemoryRevision {
  supersedes?: string[]
  supersededBy?: string
  reason?: string
  revisedAt: string
  revisedBy: MemoryRevisionActor
}

export interface MemoryFreshness {
  expiresAt?: string
  staleAfterDays?: number
  capturedAt?: string
}

export type MemoryKind =
  | "preference"
  | "personal_context"
  | "project_fact"
  | "project_checkpoint"
  | "workflow_rule"
  | "decision"
  | "correction"
  | "procedure"
  | "session_summary"
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
  revision?: MemoryRevision
  freshness?: MemoryFreshness
}

export type FreshnessClassification = "none" | "current" | "stale" | "expired"

export interface FreshnessMemoryMetadata {
  id: string
  status: Extract<MemoryStatus, "approved">
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  kind?: MemoryKind
  provenance?: MemoryProvenance
  freshness?: {
    classification: FreshnessClassification
    expiresAt?: string
    staleAfterDays?: number
    capturedAt?: string
    staleAnchor?: string
    suggestedActions?: string[]
  }
}

export interface FreshnessStatus {
  projectScope: string | "none"
  referenceTime?: string
  advisory: {
    referenceNow: string
    withFreshnessCount: number
    currentCount: number
    staleCount: number
    expiredCount: number
    stale: FreshnessMemoryMetadata[]
    expired: FreshnessMemoryMetadata[]
  }
  visibleApprovedCount: number
  latestApproved?: FreshnessMemoryMetadata
  latestProjectApproved?: FreshnessMemoryMetadata
  latestGlobalApproved?: FreshnessMemoryMetadata
  newerApprovedCount: number
  newerProjectApprovedCount: number
  newerGlobalApprovedCount: number
  newerGlobalPreferenceCount: number
  newerByKind: Record<string, number>
  newerBySource: Record<string, number>
  newerByProvenance: Record<string, number>
  newestNewerApproved: FreshnessMemoryMetadata[]
  notice?: string
}

export interface FreshnessStatusOptions {
  projectScopeKey?: string
  since?: string
  referenceNow?: string
  maxNewerMetadata?: number
}

export type ContinuityHintCode =
  | "freshness-advisory"
  | "superseded-visible"
  | "operating-agreement-overlap"
  | "project-global-overlap"
  | "scope-hygiene-candidate"
  | "newer-approved"

export interface ContinuityHintMemoryMetadata {
  id: string
  status: Extract<MemoryStatus, "approved">
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  kind?: MemoryKind
  provenance?: MemoryProvenance
  supersededBy?: string
}

export type ScopeHygieneReason =
  | "project-category-global-scope"
  | "project-kind-global-scope"
  | "project-path-global-scope"

export interface ScopeHygieneCandidateMetadata {
  id: string
  status: Extract<MemoryStatus, "approved">
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  kind?: MemoryKind
  provenance?: MemoryProvenance
  reason: ScopeHygieneReason
}

export interface ContinuityHint {
  code: ContinuityHintCode
  severity: "info" | "review"
  message: string
  count: number
  memoryIds: string[]
  workflowArea?: WorkflowArea
  suggestedActions: string[]
}

export interface ContinuityHintSummary {
  projectScope: string | "none"
  hintCount: number
  hints: ContinuityHint[]
  supersededVisible: ContinuityHintMemoryMetadata[]
  scopeHygieneCandidates: ScopeHygieneCandidateMetadata[]
  operatingAgreementOverlaps: Array<{
    workflowArea: WorkflowArea
    primaryIds: string[]
    relatedIds: string[]
  }>
  projectGlobalPreferenceOverlaps: Array<{
    workflowArea: WorkflowArea
    projectIds: string[]
    globalIds: string[]
  }>
  newerApproved?: {
    referenceTime: string
    count: number
    newestIds: string[]
  }
  suggestedActions: string[]
  notes: string[]
}

export interface ContinuityHintOptions {
  projectScopeKey?: string
  since?: string
  maxIds?: number
}

export type ContinuityWarningCode =
  | "freshness-advisory"
  | "pending-continuity-newer-than-approved"
  | "no-project-scope"
  | "scope-hygiene-candidate"
  | "operating-agreement-overlap"
  | "mcp-explicit-tools-only"

export interface ContinuityMemoryPreview {
  id: string
  status: Extract<MemoryStatus, "approved" | "pending">
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  kind?: MemoryKind
  provenance?: MemoryProvenance
  preview: string
  checkpointCandidate?: import("./checkpoint-candidates.js").CheckpointCandidateMetadata
}

export interface ContinuityWarning {
  code: ContinuityWarningCode
  severity: "info" | "review" | "warning"
  message: string
  memoryIds?: string[]
}

export interface ContinuityHarnessGuidance {
  summary: string[]
  cli: string[]
  mcp: string[]
}

export interface HandoffProposalItem extends ContinuityMemoryPreview {}

export interface HandoffProposal {
  mode: "review"
  status: "pending-review"
  projectScope: string | "none"
  pendingCount: number
  items: HandoffProposalItem[]
  omittedCount: number
  suggestedActions: string[]
  notes: string[]
}

export type WorkstreamDiscoveryIntent = "resume" | "lookup" | "status" | "unknown"

export interface WorkstreamReferences {
  pullRequests: string[]
  branches: string[]
  commits: string[]
  releases: string[]
}

export interface WorkstreamCandidate {
  id: string
  status: Extract<MemoryStatus, "approved">
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  kind?: MemoryKind
  provenance?: MemoryProvenance
  revision?: MemoryRevision
  preview: string
  score: number
  matchReasons: string[]
  references: WorkstreamReferences
}

export interface WorkstreamDiscoveryWarning {
  code: "no-project-scope" | "no-topic" | "no-matches"
  severity: "info" | "warning"
  message: string
}

export interface WorkstreamDiscoveryResult {
  projectScope: string | "none"
  query: string
  intent: WorkstreamDiscoveryIntent
  topicTerms: string[]
  candidates: WorkstreamCandidate[]
  omittedCount: number
  warnings: WorkstreamDiscoveryWarning[]
  suggestedActions: string[]
  notes: string[]
}

export interface ContinuityReadModel {
  projectScope: string | "none"
  generatedAt: string
  status: {
    visibleApprovedCount: number
    pendingReviewCount: number
    pendingContinuityCount: number
  }
  latestApproved: {
    project?: ContinuityMemoryPreview
    global?: ContinuityMemoryPreview
  }
  pendingContinuity: ContinuityMemoryPreview[]
  handoffProposal?: HandoffProposal
  workstreamDiscovery?: WorkstreamDiscoveryResult
  freshness: FreshnessStatus
  continuityHints: ContinuityHintSummary
  operatingAgreements: OperatingAgreementSummary
  warnings: ContinuityWarning[]
  suggestedActions: string[]
  answerGuidance: string[]
  harnessGuidance: ContinuityHarnessGuidance
  notes: string[]
}

export interface ContinuityReadModelOptions {
  projectScopeKey?: string
  previewMaxChars?: number
  maxPendingContinuity?: number
  generatedAt?: string
  caller?: "cli" | "mcp" | "lifecycle" | "core"
  handoffMode?: HandoffMode
  query?: string
}

export type WorkflowArea =
  | "project-loop"
  | "review-gate"
  | "pr-process"
  | "release-process"
  | "tooling-preference"
  | "other"

export type OperatingAgreementMatchReason = "explicit-kind" | "heuristic"

export interface OperatingAgreementSelection {
  memory: MemoryRecord
  workflowArea: WorkflowArea
  matchReason: OperatingAgreementMatchReason
  recommendedKind?: "workflow_rule"
}

export interface OperatingAgreementMetadata {
  id: string
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  kind?: MemoryKind
  provenance?: MemoryProvenance
  workflowArea: WorkflowArea
  matchReason: OperatingAgreementMatchReason
  recommendedKind?: "workflow_rule"
}

export interface OperatingAgreementList {
  projectScope: string | "none"
  workflowAreas: WorkflowArea[]
  primary: OperatingAgreementSelection[]
  relatedCandidates: OperatingAgreementSelection[]
  omittedPrimaryCount: number
  omittedRelatedCandidateCount: number
  notes: string[]
}

export interface OperatingAgreementSummary {
  projectScope: string | "none"
  primaryCount: number
  relatedCandidateCount: number
  omittedPrimaryCount: number
  omittedRelatedCandidateCount: number
  workflowAreas: WorkflowArea[]
  primary: OperatingAgreementMetadata[]
  relatedCandidates: OperatingAgreementMetadata[]
  notes: string[]
}

export interface OperatingAgreementOptions {
  projectScopeKey?: string
  all?: boolean
  area?: WorkflowArea
  limit?: number
  relatedLimit?: number
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
  revision?: MemoryRevision
  freshness?: MemoryFreshness
}

export interface UpdateInput {
  text?: string
  category?: MemoryCategory
  status?: Extract<MemoryStatus, "pending" | "approved">
  kind?: MemoryKind
  reason?: string
  revisedBy?: MemoryRevisionActor
}

export type SaveResult =
  | { status: "saved"; memory: MemoryRecord; warnings?: string[] }
  | { status: "skipped"; reason: "empty" | "secret" | "duplicate" | "meta task prompt"; warnings?: string[] }

export type MemoryMutationResult = MemoryRecord & { warnings?: string[] }

export interface RevisionWarning {
  code: "cross-scope" | "cross-category"
  message: string
  memoryId?: string
}

export interface UpdatePreview {
  dryRun: true
  current: MemoryRecord
  proposed: MemoryRecord
  warnings: string[]
}

export interface RescopeInput {
  scopeType: MemoryScopeType
  projectPath?: string
  dryRun?: boolean
}

export interface RescopeResult {
  dryRun: boolean
  current: MemoryRecord
  proposed: MemoryRecord
  warnings: string[]
  mirrorWarnings?: string[]
}

export interface SupersedeResult {
  dryRun: boolean
  successor: MemoryRecord
  superseded: MemoryRecord[]
  warnings: RevisionWarning[]
  mirrorWarnings?: string[]
}

export interface ReplaceResult extends SupersedeResult {
  successorCreated: boolean
}

export interface RecallOptions {
  topK?: number
  projectScope?: ProjectScope
}

export interface RecallResult {
  memories: MemoryRecord[]
  semantic: { enabled: boolean; used: boolean; fallbackReason?: string }
  notice?: string
}

export interface PreferenceSessionStartDiagnostics {
  maxPreferenceItems: number
  maxPreferenceChars: number
  selectedPreferenceCount: number
  omittedPreferenceCount: number
  selectedCurrentProjectPreferenceCount: number
  selectedGlobalPreferenceCount: number
}

export interface PreferenceDiagnostics {
  projectScope: string | "none"
  visiblePreferenceCount: number
  currentProjectPreferenceCount: number
  globalPreferenceCount: number
  workflowRulePreferenceCount: number
  sessionStart: PreferenceSessionStartDiagnostics
  notes: string[]
}

export type ContinuityBaselineSource = "marker" | "payload" | "none"

export interface ResolvedContinuityBaseline {
  source: ContinuityBaselineSource
  since?: string
}

export interface ContinuityBaselineDiagnostic {
  projectScope: string | "none"
  source: "marker" | "none"
  stateFile: string
  readable: boolean
  since?: string
  warning?: string
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

export type HandoffMode = "manual" | "review" | "automatic"

export type MemoryContextPolicyMode = "off" | "policy-only" | "selective"

export interface MemoryContextPolicyConfig {
  mode?: MemoryContextPolicyMode
  maxItems?: {
    sessionStart?: number
    prompt?: number
  }
  maxChars?: {
    sessionStart?: number
    prompt?: number
  }
  preferenceMaxItems?: {
    sessionStart?: number
    prompt?: number
  }
  preferenceMaxChars?: {
    sessionStart?: number
    prompt?: number
  }
  includePending?: boolean
  fallbackToSearch?: boolean
}

export interface SessionEndSummaryConfig {
  enabled?: boolean
  provider?: "openai-compatible"
  baseUrl?: string
  apiKeyEnv?: string | null
  model?: string
  promptTemplate?: string
  maxTokens?: number
  requireConfirmation?: boolean
  includeToolOutputs?: boolean
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
  plugins?: string[]
  pluginConfig?: Record<string, unknown>
  memory?: {
    handoffMode?: HandoffMode
    sessionEndSummary?: SessionEndSummaryConfig
    contextPolicy?: MemoryContextPolicyConfig
  }
}

export interface MemoryEngineConfig {
  memoryPath?: string
  embeddingsPath?: string
  configPath?: string
  embeddingProvider?: EmbeddingProvider
  hookDebugLogPath?: string
  integrationPaths?: Partial<IntegrationDiagnosticPaths>
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
}

export interface CompactReport {
  removedMemories: number
  removedEmbeddings: number
  removedInvalidations: number
}
