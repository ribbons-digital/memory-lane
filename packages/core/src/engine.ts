// fallow-ignore-file unused-class-member
// MemoryEngine exposes public methods used by the CLI, pi adapter, and package consumers.
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { isSafeMirrorFolder, syncObsidianMirror } from "@memory-lane/obsidian-mirror"
import { createMemoryId } from "./storage.js"
import {
  effectiveMemoryKind, searchMemories, findDuplicateMemory,
} from "./search.js"
import { containsLikelySecret } from "./secret-detection.js"
import { resolveProjectScope } from "./project-scope.js"
import { loadConfig, getDefaultConfigPath } from "./config.js"
import { createSingleStoreEngineStorage, type MemoryEngineStorage } from "./storage-facade.js"
import { defaultHookDebugLogPath, hookDebugEnabled } from "./hook-debug-log.js"
import { retrieveSemanticMemories } from "./retrieval.js"
import { diagnoseIntegrations, type IntegrationDiagnosticPaths } from "./integration-diagnostics.js"
import { VALID_REVISION_ACTORS, validateSaveInput } from "./storage-validation.js"
import {
  hasRealUpdateChange, revisionForSuccessor, revisionForSuperseded, revisionWarnings, sameIdRevision,
} from "./revisions.js"
import { isMetaTaskPromptText } from "./meta-task-filter.js"
import { buildFreshnessStatus, classifyFreshness, isStrictIsoTimestamp } from "./freshness.js"
import { buildContinuityHints } from "./continuity-hints.js"
import {
  continuityBaselineDiagnostic,
  readContinuityBaseline,
  writeContinuityBaseline,
} from "./continuity-baseline.js"
import { buildContinuityReadModel } from "./continuity-read-model.js"
import { selectOperatingAgreements, summarizeOperatingAgreements } from "./operating-agreements.js"
import { buildPreferenceDiagnostics } from "./preference-diagnostics.js"
import {
  contentHash, createNewMemory, saveContext, shouldAutoEmbed, timestamp, visibleInScope,
  type SaveContext,
} from "./engine-helpers.js"
import type {
  MemoryRecord, MemoryStatus, MemoryCategory, MemoryScopeType,
  MemoryKind, MemoryFreshness, SaveInput, SaveResult, UpdateInput, MemoryMutationResult, UpdatePreview, RescopeInput, RescopeResult, ProjectScope,
  RecallOptions, RecallResult, EmbeddingProvider, CompactReport, MemoryEngineConfig, MemoryContextPolicyConfig, HandoffMode,
  FreshnessStatus, ContinuityHintSummary, ContinuityReadModel, OperatingAgreementList, OperatingAgreementOptions, OperatingAgreementSummary,
  SupersedeResult, ReplaceResult, MemoryRevisionActor, ResolvedContinuityBaseline, ContinuityBaselineDiagnostic,
  LegacyProjectMigrationApplyResult, LegacyProjectMigrationPlan, LocalLearningActor, LocalLearningEventInput, LocalLearningEventSink,
} from "./types.js"

function displayValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value)
}

function allowedValues<T extends string>(allowed: Set<T>): string {
  return [...allowed].join(", ")
}

function validateRevisionOptions(input: { reason?: string; revisedBy?: MemoryRevisionActor }): void {
  if (input.reason !== undefined && typeof input.reason !== "string") {
    throw new Error(`Invalid reason: ${displayValue(input.reason)}. Expected a string`)
  }
  if (input.revisedBy !== undefined && !VALID_REVISION_ACTORS.has(input.revisedBy)) {
    throw new Error(`Invalid revisedBy: ${displayValue(input.revisedBy)}. Expected one of: ${allowedValues(VALID_REVISION_ACTORS)}`)
  }
}

function validateUpdateInput(input: UpdateInput): void {
  validateSaveInput({ text: "update validation placeholder", category: input.category, kind: input.kind })
  if (input.status !== undefined && input.status !== "pending" && input.status !== "approved") {
    throw new Error(`Invalid status: ${displayValue(input.status)}. Expected one of: pending, approved`)
  }
  validateRevisionOptions(input)
}

function clone(memory: MemoryRecord, update: Partial<MemoryRecord>): MemoryRecord {
  return {
    ...memory,
    ...update,
    id: memory.id,
    createdAt: memory.createdAt,
    updatedAt: timestamp(),
    kind: update.kind ?? effectiveMemoryKind({ ...memory, ...update }),
  }
}

const DEFAULT_DIR = path.join(os.homedir(), ".memory-lane")


export class MemoryEngine {
  private readonly storage: MemoryEngineStorage
  private readonly config: ReturnType<typeof loadConfig>
  private scope: ProjectScope | null = null
  private readonly embProvider?: EmbeddingProvider
  private readonly configPath?: string
  private readonly hookDebugLogPath: string
  private readonly integrationPaths?: Partial<IntegrationDiagnosticPaths>
  private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>
  private readonly pendingEmbeddings = new Set<Promise<void>>()
  private readonly pendingEmbeddingControllers = new Set<AbortController>()
  private readonly learningEventSink?: LocalLearningEventSink

  constructor(opts?: MemoryEngineConfig) {
    const memoryPath = opts?.memoryPath ?? path.join(DEFAULT_DIR, "memory.jsonl")
    const embeddingsPath = opts?.embeddingsPath ?? path.join(DEFAULT_DIR, "embeddings.jsonl")
    this.storage = opts?.storage ?? createSingleStoreEngineStorage(memoryPath, embeddingsPath)
    this.configPath = opts?.configPath ?? getDefaultConfigPath()
    this.config = loadConfig(this.configPath)
    this.embProvider = opts?.embeddingProvider
    this.hookDebugLogPath = opts?.hookDebugLogPath ?? defaultHookDebugLogPath()
    this.integrationPaths = opts?.integrationPaths
    this.env = opts?.env ?? process.env
    this.learningEventSink = opts?.learningEventSink
    this.refreshScope()

    // Auto-compact on startup if dead weight exceeds threshold
    if (opts?.autoCompact !== false && this.storage.shouldCompact()) {
      this.storage.compact()
    }
  }

  private emitLearningEvent(input: Omit<LocalLearningEventInput, "actingProjectKey">): void {
    try {
      this.learningEventSink?.({ ...input, actingProjectKey: this.scope?.key })
    } catch { /* local learning capture is fail-open */ }
  }


  private appendEmbedding(memory: MemoryRecord, vector: number[], profileName: string, model: string): void {
    this.storage.appendEmbedding({
      memoryId: memory.id,
      memoryUpdatedAt: memory.updatedAt,
      contentHash: contentHash(memory.text),
      profileName,
      model,
      dimensions: vector.length,
      vector,
      createdAt: new Date().toISOString(),
    })
  }

  /** Embed a single memory. Works with both sync and async providers. Non-fatal - failures are swallowed. */
  private async _embedMemory(memory: MemoryRecord, signal?: AbortSignal): Promise<void> {
    if (containsLikelySecret(memory.text) || !this.embProvider || signal?.aborted) return
    try {
      const profileName = this.config.semantic.activeEmbeddingProfile
      const profile = this.config.semantic.embeddings.profiles[profileName]
      if (!profile || signal?.aborted) return
      const [vector] = await this.embProvider.embed([memory.text], signal)
      if (vector && !signal?.aborted) this.appendEmbedding(memory, vector, profileName, profile.model)
    } catch { /* non-fatal: embedding can be rebuilt via reindex */ }
  }

  private scheduleEmbedding(memory: MemoryRecord): void {
    const controller = new AbortController()
    const pending = this._embedMemory(memory, controller.signal).catch(() => { /* swallowed */ })
    this.pendingEmbeddingControllers.add(controller)
    this.pendingEmbeddings.add(pending)
    pending.finally(() => {
      this.pendingEmbeddingControllers.delete(controller)
      this.pendingEmbeddings.delete(pending)
    }).catch(() => { /* swallowed */ })
  }

  /** Abort background embedding writes that were scheduled by approved-memory mutation paths. */
  cancelPendingEmbeddings(): void {
    for (const controller of this.pendingEmbeddingControllers) controller.abort()
  }

  /** Wait for currently scheduled background embedding writes to finish. */
  async settle(): Promise<void> {
    while (this.pendingEmbeddings.size) {
      await Promise.allSettled([...this.pendingEmbeddings])
    }
  }

  /** Re-resolve the project scope from current cwd or given path, or clear it explicitly with null. */
  refreshScope(cwd?: string | null): void {
    this.scope = cwd === null ? null : resolveProjectScope(cwd)
  }

  /** Current project scope or null if none available. */
  getProjectScope(): ProjectScope | null {
    return this.scope
  }

  /** Shared context-injection policy loaded from config. */
  getContextPolicy(): MemoryContextPolicyConfig | undefined {
    return this.config.memory?.contextPolicy
  }

  /** Configured cross-session handoff posture. */
  getHandoffMode(): HandoffMode {
    const mode = this.config.memory?.handoffMode ?? "manual"
    return mode === "review" || mode === "automatic" ? mode : "manual"
  }

  /** Resolve the baseline timestamp for cross-session continuity freshness. */
  resolveContinuityBaseline(inputSince?: string): ResolvedContinuityBaseline {
    const projectScope = this.scope?.key
    if (projectScope) {
      const read = readContinuityBaseline(this.storage.continuityBaselinePath, projectScope)
      if (read.marker?.lastSeenAt) return { source: "marker", since: read.marker.lastSeenAt }
    }
    if (isStrictIsoTimestamp(inputSince)) return { source: "payload", since: inputSince }
    return { source: "none" }
  }

  /** Record that Memory Lane evaluated SessionStart continuity for the current project. */
  recordContinuityBaseline(observedAt?: string): void {
    const projectScope = this.scope?.key
    if (!projectScope) return
    const lastSeenAt = isStrictIsoTimestamp(observedAt) ? observedAt : new Date().toISOString()
    writeContinuityBaseline(this.storage.continuityBaselinePath, projectScope, lastSeenAt)
  }

  continuityBaselineDoctor(): ContinuityBaselineDiagnostic {
    return continuityBaselineDiagnostic(this.storage.continuityBaselinePath, this.scope?.key)
  }

  private syncMirrorAndCollectWarnings(): string[] {
    const obsidian = this.config.obsidian
    if (!obsidian?.enabled || !obsidian.vaultPath) return []
    try {
      // TODO(obsidian): Slice 1 keeps mirroring simple by syncing the full store after each mutation;
      // optimize with targeted per-record mirroring later if needed.
      const result = syncObsidianMirror(
        { vaultPath: obsidian.vaultPath, folder: obsidian.folder },
        this.storage.listMemories(),
      )
      return result.ok ? result.warnings : result.warnings.length ? result.warnings : ["Obsidian mirror update failed"]
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return [`Obsidian mirror update failed: ${message}`]
    }
  }

  private withMirrorWarnings(result: SaveResult): SaveResult {
    if (result.status !== "saved") return result
    const warnings = this.syncMirrorAndCollectWarnings()
    return warnings.length ? { ...result, warnings } : result
  }

  private mutationResultWithMirrorWarnings(memory: MemoryRecord): MemoryMutationResult {
    const warnings = this.syncMirrorAndCollectWarnings()
    return warnings.length ? { ...memory, warnings } : memory
  }

  private visibleByScope(memory: MemoryRecord, opts?: { all?: boolean }): boolean {
    return Boolean(opts?.all) || visibleInScope(memory, this.scope?.key)
  }

  private findScopedMemory(
    id: string,
    predicate: (memory: MemoryRecord) => boolean,
    opts?: { all?: boolean },
  ): MemoryRecord | undefined {
    return this.storage.listMemories().find((memory) =>
      memory.id === id && predicate(memory) && this.visibleByScope(memory, opts),
    )
  }

  getById(id: string, opts?: { all?: boolean }): MemoryRecord | undefined {
    return this.findScopedMemory(
      id,
      (memory) => Boolean(opts?.all) || memory.status === "approved" || memory.status === "pending",
      opts,
    )
  }

  private requireActiveMemory(id: string, opts?: { all?: boolean }): MemoryRecord {
    const memory = this.findScopedMemory(
      id,
      (candidate) => candidate.status !== "deleted" && candidate.status !== "rejected",
      opts,
    )
    if (!memory) throw new Error(`Cannot rescope memory: active memory not found: ${id}`)
    return memory
  }

  private buildRescopePreview(id: string, input: RescopeInput): RescopeResult {
    if (input.scopeType !== "global" && input.scopeType !== "project") {
      throw new Error(`Invalid scopeType: ${displayValue(input.scopeType)}. Expected one of: global, project`)
    }
    const current = this.requireActiveMemory(id, input)
    const targetScope = input.scopeType === "global" ? undefined : resolveProjectScope(input.projectPath)
    if (input.scopeType === "project" && !targetScope) {
      throw new Error("Cannot rescope to project: no project scope is available")
    }
    const proposed: MemoryRecord = {
      ...current,
      scope: input.scopeType === "global" ? { type: "global" } : { type: "project", key: targetScope!.key },
      project: input.scopeType === "global" ? undefined : { ...targetScope! },
      updatedAt: timestamp(),
    }
    const normalizedCurrent = JSON.stringify({ scope: current.scope, project: current.project })
    const normalizedProposed = JSON.stringify({ scope: proposed.scope, project: proposed.project })
    if (normalizedCurrent === normalizedProposed) throw new Error(`Cannot rescope memory: no-op scope change: ${id}`)
    return { dryRun: input.dryRun ?? false, current, proposed, warnings: [] }
  }

  /** Preview a same-id scope correction. Respects project scope unless `all` is true. */
  previewRescope(id: string, input: RescopeInput): RescopeResult | undefined {
    return this.buildRescopePreview(id, { ...input, dryRun: true })
  }

  /** Apply a same-id scope correction. Respects project scope unless `all` is true. */
  rescope(id: string, input: RescopeInput): RescopeResult | undefined {
    const result = this.buildRescopePreview(id, { ...input, dryRun: false })
    this.storage.appendMemory(result.proposed)
    this.invalidateEmbedding(id, "updated")
    if (shouldAutoEmbed(result.proposed, this.config.semantic, this.embProvider)) this.scheduleEmbedding(result.proposed)
    const mirrorWarnings = this.syncMirrorAndCollectWarnings()
    return mirrorWarnings.length ? { ...result, mirrorWarnings } : result
  }

  private upgradePendingDuplicate(dup: MemoryRecord, input: SaveInput, ctx: SaveContext): SaveResult {
    if (input.status !== "approved" || dup.status !== "pending") return { status: "skipped", reason: "duplicate" }
    const upgraded = clone(dup, {
      text: ctx.text,
      category: ctx.category,
      scope: ctx.scope,
      source: input.source ?? "manual",
      status: "approved",
      kind: ctx.kind,
      project: dup.project,
      provenance: dup.provenance ?? input.provenance,
      freshness: input.freshness ?? dup.freshness,
      descriptor: ctx.descriptor ?? dup.descriptor,
    })
    this.storage.appendMemory(upgraded)
    this.invalidateEmbedding(dup.id, "updated")
    if (shouldAutoEmbed(upgraded, this.config.semantic, this.embProvider)) this.scheduleEmbedding(upgraded)
    this.emitLearningEvent({ eventType: "suggestion-approved", memory: upgraded, previousMemory: dup, actor: "lifecycle", triggerContext: input.learningTriggerContext })
    return { status: "saved", memory: upgraded }
  }

  private appendMemoryRecords(records: MemoryRecord[]): void {
    this.storage.appendMemories(records)
  }

  private persistMemory(input: SaveInput, ctx: SaveContext): SaveResult {
    const memory = createNewMemory(input, ctx, this.scope)
    this.storage.appendMemory(memory)
    if (shouldAutoEmbed(memory, this.config.semantic, this.embProvider)) this.scheduleEmbedding(memory)
    this.emitLearningEvent({ eventType: "suggestion-created", memory, triggerContext: input.learningTriggerContext })
    return { status: "saved", memory }
  }

  /** Save a memory. Returns SaveResult. */
  save(input: SaveInput): SaveResult {
    const text = input.text.trim()
    if (!text) return { status: "skipped", reason: "empty" }
    if (containsLikelySecret(text)) return { status: "skipped", reason: "secret" }
    validateSaveInput(input)

    const ctx = saveContext(input, text, this.scope)
    const dup = findDuplicateMemory(this.storage.listMemories(), ctx.text, ctx.category, ctx.scopeType, this.scope?.key)
    return this.withMirrorWarnings(dup ? this.upgradePendingDuplicate(dup, input, ctx) : this.persistMemory(input, ctx))
  }

  /**
   * Queue a memory suggestion. Defaults to pending, but can auto-approve for explicit user requests.
   * Optional descriptor metadata is the final parameter.
   */
  suggest(text: string, category?: MemoryCategory, scopeType?: MemoryScopeType, kind?: MemoryKind, status?: MemoryStatus, freshness?: MemoryFreshness, descriptor?: MemoryRecord["descriptor"]): SaveResult {
    const nextStatus = status ?? "pending"
    validateSaveInput({ text, category, scopeType, source: "user-suggested", status: nextStatus, kind, freshness, descriptor })
    if (nextStatus === "pending" && isMetaTaskPromptText(text)) return { status: "skipped", reason: "meta task prompt" }
    return this.save({ text, category, scopeType, source: "user-suggested", status: nextStatus, kind, freshness, descriptor })
  }

  /** Approve a pending memory by id. Respects project scope unless `all` is true. */
  approve(id: string, opts?: { all?: boolean; actor?: LocalLearningActor }): MemoryMutationResult | undefined {
    const mem = this.findScopedMemory(id, (memory) => memory.status !== "deleted", opts)
    if (!mem) return undefined
    const updated = clone(mem, { status: "approved" })
    this.storage.appendMemory(updated)
    this.invalidateEmbedding(id, "updated")
    if (shouldAutoEmbed(updated, this.config.semantic, this.embProvider)) this.scheduleEmbedding(updated)
    this.emitLearningEvent({
      eventType: mem.status === "rejected" ? "suggestion-reactivated" : "suggestion-approved",
      memory: updated,
      previousMemory: mem,
      actor: opts?.actor ?? "manual",
    })
    return this.mutationResultWithMirrorWarnings(updated)
  }

  private buildUpdatePreview(id: string, patch: UpdateInput, opts?: { all?: boolean }): UpdatePreview | undefined {
    const mem = this.findScopedMemory(id, (memory) => memory.status === "approved" || memory.status === "pending", opts)
    if (!mem) return undefined
    validateUpdateInput(patch)

    const proposed: MemoryRecord = {
      ...mem,
      text: patch.text === undefined ? mem.text : patch.text.trim(),
      category: patch.category ?? mem.category,
      status: patch.status ?? mem.status,
      kind: patch.kind ?? mem.kind,
      revision: sameIdRevision(patch) ?? mem.revision,
      updatedAt: timestamp(),
    }
    if (!proposed.text) throw new Error("Invalid text: memory text cannot be empty")
    if (containsLikelySecret(proposed.text)) throw new Error("Invalid text: memory text contains a likely secret")
    if (!hasRealUpdateChange(mem, proposed)) throw new Error("No changes to apply")

    return { dryRun: true, current: mem, proposed, warnings: [] }
  }

  previewUpdate(id: string, patch: UpdateInput, opts?: { all?: boolean }): UpdatePreview | undefined {
    return this.buildUpdatePreview(id, patch, opts)
  }

  /** Update an active approved or pending memory by id. Respects project scope unless `all` is true. */
  update(id: string, patch: UpdateInput, opts?: { all?: boolean; actor?: LocalLearningActor }): MemoryMutationResult | undefined {
    const preview = this.buildUpdatePreview(id, patch, opts)
    if (!preview) return undefined
    const updated = preview.proposed
    this.storage.appendMemory(updated)
    this.invalidateEmbedding(id, "updated")
    if (shouldAutoEmbed(updated, this.config.semantic, this.embProvider)) this.scheduleEmbedding(updated)
    if (preview.current.status !== "approved" && updated.status === "approved") {
      this.emitLearningEvent({ eventType: "suggestion-approved", memory: updated, previousMemory: preview.current, actor: opts?.actor ?? patch.revisedBy ?? "manual", reason: patch.reason })
    }
    if (preview.current.kind !== "workflow_rule" && updated.kind === "workflow_rule") {
      this.emitLearningEvent({ eventType: "agreement-recommendation-accepted", memory: updated, previousMemory: preview.current, actor: opts?.actor ?? patch.revisedBy ?? "manual", reason: patch.reason, recommendedAction: "update-kind-workflow-rule" })
    }
    return this.mutationResultWithMirrorWarnings(updated)
  }

  private requireRevisionMemory(id: string, label: "Successor" | "Old", opts?: { all?: boolean }): MemoryRecord {
    const memory = this.findScopedMemory(
      id,
      (candidate) => candidate.status !== "deleted" && candidate.status !== "rejected",
      opts,
    )
    if (!memory) throw new Error(`${label} memory not found: ${id}`)
    return memory
  }

  private assertApprovedRevisionMemory(memory: MemoryRecord, label: "Successor" | "Old"): void {
    if (memory.status !== "approved") throw new Error(`${label} must be approved: ${memory.id}`)
  }

  private validateOldIds(newId: string | undefined, oldIds: string[]): void {
    if (!oldIds.length) throw new Error("At least one old memory id is required")
    if (new Set(oldIds).size !== oldIds.length) throw new Error("Old memory ids must be unique")
    if (newId !== undefined && oldIds.includes(newId)) throw new Error("A memory cannot supersede itself")
  }

  private buildSupersedePreview(
    newId: string,
    oldIds: string[],
    opts?: { reason?: string; revisedBy?: MemoryRevisionActor; dryRun?: boolean; all?: boolean },
  ): SupersedeResult {
    this.validateOldIds(newId, oldIds)
    validateRevisionOptions(opts ?? {})
    const successor = this.requireRevisionMemory(newId, "Successor", opts)
    const oldRecords = oldIds.map((id) => this.requireRevisionMemory(id, "Old", opts))
    this.assertApprovedRevisionMemory(successor, "Successor")
    for (const memory of oldRecords) this.assertApprovedRevisionMemory(memory, "Old")
    const already = oldRecords.find((memory) => memory.revision?.supersededBy)
    if (already) throw new Error(`Old memory is already superseded: ${already.id}`)

    const revisedBy = opts?.revisedBy ?? "manual"
    const revisedSuccessor: MemoryRecord = {
      ...successor,
      revision: revisionForSuccessor(oldIds, opts?.reason, revisedBy),
      updatedAt: timestamp(),
    }
    const superseded = oldRecords.map((memory) => ({
      ...memory,
      revision: revisionForSuperseded(newId, opts?.reason, revisedBy),
      updatedAt: timestamp(),
    }))
    return {
      dryRun: opts?.dryRun ?? false,
      successor: revisedSuccessor,
      superseded,
      warnings: revisionWarnings(revisedSuccessor, oldRecords),
    }
  }

  /** Link approved old memories to an approved successor. Respects project scope unless `all` is true. */
  supersede(
    newId: string,
    oldIds: string[],
    opts?: { reason?: string; revisedBy?: MemoryRevisionActor; dryRun?: boolean; all?: boolean },
  ): SupersedeResult {
    const previousById = new Map(this.storage.listMemories().map((memory) => [memory.id, memory]))
    const preview = this.buildSupersedePreview(newId, oldIds, opts)
    if (opts?.dryRun) return preview

    this.appendMemoryRecords([preview.successor, ...preview.superseded])
    for (const memory of preview.superseded) {
      const previousMemory = previousById.get(memory.id)
      this.emitLearningEvent({ eventType: "suggestion-superseded", memory, previousMemory, relatedMemory: preview.successor, actor: opts?.revisedBy ?? "manual", reason: opts?.reason })
      if (memory.kind !== "workflow_rule" && preview.successor.kind === "workflow_rule") {
        this.emitLearningEvent({ eventType: "agreement-recommendation-accepted", memory, previousMemory, relatedMemory: preview.successor, actor: opts?.revisedBy ?? "manual", reason: opts?.reason, recommendedAction: "supersede" })
      }
    }
    const mirrorWarnings = this.syncMirrorAndCollectWarnings()
    return mirrorWarnings.length ? { ...preview, mirrorWarnings } : preview
  }

  /** Create a successor memory for approved old memories. Respects project scope unless `all` is true. */
  replace(oldIds: string[], input: {
    text: string
    category?: MemoryCategory
    kind?: MemoryKind
    status?: Extract<MemoryStatus, "pending" | "approved">
    reason?: string
    revisedBy?: MemoryRevisionActor
    dryRun?: boolean
    all?: boolean
  }): ReplaceResult {
    this.validateOldIds(undefined, oldIds)
    validateRevisionOptions(input)
    validateSaveInput({ text: input.text, category: input.category, kind: input.kind, status: input.status ?? "approved" })
    if (input.status !== undefined && input.status !== "pending" && input.status !== "approved") {
      throw new Error(`Invalid status: ${displayValue(input.status)}. Expected one of: pending, approved`)
    }
    const oldRecords = oldIds.map((id) => this.requireRevisionMemory(id, "Old", input))
    for (const memory of oldRecords) this.assertApprovedRevisionMemory(memory, "Old")
    const already = oldRecords.find((memory) => memory.revision?.supersededBy)
    if (already) throw new Error(`Old memory is already superseded: ${already.id}`)

    const text = input.text.trim()
    if (!text) throw new Error("Invalid text: memory text cannot be empty")
    if (containsLikelySecret(text)) throw new Error("Invalid text: memory text contains a likely secret")

    const first = oldRecords[0]
    const status = input.status ?? "approved"
    const now = timestamp()
    const successor: MemoryRecord = {
      id: createMemoryId(),
      text,
      category: input.category ?? first.category,
      scope: first.scope,
      source: "manual",
      status,
      kind: input.kind ?? first.kind,
      createdAt: now,
      updatedAt: now,
      project: first.project,
      revision: revisionForSuccessor(oldIds, input.reason, input.revisedBy ?? "manual"),
    }
    const warnings = revisionWarnings(successor, oldRecords)
    const superseded = status === "approved"
      ? oldRecords.map((memory) => ({
        ...memory,
        revision: revisionForSuperseded(successor.id, input.reason, input.revisedBy ?? "manual"),
        updatedAt: timestamp(),
      }))
      : []
    const result: ReplaceResult = {
      dryRun: input.dryRun ?? false,
      successor,
      superseded,
      warnings,
      successorCreated: true,
    }
    if (input.dryRun) return result

    this.appendMemoryRecords([successor, ...superseded])
    if (shouldAutoEmbed(successor, this.config.semantic, this.embProvider)) this.scheduleEmbedding(successor)
    this.emitLearningEvent({ eventType: "suggestion-created", memory: successor })
    for (const [index, memory] of superseded.entries()) {
      const previousMemory = oldRecords[index]
      this.emitLearningEvent({ eventType: "suggestion-replaced", memory, previousMemory, relatedMemory: successor, actor: input.revisedBy ?? "manual", reason: input.reason })
      this.emitLearningEvent({ eventType: "suggestion-superseded", memory, previousMemory, relatedMemory: successor, actor: input.revisedBy ?? "manual", reason: input.reason })
      if (memory.kind !== "workflow_rule" && successor.kind === "workflow_rule") {
        this.emitLearningEvent({ eventType: "agreement-recommendation-accepted", memory, previousMemory, relatedMemory: successor, actor: input.revisedBy ?? "manual", reason: input.reason, recommendedAction: "replace" })
      }
    }
    const mirrorWarnings = this.syncMirrorAndCollectWarnings()
    return mirrorWarnings.length ? { ...result, mirrorWarnings } : result
  }

  /** Reject a memory by id. Respects project scope unless `all` is true. */
  reject(id: string, opts?: { all?: boolean; actor?: LocalLearningActor }): MemoryMutationResult | undefined {
    const mem = this.findScopedMemory(id, (memory) => memory.status !== "deleted", opts)
    if (!mem) return undefined
    const updated = clone(mem, { status: "rejected" })
    this.storage.appendMemory(updated)
    this.invalidateEmbedding(id, "deleted")
    this.emitLearningEvent({ eventType: "suggestion-rejected", memory: updated, previousMemory: mem, actor: opts?.actor ?? "manual" })
    return this.mutationResultWithMirrorWarnings(updated)
  }

  /** Soft-delete a memory by id. Respects project scope unless `all` is true. */
  delete(id: string, opts?: { all?: boolean; actor?: LocalLearningActor }): MemoryMutationResult | undefined {
    const mem = this.findScopedMemory(id, (memory) => memory.status !== "deleted", opts)
    if (!mem) return undefined
    const updated = clone(mem, { status: "deleted" })
    this.storage.appendMemory(updated)
    this.invalidateEmbedding(id, "deleted")
    this.emitLearningEvent({ eventType: "suggestion-deleted", memory: updated, previousMemory: mem, actor: opts?.actor ?? "manual" })
    return this.mutationResultWithMirrorWarnings(updated)
  }

  /** List memories. By default respects project scope — only memories visible to
   *  the current project (global + matching project key) are returned.
   *  Use `{ all: true }` to bypass scope filtering (e.g. admin review across projects).
   *
   *  Overload signatures:
   *    list(status) — legacy: filter by status only
   *    list(opts) — new: { status?, all? }
   */
  list(status?: MemoryStatus): MemoryRecord[]
  list(opts?: { status?: MemoryStatus; all?: boolean }): MemoryRecord[]
  list(arg?: MemoryStatus | { status?: MemoryStatus; all?: boolean }): MemoryRecord[] {
    const all = this.storage.listMemories()
    const scopeKey = this.scope?.key
    const opts = typeof arg === "object" ? arg : { status: arg }
    const visible = opts?.all ? all : all.filter((m) => visibleInScope(m, scopeKey))
    if (!opts?.status) return visible
    return visible.filter((m) => m.status === opts.status)
  }

  /** Search memories by text query within the current project scope. */
  search(query: string): MemoryRecord[] {
    return searchMemories(this.storage.listMemories(), query, this.scope?.key ?? "")
  }

  /** List pending memories visible to the current project, or all pending memories when requested. */
  reviewPending(opts?: { all?: boolean }): MemoryRecord[] {
    return this.storage.listMemories().filter((memory) =>
      memory.status === "pending" && this.visibleByScope(memory, opts),
    )
  }

  private invalidateEmbedding(memoryId: string, reason: "updated" | "deleted" | "stale"): void {
    const invalidation: import("./types.js").EmbeddingInvalidationRecord = {
      type: "invalidation",
      memoryId,
      invalidatedAt: new Date().toISOString(),
      reason,
    }
    this.storage.appendEmbedding(invalidation)
  }

  // ── Phase 2: Semantic Retrieval ────────────────────────────

  async recall(query: string, options?: RecallOptions): Promise<RecallResult> {
    const config = this.config.semantic
    const scope = options?.projectScope ?? this.scope
    const projectKey = scope?.key ?? ""

    return retrieveSemanticMemories(
      this.storage.listMemories(),
      this.storage.listEmbeddings(),
      this.storage.listEmbeddingInvalidations(),
      query,
      projectKey,
      config,
      this.embProvider,
    )
  }

  compact(): CompactReport {
    return this.storage.compact()
  }

  private currentEmbeddingKeys(profileName: string, model: string): Set<string> {
    const latestInvalidations = new Map<string, string>()
    for (const invalidation of this.storage.listEmbeddingInvalidations()) {
      const previous = latestInvalidations.get(invalidation.memoryId)
      if (!previous || previous <= invalidation.invalidatedAt) latestInvalidations.set(invalidation.memoryId, invalidation.invalidatedAt)
    }

    const currentKeys = new Set<string>()
    for (const embedding of this.storage.listEmbeddings()) {
      const invalidatedAt = latestInvalidations.get(embedding.memoryId)
      if (invalidatedAt && embedding.createdAt < invalidatedAt) continue
      if (embedding.profileName !== profileName || embedding.model !== model) continue
      currentKeys.add([embedding.memoryId, embedding.contentHash, embedding.profileName, embedding.model].join("\0"))
    }
    return currentKeys
  }

  /** Rebuild embeddings for approved memories missing current vectors; pass force to recompute existing current vectors. */
  async reindexEmbeddings(opts?: { force?: boolean; signal?: AbortSignal }): Promise<{ embedded: number; skippedExisting: number; skippedSecrets: number }> {
    if (!this.embProvider || !this.config.semantic.enabled) {
      return { embedded: 0, skippedExisting: 0, skippedSecrets: 0 }
    }

    const config = this.config.semantic
    const profileName = config.activeEmbeddingProfile
    const profile = config.embeddings.profiles[profileName]
    if (!profile) throw new Error("No active embedding profile configured")

    const approved = this.storage.listMemories().filter((m) => m.status === "approved")
    const safe = approved.filter((m) => !containsLikelySecret(m.text))
    const model = profile.model
    const skippedSecrets = approved.length - safe.length

    const currentKeys = this.currentEmbeddingKeys(profileName, model)

    const needsEmbedding = opts?.force
      ? safe
      : safe.filter((memory) => !currentKeys.has([memory.id, contentHash(memory.text), profileName, model].join("\0")))
    const skippedExisting = safe.length - needsEmbedding.length

    let embedded = 0
    const batchSize = profile.batchSize ?? 16
    for (let i = 0; i < needsEmbedding.length; i += batchSize) {
      const batch = needsEmbedding.slice(i, i + batchSize)
      const vectors = await this.embProvider.embed(batch.map((m) => m.text), opts?.signal)
      batch.forEach((memory, index) => {
        const vector = vectors[index]
        if (!vector?.length) return
        this.storage.appendEmbedding({
          memoryId: memory.id,
          memoryUpdatedAt: memory.updatedAt,
          contentHash: contentHash(memory.text),
          profileName,
          model,
          dimensions: vector.length,
          vector,
          createdAt: new Date().toISOString(),
        })
        embedded++
      })
    }
    return { embedded, skippedExisting, skippedSecrets }
  }

  /** Probe the embedding provider to verify connectivity. */
  async probeEmbeddingProvider(): Promise<{ ok: boolean; dimensions?: number; error?: string }> {
    if (!this.embProvider) return { ok: false, error: "No embedding provider configured" }
    try {
      const vectors = await this.embProvider.embed(["probe"])
      return { ok: true, dimensions: vectors[0]?.length }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  private semanticDoctor(memories: MemoryRecord[]): Record<string, unknown> {
    const config = this.config.semantic
    const approved = memories.filter((m) => m.status === "approved")
    const semanticApprovedMemories = approved.length
    const profileName = config.activeEmbeddingProfile
    const profile = config.embeddings.profiles[profileName]
    const model = profile?.model
    const warnings: string[] = []

    let semanticEmbeddedApprovedMemories = 0
    if (model) {
      const currentKeys = this.currentEmbeddingKeys(profileName, model)
      semanticEmbeddedApprovedMemories = approved.filter((memory) => (
        currentKeys.has([memory.id, contentHash(memory.text), profileName, model].join("\0"))
      )).length
    }

    const semanticEmbeddingCoverage = config.enabled && semanticApprovedMemories > 0
      ? Math.round((semanticEmbeddedApprovedMemories / semanticApprovedMemories) * 1000) / 1000
      : 1

    if (config.enabled && semanticApprovedMemories > 0 && semanticEmbeddingCoverage < 0.8) {
      warnings.push(
        `Semantic search is enabled, but only ${semanticEmbeddedApprovedMemories}/${semanticApprovedMemories} approved memories have current embeddings. Run \`memory-lane reindex\`.`,
      )
    }

    return {
      semanticApprovedMemories,
      semanticEmbeddedApprovedMemories,
      semanticEmbeddingCoverage,
      semanticWarnings: warnings,
    }
  }

  private handoffModeDoctor(): Record<string, unknown> {
    const mode = this.getHandoffMode()
    const policyMode = this.config.memory?.contextPolicy?.mode ?? "selective"
    const automaticActive = mode === "automatic" && policyMode !== "off"
    const note = mode === "manual"
      ? "Current inspection-first behavior is active."
      : mode === "review"
        ? "Review mode is active for read-only handoff proposals; approve pending memories before relying on them as handoff state."
        : automaticActive
          ? "Automatic mode is active for approved, budgeted SessionStart handoff selection; context policy still controls injection."
          : "Automatic mode is configured but inactive because lifecycle context policy is off."
    return {
      handoffMode: mode,
      handoffModeBehaviorActive: mode === "manual" || mode === "review" || automaticActive,
      handoffModeNote: note,
    }
  }

  private automaticHandoffDoctor(mems: MemoryRecord[]): Record<string, unknown> {
    const mode = this.getHandoffMode()
    const policyMode = this.config.memory?.contextPolicy?.mode ?? "selective"
    const active = mode === "automatic" && policyMode !== "off"
    const notes: string[] = []
    let eligibleCount = 0

    if (mode !== "automatic") {
      notes.push("Automatic handoff selection is inactive because handoff mode is not automatic.")
    } else if (!this.scope?.key) {
      notes.push("Automatic handoff selection needs an active project scope.")
    } else {
      const referenceNow = new Date().toISOString()
      eligibleCount = mems.filter((memory) => {
        if (memory.status !== "approved") return false
        if (memory.scope.type !== "project" || memory.scope.key !== this.scope?.key) return false
        if (memory.kind !== "session_summary" && memory.kind !== "project_checkpoint") return false
        if (containsLikelySecret(memory.text)) return false
        if (memory.revision?.supersededBy) return false
        return classifyFreshness(memory, referenceNow) !== "expired"
      }).length
      if (policyMode === "off") notes.push("Context policy is off; automatic handoff selection will not inject lifecycle context.")
      else notes.push("Static eligibility only; SessionStart contextDecision reports selected/omitted counts.")
    }

    return {
      automaticHandoffDiagnostics: {
        mode: active ? "active" : "inactive",
        policyMode,
        eligibleCount,
        notes,
      },
    }
  }

  private contextPolicyDoctor(): Record<string, unknown> {
    const policy = this.config.memory?.contextPolicy
    return {
      contextPolicyMode: policy?.mode ?? "selective",
      contextPolicySessionStartMaxItems: policy?.maxItems?.sessionStart ?? 4,
      contextPolicyPromptMaxItems: policy?.maxItems?.prompt ?? 6,
      contextPolicySessionStartMaxChars: policy?.maxChars?.sessionStart ?? 1600,
      contextPolicyPromptMaxChars: policy?.maxChars?.prompt ?? 3000,
      contextPolicySessionStartPreferenceMaxItems: policy?.preferenceMaxItems?.sessionStart ?? 2,
      contextPolicyPromptPreferenceMaxItems: policy?.preferenceMaxItems?.prompt ?? 2,
      contextPolicySessionStartPreferenceMaxChars: policy?.preferenceMaxChars?.sessionStart ?? 600,
      contextPolicyPromptPreferenceMaxChars: policy?.preferenceMaxChars?.prompt ?? 900,
      contextPolicyIncludePending: policy?.includePending ?? false,
      contextPolicyFallbackToSearch: policy?.fallbackToSearch ?? true,
    }
  }

  private memoryFileDoctor(): Record<string, unknown> {
    const diagnostics = this.storage.memoryDiagnostics()
    const warnings = diagnostics.skippedRows > 0
      ? [`Memory file has ${diagnostics.skippedRows} skipped JSONL row(s): ${diagnostics.malformedRows} malformed JSON, ${diagnostics.invalidRows} schema-invalid.`]
      : []
    return {
      memoryFileRows: diagnostics.totalRows,
      memoryFileValidRows: diagnostics.validRows,
      memoryFileSkippedRows: diagnostics.skippedRows,
      memoryFileMalformedRows: diagnostics.malformedRows,
      memoryFileInvalidRows: diagnostics.invalidRows,
      memoryFileWarnings: warnings,
    }
  }

  private hookDebugDoctor(): Record<string, unknown> {
    const warnings: string[] = []
    const base = {
      hookDebugEnabledInCurrentEnv: hookDebugEnabled(this.env),
      hookDebugLogPath: this.hookDebugLogPath,
    }

    try {
      const stat = fs.statSync(this.hookDebugLogPath)
      if (!stat.isFile()) {
        warnings.push(`Hook debug log path is not a file: ${this.hookDebugLogPath}`)
        return {
          ...base,
          hookDebugLogExists: true,
          hookDebugLogSizeBytes: 0,
          hookDebugLogLastModified: null,
          hookDebugWarnings: warnings,
        }
      }

      return {
        ...base,
        hookDebugLogExists: true,
        hookDebugLogSizeBytes: stat.size,
        hookDebugLogLastModified: stat.mtime.toISOString(),
        hookDebugWarnings: warnings,
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        warnings.push(`Hook debug log is not accessible: ${this.hookDebugLogPath}`)
      }
      return {
        ...base,
        hookDebugLogExists: false,
        hookDebugLogSizeBytes: 0,
        hookDebugLogLastModified: null,
        hookDebugWarnings: warnings,
      }
    }
  }

  private obsidianDoctor(): Record<string, unknown> {
    const obsidian = this.config.obsidian
    const warnings: string[] = []
    if (!obsidian?.enabled) {
      return { obsidianEnabled: false, obsidianWarnings: warnings }
    }

    const folder = obsidian.folder?.trim() || "Memory Lane"
    const vaultPath = obsidian.vaultPath
    const folderSafe = isSafeMirrorFolder(folder)
    const mirrorRoot = vaultPath ? path.join(vaultPath, folder) : undefined
    const memories = mirrorRoot ? path.join(mirrorRoot, "memories") : undefined
    const imports = mirrorRoot ? path.join(mirrorRoot, "imports") : undefined

    if (!vaultPath) warnings.push("Obsidian vault path is missing.")
    else if (!fs.existsSync(vaultPath)) warnings.push(`Obsidian vault path does not exist: ${vaultPath}`)
    else if (!fs.statSync(vaultPath).isDirectory()) warnings.push(`Obsidian vault path is not a directory: ${vaultPath}`)
    if (!folderSafe) warnings.push("Obsidian mirror folder must be a relative path inside the vault.")
    if (mirrorRoot && !fs.existsSync(mirrorRoot)) warnings.push(`Mirror folder does not exist: ${mirrorRoot}`)
    if (memories && !fs.existsSync(memories)) warnings.push(`memories/ folder does not exist: ${memories}`)
    if (imports && !fs.existsSync(imports)) warnings.push(`imports/ folder does not exist: ${imports}`)

    return {
      obsidianEnabled: true,
      obsidianVaultPath: vaultPath,
      obsidianFolder: folder,
      obsidianMirrorRoot: mirrorRoot,
      obsidianMirrorFolderExists: mirrorRoot ? fs.existsSync(mirrorRoot) : false,
      obsidianMemoriesFolderExists: memories ? fs.existsSync(memories) : false,
      obsidianImportsFolderExists: imports ? fs.existsSync(imports) : false,
      obsidianWarnings: warnings,
    }
  }

  /** Record content-free local learning exposure events for suggestions shown by custom review UIs. */
  recordSuggestionsShown(memories: MemoryRecord[], actor: LocalLearningActor = "manual"): void {
    for (const memory of memories) this.emitLearningEvent({ eventType: "suggestion-shown", memory, actor })
  }

  /** Record content-free local learning exposure events for operating-agreement recommendations shown by custom UIs. */
  recordAgreementRecommendationsShown(list: OperatingAgreementList, actor: LocalLearningActor = "manual"): void {
    for (const selection of [...list.primary, ...list.relatedCandidates]) {
      if (!selection.recommendedKind) continue
      this.emitLearningEvent({ eventType: "agreement-recommendation-shown", memory: selection.memory, actor, recommendedAction: "update-kind-workflow-rule" })
    }
  }

  operatingAgreements(opts?: Omit<OperatingAgreementOptions, "projectScopeKey">): OperatingAgreementList {
    return selectOperatingAgreements(this.storage.listMemories(), {
      ...opts,
      projectScopeKey: this.scope?.key,
    })
  }

  operatingAgreementSummary(opts?: Omit<OperatingAgreementOptions, "projectScopeKey">): OperatingAgreementSummary {
    return summarizeOperatingAgreements(this.operatingAgreements(opts))
  }

  freshnessStatus(opts?: { since?: string }): FreshnessStatus {
    return buildFreshnessStatus(this.storage.listMemories(), {
      projectScopeKey: this.scope?.key,
      since: opts?.since,
    })
  }

  continuityHints(opts?: { since?: string }): ContinuityHintSummary {
    return buildContinuityHints(this.storage.listMemories(), {
      projectScopeKey: this.scope?.key,
      since: opts?.since,
    })
  }

  continuity(opts?: { caller?: "cli" | "mcp" | "lifecycle" | "core"; query?: string }): ContinuityReadModel {
    return buildContinuityReadModel(this.storage.listMemories(), {
      projectScopeKey: this.scope?.key,
      caller: opts?.caller,
      handoffMode: this.getHandoffMode(),
      query: opts?.query,
    })
  }

  /** Create a reviewable plan for moving active legacy home-stored project memories into project-local storage. */
  createLegacyProjectMigrationPlan(): LegacyProjectMigrationPlan {
    return this.storage.createLegacyProjectMigrationPlan(this.scope?.key)
  }

  /** Apply a reviewed legacy project migration plan; callers should require explicit user confirmation first. */
  applyLegacyProjectMigrationPlan(plan: LegacyProjectMigrationPlan): LegacyProjectMigrationApplyResult {
    return this.storage.applyLegacyProjectMigrationPlan(plan)
  }

  /** Generate a diagnostic report. */
  doctor(opts?: { freshnessSince?: string }): Record<string, unknown> {
    const mems = this.storage.listMemories()
    const embs = this.storage.listEmbeddings()
    const total = mems.length
    const config = this.config.semantic
    const operatingAgreements = this.operatingAgreements()
    const operatingAgreementSummary = summarizeOperatingAgreements(operatingAgreements)
    const operatingAgreementIds = new Set([
      ...operatingAgreements.primary.map((selection) => selection.memory.id),
      ...operatingAgreements.relatedCandidates.map((selection) => selection.memory.id),
    ])

    return {
      configFile: this.configPath,
      configExists: true,
      semanticEnabled: config.enabled,
      memoryFile: this.storage.memoryFile,
      embeddingFile: this.storage.embeddingFile,
      totalMemories: total,
      approvedMemories: mems.filter((m) => m.status === "approved").length,
      pendingMemories: mems.filter((m) => m.status === "pending").length,
      deletedMemories: mems.filter((m) => m.status === "deleted").length,
      embeddingCount: embs.length,
      deadWeightRatio: total ? mems.filter((m) => m.status === "deleted" || m.status === "rejected").length / total : 0,
      activeProfileName: config.activeEmbeddingProfile,
      projectScope: this.scope?.key ?? "none",
      integrations: diagnoseIntegrations({ cwd: this.scope?.cwd ?? null, paths: this.integrationPaths }),
      freshness: this.freshnessStatus({ since: opts?.freshnessSince }),
      continuityHints: this.continuityHints({ since: opts?.freshnessSince }),
      continuityBaseline: this.continuityBaselineDoctor(),
      legacyProjectMemories: this.storage.legacyProjectMemoryDiagnostics(this.scope?.key),
      operatingAgreements: operatingAgreementSummary,
      preferenceDiagnostics: buildPreferenceDiagnostics(mems, {
        projectScopeKey: this.scope?.key,
        contextPolicy: this.config.memory?.contextPolicy,
        operatingAgreementIds,
      }),
      ...this.semanticDoctor(mems),
      ...this.handoffModeDoctor(),
      ...this.automaticHandoffDoctor(mems),
      ...this.contextPolicyDoctor(),
      ...this.memoryFileDoctor(),
      ...this.hookDebugDoctor(),
      ...this.obsidianDoctor(),
    }
  }
}
