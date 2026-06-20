// fallow-ignore-file unused-class-member
// MemoryEngine exposes public methods used by the CLI, pi adapter, and package consumers.
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { isSafeMirrorFolder, syncObsidianMirror } from "@memory-lane/obsidian-mirror"
import { createMemoryId, createMemoryStore, type MemoryStore } from "./storage.js"
import {
  effectiveMemoryKind, searchMemories, findDuplicateMemory,
} from "./search.js"
import { containsLikelySecret } from "./secret-detection.js"
import { resolveProjectScope } from "./project-scope.js"
import { loadConfig, getDefaultConfigPath } from "./config.js"
import { createEmbeddingStore } from "./embedding-store.js"
import { defaultHookDebugLogPath, hookDebugEnabled } from "./hook-debug-log.js"
import { retrieveSemanticMemories } from "./retrieval.js"
import { compact as compactStores, shouldCompact } from "./compact.js"
import { diagnoseIntegrations, type IntegrationDiagnosticPaths } from "./integration-diagnostics.js"
import { VALID_REVISION_ACTORS, validateSaveInput } from "./storage-validation.js"
import {
  hasRealUpdateChange, revisionForSuccessor, revisionForSuperseded, revisionWarnings, sameIdRevision,
} from "./revisions.js"
import { isMetaTaskPromptText } from "./meta-task-filter.js"
import { buildFreshnessStatus } from "./freshness.js"
import { buildContinuityHints } from "./continuity-hints.js"
import { buildContinuityReadModel } from "./continuity-read-model.js"
import { selectOperatingAgreements, summarizeOperatingAgreements } from "./operating-agreements.js"
import {
  contentHash, createNewMemory, saveContext, shouldAutoEmbed, timestamp, visibleInScope,
  type SaveContext,
} from "./engine-helpers.js"
import type {
  MemoryRecord, MemoryStatus, MemoryCategory, MemoryScopeType,
  MemoryKind, SaveInput, SaveResult, UpdateInput, MemoryMutationResult, UpdatePreview, ProjectScope,
  RecallOptions, RecallResult, EmbeddingProvider, CompactReport, MemoryEngineConfig, MemoryContextPolicyConfig,
  FreshnessStatus, ContinuityHintSummary, ContinuityReadModel, OperatingAgreementList, OperatingAgreementOptions, OperatingAgreementSummary,
  SupersedeResult, ReplaceResult, MemoryRevisionActor,
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
  private store: MemoryStore
  private readonly config: ReturnType<typeof loadConfig>
  private scope: ProjectScope | null = null
  private readonly embProvider?: EmbeddingProvider
  private readonly embPath: string
  private readonly memPath: string
  private readonly configPath?: string
  private readonly hookDebugLogPath: string
  private readonly integrationPaths?: Partial<IntegrationDiagnosticPaths>
  private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>

  constructor(opts?: MemoryEngineConfig) {
    this.memPath = opts?.memoryPath ?? path.join(DEFAULT_DIR, "memory.jsonl")
    this.embPath = opts?.embeddingsPath ?? path.join(DEFAULT_DIR, "embeddings.jsonl")
    this.configPath = opts?.configPath ?? getDefaultConfigPath()
    this.store = createMemoryStore(this.memPath)
    this.config = loadConfig(this.configPath)
    this.embProvider = opts?.embeddingProvider
    this.hookDebugLogPath = opts?.hookDebugLogPath ?? defaultHookDebugLogPath()
    this.integrationPaths = opts?.integrationPaths
    this.env = opts?.env ?? process.env
    this.refreshScope()

    // Auto-compact on startup if dead weight exceeds threshold
    if (shouldCompact(this.memPath)) {
      compactStores(this.memPath, this.embPath)
    }
  }

  private appendEmbedding(memory: MemoryRecord, vector: number[], profileName: string, model: string): void {
    createEmbeddingStore(this.embPath).append({
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

  /** Embed a single memory (fire-and-forget, called internally from save/approve).
   *  Works with both sync and async providers. Non-fatal — failures are swallowed. */
  private async _embedMemory(memory: MemoryRecord): Promise<void> {
    if (containsLikelySecret(memory.text) || !this.embProvider) return
    try {
      const profileName = this.config.semantic.activeEmbeddingProfile
      const profile = this.config.semantic.embeddings.profiles[profileName]
      if (!profile) return
      const [vector] = await this.embProvider.embed([memory.text])
      if (vector) this.appendEmbedding(memory, vector, profileName, profile.model)
    } catch { /* non-fatal: embedding can be rebuilt via reindex */ }
  }

  /** Re-resolve the project scope from current cwd or given path. */
  refreshScope(cwd?: string): void {
    this.scope = resolveProjectScope(cwd)
  }

  /** Current project scope or null if none available. */
  getProjectScope(): ProjectScope | null {
    return this.scope
  }

  /** Shared context-injection policy loaded from config. */
  getContextPolicy(): MemoryContextPolicyConfig | undefined {
    return this.config.memory?.contextPolicy
  }

  private syncMirrorAndCollectWarnings(): string[] {
    const obsidian = this.config.obsidian
    if (!obsidian?.enabled || !obsidian.vaultPath) return []
    try {
      // TODO(obsidian): Slice 1 keeps mirroring simple by syncing the full store after each mutation;
      // optimize with targeted per-record mirroring later if needed.
      const result = syncObsidianMirror(
        { vaultPath: obsidian.vaultPath, folder: obsidian.folder },
        this.store.list(),
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
    })
    this.store.append(upgraded)
    this.invalidateEmbedding(dup.id, "updated")
    return { status: "saved", memory: upgraded }
  }

  private appendMemoryRecords(records: MemoryRecord[]): void {
    if (!records.length) return
    const existing = fs.existsSync(this.memPath) ? fs.readFileSync(this.memPath, "utf8") : ""
    const prefix = existing && !existing.endsWith("\n") ? existing + "\n" : existing
    const tmpFile = `${this.memPath}.tmp.${createMemoryId()}`
    fs.writeFileSync(tmpFile, prefix + records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
    fs.renameSync(tmpFile, this.memPath)
    this.store = createMemoryStore(this.memPath)
  }

  private persistMemory(input: SaveInput, ctx: SaveContext): SaveResult {
    const memory = createNewMemory(input, ctx, this.scope)
    this.store.append(memory)
    if (shouldAutoEmbed(memory, this.config.semantic, this.embProvider)) {
      this._embedMemory(memory).catch(() => { /* swallowed */ })
    }
    return { status: "saved", memory }
  }

  /** Save a memory. Returns SaveResult. */
  save(input: SaveInput): SaveResult {
    const text = input.text.trim()
    if (!text) return { status: "skipped", reason: "empty" }
    if (containsLikelySecret(text)) return { status: "skipped", reason: "secret" }
    validateSaveInput(input)

    const ctx = saveContext(input, text, this.scope)
    const dup = findDuplicateMemory(this.store.list(), ctx.text, ctx.category, ctx.scopeType, this.scope?.key)
    return this.withMirrorWarnings(dup ? this.upgradePendingDuplicate(dup, input, ctx) : this.persistMemory(input, ctx))
  }

  /** Queue a memory suggestion. Defaults to pending, but can auto-approve for explicit user requests. */
  suggest(text: string, category?: MemoryCategory, scopeType?: MemoryScopeType, kind?: MemoryKind, status?: MemoryStatus): SaveResult {
    const nextStatus = status ?? "pending"
    if (nextStatus === "pending" && isMetaTaskPromptText(text)) return { status: "skipped", reason: "meta task prompt" }
    return this.save({ text, category, scopeType, source: "user-suggested", status: nextStatus, kind })
  }

  /** Approve a pending memory by id. Returns the updated memory plus mirror warnings, or undefined. */
  approve(id: string): MemoryMutationResult | undefined {
    const mem = this.store.list().find((m) => m.id === id && m.status !== "deleted")
    if (!mem) return undefined
    const updated = clone(mem, { status: "approved" })
    this.store.append(updated)
    this.invalidateEmbedding(id, "updated")
    return this.mutationResultWithMirrorWarnings(updated)
  }

  private buildUpdatePreview(id: string, patch: UpdateInput): UpdatePreview | undefined {
    const mem = this.store.list().find((m) => m.id === id && (m.status === "approved" || m.status === "pending"))
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

  previewUpdate(id: string, patch: UpdateInput): UpdatePreview | undefined {
    return this.buildUpdatePreview(id, patch)
  }

  /** Update an active approved or pending memory by id. Returns the updated memory plus mirror warnings, or undefined. */
  update(id: string, patch: UpdateInput): MemoryMutationResult | undefined {
    const preview = this.buildUpdatePreview(id, patch)
    if (!preview) return undefined
    const updated = preview.proposed
    this.store.append(updated)
    this.invalidateEmbedding(id, "updated")
    if (shouldAutoEmbed(updated, this.config.semantic, this.embProvider)) {
      this._embedMemory(updated).catch(() => { /* swallowed */ })
    }
    return this.mutationResultWithMirrorWarnings(updated)
  }

  private requireApprovedMemory(id: string, label: "Successor" | "Old"): MemoryRecord {
    const memory = this.store.list().find((m) => m.id === id && m.status !== "deleted" && m.status !== "rejected")
    if (!memory) throw new Error(`${label} memory not found: ${id}`)
    if (memory.status !== "approved") throw new Error(`${label} must be approved: ${id}`)
    return memory
  }

  private validateOldIds(newId: string | undefined, oldIds: string[]): void {
    if (!oldIds.length) throw new Error("At least one old memory id is required")
    if (new Set(oldIds).size !== oldIds.length) throw new Error("Old memory ids must be unique")
    if (newId !== undefined && oldIds.includes(newId)) throw new Error("A memory cannot supersede itself")
  }

  private buildSupersedePreview(
    newId: string,
    oldIds: string[],
    opts?: { reason?: string; revisedBy?: MemoryRevisionActor; dryRun?: boolean },
  ): SupersedeResult {
    this.validateOldIds(newId, oldIds)
    validateRevisionOptions(opts ?? {})

    const successor = this.requireApprovedMemory(newId, "Successor")
    const oldRecords = oldIds.map((id) => this.requireApprovedMemory(id, "Old"))
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

  supersede(
    newId: string,
    oldIds: string[],
    opts?: { reason?: string; revisedBy?: MemoryRevisionActor; dryRun?: boolean },
  ): SupersedeResult {
    const preview = this.buildSupersedePreview(newId, oldIds, opts)
    if (opts?.dryRun) return preview

    this.appendMemoryRecords([preview.successor, ...preview.superseded])
    this.invalidateEmbedding(preview.successor.id, "updated")
    for (const memory of preview.superseded) {
      this.invalidateEmbedding(memory.id, "updated")
    }
    const mirrorWarnings = this.syncMirrorAndCollectWarnings()
    return mirrorWarnings.length ? { ...preview, mirrorWarnings } : preview
  }

  replace(oldIds: string[], input: {
    text: string
    category?: MemoryCategory
    kind?: MemoryKind
    status?: Extract<MemoryStatus, "pending" | "approved">
    reason?: string
    revisedBy?: MemoryRevisionActor
    dryRun?: boolean
  }): ReplaceResult {
    this.validateOldIds(undefined, oldIds)
    validateRevisionOptions(input)
    validateSaveInput({ text: input.text, category: input.category, kind: input.kind, status: input.status ?? "approved" })
    if (input.status !== undefined && input.status !== "pending" && input.status !== "approved") {
      throw new Error(`Invalid status: ${displayValue(input.status)}. Expected one of: pending, approved`)
    }

    const oldRecords = oldIds.map((id) => this.requireApprovedMemory(id, "Old"))
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
    if (shouldAutoEmbed(successor, this.config.semantic, this.embProvider)) {
      this._embedMemory(successor).catch(() => { /* swallowed */ })
    }
    for (const memory of superseded) {
      this.invalidateEmbedding(memory.id, "updated")
    }
    const mirrorWarnings = this.syncMirrorAndCollectWarnings()
    return mirrorWarnings.length ? { ...result, mirrorWarnings } : result
  }

  /** Reject a memory by id. Returns the updated memory plus mirror warnings, or undefined. */
  reject(id: string): MemoryMutationResult | undefined {
    const mem = this.store.list().find((m) => m.id === id && m.status !== "deleted")
    if (!mem) return undefined
    const updated = clone(mem, { status: "rejected" })
    this.store.append(updated)
    this.invalidateEmbedding(id, "deleted")
    return this.mutationResultWithMirrorWarnings(updated)
  }

  /** Soft-delete a memory by id. Returns the deleted memory plus mirror warnings, or undefined. */
  delete(id: string): MemoryMutationResult | undefined {
    const mem = this.store.list().find((m) => m.id === id && m.status !== "deleted")
    if (!mem) return undefined
    const updated = clone(mem, { status: "deleted" })
    this.store.append(updated)
    this.invalidateEmbedding(id, "deleted")
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
    const all = this.store.list()
    const scopeKey = this.scope?.key ?? ""
    const opts = typeof arg === "object" ? arg : { status: arg }
    const visible = opts?.all ? all : all.filter((m) => visibleInScope(m, scopeKey))
    if (!opts?.status) return visible
    return visible.filter((m) => m.status === opts.status)
  }

  /** Search memories by text query within the current project scope. */
  search(query: string): MemoryRecord[] {
    return searchMemories(this.store.list(), query, this.scope?.key ?? "")
  }

  /** List pending memories for review. */
  reviewPending(): MemoryRecord[] {
    return this.store.list().filter((m) => m.status === "pending")
  }

  private invalidateEmbedding(memoryId: string, reason: "updated" | "deleted" | "stale"): void {
    const embStore = createEmbeddingStore(this.embPath)
    const invalidation: import("./types.js").EmbeddingInvalidationRecord = {
      type: "invalidation",
      memoryId,
      invalidatedAt: new Date().toISOString(),
      reason,
    }
    embStore.append(invalidation)
  }

  // ── Phase 2: Semantic Retrieval ────────────────────────────

  async recall(query: string, options?: RecallOptions): Promise<RecallResult> {
    const config = this.config.semantic
    const scope = options?.projectScope ?? this.scope
    const projectKey = scope?.key ?? ""

    const embStore = createEmbeddingStore(this.embPath)
    return retrieveSemanticMemories(
      this.store.list(),
      embStore.listEmbeddings(),
      embStore.listInvalidations(),
      query,
      projectKey,
      config,
      this.embProvider,
    )
  }

  compact(): CompactReport {
    return compactStores(this.memPath, this.embPath)
  }

  /** Rebuild embeddings for all approved memories. */
  async reindexEmbeddings(opts?: { force?: boolean; signal?: AbortSignal }): Promise<{ embedded: number; skippedExisting: number; skippedSecrets: number }> {
    if (!this.embProvider || !this.config.semantic.enabled) {
      return { embedded: 0, skippedExisting: 0, skippedSecrets: 0 }
    }

    const embStore = createEmbeddingStore(this.embPath)
    const config = this.config.semantic
    const profile = config.embeddings.profiles[config.activeEmbeddingProfile]
    if (!profile) throw new Error("No active embedding profile configured")

    const approved = this.store.list().filter((m) => m.status === "approved")
    const safe = approved.filter((m) => !containsLikelySecret(m.text))
    const safeIds = new Set(safe.map((m) => m.id))

    // Count existing embeddings
    const existing = embStore.listEmbeddings()
    const skippedExisting = existing.filter((e) => safeIds.has(e.memoryId)).length

    const profileName = config.activeEmbeddingProfile
    const model = profile.model
    const skippedSecrets = approved.length - safe.length

    let embedded = 0
    const batchSize = profile.batchSize ?? 16
    for (let i = 0; i < safe.length; i += batchSize) {
      const batch = safe.slice(i, i + batchSize)
      const vectors = await this.embProvider.embed(batch.map((m) => m.text), opts?.signal)
      batch.forEach((memory, index) => {
        embStore.append({
          memoryId: memory.id,
          memoryUpdatedAt: memory.updatedAt,
          contentHash: contentHash(memory.text),
          profileName,
          model,
          dimensions: vectors[index].length,
          vector: vectors[index],
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
      const embeddings = createEmbeddingStore(this.embPath).listEmbeddings()
      const currentKeys = new Set(
        embeddings
          .filter((embedding) => embedding.profileName === profileName && embedding.model === model)
          .map((embedding) => [embedding.memoryId, embedding.contentHash].join("\0")),
      )
      semanticEmbeddedApprovedMemories = approved.filter((memory) => (
        currentKeys.has([memory.id, contentHash(memory.text)].join("\0"))
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

  private contextPolicyDoctor(): Record<string, unknown> {
    const policy = this.config.memory?.contextPolicy
    return {
      contextPolicyMode: policy?.mode ?? "selective",
      contextPolicySessionStartMaxItems: policy?.maxItems?.sessionStart ?? 4,
      contextPolicyPromptMaxItems: policy?.maxItems?.prompt ?? 6,
      contextPolicySessionStartMaxChars: policy?.maxChars?.sessionStart ?? 1600,
      contextPolicyPromptMaxChars: policy?.maxChars?.prompt ?? 3000,
      contextPolicyIncludePending: policy?.includePending ?? false,
      contextPolicyFallbackToSearch: policy?.fallbackToSearch ?? true,
    }
  }

  private memoryFileDoctor(): Record<string, unknown> {
    const diagnostics = this.store.diagnostics()
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

  operatingAgreements(opts?: Omit<OperatingAgreementOptions, "projectScopeKey">): OperatingAgreementList {
    return selectOperatingAgreements(this.store.list(), {
      ...opts,
      projectScopeKey: this.scope?.key,
    })
  }

  operatingAgreementSummary(opts?: Omit<OperatingAgreementOptions, "projectScopeKey">): OperatingAgreementSummary {
    return summarizeOperatingAgreements(this.operatingAgreements(opts))
  }

  freshnessStatus(opts?: { since?: string }): FreshnessStatus {
    return buildFreshnessStatus(this.store.list(), {
      projectScopeKey: this.scope?.key,
      since: opts?.since,
    })
  }

  continuityHints(opts?: { since?: string }): ContinuityHintSummary {
    return buildContinuityHints(this.store.list(), {
      projectScopeKey: this.scope?.key,
      since: opts?.since,
    })
  }

  continuity(opts?: { caller?: "cli" | "mcp" | "lifecycle" | "core" }): ContinuityReadModel {
    return buildContinuityReadModel(this.store.list(), {
      projectScopeKey: this.scope?.key,
      caller: opts?.caller,
    })
  }

  /** Generate a diagnostic report. */
  doctor(opts?: { freshnessSince?: string }): Record<string, unknown> {
    const mems = this.store.list()
    const embStore = createEmbeddingStore(this.embPath)
    const embs = embStore.listEmbeddings()
    const total = mems.length
    const config = this.config.semantic

    return {
      configFile: this.configPath,
      configExists: true,
      semanticEnabled: config.enabled,
      memoryFile: this.memPath,
      embeddingFile: this.embPath,
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
      operatingAgreements: this.operatingAgreementSummary(),
      ...this.semanticDoctor(mems),
      ...this.contextPolicyDoctor(),
      ...this.memoryFileDoctor(),
      ...this.hookDebugDoctor(),
      ...this.obsidianDoctor(),
    }
  }
}
