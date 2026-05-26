// fallow-ignore-file unused-class-member
// MemoryEngine exposes public methods used by the CLI, pi adapter, and package consumers.
import * as path from "node:path"
import * as os from "node:os"
import { createMemoryStore, type MemoryStore } from "./storage.js"
import {
  effectiveMemoryKind, searchMemories, findDuplicateMemory,
} from "./search.js"
import { containsLikelySecret } from "./secret-detection.js"
import { resolveProjectScope } from "./project-scope.js"
import { loadConfig, getDefaultConfigPath } from "./config.js"
import { createEmbeddingStore } from "./embedding-store.js"
import { retrieveSemanticMemories } from "./retrieval.js"
import { compact as compactStores, shouldCompact } from "./compact.js"
import {
  contentHash, createNewMemory, saveContext, shouldAutoEmbed, timestamp, visibleInScope,
  type SaveContext,
} from "./engine-helpers.js"
import type {
  MemoryRecord, MemoryStatus, MemoryCategory, MemoryScopeType,
  MemoryKind, SaveInput, SaveResult, ProjectScope,
  RecallOptions, RecallResult, EmbeddingProvider, CompactReport,
} from "./types.js"

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
  private readonly store: MemoryStore
  private readonly config: ReturnType<typeof loadConfig>
  private scope: ProjectScope | null = null
  private readonly embProvider?: EmbeddingProvider
  private readonly embPath: string
  private readonly memPath: string
  private readonly configPath?: string

  constructor(opts?: {
    memoryPath?: string
    embeddingsPath?: string
    configPath?: string
    embeddingProvider?: EmbeddingProvider
  }) {
    this.memPath = opts?.memoryPath ?? path.join(DEFAULT_DIR, "memory.jsonl")
    this.embPath = opts?.embeddingsPath ?? path.join(DEFAULT_DIR, "embeddings.jsonl")
    this.configPath = opts?.configPath ?? getDefaultConfigPath()
    this.store = createMemoryStore(this.memPath)
    this.config = loadConfig(this.configPath)
    this.embProvider = opts?.embeddingProvider
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

    const ctx = saveContext(input, text, this.scope)
    const dup = findDuplicateMemory(this.store.list(), ctx.text, ctx.category, ctx.scopeType, this.scope?.key)
    return dup ? this.upgradePendingDuplicate(dup, input, ctx) : this.persistMemory(input, ctx)
  }

  /** Queue a memory suggestion. Defaults to pending, but can auto-approve for explicit user requests. */
  suggest(text: string, category?: MemoryCategory, scopeType?: MemoryScopeType, kind?: MemoryKind, status?: MemoryStatus): SaveResult {
    return this.save({ text, category, scopeType, source: "user-suggested", status: status ?? "pending", kind })
  }

  /** Approve a pending memory by id. Returns the updated memory or undefined. */
  approve(id: string): MemoryRecord | undefined {
    const mem = this.store.list().find((m) => m.id === id && m.status !== "deleted")
    if (!mem) return undefined
    const updated = clone(mem, { status: "approved" })
    this.store.append(updated)
    this.invalidateEmbedding(id, "updated")
    return updated
  }

  /** Reject a memory by id. Returns the updated memory or undefined. */
  reject(id: string): MemoryRecord | undefined {
    const mem = this.store.list().find((m) => m.id === id && m.status !== "deleted")
    if (!mem) return undefined
    const updated = clone(mem, { status: "rejected" })
    this.store.append(updated)
    this.invalidateEmbedding(id, "deleted")
    return updated
  }

  /** Soft-delete a memory by id. Returns the deleted memory or undefined. */
  delete(id: string): MemoryRecord | undefined {
    const mem = this.store.list().find((m) => m.id === id && m.status !== "deleted")
    if (!mem) return undefined
    const updated = clone(mem, { status: "deleted" })
    this.store.append(updated)
    this.invalidateEmbedding(id, "deleted")
    return updated
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

  /** Generate a diagnostic report. */
  doctor(): Record<string, unknown> {
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
    }
  }
}
