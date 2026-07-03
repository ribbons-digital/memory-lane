import { createHash, randomBytes } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { compact as compactStores, shouldCompact } from "./compact.js"
import { defaultContinuityBaselinePath } from "./continuity-baseline.js"
import { createEmbeddingStore, foldEmbeddings, type EmbeddingLine, type EmbeddingStore } from "./embedding-store.js"
import { normalizeMemoryRecord } from "./storage-validation.js"
import { ensureProjectLocalStorageFiles, type MemoryPaths } from "./storage-locations.js"
import { createMemoryStore, withFileLocks, type MemoryStore, type MemoryStoreDiagnostics } from "./storage.js"
import type { CompactReport, EmbeddingInvalidationRecord, EmbeddingRecord, LegacyProjectMemoryDiagnostics, LegacyProjectMigrationApplyResult, LegacyProjectMigrationPlan, LegacyProjectMigrationPlanItem, MemoryRecord } from "./types.js"

/**
 * Storage facade used by MemoryEngine.
 * The single-store implementation preserves legacy JSONL paths, while the two-tier implementation merges home and project stores and routes writes by memory origin or scope.
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
  /** Return read-only diagnostics for active current-project memories that still live in the home store. */
  legacyProjectMemoryDiagnostics(projectScopeKey?: string): LegacyProjectMemoryDiagnostics
  createLegacyProjectMigrationPlan(projectScopeKey?: string): LegacyProjectMigrationPlan
  applyLegacyProjectMigrationPlan(plan: LegacyProjectMigrationPlan): LegacyProjectMigrationApplyResult
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

interface LocatedMemoryRecord {
  entry: StoreEntry
  record: MemoryRecord
  logIndex: number
}

interface LocatedEmbeddingRecord {
  entry: StoreEntry
  record: EmbeddingRecord
}

function storePrecedence(entry: StoreEntry): number {
  return entry.name === "project" ? 1 : 0
}

function compareLocatedMemory(a: LocatedMemoryRecord, b: LocatedMemoryRecord): number {
  const updated = a.record.updatedAt.localeCompare(b.record.updatedAt)
  if (updated !== 0) return updated
  const created = a.record.createdAt.localeCompare(b.record.createdAt)
  if (created !== 0) return created
  if (a.entry === b.entry) {
    const log = a.logIndex - b.logIndex
    if (log !== 0) return log
  }
  const store = storePrecedence(a.entry) - storePrecedence(b.entry)
  if (store !== 0) return store
  return a.record.id.localeCompare(b.record.id)
}

function foldMergedMemoryRecords(records: LocatedMemoryRecord[]): MemoryRecord[] {
  const latest = new Map<string, LocatedMemoryRecord>()
  for (const record of records) {
    const existing = latest.get(record.record.id)
    if (!existing || compareLocatedMemory(existing, record) < 0) latest.set(record.record.id, record)
  }
  return Array.from(latest.values()).map((entry) => entry.record).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
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

function writeJsonl(pathname: string, records: unknown[], preservedLines: string[] = []): void {
  fs.mkdirSync(path.dirname(pathname), { recursive: true })
  const tmp = pathname + ".tmp." + randomBytes(4).toString("hex")
  const lines = [...records.map((record) => JSON.stringify(record)), ...preservedLines]
  fs.writeFileSync(tmp, lines.join("\n") + (lines.length ? "\n" : ""), "utf8")
  fs.renameSync(tmp, pathname)
}

function preservedInvalidMemoryLines(pathname: string): string[] {
  if (!existingFile(pathname)) return []
  const preserved: string[] = []
  for (const line of fs.readFileSync(pathname, "utf8").split(/\r?\n/u)) {
    if (!line.trim()) continue
    try {
      if (!normalizeMemoryRecord(JSON.parse(line))) preserved.push(line)
    } catch {
      preserved.push(line)
    }
  }
  return preserved
}

function isValidEmbeddingCompactionLine(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  if (record.type === "invalidation") return typeof record.memoryId === "string"
  return typeof record.memoryId === "string"
    && typeof record.contentHash === "string"
    && typeof record.profileName === "string"
    && typeof record.model === "string"
    && typeof record.createdAt === "string"
    && Array.isArray(record.vector)
}

function preservedInvalidEmbeddingLines(pathname: string): string[] {
  if (!existingFile(pathname)) return []
  const preserved: string[] = []
  for (const line of fs.readFileSync(pathname, "utf8").split(/\r?\n/u)) {
    if (!line.trim()) continue
    try {
      if (!isValidEmbeddingCompactionLine(JSON.parse(line))) preserved.push(line)
    } catch {
      preserved.push(line)
    }
  }
  return preserved
}

function embeddingKey(record: EmbeddingRecord): string {
  return [record.memoryId, record.contentHash, record.profileName, record.model].join("\0")
}

const LEGACY_PROJECT_SAMPLE_LIMIT = 10
const LEGACY_PROJECT_PREVIEW_LIMIT = 160
const MIGRATION_PLAN_VERSION = 1 as const
const MIGRATION_TOMBSTONE_TEXT = "Migrated to project-local storage."
const DEFAULT_MIGRATION_PRODUCER_VERSION = "memory-lane-core"

function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function sourceFingerprint(record: MemoryRecord, sourcePath: string): string {
  return createHash("sha256").update(JSON.stringify({ sourcePath, record }), "utf8").digest("hex")
}

function addMilliseconds(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString()
}

function sameRecordExceptUpdatedAt(a: MemoryRecord, b: MemoryRecord): boolean {
  const strip = (record: MemoryRecord) => {
    const { updatedAt: _updatedAt, ...rest } = record
    return rest
  }
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}

function sameEmbeddingIdentity(a: EmbeddingRecord, b: EmbeddingRecord): boolean {
  return a.memoryId === b.memoryId
    && a.contentHash === b.contentHash
    && a.profileName === b.profileName
    && a.model === b.model
    && a.memoryUpdatedAt === b.memoryUpdatedAt
}

function exactRecord(a: MemoryRecord, b: MemoryRecord): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function compactPreview(text: string, max = LEGACY_PROJECT_PREVIEW_LIMIT): string {
  const normalized = text.replace(/\s+/gu, " ").trim()
  if (normalized.length <= max) return normalized
  return normalized.slice(0, max - 1).trimEnd() + "…"
}

function notApplicableLegacyDiagnostics(homeMemoryFile: string, reason: LegacyProjectMemoryDiagnostics["notApplicableReason"], projectScopeKey?: string, projectMemoryFile?: string): LegacyProjectMemoryDiagnostics {
  return {
    status: "not-applicable",
    notApplicableReason: reason,
    projectScopeKey,
    homeMemoryFile,
    projectMemoryFile,
    totalLegacyCandidateCount: 0,
    approvedLegacyCandidateCount: 0,
    pendingLegacyCandidateCount: 0,
    hazards: {
      duplicateIdInProjectStore: 0,
      homeSideEmbeddings: 0,
      pending: 0,
      mixedOriginRevisionChains: 0,
      mixedOriginRevisionChainsInspected: false,
    },
    samples: [],
    sampleLimit: LEGACY_PROJECT_SAMPLE_LIMIT,
    previewLimit: LEGACY_PROJECT_PREVIEW_LIMIT,
  }
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
export function createSingleStoreEngineStorage(memoryPath: string, embeddingsPath: string, legacyDiagnosticsReason: LegacyProjectMemoryDiagnostics["notApplicableReason"] = "single-store"): MemoryEngineStorage {
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
    legacyProjectMemoryDiagnostics(projectScopeKey) {
      return notApplicableLegacyDiagnostics(memoryPath, legacyDiagnosticsReason, projectScopeKey)
    },
    createLegacyProjectMigrationPlan(projectScopeKey) {
      throw new Error(`Project-local migration is not applicable in ${legacyDiagnosticsReason} mode${projectScopeKey ? ` for ${projectScopeKey}` : ""}.`)
    },
    applyLegacyProjectMigrationPlan() {
      throw new Error(`Project-local migration is not applicable in ${legacyDiagnosticsReason} mode.`)
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

/**
 * Create the default home-plus-project storage facade.
 * New records route to projectPaths when their final project scope key matches projectScopeKey; global-scope and mismatched-project records route to homePaths.
 * Existing ids continue appending to the store that owns the newest active revision, and merged reads fold duplicate ids by updatedAt, createdAt, same-store log order, then project-store precedence.
 */
export function createTwoTierEngineStorage(homePaths: MemoryPaths, projectPaths?: MemoryPaths, projectScopeKey?: string, options: { producerVersion?: string } = {}): MemoryEngineStorage {
  const home = createStoreEntry("home", homePaths)
  const project = projectPaths ? createStoreEntry("project", projectPaths, { scopeKey: projectScopeKey }) : undefined
  const entries = project ? [home, project] : [home]

  function readLog(entry: StoreEntry): MemoryRecord[] {
    return memoryStore(entry)?.readLog() ?? []
  }

  function ownerEntry(memoryId: string): StoreEntry | undefined {
    // JSONL stores are small today; if multi-store batches become large, cache this owner index per appendMany call.
    let owner: LocatedMemoryRecord | undefined
    for (const entry of entries) {
      readLog(entry).forEach((record, logIndex) => {
        if (record.id !== memoryId) return
        const candidate = { entry, record, logIndex }
        if (!owner || compareLocatedMemory(owner, candidate) < 0) owner = candidate
      })
    }
    return owner?.entry
  }

  function routeForNew(record: MemoryRecord): StoreEntry {
    return project && record.scope.type === "project" && Boolean(project.scopeKey) && record.scope.key === project.scopeKey ? project : home
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

  function allLocatedMemoryLogs(): LocatedMemoryRecord[] {
    return entries.flatMap((entry) => readLog(entry).map((record, logIndex) => ({ entry, record, logIndex })))
  }

  function routeForEmbedding(record: EmbeddingLine): StoreEntry {
    return ownerEntry(record.memoryId) ?? home
  }

  function existingEntries(): StoreEntry[] {
    return entries.filter((entry) => existingFile(entry.paths.memoryPath) || existingFile(entry.paths.embeddingsPath))
  }

  function latestLocatedById(): Map<string, LocatedMemoryRecord> {
    const latest = new Map<string, LocatedMemoryRecord>()
    for (const located of allLocatedMemoryLogs()) {
      const existing = latest.get(located.record.id)
      if (!existing || compareLocatedMemory(existing, located) < 0) latest.set(located.record.id, located)
    }
    return latest
  }

  function legacyCandidates(scopeKey: string): LocatedMemoryRecord[] {
    return Array.from(latestLocatedById().values()).filter(({ entry, record }) => {
      if (entry !== home) return false
      if (record.scope.type !== "project" || record.scope.key !== scopeKey) return false
      if (record.status !== "approved" && record.status !== "pending") return false
      if (record.revision?.supersededBy) return false
      return true
    }).sort((a, b) => {
      const updated = b.record.updatedAt.localeCompare(a.record.updatedAt)
      if (updated !== 0) return updated
      return a.record.id.localeCompare(b.record.id)
    })
  }

  function latestCompatibleHomeEmbedding(record: MemoryRecord): EmbeddingRecord | undefined {
    const hash = contentHash(record.text)
    const invalidatedAt = new Map<string, string>()
    const embeddings: EmbeddingRecord[] = []
    for (const line of embeddingStore(home)?.readLog() ?? []) {
      if ((line as EmbeddingInvalidationRecord).type === "invalidation") {
        const invalidation = line as EmbeddingInvalidationRecord
        const previous = invalidatedAt.get(invalidation.memoryId)
        if (!previous || previous < invalidation.invalidatedAt) invalidatedAt.set(invalidation.memoryId, invalidation.invalidatedAt)
      } else {
        embeddings.push(line as EmbeddingRecord)
      }
    }
    return foldEmbeddings(embeddings)
      .filter((embedding) => embedding.memoryId === record.id && embedding.contentHash === hash && embedding.createdAt >= (invalidatedAt.get(record.id) ?? ""))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  }

  function validateMigrationEmbedding(itemId: string, source: MemoryRecord, destination: MemoryRecord, item: LegacyProjectMigrationPlanItem): string[] {
    const blockers: string[] = []
    if (item.embeddingAction !== "copy-compatible" && item.embeddingAction !== "rebuild-needed") blockers.push(`invalid-embedding-action:${itemId}`)
    if (item.embeddingAction === "rebuild-needed") {
      if (item.embeddingRecord !== undefined) blockers.push(`unexpected-embedding-record:${itemId}`)
      return blockers
    }
    const embedding = item.embeddingRecord
    if (!embedding || typeof embedding !== "object") return [...blockers, `invalid-embedding-record:${itemId}`]
    if (embedding.memoryId !== itemId) blockers.push(`embedding-memory-id-mismatch:${itemId}`)
    if (embedding.contentHash !== contentHash(source.text)) blockers.push(`embedding-content-hash-mismatch:${itemId}`)
    if (embedding.memoryUpdatedAt !== destination.updatedAt) blockers.push(`embedding-memory-updated-at-mismatch:${itemId}`)
    if (typeof embedding.profileName !== "string" || !embedding.profileName.trim()) blockers.push(`invalid-embedding-profile:${itemId}`)
    if (typeof embedding.model !== "string" || !embedding.model.trim()) blockers.push(`invalid-embedding-model:${itemId}`)
    if (!Number.isInteger(embedding.dimensions) || embedding.dimensions <= 0) blockers.push(`invalid-embedding-dimensions:${itemId}`)
    if (!Array.isArray(embedding.vector) || embedding.vector.length !== embedding.dimensions || !embedding.vector.every((value) => typeof value === "number" && Number.isFinite(value))) blockers.push(`invalid-embedding-vector:${itemId}`)
    if (typeof embedding.createdAt !== "string" || !embedding.createdAt) blockers.push(`invalid-embedding-created-at:${itemId}`)
    return blockers
  }

  function validateMigrationPlan(plan: LegacyProjectMigrationPlan): string[] {
    const blockers: string[] = []
    if (!plan || typeof plan !== "object") return ["invalid-plan-shape"]
    if (plan.planVersion !== MIGRATION_PLAN_VERSION) blockers.push("invalid-plan-version")
    if (typeof plan.producerVersion !== "string" || !plan.producerVersion.trim()) blockers.push("invalid-producer-version")
    if (plan.projectScopeKey !== project?.scopeKey) blockers.push("project-scope-mismatch")
    if (plan.homeMemoryFile !== home.paths.memoryPath || plan.projectMemoryFile !== project?.paths.memoryPath) blockers.push("storage-path-mismatch")
    if (plan.homeEmbeddingFile !== home.paths.embeddingsPath || plan.projectEmbeddingFile !== project?.paths.embeddingsPath) blockers.push("embedding-path-mismatch")
    if (!Array.isArray(plan.candidates)) {
      blockers.push("invalid-plan-candidates")
      return blockers
    }
    const ids = new Set<string>()
    for (const item of plan.candidates) {
      const itemId = item && typeof item.id === "string" ? item.id : "unknown"
      if (!item || typeof item !== "object") {
        blockers.push(`invalid-plan-item:${itemId}`)
        continue
      }
      if (!Array.isArray(item.blockers)) blockers.push(`invalid-plan-blockers:${itemId}`)
      if (!Array.isArray(item.hazards)) blockers.push(`invalid-plan-hazards:${itemId}`)
      if (ids.has(itemId)) blockers.push(`duplicate-plan-id:${itemId}`)
      ids.add(itemId)
      const source = normalizeMemoryRecord(item.sourceRecord)
      const destination = normalizeMemoryRecord(item.destinationRecord)
      const tombstone = normalizeMemoryRecord(item.sourceTombstone)
      if (!source || !destination || !tombstone) {
        blockers.push(`invalid-plan-record:${itemId}`)
        continue
      }
      if (sourceFingerprint(source, home.paths.memoryPath) !== item.sourceFingerprint) blockers.push(`source-fingerprint-does-not-match-plan-source:${itemId}`)
      if (itemId !== source.id || itemId !== destination.id || itemId !== tombstone.id) blockers.push(`id-mismatch:${itemId}`)
      if (source.scope.type !== "project" || source.scope.key !== plan.projectScopeKey) blockers.push(`source-scope-mismatch:${itemId}`)
      if (destination.scope.type !== "project" || destination.scope.key !== plan.projectScopeKey) blockers.push(`destination-scope-mismatch:${itemId}`)
      if (tombstone.scope.type !== "project" || tombstone.scope.key !== plan.projectScopeKey) blockers.push(`tombstone-scope-mismatch:${itemId}`)
      if (destination.status !== source.status) blockers.push(`destination-status-changed:${itemId}`)
      if (!sameRecordExceptUpdatedAt(source, destination)) blockers.push(`destination-semantic-fields-changed:${itemId}`)
      if (tombstone.status !== "deleted" || tombstone.text !== MIGRATION_TOMBSTONE_TEXT) blockers.push(`invalid-tombstone:${itemId}`)
      if (source.updatedAt >= tombstone.updatedAt || tombstone.updatedAt >= destination.updatedAt) blockers.push(`invalid-migration-timestamp-order:${itemId}`)
      blockers.push(...validateMigrationEmbedding(itemId, source, destination, item))
    }
    return blockers
  }

  function migrationPlan(scopeKey: string): LegacyProjectMigrationPlan {
    if (!project) throw new Error("Project-local migration requires an active project-local destination.")
    const generatedAt = new Date().toISOString()
    const migrationBase = addMilliseconds(generatedAt, 1000)
    const candidates = legacyCandidates(scopeKey)
    const items: LegacyProjectMigrationPlanItem[] = candidates.map((located, index) => {
      const tombstoneAt = addMilliseconds(migrationBase, index * 2)
      const destinationAt = addMilliseconds(migrationBase, index * 2 + 1)
      const blockers: string[] = []
      const hazards: string[] = []
      if (located.record.updatedAt >= tombstoneAt) blockers.push("source-updated-at-not-before-tombstone")
      const projectRecords = readLog(project).filter((record) => record.id === located.record.id)
      const projectLatest = projectRecords.map((record, logIndex) => ({ entry: project, record, logIndex })).sort(compareLocatedMemory).at(-1)?.record
      if (projectLatest && (projectLatest.text !== located.record.text || projectLatest.status !== located.record.status)) blockers.push("duplicate-active-project-record")
      if (projectRecords.length) blockers.push("mixed-origin-revision-chain")
      if (located.record.status === "pending") hazards.push("pending")
      const destinationRecord: MemoryRecord = { ...located.record, updatedAt: destinationAt }
      const sourceTombstone: MemoryRecord = {
        ...located.record,
        status: "deleted",
        text: MIGRATION_TOMBSTONE_TEXT,
        updatedAt: tombstoneAt,
        revision: { revisedAt: tombstoneAt, revisedBy: "cli", reason: "migrated-to-project-local-storage" },
      }
      const embedding = latestCompatibleHomeEmbedding(located.record)
      if (embedding) hazards.push("copy-compatible-embedding")
      else hazards.push("rebuild-needed")
      return {
        id: located.record.id,
        status: located.record.status as "approved" | "pending",
        sourceFingerprint: sourceFingerprint(located.record, home.paths.memoryPath),
        sourceRecord: located.record,
        destinationRecord,
        sourceTombstone,
        embeddingAction: embedding ? "copy-compatible" : "rebuild-needed",
        embeddingRecord: embedding ? { ...embedding, memoryUpdatedAt: destinationAt, createdAt: destinationAt } : undefined,
        blockers,
        hazards,
      }
    })
    return {
      planVersion: MIGRATION_PLAN_VERSION,
      producerVersion: options.producerVersion?.trim() || DEFAULT_MIGRATION_PRODUCER_VERSION,
      generatedAt,
      migrationBase,
      projectScopeKey: scopeKey,
      projectRoot: project.paths.root,
      homeMemoryFile: home.paths.memoryPath,
      homeEmbeddingFile: home.paths.embeddingsPath,
      projectMemoryFile: project.paths.memoryPath,
      projectEmbeddingFile: project.paths.embeddingsPath,
      candidates: items,
      candidateCount: items.length,
      approvedCount: items.filter((item) => item.status === "approved").length,
      pendingCount: items.filter((item) => item.status === "pending").length,
      blockerCount: items.reduce((sum, item) => sum + item.blockers.length, 0),
      embeddingActions: {
        copyCompatible: items.filter((item) => item.embeddingAction === "copy-compatible").length,
        rebuildNeeded: items.filter((item) => item.embeddingAction === "rebuild-needed").length,
      },
    }
  }

  function appendEmbeddingsTo(entry: StoreEntry, records: EmbeddingRecord[]): void {
    for (const record of records) embeddingStore(entry, true)!.append(record)
  }

  function compactMemoryLogs(compactedEntries: StoreEntry[]): { report: CompactReport; aliveById: Map<string, LocatedMemoryRecord> } {
    const totalBefore = compactedEntries.reduce((sum, entry) => sum + readLog(entry).length, 0)
    const latest = new Map<string, LocatedMemoryRecord>()
    for (const located of allLocatedMemoryLogs()) {
      const existing = latest.get(located.record.id)
      if (!existing || compareLocatedMemory(existing, located) < 0) latest.set(located.record.id, located)
    }

    const aliveById = new Map<string, LocatedMemoryRecord>()
    for (const [id, located] of latest) {
      if (located.record.status !== "deleted" && located.record.status !== "rejected") aliveById.set(id, located)
    }

    const grouped = new Map<StoreEntry, MemoryRecord[]>()
    for (const located of Array.from(aliveById.values()).sort((a, b) => a.record.createdAt.localeCompare(b.record.createdAt))) {
      grouped.set(located.entry, [...(grouped.get(located.entry) ?? []), located.record])
    }
    const totalPreserved = Array.from(grouped.values()).reduce((sum, group) => sum + group.length, 0)
    for (const entry of compactedEntries) {
      const group = grouped.get(entry) ?? []
      const preservedLines = preservedInvalidMemoryLines(entry.paths.memoryPath)
      if (existingFile(entry.paths.memoryPath) || group.length) writeJsonl(entry.paths.memoryPath, group, preservedLines)
    }

    return {
      report: { removedMemories: totalBefore - totalPreserved, removedEmbeddings: 0, removedInvalidations: 0 },
      aliveById,
    }
  }

  function compactEmbeddingLogs(compactedEntries: StoreEntry[], aliveById: Map<string, LocatedMemoryRecord>): CompactReport {
    const aliveHashes = new Map<string, string>()
    for (const [id, located] of aliveById) aliveHashes.set(id, createHash("sha256").update(located.record.text, "utf8").digest("hex"))

    const latest = new Map<string, LocatedEmbeddingRecord>()
    let invalidationCount = 0
    let totalBefore = 0
    for (const entry of compactedEntries) {
      for (const line of embeddingStore(entry)?.readLog() ?? []) {
        totalBefore += 1
        if ((line as EmbeddingInvalidationRecord).type === "invalidation") {
          invalidationCount += 1
          continue
        }
        const record = line as EmbeddingRecord
        if (!Array.isArray(record.vector)) continue
        const key = embeddingKey(record)
        const existing = latest.get(key)
        if (!existing || existing.record.createdAt <= record.createdAt) latest.set(key, { entry, record })
      }
    }

    const validByEntry = new Map<StoreEntry, EmbeddingRecord[]>()
    const validEmbeddings = foldEmbeddings(Array.from(latest.values()).map((located) => located.record)).filter((record) => {
      const owner = aliveById.get(record.memoryId)
      return Boolean(owner) && aliveHashes.get(record.memoryId) === record.contentHash
    })
    for (const record of validEmbeddings) {
      const entry = aliveById.get(record.memoryId)!.entry
      validByEntry.set(entry, [...(validByEntry.get(entry) ?? []), record])
    }
    for (const entry of compactedEntries) {
      const group = validByEntry.get(entry) ?? []
      const preservedLines = preservedInvalidEmbeddingLines(entry.paths.embeddingsPath)
      if (existingFile(entry.paths.embeddingsPath) || group.length) writeJsonl(entry.paths.embeddingsPath, group, preservedLines)
    }

    return {
      removedMemories: 0,
      removedEmbeddings: totalBefore - invalidationCount - validEmbeddings.length,
      removedInvalidations: invalidationCount,
    }
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
      return foldMergedMemoryRecords(allLocatedMemoryLogs())
    },
    memoryDiagnostics() {
      return entries.reduce((sum, entry) => addDiagnostics(sum, memoryStore(entry)?.diagnostics() ?? emptyDiagnostics()), emptyDiagnostics())
    },
    appendEmbedding(record) {
      embeddingStore(routeForEmbedding(record), true)!.append(record)
    },
    listEmbeddings() {
      return foldEmbeddings(entries.flatMap((entry) => embeddingStore(entry)?.listEmbeddings() ?? []))
    },
    listEmbeddingInvalidations() {
      return entries.flatMap((entry) => embeddingStore(entry)?.listInvalidations() ?? [])
    },
    legacyProjectMemoryDiagnostics(activeProjectScopeKey) {
      if (!project || !project.scopeKey || !activeProjectScopeKey) {
        return notApplicableLegacyDiagnostics(home.paths.memoryPath, "no-active-project-scope", activeProjectScopeKey, project?.paths.memoryPath)
      }
      const scopeKey = activeProjectScopeKey
      const entriesById = new Map<string, Set<StoreEntry>>()
      for (const located of allLocatedMemoryLogs()) {
        const stores = entriesById.get(located.record.id) ?? new Set<StoreEntry>()
        stores.add(located.entry)
        entriesById.set(located.record.id, stores)
      }
      const duplicateIds = new Set<string>()
      for (const [id, stores] of entriesById) {
        if (stores.has(home) && stores.has(project)) duplicateIds.add(id)
      }
      const homeEmbeddingIds = new Set((embeddingStore(home)?.readLog() ?? [])
        .filter((line): line is EmbeddingRecord => (line as EmbeddingInvalidationRecord).type !== "invalidation" && typeof (line as EmbeddingRecord).memoryId === "string")
        .map((line) => line.memoryId))
      const candidates = legacyCandidates(scopeKey).map(({ record }) => record)
      const samples = candidates.slice(0, LEGACY_PROJECT_SAMPLE_LIMIT).map((record) => {
        const hazards: string[] = []
        if (duplicateIds.has(record.id)) hazards.push("duplicate-id-in-project-store")
        if (homeEmbeddingIds.has(record.id)) hazards.push("home-side-embeddings")
        if (record.status === "pending") hazards.push("pending")
        // In this read-only slice, a same-id record present in both stores is the observable mixed-origin revision-chain hazard.
        if (duplicateIds.has(record.id)) hazards.push("mixed-origin-revision-chain")
        return {
          id: record.id,
          status: record.status as "approved" | "pending",
          kind: record.kind,
          updatedAt: record.updatedAt,
          preview: compactPreview(record.text),
          hazards,
        }
      })
      return {
        status: "ok",
        projectScopeKey: scopeKey,
        homeMemoryFile: home.paths.memoryPath,
        projectMemoryFile: project.paths.memoryPath,
        totalLegacyCandidateCount: candidates.length,
        approvedLegacyCandidateCount: candidates.filter((record) => record.status === "approved").length,
        pendingLegacyCandidateCount: candidates.filter((record) => record.status === "pending").length,
        hazards: {
          duplicateIdInProjectStore: candidates.filter((record) => duplicateIds.has(record.id)).length,
          homeSideEmbeddings: candidates.filter((record) => homeEmbeddingIds.has(record.id)).length,
          pending: candidates.filter((record) => record.status === "pending").length,
          mixedOriginRevisionChains: candidates.filter((record) => duplicateIds.has(record.id)).length,
          mixedOriginRevisionChainsInspected: true,
        },
        samples,
        sampleLimit: LEGACY_PROJECT_SAMPLE_LIMIT,
        previewLimit: LEGACY_PROJECT_PREVIEW_LIMIT,
      }
    },
    createLegacyProjectMigrationPlan(activeProjectScopeKey) {
      if (!project || !project.scopeKey || !activeProjectScopeKey) throw new Error("Project-local migration requires an active project scope.")
      return migrationPlan(activeProjectScopeKey)
    },
    applyLegacyProjectMigrationPlan(plan) {
      if (!project || !project.scopeKey) throw new Error("Project-local migration requires an active project scope.")
      const planBlockers = validateMigrationPlan(plan)
      if (planBlockers.length) {
        return {
          planVersion: MIGRATION_PLAN_VERSION,
          projectScopeKey: plan && typeof plan === "object" && typeof plan.projectScopeKey === "string" ? plan.projectScopeKey : "unknown",
          migrated: 0,
          repaired: 0,
          completedBeforeRun: 0,
          skipped: 0,
          blocked: planBlockers.length,
          reindexNeeded: 0,
          warnings: ["Migration plan failed validation before any files were changed."],
          items: [{ id: "plan", state: "conflict", action: "blocked", blockers: planBlockers }],
        }
      }

      const items: LegacyProjectMigrationApplyResult["items"] = []
      const plannedDestinationWrites: MemoryRecord[] = []
      const plannedTombstoneWrites: MemoryRecord[] = []
      const plannedEmbeddingWrites: EmbeddingRecord[] = []
      let migrated = 0
      let repaired = 0
      let completedBeforeRun = 0
      let reindexNeeded = 0
      const warnings: string[] = []

      for (const item of plan.candidates) {
        const blockers = [...item.blockers]
        const projectLog = readLog(project).filter((record) => record.id === item.id)
        const homeLog = readLog(home).filter((record) => record.id === item.id)
        const hasPlannedDestination = projectLog.some((record) => exactRecord(record, item.destinationRecord))
        const hasPlannedTombstone = homeLog.some((record) => exactRecord(record, item.sourceTombstone))
        const hasHomeRecord = homeLog.length > 0
        const locatedHomeLog = homeLog.map((record, logIndex) => ({ entry: home, record, logIndex }))
        const latestHomeLocated = locatedHomeLog.sort(compareLocatedMemory).at(-1)
        const latestHome = latestHomeLocated?.record
        const plannedTombstoneLocated = locatedHomeLog.find((located) => exactRecord(located.record, item.sourceTombstone))
        const hasNewerHomeWinnerAfterTombstone = Boolean(plannedTombstoneLocated && latestHomeLocated && !exactRecord(latestHomeLocated.record, item.sourceTombstone) && compareLocatedMemory(plannedTombstoneLocated, latestHomeLocated) < 0)
        const projectConflict = projectLog.some((record) => !exactRecord(record, item.destinationRecord) && (record.text !== item.sourceRecord.text || record.status !== item.sourceRecord.status))
        const unplannedProjectRecord = projectLog.some((record) => !exactRecord(record, item.destinationRecord))
        if (projectConflict) blockers.push("duplicate-active-project-record")
        else if (unplannedProjectRecord) blockers.push("mixed-origin-revision-chain")
        if (hasNewerHomeWinnerAfterTombstone) blockers.push("source-fingerprint-mismatch")
        let state: LegacyProjectMigrationApplyResult["items"][number]["state"]
        if (hasNewerHomeWinnerAfterTombstone) {
          state = "conflict"
        } else if (hasPlannedDestination && (hasPlannedTombstone || !hasHomeRecord)) {
          state = "complete"
        } else if (hasPlannedDestination && !hasPlannedTombstone && hasHomeRecord) {
          if (!latestHome) blockers.push("missing-source-home-record")
          else if (sourceFingerprint(latestHome, home.paths.memoryPath) !== item.sourceFingerprint) blockers.push("source-fingerprint-mismatch")
          state = blockers.length ? "conflict" : "destination-written"
        } else if (!hasPlannedDestination && !hasPlannedTombstone) {
          if (!latestHome) blockers.push("missing-source-home-record")
          else if (sourceFingerprint(latestHome, home.paths.memoryPath) !== item.sourceFingerprint) blockers.push("source-fingerprint-mismatch")
          state = blockers.length ? "conflict" : "not-started"
        } else {
          state = "conflict"
        }
        if (state === "conflict" && !blockers.length) blockers.push("current-state-differs-from-plan")
        const action = blockers.length ? "blocked"
          : state === "not-started" ? "migrate"
          : state === "destination-written" ? "repair-tombstone"
          : "skip-complete"
        items.push({ id: item.id, state, action, blockers })
        if (blockers.length) continue
        if (state === "not-started") {
          plannedDestinationWrites.push(item.destinationRecord)
          plannedTombstoneWrites.push(item.sourceTombstone)
          if (item.embeddingRecord) plannedEmbeddingWrites.push({ ...item.embeddingRecord, memoryUpdatedAt: item.destinationRecord.updatedAt, createdAt: new Date().toISOString() })
          else reindexNeeded += 1
          migrated += 1
        } else if (state === "destination-written") {
          plannedTombstoneWrites.push(item.sourceTombstone)
          if (item.embeddingRecord) {
            const hasEmbedding = (embeddingStore(project)?.readLog() ?? []).some((line) => (line as EmbeddingInvalidationRecord).type !== "invalidation" && sameEmbeddingIdentity(line as EmbeddingRecord, item.embeddingRecord!))
            if (!hasEmbedding) plannedEmbeddingWrites.push({ ...item.embeddingRecord, memoryUpdatedAt: item.destinationRecord.updatedAt, createdAt: new Date().toISOString() })
          } else reindexNeeded += 1
          repaired += 1
        } else {
          completedBeforeRun += 1
        }
      }

      const blocked = items.filter((item) => item.blockers.length).length
      if (blocked) {
        return { planVersion: MIGRATION_PLAN_VERSION, projectScopeKey: plan.projectScopeKey, migrated: 0, repaired: 0, completedBeforeRun, skipped: completedBeforeRun, blocked, reindexNeeded: 0, warnings, items }
      }

      appendTo(project, plannedDestinationWrites)
      appendEmbeddingsTo(project, plannedEmbeddingWrites)
      appendTo(home, plannedTombstoneWrites)
      refresh(home)
      refresh(project)

      const latest = latestLocatedById()
      const failed = plan.candidates.filter((item) => {
        const located = latest.get(item.id)
        return !located || located.entry !== project || !exactRecord(located.record, item.destinationRecord)
      })
      if (failed.length) warnings.push(`Post-write verification failed for: ${failed.map((item) => item.id).join(", ")}`)
      if (reindexNeeded) warnings.push("Some migrated memories need semantic embeddings rebuilt; run memory-lane reindex if semantic recall should be refreshed immediately.")
      return { planVersion: MIGRATION_PLAN_VERSION, projectScopeKey: plan.projectScopeKey, migrated, repaired, completedBeforeRun, skipped: completedBeforeRun, blocked: failed.length, reindexNeeded, warnings, items }
    },
    shouldCompact() {
      return existingEntries().some((entry) => shouldCompact(entry.paths.memoryPath))
    },
    compact() {
      const compactedEntries = existingEntries()
      const paths = compactedEntries.flatMap((entry) => [entry.paths.memoryPath, entry.paths.embeddingsPath])
      let report: CompactReport = { removedMemories: 0, removedEmbeddings: 0, removedInvalidations: 0 }
      withFileLocks(paths, () => {
        const memoryResult = compactMemoryLogs(compactedEntries)
        report = addReports(memoryResult.report, compactEmbeddingLogs(compactedEntries, memoryResult.aliveById))
      })
      for (const entry of compactedEntries) refresh(entry)
      return report
    },
  }
}
