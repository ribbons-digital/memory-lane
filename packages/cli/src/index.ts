#!/usr/bin/env node
import { MemoryEngine } from "@memory-lane/core"
import {
  formatMemories, formatRecall, formatSaveResult, formatResult,
  formatCompact, formatDoctor, formatError, usage,
} from "./formatters.js"

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

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = argv[0]?.toLowerCase()
  const json = hasFlag(argv, "json")
  const projPath = flag(argv, "project")
  const rest = positionals(argv.slice(1))

  if (!command || command === "help" || hasFlag(argv, "help") || hasFlag(argv, "h")) {
    console.log(usage())
    process.exit(command && command !== "help" ? 2 : 0)
  }

  let engine: MemoryEngine
  try {
    engine = new MemoryEngine({
      memoryPath: process.env.MEMORY_LANE_FILE,
      embeddingsPath: process.env.MEMORY_LANE_EMBEDDINGS_FILE,
      configPath: process.env.MEMORY_LANE_CONFIG,
    })
    if (projPath) engine.refreshScope(projPath)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(formatError(`Failed to initialize engine: ${msg}`, json))
    process.exit(1)
  }

  try {
    switch (command) {
      case "save": {
        const text = rest.join(" ")
        if (!text) { console.log(formatError("Text required: memory-lane save <text>", json)); process.exit(1) }
        const result = engine.save({
          text,
          scopeType: flag(argv, "scope") as any,
          category: flag(argv, "category") as any,
          status: (flag(argv, "status") as any) ?? "approved",
        })
        console.log(formatSaveResult(result, json))
        break
      }

      case "suggest": {
        const text = rest.join(" ")
        if (!text) { console.log(formatError("Text required: memory-lane suggest <text>", json)); process.exit(1) }
        const result = engine.suggest(
          text,
          flag(argv, "category") as any,
          flag(argv, "scope") as any,
          undefined,
          flag(argv, "status") as any,
        )
        console.log(formatSaveResult(result, json))
        break
      }

      case "recall": {
        const query = rest.join(" ")
        const result = await engine.recall(query)
        console.log(formatRecall(result, json))
        break
      }

      case "list": {
        const mems = engine.list(flag(argv, "status") as any)
        console.log(formatMemories(mems, json))
        break
      }

      case "search": {
        const query = rest.join(" ")
        if (!query) { console.log(formatError("Query required: memory-lane search <query>", json)); process.exit(1) }
        const mems = engine.search(query)
        console.log(formatMemories(mems, json))
        break
      }

      case "delete": {
        const id = rest[0]
        if (!id) { console.log(formatError("ID required: memory-lane delete <id>", json)); process.exit(1) }
        const mem = engine.delete(id)
        if (!mem) { console.log(formatError(`Memory not found: ${id}`, json)); process.exit(1) }
        console.log(formatResult("Deleted", mem, json))
        break
      }

      case "approve": {
        const id = rest[0]
        if (!id) { console.log(formatError("ID required: memory-lane approve <id>", json)); process.exit(1) }
        const mem = engine.approve(id)
        if (!mem) { console.log(formatError(`Memory not found: ${id}`, json)); process.exit(1) }
        console.log(formatResult("Approved", mem, json))
        break
      }

      case "reject": {
        const id = rest[0]
        if (!id) { console.log(formatError("ID required: memory-lane reject <id>", json)); process.exit(1) }
        const mem = engine.reject(id)
        if (!mem) { console.log(formatError(`Memory not found: ${id}`, json)); process.exit(1) }
        console.log(formatResult("Rejected", mem, json))
        break
      }

      case "review": {
        const pending = engine.reviewPending()
        console.log(formatMemories(pending, json))
        break
      }

      case "compact": {
        const report = engine.compact()
        console.log(formatCompact(report, json))
        break
      }

      case "doctor": {
        const report = engine.doctor()
        console.log(formatDoctor(report, json))
        break
      }

      case "status": {
        const report = engine.doctor()
        if (json) {
          console.log(formatDoctor(report, true))
        } else {
          const r = report as any
          console.log(`Total: ${r.totalMemories}, Approved: ${r.approvedMemories}, Pending: ${r.pendingMemories}, Embeddings: ${r.embeddingCount}`)
        }
        break
      }

      case "reindex": {
        const result = await engine.reindexEmbeddings({ force: hasFlag(argv, "force") })
        if (json) {
          console.log(JSON.stringify({ ok: true, data: result }, null, 2))
        } else {
          console.log(`Reindexed: ${result.embedded} embedded, ${result.skippedExisting} skipped (existing), ${result.skippedSecrets} skipped (secrets)`)
        }
        break
      }

      default:
        console.log(formatError(`Unknown command: ${command}. Run 'memory-lane help' for usage.`, json))
        process.exit(2)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(formatError(msg, json))
    process.exit(1)
  }
}

main()
