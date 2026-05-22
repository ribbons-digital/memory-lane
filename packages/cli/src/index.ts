#!/usr/bin/env node
import { MemoryEngine, readRawConfig, writeConfig, getDefaultConfigPath, DEFAULT_CONFIG, loadConfig, createOpenAIEmbeddingProvider } from "@memory-lane/core"
import {
  formatMemories, formatRecall, formatSaveResult, formatResult,
  formatCompact, formatDoctor, formatError, usage,
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

  // Resolve config path and optionally create embedding provider
  const configPath = process.env.MEMORY_LANE_CONFIG || getDefaultConfigPath()
  let embeddingProvider: ReturnType<typeof createOpenAIEmbeddingProvider> | undefined
  try {
    const cfg = loadConfig(configPath)
    if (cfg.semantic.enabled) {
      const profile = cfg.semantic.embeddings.profiles[cfg.semantic.activeEmbeddingProfile]
      if (profile) {
        embeddingProvider = createOpenAIEmbeddingProvider(profile)
      }
    }
  } catch { /* no provider if config invalid or missing */ }

  let engine: MemoryEngine
  try {
    engine = new MemoryEngine({
      memoryPath: process.env.MEMORY_LANE_FILE,
      embeddingsPath: process.env.MEMORY_LANE_EMBEDDINGS_FILE,
      configPath,
      embeddingProvider,
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
        const statusFlag = flag(argv, "status") as any
        const allScope = hasFlag(argv, "all")
        const mems = engine.list({ status: statusFlag, all: allScope })
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

      default: {
        if (command === "config") {
          const subCmd = rest[0]?.toLowerCase()
          if (!subCmd || subCmd === "show") {
            const raw = readRawConfig(engine["configPath"] as string)
            if (!raw) { console.log(formatError("No config file found.", json)); break }
            if (json) console.log(JSON.stringify(raw, null, 2))
            else console.log(`Config: ${getDefaultConfigPath()}\n` + JSON.stringify(raw, null, 2))
          } else if (subCmd === "enable-semantic") {
            const cfgPath = process.env.MEMORY_LANE_CONFIG || getDefaultConfigPath()
            writeConfig(cfgPath, { semantic: { enabled: true } as any })
            console.log(json ? JSON.stringify({ ok: true, semantic: { enabled: true } }) : "Semantic search enabled. Run 'memory-lane reindex' to build embeddings.")
          } else if (subCmd === "disable-semantic") {
            const cfgPath = process.env.MEMORY_LANE_CONFIG || getDefaultConfigPath()
            writeConfig(cfgPath, { semantic: { enabled: false } as any })
            console.log(json ? JSON.stringify({ ok: true, semantic: { enabled: false } }) : "Semantic search disabled.")
          } else if (subCmd === "set") {
            const key = rest[1]
            const value = rest.slice(2).join(" ")
            if (!key) { console.log(formatError("Usage: memory-lane config set <json-path> <value>", json)); break }
            const cfgPath = process.env.MEMORY_LANE_CONFIG || getDefaultConfigPath()
            const existing = (readRawConfig(cfgPath) as Record<string, unknown>) || {}
            const merged = deepMergeConfig(DEFAULT_CONFIG, existing) as Record<string, unknown>
            setByPath(merged, key, parseConfigValue(value))
            writeConfig(cfgPath, merged as any)
            console.log(json ? JSON.stringify({ ok: true, path: key }) : `Set ${key}`)
          } else {
            console.log(formatError("Usage: memory-lane config [show | enable-semantic | disable-semantic | set <key> <value>]", json))
          }
        } else {
          console.log(formatError(`Unknown command: ${command}. Run 'memory-lane help' for usage.`, json))
          process.exit(2)
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(formatError(msg, json))
    process.exit(1)
  }
}

main()
