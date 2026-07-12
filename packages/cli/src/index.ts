#!/usr/bin/env node
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { MemoryEngine, readRawConfig, writeConfig, getDefaultConfigPath, DEFAULT_CONFIG, loadConfig, deepMergeConfig, createOpenAIEmbeddingProvider, createSingleStoreEngineStorage, createTwoTierEngineStorage, initProjectLocalStorage, isMetaTaskPromptText, resolveEngineStoragePaths, resolveWritableEngineStoragePaths, isWorkflowArea, type MemoryPaths, type EngineStoragePaths, type WorkflowArea } from "@memory-lane/core"
import { runClaudeHookCommand, type ClaudeCommand } from "@memory-lane/claude-adapter"
import { runCodexHookCommand, type CodexCommand } from "@memory-lane/codex-adapter"
import { classifyPromptRoute, createLearningEventSink, handleSessionEnd, createOpenAICompatibleProvider, purgeTraces, traceStatus, type TraceStatus } from "@memory-lane/lifecycle"
import { runPiHookCommand, type PiCommand } from "./pi-hook.js"
import { handleMcp } from "./commands/mcp.js"
import { handleInit } from "./commands/init.js"
import { handleUninstall } from "./commands/uninstall.js"
import { handleUpgrade } from "./commands/upgrade.js"
import { handleObsidian } from "./commands/obsidian.js"
import { flag, hasFlag, positionals } from "./args.js"
import { ompDiagnosticTarget, readInstallManifest } from "./installer/manifest.js"
import type { CliContext } from "./commands/context.js"
import { loadPlugins } from "@memory-lane/plugin-api"
import type { BundledPluginModule, LoadedPlugin } from "@memory-lane/plugin-api"
import type { SemanticMemoryConfig } from "@memory-lane/core"

import { resolveBundledPlugin } from "./plugins.js"
import {
  formatMemories, formatReviewMemories, formatRecall, formatSaveResult, formatResult, formatMutationResult,
  formatCompact, formatDashboard, formatDoctor, formatFreshnessSummary, formatPreferenceDiagnosticsSummary, formatOperatingAgreements, formatContinuityReadModel, formatError, formatMemoryGet, formatUpdatePreview, formatRescopeResult, formatSupersedeResult, formatReplaceResult, formatLegacyProjectMemorySummary, formatLegacyProjectMemoryMigrationPreview, formatLegacyProjectMemoryMigrationApply, usage,
  VERSION,
} from "./formatters.js"

type ConfigContext = Omit<CliContext, "engine">

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

// positionals() lives in ./args.ts next to the VALUE_FLAGS registry it depends on.

// ── Runtime context ──────────────────────────────────────────

type EmbeddingProvider = ReturnType<typeof createOpenAIEmbeddingProvider>

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

function createEngine(paths: MemoryPaths | EngineStoragePaths, projPath?: string, opts: { autoCompact?: boolean } = {}): MemoryEngine {
  const storage = "explicitEnv" in paths
    ? paths.kind === "default-two-tier"
      ? createTwoTierEngineStorage(paths.home, paths.project, paths.projectScopeKey, { producerVersion: VERSION })
      : createSingleStoreEngineStorage(paths.home.memoryPath, paths.home.embeddingsPath, paths.kind === "environment" ? "explicit-storage-env" : "single-store")
    : createSingleStoreEngineStorage(paths.memoryPath, paths.embeddingsPath)
  const configPath = paths.configPath
  const homeDir = process.env.HOME || os.homedir()
  const ompTarget = ompDiagnosticTarget(
    readInstallManifest(path.join(homeDir, ".memory-lane")),
    process.env,
    homeDir,
  )
  const engine = new MemoryEngine({
    memoryPath: "explicitEnv" in paths ? paths.home.memoryPath : paths.memoryPath,
    embeddingsPath: "explicitEnv" in paths ? paths.home.embeddingsPath : paths.embeddingsPath,
    storage,
    autoCompact: opts.autoCompact,
    configPath,
    embeddingProvider: createEmbeddingProvider(configPath),
    learningEventSink: createLearningEventSink({ configPath, env: process.env }),
    integrationPaths: { ompExtension: ompTarget.path },
    integrationWarnings: { ompExtension: ompTarget.warnings },
    env: process.env,
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
    kind: flag(ctx.argv, "kind") as any,
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
  const mem = ctx.engine.delete(id, { all: hasFlag(ctx.argv, "all"), actor: "cli" })
  if (!mem) {
    console.log(formatError(`Memory not found: ${id}`, ctx.json))
    process.exit(1)
  }
  console.log(formatMutationResult("Deleted", mem, ctx.json))
}

function handleApprove(ctx: CliContext): void {
  const id = requireId(ctx, "approve")
  const mem = ctx.engine.approve(id, { all: hasFlag(ctx.argv, "all"), actor: "cli" })
  if (!mem) {
    console.log(formatError(`Memory not found: ${id}`, ctx.json))
    process.exit(1)
  }
  console.log(formatMutationResult("Approved", mem, ctx.json))
}

function handleReject(ctx: CliContext): void {
  const id = requireId(ctx, "reject")
  const mem = ctx.engine.reject(id, { all: hasFlag(ctx.argv, "all"), actor: "cli" })
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
    console.log(formatError("Usage: memory-lane rescope <id> --scope global|project [--project <path>] [--dry-run|--yes] [--all]", ctx.json))
    process.exit(1)
  }
  if (!hasFlag(ctx.argv, "dry-run") && !hasFlag(ctx.argv, "yes")) {
    console.log(formatError("rescope requires --yes or --dry-run", ctx.json))
    process.exit(1)
  }
  const all = hasFlag(ctx.argv, "all")
  const result = hasFlag(ctx.argv, "dry-run")
    ? ctx.engine.previewRescope(id, { scopeType, projectPath: flag(ctx.argv, "project"), dryRun: true, all })
    : ctx.engine.rescope(id, { scopeType, projectPath: flag(ctx.argv, "project"), all })
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
    const preview = ctx.engine.previewUpdate(id, patch, { all: hasFlag(ctx.argv, "all") })
    if (!preview) {
      console.log(formatError(`Memory not found: ${id}`, ctx.json))
      process.exit(1)
    }
    console.log(formatUpdatePreview(preview, ctx.json))
    return
  }
  const mem = ctx.engine.update(id, patch, { all: hasFlag(ctx.argv, "all"), actor: "cli" })
  if (!mem) {
    console.log(formatError(`Memory not found: ${id}`, ctx.json))
    process.exit(1)
  }
  console.log(formatMutationResult("Updated", mem, ctx.json))
}

function handleSupersede(ctx: CliContext): void {
  const [newId, ...oldIds] = ctx.rest
  if (!newId || !oldIds.length) {
    console.log(formatError("Usage: memory-lane supersede <new-id> <old-id...> [--reason <reason>] [--dry-run] [--yes] [--all]", ctx.json))
    process.exit(1)
  }
  requireYesForMultiple(ctx, oldIds, "supersede")
  const result = ctx.engine.supersede(newId, oldIds, {
    reason: flag(ctx.argv, "reason"),
    revisedBy: "cli",
    dryRun: hasFlag(ctx.argv, "dry-run"),
    all: hasFlag(ctx.argv, "all"),
  })
  console.log(formatSupersedeResult(result, ctx.json))
}

async function handleReplace(ctx: CliContext): Promise<void> {
  const oldIds = ctx.rest
  if (!oldIds.length) {
    console.log(formatError("Usage: memory-lane replace <old-id...> --text <text>|--stdin [--category <category>] [--kind <kind>] [--status pending|approved] [--reason <reason>] [--dry-run] [--yes] [--all]", ctx.json))
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
    all: hasFlag(ctx.argv, "all"),
  })
  console.log(formatReplaceResult(result, ctx.json))
}

function handleReview(ctx: CliContext): void {
  const suspectMeta = hasFlag(ctx.argv, "suspect-meta")
  const includeApproved = suspectMeta && hasFlag(ctx.argv, "include-approved")
  const allScope = hasFlag(ctx.argv, "all")
  const filters = {
    kind: flag(ctx.argv, "kind"),
    source: flag(ctx.argv, "source"),
    provenance: flag(ctx.argv, "provenance"),
  }
  const reviewMemories = includeApproved
    ? [...ctx.engine.reviewPending({ all: allScope }), ...ctx.engine.list({ status: "approved", all: allScope })]
    : ctx.engine.reviewPending({ all: allScope })
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
  ctx.engine.recordSuggestionsShown(memories, "cli")
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
  ctx.engine.recordAgreementRecommendationsShown(result, "cli")
  console.log(formatOperatingAgreements(result, ctx.json))
}

function handleContinuity(ctx: CliContext): void {
  const query = flag(ctx.argv, "query")
  if (query === "true") throw new Error("Missing value for --query")
  console.log(formatContinuityReadModel(ctx.engine.continuity({ caller: "cli", query }), ctx.json, { projectScope: ctx.engine.getProjectScope()?.key ?? "none" }))
}

function handleRoute(ctx: CliContext): void {
  const promptFlag = flag(ctx.argv, "prompt")
  const hasPromptFlag = hasFlag(ctx.argv, "prompt")
  const prompt = hasPromptFlag ? promptFlag : ctx.rest.join(" ")
  const promptIndex = ctx.argv.indexOf("--prompt")
  const promptValueMissing = hasPromptFlag && (promptIndex === ctx.argv.length - 1 || ctx.argv[promptIndex + 1]?.startsWith("--"))
  if (!prompt || promptValueMissing) throw new Error("Missing prompt. Usage: memory-lane route --prompt <prompt>")
  const route = classifyPromptRoute(prompt)
  if (ctx.json) {
    console.log(formatResult("route", route, true))
    return
  }
  console.log(`route: ${route.route}\nconfidence: ${route.confidence}\nreasons: ${route.reasons.join(", ") || "none"}`)
}

function handleCompact(ctx: CliContext): void {
  console.log(formatCompact(ctx.engine.compact(), ctx.json))
}

function handleDoctor(ctx: CliContext): void {
  const since = flag(ctx.argv, "since")
  console.log(formatDoctor(ctx.engine.doctor({ freshnessSince: since }), ctx.json))
  printInitPrompt(ctx.json)
}

function numericReportField(report: Record<string, unknown>, key: string): number {
  const value = report[key]
  return typeof value === "number" ? value : 0
}

function formatLearningStatusHuman(learning: TraceStatus): string[] {
  const lines = [
    `Learning: ${learning.enabled ? "on" : "off"}`,
    `Learning data: ${learning.tracesDirectory}`,
    `Captured sessions: ${learning.fileCount}`,
    `Captured bytes: ${learning.totalBytes}`,
  ]
  if (learning.excludedProjects.length) lines.push(`Excluded projects: ${learning.excludedProjects.join(", ")}`)
  if (learning.oldestTrace) lines.push(`Oldest capture: ${learning.oldestTrace}`)
  if (learning.newestTrace) lines.push(`Newest capture: ${learning.newestTrace}`)
  return lines
}

function handleStatus(ctx: CliContext): void {
  const since = flag(ctx.argv, "since")
  const report = ctx.engine.doctor({ freshnessSince: since }) as Record<string, unknown>
  const learning = traceStatus(ctx.configPath)
  if (ctx.json) {
    console.log(formatDoctor({ ...report, learning }, true))
    return
  }
  const lines = [`Total: ${numericReportField(report, "totalMemories")}, Approved: ${numericReportField(report, "approvedMemories")}, Pending: ${numericReportField(report, "pendingMemories")}, Embeddings: ${numericReportField(report, "embeddingCount")}`]
  lines.push(...formatPreferenceDiagnosticsSummary(report.preferenceDiagnostics, report))
  const legacySummary = formatLegacyProjectMemorySummary(report.legacyProjectMemories)
  if (legacySummary) lines.push(legacySummary)
  lines.push(...formatLearningStatusHuman(learning))
  if (since) {
    const freshnessSummary = formatFreshnessSummary(report.freshness)
    if (freshnessSummary) lines.push(freshnessSummary)
  }
  console.log(lines.join("\n"))
}

function handleTuneup(ctx: CliContext): void {
  const subCmd = ctx.rest[0]?.toLowerCase()
  if (subCmd && subCmd !== "purge") {
    console.log(formatError("Usage: memory-lane tuneup [purge] [--json]", ctx.json))
    process.exit(2)
  }
  if (subCmd === "purge") {
    const result = purgeTraces(ctx.configPath)
    if (ctx.json) {
      console.log(JSON.stringify({ ok: true, data: result }, null, 2))
      return
    }
    console.log(`Removed ${result.removedFiles} capture file${result.removedFiles === 1 ? "" : "s"} (${result.removedBytes} bytes) from ${result.tracesDirectory}.`)
    return
  }

  const learning = traceStatus(ctx.configPath)
  if (ctx.json) {
    console.log(JSON.stringify({ ok: true, data: learning }, null, 2))
    return
  }
  if (!learning.enabled) {
    console.log([
      "Local learning is off.",
      "Enable it with: memory-lane config set learning.capture on",
      `Learning data: ${learning.tracesDirectory}`,
    ].join("\n"))
    return
  }
  console.log([
    `Local learning is on. ${learning.fileCount} session${learning.fileCount === 1 ? "" : "s"} captured; useful signal around 50.`,
    `Learning data: ${learning.tracesDirectory}`,
  ].join("\n"))
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
      timeoutMs: summaryConfig.timeoutMs,
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

function showConfig(ctx: ConfigContext): void {
  const raw = readRawConfig(ctx.configPath)
  if (!raw) {
    console.log(formatError("No config file found.", ctx.json))
    return
  }
  if (ctx.json) console.log(JSON.stringify(raw, null, 2))
  else console.log(`Config: ${ctx.configPath}\n` + JSON.stringify(raw, null, 2))
}

function setSemanticEnabled(ctx: ConfigContext, enabled: boolean): void {
  writeConfig(ctx.configPath, { semantic: { enabled } })
  if (ctx.json) {
    console.log(JSON.stringify({ ok: true, semantic: { enabled } }))
  } else {
    console.log(enabled ? "Semantic search enabled. Run 'memory-lane reindex' to build embeddings." : "Semantic search disabled.")
  }
}

function setConfigValue(ctx: ConfigContext): void {
  const key = ctx.rest[1]
  if (!key || ctx.rest.length < 3) {
    console.log(formatError("Usage: memory-lane config set <json-path> <value>", ctx.json))
    process.exit(2)
  }
  const value = ctx.rest.slice(2).join(" ")
  const existing = (readRawConfig(ctx.configPath) as Record<string, unknown>) || {}
  const merged = deepMergeConfig(DEFAULT_CONFIG, existing) as Record<string, unknown>
  setByPath(merged, key, parseConfigValue(value))
  writeConfig(ctx.configPath, merged)
  console.log(ctx.json ? JSON.stringify({ ok: true, path: key }) : `Set ${key}`)
}

const configHandlers: Record<string, (ctx: ConfigContext) => void> = {
  show: showConfig,
  "enable-semantic": (ctx) => setSemanticEnabled(ctx, true),
  "disable-semantic": (ctx) => setSemanticEnabled(ctx, false),
  set: setConfigValue,
}

function handleConfig(ctx: ConfigContext): void {
  const subCmd = ctx.rest[0]?.toLowerCase() ?? "show"
  const handler = configHandlers[subCmd]
  if (handler) handler(ctx)
  else {
    console.log(formatError("Usage: memory-lane config [show | enable-semantic | disable-semantic | set <key> <value>]", ctx.json))
    process.exit(2)
  }
}

function handleMigrate(ctx: CliContext): void {
  const subCmd = ctx.rest[0]?.toLowerCase()
  if (subCmd !== "project-local") {
    console.log(formatError("Usage: memory-lane migrate project-local --dry-run [--write-plan <path>] [--json] [--project <path>]", ctx.json))
    process.exit(2)
  }
  const applyPlanPath = flag(ctx.argv, "apply-plan")
  const writePlanPath = flag(ctx.argv, "write-plan")
  if (applyPlanPath && applyPlanPath !== "true") {
    let raw: any
    try {
      raw = JSON.parse(fs.readFileSync(applyPlanPath, "utf8"))
    } catch {
      console.log(formatError("Invalid project-local migration plan file.", ctx.json))
      process.exit(1)
    }
    const plan = raw?.planVersion ? raw : undefined
    if (!plan?.planVersion) {
      console.log(formatError("Invalid project-local migration plan file.", ctx.json))
      process.exit(1)
    }
    const applyEngine = plan?.projectRoot
      ? createEngine(resolveWritableEngineStoragePaths({ cwd: plan.projectRoot, env: process.env, autoInitProjectLocalOnHomeFailure: false }), plan.projectRoot, { autoCompact: false })
      : ctx.engine
    if (!hasFlag(ctx.argv, "yes")) {
      const message = "Applying a project-local migration plan requires --yes after you review the plan file."
      if (ctx.json) {
        const preview = JSON.parse(formatLegacyProjectMemoryMigrationPreview(applyEngine.doctor().legacyProjectMemories as any, true, plan, applyPlanPath))
        preview.ok = false
        preview.error = message
        console.log(JSON.stringify(preview, null, 2))
      } else {
        console.log(formatLegacyProjectMemoryMigrationPreview(applyEngine.doctor().legacyProjectMemories as any, false, plan))
        console.log(formatError(message, false))
      }
      process.exit(1)
    }
    const result = applyEngine.applyLegacyProjectMigrationPlan(plan)
    console.log(formatLegacyProjectMemoryMigrationApply(result, ctx.json))
    if (result.blocked) process.exit(1)
    return
  }
  if (!hasFlag(ctx.argv, "dry-run")) {
    console.log(formatError("Mutating project-local migration requires an explicit reviewed plan. Run `memory-lane migrate project-local --dry-run --write-plan <path>` first, review it, then run `memory-lane migrate project-local --apply-plan <path> --yes`.", ctx.json))
    process.exit(1)
  }
  const report = ctx.engine.doctor().legacyProjectMemories as any
  let plan: ReturnType<MemoryEngine["createLegacyProjectMigrationPlan"]> | undefined
  let planPath: string | undefined
  if (writePlanPath && writePlanPath !== "true" && report.status === "ok") {
    plan = ctx.engine.createLegacyProjectMigrationPlan()
    planPath = writePlanPath
    fs.mkdirSync(path.dirname(path.resolve(planPath)), { recursive: true })
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n", "utf8")
  }
  console.log(formatLegacyProjectMemoryMigrationPreview(report, ctx.json, plan, planPath))
}

const claudeHookCommands = new Set<string>(["user-prompt-submit", "stop", "post-tool-use", "session-start", "session-end", "pre-compact"])
const codexHookCommands = new Set<string>(["user-prompt-submit", "stop", "post-tool-use", "session-start", "session-end", "pre-compact"])
const piHookCommands: Record<PiCommand, true> = { input: true, "turn-end": true, "post-tool-use": true, "pre-compact": true }

async function handleCodex(ctx: CliContext): Promise<void> {
  const event = ctx.rest[0]
  if (!codexHookCommands.has(event)) {
    console.log(formatError("Unknown Codex hook event. Usage: memory-lane codex user-prompt-submit|stop|post-tool-use|session-start|session-end|pre-compact", ctx.json))
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
    console.log(formatError("Unknown Claude hook event. Usage: memory-lane claude user-prompt-submit|stop|post-tool-use|session-start|session-end|pre-compact", ctx.json))
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

async function handlePi(ctx: CliContext): Promise<void> {
  const event = ctx.rest[0]
  if (!Object.hasOwn(piHookCommands, event)) {
    console.log(formatError("Unknown Pi hook event. Usage: memory-lane pi input|turn-end|post-tool-use|pre-compact", ctx.json))
    process.exit(2)
  }
  const payloadText = await readStdin()
  const output = await runPiHookCommand(event as PiCommand, {
    engine: ctx.engine,
    payloadText,
    env: process.env,
    configPath: ctx.configPath,
  })
  console.log(output)
}

type CommandHandler = (ctx: CliContext) => void | Promise<void>

// These inspection commands must work in read-only desktop/client sandboxes without home-storage write probes.
const readOnlyStorageCommands = new Set(["recall", "list", "search", "review", "dashboard", "agreements", "continuity", "route", "doctor", "status", "show", "get", "migrate", "mcp"])
const readOnlyStorageSubcommands: Record<string, Set<string | undefined>> = {
  config: new Set([undefined, "show"]),
  obsidian: new Set([undefined, "status"]),
}

function usesReadOnlyStorageResolution(command: string, argv: string[]): boolean {
  if (command === "migrate" && hasFlag(argv, "apply-plan")) return false
  if (readOnlyStorageCommands.has(command)) return true
  const subcommands = readOnlyStorageSubcommands[command]
  if (!subcommands) return false
  return subcommands.has(positionals(argv.slice(1))[0]?.toLowerCase())
}

function isHookInvocation(command: string): boolean {
  return command === "claude" || command === "codex" || command === "pi"
}

const HOOK_SETTLE_TIMEOUT_MS = 2_000

function failSafeHookInitialization(reason: string): never {
  if (process.env.MEMORY_LANE_HOOK_DEBUG) console.error(`Memory Lane hook initialization failed: ${reason}`)
  console.log("{}")
  process.exit(0)
}

async function settleEngineForCommand(command: string, engine: MemoryEngine): Promise<void> {
  if (!isHookInvocation(command)) {
    await engine.settle()
    return
  }

  let timer: NodeJS.Timeout | undefined
  await Promise.race([
    engine.settle(),
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        engine.cancelPendingEmbeddings()
        resolve()
      }, HOOK_SETTLE_TIMEOUT_MS)
      timer.unref?.()
    }),
  ])
  if (timer) clearTimeout(timer)
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
  tuneup: handleTuneup,
  update: handleUpdate,
  rescope: handleRescope,
  move: handleRescope,
  supersede: handleSupersede,
  replace: handleReplace,
  review: handleReview,
  dashboard: handleDashboard,
  agreements: handleAgreements,
  continuity: handleContinuity,
  route: handleRoute,
  compact: handleCompact,
  doctor: handleDoctor,
  status: handleStatus,
  reindex: handleReindex,
  obsidian: handleObsidian,
  migrate: handleMigrate,
  claude: handleClaude,
  codex: handleCodex,
  pi: handlePi,
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
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(VERSION)
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
        const result = await handleInit(argv)
        if (result.failedIntegrations.length) process.exit(1)
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
  const readOnlyStorage = usesReadOnlyStorageResolution(command, argv)
  let paths: EngineStoragePaths
  try {
    paths = readOnlyStorage
      ? resolveEngineStoragePaths(pathOptions)
      : resolveWritableEngineStoragePaths({ ...pathOptions, autoInitProjectLocalOnHomeFailure: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (isHookInvocation(command)) failSafeHookInitialization(msg)
    console.log(formatError(`Failed to resolve storage paths: ${msg}`, json))
    process.exit(1)
  }
  const configPath = paths.configPath || resolveConfigPath()
  if (command === "config") {
    try {
      handleConfig({ argv, rest: positionals(argv.slice(1)), json, configPath })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const message = err instanceof SyntaxError ? `Invalid config file ${configPath}: ${msg}` : msg
      console.log(formatError(message, json))
      process.exit(1)
    }
    process.exit(0)
  }

  let engine: MemoryEngine
  try {
    engine = createEngine(paths, projPath, { autoCompact: !readOnlyStorage })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (isHookInvocation(command)) failSafeHookInitialization(msg)
    console.log(formatError(`Failed to initialize engine: ${msg}`, json))
    process.exit(1)
  }

  let config: SemanticMemoryConfig
  try {
    config = loadConfig(configPath)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (isHookInvocation(command)) failSafeHookInitialization(msg)
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
    if (isHookInvocation(command)) failSafeHookInitialization(msg)
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
    await settleEngineForCommand(command, engine)
  } catch (err: unknown) {
    await settleEngineForCommand(command, engine)
    const msg = err instanceof Error ? err.message : String(err)
    if (isHookInvocation(command)) failSafeHookInitialization(msg)
    console.log(formatError(msg, json))
    process.exit(1)
  }
  // Force clean exit in case any dependency leaves handles alive (e.g. compiled binary).
  process.exit(0)
}

main()
