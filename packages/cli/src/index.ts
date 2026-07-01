#!/usr/bin/env node
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { readFile } from "node:fs/promises"
import { MemoryEngine, readRawConfig, writeConfig, getDefaultConfigPath, DEFAULT_CONFIG, loadConfig, createOpenAIEmbeddingProvider, createSingleStoreEngineStorage, createTwoTierEngineStorage, initProjectLocalStorage, isMetaTaskPromptText, resolveEngineStoragePaths, resolveWritableEngineStoragePaths, isWorkflowArea, type MemoryPaths, type EngineStoragePaths, type WorkflowArea } from "@memory-lane/core"
import { runClaudeHookCommand, type ClaudeCommand } from "@memory-lane/claude-adapter"
import { runCodexHookCommand, type CodexCommand } from "@memory-lane/codex-adapter"
import { handleSessionEnd, createOpenAICompatibleProvider } from "@memory-lane/lifecycle"
import { handleMcp } from "./commands/mcp.js"
import { handleInit } from "./commands/init.js"
import { handleUninstall } from "./commands/uninstall.js"
import { handleUpgrade } from "./commands/upgrade.js"
import { discoverObsidianImportFiles, planObsidianImport } from "@memory-lane/obsidian-import"
import { initObsidianMirror, statusObsidianMirror, syncObsidianMirror } from "@memory-lane/obsidian-mirror"
import { loadPlugins } from "@memory-lane/plugin-api"
import type { BundledPluginModule, LoadedPlugin } from "@memory-lane/plugin-api"
import type { SemanticMemoryConfig } from "@memory-lane/core"
import { resolveBundledPlugin } from "./plugins.js"
import {
  formatMemories, formatReviewMemories, formatRecall, formatSaveResult, formatResult, formatMutationResult,
  formatCompact, formatDashboard, formatDoctor, formatFreshnessSummary, formatPreferenceDiagnosticsSummary, formatImportPlan, formatOperatingAgreements, formatContinuityReadModel, formatError, formatMemoryGet, formatUpdatePreview, formatRescopeResult, formatSupersedeResult, formatReplaceResult, usage,
  type ObsidianImportApplyResult,
} from "./formatters.js"

// ── Config helpers ───────────────────────────────────────────

function deepMergeConfig(base: unknown, override: unknown): unknown {
  const isPlain = (v: any) => typeof v === "object" && v !== null && !Array.isArray(v)
  if (override === null || override === undefined || !isPlain(override)) return override ?? base
  const result: Record<string, unknown> = isPlain(base) ? { ...(base as Record<string, unknown>) } : {}
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (["__proto__", "constructor", "prototype"].includes(k)) continue
    result[k] = deepMergeConfig(k in result ? result[k] : undefined, v)
  }
  return result
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".")
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== "object") current[parts[i]] = {}
    current = current[parts[i]] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

function parseConfigValue(raw: string): unknown {
  if (raw === "true") return true
  if (raw === "false") return false
  if (raw === "null") return null
  const n = Number(raw)
  if (Number.isFinite(n) && !/[^0-9.e+-]/.test(raw)) return n
  try { return JSON.parse(raw) } catch { /* fall through */ }
  return raw
}

// ── Arg parsing helpers ──────────────────────────────────────

function flag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  const next = argv[idx + 1]
  return next && !next.startsWith("--") ? next : "true"
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`)
}

function optionalWorkflowArea(argv: string[]): WorkflowArea | undefined {
  const value = flag(argv, "area")
  if (!value) return undefined
  if (value === "true" || !isWorkflowArea(value)) {
    throw new Error(`Invalid workflow area: ${value}. Expected one of: project-loop, review-gate, pr-process, release-process, tooling-preference, other`)
  }
  return value
}

function optionalNonNegativeInteger(argv: string[], name: string): number | undefined {
  const value = flag(argv, name)
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid --${name}: ${value}. Expected a non-negative integer.`)
  }
  return parsed
}

function optionalPositiveInteger(argv: string[], name: string): number | undefined {
  const value = flag(argv, name)
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid --${name}: ${value}. Expected a positive integer.`)
  }
  return parsed
}

function optionalStringFlag(argv: string[], name: string): string | undefined {
  const value = flag(argv, name)
  if (!value) return undefined
  if (value === "true") {
    throw new Error(`Invalid --${name}: missing value. Expected an ISO timestamp.`)
  }
  return value
}

function optionalFreshness(argv: string[]) {
  const expiresAt = optionalStringFlag(argv, "expires-at")
  const capturedAt = optionalStringFlag(argv, "captured-at")
  const staleAfterDays = optionalPositiveInteger(argv, "stale-after-days")
  const freshness = {
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(capturedAt !== undefined ? { capturedAt } : {}),
    ...(staleAfterDays !== undefined ? { staleAfterDays } : {}),
  }
  return Object.keys(freshness).length ? freshness : undefined
}

// Strip flags (--foo and --foo value) from argv, return positional args
function positionals(argv: string[]): string[] {
  const result: string[] = []
  let i = 0
  while (i < argv.length) {
    if (argv[i].startsWith("--")) {
      const next = argv[i + 1]
      if (next && !next.startsWith("--")) i += 2
      else i++
    } else {
      result.push(argv[i])
      i++
    }
  }
  return result
}

// ── Runtime context ──────────────────────────────────────────

type EmbeddingProvider = ReturnType<typeof createOpenAIEmbeddingProvider>

interface CliContext {
  argv: string[]
  rest: string[]
  json: boolean
  configPath: string
  engine: MemoryEngine
}

function resolveConfigPath(): string {
  return process.env.MEMORY_LANE_CONFIG || getDefaultConfigPath()
}

function isInitialized(): boolean {
  try {
    return fs.existsSync(path.join(os.homedir(), ".memory-lane", "install.json"))
  } catch {
    return false
  }
}

function printInitPrompt(json: boolean): void {
  if (json || isInitialized()) return
  console.log("\nMemory Lane is installed but not initialized.")
  console.log("Run 'memory-lane init' to configure harnesses,")
  console.log("or 'memory-lane init --yes' to auto-configure detected ones.")
}

function createEmbeddingProvider(configPath: string): EmbeddingProvider | undefined {
  try {
    const cfg = loadConfig(configPath)
    if (!cfg.semantic.enabled) return undefined
    const profile = cfg.semantic.embeddings.profiles[cfg.semantic.activeEmbeddingProfile]
    return profile ? createOpenAIEmbeddingProvider(profile) : undefined
  } catch {
    return undefined
  }
}

function createEngine(paths: MemoryPaths | EngineStoragePaths, projPath?: string): MemoryEngine {
  const storage = "explicitEnv" in paths
    ? paths.kind === "default-two-tier"
      ? createTwoTierEngineStorage(paths.home, paths.project, paths.projectScopeKey)
      : createSingleStoreEngineStorage(paths.home.memoryPath, paths.home.embeddingsPath)
    : createSingleStoreEngineStorage(paths.memoryPath, paths.embeddingsPath)
  const configPath = paths.configPath
  const engine = new MemoryEngine({
    memoryPath: "explicitEnv" in paths ? paths.home.memoryPath : paths.memoryPath,
    embeddingsPath: "explicitEnv" in paths ? paths.home.embeddingsPath : paths.embeddingsPath,
    storage,
    configPath,
    embeddingProvider: createEmbeddingProvider(configPath),
  })
  engine.refreshScope(projPath ?? process.cwd())
  return engine
}

function requireText(ctx: CliContext, message: string): string {
  const text = ctx.rest.join(" ")
  if (!text) {
    console.log(formatError(message, ctx.json))
    process.exit(1)
  }
  return text
}

function requireId(ctx: CliContext, action: string): string {
  const id = ctx.rest[0]
  if (!id) {
    console.log(formatError(`ID required: memory-lane ${action} <id>`, ctx.json))
    process.exit(1)
  }
  return id
}

function optionalTextArg(ctx: CliContext): string | undefined {
  const value = flag(ctx.argv, "text")
  if (value && value !== "true") return value
  return undefined
}

function requireYesForMultiple(ctx: CliContext, ids: string[], action: string): void {
  if (ids.length <= 1 || hasFlag(ctx.argv, "yes") || hasFlag(ctx.argv, "dry-run")) return
  console.log(formatError(`${action} with multiple old memories requires --yes or --dry-run`, ctx.json))
  process.exit(1)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

// ── Command handlers ────────────────────────────────────────

function handleSave(ctx: CliContext): void {
  const text = requireText(ctx, "Text required: memory-lane save <text>")
  const result = ctx.engine.save({
    text,
    scopeType: flag(ctx.argv, "scope") as any,
    category: flag(ctx.argv, "category") as any,
    status: (flag(ctx.argv, "status") as any) ?? "approved",
    freshness: optionalFreshness(ctx.argv),
  })
  console.log(formatSaveResult(result, ctx.json))
}

function handleSuggest(ctx: CliContext): void {
  const text = requireText(ctx, "Text required: memory-lane suggest <text>")
  const result = ctx.engine.suggest(
    text,
    flag(ctx.argv, "category") as any,
    flag(ctx.argv, "scope") as any,
    undefined,
    flag(ctx.argv, "status") as any,
    optionalFreshness(ctx.argv),
  )
  console.log(formatSaveResult(result, ctx.json))
}

async function handleRecall(ctx: CliContext): Promise<void> {
  if (hasFlag(ctx.argv, "id")) {
    console.log(formatError("Unsupported recall flag: --id. Recall is query search; use `memory-lane show <id>` for exact-id lookup.", ctx.json))
    process.exit(1)
  }
  const result = await ctx.engine.recall(ctx.rest.join(" "))
  console.log(formatRecall(result, ctx.json))
}

function handleShow(ctx: CliContext): void {
  const id = requireId(ctx, "show")
  const all = hasFlag(ctx.argv, "all")
  const memory = ctx.engine.getById(id, { all })
  console.log(formatMemoryGet(id, memory, ctx.json, all))
  if (!memory) process.exit(1)
}

function handleList(ctx: CliContext): void {
  const statusFlag = flag(ctx.argv, "status") as any
  const allScope = hasFlag(ctx.argv, "all")
  const mems = ctx.engine.list({ status: statusFlag, all: allScope })
  console.log(formatMemories(mems, ctx.json, { projectScope: ctx.engine.getProjectScope()?.key ?? "none" }))
}

function handleSearch(ctx: CliContext): void {
  const query = requireText(ctx, "Query required: memory-lane search <query>")
  console.log(formatMemories(ctx.engine.search(query), ctx.json))
}

function handleDelete(ctx: CliContext): void {
  const id = requireId(ctx, "delete")
  const mem = ctx.engine.delete(id)
  if (!mem) {
    console.log(formatError(`Memory not found: ${id}`, ctx.json))
    process.exit(1)
  }
  console.log(formatMutationResult("Deleted", mem, ctx.json))
}

function handleApprove(ctx: CliContext): void {
  const id = requireId(ctx, "approve")
  const mem = ctx.engine.approve(id)
  if (!mem) {
    console.log(formatError(`Memory not found: ${id}`, ctx.json))
    process.exit(1)
  }
  console.log(formatMutationResult("Approved", mem, ctx.json))
}

function handleReject(ctx: CliContext): void {
  const id = requireId(ctx, "reject")
  const mem = ctx.engine.reject(id)
  if (!mem) {
    console.log(formatError(`Memory not found: ${id}`, ctx.json))
    process.exit(1)
  }
  console.log(formatMutationResult("Rejected", mem, ctx.json))
}

function handleRescope(ctx: CliContext): void {
  const id = requireId(ctx, "rescope")
  const scopeType = flag(ctx.argv, "scope")
  if (scopeType !== "global" && scopeType !== "project") {
    console.log(formatError("Usage: memory-lane rescope <id> --scope global|project [--project <path>] [--dry-run|--yes]", ctx.json))
    process.exit(1)
  }
  if (!hasFlag(ctx.argv, "dry-run") && !hasFlag(ctx.argv, "yes")) {
    console.log(formatError("rescope requires --yes or --dry-run", ctx.json))
    process.exit(1)
  }
  const result = hasFlag(ctx.argv, "dry-run")
    ? ctx.engine.previewRescope(id, { scopeType: scopeType as any, projectPath: flag(ctx.argv, "project"), dryRun: true })
    : ctx.engine.rescope(id, { scopeType: scopeType as any, projectPath: flag(ctx.argv, "project") })
  if (!result) {
    console.log(formatError(`Memory not found: ${id}`, ctx.json))
    process.exit(1)
  }
  console.log(formatRescopeResult(result, ctx.json))
}

async function handleUpdate(ctx: CliContext): Promise<void> {
  const id = requireId(ctx, "update")
  const fromStdin = hasFlag(ctx.argv, "stdin")
  const textFromFlag = optionalTextArg(ctx)
  const text = fromStdin ? await readStdin() : textFromFlag
  const category = flag(ctx.argv, "category")
  const kind = flag(ctx.argv, "kind")
  const status = flag(ctx.argv, "status")
  const reason = flag(ctx.argv, "reason")
  const patch = {
    ...(text !== undefined ? { text } : {}),
    ...(category ? { category: category as any } : {}),
    ...(kind ? { kind: kind as any } : {}),
    ...(status ? { status: status as any } : {}),
    ...(reason ? { reason } : {}),
    revisedBy: "cli" as const,
  }
  const hasPatch = text !== undefined || Boolean(category) || Boolean(kind) || Boolean(status)
  if (!hasPatch) {
    console.log(formatError("At least one update field is required: --text/--stdin, --category, --kind, or --status", ctx.json))
    process.exit(1)
  }
  if (hasFlag(ctx.argv, "dry-run")) {
    const preview = ctx.engine.previewUpdate(id, patch)
    if (!preview) {
      console.log(formatError(`Memory not found: ${id}`, ctx.json))
      process.exit(1)
    }
    console.log(formatUpdatePreview(preview, ctx.json))
    return
  }
  const mem = ctx.engine.update(id, patch)
  if (!mem) {
    console.log(formatError(`Memory not found: ${id}`, ctx.json))
    process.exit(1)
  }
  console.log(formatMutationResult("Updated", mem, ctx.json))
}

function handleSupersede(ctx: CliContext): void {
  const [newId, ...oldIds] = ctx.rest
  if (!newId || !oldIds.length) {
    console.log(formatError("Usage: memory-lane supersede <new-id> <old-id...>", ctx.json))
    process.exit(1)
  }
  requireYesForMultiple(ctx, oldIds, "supersede")
  const result = ctx.engine.supersede(newId, oldIds, {
    reason: flag(ctx.argv, "reason"),
    revisedBy: "cli",
    dryRun: hasFlag(ctx.argv, "dry-run"),
  })
  console.log(formatSupersedeResult(result, ctx.json))
}

async function handleReplace(ctx: CliContext): Promise<void> {
  const oldIds = ctx.rest
  if (!oldIds.length) {
    console.log(formatError("Usage: memory-lane replace <old-id...> --text <text>|--stdin", ctx.json))
    process.exit(1)
  }
  requireYesForMultiple(ctx, oldIds, "replace")
  const fromStdin = hasFlag(ctx.argv, "stdin")
  const textFromFlag = optionalTextArg(ctx)
  const text = fromStdin ? await readStdin() : textFromFlag
  if (text === undefined) {
    console.log(formatError("Replacement text required: use --text <text> or --stdin", ctx.json))
    process.exit(1)
  }
  const result = ctx.engine.replace(oldIds, {
    text,
    category: flag(ctx.argv, "category") as any,
    kind: flag(ctx.argv, "kind") as any,
    status: flag(ctx.argv, "status") as any,
    reason: flag(ctx.argv, "reason"),
    revisedBy: "cli",
    dryRun: hasFlag(ctx.argv, "dry-run"),
  })
  console.log(formatReplaceResult(result, ctx.json))
}

function handleReview(ctx: CliContext): void {
  const suspectMeta = hasFlag(ctx.argv, "suspect-meta")
  const includeApproved = suspectMeta && hasFlag(ctx.argv, "include-approved")
  const filters = {
    kind: flag(ctx.argv, "kind"),
    source: flag(ctx.argv, "source"),
    provenance: flag(ctx.argv, "provenance"),
  }
  const reviewMemories = includeApproved
    ? [...ctx.engine.reviewPending(), ...ctx.engine.list({ status: "approved", all: true })]
    : ctx.engine.reviewPending()
  const memories = reviewMemories.filter((memory) => {
    if (suspectMeta && !isMetaTaskPromptText(memory.text)) return false
    if (filters.kind && (memory.kind ?? "misc") !== filters.kind) return false
    if (filters.source && memory.source !== filters.source) return false
    if (filters.provenance) {
      const provenance = memory.provenance ? `${memory.provenance.adapter}/${memory.provenance.lifecycleEvent}` : "none"
      if (provenance !== filters.provenance) return false
    }
    return true
  })
  const activeFilters = Object.fromEntries(Object.entries(filters).filter(([, value]) => Boolean(value)))
  console.log(formatReviewMemories(memories, ctx.json, {
    suspectMeta,
    includeApproved,
    filters: activeFilters,
    projectScope: ctx.engine.getProjectScope()?.key ?? "none",
  }))
}

function handleDashboard(ctx: CliContext): void {
  const allScope = hasFlag(ctx.argv, "all")
  const memories = ctx.engine.list({ all: allScope })
  console.log(formatDashboard(memories, ctx.json, { all: allScope, projectScope: ctx.engine.getProjectScope()?.key ?? "none" }))
}

function handleAgreements(ctx: CliContext): void {
  const result = ctx.engine.operatingAgreements({
    all: hasFlag(ctx.argv, "all"),
    area: optionalWorkflowArea(ctx.argv),
    limit: optionalNonNegativeInteger(ctx.argv, "limit"),
    relatedLimit: optionalNonNegativeInteger(ctx.argv, "related-limit"),
  })
  console.log(formatOperatingAgreements(result, ctx.json))
}

function handleContinuity(ctx: CliContext): void {
  const query = flag(ctx.argv, "query")
  if (query === "true") throw new Error("Missing value for --query")
  console.log(formatContinuityReadModel(ctx.engine.continuity({ caller: "cli", query }), ctx.json, { projectScope: ctx.engine.getProjectScope()?.key ?? "none" }))
}

function handleCompact(ctx: CliContext): void {
  console.log(formatCompact(ctx.engine.compact(), ctx.json))
}

function handleDoctor(ctx: CliContext): void {
  const since = flag(ctx.argv, "since")
  console.log(formatDoctor(ctx.engine.doctor({ freshnessSince: since }), ctx.json))
  printInitPrompt(ctx.json)
}

function handleStatus(ctx: CliContext): void {
  const since = flag(ctx.argv, "since")
  const report = ctx.engine.doctor({ freshnessSince: since })
  if (ctx.json) {
    console.log(formatDoctor(report, true))
    return
  }
  const r = report as any
  const lines = [`Total: ${r.totalMemories}, Approved: ${r.approvedMemories}, Pending: ${r.pendingMemories}, Embeddings: ${r.embeddingCount}`]
  lines.push(...formatPreferenceDiagnosticsSummary(r.preferenceDiagnostics, report))
  if (since) {
    const freshnessSummary = formatFreshnessSummary(r.freshness)
    if (freshnessSummary) lines.push(freshnessSummary)
  }
  console.log(lines.join("\n"))
}

function createSummaryProvider(config: ReturnType<typeof loadConfig>):
  | { provider: ReturnType<typeof createOpenAICompatibleProvider>; config: NonNullable<NonNullable<ReturnType<typeof loadConfig>["memory"]>["sessionEndSummary"]> }
  | undefined {
  const summaryConfig = config.memory?.sessionEndSummary
  if (!summaryConfig?.enabled) return undefined
  if (!summaryConfig.baseUrl || !summaryConfig.model) return undefined
  return {
    provider: createOpenAICompatibleProvider({
      provider: "openai-compatible",
      baseUrl: summaryConfig.baseUrl,
      apiKeyEnv: summaryConfig.apiKeyEnv,
      model: summaryConfig.model,
    }),
    config: summaryConfig,
  }
}

async function handleSessionEndCommand(ctx: CliContext): Promise<void> {
  const cfg = loadConfig(ctx.configPath)
  const summaryConfig = cfg.memory?.sessionEndSummary
  if (!summaryConfig?.enabled) {
    console.log(formatError("Session-end summarization is not enabled. Set memory.sessionEndSummary.enabled in config.", ctx.json))
    process.exit(1)
  }
  if (!summaryConfig.baseUrl || !summaryConfig.model) {
    console.log(formatError("Session-end summarization requires memory.sessionEndSummary.baseUrl and model.", ctx.json))
    process.exit(1)
  }
  const confirmed = hasFlag(ctx.argv, "confirm")
  if (summaryConfig.requireConfirmation && !confirmed) {
    console.log(formatError("Session-end summarization requires confirmation. Run with --confirm or configure requireConfirmation: false.", ctx.json))
    process.exit(1)
  }

  const payloadText = await readStdin()
  let payload: { messages?: Array<{ role: string; content: string; timestamp?: string; toolName?: string }>; sessionId?: string }
  try {
    payload = JSON.parse(payloadText)
  } catch {
    console.log(formatError("Invalid JSON on stdin. Expected { messages: [...], sessionId? }", ctx.json))
    process.exit(2)
  }
  if (!Array.isArray(payload.messages)) {
    console.log(formatError("Missing messages array in stdin payload.", ctx.json))
    process.exit(2)
  }

  const provider = createSummaryProvider(cfg)
  if (!provider) {
    console.log(formatError("Failed to create summary provider.", ctx.json))
    process.exit(1)
  }

  const candidates = await handleSessionEnd(ctx.engine, {
    cwd: process.cwd(),
    sessionId: payload.sessionId,
    messages: payload.messages.map((m) => ({
      role: m.role === "user" || m.role === "assistant" || m.role === "tool" ? m.role : "user",
      content: m.content,
      timestamp: m.timestamp,
      toolName: m.toolName,
    })),
  }, {
    provider: provider.provider,
    promptTemplate: provider.config.promptTemplate ?? undefined,
    maxTokens: provider.config.maxTokens,
    requireConfirmation: false,
    includeToolOutputs: provider.config.includeToolOutputs,
  })

  if (candidates.length === 0) {
    console.log(ctx.json ? JSON.stringify({ ok: true, saved: false, reason: "no durable memory" }) : "No durable session memory generated.")
    return
  }

  const candidate = candidates[0]
  const saved = ctx.engine.save({
    text: candidate.text,
    category: candidate.category,
    scopeType: candidate.scopeType,
    status: candidate.status,
    source: candidate.source,
    kind: candidate.kind,
    provenance: candidate.provenance,
    freshness: candidate.freshness,
  })

  console.log(formatSaveResult(saved, ctx.json))
}

function handleInitCommand(argv: string[], json: boolean): void {
  if (!hasFlag(argv, "project-local")) {
    console.log(formatError("Usage: memory-lane init --project-local [--project <path>]", json))
    process.exit(2)
  }
  const result = initProjectLocalStorage(flag(argv, "project") ?? process.cwd())
  if (json) {
    console.log(JSON.stringify({ ok: true, data: result }, null, 2))
    return
  }
  console.log([
    `Initialized project-local Memory Lane storage at ${result.paths.root}`,
    "",
    "Use these environment variables for sandboxed hooks if needed:",
    `MEMORY_LANE_FILE=${result.env.MEMORY_LANE_FILE}`,
    `MEMORY_LANE_EMBEDDINGS_FILE=${result.env.MEMORY_LANE_EMBEDDINGS_FILE}`,
    `MEMORY_LANE_CONFIG=${result.env.MEMORY_LANE_CONFIG}`,
  ].join("\n"))
}

async function handleReindex(ctx: CliContext): Promise<void> {
  const result = await ctx.engine.reindexEmbeddings({ force: hasFlag(ctx.argv, "force") })
  if (ctx.json) {
    console.log(JSON.stringify({ ok: true, data: result }, null, 2))
  } else {
    console.log(`Reindexed: ${result.embedded} embedded, ${result.skippedExisting} skipped (existing), ${result.skippedSecrets} skipped (secrets)`)
  }
}

function showConfig(ctx: CliContext): void {
  const raw = readRawConfig(ctx.configPath)
  if (!raw) {
    console.log(formatError("No config file found.", ctx.json))
    return
  }
  if (ctx.json) console.log(JSON.stringify(raw, null, 2))
  else console.log(`Config: ${getDefaultConfigPath()}\n` + JSON.stringify(raw, null, 2))
}

function setSemanticEnabled(ctx: CliContext, enabled: boolean): void {
  writeConfig(ctx.configPath, { semantic: { enabled } as any })
  if (ctx.json) {
    console.log(JSON.stringify({ ok: true, semantic: { enabled } }))
  } else {
    console.log(enabled ? "Semantic search enabled. Run 'memory-lane reindex' to build embeddings." : "Semantic search disabled.")
  }
}

function setConfigValue(ctx: CliContext): void {
  const key = ctx.rest[1]
  const value = ctx.rest.slice(2).join(" ")
  if (!key) {
    console.log(formatError("Usage: memory-lane config set <json-path> <value>", ctx.json))
    return
  }
  const existing = (readRawConfig(ctx.configPath) as Record<string, unknown>) || {}
  const merged = deepMergeConfig(DEFAULT_CONFIG, existing) as Record<string, unknown>
  setByPath(merged, key, parseConfigValue(value))
  writeConfig(ctx.configPath, merged as any)
  console.log(ctx.json ? JSON.stringify({ ok: true, path: key }) : `Set ${key}`)
}

function expandHome(input: string): string {
  const home = process.env.HOME || os.homedir()
  if (input === "~") return home || input
  if (input.startsWith("~/")) return home ? path.join(home, input.slice(2)) : input
  return input
}

function configuredObsidian(ctx: CliContext): { enabled: boolean; vaultPath?: string; folder?: string; mode?: "mirror" } {
  const raw = readRawConfig(ctx.configPath) as any
  return raw?.obsidian ?? { enabled: false }
}

function obsidianConfigRequiredMessage(): string {
  return "Obsidian mirror is not configured. Run `memory-lane obsidian init --vault <path>`."
}

function importSnapshots(engine: MemoryEngine) {
  return engine.list({ all: true }).map((memory) => ({
    id: memory.id,
    text: memory.text,
    category: memory.category,
    scope: {
      type: memory.scope.type,
      key: memory.scope.key,
    },
    status: memory.status,
    kind: memory.kind,
  }))
}

function importApplyWarning(importPath: string, message: string): string {
  return `${importPath}: ${message}`
}

function applyObsidianImportPlan(ctx: CliContext, plan: ReturnType<typeof planObsidianImport>): ObsidianImportApplyResult {
  const results: ObsidianImportApplyResult["results"] = []

  for (const item of plan.results) {
    if (item.action === "skip") {
      results.push({ path: item.path, action: "skipped", warnings: item.warnings })
      continue
    }

    if (item.action === "create") {
      try {
        const saved = ctx.engine.save({
          text: item.text,
          category: item.category,
          scopeType: item.scope.type,
          status: item.status,
          kind: item.kind,
          source: "manual",
        })
        if (saved.status === "saved") {
          results.push({
            path: item.path,
            action: "created",
            memoryId: saved.memory.id,
            status: saved.memory.status,
            warnings: [...item.warnings, ...(saved.warnings ?? [])],
          })
        } else {
          results.push({
            path: item.path,
            action: "skipped",
            warnings: [...item.warnings, importApplyWarning(item.path, `save skipped: ${saved.reason}`), ...(saved.warnings ?? [])],
          })
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        results.push({ path: item.path, action: "skipped", warnings: [...item.warnings, importApplyWarning(item.path, message)] })
      }
      continue
    }

    try {
      const updated = ctx.engine.update(item.memoryId, {
        text: item.text,
        category: item.category,
        status: item.status,
        kind: item.kind,
      })
      if (updated) {
        results.push({
          path: item.path,
          action: "updated",
          memoryId: updated.id,
          status: updated.status,
          warnings: [...item.warnings, ...(updated.warnings ?? [])],
        })
      } else {
        results.push({
          path: item.path,
          action: "skipped",
          memoryId: item.memoryId,
          warnings: [...item.warnings, importApplyWarning(item.path, "memory update target was not found")],
        })
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({ path: item.path, action: "skipped", memoryId: item.memoryId, warnings: [...item.warnings, importApplyWarning(item.path, message)] })
    }
  }

  return {
    summary: {
      created: results.filter((result) => result.action === "created").length,
      updated: results.filter((result) => result.action === "updated").length,
      skipped: results.filter((result) => result.action === "skipped").length,
    },
    results,
    warnings: results.flatMap((result) => result.warnings),
  }
}

async function handleObsidian(ctx: CliContext): Promise<void> {
  const sub = ctx.rest[0]

  if (sub === "status") {
    const cfg = configuredObsidian(ctx)
    if (!cfg.enabled || !cfg.vaultPath) {
      console.log(ctx.json ? JSON.stringify({ ok: true, data: { enabled: false } }, null, 2) : "Obsidian mirror: disabled")
      return
    }

    const status = statusObsidianMirror({ vaultPath: cfg.vaultPath, folder: cfg.folder })
    if (ctx.json) {
      console.log(JSON.stringify({ ok: status.ok, data: status }, null, 2))
      return
    }
    console.log([
      "Obsidian mirror: enabled",
      `Root: ${status.root}`,
      ...status.warnings.map((warning) => `Warning: ${warning}`),
    ].join("\n"))
    return
  }

  if (sub === "init") {
    const vault = flag(ctx.argv, "vault")
    if (!vault || vault === "true") {
      console.log(formatError("Usage: memory-lane obsidian init --vault <path> [--folder <folder>]", ctx.json))
      process.exit(2)
    }

    const vaultPath = path.resolve(expandHome(vault))
    const folder = flag(ctx.argv, "folder") ?? "Memory Lane"
    const init = initObsidianMirror({ vaultPath, folder })
    if (!init.ok) {
      const message = init.warnings.length ? init.warnings.join("\n") : "Failed to initialize Obsidian mirror."
      console.log(formatError(message, ctx.json))
      process.exit(1)
    }

    writeConfig(ctx.configPath, { obsidian: { enabled: true, vaultPath, folder, mode: "mirror" } } as any)
    const sync = syncObsidianMirror({ vaultPath, folder }, ctx.engine.list({ all: true }))
    if (ctx.json) {
      console.log(JSON.stringify({ ok: sync.ok, data: { init, sync } }, null, 2))
    } else {
      console.log([
        `Configured Obsidian mirror at ${sync.root}`,
        `Synced active memories. Created: ${sync.created}, Updated: ${sync.updated}, Deleted: ${sync.deleted}`,
        ...sync.warnings.map((warning) => `Warning: ${warning}`),
      ].join("\n"))
    }
    if (!sync.ok) process.exit(1)
    return
  }

  if (sub === "sync") {
    const cfg = configuredObsidian(ctx)
    if (!cfg.enabled || !cfg.vaultPath) {
      console.log(formatError(obsidianConfigRequiredMessage(), ctx.json))
      process.exit(1)
    }

    const dryRun = hasFlag(ctx.argv, "dry-run")
    const result = syncObsidianMirror({ vaultPath: cfg.vaultPath, folder: cfg.folder }, ctx.engine.list({ all: true }), { dryRun })
    if (ctx.json) {
      console.log(JSON.stringify({ ok: result.ok, data: result }, null, 2))
    } else {
      console.log([
        dryRun ? "Obsidian mirror dry run:" : "Obsidian mirror synced:",
        `${dryRun ? "Would create" : "Created"}: ${result.created}`,
        `${dryRun ? "Would update" : "Updated"}: ${result.updated}`,
        `${dryRun ? "Would delete" : "Deleted"}: ${result.deleted}`,
        ...result.warnings.map((warning) => `Warning: ${warning}`),
      ].join("\n"))
    }
    if (!result.ok) process.exit(1)
    return
  }

  if (sub === "import") {
    const cfg = configuredObsidian(ctx)
    if (!cfg.enabled || !cfg.vaultPath) {
      console.log(formatError(obsidianConfigRequiredMessage(), ctx.json))
      process.exit(1)
    }

    const dryRun = hasFlag(ctx.argv, "dry-run")
    const importPaths = await discoverObsidianImportFiles({ vaultPath: cfg.vaultPath, folder: cfg.folder })
    const candidates = await Promise.all(importPaths.map(async (importPath) => ({
      path: importPath,
      content: await readFile(path.join(cfg.vaultPath!, importPath), "utf8"),
    })))
    const plan = planObsidianImport({
      candidates,
      existingMemories: importSnapshots(ctx.engine),
      projectScopeKey: ctx.engine.getProjectScope()?.key,
    })
    if (dryRun) {
      console.log(formatImportPlan(plan, ctx.json, true))
      return
    }

    const applied = applyObsidianImportPlan(ctx, plan)
    console.log(formatImportPlan(applied, ctx.json, false))
    return
  }

  console.log(formatError("Usage: memory-lane obsidian init|status|sync|import", ctx.json))
  process.exit(2)
}

const configHandlers: Record<string, (ctx: CliContext) => void> = {
  show: showConfig,
  "enable-semantic": (ctx) => setSemanticEnabled(ctx, true),
  "disable-semantic": (ctx) => setSemanticEnabled(ctx, false),
  set: setConfigValue,
}

function handleConfig(ctx: CliContext): void {
  const subCmd = ctx.rest[0]?.toLowerCase() ?? "show"
  const handler = configHandlers[subCmd]
  if (handler) handler(ctx)
  else console.log(formatError("Usage: memory-lane config [show | enable-semantic | disable-semantic | set <key> <value>]", ctx.json))
}

const claudeHookCommands = new Set<string>(["user-prompt-submit", "stop", "post-tool-use", "session-start", "session-end"])
const codexHookCommands = new Set<string>(["user-prompt-submit", "stop", "post-tool-use", "session-start", "session-end"])

async function handleCodex(ctx: CliContext): Promise<void> {
  const event = ctx.rest[0]
  if (!codexHookCommands.has(event)) {
    console.log(formatError("Unknown Codex hook event. Usage: memory-lane codex user-prompt-submit|stop|post-tool-use|session-start|session-end", ctx.json))
    process.exit(2)
  }
  const payloadText = await readStdin()
  const output = await runCodexHookCommand(event as CodexCommand, {
    engine: ctx.engine,
    payloadText,
    env: process.env,
    configPath: ctx.configPath,
  })
  console.log(output)
}

async function handleClaude(ctx: CliContext): Promise<void> {
  const event = ctx.rest[0]
  if (!claudeHookCommands.has(event)) {
    console.log(formatError("Unknown Claude hook event. Usage: memory-lane claude user-prompt-submit|stop|post-tool-use|session-start|session-end", ctx.json))
    process.exit(2)
  }
  const payloadText = await readStdin()
  const output = await runClaudeHookCommand(event as ClaudeCommand, {
    engine: ctx.engine,
    payloadText,
    env: process.env,
    configPath: ctx.configPath,
  })
  console.log(output)
}

type CommandHandler = (ctx: CliContext) => void | Promise<void>

// These inspection commands must work in read-only desktop/client sandboxes without home-storage write probes.
const readOnlyStorageCommands = new Set(["recall", "list", "search", "review", "dashboard", "agreements", "continuity", "doctor", "status", "show", "get"])
const readOnlyStorageSubcommands: Record<string, Set<string | undefined>> = {
  config: new Set([undefined, "show"]),
  obsidian: new Set([undefined, "status"]),
}

function usesReadOnlyStorageResolution(command: string, argv: string[]): boolean {
  if (readOnlyStorageCommands.has(command)) return true
  const subcommands = readOnlyStorageSubcommands[command]
  if (!subcommands) return false
  return subcommands.has(positionals(argv.slice(1))[0]?.toLowerCase())
}

const commandHandlers: Record<string, CommandHandler> = {
  save: handleSave,
  suggest: handleSuggest,
  recall: handleRecall,
  show: handleShow,
  get: handleShow,
  list: handleList,
  search: handleSearch,
  delete: handleDelete,
  approve: handleApprove,
  reject: handleReject,
  update: handleUpdate,
  rescope: handleRescope,
  move: handleRescope,
  supersede: handleSupersede,
  replace: handleReplace,
  review: handleReview,
  dashboard: handleDashboard,
  agreements: handleAgreements,
  continuity: handleContinuity,
  compact: handleCompact,
  doctor: handleDoctor,
  status: handleStatus,
  reindex: handleReindex,
  config: handleConfig,
  obsidian: handleObsidian,
  claude: handleClaude,
  codex: handleCodex,
  mcp: handleMcp,
  "session-end": handleSessionEndCommand,
}

async function dispatch(command: string, ctx: CliContext): Promise<void> {
  const handler = commandHandlers[command]
  if (!handler) {
    console.log(formatError(`Unknown command: ${command}. Run 'memory-lane help' for usage.`, ctx.json))
    process.exit(2)
  }
  await handler(ctx)
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = argv[0]?.toLowerCase()
  const json = hasFlag(argv, "json")

  if (command === "--smoke-test") {
    console.log("memory-lane ok")
    process.exit(0)
  }

  if (!command || command === "help" || hasFlag(argv, "help") || hasFlag(argv, "h")) {
    console.log(usage())
    printInitPrompt(json)
    process.exit(command && command !== "help" ? 2 : 0)
  }

  if (command === "init") {
    try {
      if (hasFlag(argv, "project-local")) {
        handleInitCommand(argv, json)
      } else {
        await handleInit(argv)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(formatError(msg, json))
      process.exit(1)
    }
    process.exit(0)
  }

  if (command === "uninstall") {
    try {
      await handleUninstall(argv)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(formatError(msg, json))
      process.exit(1)
    }
    process.exit(0)
  }

  if (command === "upgrade") {
    try {
      await handleUpgrade(argv)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(formatError(msg, json))
      process.exit(1)
    }
    process.exit(0)
  }

  const projPath = flag(argv, "project")
  const pathOptions = { cwd: projPath ?? process.cwd(), env: process.env }
  const paths = usesReadOnlyStorageResolution(command, argv)
    ? resolveEngineStoragePaths(pathOptions)
    : resolveWritableEngineStoragePaths({ ...pathOptions, autoInitProjectLocalOnHomeFailure: true })
  const configPath = paths.configPath || resolveConfigPath()
  let engine: MemoryEngine
  try {
    engine = createEngine(paths, projPath)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(formatError(`Failed to initialize engine: ${msg}`, json))
    process.exit(1)
  }

  let config: SemanticMemoryConfig
  try {
    config = loadConfig(configPath)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(formatError(`Failed to load config: ${msg}`, json))
    process.exit(1)
  }

  let plugins: LoadedPlugin[] = []
  try {
    const bundledPlugins = config.plugins?.length
      ? config.plugins
          .map(resolveBundledPlugin)
          .filter((p): p is BundledPluginModule => Boolean(p))
      : []
    plugins = config.plugins?.length
      ? await loadPlugins({ pluginNames: config.plugins, engine, config, context: "cli", bundledPlugins })
      : []
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(formatError(`Failed to load plugins: ${msg}`, json))
    process.exit(1)
  }

  for (const plugin of plugins) {
    for (const cmd of plugin.cliCommands) {
      commandHandlers[cmd.name] = cmd.handler
    }
  }

  try {
    await dispatch(command, {
      argv,
      rest: positionals(argv.slice(1)),
      json,
      configPath,
      engine,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(formatError(msg, json))
    process.exit(1)
  }
  // Force clean exit in case any dependency leaves handles alive (e.g. compiled binary).
  process.exit(0)
}

main()
