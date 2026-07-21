import * as os from "node:os"
import * as path from "node:path"
import { readFile } from "node:fs/promises"
import { readRawConfig, writeConfig, type MemoryEngine } from "@memory-lane/core"
import { discoverObsidianImportFiles, planObsidianImport } from "@memory-lane/obsidian-import"
import { initObsidianMirror, statusObsidianMirror, syncObsidianMirror } from "@memory-lane/obsidian-mirror"
import { flag, hasFlag } from "../args.js"
import { formatError, formatImportPlan, type ObsidianImportApplyResult } from "../formatters.js"
import type { CliContext } from "./context.js"

// Large command clusters should live under commands/*.ts and be extracted opportunistically as behavior-preserving cleanups.

type ObsidianConfig = { enabled: boolean; vaultPath?: string; folder?: string; mode?: "mirror" }
type ObsidianImportPlan = ReturnType<typeof planObsidianImport>
type ObsidianImportItem = ObsidianImportPlan["results"][number]
type ObsidianImportResult = ObsidianImportApplyResult["results"][number]

function expandHome(input: string): string {
  const home = process.env.HOME || os.homedir()
  return input.replace(/^~(?=\/|$)/, home || "~")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function warningLines(warnings: string[]): string[] {
  return warnings.map((warning) => `Warning: ${warning}`)
}

function configuredObsidian(ctx: CliContext): ObsidianConfig {
  const raw = readRawConfig(ctx.configPath) as any
  return raw?.obsidian ?? { enabled: false }
}

function obsidianConfigRequiredMessage(): string {
  return "Obsidian mirror is not configured. Run `memory-lane obsidian init --vault <path>`."
}

function requireConfiguredObsidian(ctx: CliContext): ObsidianConfig & { vaultPath: string } {
  const cfg = configuredObsidian(ctx)
  if (cfg.enabled && cfg.vaultPath) return cfg as ObsidianConfig & { vaultPath: string }
  console.error(formatError(obsidianConfigRequiredMessage(), ctx.json))
  process.exit(1)
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

function skippedImportResult(item: ObsidianImportItem, message?: string): ObsidianImportResult {
  return {
    path: item.path,
    action: "skipped",
    ...("memoryId" in item ? { memoryId: item.memoryId } : {}),
    warnings: message ? [...item.warnings, importApplyWarning(item.path, message)] : item.warnings,
  }
}

function createImportMemory(ctx: CliContext, item: Extract<ObsidianImportItem, { action: "create" }>): ObsidianImportResult {
  const saved = ctx.engine.save({
    text: item.text,
    category: item.category,
    scopeType: item.scope.type,
    status: item.status,
    kind: item.kind,
    source: "manual",
  })
  if (saved.status !== "saved") {
    return {
      path: item.path,
      action: "skipped",
      warnings: [...item.warnings, importApplyWarning(item.path, `save skipped: ${saved.reason}`), ...(saved.warnings ?? [])],
    }
  }
  return {
    path: item.path,
    action: "created",
    memoryId: saved.memory.id,
    status: saved.memory.status,
    warnings: [...item.warnings, ...(saved.warnings ?? [])],
  }
}

function updateImportMemory(ctx: CliContext, item: Extract<ObsidianImportItem, { action: "update" }>): ObsidianImportResult {
  const updated = ctx.engine.update(item.memoryId, {
    text: item.text,
    category: item.category,
    status: item.status,
    kind: item.kind,
  })
  if (!updated) return skippedImportResult(item, "memory update target was not found")
  return {
    path: item.path,
    action: "updated",
    memoryId: updated.id,
    status: updated.status,
    warnings: [...item.warnings, ...(updated.warnings ?? [])],
  }
}

function applyWritableObsidianImportItem(ctx: CliContext, item: Exclude<ObsidianImportItem, { action: "skip" }>): ObsidianImportResult {
  if (item.action === "create") return createImportMemory(ctx, item)
  return updateImportMemory(ctx, item)
}

function applyObsidianImportItem(ctx: CliContext, item: ObsidianImportItem): ObsidianImportResult {
  if (item.action === "skip") return skippedImportResult(item)
  try {
    return applyWritableObsidianImportItem(ctx, item)
  } catch (error: unknown) {
    return skippedImportResult(item, errorMessage(error))
  }
}

function applyObsidianImportPlan(ctx: CliContext, plan: ObsidianImportPlan): ObsidianImportApplyResult {
  const results = plan.results.map((item) => applyObsidianImportItem(ctx, item))
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

function disabledObsidianStatus(json: boolean): string {
  if (json) return JSON.stringify({ ok: true, data: { enabled: false } }, null, 2)
  return "Obsidian mirror: disabled"
}

function formatObsidianStatus(status: ReturnType<typeof statusObsidianMirror>, json: boolean): string {
  if (json) return JSON.stringify({ ok: status.ok, data: status }, null, 2)
  return [
    "Obsidian mirror: enabled",
    `Root: ${status.root}`,
    ...warningLines(status.warnings),
  ].join("\n")
}

function handleObsidianStatus(ctx: CliContext): void {
  const cfg = configuredObsidian(ctx)
  if (!cfg.enabled || !cfg.vaultPath) {
    console.log(disabledObsidianStatus(ctx.json))
    return
  }

  const status = statusObsidianMirror({ vaultPath: cfg.vaultPath, folder: cfg.folder })
  console.log(formatObsidianStatus(status, ctx.json))
}

function requireVaultArg(ctx: CliContext): string {
  const vault = flag(ctx.argv, "vault")
  if (vault && vault !== "true") return vault
  console.error(formatError("Usage: memory-lane obsidian init --vault <path> [--folder <folder>]", ctx.json))
  process.exit(2)
}

function failedInitMessage(warnings: string[]): string {
  if (warnings.length) return warnings.join("\n")
  return "Failed to initialize Obsidian mirror."
}

function formatObsidianInitSync(init: ReturnType<typeof initObsidianMirror>, sync: ReturnType<typeof syncObsidianMirror>, json: boolean): string {
  if (json) return JSON.stringify({ ok: sync.ok, data: { init, sync } }, null, 2)
  return [
    `Configured Obsidian mirror at ${sync.root}`,
    `Synced active memories. Created: ${sync.created}, Updated: ${sync.updated}, Deleted: ${sync.deleted}`,
    ...warningLines(sync.warnings),
  ].join("\n")
}

function handleObsidianInit(ctx: CliContext): void {
  const vaultPath = path.resolve(expandHome(requireVaultArg(ctx)))
  const folder = flag(ctx.argv, "folder") ?? "Memory Lane"
  const init = initObsidianMirror({ vaultPath, folder })
  if (!init.ok) {
    console.error(formatError(failedInitMessage(init.warnings), ctx.json))
    process.exit(1)
  }

  writeConfig(ctx.configPath, { obsidian: { enabled: true, vaultPath, folder, mode: "mirror" } })
  const sync = syncObsidianMirror({ vaultPath, folder }, ctx.engine.list({ all: true }))
  const output = formatObsidianInitSync(init, sync, ctx.json)
  if (!sync.ok) {
    console.error(output)
    process.exit(1)
  }
  console.log(output)
}

function syncLabel(dryRun: boolean, pastLabel: string, futureLabel: string): string {
  if (dryRun) return futureLabel
  return pastLabel
}

function formatObsidianSync(result: ReturnType<typeof syncObsidianMirror>, dryRun: boolean, json: boolean): string {
  if (json) return JSON.stringify({ ok: result.ok, data: result }, null, 2)
  return [
    dryRun ? "Obsidian mirror dry run:" : "Obsidian mirror synced:",
    `${syncLabel(dryRun, "Created", "Would create")}: ${result.created}`,
    `${syncLabel(dryRun, "Updated", "Would update")}: ${result.updated}`,
    `${syncLabel(dryRun, "Deleted", "Would delete")}: ${result.deleted}`,
    ...warningLines(result.warnings),
  ].join("\n")
}

function handleObsidianSync(ctx: CliContext): void {
  const cfg = requireConfiguredObsidian(ctx)
  const dryRun = hasFlag(ctx.argv, "dry-run")
  const result = syncObsidianMirror({ vaultPath: cfg.vaultPath, folder: cfg.folder }, ctx.engine.list({ all: true }), { dryRun })
  const output = formatObsidianSync(result, dryRun, ctx.json)
  if (!result.ok) {
    console.error(output)
    process.exit(1)
  }
  console.log(output)
}

async function handleObsidianImport(ctx: CliContext): Promise<void> {
  const cfg = requireConfiguredObsidian(ctx)
  const dryRun = hasFlag(ctx.argv, "dry-run")
  const importPaths = await discoverObsidianImportFiles({ vaultPath: cfg.vaultPath, folder: cfg.folder })
  const candidates = await Promise.all(importPaths.map(async (importPath) => ({
    path: importPath,
    content: await readFile(path.join(cfg.vaultPath, importPath), "utf8"),
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
}

const obsidianHandlers: Record<string, (ctx: CliContext) => void | Promise<void>> = {
  status: handleObsidianStatus,
  init: handleObsidianInit,
  sync: handleObsidianSync,
  import: handleObsidianImport,
}

export async function handleObsidian(ctx: CliContext): Promise<void> {
  const handler = obsidianHandlers[ctx.rest[0]]
  if (handler) {
    await handler(ctx)
    return
  }

  console.error(formatError("Usage: memory-lane obsidian init|status|sync|import", ctx.json))
  process.exit(2)
}
