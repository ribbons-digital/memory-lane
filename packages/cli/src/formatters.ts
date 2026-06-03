import type { MemoryRecord, RecallResult, SaveResult, MemoryMutationResult, CompactReport } from "@memory-lane/core"

const VERSION = "0.1.0"

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function meta(extra?: Record<string, unknown>) {
  return { version: VERSION, ...extra }
}

export function formatMemories(memories: MemoryRecord[], json: boolean): string {
  if (json) {
    return JSON.stringify({ ok: true, data: { memories }, meta: meta({ count: memories.length }) }, null, 2)
  }
  if (!memories.length) return "No memories found."
  return memories.map((m) =>
    `[${m.id}] (${m.scope.type}/${m.category}/${m.kind ?? "?"}) ${m.status !== "approved" ? `[${m.status}] ` : ""}${m.text}  (saved ${formatDate(m.createdAt)})`,
  ).join("\n")
}

export function formatRecall(result: RecallResult, json: boolean): string {
  if (json) {
    return JSON.stringify({
      ok: true,
      data: { memories: result.memories, semantic: result.semantic, notice: result.notice },
      meta: meta({ count: result.memories.length }),
    }, null, 2)
  }
  const lines: string[] = []
  if (result.notice) lines.push(`Notice: ${result.notice}`)
  if (result.semantic.enabled && result.semantic.used) {
    lines.push(`[semantic] `)
  }
  if (!result.memories.length) return [...lines, "No memories found."].join("\n").trim()
  return [
    ...lines,
    ...result.memories.map((m) => `[${m.id}] (${m.scope.type}/${m.category}) ${m.text}`),
  ].join("\n").trim()
}

export function formatSaveResult(result: SaveResult, json: boolean): string {
  if (result.status === "saved") {
    if (json) {
      const data: Record<string, unknown> = { saved: result.memory }
      if (result.warnings?.length) data.warnings = result.warnings
      return JSON.stringify({ ok: true, data, meta: meta() }, null, 2)
    }
    const formatted = formatResult("Saved", result.memory, false)
    if (!result.warnings?.length) return formatted
    return [formatted, ...result.warnings.map((warning) => `Warning: ${warning}`)].join("\n")
  }
  if (json) {
    return JSON.stringify({ ok: true, data: { status: "skipped", reason: result.reason }, meta: meta() }, null, 2)
  }
  return `Skipped: ${result.reason}`
}

export function formatMutationResult(label: string, result: MemoryMutationResult, json: boolean): string {
  const { warnings, ...memory } = result
  if (json) {
    const data: Record<string, unknown> = { [label.toLowerCase()]: memory }
    if (warnings?.length) data.warnings = warnings
    return JSON.stringify({ ok: true, data, meta: meta() }, null, 2)
  }
  const formatted = formatResult(label, memory, false)
  if (!warnings?.length) return formatted
  return [formatted, ...warnings.map((warning) => `Warning: ${warning}`)].join("\n")
}

export function formatResult(label: string, data: unknown, json: boolean): string {
  if (json) {
    return JSON.stringify({ ok: true, data: { [label.toLowerCase()]: data }, meta: meta() }, null, 2)
  }
  if (data === null || data === undefined) return `${label}: (none)`
  if (typeof data === "object") {
    const m = data as any
    if (m.id && m.text) return `${label}: [${m.id}] ${m.text}`
    return `${label}: ${JSON.stringify(data)}`
  }
  return `${label}: ${data}`
}

export function formatCompact(report: CompactReport, json: boolean): string {
  if (json) {
    return JSON.stringify({ ok: true, data: report, meta: meta() }, null, 2)
  }
  return `Compacted: removed ${report.removedMemories} memories, ${report.removedEmbeddings} embeddings`
}

export function formatDoctor(report: Record<string, unknown>, json: boolean): string {
  if (json) {
    return JSON.stringify({ ok: true, data: report, meta: meta() }, null, 2)
  }
  return Object.entries(report).map(([k, v]) => `${k}: ${v}`).join("\n")
}

export function formatError(message: string, json: boolean): string {
  if (json) {
    return JSON.stringify({ ok: false, error: message, meta: meta() }, null, 2)
  }
  return `Error: ${message}`
}

export function usage(): string {
  return `memory-lane <command> [args...] [--json] [--project <path>]

Commands:
  save <text> [--scope global|project] [--category preference|personal|project] [--status approved|pending]
  suggest <text> [--scope global|project] [--category preference|personal|project]
  recall [query] [--top-k 8]
  list [--status approved|pending|rejected|deleted] [--all]
  search <query>
  delete <id>
  approve <id>
  reject <id>
  review
  compact
  doctor
  reindex [--force]
  status
  init --project-local [--project <path>]
  config [show|enable-semantic|disable-semantic|set <key> <value>]
  obsidian <init|status|sync>
                  Manage optional Obsidian Markdown mirror
  claude <user-prompt-submit|stop|post-tool-use>
                  Run a Claude Code hook adapter command; reads hook JSON from stdin
  codex <user-prompt-submit|stop|post-tool-use>
                  Run a Codex hook adapter command; reads hook JSON from stdin

Flags:
  --json           Output JSON instead of human-readable text
  --project <path> Set the project scope directory
  --all            (list) Show all memories, bypassing project scope`
}
