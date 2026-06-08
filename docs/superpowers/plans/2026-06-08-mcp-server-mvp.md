# MCP Server MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local stdio MCP server package exposing explicit Memory Lane tools for save, suggest, recall, list, and review.

**Architecture:** Create `@memory-lane/mcp-server` as a focused workspace package. Keep tool business logic in pure handler functions that accept a `MemoryEngine`, then register those handlers with the MCP SDK in a small server module and expose a `memory-lane-mcp` bin. Reuse `MemoryEngine`, `resolveWritableMemoryPaths`, project scope refresh, validation, recall, and storage behavior instead of reimplementing memory logic.

**Tech Stack:** TypeScript ESM, Node.js `node:test`, pnpm workspace, `@modelcontextprotocol/sdk`, Zod schemas, existing `@memory-lane/core` APIs.

---

## File Structure

- Create `packages/mcp-server/package.json`
  - Workspace package metadata, `memory-lane-mcp` bin, build/test scripts, dependencies.
- Create `packages/mcp-server/tsconfig.json`
  - Matches existing package `tsconfig` pattern.
- Create `packages/mcp-server/src/types.ts`
  - Shared MCP JSON envelope types and tool input types.
- Create `packages/mcp-server/src/handlers.ts`
  - Pure testable handlers for `memory_save`, `memory_suggest`, `memory_recall`, `memory_list`, `memory_review`.
- Create `packages/mcp-server/src/engine.ts`
  - Engine factory using `resolveWritableMemoryPaths`, config loading, and optional semantic embedding provider.
- Create `packages/mcp-server/src/server.ts`
  - MCP SDK server creation and tool registration.
- Create `packages/mcp-server/src/index.ts`
  - Bin entrypoint; connects stdio transport; stderr-only fatal diagnostics.
- Create `packages/mcp-server/test/handlers.test.ts`
  - Unit tests for handler behavior and projectPath scoping.
- Create `packages/mcp-server/test/server.test.ts`
  - Lightweight registration/metadata tests without spawning external clients.
- Modify `README.md`
  - Add MCP setup and tool summary.
- Modify `ROADMAP.md`
  - Mark Phase 7 complete after implementation passes review and verification.
- Modify `HANDOFF.md`
  - Refresh package overview/current next steps after implementation.

---

### Task 1: Add package skeleton and failing handler tests

**Files:**
- Create: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/tsconfig.json`
- Create: `packages/mcp-server/src/types.ts`
- Create: `packages/mcp-server/src/handlers.ts`
- Create: `packages/mcp-server/test/handlers.test.ts`

- [ ] **Step 1: Create `packages/mcp-server/package.json`**

```json
{
  "name": "@memory-lane/mcp-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "memory-lane-mcp": "./dist/index.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc",
    "test": "node --test --import tsx test/*.test.ts"
  },
  "dependencies": {
    "@memory-lane/core": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.18.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `packages/mcp-server/tsconfig.json`**

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

- [ ] **Step 3: Create `packages/mcp-server/src/types.ts`**

```ts
import type { MemoryCategory, MemoryKind, MemoryScopeType, MemoryStatus } from "@memory-lane/core"

export type ToolEnvelope<T> =
  | { ok: true; data: T; meta?: { count?: number; projectScope?: string | "none" } }
  | { ok: false; error: string }

export interface ProjectPathInput {
  projectPath?: string
}

export interface SaveToolInput extends ProjectPathInput {
  text: string
  category?: MemoryCategory
  scope?: MemoryScopeType
  kind?: MemoryKind
}

export interface SuggestToolInput extends SaveToolInput {
  status?: Extract<MemoryStatus, "pending" | "approved">
}

export interface RecallToolInput extends ProjectPathInput {
  query?: string
}

export interface ListToolInput extends ProjectPathInput {
  status?: MemoryStatus
  all?: boolean
}

export type ReviewToolInput = ProjectPathInput
```

- [ ] **Step 4: Create temporary red-test stub `packages/mcp-server/src/handlers.ts`**

```ts
import type { MemoryEngine } from "@memory-lane/core"
import type {
  ListToolInput, RecallToolInput, ReviewToolInput, SaveToolInput, SuggestToolInput, ToolEnvelope,
} from "./types.js"

function notImplemented(): never {
  throw new Error("MCP handlers not implemented")
}

export function jsonContent<T>(payload: ToolEnvelope<T>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

export function currentProjectScope(engine: MemoryEngine): string | "none" {
  return engine.getProjectScope()?.key ?? "none"
}

export function applyProjectPath(engine: MemoryEngine, projectPath?: string): void {
  if (projectPath) engine.refreshScope(projectPath)
}

export async function handleMemorySave(_engine: MemoryEngine, _input: SaveToolInput) {
  return jsonContent(notImplemented())
}

export async function handleMemorySuggest(_engine: MemoryEngine, _input: SuggestToolInput) {
  return jsonContent(notImplemented())
}

export async function handleMemoryRecall(_engine: MemoryEngine, _input: RecallToolInput) {
  return jsonContent(notImplemented())
}

export async function handleMemoryList(_engine: MemoryEngine, _input: ListToolInput) {
  return jsonContent(notImplemented())
}

export async function handleMemoryReview(_engine: MemoryEngine, _input: ReviewToolInput) {
  return jsonContent(notImplemented())
}
```

- [ ] **Step 5: Create failing tests in `packages/mcp-server/test/handlers.test.ts`**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { MemoryEngine } from "@memory-lane/core"
import {
  handleMemoryList, handleMemoryRecall, handleMemoryReview, handleMemorySave, handleMemorySuggest,
} from "../src/handlers.ts"

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-mcp-"))
}

function engineInTemp(cwd?: string): MemoryEngine {
  const dir = tempDir()
  const engine = new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath: path.join(dir, "config.json"),
  })
  if (cwd) engine.refreshScope(cwd)
  return engine
}

function parseToolResult(result: { content: Array<{ type: string; text?: string }> }): any {
  const text = result.content.find((item) => item.type === "text")?.text
  assert.equal(typeof text, "string")
  return JSON.parse(text!)
}

test("memory_save stores an approved memory", async () => {
  const engine = engineInTemp()
  const result = parseToolResult(await handleMemorySave(engine, { text: "Use pnpm for installs", category: "preference", scope: "global" }))

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "saved")
  assert.equal(result.data.memory.status, "approved")
  assert.equal(result.data.memory.text, "Use pnpm for installs")
  assert.equal(result.meta.projectScope, "none")
})

test("memory_save reports skipped secret without throwing", async () => {
  const engine = engineInTemp()
  const result = parseToolResult(await handleMemorySave(engine, { text: "api_key = sk-1234567890abcdef1234567890abcdef" }))

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, { status: "skipped", reason: "secret" })
})

test("memory_suggest defaults to pending and can approve explicitly", async () => {
  const engine = engineInTemp()
  const pending = parseToolResult(await handleMemorySuggest(engine, { text: "Review docs before implementation" }))
  const approved = parseToolResult(await handleMemorySuggest(engine, { text: "This project uses pnpm", status: "approved", category: "project", scope: "global" }))

  assert.equal(pending.data.memory.status, "pending")
  assert.equal(approved.data.memory.status, "approved")
})

test("memory_recall returns memories and semantic metadata", async () => {
  const engine = engineInTemp()
  engine.save({ text: "Tests run with pnpm test", status: "approved", category: "project", scopeType: "global" })

  const result = parseToolResult(await handleMemoryRecall(engine, { query: "How do tests run?" }))

  assert.equal(result.ok, true)
  assert.equal(result.data.memories.length, 1)
  assert.equal(result.data.semantic.enabled, false)
  assert.equal(result.meta.count, 1)
})

test("memory_list respects project scope by default and all bypasses scope", async () => {
  const projectA = tempDir()
  const projectB = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "project-a" }))
  fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "project-b" }))

  const engine = engineInTemp(projectA)
  engine.save({ text: "A scoped fact", status: "approved", category: "project", scopeType: "project" })
  engine.refreshScope(projectB)
  engine.save({ text: "B scoped fact", status: "approved", category: "project", scopeType: "project" })

  const scoped = parseToolResult(await handleMemoryList(engine, { projectPath: projectA }))
  const all = parseToolResult(await handleMemoryList(engine, { projectPath: projectA, all: true }))

  assert.deepEqual(scoped.data.memories.map((m: any) => m.text), ["A scoped fact"])
  assert.equal(all.data.memories.length, 2)
})

test("memory_review returns pending memories", async () => {
  const engine = engineInTemp()
  engine.suggest("Pending review item")

  const result = parseToolResult(await handleMemoryReview(engine, {}))

  assert.equal(result.ok, true)
  assert.equal(result.data.memories.length, 1)
  assert.equal(result.data.memories[0].status, "pending")
})
```

- [ ] **Step 6: Install workspace dependencies**

Run from repo root:

```bash
sfw pnpm install
```

Expected: lockfile updates and install succeeds.

- [ ] **Step 7: Run handler tests to verify RED**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test
```

Expected: FAIL with `MCP handlers not implemented` from the temporary red-test stub handlers.

- [ ] **Step 8: Commit package skeleton and red tests**

```bash
git add pnpm-lock.yaml packages/mcp-server
git commit -m "test(mcp): cover memory tool handlers"
```

---

### Task 2: Implement pure MCP tool handlers

**Files:**
- Modify: `packages/mcp-server/src/handlers.ts`
- Test: `packages/mcp-server/test/handlers.test.ts`

- [ ] **Step 1: Replace `packages/mcp-server/src/handlers.ts` with handler implementation**

```ts
import type { MemoryEngine, MemoryRecord, RecallResult, SaveResult } from "@memory-lane/core"
import type {
  ListToolInput, RecallToolInput, ReviewToolInput, SaveToolInput, SuggestToolInput, ToolEnvelope,
} from "./types.js"

type ToolResult<T> = {
  content: Array<{ type: "text"; text: string }>
  structuredContent: ToolEnvelope<T>
}

function envelope<T>(engine: MemoryEngine, data: T, count?: number): ToolEnvelope<T> {
  const meta: { count?: number; projectScope?: string | "none" } = { projectScope: currentProjectScope(engine) }
  if (count !== undefined) meta.count = count
  return { ok: true, data, meta }
}

function errorEnvelope(error: unknown): ToolEnvelope<never> {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: message }
}

export function jsonContent<T>(payload: ToolEnvelope<T>): ToolResult<T> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

export function currentProjectScope(engine: MemoryEngine): string | "none" {
  return engine.getProjectScope()?.key ?? "none"
}

export function applyProjectPath(engine: MemoryEngine, projectPath?: string): void {
  if (projectPath) engine.refreshScope(projectPath)
}

function saveData(result: SaveResult): { status: "saved"; memory: MemoryRecord; warnings?: string[] } | { status: "skipped"; reason: string; warnings?: string[] } {
  if (result.status === "saved") return { status: "saved", memory: result.memory, warnings: result.warnings }
  return { status: "skipped", reason: result.reason, warnings: result.warnings }
}

export async function handleMemorySave(engine: MemoryEngine, input: SaveToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const result = engine.save({
      text: input.text,
      category: input.category,
      scopeType: input.scope,
      kind: input.kind,
      status: "approved",
      source: "manual",
    })
    return jsonContent(envelope(engine, saveData(result)))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemorySuggest(engine: MemoryEngine, input: SuggestToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const result = engine.suggest(input.text, input.category, input.scope, input.kind, input.status)
    return jsonContent(envelope(engine, saveData(result)))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemoryRecall(engine: MemoryEngine, input: RecallToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const result: RecallResult = await engine.recall(input.query ?? "")
    return jsonContent(envelope(engine, result, result.memories.length))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemoryList(engine: MemoryEngine, input: ListToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const memories = engine.list({ status: input.status, all: input.all ?? false })
    return jsonContent(envelope(engine, { memories }, memories.length))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}

export async function handleMemoryReview(engine: MemoryEngine, input: ReviewToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    const memories = engine.reviewPending()
    return jsonContent(envelope(engine, { memories }, memories.length))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}
```

- [ ] **Step 2: Run handler tests to verify GREEN**

```bash
pnpm --filter @memory-lane/mcp-server test
```

Expected: PASS for all handler tests.

- [ ] **Step 3: Run package build**

```bash
pnpm --filter @memory-lane/mcp-server build
```

Expected: PASS.

- [ ] **Step 4: Commit handler implementation**

```bash
git add packages/mcp-server/src/handlers.ts
git commit -m "feat(mcp): implement memory tool handlers"
```

---

### Task 3: Add MCP server registration and stdio startup

**Files:**
- Create: `packages/mcp-server/src/engine.ts`
- Create: `packages/mcp-server/src/server.ts`
- Create: `packages/mcp-server/src/index.ts`
- Create: `packages/mcp-server/test/server.test.ts`
- Modify: `packages/mcp-server/package.json` if SDK/Zod versions require adjustment

- [ ] **Step 1: Create failing registration tests in `packages/mcp-server/test/server.test.ts`**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { MemoryEngine } from "@memory-lane/core"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createMemoryLaneMcpServer, MEMORY_LANE_TOOL_NAMES } from "../src/server.ts"
import { createMemoryLaneEngine } from "../src/engine.ts"

function engineInTemp(): MemoryEngine {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-mcp-server-"))
  return new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath: path.join(dir, "config.json"),
  })
}

test("exports the five Phase 7 tool names", () => {
  assert.deepEqual(MEMORY_LANE_TOOL_NAMES, [
    "memory_save",
    "memory_suggest",
    "memory_recall",
    "memory_list",
    "memory_review",
  ])
})

test("creates an MCP server without writing to stdout", () => {
  const originalWrite = process.stdout.write
  let stdoutWrites = 0
  ;(process.stdout.write as any) = (..._args: unknown[]) => {
    stdoutWrites++
    return true
  }
  try {
    const server = createMemoryLaneMcpServer({ engine: engineInTemp() })
    assert.equal(typeof server.connect, "function")
    assert.equal(stdoutWrites, 0)
  } finally {
    process.stdout.write = originalWrite
  }
})

test("createMemoryLaneEngine uses explicit environment paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-mcp-engine-"))
  const engine = createMemoryLaneEngine({
    cwd: dir,
    env: {
      MEMORY_LANE_FILE: path.join(dir, "custom-memory.jsonl"),
      MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "custom-embeddings.jsonl"),
      MEMORY_LANE_CONFIG: path.join(dir, "custom-config.json"),
    },
  })

  const result = engine.save({ text: "MCP engine path smoke", status: "approved", scopeType: "global" })
  assert.equal(result.status, "saved")
  assert.equal(fs.existsSync(path.join(dir, "custom-memory.jsonl")), true)
})
```

- [ ] **Step 2: Run tests to verify RED**

```bash
pnpm --filter @memory-lane/mcp-server test
```

Expected: FAIL because `src/server.ts` and `src/engine.ts` do not exist yet.

- [ ] **Step 3: Create `packages/mcp-server/src/engine.ts`**

```ts
import {
  MemoryEngine, createOpenAIEmbeddingProvider, loadConfig, resolveWritableMemoryPaths,
  type MemoryEngineConfig,
} from "@memory-lane/core"

export interface CreateMemoryLaneEngineOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
}

function createEmbeddingProvider(configPath: string): MemoryEngineConfig["embeddingProvider"] | undefined {
  try {
    const cfg = loadConfig(configPath)
    if (!cfg.semantic.enabled) return undefined
    const profile = cfg.semantic.embeddings.profiles[cfg.semantic.activeEmbeddingProfile]
    return profile ? createOpenAIEmbeddingProvider(profile) : undefined
  } catch {
    return undefined
  }
}

export function createMemoryLaneEngine(options: CreateMemoryLaneEngineOptions = {}): MemoryEngine {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const paths = resolveWritableMemoryPaths({ cwd, env, autoInitProjectLocalOnHomeFailure: true })
  const engine = new MemoryEngine({
    memoryPath: paths.memoryPath,
    embeddingsPath: paths.embeddingsPath,
    configPath: paths.configPath,
    embeddingProvider: createEmbeddingProvider(paths.configPath),
    env,
  })
  engine.refreshScope(cwd)
  return engine
}
```

- [ ] **Step 4: Create `packages/mcp-server/src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { MemoryEngine } from "@memory-lane/core"
import {
  handleMemoryList, handleMemoryRecall, handleMemoryReview, handleMemorySave, handleMemorySuggest,
} from "./handlers.js"

export const MEMORY_LANE_TOOL_NAMES = [
  "memory_save",
  "memory_suggest",
  "memory_recall",
  "memory_list",
  "memory_review",
] as const

const categorySchema = z.enum(["preference", "personal", "project"])
const scopeSchema = z.enum(["global", "project"])
const statusSchema = z.enum(["pending", "approved", "rejected", "deleted"])
const suggestStatusSchema = z.enum(["pending", "approved"])
const kindSchema = z.enum([
  "preference",
  "personal_context",
  "project_fact",
  "project_checkpoint",
  "workflow_rule",
  "decision",
  "misc",
])

const projectPath = z.string().optional().describe("Optional directory to use for project-scoped Memory Lane operations")

export interface CreateMemoryLaneMcpServerOptions {
  engine: MemoryEngine
}

export function createMemoryLaneMcpServer(options: CreateMemoryLaneMcpServerOptions): McpServer {
  const server = new McpServer({ name: "memory-lane", version: "0.1.0" })
  const engine = options.engine

  server.registerTool(
    "memory_save",
    {
      title: "Save Memory",
      description: "Save an explicit approved Memory Lane memory.",
      inputSchema: {
        text: z.string().min(1),
        category: categorySchema.optional(),
        scope: scopeSchema.optional(),
        kind: kindSchema.optional(),
        projectPath,
      },
    },
    async (input) => handleMemorySave(engine, input),
  )

  server.registerTool(
    "memory_suggest",
    {
      title: "Suggest Memory",
      description: "Queue a pending Memory Lane suggestion, or approve it when status is approved.",
      inputSchema: {
        text: z.string().min(1),
        category: categorySchema.optional(),
        scope: scopeSchema.optional(),
        kind: kindSchema.optional(),
        status: suggestStatusSchema.optional(),
        projectPath,
      },
    },
    async (input) => handleMemorySuggest(engine, input),
  )

  server.registerTool(
    "memory_recall",
    {
      title: "Recall Memories",
      description: "Recall Memory Lane memories relevant to a query.",
      inputSchema: {
        query: z.string().optional(),
        projectPath,
      },
    },
    async (input) => handleMemoryRecall(engine, input),
  )

  server.registerTool(
    "memory_list",
    {
      title: "List Memories",
      description: "List Memory Lane memories visible to the current project scope by default.",
      inputSchema: {
        status: statusSchema.optional(),
        all: z.boolean().optional(),
        projectPath,
      },
    },
    async (input) => handleMemoryList(engine, input),
  )

  server.registerTool(
    "memory_review",
    {
      title: "Review Pending Memories",
      description: "List pending Memory Lane memories for review.",
      inputSchema: {
        projectPath,
      },
    },
    async (input) => handleMemoryReview(engine, input),
  )

  return server
}
```

- [ ] **Step 5: Create `packages/mcp-server/src/index.ts`**

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createMemoryLaneEngine } from "./engine.js"
import { createMemoryLaneMcpServer } from "./server.js"

async function main(): Promise<void> {
  const server = createMemoryLaneMcpServer({ engine: createMemoryLaneEngine() })
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Memory Lane MCP server failed: ${message}`)
  process.exit(1)
})
```

- [ ] **Step 6: Run MCP package tests**

```bash
pnpm --filter @memory-lane/mcp-server test
```

Expected: PASS.

If TypeScript reports SDK/Zod schema type errors, adjust `server.registerTool` input schema shape to match the installed SDK while preserving the tool names and handler calls. Keep this adjustment inside `src/server.ts` only.

- [ ] **Step 7: Run MCP package build**

```bash
pnpm --filter @memory-lane/mcp-server build
```

Expected: PASS and `packages/mcp-server/dist/index.js` exists.

- [ ] **Step 8: Commit server implementation**

```bash
git add packages/mcp-server
git commit -m "feat(mcp): add stdio memory server"
```

---

### Task 4: Add MCP documentation

**Files:**
- Modify: `README.md`
- Create: `examples/harness-integrations/mcp.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Add README MCP section**

Add this section near the harness/integration documentation area in `README.md`:

```md
## MCP Server

Memory Lane includes a local stdio MCP server for clients that support explicit MCP tools, such as Claude Desktop and Cursor.

The MCP server exposes explicit tools only:

- `memory_save` — save an approved memory
- `memory_suggest` — queue a pending suggestion, or save approved when `status: "approved"`
- `memory_recall` — recall relevant memories for a query
- `memory_list` — list memories visible to the current project scope by default
- `memory_review` — list pending memories for review

MCP does not replace lifecycle hooks. Hooks provide automatic recall/save behavior for supported harnesses; MCP gives the model explicit tool access when the client asks for it. JSONL remains the source of truth, and Obsidian support remains optional.

Example local stdio command after building this workspace:

```bash
pnpm --filter @memory-lane/mcp-server build
node packages/mcp-server/dist/index.js
```

Do not wrap the server with commands that print banners to stdout. MCP stdio reserves stdout for JSON-RPC protocol messages.

See `examples/harness-integrations/mcp.md` for client configuration examples.
```

- [ ] **Step 2: Create `examples/harness-integrations/mcp.md`**

```md
# Memory Lane MCP Server

Memory Lane's MCP server is a local stdio server for explicit memory tool access.

## Build

From the Memory Lane repo:

```bash
pnpm --filter @memory-lane/mcp-server build
```

The stdio entrypoint is:

```bash
node /absolute/path/to/memory-lane/packages/mcp-server/dist/index.js
```

Do not use a wrapper that prints to stdout. Stdio MCP servers use stdout for JSON-RPC messages.

## Claude Desktop

Add a local stdio server entry in Claude Desktop's MCP configuration. Use absolute paths:

```json
{
  "mcpServers": {
    "memory-lane": {
      "command": "node",
      "args": ["/absolute/path/to/memory-lane/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop after editing the configuration.

## Cursor

Use Cursor's MCP server configuration with the same local stdio command:

```json
{
  "mcpServers": {
    "memory-lane": {
      "command": "node",
      "args": ["/absolute/path/to/memory-lane/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Client configuration UI and file locations may vary by Cursor version; keep the command and args shape the same.

## Claude Code and Codex

Claude Code and Codex can continue using Memory Lane lifecycle hooks for automatic recall/save behavior. MCP is separate: it gives explicit tool access when the client supports MCP tools. Do not configure MCP expecting it to run lifecycle hook events.

## Tools

- `memory_save`
- `memory_suggest`
- `memory_recall`
- `memory_list`
- `memory_review`

Each tool accepts optional `projectPath` where project-scoped behavior should be resolved from a specific directory. If omitted, Memory Lane uses the MCP server process current working directory.
```

- [ ] **Step 3: Update `ROADMAP.md` Phase 7 status**

Replace the Phase 7 section header body with completed status after implementation is verified:

```md
## Phase 7 — MCP Server MVP

**Status:** Complete and merged.

**Goal:** Expose Memory Lane through MCP without changing the storage model.

Completed scope:

1. Added `@memory-lane/mcp-server` package.
2. Exposed stdio MCP tools: `memory_save`, `memory_suggest`, `memory_recall`, `memory_list`, and `memory_review`.
3. Reused existing `MemoryEngine`, project scope, validation, and retrieval logic.
4. Added local stdio setup docs for Claude Desktop, Cursor, Claude Code, and Codex boundaries.
5. Kept MCP resources, prompts, HTTP transport, hook/MCP coordination diagnostics, and Obsidian status out of scope for Phase 8 or later.
```

- [ ] **Step 4: Update `HANDOFF.md`**

Add `@memory-lane/mcp-server` to package overview and update suggested next steps so Phase 8 is next only after MCP has landed:

```md
- `@memory-lane/mcp-server` — local stdio MCP server exposing explicit Memory Lane tools.
```

Add a short MCP semantics section:

```md
## MCP server semantics

The MCP server is explicit tool access, not lifecycle automation. It exposes `memory_save`, `memory_suggest`, `memory_recall`, `memory_list`, and `memory_review` over local stdio. It reuses JSONL storage, `MemoryEngine`, and project scope behavior. It does not add MCP resources, prompts, HTTP transport, Obsidian status tools, or automatic hook behavior.
```

- [ ] **Step 5: Verify docs references**

```bash
rg -n "MCP Server|memory-lane-mcp|memory_save|memory_review|Claude Desktop|Cursor|stdout|Phase 7" README.md ROADMAP.md HANDOFF.md examples/harness-integrations/mcp.md
```

Expected: all files contain the relevant MCP documentation and no stale "Phase 7 todo" text remains if Phase 7 was marked complete.

- [ ] **Step 6: Commit docs**

```bash
git add README.md ROADMAP.md HANDOFF.md examples/harness-integrations/mcp.md
git commit -m "docs: explain mcp server setup"
```

---

### Task 5: Final verification and review

**Files:**
- No edits expected unless verification reveals issues.

- [ ] **Step 1: Run full build**

```bash
pnpm build
```

Expected: PASS, including `@memory-lane/mcp-server`.

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: PASS, including MCP server tests.

- [ ] **Step 3: Run package-level MCP smoke**

```bash
pnpm --filter @memory-lane/mcp-server build
node -e 'import("./packages/mcp-server/dist/server.js").then(({MEMORY_LANE_TOOL_NAMES}) => console.log(MEMORY_LANE_TOOL_NAMES.join(",")))'
```

Expected output:

```text
memory_save,memory_suggest,memory_recall,memory_list,memory_review
```

- [ ] **Step 4: Inspect git state**

```bash
git status --short --branch
git log --oneline --decorate --max-count=10
```

Expected: clean branch with spec, plan, test, implementation, and docs commits.

- [ ] **Step 5: Request final review**

Ask fresh reviewers to inspect the branch against:

- `docs/superpowers/specs/2026-06-08-mcp-server-mvp.md`
- `docs/superpowers/plans/2026-06-08-mcp-server-mvp.md`
- current diff from `main`

Required review angles:

1. Spec compliance and scope boundary: tools-only stdio MVP, no Phase 8 features.
2. Correctness/quality: handler envelopes, skipped/error behavior, projectPath scoping, stdout safety, tests, docs.

- [ ] **Step 6: Fix review findings if required**

If reviewers find required fixes, launch a single fix worker with only accepted findings. Re-run:

```bash
pnpm build
pnpm test
```

Expected: PASS.

- [ ] **Step 7: Merge only after approval**

Use the finishing-a-development-branch workflow after final approval and verification.
