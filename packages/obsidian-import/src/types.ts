export type ImportMemoryStatus = "pending" | "approved" | "rejected" | "deleted"
export type ImportMemoryCategory = "preference" | "personal" | "project"
export type ImportMemoryScopeType = "global" | "project"
export type ImportMemorySource = "manual" | "user-suggested" | "agent-suggested"

export type ImportMemoryKind =
  | "preference"
  | "personal_context"
  | "project_fact"
  | "project_checkpoint"
  | "workflow_rule"
  | "decision"
  | "misc"

export interface ImportMemoryScope {
  type: ImportMemoryScopeType
  key?: string
}

export interface ExistingImportMemory {
  id: string
  status: ImportMemoryStatus
  text: string
  category: ImportMemoryCategory
  scope: ImportMemoryScope
  source?: ImportMemorySource | string
  createdAt?: string
  updatedAt?: string
  kind?: ImportMemoryKind
  project?: { key?: string; root?: string }
}

export interface ObsidianImportCandidate {
  path: string
  content: string
}

export interface ParsedObsidianFrontmatter {
  memory_lane?: boolean | string
  memory_lane_mirror?: boolean | string
  memory_lane_id?: string | boolean
  category?: string | boolean
  scope?: string | boolean
  status?: string | boolean
  kind?: string | boolean
}

export interface ParsedObsidianNote {
  frontmatter: ParsedObsidianFrontmatter | null
  body: string
  warnings: string[]
}

export interface DiscoverObsidianImportFilesOptions {
  vaultPath: string
  folder?: string
}

export interface PlanObsidianImportOptions {
  candidates: ObsidianImportCandidate[]
  existingMemories: ExistingImportMemory[]
  projectScopeKey?: string
}

export type ObsidianImportAction = "create" | "update" | "skip"

export interface ObsidianImportCreateResult {
  path: string
  action: "create"
  text: string
  category: ImportMemoryCategory
  scope: ImportMemoryScope
  status: "pending" | "approved"
  kind?: ImportMemoryKind
  warnings: string[]
}

export interface ObsidianImportUpdateResult {
  path: string
  action: "update"
  memoryId: string
  text: string
  category?: ImportMemoryCategory
  status?: "pending" | "approved"
  kind?: ImportMemoryKind
  warnings: string[]
}

export interface ObsidianImportSkipResult {
  path: string
  action: "skip"
  warnings: string[]
}

export type ObsidianImportResult = ObsidianImportCreateResult | ObsidianImportUpdateResult | ObsidianImportSkipResult

export interface ObsidianImportSummary {
  wouldCreate: number
  wouldUpdate: number
  skipped: number
  ignored: number
}

export interface ObsidianImportPlan {
  summary: ObsidianImportSummary
  results: ObsidianImportResult[]
  warnings: string[]
}
