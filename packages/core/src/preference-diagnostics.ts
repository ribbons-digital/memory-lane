import { containsLikelySecret } from "./secret-detection.js"
import { normalizeMemoryText } from "./search.js"
import type { MemoryContextPolicyConfig, MemoryRecord, PreferenceDiagnostics } from "./types.js"

interface PreferenceDiagnosticsOptions {
  projectScopeKey?: string
  contextPolicy?: MemoryContextPolicyConfig
  operatingAgreementIds?: Set<string>
}

interface SelectionLimits {
  maxItems: number
  maxChars: number
  preferenceMaxItems: number
  preferenceMaxChars: number
}

interface SelectionState {
  selectedCount: number
  totalChars: number
  selectedPreferenceCount: number
  selectedCurrentProjectPreferenceCount: number
  selectedGlobalPreferenceCount: number
  preferenceChars: number
  seen: Set<string>
}

const DEFAULT_SESSION_START_MAX_ITEMS = 4
const DEFAULT_SESSION_START_MAX_CHARS = 1600
const DEFAULT_SESSION_START_PREFERENCE_MAX_ITEMS = 2
const DEFAULT_SESSION_START_PREFERENCE_MAX_CHARS = 600

export function isPreferenceLikeMemory(memory: MemoryRecord): boolean {
  return memory.category === "preference" || memory.kind === "preference" || memory.kind === "workflow_rule"
}

function memoryScopeKey(memory: MemoryRecord): string | undefined {
  return memory.scope.key ?? memory.project?.key ?? memory.project?.root
}

function isVisibleApproved(memory: MemoryRecord, projectScopeKey?: string): boolean {
  if (memory.status !== "approved") return false
  if (memory.scope.type === "global") return true
  return Boolean(projectScopeKey) && memoryScopeKey(memory) === projectScopeKey
}

function isCurrentProject(memory: MemoryRecord, projectScopeKey?: string): boolean {
  return Boolean(projectScopeKey) && memory.scope.type === "project" && memoryScopeKey(memory) === projectScopeKey
}

function normalizedMemoryKey(text: string): string {
  return normalizeMemoryText(text).toLowerCase().replace(/\s+/gu, " ").trim()
}

function sortByUpdatedAtDesc(memories: MemoryRecord[]): MemoryRecord[] {
  return [...memories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function sessionStartLimits(contextPolicy?: MemoryContextPolicyConfig): SelectionLimits {
  return {
    maxItems: contextPolicy?.maxItems?.sessionStart ?? DEFAULT_SESSION_START_MAX_ITEMS,
    maxChars: contextPolicy?.maxChars?.sessionStart ?? DEFAULT_SESSION_START_MAX_CHARS,
    preferenceMaxItems: contextPolicy?.preferenceMaxItems?.sessionStart ?? DEFAULT_SESSION_START_PREFERENCE_MAX_ITEMS,
    preferenceMaxChars: contextPolicy?.preferenceMaxChars?.sessionStart ?? DEFAULT_SESSION_START_PREFERENCE_MAX_CHARS,
  }
}

function fittedLength(text: string, remainingChars: number): number | undefined {
  if (remainingChars <= 0) return undefined
  if (text.length <= remainingChars) return text.length
  if (remainingChars <= 1) return undefined
  return remainingChars
}

function appendSelection(memory: MemoryRecord, limits: SelectionLimits, state: SelectionState, projectScopeKey?: string): void {
  if (state.selectedCount >= limits.maxItems) return
  if (containsLikelySecret(memory.text)) return

  const isPreference = isPreferenceLikeMemory(memory)
  const key = normalizedMemoryKey(memory.text)
  if (!key || state.seen.has(key)) return
  if (isPreference && state.selectedPreferenceCount >= limits.preferenceMaxItems) return

  const remainingTotalChars = limits.maxChars - state.totalChars
  const remainingPreferenceChars = isPreference ? limits.preferenceMaxChars - state.preferenceChars : remainingTotalChars
  const length = fittedLength(memory.text, Math.min(remainingTotalChars, remainingPreferenceChars))
  if (length === undefined) return

  state.selectedCount += 1
  state.totalChars += length
  state.seen.add(key)

  if (isPreference) {
    state.selectedPreferenceCount += 1
    state.preferenceChars += length
    if (isCurrentProject(memory, projectScopeKey)) state.selectedCurrentProjectPreferenceCount += 1
    else if (memory.scope.type === "global") state.selectedGlobalPreferenceCount += 1
  }
}

function appendLayer(memories: MemoryRecord[], limits: SelectionLimits, state: SelectionState, projectScopeKey?: string): void {
  for (const memory of memories) {
    if (state.selectedCount >= limits.maxItems) break
    appendSelection(memory, limits, state, projectScopeKey)
  }
}

export function buildPreferenceDiagnostics(memories: MemoryRecord[], options: PreferenceDiagnosticsOptions = {}): PreferenceDiagnostics {
  const projectScopeKey = options.projectScopeKey
  const projectScope = projectScopeKey ?? "none"
  const visible = memories.filter((memory) => isVisibleApproved(memory, projectScopeKey))
  const visiblePreferences = visible.filter(isPreferenceLikeMemory)
  const currentProjectPreferences = visiblePreferences.filter((memory) => isCurrentProject(memory, projectScopeKey))
  const globalPreferences = visiblePreferences.filter((memory) => memory.scope.type === "global")
  const limits = sessionStartLimits(options.contextPolicy)
  const mode = options.contextPolicy?.mode ?? "selective"

  const state: SelectionState = {
    selectedCount: 0,
    totalChars: 0,
    selectedPreferenceCount: 0,
    selectedCurrentProjectPreferenceCount: 0,
    selectedGlobalPreferenceCount: 0,
    preferenceChars: 0,
    seen: new Set<string>(),
  }

  if (mode === "selective") {
    const operatingAgreementIds = options.operatingAgreementIds ?? new Set<string>()
    const baselineCandidates = visible.filter((memory) => !operatingAgreementIds.has(memory.id))
    const currentProjectPreferenceLayer = projectScopeKey
      ? sortByUpdatedAtDesc(baselineCandidates.filter((memory) => isCurrentProject(memory, projectScopeKey) && isPreferenceLikeMemory(memory)))
      : []
    const currentProjectContentLayer = projectScopeKey
      ? sortByUpdatedAtDesc(baselineCandidates.filter((memory) => isCurrentProject(memory, projectScopeKey) && !isPreferenceLikeMemory(memory)))
      : []
    const globalPreferenceLayer = sortByUpdatedAtDesc(baselineCandidates.filter((memory) => memory.scope.type === "global" && isPreferenceLikeMemory(memory)))

    appendLayer(currentProjectPreferenceLayer, limits, state, projectScopeKey)
    appendLayer(currentProjectContentLayer, limits, state, projectScopeKey)
    appendLayer(globalPreferenceLayer, limits, state, projectScopeKey)
  }

  return {
    projectScope,
    visiblePreferenceCount: visiblePreferences.length,
    currentProjectPreferenceCount: currentProjectPreferences.length,
    globalPreferenceCount: globalPreferences.length,
    workflowRulePreferenceCount: visiblePreferences.filter((memory) => memory.kind === "workflow_rule").length,
    sessionStart: {
      maxPreferenceItems: limits.preferenceMaxItems,
      maxPreferenceChars: limits.preferenceMaxChars,
      selectedPreferenceCount: state.selectedPreferenceCount,
      omittedPreferenceCount: Math.max(0, visiblePreferences.length - state.selectedPreferenceCount),
      selectedCurrentProjectPreferenceCount: state.selectedCurrentProjectPreferenceCount,
      selectedGlobalPreferenceCount: state.selectedGlobalPreferenceCount,
    },
    notes: [
      "Preference diagnostics are text-free counts for approved memories visible to the current project scope.",
      "SessionStart counts are baseline preference-cap diagnostics; actual lifecycle output may select fewer items when continuity notices consume budget or hook overrides apply.",
      "Global preferences are bounded by memory.contextPolicy.preferenceMaxItems.sessionStart and preferenceMaxChars.sessionStart.",
      ...(projectScopeKey ? [] : ["Pass --project or MCP projectPath to inspect project-specific preference layering."]),
    ],
  }
}
