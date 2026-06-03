# Obsidian Mirror Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in one-way Obsidian mirror support while keeping JSONL as Memory Lane's source of truth.

**Architecture:** Add Obsidian mirror configuration to `@memory-lane/core`, add a focused `@memory-lane/obsidian-mirror` package for Markdown rendering/sync, expose `memory-lane obsidian init/status/sync`, then wire best-effort mirror updates from `MemoryEngine` after successful JSONL writes. The mirror is a generated projection only: active `approved|pending` records become `memories/<id>.md`; `rejected|deleted` records are removed from the generated mirror folder.

**Tech Stack:** TypeScript ESM, Node.js stdlib (`fs`, `path`, `os`), pnpm workspace packages, `node:test` with `tsx`, existing `MemoryEngine`/config/storage patterns.

---

## File Map

- Create: `packages/obsidian-mirror/package.json` — workspace package metadata.
- Create: `packages/obsidian-mirror/tsconfig.json` — TypeScript build config.
- Create: `packages/obsidian-mirror/src/index.ts` — public exports.
- Create: `packages/obsidian-mirror/src/markdown.ts` — frontmatter escaping, title generation, Markdown rendering.
- Create: `packages/obsidian-mirror/src/sync.ts` — path validation, folder initialization, sync/dry-run/status.
- Create: `packages/obsidian-mirror/test/markdown.test.ts` — renderer/frontmatter tests.
- Create: `packages/obsidian-mirror/test/sync.test.ts` — init/sync/status/stale deletion tests.
- Modify: `packages/core/src/types.ts` — add Obsidian mirror config and optional warnings on save results.
- Modify: `packages/core/src/config.ts` — validate and persist optional `obsidian` config.
- Modify: `packages/core/src/index.ts` — export config types if needed.
- Modify: `packages/core/src/engine.ts` — best-effort mirror side effects after successful writes.
- Modify: `packages/core/test/config.test.ts` — config validation tests.
- Modify: `packages/core/test/engine.test.ts` — engine mirror side-effect/warning tests.
- Modify: `packages/cli/package.json` — depend on `@memory-lane/obsidian-mirror`.
- Modify: `packages/cli/src/index.ts` — add `obsidian` subcommands.
- Modify: `packages/cli/src/formatters.ts` — CLI usage/help and warning output.
- Modify: `packages/cli/test/cli.test.ts` — CLI init/status/sync tests.
- Modify: `README.md` — document opt-in Obsidian mirror.
- Modify: `skills/memory-lane/SKILL.md` — add Obsidian mirror commands.
- Modify: `pnpm-lock.yaml` — workspace dependency update after `sfw pnpm install`.

---

## Task 1: Core Config Contract

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/test/config.test.ts`

- [x] **Step 1: Write failing config tests**

Append tests to `packages/core/test/config.test.ts` near existing config validation tests:

```ts
test("validateConfig accepts disabled obsidian mirror config", () => {
  const config = validateConfig({
    semantic: {
      enabled: false,
      activeEmbeddingProfile: "local-example",
      embeddings: { profiles: {} },
      retrieval: {
        topK: 8,
        minSimilarity: 0.25,
        semanticWeight: 0.65,
        lexicalWeight: 0.25,
        recencyWeight: 0.1,
        fallbackToAllVisibleOnMiss: true,
      },
      privacy: { allowRemoteEmbeddings: false },
    },
    obsidian: { enabled: false },
  })

  assert.equal(config.obsidian?.enabled, false)
})

test("validateConfig accepts enabled obsidian mirror config", () => {
  const config = validateConfig({
    semantic: {
      enabled: false,
      activeEmbeddingProfile: "local-example",
      embeddings: { profiles: {} },
      retrieval: {
        topK: 8,
        minSimilarity: 0.25,
        semanticWeight: 0.65,
        lexicalWeight: 0.25,
        recencyWeight: 0.1,
        fallbackToAllVisibleOnMiss: true,
      },
      privacy: { allowRemoteEmbeddings: false },
    },
    obsidian: {
      enabled: true,
      vaultPath: "/tmp/memory-lane-vault",
      folder: "Memory Lane",
      mode: "mirror",
    },
  })

  assert.deepEqual(config.obsidian, {
    enabled: true,
    vaultPath: "/tmp/memory-lane-vault",
    folder: "Memory Lane",
    mode: "mirror",
  })
})

test("validateConfig rejects unsafe obsidian folder", () => {
  assert.throws(() => validateConfig({
    semantic: {
      enabled: false,
      activeEmbeddingProfile: "local-example",
      embeddings: { profiles: {} },
      retrieval: {
        topK: 8,
        minSimilarity: 0.25,
        semanticWeight: 0.65,
        lexicalWeight: 0.25,
        recencyWeight: 0.1,
        fallbackToAllVisibleOnMiss: true,
      },
      privacy: { allowRemoteEmbeddings: false },
    },
    obsidian: {
      enabled: true,
      vaultPath: "/tmp/memory-lane-vault",
      folder: "../escape",
      mode: "mirror",
    },
  }), /obsidian\.folder/)
})
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: FAIL because `SemanticMemoryConfig` has no `obsidian` property or validation rejects unknown shape incorrectly.

- [x] **Step 3: Add types and validation**

In `packages/core/src/types.ts`, replace the current `SemanticMemoryConfig` interface with this expanded shape:

```ts
export interface ObsidianMirrorConfig {
  enabled: boolean
  vaultPath?: string
  folder?: string
  mode?: "mirror"
}

export interface SemanticMemoryConfig {
  semantic: {
    enabled: boolean
    activeEmbeddingProfile: string
    embeddings: { profiles: Record<string, EmbeddingProfileConfig> }
    retrieval: {
      topK: number
      minSimilarity: number
      semanticWeight: number
      lexicalWeight: number
      recencyWeight: number
      fallbackToAllVisibleOnMiss: boolean
    }
    privacy: { allowRemoteEmbeddings: boolean }
  }
  obsidian?: ObsidianMirrorConfig
}
```

In `packages/core/src/config.ts`, update `DEFAULT_CONFIG` to include disabled Obsidian config:

```ts
export const DEFAULT_CONFIG: SemanticMemoryConfig = {
  semantic: {
    enabled: false,
    activeEmbeddingProfile: "local-example",
    embeddings: { profiles: {} },
    retrieval: {
      topK: 8,
      minSimilarity: 0.25,
      semanticWeight: 0.65,
      lexicalWeight: 0.25,
      recencyWeight: 0.1,
      fallbackToAllVisibleOnMiss: true,
    },
    privacy: { allowRemoteEmbeddings: false },
  },
  obsidian: { enabled: false },
}
```

Add helpers in `packages/core/src/config.ts` after `num()`:

```ts
function optionalStr(v: unknown, p: string): string | undefined {
  if (v === undefined) return undefined
  return str(v, p)
}

function validateObsidianFolder(folder: string, p: string): void {
  if (path.isAbsolute(folder) || folder.split(/[\\/]+/u).includes("..")) {
    throw new ConfigError(`${p} must be a relative path inside the vault`)
  }
}

function validateObsidianConfig(v: unknown): void {
  if (v === undefined) return
  const o = obj(v, "obsidian")
  const enabled = bool(o.enabled, "obsidian.enabled")
  if (!enabled) return
  str(o.vaultPath, "obsidian.vaultPath")
  const folder = optionalStr(o.folder, "obsidian.folder") ?? "Memory Lane"
  validateObsidianFolder(folder, "obsidian.folder")
  if (o.mode !== "mirror") throw new ConfigError("obsidian.mode must be mirror")
}
```

Call `validateObsidianConfig(root.obsidian)` inside `validateConfig()` before the return.

- [x] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/config.ts packages/core/test/config.test.ts
git commit -m "feat(core): add obsidian mirror config"
```

---

## Task 2: Obsidian Mirror Renderer and Sync Package

**Files:**
- Create: `packages/obsidian-mirror/package.json`
- Create: `packages/obsidian-mirror/tsconfig.json`
- Create: `packages/obsidian-mirror/src/index.ts`
- Create: `packages/obsidian-mirror/src/markdown.ts`
- Create: `packages/obsidian-mirror/src/sync.ts`
- Create: `packages/obsidian-mirror/test/markdown.test.ts`
- Create: `packages/obsidian-mirror/test/sync.test.ts`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: Create package metadata only**

Create `packages/obsidian-mirror/package.json`:

```json
{
  "name": "@memory-lane/obsidian-mirror",
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
  "dependencies": {
    "@memory-lane/core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.4.0"
  }
}
```

Create `packages/obsidian-mirror/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": false
  },
  "include": ["src"]
}
```

Create empty source directory with `packages/obsidian-mirror/src/index.ts`:

```ts
export {}
```

Run:

```bash
sfw pnpm install
```

Expected: workspace lockfile updates and package is discoverable.

- [x] **Step 2: Write failing renderer tests**

Create `packages/obsidian-mirror/test/markdown.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import type { MemoryRecord } from "@memory-lane/core"
import { renderMemoryMarkdown, mirrorFileName } from "../src/markdown.ts"

const baseMemory: MemoryRecord = {
  id: "c6d6e4c9",
  status: "approved",
  category: "project",
  text: "This repo uses pnpm for package management.",
  scope: { type: "project", key: "/repo" },
  source: "agent-suggested",
  createdAt: "2026-05-29T00:00:00.000Z",
  updatedAt: "2026-05-29T00:00:00.000Z",
  kind: "workflow_rule",
  provenance: {
    adapter: "claude",
    lifecycleEvent: "turn_stop",
    sessionId: "session-1",
    turnId: "turn-1",
    toolName: "Bash",
  },
}

test("mirrorFileName uses stable memory id", () => {
  assert.equal(mirrorFileName(baseMemory), "c6d6e4c9.md")
})

test("renderMemoryMarkdown writes generated warning frontmatter title and body", () => {
  const markdown = renderMemoryMarkdown(baseMemory)
  assert.match(markdown, /^---\n/u)
  assert.match(markdown, /memory_lane_id: "c6d6e4c9"/u)
  assert.match(markdown, /memory_lane_mirror: true/u)
  assert.match(markdown, /status: "approved"/u)
  assert.match(markdown, /category: "project"/u)
  assert.match(markdown, /kind: "workflow_rule"/u)
  assert.match(markdown, /scope_type: "project"/u)
  assert.match(markdown, /scope_key: "\/repo"/u)
  assert.match(markdown, /source: "agent-suggested"/u)
  assert.match(markdown, /provenance_adapter: "claude"/u)
  assert.match(markdown, /provenance_lifecycle_event: "turn_stop"/u)
  assert.match(markdown, /provenance_tool_name: "Bash"/u)
  assert.match(markdown, /<!-- Generated by Memory Lane\. Do not edit this file directly; changes may be overwritten\. -->/u)
  assert.match(markdown, /# This repo uses pnpm for package management\./u)
  assert.match(markdown, /\nThis repo uses pnpm for package management\.\n$/u)
})

test("renderMemoryMarkdown escapes YAML scalar values", () => {
  const markdown = renderMemoryMarkdown({
    ...baseMemory,
    text: "Use colon: brackets [x] and quotes \"carefully\"",
    scope: { type: "project", key: "/repo:with:colon" },
  })
  assert.match(markdown, /scope_key: "\/repo:with:colon"/u)
  assert.match(markdown, /# Use colon: brackets \[x\] and quotes "carefully"/u)
})
```

- [x] **Step 3: Run renderer tests to verify RED**

Run:

```bash
pnpm --filter @memory-lane/obsidian-mirror test
```

Expected: FAIL because `markdown.ts` does not exist/export functions.

- [x] **Step 4: Implement renderer**

Create `packages/obsidian-mirror/src/markdown.ts`:

```ts
import type { MemoryRecord } from "@memory-lane/core"

export function mirrorFileName(memory: Pick<MemoryRecord, "id">): string {
  return `${memory.id}.md`
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function line(key: string, value: string | boolean | undefined): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === "boolean") return `${key}: ${value}`
  return `${key}: ${yamlString(value)}`
}

function titleFromText(text: string): string {
  const first = text.trim().split(/\r?\n/u)[0]?.replace(/^#+\s*/u, "") ?? "Memory"
  return first.length > 80 ? `${first.slice(0, 79)}…` : first
}

export function renderMemoryMarkdown(memory: MemoryRecord): string {
  const frontmatter = [
    line("memory_lane_id", memory.id),
    line("memory_lane_mirror", true),
    line("status", memory.status),
    line("category", memory.category),
    line("kind", memory.kind),
    line("scope_type", memory.scope.type),
    line("scope_key", memory.scope.key),
    line("source", memory.source),
    line("created_at", memory.createdAt),
    line("updated_at", memory.updatedAt),
    line("provenance_adapter", memory.provenance?.adapter),
    line("provenance_lifecycle_event", memory.provenance?.lifecycleEvent),
    line("provenance_tool_name", memory.provenance?.toolName),
    line("provenance_session_id", memory.provenance?.sessionId),
    line("provenance_turn_id", memory.provenance?.turnId),
  ].filter((entry): entry is string => entry !== undefined)

  return [
    "---",
    ...frontmatter,
    "---",
    "",
    "<!-- Generated by Memory Lane. Do not edit this file directly; changes may be overwritten. -->",
    "",
    `# ${titleFromText(memory.text)}`,
    "",
    memory.text.trim(),
    "",
  ].join("\n")
}
```

Update `packages/obsidian-mirror/src/index.ts`:

```ts
export * from "./markdown.js"
```

- [x] **Step 5: Add sync tests and implementation**

Create `packages/obsidian-mirror/test/sync.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { MemoryRecord } from "@memory-lane/core"
import { initObsidianMirror, syncObsidianMirror, statusObsidianMirror } from "../src/sync.ts"

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-obsidian-"))
}

const approved: MemoryRecord = {
  id: "11111111",
  status: "approved",
  category: "project",
  text: "Approved memory",
  scope: { type: "global" },
  source: "manual",
  createdAt: "2026-05-29T00:00:00.000Z",
  updatedAt: "2026-05-29T00:00:00.000Z",
}

const pending: MemoryRecord = { ...approved, id: "22222222", status: "pending", text: "Pending memory" }
const deleted: MemoryRecord = { ...approved, id: "33333333", status: "deleted", text: "Deleted memory" }

test("initObsidianMirror creates README and memories folder", () => {
  const vault = tempDir()
  const result = initObsidianMirror({ vaultPath: vault, folder: "Memory Lane" })
  assert.equal(result.ok, true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "README.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories")), true)
})

test("syncObsidianMirror writes active memories and skips deleted", () => {
  const vault = tempDir()
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved, pending, deleted])
  assert.equal(result.created, 2)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", "11111111.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", "22222222.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", "33333333.md")), false)
})

test("syncObsidianMirror dry-run reports without writing", () => {
  const vault = tempDir()
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved], { dryRun: true })
  assert.equal(result.created, 1)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", "11111111.md")), false)
})

test("syncObsidianMirror deletes stale generated files only", () => {
  const vault = tempDir()
  syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved])
  const stale = path.join(vault, "Memory Lane", "memories", "stale.md")
  fs.writeFileSync(stale, "---\nmemory_lane_mirror: true\n---\nold\n")
  const handwritten = path.join(vault, "Memory Lane", "memories", "handwritten.md")
  fs.writeFileSync(handwritten, "not generated\n")
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved])
  assert.equal(result.deleted, 1)
  assert.equal(fs.existsSync(stale), false)
  assert.equal(fs.existsSync(handwritten), true)
})

test("statusObsidianMirror validates missing vault", () => {
  const result = statusObsidianMirror({ vaultPath: path.join(tempDir(), "missing"), folder: "Memory Lane" })
  assert.equal(result.ok, false)
  assert.match(result.warnings.join("\n"), /does not exist/)
})
```

Create `packages/obsidian-mirror/src/sync.ts`:

```ts
import * as fs from "node:fs"
import * as path from "node:path"
import type { MemoryRecord } from "@memory-lane/core"
import { mirrorFileName, renderMemoryMarkdown } from "./markdown.js"

export interface ObsidianMirrorSettings {
  vaultPath: string
  folder?: string
}

export interface MirrorSyncResult {
  ok: boolean
  root: string
  created: number
  updated: number
  deleted: number
  warnings: string[]
}

function folder(settings: ObsidianMirrorSettings): string {
  return settings.folder?.trim() || "Memory Lane"
}

function mirrorRoot(settings: ObsidianMirrorSettings): string {
  return path.join(settings.vaultPath, folder(settings))
}

function memoriesDir(settings: ObsidianMirrorSettings): string {
  return path.join(mirrorRoot(settings), "memories")
}

function isActive(memory: MemoryRecord): boolean {
  return memory.status === "approved" || memory.status === "pending"
}

function generated(content: string): boolean {
  return /memory_lane_mirror:\s*true/u.test(content)
}

function readme(): string {
  return [
    "# Memory Lane",
    "",
    "This folder is generated by Memory Lane.",
    "",
    "- `memories/*.md` mirrors active approved and pending JSONL memory records.",
    "- JSONL remains the source of truth.",
    "- Do not edit generated memory files directly; changes may be overwritten.",
    "- Rebuild the mirror with `memory-lane obsidian sync`.",
    "",
  ].join("\n")
}

export function statusObsidianMirror(settings: ObsidianMirrorSettings): { ok: boolean; root: string; warnings: string[]; obsidianVault: boolean } {
  const warnings: string[] = []
  const root = mirrorRoot(settings)
  if (!fs.existsSync(settings.vaultPath)) warnings.push(`Vault path does not exist: ${settings.vaultPath}`)
  else if (!fs.statSync(settings.vaultPath).isDirectory()) warnings.push(`Vault path is not a directory: ${settings.vaultPath}`)
  const obsidianVault = fs.existsSync(path.join(settings.vaultPath, ".obsidian"))
  if (warnings.length === 0 && !obsidianVault) warnings.push("No .obsidian/ directory found; Memory Lane will still write Markdown here.")
  return { ok: warnings.every((warning) => !warning.startsWith("Vault path")), root, warnings, obsidianVault }
}

export function initObsidianMirror(settings: ObsidianMirrorSettings): MirrorSyncResult {
  const status = statusObsidianMirror(settings)
  if (!status.ok) return { ok: false, root: status.root, created: 0, updated: 0, deleted: 0, warnings: status.warnings }
  fs.mkdirSync(memoriesDir(settings), { recursive: true })
  const readmePath = path.join(mirrorRoot(settings), "README.md")
  if (!fs.existsSync(readmePath)) fs.writeFileSync(readmePath, readme(), "utf8")
  return { ok: true, root: status.root, created: 0, updated: 0, deleted: 0, warnings: status.warnings }
}

export function syncObsidianMirror(settings: ObsidianMirrorSettings, memories: MemoryRecord[], opts?: { dryRun?: boolean }): MirrorSyncResult {
  const status = statusObsidianMirror(settings)
  if (!status.ok) return { ok: false, root: status.root, created: 0, updated: 0, deleted: 0, warnings: status.warnings }
  const dryRun = opts?.dryRun === true
  const dir = memoriesDir(settings)
  if (!dryRun) {
    fs.mkdirSync(dir, { recursive: true })
    const readmePath = path.join(mirrorRoot(settings), "README.md")
    if (!fs.existsSync(readmePath)) fs.writeFileSync(readmePath, readme(), "utf8")
  }

  let created = 0
  let updated = 0
  let deleted = 0
  const active = memories.filter(isActive)
  const activeFiles = new Set(active.map(mirrorFileName))

  for (const memory of active) {
    const file = path.join(dir, mirrorFileName(memory))
    const next = renderMemoryMarkdown(memory)
    const exists = fs.existsSync(file)
    const current = exists ? fs.readFileSync(file, "utf8") : undefined
    if (!exists) created++
    else if (current !== next) updated++
    if (!dryRun && (!exists || current !== next)) fs.writeFileSync(file, next, "utf8")
  }

  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".md") || activeFiles.has(name)) continue
      const file = path.join(dir, name)
      const content = fs.readFileSync(file, "utf8")
      if (!generated(content)) continue
      deleted++
      if (!dryRun) fs.rmSync(file)
    }
  }

  return { ok: true, root: status.root, created, updated, deleted, warnings: status.warnings }
}
```

Update `packages/obsidian-mirror/src/index.ts`:

```ts
export * from "./markdown.js"
export * from "./sync.js"
```

Run:

```bash
pnpm --filter @memory-lane/obsidian-mirror test
pnpm build
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/obsidian-mirror pnpm-lock.yaml
git commit -m "feat(obsidian): add mirror renderer and sync"
```

---

## Task 3: CLI Obsidian Commands and Documentation

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `README.md`
- Modify: `skills/memory-lane/SKILL.md`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: Add CLI dependency and install**

Modify `packages/cli/package.json` dependencies to include:

```json
"@memory-lane/obsidian-mirror": "workspace:*"
```

Run:

```bash
sfw pnpm install
```

Expected: lockfile updates.

- [x] **Step 2: Write failing CLI tests**

Append tests to `packages/cli/test/cli.test.ts` inside the CLI suite:

```ts
it("obsidian status reports unconfigured mirror", () => {
  const result = runProcess(["obsidian", "status"], {
    env: {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    },
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Obsidian mirror: disabled/)
})

it("obsidian init configures mirror and performs initial sync", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-vault-"))
  runProcess(["save", "This repo uses pnpm", "--category", "project"], {
    env: {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    },
  })

  const result = runProcess(["obsidian", "init", "--vault", vault], {
    env: {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    },
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Configured Obsidian mirror/)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "README.md")), true)
  const files = fs.readdirSync(path.join(vault, "Memory Lane", "memories"))
  assert.equal(files.length, 1)
})

it("obsidian sync dry-run does not write files", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-vault-"))
  runProcess(["config", "set", "obsidian", JSON.stringify({ enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" })], {
    env: {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    },
  })
  runProcess(["save", "Dry run memory", "--category", "project"], {
    env: {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    },
  })

  const result = runProcess(["obsidian", "sync", "--dry-run"], {
    env: {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    },
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Would create:/)
})
```

- [x] **Step 3: Run tests to verify RED**

Run:

```bash
pnpm --filter @memory-lane/cli test
```

Expected: FAIL because `obsidian` command is unknown.

- [x] **Step 4: Implement CLI commands**

In `packages/cli/src/index.ts`, add imports:

```ts
import * as path from "node:path"
import { initObsidianMirror, statusObsidianMirror, syncObsidianMirror } from "@memory-lane/obsidian-mirror"
```

If `path` is already imported by name, reuse the existing import pattern instead of duplicating.

Add helpers near config handlers:

```ts
function expandHome(input: string): string {
  if (input === "~") return process.env.HOME ?? input
  if (input.startsWith("~/")) return path.join(process.env.HOME ?? "", input.slice(2))
  return input
}

function configuredObsidian(ctx: CliContext): { enabled: boolean; vaultPath?: string; folder?: string; mode?: "mirror" } {
  const raw = readRawConfig(ctx.configPath) as any
  return raw?.obsidian ?? { enabled: false }
}
```

Add handler:

```ts
function handleObsidian(ctx: CliContext): void {
  const sub = ctx.rest[0]
  if (sub === "status") {
    const cfg = configuredObsidian(ctx)
    if (!cfg.enabled || !cfg.vaultPath) {
      console.log(ctx.json ? JSON.stringify({ ok: true, data: { enabled: false } }, null, 2) : "Obsidian mirror: disabled")
      return
    }
    const status = statusObsidianMirror({ vaultPath: cfg.vaultPath, folder: cfg.folder })
    console.log(ctx.json ? JSON.stringify({ ok: status.ok, data: status }, null, 2) : [`Obsidian mirror: enabled`, `Root: ${status.root}`, ...status.warnings.map((w) => `Warning: ${w}`)].join("\n"))
    return
  }

  if (sub === "init") {
    const vault = flag(ctx.argv, "vault")
    if (!vault) {
      console.log(formatError("Usage: memory-lane obsidian init --vault <path> [--folder <folder>]", ctx.json))
      process.exit(2)
    }
    const vaultPath = path.resolve(expandHome(vault))
    const folder = flag(ctx.argv, "folder") ?? "Memory Lane"
    writeConfig(ctx.configPath, { obsidian: { enabled: true, vaultPath, folder, mode: "mirror" } } as any)
    const init = initObsidianMirror({ vaultPath, folder })
    const sync = syncObsidianMirror({ vaultPath, folder }, ctx.engine.list({ all: true }))
    if (ctx.json) console.log(JSON.stringify({ ok: init.ok && sync.ok, data: { init, sync } }, null, 2))
    else console.log([`Configured Obsidian mirror at ${sync.root}`, `Synced active memories. Created: ${sync.created}, Updated: ${sync.updated}, Deleted: ${sync.deleted}`, ...sync.warnings.map((w) => `Warning: ${w}`)].join("\n"))
    return
  }

  if (sub === "sync") {
    const cfg = configuredObsidian(ctx)
    if (!cfg.enabled || !cfg.vaultPath) {
      console.log(formatError("Obsidian mirror is not configured. Run `memory-lane obsidian init --vault <path>`.", ctx.json))
      process.exit(1)
    }
    const result = syncObsidianMirror({ vaultPath: cfg.vaultPath, folder: cfg.folder }, ctx.engine.list({ all: true }), { dryRun: hasFlag(ctx.argv, "dry-run") })
    if (ctx.json) console.log(JSON.stringify({ ok: result.ok, data: result }, null, 2))
    else console.log([hasFlag(ctx.argv, "dry-run") ? "Obsidian mirror dry run:" : "Obsidian mirror synced:", `${hasFlag(ctx.argv, "dry-run") ? "Would create" : "Created"}: ${result.created}`, `${hasFlag(ctx.argv, "dry-run") ? "Would update" : "Updated"}: ${result.updated}`, `${hasFlag(ctx.argv, "dry-run") ? "Would delete" : "Deleted"}: ${result.deleted}`, ...result.warnings.map((w) => `Warning: ${w}`)].join("\n"))
    return
  }

  console.log(formatError("Usage: memory-lane obsidian init|status|sync", ctx.json))
  process.exit(2)
}
```

Add to `commandHandlers`:

```ts
obsidian: handleObsidian,
```

Update `packages/cli/src/formatters.ts` usage block with:

```text
  obsidian <init|status|sync>
                  Manage optional Obsidian Markdown mirror
```

- [x] **Step 5: Docs, tests, commit**

Update `README.md` with a short section:

```md
### Obsidian mirror

Obsidian support is opt-in. JSONL remains the source of truth; Memory Lane can mirror active approved and pending memories into generated Markdown files in an Obsidian-compatible vault.

```bash
memory-lane obsidian init --vault ~/Obsidian/MyVault
memory-lane obsidian status
memory-lane obsidian sync --dry-run
memory-lane obsidian sync
```

Generated files live under `Memory Lane/memories/<id>.md` by default. Do not edit generated files directly; changes may be overwritten. Obsidian import and Obsidian-backed storage are separate future phases.
```

Update `skills/memory-lane/SKILL.md` under CLI commands with:

```md
### Obsidian mirror

```bash
memory-lane obsidian init --vault ~/Obsidian/MyVault
memory-lane obsidian status
memory-lane obsidian sync --dry-run
memory-lane obsidian sync
```

The Obsidian mirror is opt-in and one-way: JSONL remains the source of truth and generated Markdown files may be overwritten.
```

Run:

```bash
pnpm --filter @memory-lane/cli test
pnpm build
```

Expected: PASS.

Commit:

```bash
git add packages/cli/package.json packages/cli/src/index.ts packages/cli/src/formatters.ts packages/cli/test/cli.test.ts README.md skills/memory-lane/SKILL.md pnpm-lock.yaml
git commit -m "feat(cli): add obsidian mirror commands"
```

---

## Task 4: Best-Effort MemoryEngine Mirror Updates

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/test/engine.test.ts`
- Modify: `packages/cli/src/formatters.ts`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: Add core dependency and write failing engine test**

Modify `packages/core/package.json` dependencies to include:

```json
"dependencies": {
  "@memory-lane/obsidian-mirror": "workspace:*"
}
```

Run:

```bash
sfw pnpm install
```

Append to `packages/core/test/engine.test.ts`:

```ts
test("save mirrors approved memory when obsidian mirror is configured", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-engine-mirror-"))
  const vault = path.join(dir, "vault")
  fs.mkdirSync(vault)
  const configPath = path.join(dir, "config.json")
  fs.writeFileSync(configPath, JSON.stringify({
    obsidian: { enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" },
  }), "utf8")
  const engine = new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath,
  })

  const result = engine.save({ text: "Mirror this memory", category: "project", status: "approved" })

  assert.equal(result.status, "saved")
  if (result.status === "saved") {
    assert.deepEqual(result.warnings, [])
    assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", `${result.memory.id}.md`)), true)
  }
})

test("delete removes mirrored file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-engine-mirror-"))
  const vault = path.join(dir, "vault")
  fs.mkdirSync(vault)
  const configPath = path.join(dir, "config.json")
  fs.writeFileSync(configPath, JSON.stringify({
    obsidian: { enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" },
  }), "utf8")
  const engine = new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath,
  })
  const saved = engine.save({ text: "Delete mirrored memory", category: "project", status: "approved" })
  assert.equal(saved.status, "saved")
  if (saved.status !== "saved") throw new Error("expected save")

  engine.delete(saved.memory.id)

  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", `${saved.memory.id}.md`)), false)
})
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: FAIL because `SaveResult` has no `warnings` and engine does not mirror.

- [x] **Step 3: Extend SaveResult and engine side effects**

In `packages/core/src/types.ts`, change `SaveResult` to:

```ts
export type SaveResult =
  | { status: "saved"; memory: MemoryRecord; warnings?: string[] }
  | { status: "skipped"; reason: "empty" | "secret" | "duplicate"; warnings?: string[] }
```

In `packages/core/src/engine.ts`, import:

```ts
import { syncObsidianMirror } from "@memory-lane/obsidian-mirror"
```

Add private helper inside `MemoryEngine`:

```ts
private mirrorWarnings(): string[] {
  const obsidian = this.config.obsidian
  if (!obsidian?.enabled || !obsidian.vaultPath) return []
  try {
    const result = syncObsidianMirror(
      { vaultPath: obsidian.vaultPath, folder: obsidian.folder },
      this.store.list(),
    )
    return result.ok ? result.warnings : result.warnings.length ? result.warnings : ["Obsidian mirror update failed"]
  } catch (error: any) {
    return [`Obsidian mirror update failed: ${error?.message ?? String(error)}`]
  }
}

private withMirrorWarnings(result: SaveResult): SaveResult {
  if (result.status !== "saved") return result
  const warnings = this.mirrorWarnings()
  return warnings.length ? { ...result, warnings } : { ...result, warnings: [] }
}
```

Wrap successful write paths:

```ts
return this.withMirrorWarnings(dup ? this.upgradePendingDuplicate(dup, input, ctx) : this.persistMemory(input, ctx))
```

For `approve`, `reject`, and `delete`, after `this.store.append(updated)` and invalidation, call `this.mirrorWarnings()` and ignore the result for now because those methods return `MemoryRecord | undefined`. The mirror still updates; CLI warning support for these status transitions can be a later slice.

- [x] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm build
```

Expected: PASS.

- [x] **Step 5: CLI warning formatting and commit**

In `packages/cli/src/formatters.ts`, update `formatSaveResult` saved case:

```ts
if (result.status === "saved") {
  const formatted = formatResult("Saved", result.memory, json)
  if (json || !result.warnings?.length) return formatted
  return [formatted, ...result.warnings.map((warning) => `Warning: ${warning}`)].join("\n")
}
```

Run:

```bash
pnpm --filter @memory-lane/cli test
pnpm build
```

Commit:

```bash
git add packages/core/package.json packages/core/src/types.ts packages/core/src/engine.ts packages/core/test/engine.test.ts packages/cli/src/formatters.ts pnpm-lock.yaml
git commit -m "feat(core): mirror memory writes to obsidian"
```

---

## Task 5: Final Verification and Review

**Files:**
- Potentially modify docs/tests discovered during final verification.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm build
pnpm test
git status --short
```

Expected: build/test PASS; only intentional changes are present.

- [x] **Step 2: Manual smoke test in temp vault**

Run:

```bash
tmp=$(mktemp -d)
vault="$tmp/vault"
store="$tmp/store"
mkdir -p "$vault" "$store"
MEMORY_LANE_FILE="$store/memory.jsonl" \
MEMORY_LANE_EMBEDDINGS_FILE="$store/embeddings.jsonl" \
MEMORY_LANE_CONFIG="$store/config.json" \
node packages/cli/dist/index.js save "Obsidian mirror smoke test" --category project
MEMORY_LANE_FILE="$store/memory.jsonl" \
MEMORY_LANE_EMBEDDINGS_FILE="$store/embeddings.jsonl" \
MEMORY_LANE_CONFIG="$store/config.json" \
node packages/cli/dist/index.js obsidian init --vault "$vault"
find "$vault" -maxdepth 3 -type f | sort
```

Expected: output includes `README.md` and one file under `Memory Lane/memories/`.

- [x] **Step 3: Request code review**

Dispatch reviewer with this context:

```text
Review the feature branch implementing Phase 1 Slice 1 of Obsidian mirror support. Requirements: opt-in one-way mirror only; JSONL remains source of truth; generated one-file-per-active-memory Markdown under memories/<id>.md; init/status/sync --dry-run; best-effort MemoryEngine mirror updates; hooks/adapters should not own Obsidian logic; mirror failures must not break JSONL writes. Check config validation, path safety, generated file deletion safety, CLI behavior, tests, and docs.
```

- [x] **Step 4: Address review feedback**

Fix Critical/Important issues with TDD. For each fix:

```bash
pnpm build
pnpm test
```

Expected: PASS after fixes.

- [x] **Step 5: Final commit if needed**

If review fixes changed files:

```bash
git add <changed-files>
git commit -m "fix(obsidian): address mirror review feedback"
```

Then report that the branch is ready for merge.

---

## Self-Review

Spec coverage:
- Phase 1 Slice 1 config/path rules: Task 1.
- Markdown format/deletion rules: Task 2.
- `@memory-lane/obsidian-mirror` package: Task 2.
- CLI commands/docs/help: Task 3.
- Best-effort MemoryEngine updates: Task 4.
- Full verification/review: Task 5.

Known follow-up outside this plan:
- Rich Obsidian index pages are Phase 2.
- Obsidian import is Phase 3.
- Obsidian-backed storage is Phase 6+.
- More refined warning surfaces for `approve/reject/delete` can be added in a later slice if needed.
