import * as os from "node:os"
import * as path from "node:path"
import { readFile } from "node:fs/promises"
import { readRawConfig, writeConfig, type MemoryEngine } from "@memory-lane/core"
import { discoverObsidianImportFiles, planObsidianImport } from "@memory-lane/obsidian-import"
import { initObsidianMirror, statusObsidianMirror, syncObsidianMirror } from "@memory-lane/obsidian-mirror"
import { formatError, formatImportPlan, type ObsidianImportApplyResult } from "../formatters.js"
import type { CliContext } from "./context.js"

// Large command clusters should live under commands/*.ts and be extracted opportunistically as behavior-preserving cleanups.

function flag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  const next = argv[idx + 1]
  return next && !next.startsWith("--") ? next : "true"
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`)
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

export async function handleObsidian(ctx: CliContext): Promise<void> {
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
