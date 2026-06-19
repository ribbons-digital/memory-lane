import type { MemoryRecord } from "./types.js"

export type CheckpointCandidateKind =
  | "release"
  | "merge"
  | "verification"
  | "docs-sync"
  | "roadmap-decision"
  | "major-fix"
  | "project"

export interface CheckpointCandidateMetadata {
  detected: true
  kind: CheckpointCandidateKind
  reason: string
}

const CHECKPOINT_PATTERNS: Array<{ kind: CheckpointCandidateKind; reason: string; pattern: RegExp }> = [
  { kind: "release", reason: "matched release version phrase", pattern: /\b(?:released|tagged|published)\s+v?\d+\.\d+\.\d+(?:[-+][\w.]+)?\b/iu },
  { kind: "merge", reason: "matched merged pull request phrase", pattern: /\b(?:merged\s+(?:PR|pull request)\s*#?\d+|(?:PR|pull request)\s*#?\d+\s+merged|merged\s+pull\s+request)\b/iu },
  { kind: "verification", reason: "matched verification passed phrase", pattern: /\b(?:(?:tests?|build|verification)\s+passed|verified\s+release)\b/iu },
  { kind: "docs-sync", reason: "matched docs sync phrase", pattern: /\b(?:updated\s+(?:ROADMAP(?:\.md)?|HANDOFF(?:\.md)?)|docs?\s+synced|documentation\s+synced)\b/iu },
  { kind: "roadmap-decision", reason: "matched roadmap decision phrase", pattern: /\b(?:roadmap\s+decision|decided\s+next\s+phase|phase\s+\d+\s+starts\s+with)\b/iu },
  { kind: "major-fix", reason: "matched major fix phrase", pattern: /\b(?:fixed\s+(?:critical|blocker)|major\s+fix)\b/iu },
]

export function classifyCheckpointCandidate(memory: MemoryRecord): CheckpointCandidateMetadata | undefined {
  if (memory.kind === "project_checkpoint") {
    return { detected: true, kind: "project", reason: "kind is project_checkpoint" }
  }

  for (const candidate of CHECKPOINT_PATTERNS) {
    if (candidate.pattern.test(memory.text)) {
      return { detected: true, kind: candidate.kind, reason: candidate.reason }
    }
  }

  return undefined
}
