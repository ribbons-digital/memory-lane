import ansis from "ansis"
import boxen from "boxen"
import Table from "cli-table3"
import figures from "figures"
import { buildContinuityHints, classifyCheckpointCandidate, groupReviewMemories, isMetaTaskPromptText, revisionLabel, type CheckpointCandidateMetadata, type MemoryRecord, type RecallResult, type SaveResult, type MemoryMutationResult, type CompactReport, type FreshnessStatus, type ContinuityHintSummary, type ContinuityReadModel, type OperatingAgreementList, type OperatingAgreementSummary, type PreferenceDiagnostics, type UpdatePreview, type SupersedeResult, type ReplaceResult } from "@memory-lane/core"
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
  continuityHints: ContinuityHintSummary
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
  const continuityHints = buildContinuityHints(memories, { projectScopeKey: projectScope === "none" ? undefined : projectScope })
  const suggestedActions: string[] = []
  if (pending.length) suggestedActions.push("memory-lane review")
  if (suspectMeta.length) suggestedActions.push("memory-lane review --suspect-meta")
  for (const action of continuityHints.suggestedActions) suggestedActions.push(action)
  if (!suggestedActions.length) suggestedActions.push("memory-lane recall <query>")

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
    continuityHints,
    suggestedActions: [...new Set(suggestedActions)],
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
  if (summary.continuityHints.hintCount) {
    lines.push(
      "Continuity hints:",
      ...summary.continuityHints.hints.map((hint) => `  ${figures.bullet} ${hint.code}: ${hint.count}${hint.workflowArea ? ` (${hint.workflowArea})` : ""}`),
    )
  }
  lines.push(
    "Suggested actions:",
    ...summary.suggestedActions.map((action) => `  ${colorize(figures.arrowRight, "cyan")} ${action}`),
  )
  return lines.join("\n")
}

function revisionSuffix(memory: MemoryRecord): string {
  const label = revisionLabel(memory)
  return label ? ` ${label}` : ""
}

function freshnessSuffix(memory: MemoryRecord): string {
  const parts: string[] = []
  if (memory.freshness?.expiresAt) parts.push(`expires ${memory.freshness.expiresAt.slice(0, 10)}`)
  if (memory.freshness?.staleAfterDays) parts.push(`stale after ${memory.freshness.staleAfterDays}d`)
  if (memory.freshness?.capturedAt) parts.push(`captured ${memory.freshness.capturedAt.slice(0, 10)}`)
  return parts.length ? ` [${parts.join("; ")}]` : ""
}

export function formatMemories(memories: MemoryRecord[], json: boolean, extraMeta?: Record<string, unknown>): string {
  if (json) {
    return JSON.stringify({ ok: true, data: { memories }, meta: meta({ count: memories.length, ...extraMeta }) }, null, 2)
  }
  if (!memories.length) return "No memories found."
  return memories.map((m) =>
    `[${m.id}] (${m.scope.type}/${m.category}/${m.kind ?? "?"})${revisionSuffix(m)}${freshnessSuffix(m)} ${m.status !== "approved" ? `[${m.status}] ` : ""}${m.text}  (saved ${formatDate(m.createdAt)})`,
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

type ReviewMemoryOutput = MemoryRecord & { checkpointCandidate?: CheckpointCandidateMetadata }

function withCheckpointCandidate(memory: MemoryRecord): ReviewMemoryOutput {
  const checkpointCandidate = classifyCheckpointCandidate(memory)
  return checkpointCandidate ? { ...memory, checkpointCandidate } : memory
}

function checkpointCandidateLines(memory: MemoryRecord): string[] {
  const checkpoint = classifyCheckpointCandidate(memory)
  if (!checkpoint) return []
  return [
    `    Checkpoint candidate: ${checkpoint.kind} — ${checkpoint.reason}`,
    "    Review: approve if this should become durable project continuity.",
  ]
}

function correctionCandidateLines(memory: MemoryRecord): string[] {
  if (memory.status !== "pending" || (memory.kind !== "correction" && memory.kind !== "procedure")) return []
  return [
    `    Workflow ${memory.kind} candidate — review-first learning`,
    "    Review: approve only if this should become durable project workflow guidance.",
  ]
}

function reviewStatusLine(memory: MemoryRecord): string {
  return `[${memory.id}] ${memory.status} · ${provenanceLabel(memory)} · ${memory.scope.type}/${memory.category}/${memory.kind ?? "misc"}${revisionSuffix(memory)}${freshnessSuffix(memory)}`
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
    const outputMemories = extraMeta?.suspectMeta ? memories : memories.map(withCheckpointCandidate)
    return JSON.stringify({ ok: true, data: { memories: outputMemories, groups }, meta: meta({ count: memories.length, ...extraMeta }) }, null, 2)
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
        `${figures.bullet} [${memory.id}] [${memory.status}] (${memory.scope.type}/${memory.category}/${memory.kind ?? "?"})${freshnessSuffix(memory)}`,
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
        ...checkpointCandidateLines(memory),
        ...correctionCandidateLines(memory),
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

export function formatUpdatePreview(result: UpdatePreview, json: boolean): string {
  if (json) return JSON.stringify({ ok: true, data: result, meta: meta() }, null, 2)
  return [
    "Update dry run:",
    `Current: [${result.current.id}] ${compactPreview(result.current.text)}`,
    `Proposed: [${result.proposed.id}] ${compactPreview(result.proposed.text)}`,
    ...result.warnings.map((warning) => `Warning: ${warning}`),
  ].join("\n")
}

function formatRevisionWarnings(warnings: Array<{ message: string }>): string[] {
  return warnings.map((warning) => `Warning: ${warning.message}`)
}

export function formatSupersedeResult(result: SupersedeResult, json: boolean): string {
  if (json) return JSON.stringify({ ok: true, data: result, meta: meta({ count: result.superseded.length }) }, null, 2)
  return [
    result.dryRun ? "Supersede dry run:" : "Superseded memories:",
    `Successor: [${result.successor.id}] ${compactPreview(result.successor.text)}`,
    `Superseded old memories: ${result.superseded.map((m) => m.id).join(", ") || "none"}`,
    ...formatRevisionWarnings(result.warnings),
    ...(result.mirrorWarnings ?? []).map((warning) => `Warning: ${warning}`),
  ].join("\n")
}

export function formatReplaceResult(result: ReplaceResult, json: boolean): string {
  if (json) return JSON.stringify({ ok: true, data: result, meta: meta({ count: result.superseded.length }) }, null, 2)
  return [
    result.dryRun ? "Replace dry run:" : "Replaced memory:",
    `Successor: [${result.successor.id}] ${compactPreview(result.successor.text)}`,
    `Superseded old memories: ${result.superseded.map((m) => m.id).join(", ") || "none"}`,
    ...formatRevisionWarnings(result.warnings),
    ...(result.mirrorWarnings ?? []).map((warning) => `Warning: ${warning}`),
  ].join("\n")
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
  "contextPolicySessionStartPreferenceMaxItems",
  "contextPolicyPromptPreferenceMaxItems",
  "contextPolicySessionStartPreferenceMaxChars",
  "contextPolicyPromptPreferenceMaxChars",
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
    `  preference budget: SessionStart ${report.contextPolicySessionStartPreferenceMaxItems} items / ${report.contextPolicySessionStartPreferenceMaxChars} chars; Prompt ${report.contextPolicyPromptPreferenceMaxItems} items / ${report.contextPolicyPromptPreferenceMaxChars} chars`,
    `  include pending: ${report.contextPolicyIncludePending}`,
    `  fallback to search: ${report.contextPolicyFallbackToSearch}`,
  ]
}

function isPreferenceDiagnostics(value: unknown): value is PreferenceDiagnostics {
  if (typeof value !== "object" || value === null) return false
  const diagnostics = value as PreferenceDiagnostics
  return typeof diagnostics.visiblePreferenceCount === "number"
    && typeof diagnostics.currentProjectPreferenceCount === "number"
    && typeof diagnostics.globalPreferenceCount === "number"
    && typeof diagnostics.workflowRulePreferenceCount === "number"
    && typeof diagnostics.sessionStart === "object"
    && diagnostics.sessionStart !== null
    && typeof diagnostics.sessionStart.selectedPreferenceCount === "number"
    && typeof diagnostics.sessionStart.omittedPreferenceCount === "number"
    && typeof diagnostics.sessionStart.maxPreferenceItems === "number"
    && typeof diagnostics.sessionStart.maxPreferenceChars === "number"
}

export function formatPreferenceDiagnosticsSummary(value: unknown, report?: Record<string, unknown>): string[] {
  if (!isPreferenceDiagnostics(value)) return []
  const promptMaxItems = typeof report?.contextPolicyPromptPreferenceMaxItems === "number" ? report.contextPolicyPromptPreferenceMaxItems : "?"
  const promptMaxChars = typeof report?.contextPolicyPromptPreferenceMaxChars === "number" ? report.contextPolicyPromptPreferenceMaxChars : "?"
  return [
    `Preference context: visible ${value.visiblePreferenceCount}, selected for SessionStart ${value.sessionStart.selectedPreferenceCount}, omitted ${value.sessionStart.omittedPreferenceCount}`,
    `Preference caps: SessionStart ${value.sessionStart.maxPreferenceItems} items / ${value.sessionStart.maxPreferenceChars} chars, Prompt ${promptMaxItems} items / ${promptMaxChars} chars`,
  ]
}

function isFreshnessStatus(value: unknown): value is FreshnessStatus {
  return typeof value === "object" && value !== null
    && typeof (value as FreshnessStatus).visibleApprovedCount === "number"
    && typeof (value as FreshnessStatus).newerApprovedCount === "number"
    && typeof (value as FreshnessStatus).newerProjectApprovedCount === "number"
    && typeof (value as FreshnessStatus).newerGlobalApprovedCount === "number"
    && typeof (value as FreshnessStatus).newerGlobalPreferenceCount === "number"
}

export function formatFreshnessSummary(value: unknown): string | undefined {
  if (!isFreshnessStatus(value)) return undefined
  const newerLabel = value.newerApprovedCount === 1 ? "memory" : "memories"
  const since = value.referenceTime ? ` since ${value.referenceTime}` : ""
  const advisory = value.advisory
  const advisoryText = advisory
    ? `; advisory: ${advisory.expiredCount} expired, ${advisory.staleCount} stale, ${advisory.currentCount} current with freshness`
    : ""
  return `Freshness: ${value.newerApprovedCount} newer approved ${newerLabel}${since} (visible approved: ${value.visibleApprovedCount}; project: ${value.newerProjectApprovedCount}; global: ${value.newerGlobalApprovedCount}; global preferences: ${value.newerGlobalPreferenceCount}${advisoryText})`
}

function isOperatingAgreementSummary(value: unknown): value is OperatingAgreementSummary {
  return typeof value === "object" && value !== null
    && typeof (value as OperatingAgreementSummary).primaryCount === "number"
    && typeof (value as OperatingAgreementSummary).relatedCandidateCount === "number"
    && Array.isArray((value as OperatingAgreementSummary).workflowAreas)
}

function formatOperatingAgreementSummary(value: unknown): string | undefined {
  if (!isOperatingAgreementSummary(value)) return undefined
  const areas = value.workflowAreas.length ? value.workflowAreas.join(", ") : "none"
  return `Operating agreements: ${value.primaryCount} primary, ${value.relatedCandidateCount} related candidates (areas: ${areas}). Use memory-lane agreements to inspect agreement text.`
}

function isContinuityHintSummary(value: unknown): value is ContinuityHintSummary {
  return typeof value === "object" && value !== null
    && typeof (value as ContinuityHintSummary).hintCount === "number"
    && Array.isArray((value as ContinuityHintSummary).hints)
}

function formatContinuityHintSummary(value: unknown): string | undefined {
  if (!isContinuityHintSummary(value)) return undefined
  if (!value.hintCount) return "Continuity hints: none"
  const codes = value.hints.map((hint) => hint.workflowArea ? `${hint.code}/${hint.workflowArea}` : hint.code).join(", ")
  return `Continuity hints: ${value.hintCount} (${codes}). Use memory-lane dashboard for inspection actions.`
}

export function formatContinuityReadModel(model: ContinuityReadModel, json: boolean, extraMeta?: Record<string, unknown>): string {
  if (json) {
    return JSON.stringify({ ok: true, data: model, meta: meta(extraMeta) }, null, 2)
  }

  const lines = [
    boxen([
      `Project: ${model.projectScope}`,
      `${figures.pointerSmall} Approved visible ${model.status.visibleApprovedCount}   Pending continuity ${model.status.pendingContinuityCount}`,
    ].join("\n"), { title: "Memory Lane Continuity", titleAlignment: "center", padding: 1, borderStyle: "round", borderColor: supportsColor() ? "cyan" : undefined }),
  ]

  if (model.latestApproved.project) {
    lines.push("", colorize("Latest approved", "bold"), `  [${model.latestApproved.project.id}] ${model.latestApproved.project.preview}`)
  }
  if (model.latestApproved.global) {
    lines.push("", colorize("Latest approved (global)", "bold"), `  [${model.latestApproved.global.id}] ${model.latestApproved.global.preview}`)
  }
  if (model.pendingContinuity.length) {
    lines.push("", colorize("Pending continuity", "bold"))
    for (const item of model.pendingContinuity) lines.push(`  [${item.id}] ${item.preview}`)
  }
  if (model.warnings.length) {
    lines.push("", colorize("Warnings", "yellow"))
    for (const warning of model.warnings) lines.push(`  ${figures.warning} ${warning.code}: ${warning.message}`)
  }
  lines.push("", colorize("Suggested actions", "bold"), ...model.suggestedActions.map((action) => `  ${figures.pointerSmall} ${action}`))
  return lines.join("\n")
}

export function formatOperatingAgreements(result: OperatingAgreementList, json: boolean): string {
  if (json) {
    return JSON.stringify({ ok: true, data: result, meta: meta({ count: result.primary.length, relatedCount: result.relatedCandidates.length }) }, null, 2)
  }

  const lines = [
    "Operating agreements",
    `Project scope: ${result.projectScope}`,
  ]

  if (!result.primary.length) {
    lines.push("No operating agreements found.")
  } else {
    lines.push("", "Primary:")
    for (const item of result.primary) {
      const kind = item.memory.kind ?? "misc"
      const recommended = item.recommendedKind ? `; recommended kind: ${item.recommendedKind}` : ""
      lines.push(
        `- [${item.memory.id}] ${item.workflowArea} · ${item.memory.scope.type}/${item.memory.category}/${kind}${revisionSuffix(item.memory)} · ${item.matchReason}${recommended}`,
        `  ${item.memory.text}`,
      )
    }
  }

  lines.push(
    "",
    "Related candidates are not superseded; no cleanup is performed.",
    `Related candidates: ${result.relatedCandidates.length}${result.omittedRelatedCandidateCount ? ` (${result.omittedRelatedCandidateCount} omitted)` : ""}`,
  )
  for (const item of result.relatedCandidates) {
    const kind = item.memory.kind ?? "misc"
    const recommended = item.recommendedKind ? `; recommended kind: ${item.recommendedKind}` : ""
    lines.push(`- [${item.memory.id}] ${item.workflowArea} · ${item.memory.scope.type}/${item.memory.category}/${kind}${revisionSuffix(item.memory)} · ${item.matchReason}${recommended}`)
  }

  if (result.notes.length) {
    lines.push("", "Notes:", ...result.notes.map((note) => `- ${note}`))
  }

  return lines.join("\n")
}

export function formatDoctor(report: Record<string, unknown>, json: boolean): string {
  if (json) {
    return JSON.stringify({ ok: true, data: report, meta: meta() }, null, 2)
  }
  const contextLines = formatContextPolicyDoctor(report)
  const preferenceLines = formatPreferenceDiagnosticsSummary(report.preferenceDiagnostics, report)
  const detailLines = Object.entries(report)
    .filter(([k]) => !contextPolicyDoctorKeys.has(k) && k !== "preferenceDiagnostics")
    .map(([k, v]) => {
      if (k === "freshness") return formatFreshnessSummary(v) ?? "freshness: unavailable"
      if (k === "continuityHints") return formatContinuityHintSummary(v) ?? "continuityHints: unavailable"
      if (k === "operatingAgreements") return formatOperatingAgreementSummary(v) ?? "operatingAgreements: unavailable"
      if (v && typeof v === "object") return `${k}: ${JSON.stringify(v, null, 2)}`
      return `${k}: ${v}`
    })
  return [...contextLines, ...preferenceLines, ...detailLines].join("\n")
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
  update <id> --text <text>|--stdin [--category <category>] [--kind <kind>] [--status pending|approved] [--reason <reason>] [--dry-run]
                  Revise an active memory with the same id
  supersede <new-id> <old-id...> [--reason <reason>] [--dry-run] [--yes]
                  Mark approved old memories as superseded by an approved successor
  replace <old-id...> --text <text>|--stdin [--category <category>] [--kind <kind>] [--status pending|approved] [--reason <reason>] [--dry-run] [--yes]
                  Create a successor memory and optionally supersede old memories
  review [--kind <kind>] [--source <source>] [--provenance <adapter/event>] [--suspect-meta] [--include-approved]
  dashboard [--all]
                  Compact continuity and review overview
  agreements [--area <area>] [--limit <n>] [--related-limit <n>] [--all]
                  Show approved operating agreements for the current project and global scope
  continuity [--json]    Canonical continuity read model for resumption/status questions
  compact
  doctor [--since <ISO timestamp>]
  reindex [--force]
  status [--since <ISO timestamp>]
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
  --all            (list, agreements) Show all memories, bypassing project scope`
}
