# Obsidian Mirror UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the generated Obsidian mirror easier to browse by adding generated index files, lightweight tags, cheap doctor checks, and aligned docs while preserving JSONL as source of truth.

**Architecture:** Extend `@memory-lane/obsidian-mirror` with focused index rendering helpers and integrate them into existing mirror sync. Keep index files generated/read-only, deletion-safe, and independent from import. Add Obsidian doctor fields in core using cheap filesystem checks only.

**Tech Stack:** TypeScript, Node.js `fs`/`path`, built-in `node:test`, pnpm workspace packages.

---

## Scope

Implement the Phase 4 first slice only:

- Generated mirror index files:
  - `<vault>/<folder>/index.md`
  - `<vault>/<folder>/indexes/pending.md`
  - `<vault>/<folder>/indexes/approved.md`
  - `<vault>/<folder>/indexes/project.md`
  - `<vault>/<folder>/indexes/recent.md`
- Standard Markdown links to `memories/<id>.md`.
- Stable empty index files with explicit empty text.
- Safe stale generated-index deletion gated by both `memory_lane_mirror: true` and `memory_lane_index: true`.
- Lightweight tags on mirrored memory files and mirror index files.
- Cheap, non-mutating Obsidian doctor fields/warnings.
- Docs and manual testing updates.

Out of scope:

- One-file-per-project indexes.
- Obsidian wikilinks.
- Full mirror reconciliation diagnostics in doctor.
- Import dry-run secret warnings.
- Import snapshot type cleanup.
- Obsidian-backed storage.

---

## File structure

Create:

- `packages/obsidian-mirror/src/indexes.ts`
  - Renders all generated mirror index documents.
  - Provides stable relative paths for index files.
  - Provides stale generated-index detection helper.
- `packages/obsidian-mirror/test/indexes.test.ts`
  - Unit tests for index rendering, sorting/grouping, tags, empty states, links, and generated markers.

Modify:

- `packages/obsidian-mirror/src/markdown.ts`
  - Add lightweight `tags` frontmatter to mirrored memory files.
  - Export title helper if needed for index rendering.
- `packages/obsidian-mirror/src/sync.ts`
  - Create `indexes/` on non-dry-run sync/init.
  - Write index files during sync.
  - Include index created/updated/deleted counts in existing aggregate counts.
  - Delete stale generated index files safely.
  - Update generated mirror README text.
- `packages/obsidian-mirror/src/index.ts`
  - Export `indexes.ts` helpers.
- `packages/obsidian-mirror/test/sync.test.ts`
  - Add integration tests for index file creation, dry-run no writes, stale index deletion safety, and generated README text.
- `packages/core/src/engine.ts`
  - Add Obsidian doctor fields/warnings using cheap filesystem checks only.
- `packages/core/test/engine.test.ts`
  - Add doctor tests for disabled Obsidian, configured healthy folders, missing vault, and missing mirror/import folders.
- `README.md`
  - Document generated index files, tags, and browse workflow.
- `skills/memory-lane/SKILL.md`
  - Document agent-facing index behavior and generated/read-only rules.
- `docs/manual-testing/obsidian-mirror-import.md`
  - Add manual checks for index files and tags.
- `packages/cli/src/formatters.ts`
  - If needed, update help text wording around generated mirror/indexes.
- `ROADMAP.md`
  - Mark Phase 4 planning step complete only after implementation is complete, not during Task 1.
- `HANDOFF.md`
  - Update only in final docs task if it is stale.

---

## Task 1: Index renderer package unit

**Files:**
- Create: `packages/obsidian-mirror/src/indexes.ts`
- Create: `packages/obsidian-mirror/test/indexes.test.ts`
- Modify: `packages/obsidian-mirror/src/index.ts`

- [x] **Step 1: Write failing index renderer tests**

Create `packages/obsidian-mirror/test/indexes.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import type { MirrorMemoryRecord } from "../src/types.ts"
import { renderMirrorIndexes, mirrorIndexFileNames } from "../src/indexes.ts"

const base: MirrorMemoryRecord = {
  id: "11111111",
  status: "approved",
  category: "project",
  text: "Approved memory for pnpm installs",
  scope: { type: "global" },
  source: "manual",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
  kind: "project_fact",
}

const pending: MirrorMemoryRecord = {
  ...base,
  id: "22222222",
  status: "pending",
  category: "personal",
  text: "Pending memory for review",
  updatedAt: "2026-06-03T00:00:00.000Z",
  kind: "fact",
}

const project: MirrorMemoryRecord = {
  ...base,
  id: "33333333",
  text: "Project scoped memory",
  scope: { type: "project", key: "/repo/example" },
  updatedAt: "2026-06-04T00:00:00.000Z",
}

const deleted: MirrorMemoryRecord = {
  ...base,
  id: "44444444",
  status: "deleted",
  text: "Deleted memory",
}

test("mirrorIndexFileNames returns stable first-slice paths", () => {
  assert.deepEqual(mirrorIndexFileNames(), [
    "index.md",
    "indexes/pending.md",
    "indexes/approved.md",
    "indexes/project.md",
    "indexes/recent.md",
  ])
})

test("renderMirrorIndexes renders generated markers tags and markdown links", () => {
  const indexes = renderMirrorIndexes([base, pending, project, deleted])
  const landing = indexes.find((index) => index.path === "index.md")
  const pendingIndex = indexes.find((index) => index.path === "indexes/pending.md")
  assert.ok(landing)
  assert.ok(pendingIndex)
  assert.match(landing.content, /memory_lane_mirror: true/)
  assert.match(landing.content, /memory_lane_index: true/)
  assert.match(landing.content, /memory-lane\/index/)
  assert.match(landing.content, /\[Pending Memories\]\(indexes\/pending\.md\)/)
  assert.match(pendingIndex.content, /\[Pending memory for review\]\(\.\.\/memories\/22222222\.md\)/)
  assert.match(pendingIndex.content, /`pending` · `personal` · `fact` · `global` · updated 2026-06-03/)
  assert.doesNotMatch(pendingIndex.content, /44444444/)
})

test("renderMirrorIndexes groups project memories by project key", () => {
  const indexes = renderMirrorIndexes([base, project])
  const projectIndex = indexes.find((index) => index.path === "indexes/project.md")
  assert.ok(projectIndex)
  assert.match(projectIndex.content, /## \/repo\/example/)
  assert.match(projectIndex.content, /\[Project scoped memory\]\(\.\.\/memories\/33333333\.md\)/)
})

test("renderMirrorIndexes sorts recent memories by updatedAt descending", () => {
  const indexes = renderMirrorIndexes([base, pending, project])
  const recent = indexes.find((index) => index.path === "indexes/recent.md")
  assert.ok(recent)
  const text = recent.content
  assert.ok(text.indexOf("33333333.md") < text.indexOf("22222222.md"))
  assert.ok(text.indexOf("22222222.md") < text.indexOf("11111111.md"))
})

test("renderMirrorIndexes emits stable empty states", () => {
  const indexes = renderMirrorIndexes([])
  assert.equal(indexes.length, 5)
  assert.match(indexes.find((index) => index.path === "indexes/pending.md")!.content, /No pending memories\./)
  assert.match(indexes.find((index) => index.path === "indexes/approved.md")!.content, /No approved memories\./)
  assert.match(indexes.find((index) => index.path === "indexes/project.md")!.content, /No project-scoped memories\./)
  assert.match(indexes.find((index) => index.path === "indexes/recent.md")!.content, /No active memories\./)
})
```

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @memory-lane/obsidian-mirror test
```

Expected: FAIL because `../src/indexes.ts` does not exist.

- [x] **Step 3: Implement index renderer**

Create `packages/obsidian-mirror/src/indexes.ts`:

```ts
import type { MirrorMemoryRecord } from "./types.js"

export interface MirrorIndexFile {
  path: string
  content: string
}

const INDEX_PATHS = [
  "index.md",
  "indexes/pending.md",
  "indexes/approved.md",
  "indexes/project.md",
  "indexes/recent.md",
] as const

export function mirrorIndexFileNames(): string[] {
  return [...INDEX_PATHS]
}

function active(memories: MirrorMemoryRecord[]): MirrorMemoryRecord[] {
  return memories.filter((memory) => memory.status === "approved" || memory.status === "pending")
}

function titleFromText(text: string): string {
  const first = text.trim().split(/\r?\n/u)[0]?.replace(/^#+\s*/u, "") ?? "Memory"
  if (!first.trim()) return "Memory"
  return first.length > 80 ? `${first.slice(0, 79)}…` : first
}

function dateOnly(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  return date.toISOString().slice(0, 10)
}

function scopeLabel(memory: MirrorMemoryRecord): string {
  return memory.scope.type === "project" ? (memory.scope.key ?? "project") : "global"
}

function frontmatter(title: string): string[] {
  return [
    "---",
    "memory_lane_mirror: true",
    "memory_lane_index: true",
    `title: ${JSON.stringify(title)}`,
    "tags:",
    "  - memory-lane",
    "  - memory-lane/index",
    "---",
    "",
    "<!-- Generated by Memory Lane. Do not edit this file directly; changes may be overwritten. -->",
    "",
  ]
}

function entry(memory: MirrorMemoryRecord): string[] {
  const title = titleFromText(memory.text)
  const kind = memory.kind ?? "memory"
  return [
    `- [${title}](../memories/${memory.id}.md)`,
    `  - \`${memory.status}\` · \`${memory.category}\` · \`${kind}\` · \`${scopeLabel(memory)}\` · updated ${dateOnly(memory.updatedAt)}`,
  ]
}

function page(title: string, body: string[]): string {
  return [...frontmatter(title), `# ${title}`, "", ...body, ""].join("\n")
}

function listPage(title: string, memories: MirrorMemoryRecord[], empty: string): string {
  const body = memories.length ? memories.flatMap(entry) : [empty]
  return page(title, body)
}

function byUpdatedDesc(a: MirrorMemoryRecord, b: MirrorMemoryRecord): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
}

export function renderMirrorIndexes(memories: MirrorMemoryRecord[]): MirrorIndexFile[] {
  const activeMemories = active(memories)
  const pending = activeMemories.filter((memory) => memory.status === "pending").sort(byUpdatedDesc)
  const approved = activeMemories.filter((memory) => memory.status === "approved").sort(byUpdatedDesc)
  const recent = [...activeMemories].sort(byUpdatedDesc)
  const projectMemories = activeMemories
    .filter((memory) => memory.scope.type === "project")
    .sort((a, b) => (a.scope.key ?? "").localeCompare(b.scope.key ?? "") || byUpdatedDesc(a, b))

  const groupedProject: string[] = []
  if (!projectMemories.length) {
    groupedProject.push("No project-scoped memories.")
  } else {
    let current = ""
    for (const memory of projectMemories) {
      const key = memory.scope.key ?? "project"
      if (key !== current) {
        if (groupedProject.length) groupedProject.push("")
        groupedProject.push(`## ${key}`, "")
        current = key
      }
      groupedProject.push(...entry(memory))
    }
  }

  return [
    {
      path: "index.md",
      content: page("Memory Lane", [
        "Generated index for Memory Lane's Obsidian mirror.",
        "",
        "- [Pending Memories](indexes/pending.md)",
        "- [Approved Memories](indexes/approved.md)",
        "- [Project Memories](indexes/project.md)",
        "- [Recent Memories](indexes/recent.md)",
        "",
        "JSONL remains the source of truth. These index files are generated and may be overwritten.",
      ]),
    },
    { path: "indexes/pending.md", content: listPage("Pending Memories", pending, "No pending memories.") },
    { path: "indexes/approved.md", content: listPage("Approved Memories", approved, "No approved memories.") },
    { path: "indexes/project.md", content: page("Project Memories", groupedProject) },
    { path: "indexes/recent.md", content: listPage("Recent Memories", recent, "No active memories.") },
  ]
}

export function isGeneratedMirrorIndex(content: string): boolean {
  const lines = content.split(/\r?\n/u)
  if (lines[0] !== "---") return false
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (end === -1) return false
  const yaml = lines.slice(1, end)
  return yaml.some((line) => /^[ \t]*memory_lane_mirror[ \t]*:[ \t]*true[ \t]*$/u.test(line))
    && yaml.some((line) => /^[ \t]*memory_lane_index[ \t]*:[ \t]*true[ \t]*$/u.test(line))
}
```

Modify `packages/obsidian-mirror/src/index.ts`:

```ts
export * from "./indexes.js"
export * from "./markdown.js"
export * from "./sync.js"
export * from "./types.js"
```

- [x] **Step 4: Run tests and verify pass**

Run:

```bash
pnpm --filter @memory-lane/obsidian-mirror test
```

Expected: PASS for the new index renderer tests and existing mirror tests.

- [x] **Step 5: Commit**

```bash
git add packages/obsidian-mirror/src/indexes.ts packages/obsidian-mirror/src/index.ts packages/obsidian-mirror/test/indexes.test.ts
git commit -m "feat(obsidian): add mirror index renderer"
```

---

## Task 2: Sync generated indexes and add tags to mirrored memories

**Files:**
- Modify: `packages/obsidian-mirror/src/markdown.ts`
- Modify: `packages/obsidian-mirror/src/sync.ts`
- Modify: `packages/obsidian-mirror/test/sync.test.ts`

- [x] **Step 1: Write failing sync/tag tests**

Append tests to `packages/obsidian-mirror/test/sync.test.ts`:

```ts
test("rendered memory files include lightweight Obsidian tags", (t) => {
  const vault = tempDir(t)
  syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved])
  const file = path.join(vault, "Memory Lane", "memories", "11111111.md")
  const content = fs.readFileSync(file, "utf8")
  assert.match(content, /tags:\n  - memory-lane\n  - memory-lane\/memory\n  - memory-lane\/status\/approved\n  - memory-lane\/category\/project/)
  assert.match(content, /  - memory-lane\/kind\/project_fact/)
})

test("syncObsidianMirror writes generated index files", (t) => {
  const vault = tempDir(t)
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved, pending])
  assert.equal(result.ok, true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "index.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "indexes", "pending.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "indexes", "approved.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "indexes", "project.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "indexes", "recent.md")), true)
  const pendingIndex = fs.readFileSync(path.join(vault, "Memory Lane", "indexes", "pending.md"), "utf8")
  assert.match(pendingIndex, /memory_lane_index: true/)
  assert.match(pendingIndex, /\[Pending memory\]\(\.\.\/memories\/22222222\.md\)/)
})

test("syncObsidianMirror dry-run reports indexes without writing them", (t) => {
  const vault = tempDir(t)
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved], { dryRun: true })
  assert.equal(result.created, 6)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "index.md")), false)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "indexes")), false)
})

test("syncObsidianMirror deletes stale generated index files only", (t) => {
  const vault = tempDir(t)
  syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved])
  const stale = path.join(vault, "Memory Lane", "indexes", "old.md")
  fs.writeFileSync(stale, "---\nmemory_lane_mirror: true\nmemory_lane_index: true\n---\nold\n")
  const handwritten = path.join(vault, "Memory Lane", "indexes", "handwritten.md")
  fs.writeFileSync(handwritten, "---\nmemory_lane_mirror: true\n---\n# User note\n")
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved])
  assert.equal(result.deleted, 1)
  assert.equal(fs.existsSync(stale), false)
  assert.equal(fs.existsSync(handwritten), true)
})
```

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @memory-lane/obsidian-mirror test
```

Expected: FAIL because tags and index sync are not wired yet.

- [x] **Step 3: Add tags to memory frontmatter**

Modify `packages/obsidian-mirror/src/markdown.ts` so `renderMemoryMarkdown` includes tags after `memory_lane_mirror`:

```ts
function tagLines(memory: MirrorMemoryRecord): string[] {
  const kind = memory.kind ?? "memory"
  return [
    "tags:",
    "  - memory-lane",
    "  - memory-lane/memory",
    `  - memory-lane/status/${memory.status}`,
    `  - memory-lane/category/${memory.category}`,
    `  - memory-lane/kind/${kind}`,
  ]
}
```

Then include `...tagLines(memory)` in the `frontmatter` array immediately after `line("memory_lane_mirror", true)`.

- [x] **Step 4: Wire index sync**

Modify `packages/obsidian-mirror/src/sync.ts`:

- Import index helpers:

```ts
import { isGeneratedMirrorIndex, renderMirrorIndexes } from "./indexes.js"
```

- Add directory helper:

```ts
function indexesDir(settings: ObsidianMirrorSettings): string {
  return path.join(mirrorRoot(settings), "indexes")
}
```

- In `initObsidianMirror`, create `indexesDir(settings)`.
- In non-dry-run `syncObsidianMirror`, create `indexesDir(settings)`.
- After memory file writes, render indexes and count/write created/updated:

```ts
const indexFiles = renderMirrorIndexes(memories)
const activeIndexFiles = new Set(indexFiles.map((index) => path.basename(index.path)))

for (const index of indexFiles) {
  const file = path.join(mirrorRoot(settings), index.path)
  const base = path.basename(file)
  if (path.basename(index.path) !== base || index.path.includes("..")) throw new Error(`Unsafe mirror index path: ${index.path}`)
  const exists = fs.existsSync(file)
  const current = exists ? fs.readFileSync(file, "utf8") : undefined
  if (!exists) created++
  else if (current !== index.content) updated++
  if (!dryRun && (!exists || current !== index.content)) fs.writeFileSync(file, index.content, "utf8")
}
```

- Delete stale generated index files from `indexesDir(settings)` only:

```ts
const indexDir = indexesDir(settings)
if (fs.existsSync(indexDir)) {
  for (const name of fs.readdirSync(indexDir)) {
    if (!name.endsWith(".md") || activeIndexFiles.has(name)) continue
    const file = path.join(indexDir, name)
    const stat = fs.lstatSync(file)
    if (!stat.isFile()) continue
    const content = fs.readFileSync(file, "utf8")
    if (!isGeneratedMirrorIndex(content)) continue
    deleted++
    if (!dryRun) fs.rmSync(file)
  }
}
```

- Update `readme()` to mention `index.md`, `indexes/*.md`, generated/read-only semantics, and import location.

- [x] **Step 5: Run tests and verify pass**

Run:

```bash
pnpm --filter @memory-lane/obsidian-mirror test
pnpm build
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/obsidian-mirror/src/markdown.ts packages/obsidian-mirror/src/sync.ts packages/obsidian-mirror/test/sync.test.ts
git commit -m "feat(obsidian): sync generated mirror indexes"
```

---

## Task 3: Add cheap Obsidian doctor checks

**Files:**
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/test/engine.test.ts`

- [x] **Step 1: Write failing doctor tests**

Add tests to `packages/core/test/engine.test.ts` near existing doctor tests:

```ts
test("doctor reports disabled obsidian mirror", (t) => {
  const dir = tempDir(t)
  const engine = new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath: path.join(dir, "config.json"),
  })
  const report = engine.doctor()
  assert.equal(report.obsidianEnabled, false)
  assert.deepEqual(report.obsidianWarnings, [])
})

test("doctor reports healthy obsidian folders without writing", (t) => {
  const dir = tempDir(t)
  const vault = path.join(dir, "vault")
  fs.mkdirSync(path.join(vault, "Memory Lane", "memories"), { recursive: true })
  fs.mkdirSync(path.join(vault, "Memory Lane", "imports"), { recursive: true })
  const configPath = path.join(dir, "config.json")
  fs.writeFileSync(configPath, JSON.stringify({ obsidian: { enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" } }), "utf8")
  const engine = new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath,
  })
  const before = fs.readdirSync(path.join(vault, "Memory Lane")).sort()
  const report = engine.doctor()
  const after = fs.readdirSync(path.join(vault, "Memory Lane")).sort()
  assert.equal(report.obsidianEnabled, true)
  assert.equal(report.obsidianMirrorFolderExists, true)
  assert.equal(report.obsidianMemoriesFolderExists, true)
  assert.equal(report.obsidianImportsFolderExists, true)
  assert.deepEqual(report.obsidianWarnings, [])
  assert.deepEqual(after, before)
})

test("doctor reports obsidian folder warnings", (t) => {
  const dir = tempDir(t)
  const vault = path.join(dir, "vault")
  fs.mkdirSync(vault, { recursive: true })
  const configPath = path.join(dir, "config.json")
  fs.writeFileSync(configPath, JSON.stringify({ obsidian: { enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" } }), "utf8")
  const engine = new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath,
  })
  const report = engine.doctor()
  assert.equal(report.obsidianEnabled, true)
  assert.equal(report.obsidianMirrorFolderExists, false)
  assert.equal(report.obsidianMemoriesFolderExists, false)
  assert.equal(report.obsidianImportsFolderExists, false)
  assert.match((report.obsidianWarnings as string[]).join("\n"), /Mirror folder does not exist/)
  assert.match((report.obsidianWarnings as string[]).join("\n"), /memories\/ folder does not exist/)
  assert.match((report.obsidianWarnings as string[]).join("\n"), /imports\/ folder does not exist/)
})
```

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: FAIL because doctor does not include Obsidian fields yet.

- [x] **Step 3: Implement cheap doctor fields**

Modify `packages/core/src/engine.ts`:

- Add imports:

```ts
import * as fs from "node:fs"
import { isSafeMirrorFolder } from "@memory-lane/obsidian-mirror"
```

- Add private method inside `MemoryEngine`:

```ts
private obsidianDoctor(): Record<string, unknown> {
  const obsidian = this.config.obsidian
  const warnings: string[] = []
  if (!obsidian?.enabled) {
    return { obsidianEnabled: false, obsidianWarnings: warnings }
  }

  const folder = obsidian.folder?.trim() || "Memory Lane"
  const vaultPath = obsidian.vaultPath
  const folderSafe = isSafeMirrorFolder(folder)
  const mirrorRoot = vaultPath ? path.join(vaultPath, folder) : undefined
  const memories = mirrorRoot ? path.join(mirrorRoot, "memories") : undefined
  const imports = mirrorRoot ? path.join(mirrorRoot, "imports") : undefined

  if (!vaultPath) warnings.push("Obsidian vault path is missing.")
  else if (!fs.existsSync(vaultPath)) warnings.push(`Obsidian vault path does not exist: ${vaultPath}`)
  else if (!fs.statSync(vaultPath).isDirectory()) warnings.push(`Obsidian vault path is not a directory: ${vaultPath}`)
  if (!folderSafe) warnings.push("Obsidian mirror folder must be a relative path inside the vault.")
  if (mirrorRoot && !fs.existsSync(mirrorRoot)) warnings.push(`Mirror folder does not exist: ${mirrorRoot}`)
  if (memories && !fs.existsSync(memories)) warnings.push(`memories/ folder does not exist: ${memories}`)
  if (imports && !fs.existsSync(imports)) warnings.push(`imports/ folder does not exist: ${imports}`)

  return {
    obsidianEnabled: true,
    obsidianVaultPath: vaultPath,
    obsidianFolder: folder,
    obsidianMirrorRoot: mirrorRoot,
    obsidianMirrorFolderExists: mirrorRoot ? fs.existsSync(mirrorRoot) : false,
    obsidianMemoriesFolderExists: memories ? fs.existsSync(memories) : false,
    obsidianImportsFolderExists: imports ? fs.existsSync(imports) : false,
    obsidianWarnings: warnings,
  }
}
```

- Spread it into `doctor()` return:

```ts
return {
  configFile: this.configPath,
  configExists: true,
  semanticEnabled: config.enabled,
  memoryFile: this.memPath,
  embeddingFile: this.embPath,
  totalMemories: total,
  approvedMemories: mems.filter((m) => m.status === "approved").length,
  pendingMemories: mems.filter((m) => m.status === "pending").length,
  deletedMemories: mems.filter((m) => m.status === "deleted").length,
  embeddingCount: embs.length,
  deadWeightRatio: total ? mems.filter((m) => m.status === "deleted" || m.status === "rejected").length / total : 0,
  activeProfileName: config.activeEmbeddingProfile,
  projectScope: this.scope?.key ?? "none",
  ...this.obsidianDoctor(),
}
```

- [x] **Step 4: Run tests and verify pass**

Run:

```bash
pnpm --filter @memory-lane/core test
pnpm build
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/engine.ts packages/core/test/engine.test.ts
git commit -m "feat(obsidian): add mirror doctor checks"
```

---

## Task 4: Documentation, CLI help, and manual testing updates

**Files:**
- Modify: `README.md`
- Modify: `skills/memory-lane/SKILL.md`
- Modify: `docs/manual-testing/obsidian-mirror-import.md`
- Modify: `packages/cli/src/formatters.ts`
- Modify: `HANDOFF.md` if stale

- [x] **Step 1: Update README**

In `README.md`, expand the Obsidian mirror section to include:

```md
Generated mirror files include:

```text
Memory Lane/index.md
Memory Lane/indexes/pending.md
Memory Lane/indexes/approved.md
Memory Lane/indexes/project.md
Memory Lane/indexes/recent.md
Memory Lane/memories/<id>.md
```

Index files are generated mirror artifacts. They are safe to browse in Obsidian, but they are not user-authored import notes and may be overwritten by `memory-lane obsidian sync`.
```

Also document tags:

```md
Generated files include lightweight tags such as `memory-lane`, `memory-lane/memory`, `memory-lane/index`, and status/category/kind tags for Obsidian browsing, Bases, or Dataview filtering.
```

- [x] **Step 2: Update skill docs**

In `skills/memory-lane/SKILL.md`, add agent-facing rules:

```md
Generated mirror index files live at `index.md` and `indexes/*.md`. Treat them like generated mirror memory files: do not edit them as source notes, do not import them, and do not imply changes to indexes update JSONL memories.
```

- [x] **Step 3: Update manual testing guide**

In `docs/manual-testing/obsidian-mirror-import.md`, add checks after Obsidian init:

```bash
find "$ML_TEST_VAULT/Memory Lane" -maxdepth 2 -type f | sort
sed -n '1,80p' "$ML_TEST_VAULT/Memory Lane/index.md"
sed -n '1,80p' "$ML_TEST_VAULT/Memory Lane/indexes/recent.md"
```

Expected:

```text
index.md and indexes/*.md exist, include memory_lane_index: true, and link to memories/<id>.md with standard Markdown links.
```

- [x] **Step 4: Update CLI help if needed**

In `packages/cli/src/formatters.ts`, adjust Obsidian sync line to mention generated indexes:

```text
obsidian sync [--dry-run]
                  Reconcile generated mirror files and indexes
```

- [x] **Step 5: Run docs-adjacent verification**

Run:

```bash
pnpm build
pnpm test
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add README.md skills/memory-lane/SKILL.md docs/manual-testing/obsidian-mirror-import.md packages/cli/src/formatters.ts HANDOFF.md
git commit -m "docs: document obsidian mirror indexes"
```

If `HANDOFF.md` is unchanged, omit it from `git add`.

---

## Task 5: Final verification and plan tracking

**Files:**
- Modify: `docs/superpowers/plans/2026-06-04-obsidian-mirror-ux-polish.md`
- Modify: `ROADMAP.md` only if implementation completion status should be reflected after merge.

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm build
pnpm test
```

Expected: all workspace packages build and all tests pass.

- [ ] **Step 2: Run focused manual smoke test**

Use a disposable config/vault:

```bash
export ML_TEST_ROOT="$(mktemp -d)"
export MEMORY_LANE_FILE="$ML_TEST_ROOT/memory.jsonl"
export MEMORY_LANE_EMBEDDINGS_FILE="$ML_TEST_ROOT/embeddings.jsonl"
export MEMORY_LANE_CONFIG="$ML_TEST_ROOT/config.json"
export ML_TEST_VAULT="$ML_TEST_ROOT/TestVault"
mkdir -p "$ML_TEST_VAULT"
pnpm build
ML="node packages/cli/dist/index.js"
$ML save "Manual Phase 4 test memory" --status approved
$ML obsidian init --vault "$ML_TEST_VAULT"
test -f "$ML_TEST_VAULT/Memory Lane/index.md"
test -f "$ML_TEST_VAULT/Memory Lane/indexes/recent.md"
rg "memory_lane_index: true|\[Manual Phase 4 test memory\]" "$ML_TEST_VAULT/Memory Lane"
$ML doctor
rm -rf "$ML_TEST_ROOT"
```

Expected: index files exist, contain generated markers, link to the mirrored memory, and doctor prints Obsidian fields.

- [ ] **Step 3: Mark completed steps in this plan**

Replace unchecked boxes for completed tasks with checked boxes in `docs/superpowers/plans/2026-06-04-obsidian-mirror-ux-polish.md`.

- [ ] **Step 4: Commit plan tracking**

```bash
git add docs/superpowers/plans/2026-06-04-obsidian-mirror-ux-polish.md ROADMAP.md
git commit -m "docs: mark obsidian mirror ux polish complete"
```

Only include `ROADMAP.md` if it changed.

- [ ] **Step 5: Request final review before merge**

Ask a reviewer to validate:

- generated index safety and deletion gates;
- JSONL source-of-truth semantics;
- import does not treat indexes as source notes;
- doctor checks are non-mutating and cheap;
- docs and manual test guide match behavior;
- `pnpm build` and `pnpm test` pass.

---

## Self-review checklist

- Spec coverage: covered generated indexes, standard Markdown links, tags, doctor checks, docs, and deferred improvements.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation placeholders are used as plan requirements.
- Type consistency: new index renderer uses existing `MirrorMemoryRecord`; sync integration keeps existing `MirrorSyncResult` aggregate counts; doctor fields are plain report fields matching existing `doctor()` style.
- Scope guard: no import dry-run secret handling, import snapshot cleanup, wikilinks, one-file-per-project indexes, or full reconciliation diagnostics are included.
