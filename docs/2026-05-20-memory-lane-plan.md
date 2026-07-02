# Memory Lane — Implementation Plan

> **Status note:** This file is the original build plan and includes historical task snippets.
> Current user-facing API and storage behavior are summarized in `README.md` and `docs/2026-05-20-memory-lane-design.md`; newer core code routes engine storage through `MemoryEngineStorage` even when older task snippets below still show direct `this.store`, `this.memPath`, or `this.embPath` usage.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-harness, lightweight memory system with a core TypeScript library, CLI wrapper, and pi adapter.

**Architecture:** Three-package monorepo under `packages/`. Core (`@memory-lane/core`) is a pure Node.js library with zero harness dependencies, using append-only JSONL storage with in-memory cache and optional semantic retrieval. CLI (`@memory-lane/cli`) is a thin wrapper around core. Pi adapter wraps core in pi's extension system.

**Tech Stack:** TypeScript, Node.js built-in `node:test` + `node:assert/strict`, pnpm workspaces, no external runtime dependencies.

---

## Module Map

```
packages/core/src/
├── index.ts               # Public barrel — re-exports everything consumers need
├── types.ts               # All interfaces, types, and type guards
├── engine.ts              # MemoryEngine: facade that wires everything together
├── storage.ts             # MemoryStore: JSONL storage for memory records, cache, and batch append
├── storage-facade.ts      # MemoryEngineStorage seam for memories, embeddings, compaction, diagnostics, legacy project-memory diagnostics, and baselines
├── search.ts              # Lexical search, dedup, secret detection, scope matching
├── project-scope.ts       # Project identity resolution (scope file → git → global)
├── embedding-store.ts     # EmbeddingStore: JSONL storage for embedding + invalidation records
├── embedding-provider.ts  # OpenAI-compatible embedding provider (HTTP client)
├── scoring.ts             # Cosine similarity, lexical score, recency score, kind boost
├── retrieval.ts           # recall pipeline: semantic → lexical → all-visible fallback
├── config.ts              # Config loading, validation, deep merge
└── compact.ts             # Compaction for both stores

packages/core/test/
├── storage.test.ts
├── search.test.ts
├── project-scope.test.ts
├── scoring.test.ts
├── retrieval.test.ts
├── config.test.ts
├── engine.test.ts
└── helpers.ts             # Temp file/dir helpers, factory functions

packages/cli/src/
├── index.ts               # Entry point / bin — arg parsing + dispatch
├── formatters.ts          # JSON + human-readable output
├── commands/
│   ├── save.ts
│   ├── suggest.ts
│   ├── recall.ts
│   ├── list.ts
│   ├── search.ts
│   ├── delete.ts
│   ├── approve.ts
│   ├── reject.ts
│   ├── review.ts
│   ├── compact.ts
│   ├── doctor.ts
│   ├── reindex.ts
│   └── status.ts

packages/pi-adapter/src/
└── index.ts               # pi extension wrapping MemoryEngine
```

---

## Phase 1: Core Engine Foundation

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json` (root workspace)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts` (stub)
- Create: `packages/core/test/helpers.ts`

- [ ] **Step 1: Write root workspace package.json**

```json
{
  "name": "memory-lane",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "test:core": "pnpm --filter @memory-lane/core test",
    "test:cli": "pnpm --filter @memory-lane/cli test"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Write pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: Write tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 4: Write packages/core/package.json**

```json
{
  "name": "@memory-lane/core",
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
    "test": "node --test --import ts-node/esm test/*.test.ts",
    "test:watch": "node --test --watch --import ts-node/esm test/*.test.ts"
  },
  "devDependencies": {
    "ts-node": "^10.9.2",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 5: Write packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["test"]
}
```

- [ ] **Step 6: Write packages/core/src/index.ts stub**

```typescript
export {}
```

- [ ] **Step 7: Write packages/core/test/helpers.ts**

```typescript
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

/** Create a temp directory and return the path. Cleans up on process exit. */
export function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-test-"))
  process.on("exit", () => {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  })
  return dir
}

/** Write a JSONL file from an array of objects. */
export function writeJsonl(file: string, records: unknown[]): void {
  const lines = records.map((r) => JSON.stringify(r)).join("\n")
  fs.writeFileSync(file, lines + (lines.endsWith("\n") ? "" : "\n"), "utf8")
}
```

- [ ] **Step 8: Verify scaffolding compiles**

```bash
cd ~/projects/ribbons-digital/memory-lane
pnpm install
pnpm build
```
Expected: `tsc` compiles with no errors, `dist/index.js` and `dist/index.d.ts` are created.

- [ ] **Step 9: Commit**

```bash
cd ~/projects/ribbons-digital/memory-lane
echo "dist/" > .gitignore
echo "node_modules/" >> .gitignore
git init
git add -A
git commit -m "chore: scaffold memory-lane monorepo"
```

---

### Task 2: types.ts — Data Model Types

**Files:**
- Create: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write types.ts**

```typescript
export type MemoryStatus = "pending" | "approved" | "rejected" | "deleted"
export type MemoryCategory = "preference" | "personal" | "project"
export type MemoryScopeType = "global" | "project"
export type MemorySource = "manual" | "user-suggested" | "agent-suggested"

export type MemoryKind =
  | "preference"
  | "personal_context"
  | "project_fact"
  | "project_checkpoint"
  | "workflow_rule"
  | "decision"
  | "misc"

export interface MemoryScope {
  type: MemoryScopeType
  key?: string
}

export interface ProjectInfo {
  cwd: string
  root?: string
  key?: string
}

export interface MemoryRecord {
  id: string
  status: MemoryStatus
  text: string
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  project?: ProjectInfo
  kind?: MemoryKind
}

export interface ProjectScope {
  cwd: string
  root: string
  key: string
}

export interface SaveInput {
  text: string
  category?: MemoryCategory
  scopeType?: MemoryScopeType
  source?: MemorySource
  status?: MemoryStatus
  kind?: MemoryKind
}

export type SaveResult =
  | { status: "saved"; memory: MemoryRecord }
  | { status: "skipped"; reason: "empty" | "secret" | "duplicate" }

export interface RecallOptions {
  topK?: number
  projectScope?: ProjectScope
}

export interface RecallResult {
  memories: MemoryRecord[]
  semantic: { enabled: boolean; used: boolean; fallbackReason?: string }
  notice?: string
}

export interface EmbeddingRecord {
  memoryId: string
  memoryUpdatedAt: string
  contentHash: string
  profileName: string
  model: string
  dimensions: number
  vector: number[]
  createdAt: string
}

export interface EmbeddingInvalidationRecord {
  type: "invalidation"
  memoryId: string
  invalidatedAt: string
  reason: "updated" | "deleted" | "stale"
}

export interface EmbeddingProvider {
  embed(inputs: string[], signal?: AbortSignal): Promise<number[][]>
}

export interface EmbeddingProfileConfig {
  provider: "openai-compatible-embeddings"
  baseUrl: string
  model: string
  apiKeyEnv?: string | null
  batchSize?: number
  timeoutMs?: number
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
}

export interface MemoryEngineConfig {
  memoryPath?: string
  embeddingsPath?: string
  storage?: MemoryEngineStorage
  configPath?: string
  embeddingProvider?: EmbeddingProvider
}

export interface CompactReport {
  removedMemories: number
  removedEmbeddings: number
  removedInvalidations: number
}
```

- [ ] **Step 2: Update index.ts to re-export types**

```typescript
export * from "./types.js"
```

- [ ] **Step 3: Verify compilation**

```bash
cd ~/projects/ribbons-digital/memory-lane && pnpm build
```
Expected: Compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts
git commit -m "feat(core): add data model types"
```

---

### Task 3: storage.ts — MemoryStore with Atomic Writes & Cache

**Files:**
- Create: `packages/core/src/storage.ts`
- Create: `packages/core/test/storage.test.ts`

- [ ] **Step 1: Write storage.ts**

```typescript
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import type { MemoryRecord, MemoryStatus, MemoryCategory, MemoryScopeType, MemorySource, MemoryKind } from "./types.js"

const VALID_STATUSES = new Set<MemoryStatus>(["pending", "approved", "rejected", "deleted"])
const VALID_CATEGORIES = new Set<MemoryCategory>(["preference", "personal", "project"])
const VALID_SCOPE_TYPES = new Set<MemoryScopeType>(["global", "project"])
const VALID_SOURCES = new Set<MemorySource>(["manual", "user-suggested", "agent-suggested"])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!isPlainObject(value)) return false
  if (!isNonEmptyString(value.id)) return false
  if (typeof value.status !== "string" || !VALID_STATUSES.has(value.status as MemoryStatus)) return false
  if (!isNonEmptyString(value.text)) return false
  if (typeof value.category !== "string" || !VALID_CATEGORIES.has(value.category as MemoryCategory)) return false
  if (typeof value.source !== "string" || !VALID_SOURCES.has(value.source as MemorySource)) return false
  if (!isNonEmptyString(value.createdAt)) return false
  if (!isNonEmptyString(value.updatedAt)) return false
  const scope = value.scope
  if (!isPlainObject(scope)) return false
  if (typeof scope.type !== "string" || !VALID_SCOPE_TYPES.has(scope.type as MemoryScopeType)) return false
  if (scope.key !== undefined && typeof scope.key !== "string") return false
  const project = value.project
  if (project !== undefined) {
    if (!isPlainObject(project)) return false
    if (typeof project.cwd !== "string") return false
    if (project.root !== undefined && typeof project.root !== "string") return false
    if (project.key !== undefined && typeof project.key !== "string") return false
  }
  return true
}

export function createMemoryId(): string {
  return crypto.randomBytes(4).toString("hex")
}

export function foldMemoryRecords(records: MemoryRecord[]): MemoryRecord[] {
  const latest = new Map<string, MemoryRecord>()
  for (const record of records) latest.set(record.id, record)
  return Array.from(latest.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export interface MemoryStore {
  readonly file: string
  append(record: MemoryRecord): void
  readLog(): MemoryRecord[]
  list(): MemoryRecord[]
}

export function createMemoryStore(filePath: string): MemoryStore {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  let cache: { mtime: number; records: MemoryRecord[] } | null = null

  function parseLines(): MemoryRecord[] {
    if (!fs.existsSync(filePath)) return []
    const records: MemoryRecord[] = []
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        if (isMemoryRecord(parsed)) records.push(parsed)
      } catch { /* omit malformed lines from reads; diagnostics/compaction preserve source rows */ }
    }
    return records
  }

  function readAll(): MemoryRecord[] {
    try {
      const stat = fs.statSync(filePath)
      if (cache && stat.mtimeMs <= cache.mtime) return cache.records
      const records = foldMemoryRecords(parseLines())
      cache = { mtime: stat.mtimeMs, records }
      return records
    } catch {
      return []
    }
  }

  return {
    file: filePath,
    append(record) {
      const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
      const tmpFile = filePath + ".tmp." + crypto.randomBytes(4).toString("hex")
      fs.writeFileSync(tmpFile, existing + JSON.stringify(record) + "\n", "utf8")
      fs.renameSync(tmpFile, filePath)
      cache = null
    },
    readLog: parseLines,
    list: readAll,
  }
}
```

- [ ] **Step 2: Write storage.test.ts**

```typescript
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { createMemoryStore, createMemoryId, foldMemoryRecords } from "../src/storage.js"
import type { MemoryRecord } from "../src/types.js"
import { tempDir } from "./helpers.js"

function rec(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString()
  return {
    id: overrides.id ?? createMemoryId(),
    status: overrides.status ?? "approved",
    text: overrides.text ?? "test",
    category: overrides.category ?? "project",
    scope: overrides.scope ?? { type: "project", key: "/p" },
    source: overrides.source ?? "manual",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    project: overrides.project ?? { cwd: "/p", root: "/p", key: "/p" },
    kind: overrides.kind,
  }
}

describe("MemoryStore", () => {
  let dir: string, file: string
  beforeEach(() => { dir = tempDir(); file = path.join(dir, "mem.jsonl") })

  it("returns empty for missing file", () => {
    const store = createMemoryStore(file)
    assert.equal(store.list().length, 0)
  })

  it("persists and retrieves", () => {
    const store = createMemoryStore(file)
    store.append(rec({ text: "hello" }))
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0].text, "hello")
  })

  it("folds duplicates by id", () => {
    const store = createMemoryStore(file)
    store.append(rec({ id: "a", text: "v1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }))
    store.append(rec({ id: "a", text: "v2", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" }))
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0].text, "v2")
  })

  it("skips malformed lines", () => {
    fs.writeFileSync(file, '{"id":"ok","status":"approved","text":"x","category":"project","scope":{"type":"project","key":"/p"},"source":"manual","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}\ngarbage\n', "utf8")
    assert.equal(createMemoryStore(file).list().length, 1)
  })

  it("caches reads", () => {
    const store = createMemoryStore(file)
    store.append(rec({ id: "a" }))
    const first = store.list()
    const second = store.list()
    assert.equal(first, second) // same array ref from cache
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd ~/projects/ribbons-digital/memory-lane && pnpm test:core
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/storage.ts packages/core/test/storage.test.ts
git commit -m "feat(core): add MemoryStore with atomic writes and cache"
```

---

### Task 4: search.ts — Lexical Search, Dedup, Secret Detection, Scope Matching

**Files:**
- Create: `packages/core/src/search.ts`
- Create: `packages/core/test/search.test.ts`

- [ ] **Step 1: Write search.ts**

```typescript
import type { MemoryRecord, MemoryCategory, MemoryKind } from "./types.js"
import { foldMemoryRecords } from "./storage.js"

export function normalizeMemoryText(text: string): string {
  return text.trim().replace(/[.!?]+$/u, "").trim()
}

function normalizeForDuplicate(text: string): string {
  return normalizeMemoryText(text).toLowerCase().replace(/\s+/gu, " ").trim()
}

// ── Secret Detection ──────────────────────────────────────────

function looksHighEntropy(value: string): boolean {
  const compact = value.replace(/[^A-Za-z0-9+/=_-]/gu, "")
  if (compact.length < 32) return false
  const unique = new Set(compact.split("")).size
  return unique >= 18 && /[A-Z]/u.test(compact) && /[a-z]/u.test(compact) && /\d/u.test(compact)
}

function containsHighEntropyToken(text: string): boolean {
  for (const m of text.matchAll(/[A-Za-z0-9+/=_-]{32,}/gu)) {
    if (looksHighEntropy(m[0])) return true
  }
  return false
}

export function containsLikelySecret(text: string): boolean {
  const lower = text.toLowerCase()
  if (/-----begin [a-z ]*private key-----/iu.test(text)) return true
  if (/\b(?:password|passwd|secret|token|(?:api|access|auth)[\s_-]*key|(?:access|auth)[\s_-]*token|private[\s_-]*key)\b\s*(?:is\b|[:=])\s*\S{4,}/iu.test(text)) return true
  if (/\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY)\b\s*=\s*\S+/u.test(text)) return true
  if (/\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/u.test(text)) return true
  if (/\b(bearer|token|secret|password|api key)\b/u.test(lower) && containsHighEntropyToken(text)) return true
  return containsHighEntropyToken(text)
}

// ── Category & Kind ──────────────────────────────────────────

export function inferCategory(text: string): MemoryCategory {
  const n = text.toLowerCase()
  if (/\b(this project|this repo|repository|repo|project|test command|build command|deploy)\b/u.test(n)) return "project"
  if (/\b(i prefer|i like|i usually|always|never|use .* for|my preference)\b/u.test(n)) return "preference"
  return "personal"
}

export function inferMemoryKind(text: string, category: MemoryCategory): MemoryKind {
  const n = normalizeMemoryText(text).toLowerCase().replace(/\s+/gu, " ").trim()
  if (/^(?:current\s+progress|progress|checkpoint|current\s+checkpoint)\s*:/u.test(n)) return "project_checkpoint"
  if (/\bwhere\s+we\s+left\s+off\b/u.test(n)) return "project_checkpoint"
  if (/\b(?:tests?\s+run\s+with|test\s+command|build\s+command|deploy\s+command|always\s+use|never\s+use|use\s+.+\s+for\s+package\s+installation)\b/u.test(n)) return "workflow_rule"
  if (/^(?:decision|decided)\s*:/u.test(n) || /\bwe\s+decided\b/u.test(n)) return "decision"
  if (category === "preference") return "preference"
  if (category === "personal") return "personal_context"
  if (category === "project") return "project_fact"
  return "misc"
}

export function effectiveMemoryKind(memory: { text: string; category: MemoryCategory; kind?: unknown }): MemoryKind {
  const kinds = new Set(["preference","personal_context","project_fact","project_checkpoint","workflow_rule","decision","misc"])
  if (typeof memory.kind === "string" && kinds.has(memory.kind)) return memory.kind as MemoryKind
  return inferMemoryKind(memory.text, memory.category)
}

// ── Scope ─────────────────────────────────────────────────────

export function memoryMatchesContext(memory: MemoryRecord, projectKey: string): boolean {
  if (memory.status !== "approved") return false
  if (memory.scope.type === "global") return true
  const key = memory.scope.key ?? memory.project?.key ?? memory.project?.root
  return Boolean(key && key === projectKey)
}

export function filterMemoriesForContext(memories: MemoryRecord[], projectKey: string): MemoryRecord[] {
  return foldMemoryRecords(memories).filter((m) => memoryMatchesContext(m, projectKey))
}

export function searchMemories(memories: MemoryRecord[], query: string, projectKey: string): MemoryRecord[] {
  const visible = filterMemoriesForContext(memories, projectKey)
  const q = query.trim().toLowerCase()
  if (!q) return visible
  return visible.filter((m) =>
    [m.id, m.text, m.category, effectiveMemoryKind(m), m.source, m.scope.type]
      .some((v) => v.toLowerCase().includes(q)))
}

// ── Duplicate ───────────────────────────────────────────────

export function findDuplicateMemory(
  memories: MemoryRecord[], text: string, category: MemoryCategory, scopeType: string, projectKey?: string,
): MemoryRecord | undefined {
  const nt = normalizeForDuplicate(text)
  if (!nt) return undefined
  return foldMemoryRecords(memories).find((m) => {
    if (m.status === "deleted" || m.status === "rejected") return false
    if (m.category !== category || m.scope.type !== scopeType) return false
    if (scopeType === "project") {
      const mk = m.scope.key ?? m.project?.key ?? m.project?.root
      if (!projectKey || !mk || mk !== projectKey) return false
    }
    return normalizeForDuplicate(m.text) === nt
  })
}

export function isCheckpointRecallQuery(query: string): boolean {
  const n = query.toLowerCase().replace(/\s+/gu, " ").trim()
  if (!n) return false
  return /\bwhere\s+(?:did\s+)?we\s+leave\s+off\b/u.test(n) ||
    /\bcontinue\s+(?:where\s+we\s+left\s+off|from\s+last\s+time)\b/u.test(n) ||
    /\bwhat\s+(?:were|was)\s+(?:we|i)\s+working\s+on\b/u.test(n) ||
    /\bcurrent\s+progress\b/u.test(n) ||
    /\bresume\s+work\b/u.test(n)
}

// ── Regex Detection (for adapters that don't have LLM classifier) ─

export function parseExplicitMemoryRequest(text: string): string | undefined {
  const patterns = [
    /^(?:please\s+)?remember(?:\s+that)?\s+(.+)$/iu,
    /^(?:can|could|would|will)\s+you\s+(?:please\s+)?remember(?:\s+that)?\s+(.+)$/iu,
    /^(?:please\s+)?(?:save|store)\s+(?:this\s+)?(?:to|in)\s+memory\s*[:\-]?\s+(.+)$/iu,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text.trim())
    const memoryText = normalizeMemoryText(match?.[1] ?? "")
    if (memoryText && !isReferentialMemoryText(memoryText)) return memoryText
  }
  return undefined
}

function isReferentialMemoryText(text: string): boolean {
  const n = text.toLowerCase().replace(/\s+/gu, " ").trim()
  return /\b(?:your|our)\s+(?:progress|work|state|context)\b/u.test(n) ||
    /\b(?:the\s+)?current\s+(?:progress|work|state|context)(?:\s+so\s+far|\s+now)?\b/u.test(n) ||
    /\bprogress\s+so\s+far\b/u.test(n) ||
    /\bwhere\s+(?:we|you)\s+(?:are|were|left\s+off)\b/u.test(n)
}

export function detectUserMemorySuggestion(text: string, projectKey?: string): { text: string; category: string; scope: string } | undefined {
  const n = normalizeMemoryText(text).toLowerCase().replace(/\s+/gu, " ")
  if (!n || containsLikelySecret(text)) return undefined
  if (/\b(this project|in this repo|this repo|this repository|test command)\b/u.test(n)) return { text: normalizeMemoryText(text), category: "project", scope: "project" }
  if (/\b(i prefer|i like|i usually|my preference is|always use|never use|please always|please never)\b/u.test(n)) return { text: normalizeMemoryText(text), category: "preference", scope: "global" }
  if (/\b(?:my (?:name|timezone|email|role) is|i work at|i live in|i use)\b/u.test(n)) return { text: normalizeMemoryText(text), category: "personal", scope: "global" }
  return undefined
}

export function isCheckpointMemorySaveRequest(text: string): boolean {
  const n = text.toLowerCase().replace(/\s+/gu, " ").trim()
  if (!n || containsLikelySecret(text)) return false
  if (/^(?:what|how|why|when|where|who|do|does|did|is|are)\b/u.test(n)) return false
  return /\b(?:remember|save|store|checkpoint)\b/u.test(n) && (
    /\b(?:your|our)\s+(?:progress|work|state|context)\b/u.test(n) ||
    /\b(?:the\s+)?current\s+(?:progress|work|state|context)/u.test(n) ||
    /\bwhere\s+(?:we|you)\s+(?:are|were|left\s+off)\b/u.test(n)
  )
}
```

- [ ] **Step 2: Write search.test.ts**

```typescript
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  containsLikelySecret, inferCategory, inferMemoryKind, effectiveMemoryKind,
  memoryMatchesContext, searchMemories, findDuplicateMemory, isCheckpointRecallQuery,
} from "../src/search.js"
import type { MemoryRecord } from "../src/types.js"

function rec(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: overrides.id ?? "test",
    status: overrides.status ?? "approved",
    text: overrides.text ?? "x",
    category: overrides.category ?? "project",
    scope: overrides.scope ?? { type: "project", key: "/p" },
    source: overrides.source ?? "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    project: { cwd: "/p", root: "/p", key: "/p" },
    kind: overrides.kind,
  }
}

describe("containsLikelySecret", () => {
  it("detects api keys", () => assert.equal(containsLikelySecret("key is sk-abc123def456ghi789"), true))
  it("detects private key header", () => assert.equal(containsLikelySecret("-----BEGIN RSA PRIVATE KEY-----"), true))
  it("passes normal text", () => assert.equal(containsLikelySecret("I prefer pnpm"), false))
})

describe("inferCategory", () => {
  it("detects project", () => assert.equal(inferCategory("Run tests with --watch"), "project"))
  it("detects preference", () => assert.equal(inferCategory("I prefer tabs"), "preference"))
  it("defaults to personal", () => assert.equal(inferCategory("My name is X"), "personal"))
})

describe("inferMemoryKind", () => {
  it("detects checkpoint", () => assert.equal(inferMemoryKind("Current progress: done", "project"), "project_checkpoint"))
  it("detects workflow", () => assert.equal(inferMemoryKind("always use pnpm", "project"), "workflow_rule"))
  it("maps category", () => assert.equal(inferMemoryKind("cats", "preference"), "preference"))
})

describe("effectiveMemoryKind", () => {
  it("uses explicit kind", () => assert.equal(effectiveMemoryKind({ text: "x", category: "project", kind: "decision" }), "decision"))
  it("infers when missing", () => assert.equal(effectiveMemoryKind({ text: "Current progress: done", category: "project" }), "project_checkpoint"))
})

describe("memoryMatchesContext", () => {
  it("rejects non-approved", () => assert.equal(memoryMatchesContext(rec({ status: "pending" }), "/p"), false))
  it("passes global", () => assert.equal(memoryMatchesContext(rec({ scope: { type: "global" } }), "/any"), true))
  it("matches project", () => assert.equal(memoryMatchesContext(rec({ scope: { type: "project", key: "/p" } }), "/p"), true))
})

describe("searchMemories", () => {
  it("filters by text", () => {
    const r = searchMemories([rec({ id: "a", text: "pnpm" }), rec({ id: "b", text: "docker" })], "pnpm", "/p")
    assert.equal(r.length, 1)
    assert.equal(r[0].id, "a")
  })
})

describe("findDuplicateMemory", () => {
  it("finds exact text", () =>
    assert.equal(findDuplicateMemory([rec({ id: "a", text: "pnpm" })], "pnpm", "project", "project", "/p")?.id, "a"))
})

describe("isCheckpointRecallQuery", () => {
  it("matches", () => {
    assert.equal(isCheckpointRecallQuery("where did we leave off"), true)
    assert.equal(isCheckpointRecallQuery("resume work"), true)
    assert.equal(isCheckpointRecallQuery("how do I run tests"), false)
  })
})

describe("regex detection", () => {
  it("parseExplicitMemoryRequest extracts text", () => {
    assert.equal(parseExplicitMemoryRequest("remember that I prefer pnpm"), "I prefer pnpm")
    assert.equal(parseExplicitMemoryRequest("Please remember: tests use vitest"), "tests use vitest")
    assert.equal(parseExplicitMemoryRequest("save this to memory: use strict mode"), "use strict mode")
  })
  it("detectUserMemorySuggestion finds facts", () => {
    assert.equal(detectUserMemorySuggestion("I prefer tabs")?.category, "preference")
    assert.equal(detectUserMemorySuggestion("in this repo we use pnpm")?.category, "project")
    assert.equal(detectUserMemorySuggestion("my name is Alice")?.category, "personal")
    assert.equal(detectUserMemorySuggestion("how do I run tests"), undefined) // question, not fact
  })
  it("isCheckpointMemorySaveRequest detects progress saves", () => {
    assert.equal(isCheckpointMemorySaveRequest("remember our current progress"), true)
    assert.equal(isCheckpointMemorySaveRequest("save where we left off"), true)
    assert.equal(isCheckpointMemorySaveRequest("how do I deploy?"), false)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd ~/projects/ribbons-digital/memory-lane && pnpm test:core
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/search.ts packages/core/test/search.test.ts
git commit -m "feat(core): add search, secret detection, dedup, scope matching"
```

---

### Task 5: project-scope.ts — Project Identity Resolution

**Files:**
- Create: `packages/core/src/project-scope.ts`
- Create: `packages/core/test/project-scope.test.ts`

- [ ] **Step 1: Write project-scope.ts**

```typescript
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import type { ProjectScope } from "./types.js"

const SCOPE_FILENAME = ".memory-lane-scope"

function findScopeFile(cwd: string): { id: string; root: string } | null {
  let current = path.resolve(cwd)
  while (true) {
    const candidate = path.join(current, SCOPE_FILENAME)
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"))
      if (parsed && typeof parsed.id === "string" && parsed.id) return { id: parsed.id, root: current }
    } catch { /* walk up */ }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

function findGitRoot(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null
  } catch { return null }
}

/** Resolve project scope from scope file or git root without creating scope files. */
export function resolveProjectScope(cwd?: string): ProjectScope | null {
  const resolvedCwd = path.resolve(cwd ?? process.cwd())
  const scope = findScopeFile(resolvedCwd)
  if (scope) return { cwd: resolvedCwd, root: scope.root, key: scope.id }
  const gitRoot = findGitRoot(resolvedCwd)
  if (gitRoot) return { cwd: resolvedCwd, root: gitRoot, key: gitRoot }
  return null
}
```

- [ ] **Step 2: Write project-scope.test.ts**

```typescript
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { resolveProjectScope } from "../src/project-scope.js"
import { tempDir } from "./helpers.js"

describe("resolveProjectScope", () => {
  let dir: string
  beforeEach(() => { dir = tempDir() })

  it("returns null when no scope file or git", () => assert.equal(resolveProjectScope(dir), null))

  it("finds scope file walking up", () => {
    fs.writeFileSync(path.join(dir, ".memory-lane-scope"), JSON.stringify({ id: "uuid-123" }))
    const sub = path.join(dir, "a", "b")
    fs.mkdirSync(sub, { recursive: true })
    const s = resolveProjectScope(sub)
    assert.notEqual(s, null)
    assert.equal(s!.key, "uuid-123")
    assert.equal(s!.root, dir)
  })

  it("falls back to git root", () => {
    const { execFileSync } = require("node:child_process")
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" })
    const s = resolveProjectScope(dir)
    assert.notEqual(s, null)
    assert.equal(s!.root, dir)
  })

  it("scope file takes priority over git", () => {
    const { execFileSync } = require("node:child_process")
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" })
    fs.writeFileSync(path.join(dir, ".memory-lane-scope"), JSON.stringify({ id: "scope-beats-git" }))
    assert.equal(resolveProjectScope(dir)!.key, "scope-beats-git")
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd ~/projects/ribbons-digital/memory-lane && pnpm test:core
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/project-scope.ts packages/core/test/project-scope.test.ts
git commit -m "feat(core): add project identity resolution"
```

---

### Task 6: config.ts — Config Loading, Validation, Deep Merge

**Files:**
- Create: `packages/core/src/config.ts`
- Create: `packages/core/test/config.test.ts`

- [ ] **Step 1: Write config.ts**

```typescript
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { SemanticMemoryConfig, EmbeddingProfileConfig } from "./types.js"

export const DEFAULT_CONFIG: SemanticMemoryConfig = {
  semantic: {
    enabled: false,
    activeEmbeddingProfile: "local-example",
    embeddings: { profiles: {} },
    retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
    privacy: { allowRemoteEmbeddings: false },
  },
}

export function getDefaultConfigPath(): string {
  return process.env.MEMORY_LANE_CONFIG || path.join(os.homedir(), ".memory-lane", "config.json")
}

// ── Validation ───────────────────────────────────────────────

class ConfigError extends Error {
  constructor(m: string) { super(`Invalid memory config: ${m}`); this.name = "ConfigError" }
}

function plain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}
function obj(v: unknown, p: string) { if (!plain(v)) throw new ConfigError(`${p} must be object`); return v }
function str(v: unknown, p: string) { if (typeof v !== "string" || !v.trim()) throw new ConfigError(`${p} must be non-empty string`); return v }
function bool(v: unknown, p: string) { if (typeof v !== "boolean") throw new ConfigError(`${p} must be boolean`); return v }
function num(v: unknown, p: string) { if (typeof v !== "number" || !Number.isFinite(v)) throw new ConfigError(`${p} must be finite number`); return v }

function validateProfile(v: unknown, p: string) {
  const o = obj(v, p)
  if (o.provider !== "openai-compatible-embeddings") throw new ConfigError(`${p}.provider must be openai-compatible-embeddings`)
  str(o.baseUrl, `${p}.baseUrl`); str(o.model, `${p}.model`)
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (override === null || override === undefined || !plain(override)) return override ?? base
  const result: Record<string, unknown> = plain(base) ? { ...base } : {}
  for (const [k, v] of Object.entries(override)) {
    if (["__proto__", "constructor", "prototype"].includes(k)) continue
    result[k] = deepMerge(k in result ? result[k] : undefined, v)
  }
  return result
}

export function validateConfig(config: unknown): SemanticMemoryConfig {
  const s = obj(obj(config, "config").semantic, "semantic")
  bool(s.enabled, "semantic.enabled")
  const ap = str(s.activeEmbeddingProfile, "semantic.activeEmbeddingProfile")
  const ep = obj(obj(s.embeddings, "semantic.embeddings").profiles, "semantic.embeddings.profiles")
  for (const [name, profile] of Object.entries(ep)) validateProfile(profile, `semantic.embeddings.profiles.${name}`)
  if (!(ap in ep)) throw new ConfigError(`activeEmbeddingProfile "${ap}" not found`)
  const r = obj(s.retrieval, "semantic.retrieval")
  num(r.topK, "semantic.retrieval.topK"); num(r.minSimilarity, "semantic.retrieval.minSimilarity")
  num(r.semanticWeight, "semantic.retrieval.semanticWeight"); num(r.lexicalWeight, "semantic.retrieval.lexicalWeight")
  num(r.recencyWeight, "semantic.retrieval.recencyWeight")
  bool(r.fallbackToAllVisibleOnMiss, "semantic.retrieval.fallbackToAllVisibleOnMiss")
  bool(obj(s.privacy, "semantic.privacy").allowRemoteEmbeddings, "semantic.privacy.allowRemoteEmbeddings")
  return config as SemanticMemoryConfig
}

export function loadConfig(configPath?: string): SemanticMemoryConfig {
  const file = configPath ?? getDefaultConfigPath()
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG, semantic: { ...DEFAULT_CONFIG.semantic, embeddings: { profiles: {} } } }
  return validateConfig(deepMerge(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(file, "utf8"))))
}

export function isLocalBaseUrl(url: string): boolean {
  try { return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname.toLowerCase()) }
  catch { return false }
}
```

- [ ] **Step 2: Write config.test.ts**

```typescript
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { loadConfig, DEFAULT_CONFIG, isLocalBaseUrl } from "../src/config.js"
import { tempDir } from "./helpers.js"

describe("loadConfig", () => {
  let dir: string
  beforeEach(() => { dir = tempDir() })

  it("returns defaults when file missing", () => {
    assert.equal(loadConfig(path.join(dir, "nope.json")).semantic.enabled, false)
  })

  it("merges user config", () => {
    const f = path.join(dir, "c.json")
    fs.writeFileSync(f, JSON.stringify({ semantic: { enabled: true } }))
    assert.equal(loadConfig(f).semantic.enabled, true)
  })

  it("validates on load", () => {
    const f = path.join(dir, "b.json")
    fs.writeFileSync(f, JSON.stringify({ semantic: { enabled: "bad" } }))
    assert.throws(() => loadConfig(f))
  })
})

describe("isLocalBaseUrl", () => {
  it("detects localhost", () => {
    assert.equal(isLocalBaseUrl("http://localhost:8000"), true)
    assert.equal(isLocalBaseUrl("https://api.openai.com"), false)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd ~/projects/ribbons-digital/memory-lane && pnpm test:core
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/config.ts packages/core/test/config.test.ts
git commit -m "feat(core): add config loading, validation, deep merge"
```

---

### Task 7: engine.ts — Core MemoryEngine (Basic Save/Suggest/Approve/Reject/Delete/List/Search)

**Files:**
- Create: `packages/core/src/engine.ts`
- Create: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Write engine.ts**

```typescript
import * as path from "node:path"
import * as os from "node:os"
import { createMemoryStore, createMemoryId, type MemoryStore } from "./storage.js"
import { containsLikelySecret, effectiveMemoryKind, inferCategory, inferMemoryKind, searchMemories, findDuplicateMemory, filterMemoriesForContext } from "./search.js"
import { resolveProjectScope } from "./project-scope.js"
import { loadConfig, getDefaultConfigPath } from "./config.js"
import type { MemoryRecord, MemoryStatus, MemoryCategory, MemoryScopeType, MemorySource, MemoryKind, SaveInput, SaveResult, ProjectScope, RecallOptions, RecallResult, EmbeddingProvider, CompactReport } from "./types.js"

function ts(now?: string | Date): string {
  if (now instanceof Date) return now.toISOString()
  if (typeof now === "string") return now
  return new Date().toISOString()
}

function clone(memory: MemoryRecord, update: Partial<MemoryRecord>): MemoryRecord {
  return { ...memory, ...update, id: memory.id, createdAt: memory.createdAt, updatedAt: ts(), kind: update.kind ?? effectiveMemoryKind({ ...memory, ...update }) }
}

const DEFAULT_DIR = path.join(os.homedir(), ".memory-lane")

export class MemoryEngine {
  private readonly storage: MemoryEngineStorage
  private readonly config: ReturnType<typeof loadConfig>
  private scope: ProjectScope | null = null
  private readonly embProvider?: EmbeddingProvider

  constructor(opts?: MemoryEngineConfig) {
    const memoryPath = opts?.memoryPath ?? path.join(DEFAULT_DIR, "memory.jsonl")
    const embeddingsPath = opts?.embeddingsPath ?? path.join(DEFAULT_DIR, "embeddings.jsonl")
    this.storage = opts?.storage ?? createSingleStoreEngineStorage(memoryPath, embeddingsPath)
    this.config = loadConfig(opts?.configPath ?? getDefaultConfigPath())
    this.embProvider = opts?.embeddingProvider
    this.refreshScope()
  }

  /** Re-resolve the project scope from current cwd. */
  refreshScope(cwd?: string): void {
    this.scope = resolveProjectScope(cwd)
  }

  /** Current project scope or null if none available. */
  getProjectScope(): ProjectScope | null {
    return this.scope
  }

  /** Save a memory as approved. Returns SaveResult. */
  save(input: SaveInput): SaveResult {
    const text = input.text.trim()
    if (!text) return { status: "skipped", reason: "empty" }
    if (containsLikelySecret(text)) return { status: "skipped", reason: "secret" }

    const category = input.category ?? inferCategory(text)
    const scopeType = input.scopeType ?? (category === "project" ? "project" : "global")
    const scope: MemoryScope = scopeType === "project"
      ? { type: "project", key: this.scope?.key }
      : { type: "global" }
    const kind = input.kind ?? inferMemoryKind(text, category)

    const dup = findDuplicateMemory(this.store.list(), text, category, scopeType, this.scope?.key)
    if (dup) {
      if (input.status === "approved" && dup.status === "pending") {
        this.store.append(clone(dup, { text, category, scope, source: input.source ?? "manual", status: "approved", kind, project: dup.project }))
        return { status: "saved", memory: dup }
      }
      return { status: "skipped", reason: "duplicate" }
    }

    const now = ts()
    const memory: MemoryRecord = {
      id: createMemoryId(),
      status: input.status ?? "pending",
      text,
      category,
      scope,
      source: input.source ?? "manual",
      createdAt: now,
      updatedAt: now,
      project: this.scope ? { cwd: this.scope.cwd, root: this.scope.root, key: this.scope.key } : undefined,
      kind,
    }
    this.store.append(memory)
    return { status: "saved", memory }
  }

  /** Queue a memory suggestion (pending). */
  suggest(text: string, category?: MemoryCategory, scopeType?: MemoryScopeType, kind?: MemoryKind): SaveResult {
    return this.save({ text, category, scopeType, source: "user-suggested", status: "pending", kind })
  }

  /** Approve a pending memory by id. Returns the updated memory or undefined. */
  approve(id: string): MemoryRecord | undefined {
    const mem = this.store.list().find((m) => m.id === id && m.status !== "deleted")
    if (!mem) return undefined
    const updated = clone(mem, { status: "approved" })
    this.store.append(updated)
    return updated
  }

  /** Reject a memory by id. Returns the updated memory or undefined. */
  reject(id: string): MemoryRecord | undefined {
    const mem = this.store.list().find((m) => m.id === id && m.status !== "deleted")
    if (!mem) return undefined
    const updated = clone(mem, { status: "rejected" })
    this.store.append(updated)
    return updated
  }

  /** Soft-delete a memory by id. Returns the deleted memory or undefined. */
  delete(id: string): MemoryRecord | undefined {
    const mem = this.store.list().find((m) => m.id === id && m.status !== "deleted")
    if (!mem) return undefined
    const updated = clone(mem, { status: "deleted" })
    this.store.append(updated)
    return updated
  }

  /** List memories, optionally filtered by status. */
  list(status?: MemoryStatus): MemoryRecord[] {
    const all = this.store.list()
    if (!status) return all
    return all.filter((m) => m.status === status)
  }

  /** Search memories by text query within the current project scope. */
  search(query: string): MemoryRecord[] {
    return searchMemories(this.store.list(), query, this.scope?.key ?? "")
  }

  /** List pending memories for review. */
  reviewPending(): MemoryRecord[] {
    return this.store.list().filter((m) => m.status === "pending")
  }

  // Semantic retrieval stubs — will be wired in Phase 2
  async recall(query: string, _options?: RecallOptions): Promise<RecallResult> {
    const memories = this.search(query)
    return { memories, semantic: { enabled: this.config.semantic.enabled, used: false, fallbackReason: "semantic retrieval not yet wired" } }
  }
}
```

- [ ] **Step 2: Write engine.test.ts**

```typescript
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { MemoryEngine } from "../src/engine.js"
import { tempDir } from "./helpers.js"

describe("MemoryEngine", () => {
  let dir: string
  beforeEach(() => { dir = tempDir() })

  function engine() {
    return new MemoryEngine({ memoryPath: path.join(dir, "mem.jsonl"), embeddingsPath: path.join(dir, "emb.jsonl"), configPath: path.join(dir, "cfg.json") })
  }

  it("rejects empty text", () => {
    const e = engine()
    assert.equal(e.save({ text: "" }).status, "skipped")
  })

  it("rejects secrets", () => {
    const e = engine()
    assert.equal(e.save({ text: "my key is sk-abc123" }).status, "skipped")
  })

  it("saves and lists memories", () => {
    const e = engine()
    const r = e.save({ text: "use pnpm for projects" })
    assert.equal(r.status, "saved")
    assert.equal(r.memory!.status, "pending")
    assert.equal(e.list().length, 1)
  })

  it("detects duplicates", () => {
    const e = engine()
    e.save({ text: "use pnpm" })
    assert.equal(e.save({ text: "use pnpm" }).status, "skipped")
  })

  it("approves pending memories", () => {
    const e = engine()
    const r = e.save({ text: "my rule", status: "pending" })
    const id = r.memory!.id
    e.approve(id)
    assert.equal(e.list().find((m) => m.id === id)?.status, "approved")
  })

  it("deletes memories", () => {
    const e = engine()
    const r = e.save({ text: "delete me", status: "approved" })
    e.delete(r.memory!.id)
    assert.equal(e.list().find((m) => m.id === r.memory!.id)?.status, "deleted")
  })

  it("searches by text", () => {
    const e = engine()
    e.save({ text: "use pnpm", status: "approved" })
    e.save({ text: "deploy with docker", status: "approved" })
    assert.equal(e.search("pnpm").length, 1)
    assert.equal(e.search("docker").length, 1)
    assert.equal(e.search("").length, 2)
  })

  it("lists pending memories for review", () => {
    const e = engine()
    e.save({ text: "pending memory" })
    e.save({ text: "approved memory", status: "approved" })
    assert.equal(e.reviewPending().length, 1)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd ~/projects/ribbons-digital/memory-lane && pnpm test:core
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/engine.ts packages/core/test/engine.test.ts
git commit -m "feat(core): add MemoryEngine with save, approve, reject, delete, search"
```

---

## Phase 2: Semantic Retrieval

### Task 8: embedding-store.ts — Embedding Store with Invalidation Records

**Files:**
- Create: `packages/core/src/embedding-store.ts`

- [ ] **Step 1: Write embedding-store.ts**

```typescript
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import type { EmbeddingRecord, EmbeddingInvalidationRecord } from "./types.js"

type EmbeddingLine = EmbeddingRecord | EmbeddingInvalidationRecord

function isEmbeddingRecord(v: unknown): v is EmbeddingRecord {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return typeof o.memoryId === "string" && typeof o.contentHash === "string" && Array.isArray(o.vector)
}

function isInvalidation(v: unknown): v is EmbeddingInvalidationRecord {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return o.type === "invalidation" && typeof o.memoryId === "string"
}

export function createEmbeddingId(): string {
  return crypto.randomBytes(4).toString("hex")
}

export function foldEmbeddings(records: EmbeddingRecord[]): EmbeddingRecord[] {
  const latest = new Map<string, EmbeddingRecord>()
  for (const r of records) {
    const key = [r.memoryId, r.profileName, r.model, r.baseUrl, r.contentHash].join("\0")
    const existing = latest.get(key)
    if (!existing || existing.createdAt <= r.createdAt) latest.set(key, r)
  }
  return Array.from(latest.values())
}

export interface EmbeddingStore {
  readonly file: string
  append(record: EmbeddingLine): void
  readLog(): EmbeddingLine[]
  listEmbeddings(): EmbeddingRecord[]
  listInvalidations(): EmbeddingInvalidationRecord[]
}

export function createEmbeddingStore(filePath: string): EmbeddingStore {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  let cache: { mtime: number; records: EmbeddingLine[] } | null = null

  function parse(): EmbeddingLine[] {
    if (!fs.existsSync(filePath)) return []
    const lines: EmbeddingLine[] = []
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
      if (!line.trim()) continue
      try {
        const p = JSON.parse(line)
        if (isEmbeddingRecord(p) || isInvalidation(p)) lines.push(p)
      } catch { /* skip */ }
    }
    return lines
  }

  function readAll(): EmbeddingLine[] {
    try {
      const stat = fs.statSync(filePath)
      if (cache && stat.mtimeMs <= cache.mtime) return cache.records
      cache = { mtime: stat.mtimeMs, records: parse() }
      return cache.records
    } catch { return [] }
  }

  return {
    file: filePath,
    append(record) {
      const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
      const tmp = filePath + ".tmp." + crypto.randomBytes(4).toString("hex")
      fs.writeFileSync(tmp, existing + JSON.stringify(record) + "\n", "utf8")
      fs.renameSync(tmp, filePath)
      cache = null
    },
    readLog: parse,
    listEmbeddings() {
      return foldEmbeddings(readAll().filter((l): l is EmbeddingRecord => isEmbeddingRecord(l)))
    },
    listInvalidations() {
      return readAll().filter((l): l is EmbeddingInvalidationRecord => isInvalidation(l))
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/embedding-store.ts
git commit -m "feat(core): add EmbeddingStore with invalidation support"
```

---

### Task 9: embedding-provider.ts — OpenAI-Compatible Embedding Provider

**Files:**
- Create: `packages/core/src/embedding-provider.ts`

- [ ] **Step 1: Write embedding-provider.ts**

Port from `semantic.ts` in persistent-memory:

```typescript
import type { EmbeddingProvider, EmbeddingProfileConfig } from "./types.js"

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/u, "")
}

function validateVectors(body: unknown, count: number): number[][] {
  const o = body as any
  if (!o || typeof o !== "object" || !Array.isArray(o.data)) throw new Error("Invalid embedding response")
  if (o.data.length !== count) throw new Error(`Expected ${count} vectors, got ${o.data.length}`)
  return o.data.map((entry: any) => {
    const v = entry?.embedding
    if (!Array.isArray(v) || v.length === 0 || !v.every((n: unknown) => typeof n === "number" && Number.isFinite(n))) throw new Error("Invalid vector")
    return v as number[]
  })
}

export function createOpenAIEmbeddingProvider(
  profile: EmbeddingProfileConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): EmbeddingProvider {
  return {
    async embed(input: string[], signal?: AbortSignal): Promise<number[][]> {
      if (!input.length) return []
      const apiKey = profile.apiKeyEnv ? env[profile.apiKeyEnv] : undefined
      const h: Record<string, string> = { "Content-Type": "application/json" }
      if (apiKey) h.Authorization = `Bearer ${apiKey}`

      const controller = new AbortController()
      const combined = signal ?? controller

      try {
        const res = await fetchImpl(`${normalizeUrl(profile.baseUrl)}/embeddings`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({ model: profile.model, input }),
          signal: combined,
        })
        const body = JSON.parse(await res.text())
        if (!res.ok) throw new Error(`Embedding provider HTTP ${res.status}: ${JSON.stringify(body)}`)
        return validateVectors(body, input.length)
      } finally {
        if (!signal) controller.abort()
      }
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/embedding-provider.ts
git commit -m "feat(core): add OpenAI-compatible embedding provider"
```

---

### Task 10: scoring.ts — Cosine, Lexical, Recency, Kind Boost

**Files:**
- Create: `packages/core/src/scoring.ts`
- Create: `packages/core/test/scoring.test.ts`

- [ ] **Step 1: Write scoring.ts**

```typescript
import { isCheckpointRecallQuery } from "./search.js"
import type { EmbeddingRecord, EmbeddingInvalidationRecord } from "./types.js"

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (!na || !nb) return 0
  return Math.min(1, Math.max(0, dot / (Math.sqrt(na) * Math.sqrt(nb))))
}

const STOP_WORDS = new Set(["a","an","and","are","as","at","be","by","can","did","do","does","for","from","how","i","in","is","it","of","off","on","or","please","that","the","this","to","use","we","what","where","with","you"])

function tokens(text: string): string[] {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  return [...new Set(t ? t.split(/\s+/).filter((w) => w && !STOP_WORDS.has(w)) : [])]
}

export function lexicalScore(query: string, text: string): number {
  const qt = tokens(query)
  if (!qt.length) return 0
  const tt = tokens(text)
  if (!tt.length) return 0
  let hits = 0
  for (const q of qt) {
    if (tt.some((t) => t === q || (q.length >= 4 && t.includes(q)) || (t.length >= 4 && q.includes(t)))) hits++
  }
  return Math.min(1, hits / qt.length)
}

export function recencyScore(updatedAt: string, nowMs: number = Date.now()): number {
  const ms = Date.parse(updatedAt)
  if (!Number.isFinite(ms)) return 0
  return 1 / (1 + Math.max(0, nowMs - ms) / (30 * 24 * 60 * 60 * 1000))
}

export function findMatchingEmbedding(
  embeddings: EmbeddingRecord[], memoryId: string, contentHash: string, profileName: string, model: string, baseUrl: string,
): EmbeddingRecord | undefined {
  return embeddings.find((e) => e.memoryId === memoryId && e.contentHash === contentHash && e.profileName === profileName && e.model === model && e.baseUrl === baseUrl)
}

export interface ScoredMemory {
  id: string
  semanticScore: number
  lexicalScore: number
  recencyScore: number
  kindBoost: number
  finalScore: number
}
```

- [ ] **Step 2: Write scoring.test.ts**

```typescript
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { cosineSimilarity, lexicalScore, recencyScore } from "../src/scoring.js"

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1)
  })
  it("returns 0 for orthogonal vectors", () => {
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
  })
  it("returns 0 for empty input", () => {
    assert.equal(cosineSimilarity([], []), 0)
  })
})

describe("lexicalScore", () => {
  it("finds matching tokens", () => {
    assert(lexicalScore("use pnpm", "always use pnpm for installs") > 0)
  })
  it("returns 0 for no match", () => {
    assert.equal(lexicalScore("docker", "use pnpm"), 0)
  })
})

describe("recencyScore", () => {
  it("returns 1 for current timestamp", () => {
    const score = recencyScore(new Date().toISOString(), Date.now())
    assert(score > 0.9)
  })
  it("decays over time", () => {
    const old = recencyScore("2025-01-01T00:00:00.000Z", Date.now())
    const recent = recencyScore(new Date().toISOString(), Date.now())
    assert(old < recent)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd ~/projects/ribbons-digital/memory-lane && pnpm test:core
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/scoring.ts packages/core/test/scoring.test.ts
git commit -m "feat(core): add scoring functions (cosine, lexical, recency)"
```

---

### Task 11: retrieval.ts — Semantic + Lexical Retrieval Pipeline

**Files:**
- Create: `packages/core/src/retrieval.ts`
- Create: `packages/core/test/retrieval.test.ts`

- [ ] **Step 1: Write retrieval.ts**

```typescript
import { isCheckpointRecallQuery, filterMemoriesForContext } from "./search.js"
import { cosineSimilarity, lexicalScore, recencyScore, findMatchingEmbedding } from "./scoring.js"
import type { MemoryRecord, EmbeddingRecord, EmbeddingInvalidationRecord, EmbeddingProvider, SemanticMemoryConfig, RecallResult, ProjectScope } from "./types.js"

export async function retrieveSemanticMemories(
  memories: MemoryRecord[],
  embeddings: EmbeddingRecord[],
  invalidations: EmbeddingInvalidationRecord[],
  query: string,
  projectKey: string,
  config: SemanticMemoryConfig["semantic"],
  provider?: EmbeddingProvider,
  signal?: AbortSignal,
): Promise<RecallResult> {
  const visible = filterMemoriesForContext(memories, projectKey)
  if (!visible.length) return { memories: [], semantic: { enabled: config.enabled, used: false } }

  const q = query.trim()
  if (!q) return { memories: visible.slice(0, config.retrieval.topK), semantic: { enabled: config.enabled, used: false } }

  const checkpointRecall = isCheckpointRecallQuery(q)

  // Try semantic if enabled and provider available
  if (config.enabled && provider) {
    try {
      const vectors = await provider.embed([q], signal)
      if (vectors?.length === 1) {
        const queryVec = vectors[0]
        const latestInvalidations = latestInvalidationTimes(invalidations)
        const folded = new Map<string, EmbeddingRecord>()
        for (const e of embeddings) {
          if (!isEmbeddingAfterLatestInvalidation(e, latestInvalidations.get(e.memoryId))) continue
          const key = [e.memoryId, e.contentHash, e.profileName, e.model].join("\0")
          const existing = folded.get(key)
          if (!existing || existing.createdAt <= e.createdAt) folded.set(key, e)
        }

        const scored = visible.map((m) => {
          const emb = findMatchingEmbedding([...folded.values()], m.id, hashText(m.text), config.activeEmbeddingProfile, config.embeddings.profiles[config.activeEmbeddingProfile]?.model ?? "", config.embeddings.profiles[config.activeEmbeddingProfile]?.baseUrl ?? "")
          const sem = emb ? cosineSimilarity(queryVec, emb.vector) : 0
          const lex = lexicalScore(q, m.text)
          const rec = recencyScore(m.updatedAt)
          const boost = checkpointRecall && effectiveKind(m) === "project_checkpoint" ? 0.2 : 0
          const final = sem * config.retrieval.semanticWeight + lex * config.retrieval.lexicalWeight + rec * config.retrieval.recencyWeight + boost
          return { id: m.id, memory: m, semanticScore: sem, lexicalScore: lex, recencyScore: rec, kindBoost: boost, finalScore: final }
        })

        const { minSimilarity, topK } = config.retrieval
        const selected = scored
          .filter((s) => s.semanticScore >= minSimilarity || s.lexicalScore > 0)
          .sort((a, b) => b.finalScore - a.finalScore || b.semanticScore - a.semanticScore)
          .slice(0, topK)

        if (selected.length) return { memories: selected.map((s) => s.memory), semantic: { enabled: true, used: true } }

        if (config.retrieval.fallbackToAllVisibleOnMiss) {
          const lexScored = visible.map((m) => ({ memory: m, score: lexicalScore(q, m.text) }))
          const fallback = lexScored.sort((a, b) => b.score - a.score).slice(0, topK)
          return { memories: fallback.map((s) => s.memory), semantic: { enabled: true, used: true, fallbackReason: "No semantic matches" } }
        }
      }
    } catch (err: any) {
      // Fall through to lexical fallback
    }
  }

  // Lexical fallback
  const lexScored = visible.map((m) => ({ memory: m, score: lexicalScore(q, m.text) }))
  const results = lexScored.sort((a, b) => b.score - a.score).slice(0, config.retrieval.topK)
  return { memories: results.map((s) => s.memory), semantic: { enabled: config.enabled, used: false } }
}

function hashText(text: string): string {
  const { createHash } = require("node:crypto")
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function effectiveKind(m: MemoryRecord): string {
  const kinds = new Set(["preference","personal_context","project_fact","project_checkpoint","workflow_rule","decision","misc"])
  if (m.kind && kinds.has(m.kind)) return m.kind
  return "misc"
}
```

Note: The `require("node:crypto")` above is used to avoid wrapping the whole function with async import. The actual implementation should use a top-level import — fix in the actual code:

```typescript
import { createHash } from "node:crypto"
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/retrieval.ts
git commit -m "feat(core): add semantic retrieval pipeline"
```

---

### Task 12: compact.ts — Compaction for Both Stores

**Files:**
- Create: `packages/core/src/compact.ts`

- [ ] **Step 1: Write compact.ts**

```typescript
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import { foldMemoryRecords } from "./storage.js"
import { foldEmbeddings } from "./embedding-store.js"
import type { MemoryRecord, EmbeddingRecord, EmbeddingInvalidationRecord, CompactReport } from "./types.js"

export function compact(memFile: string, embFile: string): CompactReport {
  // Compact memories: remove deleted/rejected tombstones while preserving invalid rows
  let removedMemories = 0
  const memExists = fs.existsSync(memFile)
  if (memExists) {
    const raw = fs.readFileSync(memFile, "utf8").split("\n").filter(Boolean)
    const folded = foldMemoryRecords(raw.map((l) => JSON.parse(l)))
    const alive = folded.filter((m) => m.status !== "deleted" && m.status !== "rejected")
    removedMemories = folded.length - alive.length

    const memTmp = memFile + ".tmp." + crypto.randomBytes(4).toString("hex")
    fs.writeFileSync(memTmp, alive.map((m) => JSON.stringify(m)).join("\n") + (alive.length ? "\n" : ""), "utf8")
    fs.renameSync(memTmp, memFile)
  }

  // Compact embeddings: remove embeddings for deleted memories,stale embeddings, and invalidation records
  let removedEmbeddings = 0
  const aliveIds = new Set(alive.map((m) => m.id))
  const embExists = fs.existsSync(embFile)
  if (embExists) {
    const raw = fs.readFileSync(embFile, "utf8").split("\n").filter(Boolean)
    const parsed = raw.map((l) => JSON.parse(l))
    const embeddings = parsed.filter((e: any) => !e.type || e.type !== "invalidation")
    const invalidations = parsed.filter((e: any) => e.type === "invalidation")
    const valid = embeddings.filter((e: EmbeddingRecord) => aliveIds.has(e.memoryId))
    removedEmbeddings = embeddings.length + invalidations.length - valid.length

    const embTmp = embFile + ".tmp." + crypto.randomBytes(4).toString("hex")
    fs.writeFileSync(embTmp, valid.map((e) => JSON.stringify(e)).join("\n") + (valid.length ? "\n" : ""), "utf8")
    fs.renameSync(embTmp, embFile)
  }

  return { removedMemories, removedEmbeddings: removedEmbeddings, removedInvalidations: 0 }
}

/** Check if compact should run on startup. */
export function shouldCompact(memFile: string, threshold: number = 0.3, minRecords: number = 100): boolean {
  if (!fs.existsSync(memFile)) return false
  const raw = fs.readFileSync(memFile, "utf8").split("\n").filter(Boolean)
  if (raw.length < minRecords) return false
  const folded = foldMemoryRecords(raw.map((l) => JSON.parse(l)))
  const dead = folded.filter((m) => m.status === "deleted" || m.status === "rejected").length
  return dead / folded.length > threshold
}
```

- [ ] **Step 2: Write compact.test.ts**

```typescript
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { compact, shouldCompact } from "../src/compact.js"
import { tempDir } from "./helpers.js"
import { createMemoryId } from "../src/storage.js"

function rec(overrides: any) {
  return { id: overrides.id ?? createMemoryId(), status: "approved", text: "x", category: "project", scope: { type: "project", key: "/p" }, source: "manual", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...overrides }
}

describe("compact", () => {
  let dir: string, mf: string, ef: string
  beforeEach(() => { dir = tempDir(); mf = path.join(dir, "m.jsonl"); ef = path.join(dir, "e.jsonl") })

  it("removes deleted and rejected", () => {
    fs.writeFileSync(mf, [rec({ status: "approved", id: "a" }), rec({ status: "deleted", id: "b" }), rec({ status: "rejected", id: "c" })].map(JSON.stringify).join("\n") + "\n", "utf8")
    const r = compact(mf, ef)
    assert.equal(r.removedMemories, 2)
    assert.equal(fs.readFileSync(mf, "utf8").split("\n").filter(Boolean).length, 1)
  })

  it("handles empty files", () => {
    fs.writeFileSync(mf, "", "utf8")
    const r = compact(mf, ef)
    assert.equal(r.removedMemories, 0)
  })
})

describe("shouldCompact", () => {
  it("returns false for small files", () => {
    const d = tempDir()
    const f = path.join(d, "m.jsonl")
    fs.writeFileSync(f, "x", "utf8")
    assert.equal(shouldCompact(f), false)
  })
})
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/compact.ts packages/core/test/compact.test.ts
git commit -m "feat(core): add compaction for both stores"
```

---

### Task 13: engine.ts (Phase 2 Extension) — Wire Up recall(), reindexEmbeddings(), compact(), doctor(), probe()

**Files:**
- Modify: `packages/core/src/engine.ts`
- Create: `packages/core/test/engine-semantic.test.ts`

- [ ] **Step 1: Extend engine.ts with Phase 2 methods**

Add these methods to the `MemoryEngine` class (append after the existing methods):

```typescript
// ── Phase 2: Semantic Retrieval, Compaction, Maintenance ───

private getEmbStore() {
  return createEmbeddingStore(this.embPath)
}

async recall(query: string, options?: RecallOptions): Promise<RecallResult> {
  const { retrieveSemanticMemories } = await import("./retrieval.js")
  const config = this.config.semantic
  const store = this.getEmbStore()
  const embeddings = store.listEmbeddings()
  const invalidations = store.listInvalidations()
  const scope = options?.projectScope ?? this.scope
  const projectKey = scope?.key ?? ""

  return retrieveSemanticMemories(
    this.store.list(),
    embeddings,
    invalidations,
    query,
    projectKey,
    config,
    this.embProvider,
  )
}

compact(): CompactReport {
  const { compact, shouldCompact } = require("./compact.js")
  return compact(this.memPath, this.embPath)
}

/** Rebuild embeddings for approved memories missing current vectors; pass force to recompute existing current vectors. */
async reindexEmbeddings(opts?: { force?: boolean; signal?: AbortSignal }): Promise<{ embedded: number; skippedExisting: number; skippedSecrets: number }> {
  if (!this.embProvider || !this.config.semantic.enabled) {
    return { embedded: 0, skippedExisting: 0, skippedSecrets: 0 }
  }

  const store = this.getEmbStore()
  const config = this.config.semantic
  const profile = config.embeddings.profiles[config.activeEmbeddingProfile]
  if (!profile) throw new Error("No active embedding profile configured")

  const approved = this.store.list().filter((m) => m.status === "approved")
  const safe = approved.filter((m) => !containsLikelySecret(m.text))
  let embedded = 0, skippedSecrets = approved.length - safe.length, skippedExisting = 0

  const batchSize = profile.batchSize ?? 16
  for (let i = 0; i < safe.length; i += batchSize) {
    const batch = safe.slice(i, i + batchSize)
    const vectors = await this.embProvider.embed(batch.map((m) => m.text), opts?.signal)
    for (let j = 0; j < batch.length; j++) {
      store.append({
        memoryId: batch[j].id, memoryUpdatedAt: batch[j].updatedAt,
        contentHash: createHash("sha256").update(batch[j].text, "utf8").digest("hex"),
        profileName: config.activeEmbeddingProfile, provider: profile.provider,
        baseUrl: profile.baseUrl, model: profile.model,
        dimensions: vectors[j].length, vector: vectors[j],
        createdAt: new Date().toISOString(),
      })
      embedded++
    }
  }
  return { embedded, skippedExisting, skippedSecrets }
}

/** Probe the embedding provider to verify connectivity. */
async probeEmbeddingProvider(): Promise<{ ok: boolean; dimensions?: number; error?: string }> {
  if (!this.embProvider) return { ok: false, error: "No embedding provider configured" }
  try {
    const vectors = await this.embProvider.embed(["probe"])
    return { ok: true, dimensions: vectors[0]?.length }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

/** Generate a diagnostic report. */
doctor(): Record<string, any> {
  const mems = this.store.list()
  const embStore = this.getEmbStore()
  const embs = embStore.listEmbeddings()
  const total = mems.length
  const approved = mems.filter((m) => m.status === "approved")
  const pending = mems.filter((m) => m.status === "pending")
  const deleted = mems.filter((m) => m.status === "deleted")
  const dead = deleted.length + mems.filter((m) => m.status === "rejected").length
  const config = this.config.semantic
  const activeProfile = config.embeddings.profiles[config.activeEmbeddingProfile]

  return {
    configFile: this.configPath,
    configExists: true,
    semanticEnabled: config.enabled,
    memoryFile: this.memPath,
    embeddingFile: this.embPath,
    totalMemories: total,
    approvedMemories: approved.length,
    pendingMemories: pending.length,
    deletedMemories: deleted.length,
    embeddingCount: embs.length,
    deadWeightRatio: total ? dead / total : 0,
    activeProfileName: config.activeEmbeddingProfile,
    baseUrl: activeProfile?.baseUrl ?? "N/A",
    model: activeProfile?.model ?? "N/A",
    projectScope: this.scope?.key ?? "none",
  }
}
```

Also add the import at the top:
```typescript
import { createEmbeddingStore } from "./embedding-store.js"
import { createHash } from "node:crypto"
```

- [ ] **Step 2: Write engine-semantic.test.ts**

```typescript
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { MemoryEngine } from "../src/engine.js"
import { tempDir } from "./helpers.js"

describe("MemoryEngine (semantic)", () => {
  let dir: string
  beforeEach(() => { dir = tempDir() })

  function engine() {
    return new MemoryEngine({ memoryPath: path.join(dir, "m.jsonl"), embeddingsPath: path.join(dir, "e.jsonl"), configPath: path.join(dir, "c.json") })
  }

  it("recall returns lexical results when no provider", async () => {
    const e = engine()
    e.save({ text: "use pnpm", status: "approved" })
    const result = await e.recall("pnpm")
    assert.equal(result.memories.length, 1)
    assert.equal(result.semantic.used, false)
  })

  it("doctor returns stats", () => {
    const e = engine()
    e.save({ text: "approved", status: "approved" })
    e.save({ text: "pending" })
    const d = e.doctor()
    assert.equal(d.approvedMemories, 1)
    assert.equal(d.pendingMemories, 1)
  })

  it("probe returns error without provider", async () => {
    const e = engine()
    const p = await e.probeEmbeddingProvider()
    assert.equal(p.ok, false)
  })
})
```

- [ ] **Step 3: Run all tests**

```bash
cd ~/projects/ribbons-digital/memory-lane && pnpm test:core
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/engine.ts packages/core/test/engine-semantic.test.ts
git commit -m "feat(core): wire up recall, reindex, compact, doctor, probe"
```

- [ ] **Step 5: Update index.ts barrel exports**

Update `packages/core/src/index.ts`:

```typescript
export * from "./types.js"
export { MemoryEngine } from "./engine.js"
export { createMemoryStore, createMemoryId, foldMemoryRecords } from "./storage.js"
export {
  containsLikelySecret, inferCategory, inferMemoryKind, effectiveMemoryKind,
  memoryMatchesContext, filterMemoriesForContext, searchMemories, findDuplicateMemory,
  isCheckpointRecallQuery, normalizeMemoryText,
  parseExplicitMemoryRequest, detectUserMemorySuggestion, isCheckpointMemorySaveRequest,
} from "./search.js"
export { resolveProjectScope } from "./project-scope.js"
export { loadConfig, DEFAULT_CONFIG, getDefaultConfigPath, isLocalBaseUrl, validateConfig } from "./config.js"
export { createEmbeddingStore, foldEmbeddings } from "./embedding-store.js"
export { createOpenAIEmbeddingProvider } from "./embedding-provider.js"
export { cosineSimilarity, lexicalScore, recencyScore, findMatchingEmbedding } from "./scoring.js"
export { compact, shouldCompact } from "./compact.js"
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): update barrel exports for full API"
```

---

## Phase 3: CLI

### Task 14: CLI Scaffolding + Formatters

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/formatters.ts`

- [ ] **Step 1: Write packages/cli/package.json**

```json
{
  "name": "@memory-lane/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "memory-lane": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "test": "node --test --import ts-node/esm test/*.test.ts"
  },
  "dependencies": {
    "@memory-lane/core": "workspace:*"
  },
  "devDependencies": {
    "ts-node": "^10.9.2",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Write packages/cli/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write packages/cli/src/formatters.ts**

```typescript
import type { MemoryRecord, CompactReport, RecallResult } from "@memory-lane/core"

export function formatMemories(memories: MemoryRecord[], json: boolean): string {
  if (json) return JSON.stringify({ ok: true, data: { memories }, meta: { count: memories.length, version: "0.1.0" } }, null, 2)
  if (!memories.length) return "No memories found."
  return memories.map((m) => `[${m.id}] (${m.scope.type}/${m.category}) ${m.text}`).join("\n")
}

export function formatResult(label: string, data: unknown, json: boolean): string {
  if (json) return JSON.stringify({ ok: true, data: { [label]: data }, meta: { version: "0.1.0" } }, null, 2)
  if (data === null || data === undefined) return `${label}: (none)`
  if (typeof data === "object") return JSON.stringify(data, null, 2)
  return `${label}: ${data}`
}

export function formatRecall(result: RecallResult, json: boolean): string {
  if (json) return JSON.stringify({ ok: true, data: { memories: result.memories, semantic: result.semantic, notice: result.notice }, meta: { count: result.memories.length, version: "0.1.0" } }, null, 2)
  const lines: string[] = []
  if (result.notice) lines.push(`Notice: ${result.notice}`)
  if (result.memories.length === 0) return [...lines, "No memories found."].join("\n")
  return [...lines, ...result.memories.map((m) => `[${m.id}] (${m.scope.type}/${m.category}) ${m.text}`)].join("\n")
}

export function formatError(message: string, json: boolean): string {
  if (json) return JSON.stringify({ ok: false, error: message, meta: { version: "0.1.0" } }, null, 2)
  return `Error: ${message}`
}

export function usage(): string {
  return `memory-lane <command> [args...] [--json] [--project <path>]

Commands:
  save <text> [--scope global|project] [--category preference|personal|project] [--kind <kind>]
  suggest <text> [--scope global|project] [--category preference|personal|project]
  recall [query] [--top-k 8]
  list [--status approved|pending|rejected|deleted]
  search <query>
  delete <id>
  approve <id>
  reject <id>
  review
  compact
  doctor
  reindex [--force]
  status
  config init [--force]

Flags:
  --json           Output JSON instead of human-readable text
  --project <path> Set the project scope directory`
}
```

- [ ] **Step 4: Write packages/cli/src/index.ts**

```typescript
import { MemoryEngine } from "@memory-lane/core"
import { formatMemories, formatResult, formatRecall, formatError, formatCompact, formatDoctor, formatSaveResult, usage } from "./formatters.js"

function flag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return argv[idx + 1] ?? "true"
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`)
}

function projectPath(argv: string[]): string | undefined {
  return flag(argv, "project")
}

async function main() {
  const argv = process.argv.slice(2)
  const command = argv[0]?.toLowerCase()
  const json = hasFlag(argv, "json")
  const rest = argv.slice(1).filter((a) => !a.startsWith("--"))
  const projPath = projectPath(argv)

  if (!command || hasFlag(argv, "help") || hasFlag(argv, "h")) {
    console.log(usage())
    process.exit(command ? 2 : 0)
  }

  try {
    const engine = new MemoryEngine({ memoryPath: process.env.MEMORY_LANE_FILE, embeddingsPath: process.env.MEMORY_LANE_EMBEDDINGS_FILE, configPath: process.env.MEMORY_LANE_CONFIG })
    if (projPath) engine.refreshScope(projPath)

    switch (command) {
      case "save": {
        const text = rest.join(" ")
        if (!text) { console.log(formatError("Text required", json)); process.exit(1) }
        const result = engine.save({ text, scopeType: flag(argv, "scope") as any, category: flag(argv, "category") as any })
        console.log(formatSaveResult(result, json))
        break
      }
      case "suggest": {
        const text = rest.join(" ")
        if (!text) { console.log(formatError("Text required", json)); process.exit(1) }
        const result = engine.suggest(text, flag(argv, "category") as any, flag(argv, "scope") as any)
        console.log(formatSaveResult(result, json))
        break
      }
      case "recall": {
        const result = await engine.recall(rest.join(" "))
        console.log(formatRecall(result, json))
        break
      }
      case "list": {
        const mems = engine.list(flag(argv, "status") as any)
        console.log(formatMemories(mems, json))
        break
      }
      case "search": {
        const mems = engine.search(rest.join(" "))
        console.log(formatMemories(mems, json))
        break
      }
      case "delete": {
        const id = rest[0]
        if (!id) { console.log(formatError("ID required", json)); process.exit(1) }
        const mem = engine.delete(id)
        if (!mem) { console.log(formatError(`Memory not found: ${id}`, json)); process.exit(1) }
        console.log(formatResult("Deleted", mem, json))
        break
      }
      case "approve": {
        const id = rest[0]
        if (!id) { console.log(formatError("ID required", json)); process.exit(1) }
        const mem = engine.approve(id)
        if (!mem) { console.log(formatError(`Memory not found: ${id}`, json)); process.exit(1) }
        console.log(formatResult("Approved", mem, json))
        break
      }
      case "reject": {
        const id = rest[0]
        if (!id) { console.log(formatError("ID required", json)); process.exit(1) }
        const mem = engine.reject(id)
        if (!mem) { console.log(formatError(`Memory not found: ${id}`, json)); process.exit(1) }
        console.log(formatResult("Rejected", mem, json))
        break
      }
      case "review": {
        const pending = engine.reviewPending()
        console.log(formatMemories(pending, json))
        break
      }
      case "compact": {
        const report = engine.compact()
        console.log(json ? JSON.stringify({ ok: true, data: report }, null, 2) : `Compact: removed ${report.removedMemories} memories, ${report.removedEmbeddings} embeddings`)
        break
      }
      case "doctor": {
        const report = engine.doctor()
        if (json) { console.log(JSON.stringify({ ok: true, data: report }, null, 2)) }
        else { console.log(Object.entries(report).map(([k, v]) => `${k}: ${v}`).join("\n")) }
        break
      }
      case "status": {
        const report = engine.doctor()
        if (json) { console.log(JSON.stringify({ ok: true, data: report }, null, 2)) }
        else { console.log(`Total: ${report.totalMemories}, Approved: ${report.approvedMemories}, Pending: ${report.pendingMemories}, Embeddings: ${report.embeddingCount}`) }
        break
      }
      default:
        console.log(formatError(`Unknown command: ${command}`, json))
        process.exit(2)
    }
  } catch (err: any) {
    console.log(formatError(err.message, json))
    process.exit(1)
  }
}

main()
```

- [ ] **Step 5: Add missing formatters to formatters.ts**

Append to `formatters.ts`:

```typescript
import type { SaveResult } from "@memory-lane/core"

export function formatSaveResult(result: SaveResult, json: boolean): string {
  if (result.status === "saved") return formatResult("Saved", result.memory, json)
  return json ? JSON.stringify({ ok: true, data: { status: "skipped", reason: result.reason }, meta: { version: "0.1.0" } }, null, 2) : `Skipped: ${result.reason}`
}
```

- [ ] **Step 6: Install workspace deps and build**

```bash
cd ~/projects/ribbons-digital/memory-lane && pnpm install && pnpm build
```

- [ ] **Step 7: Test CLI manually**

```bash
cd ~/projects/ribbons-digital/memory-lane
MEMORY_LANE_FILE=/tmp/ml-test.jsonl MEMORY_LANE_EMBEDDINGS_FILE=/tmp/ml-test-emb.jsonl MEMORY_LANE_CONFIG=/tmp/ml-test-config.json node packages/cli/dist/index.js save "test memory"
```
Expected: Output showing saved memory with an ID.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): add memory-lane CLI with all commands"
```

---

## Phase 4: Pi Adapter

### Task 15: Pi Adapter Extension

**Files:**
- Create: `packages/pi-adapter/package.json`
- Create: `packages/pi-adapter/tsconfig.json`
- Create: `packages/pi-adapter/src/index.ts`

- [ ] **Step 1: Write packages/pi-adapter/package.json**

```json
{
  "name": "@memory-lane/pi-adapter",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@memory-lane/core": "workspace:*"
  },
  "devDependencies": {
    "ts-node": "^10.9.2",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Write packages/pi-adapter/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write packages/pi-adapter/src/index.ts**

This file port the pi-specific logic from `persistent-memory/index.ts`, replacing all core logic with `MemoryEngine` calls. The key pattern:

```typescript
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent"
import { MemoryEngine, type SaveResult } from "@memory-lane/core"
import * as path from "node:path"
import * as os from "node:os"

// ── Engine singleton ─────────────────────────────────────────

let engine: MemoryEngine | null = null

function getEngine(cwd: string): MemoryEngine {
  if (!engine) {
    engine = new MemoryEngine({
      memoryPath: process.env.PI_MEMORY_FILE ?? path.join(os.homedir(), ".memory-lane", "memory.jsonl"),
      embeddingsPath: process.env.PI_MEMORY_EMBEDDINGS_FILE ?? path.join(os.homedir(), ".memory-lane", "embeddings.jsonl"),
      configPath: process.env.PI_MEMORY_CONFIG_FILE ?? path.join(os.homedir(), ".pi", "agent", "memory.config.json"),
    })
  }
  engine.refreshScope(cwd)
  return engine
}

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
  ctx?.ui?.notify?.(message, level)
}

function formatMemory(m: any): string {
  return `[${m.id}] (${m.scope.type}/${m.category}) ${m.text}`
}

function formatSaveResult(r: SaveResult): string {
  if (r.status === "saved") return `Saved memory ${formatMemory(r.memory)}`
  return `Memory not saved: ${r.reason}`
}

// ── Commands ─────────────────────────────────────────────────

export default function memoryLaneExtension(pi: ExtensionAPI) {
  pi.registerCommand("remember", {
    description: "Save an approved persistent memory",
    handler: async (args, ctx) => {
      const e = getEngine(ctx.cwd)
      const text = args?.trim() ?? ""
      if (!text) { notify(ctx, "Text required", "warning"); return }
      const result = e.save({ text, status: "approved", source: "manual" })
      notify(ctx, formatSaveResult(result))
    },
  })

  pi.registerCommand("memory", {
    description: "List, search, delete, or recall persistent memories",
    handler: async (args, ctx) => {
      const e = getEngine(ctx.cwd)
      const [cmd, ...rest] = (args ?? "").trim().split(/\s+/)

      if (cmd === "list") {
        const mems = e.list()
        notify(ctx, mems.length ? mems.map(formatMemory).join("\n") : "No memories.")
      } else if (cmd === "search") {
        const mems = e.search(rest.join(" "))
        notify(ctx, mems.length ? mems.map(formatMemory).join("\n") : "No matches.")
      } else if (cmd === "delete") {
        const mem = e.delete(rest[0])
        notify(ctx, mem ? `Deleted memory ${rest[0]}` : `Memory not found: ${rest[0]}`, mem ? "info" : "warning")
      } else if (cmd === "use") {
        const result = await e.recall(rest.join(" "))
        if (!result.memories.length) notify(ctx, "No matching memories.", "info")
        else notify(ctx, `Recalled ${result.memories.length} memories.\n` + result.memories.map(formatMemory).join("\n"))
      } else if (cmd === "review") {
        const pending = e.reviewPending()
        notify(ctx, pending.length ? pending.map(formatMemory).join("\n") : "No pending memories.")
      } else if (cmd === "compact") {
        const report = e.compact()
        notify(ctx, `Compact: removed ${report.removedMemories} memories, ${report.removedEmbeddings} embeddings`)
      } else if (cmd === "status" || cmd === "doctor") {
        const d = e.doctor()
        notify(ctx, Object.entries(d).map(([k, v]) => `${k}: ${v}`).join("\n"))
      } else {
        notify(ctx, "Usage: /memory list | search <q> | delete <id> | use [q] | review | compact | status")
      }
    },
  })

  // ── Tools ─────────────────────────────────────────────────

  pi.registerTool({
    name: "memory_suggest",
    label: "Suggest Memory",
    description: "Queue a durable project-specific memory suggestion for user review.",
    parameters: {
      text: { type: "string", description: "The memory text to suggest" },
      category: {
        type: "string",
        description: "Category: preference, personal, or project",
        enum: ["preference", "personal", "project"],
      },
      status: {
        type: "string",
        description: "Status: 'approved' to bypass review, or omitted for pending",
        enum: ["approved", "pending"],
      },
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const e = getEngine(ctx.cwd)
      const result = e.suggest(params.text, "project", "project")
      if (result.status === "saved") {
        notify(ctx, `Memory suggestion ${result.memory.id} queued. Run /memory review.`)
        return { content: [{ type: "text", text: `Memory suggestion ${result.memory.id} queued.` }], details: { id: result.memory.id } }
      }
      return { content: [{ type: "text", text: `Skipped: ${result.reason}` }], details: { skipped: result.reason } }
    },
  })

  pi.registerTool({
    name: "memory_recall",
    label: "Recall Memory",
    description: "Recall approved persistent memories.",
    parameters: {
      query: { type: "string", description: "Search query to find relevant memories" },
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const e = getEngine(ctx.cwd)
      const result = await e.recall(params.query ?? "")
      const ids = result.memories.map((m: any) => m.id)
      const text = result.memories.length === 0
        ? "No matching approved memories."
        : `Recalled ${result.memories.length} memories.\n` + result.memories.map(formatMemory).join("\n")
      return { content: [{ type: "text", text }], details: { ids } }
    },
  })

  // ── Input event handling (regex-based from core) ───────────
  // Port the following from persistent-memory/index.ts:
  // 1. parseExplicitMemoryRequest() — regex detection of "remember that X"
  // 2. detectUserMemorySuggestion() — regex detection of user stating facts
  // 3. isCheckpointMemorySaveRequest() — detect "save my progress"
  //
  // Wire these into pi.on("input", ...) to:
  // - Auto-save when user says "remember that..." → engine.save()
  // - Queue suggestions when user states facts → engine.suggest()
  // - Auto-save checkpoints when user says "save progress" → engine.save() with status=approved
  //
  // The LLM intent classifier (classifyMemoryIntent) stays in this adapter
  // and uses the same pattern as persistent-memory: call the chat provider,
  // parse JSON response, validate, execute intent.
  // The core provides regex fallback; this adapter tries classifier first,
  // falls back to regex.
  //
  // For message injection on recall: use pi.sendMessage() with the
  // recalled memories formatted as markdown, same as persistent-memory
  // does with the "persistent-memory" custom message type.
}

// ── Input event handler ──────────────────────────────────────
// Add this handler inside the extension function:

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" }
    const text = typeof event.text === "string" ? event.text.trim() : ""
    if (!text) return { action: "continue" }

    const e = getEngine(ctx.cwd)

    // 1. Try LLM classifier if configured (port from persistent-memory)
    // If classifier resolves to a memory intent → execute via engine
    // If classifier unavailable → fall through to regex

    // 2. Regex-based detection (import from core)
    const { containsLikelySecret, parseExplicitMemoryRequest, detectUserMemorySuggestion, isCheckpointMemorySaveRequest } = await import("@memory-lane/core")

    // Check explicit memory request: "remember that X"
    // If matched → engine.save({ text, status: "approved" })
    // Check suggestion: "I prefer X" / "This project uses Y"
    // If matched → engine.suggest(text)
    // Check checkpoint: "save our progress"
    // If matched → engine.save({ text: synthesized summary, status: "approved", kind: "project_checkpoint" })

    return { action: "continue" }
  })
```

- [ ] **Step 4: Build and test**

```bash
cd ~/projects/ribbons-digital/memory-lane && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add packages/pi-adapter/
git commit -m "feat(pi-adapter): add pi extension wrapping MemoryEngine"
```

---

## Phase 5: Documentation & Examples

### Task 16: README + Harness Integration Examples

**Files:**
- Create: `README.md`
- Create: `examples/harness-integrations/claude-code.md`
- Create: `examples/harness-integrations/codex-cli.md`
- Create: `examples/harness-integrations/cursor.md`
- Create: `examples/harness-integrations/windsurf.md`

- [ ] **Step 1: Write README.md**

```markdown
# Memory Lane

A cross-harness, lightweight memory system for AI agent harnesses. Works across sessions, projects, and agents — no database, no MCP server, just files.

## Quickstart

```bash
# Install
cd memory-lane && pnpm install && pnpm build

# Use the CLI
memory-lane save "Always use pnpm for package installation"
memory-lane list
memory-lane recall "where did we leave off"
memory-lane search "pnpm"
memory-lane doctor
```

## Architecture

Three packages:
- **@memory-lane/core** — Pure Node.js library. Zero harness dependencies.
- **@memory-lane/cli** — CLI wrapper. Universal integration (any harness can shell out).
- **@memory-lane/pi-adapter** — pi extension adapter.

## Storage

Memories are stored as append-only JSONL at `~/.memory-lane/memory.jsonl` unless explicit environment paths or initialized project-local storage select a different active store.
Atomic memory writes use a short lock plus `.tmp` and `rename`; batch appends are atomic per underlying store.
Embeddings (when configured) are in `~/.memory-lane/embeddings.jsonl`.
Compaction removes deleted/rejected tombstones and absorbed embedding invalidations.

## Project Scoping

Project identity is resolved via `.memory-lane-scope` file (walks up from cwd) → git root → none (global fallback).

## Configuration

Default config at `~/.memory-lane/config.json`. Semantic search is disabled by default — opt-in by configuring an embedding provider.
```

- [ ] **Step 2: Write harness integration examples**

Each file in `examples/harness-integrations/` is a markdown snippet users copy into their harness config. For example, `examples/harness-integrations/claude-code.md`:

```markdown
# Memory Lane Integration for Claude Code CLI

## Setup

1. Build the CLI: `cd ~/projects/ribbons-digital/memory-lane && pnpm build`
2. Link globally: `cd packages/cli && pnpm link --global`
3. Add to your `~/.claude/CLAUDE.md`:

```
## Memory
Use the memory-lane CLI to remember important project information:
- When I say "remember my progress" or "save our state", run: memory-lane save "Current progress: <summary>" --category project --kind project_checkpoint
- When asked to recall, run: memory-lane recall "<query>"
- To check memories: memory-lane list
```
```

- [ ] **Step 3: Commit**

```bash
git add README.md examples/
git commit -m "docs: add README and harness integration examples"
```

---

## Final Commit Sequence

```bash
cd ~/projects/ribbons-digital/memory-lane

# After all tasks complete:
git log --oneline
# Should show ~15+ commits, one per task
```
