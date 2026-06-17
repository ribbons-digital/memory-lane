import ansis from "ansis"
import boxen from "boxen"
import Table from "cli-table3"
import figures from "figures"
import { groupReviewMemories, isMetaTaskPromptText, type MemoryRecord, type RecallResult, type SaveResult, type MemoryMutationResult, type CompactReport } from "@memory-lane/core"
import type { ObsidianImportPlan, ObsidianImportResult } from "@memory-lane/obsidian-import"

const VERSION = "0.1.0"

export interface ObsidianImportApplyResult {
  summary: {
    created: number
    updated: number
    skipped: number
  }
  results: Array<{
    path: string
    action: "created" | "updated" | "skipped"
    memoryId?: string
    status?: string
    warnings: string[]
  }>
  warnings: string[]
}

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

function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY && !process.env.NO_COLOR)
}

function colorize(value: string, color: "cyan" | "green" | "yellow" | "red" | "gray" | "bold"): string {
  if (!supportsColor()) return value
  switch (color) {
    case "cyan": return ansis.cyan(value)
    case "green": return ansis.green(value)
    case "yellow": return ansis.yellow(value)
    case "red": return ansis.red(value)
    case "gray": return ansis.gray(value)
    case "bold": return ansis.bold(value)
  }
}

export interface DashboardSummary {
  projectScope: string
  counts: {
    total: number
    approved: number
    pending: number
    rejected: number
    deleted: number
    global: number
    project: number
  }
  review: {
    pending: number
    sessionSummaries: number
    suspectMeta: number
  }
  recent: {
    sessionSummaries: Array<{ id: string; createdAt: string; status: MemoryRecord["status"]; provenance: string; preview: string }>
  }
  suggestedActions: string[]
}

function statusCount(memories: MemoryRecord[], status: MemoryRecord["status"]): number {
  return memories.filter((memory) => memory.status === status).length
}

function latestByCreatedAt(memories: MemoryRecord[], limit: number): MemoryRecord[] {
  return [...memories]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
}

function provenanceLabel(memory: MemoryRecord): string {
  if (!memory.provenance) return "none"
  return `${memory.provenance.adapter}/${memory.provenance.lifecycleEvent}`
}

function sessionSummaryPreview(text: string, max = 180): string {
  const cleaned = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !/^#+\s*Session Summary(?:\s*\([^)]*\))?\s*$/iu.test(line))
    .map((line) => line
      .replace(/^[-*]\s+/u, "")
      .replace(/^\*\*(?:Decisions made|Next step|Verification|Summary)\*\*\s*:?[\s-]*/iu, "")
      .replace(/\*\*/gu, ""))
    .join(" ")
  return compactPreview(cleaned || text, max)
}

export function buildDashboardSummary(memories: MemoryRecord[], projectScope = "none"): DashboardSummary {
  const pending = memories.filter((memory) => memory.status === "pending")
  const sessionSummaries = pending.filter((memory) => memory.kind === "session_summary")
  const suspectMeta = pending.filter((memory) => isMetaTaskPromptText(memory.text))
  const suggestedActions: string[] = []
  if (pending.length) suggestedActions.push("memory-lane review")
  if (suspectMeta.length) suggestedActions.push("memory-lane review --suspect-meta")
  if (!pending.length && !suspectMeta.length) suggestedActions.push("memory-lane recall <query>")

  return {
    projectScope,
    counts: {
      total: memories.length,
      approved: statusCount(memories, "approved"),
      pending: pending.length,
      rejected: statusCount(memories, "rejected"),
      deleted: statusCount(memories, "deleted"),
      global: memories.filter((memory) => memory.scope.type === "global").length,
      project: memories.filter((memory) => memory.scope.type === "project").length,
    },
    review: {
      pending: pending.length,
      sessionSummaries: sessionSummaries.length,
      suspectMeta: suspectMeta.length,
    },
    recent: {
      sessionSummaries: latestByCreatedAt(sessionSummaries, 3).map((memory) => ({
        id: memory.id,
        createdAt: memory.createdAt,
        status: memory.status,
        provenance: provenanceLabel(memory),
        preview: sessionSummaryPreview(memory.text),
      })),
    },
    suggestedActions,
  }
}

export function formatDashboard(memories: MemoryRecord[], json: boolean, extraMeta?: Record<string, unknown>): string {
  const summary = buildDashboardSummary(memories, typeof extraMeta?.projectScope === "string" ? extraMeta.projectScope : "none")
  if (json) {
    return JSON.stringify({ ok: true, data: summary, meta: meta({ count: memories.length, ...extraMeta }) }, null, 2)
  }

  const counts = summary.counts
  const header = [
    `${colorize("Project", "gray")}: ${summary.projectScope}`,
    `${figures.pointerSmall} Approved ${counts.approved}   Pending ${counts.pending}   Total ${counts.total}`,
    `${figures.pointerSmall} Global ${counts.global}   Project ${counts.project}`,
  ].join("\n")
  const box = boxen(header, {
    title: "Memory Lane Dashboard",
    titleAlignment: "center",
    padding: 1,
    borderStyle: "round",
    borderColor: supportsColor() ? "cyan" : undefined,
  })

  const reviewTable = new Table({
    head: ["Review Queue", "Count"],
    style: { head: supportsColor() ? ["cyan"] : [], border: [] },
  })
  reviewTable.push(
    ["Pending", String(summary.review.pending)],
    ["Session summaries", String(summary.review.sessionSummaries)],
    ["Suspect meta", String(summary.review.suspectMeta)],
  )

  const lines = [box, reviewTable.toString()]
  if (summary.recent.sessionSummaries.length) {
    lines.push(
      "Recent session summaries:",
      ...summary.recent.sessionSummaries.flatMap((memory) => [
        `  ${figures.bullet} [${memory.id}] ${memory.status} · ${memory.provenance}`,
        `    ${memory.preview}`,
      ]),
    )
  }
  lines.push(
    "Suggested actions:",
    ...summary.suggestedActions.map((action) => `  ${colorize(figures.arrowRight, "cyan")} ${action}`),
  )
  return lines.join("\n")
}

export function formatMemories(memories: MemoryRecord[], json: boolean, extraMeta?: Record<string, unknown>): string {
  if (json) {
    return JSON.stringify({ ok: true, data: { memories }, meta: meta({ count: memories.length, ...extraMeta }) }, null, 2)
  }
  if (!memories.length) return "No memories found."
  return memories.map((m) =>
    `[${m.id}] (${m.scope.type}/${m.category}/${m.kind ?? "?"}) ${m.status !== "approved" ? `[${m.status}] ` : ""}${m.text}  (saved ${formatDate(m.createdAt)})`,
  ).join("\n")
}

function compactPreview(text: string, max = 160): string {
  const normalized = text.replace(/\s+/gu, " ").trim()
  if (normalized.length <= max) return normalized
  return normalized.slice(0, max - 1).trimEnd() + "…"
}

function suspectMetaAction(memory: MemoryRecord): string {
  if (memory.status === "approved") return `memory-lane delete ${memory.id}`
  return `memory-lane reject ${memory.id}  # or: memory-lane delete ${memory.id}`
}

function reviewAction(memory: MemoryRecord): string {
  return memory.status === "pending"
    ? `memory-lane approve ${memory.id}  # or: memory-lane reject ${memory.id}`
    : suspectMetaAction(memory)
}

function reviewPreview(memory: MemoryRecord): string {
  return memory.kind === "session_summary" ? sessionSummaryPreview(memory.text) : compactPreview(memory.text)
}

function reviewStatusLine(memory: MemoryRecord): string {
  return `[${memory.id}] ${memory.status} · ${provenanceLabel(memory)} · ${memory.scope.type}/${memory.category}/${memory.kind ?? "misc"}`
}

function filterSummary(extraMeta?: Record<string, unknown>): string | undefined {
  const filters = extraMeta?.filters
  if (!filters || typeof filters !== "object") return undefined
  const entries = Object.entries(filters as Record<string, unknown>)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([key, value]) => `${key}=${value}`)
  return entries.length ? `Filters: ${entries.join(", ")}` : undefined
}

export function formatReviewMemories(memories: MemoryRecord[], json: boolean, extraMeta?: Record<string, unknown>): string {
  const groups = groupReviewMemories(memories)
  if (json) {
    return JSON.stringify({ ok: true, data: { memories, groups }, meta: meta({ count: memories.length, ...extraMeta }) }, null, 2)
  }
  if (!memories.length) return extraMeta?.suspectMeta ? "No likely operational prompt pollution found." : "No pending memories found."

  if (extraMeta?.suspectMeta) {
    const summary = [
      "Review each preview, then reject/delete only entries you confirm are obsolete.",
      filterSummary(extraMeta),
    ].filter(Boolean).join("\n")
    const lines = [boxen(summary, {
      title: "Likely operational prompt pollution",
      titleAlignment: "center",
      padding: 1,
      borderStyle: "round",
      borderColor: supportsColor() ? "yellow" : undefined,
    })]
    for (const memory of memories) {
      lines.push(
        "",
        `${figures.bullet} [${memory.id}] [${memory.status}] (${memory.scope.type}/${memory.category}/${memory.kind ?? "?"})`,
        `  Preview: ${compactPreview(memory.text)}`,
        `  Suggested: ${suspectMetaAction(memory)}`,
      )
    }
    return lines.join("\n")
  }

  const headerLines = [
    "Pending memories grouped by project, source, kind, and provenance.",
    filterSummary(extraMeta),
  ].filter(Boolean)
  const table = new Table({
    head: ["Project", "Source", "Kind", "Provenance", "Count"],
    style: { head: supportsColor() ? ["cyan"] : [], border: [] },
  })
  for (const group of groups) {
    const provenance = group.adapter === "none" ? "none" : `${group.adapter}/${group.lifecycleEvent}`
    table.push([compactPreview(group.projectScope, 42), group.source, group.kind, provenance, String(group.count)])
  }

  const lines = [
    boxen(headerLines.join("\n"), {
      title: "Memory Lane Review",
      titleAlignment: "center",
      padding: 1,
      borderStyle: "round",
      borderColor: supportsColor() ? "cyan" : undefined,
    }),
    "Review Queue:",
    table.toString(),
  ]
  for (const group of groups) {
    lines.push("", `${group.label} (${group.count})`)
    const groupIds = new Set(group.memoryIds)
    for (const memory of memories.filter((m) => groupIds.has(m.id))) {
      lines.push(
        `  ${figures.bullet} ${reviewStatusLine(memory)}`,
        `    ${reviewPreview(memory)}  (saved ${formatDate(memory.createdAt)})`,
        `    Suggested: ${reviewAction(memory)}`,
      )
    }
  }
  return lines.join("\n")
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
  const formatted = label === "Deleted" && memory.id ? `Deleted: ${memory.id}` : formatResult(label, memory, false)
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

const contextPolicyDoctorKeys = new Set([
  "contextPolicyMode",
  "contextPolicySessionStartMaxItems",
  "contextPolicyPromptMaxItems",
  "contextPolicySessionStartMaxChars",
  "contextPolicyPromptMaxChars",
  "contextPolicyIncludePending",
  "contextPolicyFallbackToSearch",
])

function formatContextPolicyDoctor(report: Record<string, unknown>): string[] {
  if (!("contextPolicyMode" in report)) return []
  return [
    "Context policy:",
    `  mode: ${report.contextPolicyMode}`,
    `  prompt budget: ${report.contextPolicyPromptMaxItems} items / ${report.contextPolicyPromptMaxChars} chars`,
    `  session-start budget: ${report.contextPolicySessionStartMaxItems} items / ${report.contextPolicySessionStartMaxChars} chars`,
    `  include pending: ${report.contextPolicyIncludePending}`,
    `  fallback to search: ${report.contextPolicyFallbackToSearch}`,
  ]
}

export function formatDoctor(report: Record<string, unknown>, json: boolean): string {
  if (json) {
    return JSON.stringify({ ok: true, data: report, meta: meta() }, null, 2)
  }
  const contextLines = formatContextPolicyDoctor(report)
  const detailLines = Object.entries(report)
    .filter(([k]) => !contextPolicyDoctorKeys.has(k))
    .map(([k, v]) => {
      if (v && typeof v === "object") return `${k}: ${JSON.stringify(v, null, 2)}`
      return `${k}: ${v}`
    })
  return [...contextLines, ...detailLines].join("\n")
}

export function formatImportPlan(result: ObsidianImportPlan | ObsidianImportApplyResult, json: boolean, dryRun: boolean): string {
  if (json) return JSON.stringify({ ok: true, data: result, meta: meta() }, null, 2)

  const lines = dryRun ? [
    "Obsidian import dry run:",
    `Would import: ${(result as ObsidianImportPlan).summary.wouldCreate}`,
    `Would update: ${(result as ObsidianImportPlan).summary.wouldUpdate}`,
    `Skipped: ${(result as ObsidianImportPlan).summary.skipped}`,
  ] : [
    "Obsidian import:",
    `Imported: ${(result as ObsidianImportApplyResult).summary.created}`,
    `Updated: ${(result as ObsidianImportApplyResult).summary.updated}`,
    `Skipped: ${(result as ObsidianImportApplyResult).summary.skipped}`,
  ]
  const warnings = result.results.flatMap((item: ObsidianImportResult | ObsidianImportApplyResult["results"][number]) => item.warnings)
  if (warnings.length) lines.push("Warnings:", ...warnings.map((warning) => `- ${warning}`))
  if (!result.results.length) lines.push("No importable notes found. Create notes under Memory Lane/imports/ with memory_lane: true.")
  return lines.join("\n")
}

export function formatError(message: string, json: boolean): string {
  if (json) {
    return JSON.stringify({ ok: false, error: message, meta: meta() }, null, 2)
  }
  return `Error: ${message}`
}

export interface PluginUsageCommand {
  name: string
  usage: string
  description: string
}

export function usage(pluginCommands: PluginUsageCommand[] = []): string {
  const pluginLines = pluginCommands.length
    ? "\nPlugin commands:\n" + pluginCommands.map((c) => `  ${c.usage}\n                  ${c.description}`).join("\n")
    : ""

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
  review [--kind <kind>] [--source <source>] [--provenance <adapter/event>] [--suspect-meta] [--include-approved]
  dashboard [--all]
                  Compact continuity and review overview
  compact
  doctor
  reindex [--force]
  status
  init [--yes|--recommended|--all|--list|--only <integrations>] [--project]
                  Run the first-time setup wizard; --only accepts comma-separated harnesses
  init --project-local [--project <path>]
                  Initialize project-local storage
  uninstall [--yes]
                  Remove Memory Lane integration configs and binary
  upgrade [--yes]
                  Download latest binary and re-apply configs
  config [show|enable-semantic|disable-semantic|set <key> <value>]
  obsidian init --vault <path> [--folder "Memory Lane"]
                  Configure optional one-way Obsidian mirror
  obsidian status
                  Show Obsidian mirror status
  obsidian sync [--dry-run]
                  Reconcile generated mirror files and indexes
  obsidian import [--dry-run]
                  Explicitly import user-authored notes from configured imports/; applies by default
  mcp              Run the bundled Memory Lane MCP server over stdio
  claude <user-prompt-submit|stop|post-tool-use|session-start|session-end>
                  Run a Claude Code hook adapter command; reads hook JSON from stdin
  codex <user-prompt-submit|stop|post-tool-use|session-start>
                  Run a Codex hook adapter command; reads hook JSON from stdin
  session-end [--confirm]
                  Generate a session-end summary from stdin JSON; saves as pending memory${pluginLines}

Flags:
  --json           Output JSON instead of human-readable text
  --project <path> Set the project scope directory
  --all            (list) Show all memories, bypassing project scope`
}
