import { CHECKPOINT_PATTERNS } from "./checkpoint-candidates.js"
import { isDumpLikeMemoryBody } from "./dump-like-memory.js"
import type { MemoryKind, MemoryRecord } from "./types.js"

export type ContinuityRole = "progress" | "operating_agreement" | "correction" | "procedure" | "global_workflow" | "other"

const EXTRA_PROGRESS_TEXT_PATTERNS: RegExp[] = [
  /\b(?:implemented|completed|landed|dogfood(?:ed)?\s+passed|validation\s+passed|installed-artifact\s+dogfood\s+passed)\b/iu,
  /\b(?:released|tagged|published)\b[^\n.!?]{0,120}\bv?\d+\.\d+\.\d+(?:[-+][\w.]+)?\b/iu,
  /\b(?:commit|sha|revision)\s+`?[a-f0-9]{7,40}`?\b/iu,
  /\b(?:[\p{L}\p{N}_-]+\s+)?checkpoint\b/iu,
]

function hasCheckpointProgressText(text: string): boolean {
  return CHECKPOINT_PATTERNS.some((candidate) => candidate.pattern.test(text))
}

const OPERATING_AGREEMENT_COMPATIBLE_KINDS = new Set<MemoryKind>(["preference", "project_fact", "correction", "procedure"])
const OPERATING_AGREEMENT_PATTERN = /\b(workflow|loop|operating agreement|working preference|review gate|code review|spec review|quality review|approval gate|pr|pull request|branch|merge|worktree|release|tag|version|publish|package manager|installer|onboarding|harness setup|setup wizard|pnpm|use sfw|process)\b/iu
const PROJECT_DURABLE_RULE_PATTERN = /\b(?:project\s+workflow\s+rule|workflow\s+rule|procedure|operating\s+agreement)\s*:|\b(?:always|must|do\s+not)\b|\bwhen\b[\s\S]{0,120}\buse\b/iu
const GLOBAL_WORKFLOW_PATTERN = /\b(?:workflow|tooling|code review|review gate|pr process|pull request|release process|project[- ]loop|harness|mcp|memory-lane|(?:cli|command(?:s)?)\s+(?:workflow|tooling|inspection|usage))\b/iu

function hasProgressEvidence(memory: MemoryRecord): boolean {
  // classifyCheckpointCandidate() is intentionally pending-only; continuity roles run on approved records,
  // so reuse its shared text patterns without invoking the pending-record classifier itself.
  if (memory.kind === "project_checkpoint" || memory.kind === "session_summary") return true
  if (memory.kind === "decision" || memory.kind === "project_fact" || memory.kind === "correction" || memory.kind === "procedure") {
    return hasCheckpointProgressText(memory.text) || EXTRA_PROGRESS_TEXT_PATTERNS.some((pattern) => pattern.test(memory.text))
  }
  return false
}

function isFieldDerivedOperatingAgreement(memory: MemoryRecord): boolean {
  if (isDumpLikeMemoryBody(memory.text)) return false
  if (memory.kind === "workflow_rule") return true
  if (memory.scope.type === "global") {
    if (memory.category === "personal" || memory.kind === "personal_context") return false
    if (memory.category !== "preference") return false
    if (memory.source !== "manual") return false
    if (memory.kind && memory.kind !== "preference" && memory.kind !== "misc") return false
  }
  if (!memory.kind || !OPERATING_AGREEMENT_COMPATIBLE_KINDS.has(memory.kind)) return false
  if (memory.scope.type === "project" && (memory.kind === "project_fact" || memory.kind === "preference")) {
    return PROJECT_DURABLE_RULE_PATTERN.test(memory.text)
  }
  return OPERATING_AGREEMENT_PATTERN.test(memory.text)
}

function isGlobalWorkflow(memory: MemoryRecord): boolean {
  if (isDumpLikeMemoryBody(memory.text)) return false
  if (memory.scope.type !== "global") return false
  if (memory.kind === "workflow_rule") return true
  if (memory.category === "personal" || memory.kind === "personal_context") return false
  if (memory.category !== "preference") return false
  if (memory.source !== "manual") return false
  if (memory.kind && memory.kind !== "preference" && memory.kind !== "misc") return false
  return GLOBAL_WORKFLOW_PATTERN.test(memory.text)
}

export function classifyContinuityRole(memory: MemoryRecord): ContinuityRole {
  if (hasProgressEvidence(memory)) return "progress"
  if (memory.scope.type === "global" && isGlobalWorkflow(memory)) return "global_workflow"
  if (memory.kind === "correction") return "correction"
  if (memory.kind === "procedure") return "procedure"
  if (isFieldDerivedOperatingAgreement(memory)) return "operating_agreement"
  return "other"
}
