# Obsidian Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement explicit, non-destructive Obsidian Markdown import into Memory Lane JSONL records using the approved import contract.

**Architecture:** Add a new `@memory-lane/obsidian-import` package that discovers, parses, and plans imports without depending on core or writing JSONL. Add a small core update API so import updates go through the same append-only validation/mirror path as other mutations. CLI integration reads configured Obsidian settings, invokes the import planner, applies create/update plans through `MemoryEngine`, and formats dry-run/apply output.

**Tech Stack:** TypeScript ESM packages, Node built-ins (`fs`, `path`), `node:test`, `tsx`, pnpm workspaces. No YAML parser dependency in the first slice; use constrained scalar frontmatter parsing.

---

## File Structure

Create:

- `packages/obsidian-import/package.json` — workspace package manifest matching `@memory-lane/obsidian-mirror` style.
- `packages/obsidian-import/tsconfig.json` — TypeScript config extending root workspace style.
- `packages/obsidian-import/src/index.ts` — package exports.
- `packages/obsidian-import/src/types.ts` — import settings, candidate, plan, result, and memory snapshot types.
- `packages/obsidian-import/src/frontmatter.ts` — constrained top-of-file frontmatter parser.
- `packages/obsidian-import/src/discovery.ts` — recursive import-area discovery, dotfile/symlink skip, deterministic sorting.
- `packages/obsidian-import/src/planner.ts` — parse/validate candidates and produce dry-run plans with warnings.
- `packages/obsidian-import/test/frontmatter.test.ts` — frontmatter/body parser tests.
- `packages/obsidian-import/test/discovery.test.ts` — discovery tests.
- `packages/obsidian-import/test/planner.test.ts` — marker/schema/conflict planning tests.

Modify:

- `packages/core/src/types.ts` — add `UpdateInput` and `UpdateResult`/reuse mutation result typing.
- `packages/core/src/engine.ts` — add `update(id, patch)` API using existing append-only clone path and mirror warnings.
- `packages/core/test/engine.test.ts` — add update tests for validation, active-only behavior, mirror warnings, and scope/status constraints used by import.
- `packages/cli/package.json` — add dependency on `@memory-lane/obsidian-import`.
- `packages/cli/src/formatters.ts` — add import result formatter.
- `packages/cli/src/index.ts` — add `memory-lane obsidian import [--dry-run]` handler.
- `packages/cli/test/cli.test.ts` — add dry-run/apply CLI integration tests.
- `README.md` — document import folder, frontmatter, dry-run/apply commands, and non-sync semantics.
- `skills/memory-lane/SKILL.md` — document import commands for agent usage.
- `packages/obsidian-mirror/src/sync.ts` and tests — update init/sync helper if needed to create/document `imports/` folder during `obsidian init`.

---

## Task 1: Add `@memory-lane/obsidian-import` Parser and Planner Package

**Files:**
- Create: `packages/obsidian-import/package.json`
- Create: `packages/obsidian-import/tsconfig.json`
- Create: `packages/obsidian-import/src/index.ts`
- Create: `packages/obsidian-import/src/types.ts`
- Create: `packages/obsidian-import/src/frontmatter.ts`
- Create: `packages/obsidian-import/src/discovery.ts`
- Create: `packages/obsidian-import/src/planner.ts`
- Create: `packages/obsidian-import/test/frontmatter.test.ts`
- Create: `packages/obsidian-import/test/discovery.test.ts`
- Create: `packages/obsidian-import/test/planner.test.ts`

- [x] **Step 1: Write frontmatter parser tests**

Create `packages/obsidian-import/test/frontmatter.test.ts`:

```ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseImportMarkdown } from "../src/frontmatter.js"

describe("parseImportMarkdown", () => {
  it("parses top-of-file scalar frontmatter and trims body", () => {
    const parsed = parseImportMarkdown([
      "---",
      "memory_lane: true",
      "memory_lane_id: abc12345",
      "category: project",
      "scope: project",
      "status: approved",
      "kind: project_fact",
      "---",
      "",
      "Use `pnpm` for installs.",
      "",
    ].join("\n"))

    assert.deepEqual(parsed, {
      frontmatter: {
        memory_lane: true,
        memory_lane_id: "abc12345",
        category: "project",
        scope: "project",
        status: "approved",
        kind: "project_fact",
      },
      body: "Use `pnpm` for installs.",
      warnings: [],
      hasFrontmatter: true,
    })
  })

  it("ignores files without top-of-file frontmatter", () => {
    const parsed = parseImportMarkdown("# Title\n---\nmemory_lane: true\n---\nBody")
    assert.equal(parsed.hasFrontmatter, false)
    assert.deepEqual(parsed.frontmatter, {})
    assert.equal(parsed.body, "# Title\n---\nmemory_lane: true\n---\nBody")
    assert.deepEqual(parsed.warnings, [])
  })

  it("treats later frontmatter-looking fences as body", () => {
    const parsed = parseImportMarkdown("---\nmemory_lane: true\n---\nBody\n---\nother\n---")
    assert.equal(parsed.frontmatter.memory_lane, true)
    assert.equal(parsed.body, "Body\n---\nother\n---")
  })

  it("warns on malformed opted-in scalar lines", () => {
    const parsed = parseImportMarkdown("---\nmemory_lane: true\ncategory\n---\nBody")
    assert.equal(parsed.frontmatter.memory_lane, true)
    assert.match(parsed.warnings.join("\n"), /Invalid frontmatter line/u)
  })

  it("keeps unknown fields out of recognized frontmatter", () => {
    const parsed = parseImportMarkdown("---\nmemory_lane: true\nowner: shiang\n---\nBody")
    assert.deepEqual(parsed.frontmatter, { memory_lane: true })
    assert.deepEqual(parsed.warnings, [])
  })
})
```

- [x] **Step 2: Write discovery tests**

Create `packages/obsidian-import/test/discovery.test.ts`:

```ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { discoverImportFiles, importRoot } from "../src/discovery.js"

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-import-"))
}

describe("discoverImportFiles", () => {
  it("recurses only under imports and sorts relative paths", () => {
    const vault = tempDir()
    const root = path.join(vault, "Memory Lane")
    fs.mkdirSync(path.join(root, "imports", "nested"), { recursive: true })
    fs.mkdirSync(path.join(root, "memories"), { recursive: true })
    fs.writeFileSync(path.join(root, "imports", "z.md"), "z", "utf8")
    fs.writeFileSync(path.join(root, "imports", "a.md"), "a", "utf8")
    fs.writeFileSync(path.join(root, "imports", "nested", "b.md"), "b", "utf8")
    fs.writeFileSync(path.join(root, "memories", "ignored.md"), "ignored", "utf8")

    const files = discoverImportFiles({ vaultPath: vault, folder: "Memory Lane" })
      .map((file) => file.relativePath)

    assert.deepEqual(files, [
      "Memory Lane/imports/a.md",
      "Memory Lane/imports/nested/b.md",
      "Memory Lane/imports/z.md",
    ])
  })

  it("skips dotfiles dotfolders symlinks and non-markdown files", () => {
    const vault = tempDir()
    const root = path.join(vault, "Memory Lane", "imports")
    fs.mkdirSync(path.join(root, ".hidden-dir"), { recursive: true })
    fs.writeFileSync(path.join(root, "keep.md"), "keep", "utf8")
    fs.writeFileSync(path.join(root, ".hidden.md"), "hidden", "utf8")
    fs.writeFileSync(path.join(root, "skip.txt"), "skip", "utf8")
    fs.writeFileSync(path.join(root, ".hidden-dir", "skip.md"), "skip", "utf8")
    fs.symlinkSync(path.join(root, "keep.md"), path.join(root, "link.md"))

    const files = discoverImportFiles({ vaultPath: vault, folder: "Memory Lane" })
      .map((file) => file.relativePath)

    assert.deepEqual(files, ["Memory Lane/imports/keep.md"])
  })

  it("returns no files when imports folder is missing", () => {
    const vault = tempDir()
    fs.mkdirSync(path.join(vault, "Memory Lane"), { recursive: true })
    assert.deepEqual(discoverImportFiles({ vaultPath: vault, folder: "Memory Lane" }), [])
    assert.equal(importRoot({ vaultPath: vault, folder: "Memory Lane" }), path.join(vault, "Memory Lane", "imports"))
  })
})
```

- [x] **Step 3: Write planner tests**

Create `packages/obsidian-import/test/planner.test.ts`:

```ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { ImportMemorySnapshot } from "../src/types.js"
import { planObsidianImport } from "../src/planner.js"

const existing: ImportMemorySnapshot[] = [
  { id: "active1", text: "Existing active", category: "project", scopeType: "project", scopeKey: "proj", status: "approved", kind: "project_fact" },
  { id: "pending1", text: "Existing pending", category: "personal", scopeType: "global", status: "pending" },
  { id: "deleted1", text: "Deleted", category: "personal", scopeType: "global", status: "deleted" },
]

function candidate(relativePath: string, content: string) {
  return { absolutePath: `/tmp/${relativePath}`, relativePath, content }
}

describe("planObsidianImport", () => {
  it("plans creates with safe defaults", () => {
    const result = planObsidianImport({
      candidates: [candidate("Memory Lane/imports/a.md", "---\nmemory_lane: true\n---\nRemember this")],
      existingMemories: existing,
      projectScopeKey: undefined,
    })

    assert.equal(result.summary.wouldCreate, 1)
    assert.deepEqual(result.results[0], {
      path: "Memory Lane/imports/a.md",
      action: "create",
      text: "Remember this",
      category: "personal",
      scopeType: "global",
      status: "pending",
      warnings: [],
    })
  })

  it("ignores unmarked notes and skips generated mirror files", () => {
    const result = planObsidianImport({
      candidates: [
        candidate("Memory Lane/imports/draft.md", "---\ncategory: project\n---\nDraft"),
        candidate("Memory Lane/imports/generated.md", "---\nmemory_lane: true\nmemory_lane_mirror: true\n---\nGenerated"),
      ],
      existingMemories: existing,
    })

    assert.equal(result.results.length, 1)
    assert.equal(result.results[0].action, "skip")
    assert.match(result.results[0].warnings.join("\n"), /generated mirror file/u)
  })

  it("skips invalid recognized fields and project scope without identity", () => {
    const result = planObsidianImport({
      candidates: [
        candidate("Memory Lane/imports/bad-category.md", "---\nmemory_lane: true\ncategory: research\n---\nBody"),
        candidate("Memory Lane/imports/no-project.md", "---\nmemory_lane: true\nscope: project\n---\nBody"),
      ],
      existingMemories: existing,
      projectScopeKey: undefined,
    })

    assert.equal(result.summary.skipped, 2)
    assert.match(result.results[0].warnings.join("\n"), /Invalid category/u)
    assert.match(result.results[1].warnings.join("\n"), /Project scope is unavailable/u)
  })

  it("plans active id updates but skips deleted and missing ids", () => {
    const result = planObsidianImport({
      candidates: [
        candidate("Memory Lane/imports/update.md", "---\nmemory_lane: true\nmemory_lane_id: active1\nstatus: approved\n---\nUpdated text"),
        candidate("Memory Lane/imports/deleted.md", "---\nmemory_lane: true\nmemory_lane_id: deleted1\n---\nNope"),
        candidate("Memory Lane/imports/missing.md", "---\nmemory_lane: true\nmemory_lane_id: missing\n---\nNope"),
      ],
      existingMemories: existing,
      projectScopeKey: "proj",
    })

    assert.equal(result.summary.wouldUpdate, 1)
    assert.equal(result.summary.skipped, 2)
    assert.equal(result.results[0].action, "update")
    assert.equal(result.results[0].memoryId, "active1")
    assert.match(result.results[1].warnings.join("\n"), /not active/u)
    assert.match(result.results[2].warnings.join("\n"), /not found/u)
  })

  it("skips duplicate target ids and duplicate create text inside the same run", () => {
    const result = planObsidianImport({
      candidates: [
        candidate("Memory Lane/imports/a.md", "---\nmemory_lane: true\nmemory_lane_id: active1\n---\nA"),
        candidate("Memory Lane/imports/b.md", "---\nmemory_lane: true\nmemory_lane_id: active1\n---\nB"),
        candidate("Memory Lane/imports/c.md", "---\nmemory_lane: true\n---\nSame"),
        candidate("Memory Lane/imports/d.md", "---\nmemory_lane: true\n---\nSame"),
      ],
      existingMemories: existing,
      projectScopeKey: "proj",
    })

    assert.equal(result.summary.skipped, 4)
    assert.match(result.results[0].warnings.join("\n"), /Duplicate memory_lane_id/u)
    assert.match(result.results[2].warnings.join("\n"), /Duplicate create text/u)
  })
})
```

- [x] **Step 4: Run tests to verify they fail**

Run:

```bash
pnpm --filter @memory-lane/obsidian-import test
```

Expected: fail because the package and exported functions do not exist yet.

- [x] **Step 5: Create package manifest and TypeScript config**

Create `packages/obsidian-import/package.json`:

```json
{
  "name": "@memory-lane/obsidian-import",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "node --test --import tsx test/*.test.ts"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.4.0"
  }
}
```

Create `packages/obsidian-import/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [x] **Step 6: Implement types**

Create `packages/obsidian-import/src/types.ts`:

```ts
export type ImportCategory = "preference" | "personal" | "project"
export type ImportScopeType = "global" | "project"
export type ImportStatus = "pending" | "approved" | "rejected" | "deleted"
export type ImportKind =
  | "preference"
  | "personal_context"
  | "project_fact"
  | "project_checkpoint"
  | "workflow_rule"
  | "decision"
  | "misc"

export interface ObsidianImportSettings {
  vaultPath: string
  folder?: string
}

export interface ImportCandidate {
  absolutePath: string
  relativePath: string
  content: string
}

export interface ImportMemorySnapshot {
  id: string
  text: string
  category: ImportCategory
  scopeType: ImportScopeType
  scopeKey?: string
  status: ImportStatus
  kind?: ImportKind
}

export interface ParsedImportMarkdown {
  hasFrontmatter: boolean
  frontmatter: Record<string, string | boolean>
  body: string
  warnings: string[]
}

export type PlannedImportAction = "create" | "update" | "skip" | "ignore"

export interface PlannedImportResult {
  path: string
  action: PlannedImportAction
  text?: string
  memoryId?: string
  category?: ImportCategory
  scopeType?: ImportScopeType
  status?: "pending" | "approved"
  kind?: ImportKind
  warnings: string[]
}

export interface ImportPlanSummary {
  wouldCreate: number
  wouldUpdate: number
  skipped: number
  ignored: number
}

export interface ImportPlan {
  summary: ImportPlanSummary
  results: PlannedImportResult[]
  warnings: string[]
}
```

- [x] **Step 7: Implement constrained frontmatter parser**

Create `packages/obsidian-import/src/frontmatter.ts`:

```ts
import type { ParsedImportMarkdown } from "./types.js"

const RECOGNIZED = new Set([
  "memory_lane",
  "memory_lane_mirror",
  "memory_lane_id",
  "category",
  "scope",
  "status",
  "kind",
])

function scalar(raw: string): string | boolean {
  const trimmed = raw.trim()
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function parseImportMarkdown(content: string): ParsedImportMarkdown {
  if (!content.startsWith("---\n") && content !== "---") {
    return { hasFrontmatter: false, frontmatter: {}, body: content.trim(), warnings: [] }
  }

  const normalized = content.replace(/\r\n/gu, "\n")
  const lines = normalized.split("\n")
  if (lines[0] !== "---") return { hasFrontmatter: false, frontmatter: {}, body: normalized.trim(), warnings: [] }

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (end === -1) {
    return { hasFrontmatter: true, frontmatter: {}, body: "", warnings: ["Missing closing frontmatter delimiter."] }
  }

  const frontmatter: Record<string, string | boolean> = {}
  const warnings: string[] = []
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue
    const idx = line.indexOf(":")
    if (idx === -1) {
      warnings.push(`Invalid frontmatter line: ${line}`)
      continue
    }
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1)
    if (!RECOGNIZED.has(key)) continue
    frontmatter[key] = scalar(value)
  }

  return {
    hasFrontmatter: true,
    frontmatter,
    body: lines.slice(end + 1).join("\n").trim(),
    warnings,
  }
}
```

- [x] **Step 8: Implement discovery**

Create `packages/obsidian-import/src/discovery.ts`:

```ts
import * as fs from "node:fs"
import * as path from "node:path"
import type { ImportCandidate, ObsidianImportSettings } from "./types.js"

function folder(settings: ObsidianImportSettings): string {
  return settings.folder?.trim() || "Memory Lane"
}

export function importRoot(settings: ObsidianImportSettings): string {
  return path.join(settings.vaultPath, folder(settings), "imports")
}

function relativeFromVault(settings: ObsidianImportSettings, file: string): string {
  return path.relative(settings.vaultPath, file).split(path.sep).join("/")
}

function walk(dir: string, files: string[]): void {
  for (const name of fs.readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
    if (name.startsWith(".")) continue
    const full = path.join(dir, name)
    const stat = fs.lstatSync(full)
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) {
      walk(full, files)
      continue
    }
    if (stat.isFile() && name.endsWith(".md")) files.push(full)
  }
}

export function discoverImportFiles(settings: ObsidianImportSettings): ImportCandidate[] {
  const root = importRoot(settings)
  if (!fs.existsSync(root)) return []
  if (!fs.statSync(root).isDirectory()) return []

  const files: string[] = []
  walk(root, files)
  return files
    .map((absolutePath) => ({
      absolutePath,
      relativePath: relativeFromVault(settings, absolutePath),
      content: fs.readFileSync(absolutePath, "utf8"),
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}
```

- [x] **Step 9: Implement planner and exports**

Create `packages/obsidian-import/src/planner.ts`:

```ts
import type {
  ImportCandidate, ImportCategory, ImportKind, ImportMemorySnapshot,
  ImportPlan, ImportScopeType, PlannedImportResult,
} from "./types.js"
import { parseImportMarkdown } from "./frontmatter.js"

const CATEGORIES = new Set(["preference", "personal", "project"])
const SCOPES = new Set(["global", "project"])
const STATUSES = new Set(["pending", "approved"])
const KINDS = new Set(["preference", "personal_context", "project_fact", "project_checkpoint", "workflow_rule", "decision", "misc"])

interface PlanInput {
  candidates: ImportCandidate[]
  existingMemories: ImportMemorySnapshot[]
  projectScopeKey?: string
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function duplicateKey(text: string, category: ImportCategory, scopeType: ImportScopeType, projectScopeKey?: string): string {
  return [text.trim().toLowerCase().replace(/\s+/gu, " "), category, scopeType, scopeType === "project" ? projectScopeKey ?? "" : ""].join("|")
}

function skip(path: string, warnings: string[]): PlannedImportResult {
  return { path, action: "skip", warnings }
}

function validateCommon(path: string, parsed: ReturnType<typeof parseImportMarkdown>, projectScopeKey?: string): PlannedImportResult | undefined {
  const warnings = [...parsed.warnings]
  const fm = parsed.frontmatter

  if (fm.memory_lane_mirror === true) return skip(path, ["Import note is marked as a generated mirror file."])
  if (parsed.body.length === 0) return skip(path, ["Missing memory body."])

  const category = asString(fm.category)
  if (category && !CATEGORIES.has(category)) warnings.push(`Invalid category: ${category}`)
  const scope = asString(fm.scope)
  if (scope && !SCOPES.has(scope)) warnings.push(`Invalid scope: ${scope}`)
  const status = asString(fm.status)
  if (status && !STATUSES.has(status)) warnings.push(`Invalid status: ${status}`)
  const kind = asString(fm.kind)
  if (kind && !KINDS.has(kind)) warnings.push(`Invalid kind: ${kind}`)
  if ((scope ?? "global") === "project" && !projectScopeKey) warnings.push("Project scope is unavailable for this import note.")

  return warnings.length ? skip(path, warnings) : undefined
}

export function planObsidianImport(input: PlanInput): ImportPlan {
  const activeById = new Map(input.existingMemories.map((m) => [m.id, m]))
  const rawResults: PlannedImportResult[] = []

  for (const candidate of input.candidates) {
    const parsed = parseImportMarkdown(candidate.content)
    if (!parsed.hasFrontmatter || parsed.frontmatter.memory_lane !== true) {
      rawResults.push({ path: candidate.relativePath, action: "ignore", warnings: [] })
      continue
    }

    const invalid = validateCommon(candidate.relativePath, parsed, input.projectScopeKey)
    if (invalid) {
      rawResults.push(invalid)
      continue
    }

    const fm = parsed.frontmatter
    const memoryId = asString(fm.memory_lane_id)
    if (memoryId) {
      const existing = activeById.get(memoryId)
      if (!existing) {
        rawResults.push(skip(candidate.relativePath, [`memory_lane_id not found: ${memoryId}`]))
        continue
      }
      if (existing.status !== "approved" && existing.status !== "pending") {
        rawResults.push(skip(candidate.relativePath, [`memory_lane_id is not active: ${memoryId}`]))
        continue
      }
      const explicitScope = asString(fm.scope)
      if (explicitScope && explicitScope !== existing.scopeType) {
        rawResults.push(skip(candidate.relativePath, [`Scope changes are not supported for updates: ${memoryId}`]))
        continue
      }
      if (existing.scopeType === "project" && input.projectScopeKey && existing.scopeKey !== input.projectScopeKey) {
        rawResults.push(skip(candidate.relativePath, [`Project scope does not match existing memory: ${memoryId}`]))
        continue
      }
      const explicitStatus = asString(fm.status)
      if (existing.status === "approved" && explicitStatus === "pending") {
        rawResults.push(skip(candidate.relativePath, [`Approved memories cannot be demoted to pending by import: ${memoryId}`]))
        continue
      }
      rawResults.push({
        path: candidate.relativePath,
        action: "update",
        memoryId,
        text: parsed.body,
        category: asString(fm.category) as ImportCategory | undefined,
        scopeType: explicitScope as ImportScopeType | undefined,
        status: explicitStatus as "pending" | "approved" | undefined,
        kind: asString(fm.kind) as ImportKind | undefined,
        warnings: [],
      })
      continue
    }

    const category = (asString(fm.category) as ImportCategory | undefined) ?? "personal"
    const scopeType = (asString(fm.scope) as ImportScopeType | undefined) ?? "global"
    const status = (asString(fm.status) as "pending" | "approved" | undefined) ?? "pending"
    rawResults.push({
      path: candidate.relativePath,
      action: "create",
      text: parsed.body,
      category,
      scopeType,
      status,
      kind: asString(fm.kind) as ImportKind | undefined,
      warnings: [],
    })
  }

  const duplicateIds = new Set<string>()
  const idCounts = new Map<string, number>()
  for (const result of rawResults) {
    if (result.action === "update" && result.memoryId) idCounts.set(result.memoryId, (idCounts.get(result.memoryId) ?? 0) + 1)
  }
  for (const [id, count] of idCounts) if (count > 1) duplicateIds.add(id)

  const duplicateCreateKeys = new Set<string>()
  const createCounts = new Map<string, number>()
  for (const result of rawResults) {
    if (result.action !== "create" || !result.text || !result.category || !result.scopeType) continue
    const key = duplicateKey(result.text, result.category, result.scopeType, input.projectScopeKey)
    createCounts.set(key, (createCounts.get(key) ?? 0) + 1)
  }
  for (const [key, count] of createCounts) if (count > 1) duplicateCreateKeys.add(key)

  const existingKeys = new Set(input.existingMemories.map((m) => duplicateKey(m.text, m.category, m.scopeType, m.scopeKey)))

  const results = rawResults.map((result): PlannedImportResult => {
    if (result.action === "update" && result.memoryId && duplicateIds.has(result.memoryId)) {
      return skip(result.path, [`Duplicate memory_lane_id in import batch: ${result.memoryId}`])
    }
    if (result.action === "create" && result.text && result.category && result.scopeType) {
      const key = duplicateKey(result.text, result.category, result.scopeType, input.projectScopeKey)
      if (duplicateCreateKeys.has(key)) return skip(result.path, ["Duplicate create text in import batch."])
      if (existingKeys.has(key)) return skip(result.path, ["Duplicate memory text already exists."])
    }
    return result
  })

  const visible = results.filter((r) => r.action !== "ignore")
  return {
    summary: {
      wouldCreate: visible.filter((r) => r.action === "create").length,
      wouldUpdate: visible.filter((r) => r.action === "update").length,
      skipped: visible.filter((r) => r.action === "skip").length,
      ignored: results.filter((r) => r.action === "ignore").length,
    },
    results: visible,
    warnings: visible.flatMap((r) => r.warnings.map((warning) => `${r.path}: ${warning}`)),
  }
}
```

Create `packages/obsidian-import/src/index.ts`:

```ts
export * from "./types.js"
export * from "./frontmatter.js"
export * from "./discovery.js"
export * from "./planner.js"
```

- [x] **Step 10: Run package tests and build**

Run:

```bash
pnpm --filter @memory-lane/obsidian-import test
pnpm --filter @memory-lane/obsidian-import build
```

Expected: all `@memory-lane/obsidian-import` tests pass and package builds.

- [x] **Step 11: Commit Task 1**

Run:

```bash
git add packages/obsidian-import pnpm-lock.yaml
git commit -m "feat(obsidian): add import planner package"
```

---

## Task 2: Add Core Update API for Import Updates

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/test/engine.test.ts`

- [x] **Step 1: Write failing core update tests**

Add tests to the `MemoryEngine` describe block in `packages/core/test/engine.test.ts`:

```ts
  it("updates active memories with validation and preserves identity", () => {
    const e = engine()
    const saved = e.save({ text: "old text", category: "personal", status: "pending" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    const updated = e.update(saved.memory.id, { text: "new text", category: "project", status: "approved", kind: "project_fact" })

    assert.ok(updated)
    assert.equal(updated.id, saved.memory.id)
    assert.equal(updated.createdAt, saved.memory.createdAt)
    assert.equal(updated.text, "new text")
    assert.equal(updated.category, "project")
    assert.equal(updated.status, "approved")
    assert.equal(updated.kind, "project_fact")
    assert.equal(e.list({ all: true }).find((m) => m.id === saved.memory.id)?.text, "new text")
  })

  it("does not update rejected deleted or missing memories", () => {
    const e = engine()
    const saved = e.save({ text: "old text", status: "approved" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    e.reject(saved.memory.id)

    assert.equal(e.update(saved.memory.id, { text: "new text" }), undefined)
    assert.equal(e.update("missing", { text: "new text" }), undefined)
  })

  it("update returns mirror warnings without preventing JSONL update", () => {
    const missingVault = path.join(dir, "missing-vault")
    fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({
      obsidian: { enabled: true, vaultPath: missingVault, folder: "Memory Lane", mode: "mirror" },
    }), "utf8")
    const e = engine()
    const saved = e.save({ text: "old mirror update", status: "approved" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    const updated = e.update(saved.memory.id, { text: "new mirror update" })

    assert.ok(updated)
    assert.equal(updated.text, "new mirror update")
    assert.match(updated.warnings?.join("\n") ?? "", /Vault path does not exist/u)
    assert.equal(e.list({ all: true }).find((m) => m.id === saved.memory.id)?.text, "new mirror update")
  })
```

- [x] **Step 2: Run core tests to verify failure**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: fail because `MemoryEngine.update` is not defined.

- [x] **Step 3: Add update input type**

Modify `packages/core/src/types.ts` after `SaveInput`:

```ts
export interface UpdateInput {
  text?: string
  category?: MemoryCategory
  status?: Extract<MemoryStatus, "pending" | "approved">
  kind?: MemoryKind
}
```

- [x] **Step 4: Implement `MemoryEngine.update`**

Modify `packages/core/src/engine.ts` type imports to include `UpdateInput`:

```ts
MemoryKind, SaveInput, SaveResult, UpdateInput, MemoryMutationResult, ProjectScope,
```

Add this method after `suggest(...)` and before `approve(...)`:

```ts
  /** Update an active memory by id. Returns the updated memory plus mirror warnings, or undefined. */
  update(id: string, patch: UpdateInput): MemoryMutationResult | undefined {
    const mem = this.store.list().find((m) => m.id === id && (m.status === "approved" || m.status === "pending"))
    if (!mem) return undefined

    if (patch.text !== undefined) {
      const text = patch.text.trim()
      if (!text) throw new Error("Memory update text cannot be empty")
      if (containsLikelySecret(text)) throw new Error("Memory update text appears to contain a secret")
    }

    validateSaveInput({
      text: patch.text ?? mem.text,
      category: patch.category ?? mem.category,
      status: patch.status ?? mem.status,
      kind: patch.kind ?? mem.kind,
      scopeType: mem.scope.type,
      source: mem.source,
    })

    const updated = clone(mem, {
      text: patch.text?.trim() ?? mem.text,
      category: patch.category ?? mem.category,
      status: patch.status ?? mem.status,
      kind: patch.kind ?? mem.kind,
    })
    this.store.append(updated)
    this.invalidateEmbedding(id, updated.status === "approved" ? "updated" : "deleted")
    if (shouldAutoEmbed(updated, this.config.semantic, this.embProvider)) {
      this._embedMemory(updated).catch(() => { /* swallowed */ })
    }
    return this.mutationResultWithMirrorWarnings(updated)
  }
```

- [x] **Step 5: Run core tests**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: all core tests pass.

- [x] **Step 6: Commit Task 2**

Run:

```bash
git add packages/core/src/types.ts packages/core/src/engine.ts packages/core/test/engine.test.ts
git commit -m "feat(core): add memory update api"
```

---

## Task 3: Add CLI Dry-Run Import Command

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/test/cli.test.ts`

- [x] **Step 1: Add CLI dry-run integration tests**

Add tests in `packages/cli/test/cli.test.ts` near other Obsidian tests:

```ts
  it("obsidian import dry-run plans creates and skips without writing", () => {
    const home = tempDir()
    const vault = path.join(home, "Vault")
    const imports = path.join(vault, "Memory Lane", "imports")
    fs.mkdirSync(imports, { recursive: true })
    fs.writeFileSync(path.join(imports, "pnpm.md"), "---\nmemory_lane: true\ncategory: project\nstatus: approved\n---\nUse pnpm for installs", "utf8")
    fs.writeFileSync(path.join(imports, "draft.md"), "---\ncategory: project\n---\nIgnore me", "utf8")
    const env = {
      HOME: home,
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    runProcess(["obsidian", "init", "--vault", vault], { env })

    const result = runProcess(["obsidian", "import", "--dry-run", "--json"], { env })

    assert.equal(result.status, 0)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.data.summary.wouldCreate, 1)
    assert.equal(parsed.data.summary.wouldUpdate, 0)
    assert.equal(parsed.data.summary.skipped, 0)
    assert.equal(parsed.data.results[0].action, "create")
    assert.equal(parsed.data.results[0].status, "approved")
    const list = JSON.parse(run(["list", "--json"], env))
    assert.equal(list.data.memories.length, 0)
  })

  it("obsidian import dry-run requires configured mirror", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const result = runProcess(["obsidian", "import", "--dry-run"], { env })

    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /Obsidian mirror is not configured/u)
  })
```

- [x] **Step 2: Run CLI tests to verify failure**

Run:

```bash
pnpm --filter @memory-lane/cli test
```

Expected: fail because `obsidian import` is unknown and CLI does not depend on `@memory-lane/obsidian-import`.

- [x] **Step 3: Add CLI package dependency**

Modify `packages/cli/package.json` dependencies to include:

```json
"@memory-lane/obsidian-import": "workspace:*"
```

Run:

```bash
sfw pnpm install
```

Expected: lockfile updates workspace links.

- [x] **Step 4: Add import formatter**

Modify `packages/cli/src/formatters.ts` import types:

```ts
import type { ImportPlan, PlannedImportResult } from "@memory-lane/obsidian-import"
```

Add formatter:

```ts
export function formatImportPlan(plan: ImportPlan, json: boolean, dryRun: boolean): string {
  if (json) return JSON.stringify({ ok: true, data: plan, meta: meta() }, null, 2)

  const lines = [
    dryRun ? "Obsidian import dry run:" : "Obsidian import:",
    `${dryRun ? "Would import" : "Imported"}: ${plan.summary.wouldCreate}`,
    `${dryRun ? "Would update" : "Updated"}: ${plan.summary.wouldUpdate}`,
    `Skipped: ${plan.summary.skipped}`,
  ]
  const warnings = plan.results.flatMap((result: PlannedImportResult) => result.warnings.map((warning) => `${result.path}: ${warning}`))
  if (warnings.length) lines.push("Warnings:", ...warnings.map((warning) => `- ${warning}`))
  if (!plan.results.length) lines.push("No importable notes found. Create notes under Memory Lane/imports/ with memory_lane: true.")
  return lines.join("\n")
}
```

- [x] **Step 5: Add dry-run handler**

Modify `packages/cli/src/index.ts` imports:

```ts
import { discoverImportFiles, planObsidianImport } from "@memory-lane/obsidian-import"
```

Add helper near `configuredObsidian`:

```ts
function importSnapshots(engine: MemoryEngine) {
  return engine.list({ all: true }).map((m) => ({
    id: m.id,
    text: m.text,
    category: m.category,
    scopeType: m.scope.type,
    scopeKey: m.scope.key,
    status: m.status,
    kind: m.kind,
  }))
}
```

Inside `handleObsidian(ctx)` before the final usage error, add:

```ts
  if (sub === "import") {
    const cfg = configuredObsidian(ctx)
    if (!cfg.enabled || !cfg.vaultPath) {
      console.log(formatError(obsidianConfigRequiredMessage(), ctx.json))
      process.exit(1)
    }
    const dryRun = hasFlag(ctx.argv, "dry-run")
    if (!dryRun) {
      console.log(formatError("Usage: memory-lane obsidian import --dry-run", ctx.json))
      process.exit(2)
    }
    const candidates = discoverImportFiles({ vaultPath: cfg.vaultPath, folder: cfg.folder })
    const plan = planObsidianImport({
      candidates,
      existingMemories: importSnapshots(ctx.engine),
      projectScopeKey: ctx.engine.getProjectScope()?.key,
    })
    console.log(formatImportPlan(plan, ctx.json, true))
    return
  }
```

Also add `formatImportPlan` to the formatter import list.

- [x] **Step 6: Run CLI tests and build**

Run:

```bash
pnpm build
pnpm --filter @memory-lane/cli test
```

Expected: build passes and CLI dry-run tests pass.

- [x] **Step 7: Commit Task 3**

Run:

```bash
git add packages/cli/package.json packages/cli/src/formatters.ts packages/cli/src/index.ts packages/cli/test/cli.test.ts pnpm-lock.yaml
git commit -m "feat(cli): add obsidian import dry run"
```

---

## Task 4: Implement Apply Import and Full Conflict Behavior

**Files:**
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `packages/obsidian-mirror/src/sync.ts`
- Modify: `packages/obsidian-mirror/test/sync.test.ts`

- [x] **Step 1: Add apply integration tests**

Add tests in `packages/cli/test/cli.test.ts`:

```ts
  it("obsidian import applies creates and leaves source notes untouched", () => {
    const home = tempDir()
    const vault = path.join(home, "Vault")
    const imports = path.join(vault, "Memory Lane", "imports")
    fs.mkdirSync(imports, { recursive: true })
    const note = path.join(imports, "pnpm.md")
    fs.writeFileSync(note, "---\nmemory_lane: true\ncategory: project\nstatus: approved\n---\nUse pnpm for imports", "utf8")
    const env = { HOME: home, MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    runProcess(["obsidian", "init", "--vault", vault], { env })

    const result = runProcess(["obsidian", "import", "--json"], { env })

    assert.equal(result.status, 0)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.data.summary.created, 1)
    assert.equal(parsed.data.results[0].action, "created")
    assert.ok(parsed.data.results[0].memoryId)
    assert.equal(fs.readFileSync(note, "utf8"), "---\nmemory_lane: true\ncategory: project\nstatus: approved\n---\nUse pnpm for imports")
    const list = JSON.parse(run(["list", "--json"], env))
    assert.equal(list.data.memories[0].text, "Use pnpm for imports")
  })

  it("obsidian import applies updates by memory_lane_id", () => {
    const home = tempDir()
    const vault = path.join(home, "Vault")
    const imports = path.join(vault, "Memory Lane", "imports")
    fs.mkdirSync(imports, { recursive: true })
    const env = { HOME: home, MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    runProcess(["obsidian", "init", "--vault", vault], { env })
    run(["save", "Old imported text", "--status", "pending"], env)
    const before = JSON.parse(run(["list", "--json", "--all"], env))
    const id = before.data.memories[0].id
    fs.writeFileSync(path.join(imports, "update.md"), `---\nmemory_lane: true\nmemory_lane_id: ${id}\nstatus: approved\n---\nUpdated imported text`, "utf8")

    const result = runProcess(["obsidian", "import", "--json"], { env })

    assert.equal(result.status, 0)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.data.summary.updated, 1)
    const after = JSON.parse(run(["list", "--json", "--all"], env))
    assert.equal(after.data.memories[0].text, "Updated imported text")
    assert.equal(after.data.memories[0].status, "approved")
  })

  it("obsidian import supports partial success and skips invalid notes", () => {
    const home = tempDir()
    const vault = path.join(home, "Vault")
    const imports = path.join(vault, "Memory Lane", "imports")
    fs.mkdirSync(imports, { recursive: true })
    fs.writeFileSync(path.join(imports, "good.md"), "---\nmemory_lane: true\n---\nGood memory", "utf8")
    fs.writeFileSync(path.join(imports, "bad.md"), "---\nmemory_lane: true\ncategory: research\n---\nBad memory", "utf8")
    const env = { HOME: home, MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    runProcess(["obsidian", "init", "--vault", vault], { env })

    const result = runProcess(["obsidian", "import", "--json"], { env })

    assert.equal(result.status, 0)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.data.summary.created, 1)
    assert.equal(parsed.data.summary.skipped, 1)
    assert.match(JSON.stringify(parsed.data.results), /Invalid category/u)
  })
```

- [x] **Step 2: Add mirror init imports-folder test**

Add to `packages/obsidian-mirror/test/sync.test.ts`:

```ts
  it("init creates imports folder for user-authored import notes", () => {
    const vault = tempDir()
    fs.mkdirSync(vault, { recursive: true })

    const result = initObsidianMirror({ vaultPath: vault, folder: "Memory Lane" })

    assert.equal(result.ok, true)
    assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "imports")), true)
  })
```

- [x] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/obsidian-mirror test
```

Expected: CLI apply tests fail because apply is not implemented; mirror test fails because `imports/` is not created.

- [x] **Step 4: Create imports folder in mirror init/sync**

Modify `packages/obsidian-mirror/src/sync.ts`:

```ts
function importsDir(settings: ObsidianMirrorSettings): string {
  return path.join(mirrorRoot(settings), "imports")
}
```

In `initObsidianMirror`, after `fs.mkdirSync(memoriesDir(settings), { recursive: true })`, add:

```ts
  fs.mkdirSync(importsDir(settings), { recursive: true })
```

In `syncObsidianMirror`, inside `if (!dryRun)`, after creating `dir`, add:

```ts
    fs.mkdirSync(importsDir(settings), { recursive: true })
```

Update `readme()` bullet list to include:

```ts
    "- `imports/*.md` may contain user-authored notes for explicit import with `memory_lane: true`.",
```

- [x] **Step 5: Implement apply formatting and handler**

In `packages/cli/src/formatters.ts`, add apply-specific type and formatter:

```ts
export interface AppliedImportResult {
  path: string
  action: "created" | "updated" | "skipped"
  memoryId?: string
  status?: string
  warnings: string[]
}

export interface AppliedImportReport {
  summary: { created: number; updated: number; skipped: number }
  results: AppliedImportResult[]
}

export function formatAppliedImport(report: AppliedImportReport, json: boolean): string {
  if (json) return JSON.stringify({ ok: true, data: report, meta: meta() }, null, 2)
  const lines = [
    "Obsidian import:",
    `Imported: ${report.summary.created}`,
    `Updated: ${report.summary.updated}`,
    `Skipped: ${report.summary.skipped}`,
  ]
  const warnings = report.results.flatMap((result) => result.warnings.map((warning) => `${result.path}: ${warning}`))
  if (warnings.length) lines.push("Warnings:", ...warnings.map((warning) => `- ${warning}`))
  if (!report.results.length) lines.push("No importable notes found. Create notes under Memory Lane/imports/ with memory_lane: true.")
  return lines.join("\n")
}
```

In `packages/cli/src/index.ts`, add `formatAppliedImport` import and replace the dry-run-only error branch with apply logic:

```ts
    if (dryRun) {
      console.log(formatImportPlan(plan, ctx.json, true))
      return
    }

    const results = []
    for (const item of plan.results) {
      if (item.action === "skip") {
        results.push({ path: item.path, action: "skipped" as const, warnings: item.warnings })
        continue
      }
      if (item.action === "create") {
        const saved = ctx.engine.save({
          text: item.text ?? "",
          category: item.category,
          scopeType: item.scopeType,
          status: item.status,
          kind: item.kind,
          source: "manual",
        })
        if (saved.status === "saved") {
          results.push({ path: item.path, action: "created" as const, memoryId: saved.memory.id, status: saved.memory.status, warnings: saved.warnings ?? [] })
        } else {
          results.push({ path: item.path, action: "skipped" as const, warnings: [`Skipped: ${saved.reason}`, ...(saved.warnings ?? [])] })
        }
        continue
      }
      if (item.action === "update" && item.memoryId) {
        const updated = ctx.engine.update(item.memoryId, {
          text: item.text,
          category: item.category,
          status: item.status,
          kind: item.kind,
        })
        if (updated) {
          results.push({ path: item.path, action: "updated" as const, memoryId: updated.id, status: updated.status, warnings: updated.warnings ?? [] })
        } else {
          results.push({ path: item.path, action: "skipped" as const, memoryId: item.memoryId, warnings: [`Memory not found: ${item.memoryId}`] })
        }
      }
    }

    const report = {
      summary: {
        created: results.filter((r) => r.action === "created").length,
        updated: results.filter((r) => r.action === "updated").length,
        skipped: results.filter((r) => r.action === "skipped").length,
      },
      results,
    }
    console.log(formatAppliedImport(report, ctx.json))
    return
```

- [x] **Step 6: Run targeted tests**

Run:

```bash
pnpm build
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/obsidian-mirror test
```

Expected: all targeted tests pass.

- [x] **Step 7: Commit Task 4**

Run:

```bash
git add packages/cli/src/formatters.ts packages/cli/src/index.ts packages/cli/test/cli.test.ts packages/obsidian-mirror/src/sync.ts packages/obsidian-mirror/test/sync.test.ts
git commit -m "feat(obsidian): apply markdown imports"
```

---

## Task 5: Docs, Final Verification, and Review

**Files:**
- Modify: `README.md`
- Modify: `skills/memory-lane/SKILL.md`
- Modify: `docs/superpowers/plans/2026-06-03-obsidian-import-implementation.md`
- Modify if stale: `HANDOFF.md`

- [x] **Step 1: Update README Obsidian section**

Add this subsection near existing Obsidian mirror docs in `README.md`:

```md
### Import from Obsidian

Memory Lane can explicitly import user-authored Markdown notes from the configured Obsidian folder. Import is not automatic sync: JSONL remains the source of truth, generated mirror files are never imported, and source notes are not rewritten.

Create import notes under:

```text
<vault>/<folder>/imports/
```

Each importable note must opt in with frontmatter:

```md
---
memory_lane: true
category: project
scope: project
status: pending
---
Use pnpm for package installs.
```

Preview first:

```bash
memory-lane obsidian import --dry-run
```

Apply imports:

```bash
memory-lane obsidian import
```

Notes without `memory_lane: true` are ignored. Notes marked `memory_lane_mirror: true` are skipped because they are generated mirror files.
```
```

If the nested fenced code block causes Markdown formatting trouble, close and reopen fences explicitly; do not omit the examples.

- [x] **Step 2: Update Memory Lane skill docs**

In `skills/memory-lane/SKILL.md`, add:

```md
## Obsidian import

Use explicit import commands only when the user asks to import user-authored Obsidian notes into Memory Lane. Do not imply bidirectional sync and do not import generated mirror files.

Commands:

```bash
memory-lane obsidian import --dry-run
memory-lane obsidian import
```

Import notes live under `<vault>/<folder>/imports/` and must include `memory_lane: true` frontmatter. JSONL remains the source of truth.
```
```

- [x] **Step 3: Run full verification**

Run:

```bash
pnpm build
pnpm test
git status --short
```

Expected:
- build passes for all workspace packages;
- tests pass for all packages;
- only planned docs and code files are modified.

- [x] **Step 4: Request final code review**

Use reviewer subagent with this prompt:

```text
Review the Obsidian import implementation against docs/superpowers/specs/2026-06-03-obsidian-import-contract.md. Verify package boundaries, no core dependency in @memory-lane/obsidian-import, dry-run no writes, apply through MemoryEngine, source notes untouched, mirror files skipped, deterministic discovery, partial success, CLI JSON/human output, and docs. Do not modify files. Return APPROVED or ISSUES.
```

Expected: reviewer returns APPROVED or concrete issues to fix.

- [x] **Step 5: Fix review findings if any**

If review returns issues, write failing tests for each issue first. Then implement minimal fixes and rerun:

```bash
pnpm build
pnpm test
```

Expected: all tests pass and reviewer concerns are addressed.

- [x] **Step 6: Mark plan tasks complete**

As each task is completed, update this plan by changing each completed checkbox from `- [ ]` to `- [x]`. Commit the plan update with the related task or as a final docs tracking commit.

- [x] **Step 7: Commit final docs/review state**

Run:

```bash
git add README.md skills/memory-lane/SKILL.md docs/superpowers/plans/2026-06-03-obsidian-import-implementation.md HANDOFF.md
git commit -m "docs: document obsidian import workflow"
```

- [x] **Step 8: Final status report**

Run:

```bash
git log --oneline -8
git status --short --branch
```

Expected: feature branch is clean and ready to merge after user approval.

---

## Self-Review

### Spec coverage

- Dedicated `imports/` discovery: Task 1 discovery tests/implementation.
- `memory_lane: true` marker and `memory_lane_mirror: true` skip: Task 1 planner tests/implementation.
- Body-as-text and scalar frontmatter: Task 1 parser tests/implementation.
- Create/update/conflict semantics: Task 1 planner and Task 2 core update API.
- Dry-run no writes: Task 3 CLI dry-run test verifies list remains empty.
- Apply through `MemoryEngine`: Task 4 handler uses `engine.save` and `engine.update`.
- Source notes untouched: Task 4 apply test asserts source file content is unchanged.
- Partial success: Task 4 partial-success test.
- `obsidian init` import folder support: Task 4 mirror init test/implementation.
- Docs: Task 5 README and skill updates.

### Placeholder scan

No `TBD`, `TODO`, `fill in details`, or unbounded “add tests” placeholders remain. Each task has exact files, commands, and representative code/test content.

### Type consistency

The plan uses:

- `ImportCandidate`, `ImportMemorySnapshot`, `ImportPlan`, and `PlannedImportResult` from `@memory-lane/obsidian-import`.
- `UpdateInput` and existing `MemoryMutationResult` in core.
- `formatImportPlan` for dry-run and `formatAppliedImport` for apply output.
- CLI command shape `memory-lane obsidian import [--dry-run] [--json]` matching the import contract.
