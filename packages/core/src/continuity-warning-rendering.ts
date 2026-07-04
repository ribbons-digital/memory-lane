import type { ContinuityWarning } from "./types.js"

export interface ContinuityWarningRenderPlanOptions {
  maxWarnings?: number
  maxActionsPerWarning?: number
}

export interface ContinuityWarningRenderPlan {
  warnings: ContinuityWarning[]
  actionRequiredWarnings: ContinuityWarning[]
  infoWarnings: ContinuityWarning[]
  omittedWarningCount: number
  renderedInspectionActions: Set<string>
}

export function continuityWarningInspectionActions(warning: ContinuityWarning, maxActions = 3): string[] {
  const actions = warning.suggestedActions ?? []
  return Number.isFinite(maxActions) ? actions.slice(0, Math.max(0, maxActions)) : actions
}

export function requiresContinuityWarningAction(warning: ContinuityWarning): boolean {
  return warning.severity !== "info"
}

export function buildContinuityWarningRenderPlan(
  warnings: ContinuityWarning[],
  options: ContinuityWarningRenderPlanOptions = {},
): ContinuityWarningRenderPlan {
  const maxWarnings = options.maxWarnings ?? 3
  const maxActionsPerWarning = options.maxActionsPerWarning ?? 3
  const visibleWarnings = warnings.slice(0, Math.max(0, maxWarnings))
  const renderedInspectionActions = new Set<string>()
  for (const warning of visibleWarnings) {
    for (const action of continuityWarningInspectionActions(warning, maxActionsPerWarning)) {
      renderedInspectionActions.add(action)
    }
  }
  return {
    warnings: visibleWarnings,
    actionRequiredWarnings: visibleWarnings.filter(requiresContinuityWarningAction),
    infoWarnings: visibleWarnings.filter((warning) => !requiresContinuityWarningAction(warning)),
    omittedWarningCount: Math.max(0, warnings.length - visibleWarnings.length),
    renderedInspectionActions,
  }
}
