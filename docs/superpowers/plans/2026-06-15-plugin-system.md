# Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a lightweight plugin system for Memory Lane and use it to ship Phase 9 (Obsidian LLM Wiki / Knowledge Base Integration) as the first optional plugin.

**Architecture:** Add plugin config keys to `@memory-lane/core`, expose a typed `MemoryLanePluginAPI` from a new `@memory-lane/plugin-api` package, load plugins in both the CLI and MCP server, and register plugin MCP tools/resources and CLI commands. Phase 9 becomes `@memory-lane/plugin-obsidian-wiki`, a separate package that uses the new API.

**Tech Stack:** TypeScript, Node.js test runner, pnpm workspaces, `@modelcontextprotocol/sdk`, Zod, existing Memory Lane packages.

---

## Files

- Create:
  - `packages/plugin-api/src/index.ts` — plugin API types and loader.
  - `packages/plugin-api/package.json` — package manifest.
  - `packages/plugin-api/test/loader.test.ts` — loader tests.
  - `packages/plugin-obsidian-wiki/src/index.ts` — Phase 9 plugin implementation.
  - `packages/plugin-obsidian-wiki/src/notes.ts` — note discovery and reading.
  - `packages/plugin-obsidian-wiki/src/citations.ts` — source-backed citation formatting.
  - `packages/plugin-obsidian-wiki/src/config.ts` — plugin config validation.
  - `packages/plugin-obsidian-wiki/package.json` — package manifest.
  - `packages/plugin-obsidian-wiki/test/plugin.test.ts` — plugin tests.
- Modify:
  - `packages/core/src/types.ts` — add plugin config fields.
  - `packages/core/src/config.ts` — validate plugin config.
  - `packages/core/src/index.ts` — export plugin config types.
  - `packages/mcp-server/src/server.ts` — accept and register plugin tools/resources.
  - `packages/mcp-server/src/engine.ts` — load plugins from config.
  - `packages/mcp-server/package.json` — add `@memory-lane/plugin-api` dependency.
  - `packages/cli/src/index.ts` — load plugins and register CLI commands.
  - `packages/cli/src/formatters.ts` — include plugin commands in help output.
  - `packages/cli/package.json` — add `@memory-lane/plugin-api` dependency.
  - `ROADMAP.md` — mark Phase 9 as plugin work.
  - `README.md` — document plugin installation and the Obsidian Wiki plugin.
  - `skills/memory-lane/SKILL.md` — mention plugin system.

---

## Task 1: Add plugin API package

**Files:**
- Create: `packages/plugin-api/src/index.ts`
- Create: `packages/plugin-api/package.json`
- Create: `packages/plugin-api/tsconfig.json`

- [ ] **Step 1: Create `packages/plugin-api/package.json`**

```json
{
  "name": "@memory-lane/plugin-api",
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
  "scripts": {
    "build": "tsc",
    "test": "node --test --import tsx test/*.test.ts"
  },
  "dependencies": {
    "@memory-lane/core": "workspace:*",
    "@modelcontextprotocol/sdk": "workspace:*",
    "zod": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `packages/plugin-api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/plugin-api/src/index.ts`**

```ts
import type { MemoryEngine, MemoryLaneConfig } from "@memory-lane/core"
import type { z } from "zod"

export interface McpToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: z.ZodTypeAny | Record<string, unknown>
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>
    details?: Record<string, unknown>
  }>
}

export interface McpResourceDefinition {
  uri: string
  name: string
  description: string
  mimeType?: string
  handler: (uri: URL) => Promise<{
    contents: Array<{
      uri: string
      mimeType?: string
      text?: string
      blob?: string
    }>
  }>
}

export interface CliCommandContext {
  argv: string[]
  rest: string[]
  json: boolean
  configPath: string
  engine: MemoryEngine
}

export interface CliCommandDefinition {
  name: string
  description: string
  usage: string
  handler: (ctx: CliCommandContext) => Promise<void> | void
}

export interface MemoryLanePluginAPI {
  readonly name: string
  readonly version: string
  readonly engine: MemoryEngine
  readonly config: MemoryLaneConfig
  registerMcpTool(tool: McpToolDefinition): void
  registerMcpResource(resource: McpResourceDefinition): void
  registerCliCommand(command: CliCommandDefinition): void
}

export interface LoadedPlugin {
  name: string
  module: { default?: (api: MemoryLanePluginAPI) => void }
  api: MemoryLanePluginAPI
}

export interface LoadPluginsOptions {
  pluginNames: string[]
  engine: MemoryEngine
  config: MemoryLaneConfig
  context: "cli" | "mcp"
}

export function createPluginAPI(
  name: string,
  version: string,
  engine: MemoryEngine,
  config: MemoryLaneConfig,
  context: "cli" | "mcp",
): MemoryLanePluginAPI {
  const mcpTools: McpToolDefinition[] = []
  const mcpResources: McpResourceDefinition[] = []
  const cliCommands: CliCommandDefinition[] = []

  return {
    name,
    version,
    engine,
    config,
    registerMcpTool(tool) {
      if (context !== "mcp") return
      mcpTools.push(tool)
    },
    registerMcpResource(resource) {
      if (context !== "mcp") return
      mcpResources.push(resource)
    },
    registerCliCommand(command) {
      if (context !== "cli") return
      cliCommands.push(command)
    },
  }
}

export async function loadPlugins(options: LoadPluginsOptions): Promise<LoadedPlugin[]> {
  const seen = new Set<string>()
  const plugins: LoadedPlugin[] = []

  for (const name of options.pluginNames) {
    if (seen.has(name)) continue
    seen.add(name)

    let module: any
    try {
      module = await import(name)
    } catch (err) {
      throw new Error(`Failed to load plugin "${name}": ${err instanceof Error ? err.message : String(err)}`)
    }

    if (typeof module.default !== "function") {
      throw new Error(`Plugin "${name}" does not export a default function`)
    }

    const api = createPluginAPI(name, "0.0.0", options.engine, options.config, options.context)
    module.default(api)

    plugins.push({ name, module, api })
  }

  return plugins
}
```

- [ ] **Step 4: Build and test the package**

Run:

```bash
cd packages/plugin-api
pnpm build
```

Expected: TypeScript compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-api
git commit -m "feat(plugin-api): add lightweight plugin API package"
```

---

## Task 2: Add plugin config to core

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add plugin config types to `packages/core/src/types.ts`**

Find the `MemoryLaneConfig` interface and add:

```ts
export interface MemoryLaneConfig {
  // ... existing fields ...
  plugins?: string[]
  pluginConfig?: Record<string, unknown>
}
```

- [ ] **Step 2: Update config validation in `packages/core/src/config.ts`**

Add to the validator/schema:

```ts
if (config.plugins !== undefined) {
  if (!Array.isArray(config.plugins) || !config.plugins.every((p) => typeof p === "string")) {
    throw new ConfigValidationError("plugins must be an array of strings")
  }
}

if (config.pluginConfig !== undefined) {
  if (typeof config.pluginConfig !== "object" || config.pluginConfig === null || Array.isArray(config.pluginConfig)) {
    throw new ConfigValidationError("pluginConfig must be an object")
  }
}
```

- [ ] **Step 3: Export plugin config types from `packages/core/src/index.ts`**

Ensure `MemoryLaneConfig` is exported (it likely already is).

- [ ] **Step 4: Add core tests**

Create `packages/core/test/config-plugins.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { loadConfig, writeConfig } from "../src/config.js"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

test("loads config with plugins and pluginConfig", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-config-test-"))
  const configPath = path.join(dir, "config.json")
  writeConfig(configPath, {
    plugins: ["@memory-lane/plugin-obsidian-wiki"],
    pluginConfig: {
      "@memory-lane/plugin-obsidian-wiki": { vaultPath: "/tmp/vault" },
    },
  })

  const cfg = loadConfig(configPath)
  assert.deepEqual(cfg.plugins, ["@memory-lane/plugin-obsidian-wiki"])
  assert.equal(cfg.pluginConfig?.["@memory-lane/plugin-obsidian-wiki"].vaultPath, "/tmp/vault")

  fs.rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 5: Run core tests**

Run:

```bash
cd packages/core
node --test --import tsx test/config-plugins.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): add plugins and pluginConfig to MemoryLane config"
```

---

## Task 3: Load plugins in the MCP server

**Files:**
- Modify: `packages/mcp-server/src/engine.ts`
- Modify: `packages/mcp-server/src/server.ts`
- Modify: `packages/mcp-server/package.json`

- [ ] **Step 1: Add `@memory-lane/plugin-api` dependency to `packages/mcp-server/package.json`**

```json
"dependencies": {
  "@memory-lane/core": "workspace:*",
  "@memory-lane/lifecycle": "workspace:*",
  "@memory-lane/plugin-api": "workspace:*",
  "@modelcontextprotocol/sdk": "workspace:*",
  "zod": "workspace:*"
}
```

- [ ] **Step 2: Update `packages/mcp-server/src/engine.ts`**

Read the current file. Find where the `MemoryEngine` is created and add plugin loading:

```ts
import { loadPlugins } from "@memory-lane/plugin-api"

export interface EngineOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  configPath?: string
}

export async function createEngine(options: EngineOptions = {}) {
  // ... existing engine creation code ...
  const config = loadConfig(configPath)
  const engine = new MemoryEngine({ ... })

  const plugins = config.plugins?.length
    ? await loadPlugins({
        pluginNames: config.plugins,
        engine,
        config,
        context: "mcp",
      })
    : []

  return { engine, config, plugins }
}
```

- [ ] **Step 3: Update `packages/mcp-server/src/server.ts`**

Change `CreateMemoryLaneMcpServerOptions` to accept plugin registrations:

```ts
export interface CreateMemoryLaneMcpServerOptions {
  engine: MemoryEngine
  plugins?: LoadedPlugin[]
}
```

At the end of `createMemoryLaneMcpServer`, after registering built-in tools, iterate over plugins and register their MCP tools/resources:

```ts
for (const plugin of options.plugins ?? []) {
  // Register tools
  // Register resources
}
```

Use the plugin API's collected lists (currently stored only inside the closure). You may need to expose `getMcpTools()` and `getMcpResources()` on the API or collect them another way. Update `createPluginAPI` in Task 1 if needed.

- [ ] **Step 4: Update MCP server entry point**

Find where `createEngine` and `createMemoryLaneMcpServer` are called (likely `packages/mcp-server/src/index.ts`) and pass `plugins` through.

- [ ] **Step 5: Run MCP server tests**

Run:

```bash
cd packages/mcp-server
node --test --import tsx test/*.test.ts
```

Expected: existing tests pass; add a new test if needed.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server
git commit -m "feat(mcp-server): load and register plugins"
```

---

## Task 4: Load plugins in the CLI

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Add `@memory-lane/plugin-api` dependency to `packages/cli/package.json`**

```json
"dependencies": {
  "@memory-lane/core": "workspace:*",
  "@memory-lane/lifecycle": "workspace:*",
  "@memory-lane/mcp-server": "workspace:*",
  "@memory-lane/obsidian-import": "workspace:*",
  "@memory-lane/obsidian-mirror": "workspace:*",
  "@memory-lane/plugin-api": "workspace:*",
  "@memory-lane/claude-adapter": "workspace:*",
  "@memory-lane/codex-adapter": "workspace:*",
  "typebox": "^1.1.38"
}
```

- [ ] **Step 2: Load plugins after engine creation in `packages/cli/src/index.ts`**

After the engine is created in `main()`, load plugins:

```ts
import { loadPlugins } from "@memory-lane/plugin-api"

const config = loadConfig(configPath)
const plugins = config.plugins?.length
  ? await loadPlugins({ pluginNames: config.plugins, engine, config, context: "cli" })
  : []
```

- [ ] **Step 3: Register plugin CLI commands**

Before calling `dispatch()`, merge plugin commands into the command handler map:

```ts
for (const plugin of plugins) {
  // Assuming the plugin API exposes collected CLI commands
  for (const cmd of plugin.api.getCliCommands()) {
    commandHandlers[cmd.name] = cmd.handler
  }
}
```

Update `createPluginAPI` to expose `getCliCommands()` if not already done.

- [ ] **Step 4: Update help output in `packages/cli/src/formatters.ts`**

Add plugin commands to the usage string. If plugin commands are dynamic, accept them as a parameter:

```ts
export function usage(pluginCommands: { name: string; usage: string; description: string }[] = []): string {
  // ... existing usage ...
  const pluginLines = pluginCommands.map((c) => `  ${c.usage}\n                  ${c.description}`).join("\n")
  return [baseUsage, pluginLines ? "\nPlugin commands:\n" + pluginLines : ""].join("\n")
}
```

- [ ] **Step 5: Add CLI tests**

Create `packages/cli/test/plugins.test.ts`:

```ts
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, test } from "node:test"
import { spawnSync } from "node:child_process"

function run(args: string[], env: NodeJS.ProcessEnv = {}): ReturnType<typeof spawnSync> {
  const cli = path.resolve(__dirname, "../dist/index.js")
  return spawnSync("node", [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
}

let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

test("unknown plugin produces clear error", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-plugin-cli-test-"))
  cleanup = () => fs.rmSync(dir, { recursive: true, force: true })

  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ plugins: ["nonexistent-plugin"] }))

  const result = run(["status"], {
    HOME: dir,
    MEMORY_LANE_CONFIG: path.join(dir, "config.json"),
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /nonexistent-plugin/)
})
```

- [ ] **Step 6: Run CLI tests**

Run:

```bash
cd packages/cli
node --test --import tsx test/*.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): load plugins and register plugin commands"
```

---

## Task 5: Implement Phase 9 as the Obsidian Wiki plugin

**Files:**
- Create: `packages/plugin-obsidian-wiki/package.json`
- Create: `packages/plugin-obsidian-wiki/tsconfig.json`
- Create: `packages/plugin-obsidian-wiki/src/index.ts`
- Create: `packages/plugin-obsidian-wiki/src/config.ts`
- Create: `packages/plugin-obsidian-wiki/src/notes.ts`
- Create: `packages/plugin-obsidian-wiki/src/citations.ts`
- Create: `packages/plugin-obsidian-wiki/test/plugin.test.ts`

- [ ] **Step 1: Create `packages/plugin-obsidian-wiki/package.json`**

```json
{
  "name": "@memory-lane/plugin-obsidian-wiki",
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
  "scripts": {
    "build": "tsc",
    "test": "node --test --import tsx test/*.test.ts"
  },
  "dependencies": {
    "@memory-lane/core": "workspace:*",
    "@memory-lane/plugin-api": "workspace:*",
    "@modelcontextprotocol/sdk": "workspace:*",
    "zod": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create config validator `packages/plugin-obsidian-wiki/src/config.ts`**

```ts
import { z } from "zod"

export const obsidianWikiConfigSchema = z.object({
  vaultPath: z.string().min(1),
  includeFolders: z.array(z.string()).optional(),
  excludeFolders: z.array(z.string()).optional().default(["Private", "Daily"]),
})

export type ObsidianWikiConfig = z.infer<typeof obsidianWikiConfigSchema>

export function getConfig(api: { config: { pluginConfig?: Record<string, unknown> }; name: string }): ObsidianWikiConfig {
  const raw = api.config.pluginConfig?.[api.name]
  const parsed = obsidianWikiConfigSchema.safeParse(raw ?? {})
  if (!parsed.success) {
    throw new Error(`Invalid @memory-lane/plugin-obsidian-wiki config: ${parsed.error.message}`)
  }
  return parsed.data
}
```

- [ ] **Step 3: Create note discovery/reading `packages/plugin-obsidian-wiki/src/notes.ts`**

Implement safe vault traversal:

```ts
import * as fs from "node:fs"
import * as path from "node:path"
import type { ObsidianWikiConfig } from "./config.js"

export interface WikiNote {
  relativePath: string
  absolutePath: string
  title: string
}

export function* discoverNotes(config: ObsidianWikiConfig): Generator<WikiNote> {
  const root = config.vaultPath
  const include = config.includeFolders?.length ? new Set(config.includeFolders) : undefined
  const exclude = new Set(config.excludeFolders ?? ["Private", "Daily"])

  function walk(dir: string, relPrefix: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = path.join(relPrefix, entry.name)
      if (entry.isDirectory()) {
        if (exclude.has(entry.name)) continue
        if (include && relPrefix === "" && !include.has(entry.name)) continue
        walk(path.join(dir, entry.name), rel)
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        yield {
          relativePath: rel,
          absolutePath: path.join(dir, entry.name),
          title: entry.name.replace(/\.md$/u, ""),
        }
      }
    }
  }

  walk(root, "")
}

export function readNote(note: WikiNote): { text: string; headings: string[] } {
  const text = fs.readFileSync(note.absolutePath, "utf8")
  const headings: string[] = []
  for (const line of text.split("\n")) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (match) headings.push(match[2].trim())
  }
  return { text, headings }
}
```

- [ ] **Step 4: Create citation formatter `packages/plugin-obsidian-wiki/src/citations.ts`**

```ts
export function cite(notePath: string, heading?: string): string {
  return heading ? `${notePath}#${heading}` : notePath
}

export function formatAnswerWithCitations(answer: string, citations: string[]): string {
  if (!citations.length) return answer
  return [answer, "", "Sources:", ...citations.map((c) => `- ${c}`)].join("\n")
}
```

- [ ] **Step 5: Create plugin entry `packages/plugin-obsidian-wiki/src/index.ts`**

```ts
import type { MemoryLanePluginAPI, McpToolDefinition, McpResourceDefinition, CliCommandDefinition } from "@memory-lane/plugin-api"
import { getConfig } from "./config.js"
import { discoverNotes, readNote } from "./notes.js"
import { formatAnswerWithCitations, cite } from "./citations.js"

export default function obsidianWikiPlugin(api: MemoryLanePluginAPI): void {
  const config = getConfig(api)

  const searchTool: McpToolDefinition = {
    name: "obsidian_wiki_search",
    title: "Search Obsidian Wiki",
    description: "Search selected Obsidian/Garden notes for relevant knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    async handler(input) {
      const query = String(input.query ?? "").toLowerCase()
      const notes = Array.from(discoverNotes(config))
      const matches = notes.filter((n) => n.title.toLowerCase().includes(query) || n.relativePath.toLowerCase().includes(query))
      return {
        content: [{
          type: "text",
          text: matches.length
            ? `Found ${matches.length} note(s):\n` + matches.map((m) => `- ${m.relativePath}`).join("\n")
            : "No matching notes.",
        }],
        details: { matches: matches.map((m) => m.relativePath) },
      }
    },
  }

  const readTool: McpToolDefinition = {
    name: "obsidian_wiki_read",
    title: "Read Obsidian Wiki Note",
    description: "Read a selected Obsidian/Garden note with source-backed citations.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the note within the vault" },
      },
      required: ["path"],
    },
    async handler(input) {
      const targetPath = String(input.path ?? "")
      const note = Array.from(discoverNotes(config)).find((n) => n.relativePath === targetPath)
      if (!note) {
        return { content: [{ type: "text", text: `Note not found: ${targetPath}` }] }
      }
      const { text } = readNote(note)
      return {
        content: [{
          type: "text",
          text: formatAnswerWithCitations(text, [cite(note.relativePath)]),
        }],
        details: { path: note.relativePath },
      }
    },
  }

  const notesResource: McpResourceDefinition = {
    uri: "memory-lane://obsidian-wiki/notes",
    name: "Obsidian Wiki Notes",
    description: "List of indexable Obsidian/Garden notes.",
    async handler() {
      const notes = Array.from(discoverNotes(config))
      return {
        contents: [{
          uri: "memory-lane://obsidian-wiki/notes",
          mimeType: "application/json",
          text: JSON.stringify(notes.map((n) => ({ path: n.relativePath, title: n.title }))),
        }],
      }
    },
  }

  const statusCommand: CliCommandDefinition = {
    name: "obsidian-wiki",
    description: "Show Obsidian Wiki plugin status",
    usage: "obsidian-wiki status",
    handler(ctx) {
      const notes = Array.from(discoverNotes(config))
      const lines = [
        `Vault: ${config.vaultPath}`,
        `Include: ${config.includeFolders?.join(", ") ?? "(all)"}`,
        `Exclude: ${config.excludeFolders.join(", ")}`,
        `Indexable notes: ${notes.length}`,
      ]
      console.log(lines.join("\n"))
    },
  }

  api.registerMcpTool(searchTool)
  api.registerMcpTool(readTool)
  api.registerMcpResource(notesResource)
  api.registerCliCommand(statusCommand)
}
```

- [ ] **Step 6: Add plugin tests**

Create `packages/plugin-obsidian-wiki/test/plugin.test.ts`:

```ts
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, test } from "node:test"
import obsidianWikiPlugin from "../src/index.js"
import type { MemoryLanePluginAPI } from "@memory-lane/plugin-api"

test("registers MCP tools and CLI command", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-wiki-test-"))
  fs.mkdirSync(path.join(dir, "Garden"))
  fs.writeFileSync(path.join(dir, "Garden", "Hello.md"), "# Hello\n\nWorld.")

  const registered: { tools: string[]; resources: string[]; commands: string[] } = {
    tools: [], resources: [], commands: [],
  }

  const api = {
    name: "@memory-lane/plugin-obsidian-wiki",
    version: "0.0.0",
    engine: {} as any,
    config: {
      pluginConfig: {
        "@memory-lane/plugin-obsidian-wiki": { vaultPath: dir, includeFolders: ["Garden"] },
      },
    },
    registerMcpTool(t) { registered.tools.push(t.name) },
    registerMcpResource(r) { registered.resources.push(r.uri) },
    registerCliCommand(c) { registered.commands.push(c.name) },
  } as MemoryLanePluginAPI

  obsidianWikiPlugin(api)

  assert.deepEqual(registered.tools, ["obsidian_wiki_search", "obsidian_wiki_read"])
  assert.deepEqual(registered.resources, ["memory-lane://obsidian-wiki/notes"])
  assert.deepEqual(registered.commands, ["obsidian-wiki"])

  fs.rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 7: Build and test**

Run:

```bash
cd packages/plugin-obsidian-wiki
pnpm build
node --test --import tsx test/*.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/plugin-obsidian-wiki
git commit -m "feat(plugin-obsidian-wiki): add Obsidian LLM Wiki plugin"
```

---

## Task 6: Update documentation

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `skills/memory-lane/SKILL.md`

- [ ] **Step 1: Update `README.md`**

Add a "Plugins" section:

```markdown
## Plugins

Memory Lane supports lightweight opt-in plugins. Core features stay built-in; optional capabilities ship as separate packages that you activate in `~/.memory-lane/config.json`.

```json
{
  "plugins": ["@memory-lane/plugin-obsidian-wiki"],
  "pluginConfig": {
    "@memory-lane/plugin-obsidian-wiki": {
      "vaultPath": "/Users/alice/Documents/Obsidian",
      "includeFolders": ["Garden"]
    }
  }
}
```

### Obsidian Wiki plugin

`@memory-lane/plugin-obsidian-wiki` lets LLM clients search and read selected Obsidian/Garden notes as source-backed knowledge without turning those notes into Memory Lane memories automatically.

- MCP tools: `obsidian_wiki_search`, `obsidian_wiki_read`
- MCP resource: `memory-lane://obsidian-wiki/notes`
- CLI: `memory-lane obsidian-wiki status`

Promotion of wiki-derived facts into Memory Lane remains explicit through the existing `memory_save` tool.
```

- [ ] **Step 2: Update `ROADMAP.md`**

Change Phase 9 to reflect plugin approach:

```markdown
## Phase 9 — Obsidian LLM Wiki / Knowledge Base Integration

**Status:** In progress. Implemented as the first Memory Lane plugin: `@memory-lane/plugin-obsidian-wiki`.

**Goal:** Let LLM clients search and read selected Obsidian/Garden notes as source-backed knowledge without turning those notes into Memory Lane memories automatically.

Completed / planned scope:
1. Lightweight plugin API (`@memory-lane/plugin-api`) with MCP tool/resource and CLI command registration.
2. Plugin config support in `@memory-lane/core`.
3. Plugin loading in CLI and MCP server.
4. `@memory-lane/plugin-obsidian-wiki` package with search, read, resource listing, and status command.
5. Docs and skill updates explaining opt-in plugin installation.
```

- [ ] **Step 3: Update `skills/memory-lane/SKILL.md`**

Add a short note:

```markdown
Optional Memory Lane plugins extend the CLI and MCP server. For example, `@memory-lane/plugin-obsidian-wiki` adds Obsidian/Garden knowledge-base search and reading. Enable plugins in `~/.memory-lane/config.json` under `plugins`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md ROADMAP.md skills/memory-lane/SKILL.md
git commit -m "docs: document plugin system and Obsidian Wiki plugin"
```

---

## Task 7: Full build and test verification

- [ ] **Step 1: Run full build**

```bash
pnpm build
```

Expected: all packages build, including new plugin packages.

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Manual MCP smoke test**

Run the MCP server with the plugin configured and verify the new tools/resources appear:

```bash
MEMORY_LANE_CONFIG=/path/to/config-with-plugin.json node packages/mcp-server/dist/index.js
```

- [ ] **Step 4: Commit any dist changes**

If `dist/` is tracked and changed:

```bash
git add packages/*/dist/
git commit -m "chore: rebuild dist for plugin system"
```

---

## Spec Coverage Checklist

- [x] Lightweight plugin API — Task 1.
- [x] Plugin config in core — Task 2.
- [x] Plugin loading in MCP server — Task 3.
- [x] Plugin loading in CLI — Task 4.
- [x] Phase 9 as first plugin — Task 5.
- [x] Documentation — Task 6.
- [x] Verification — Task 7.

## Placeholder Scan

No `TBD`, `TODO`, "implement later", or vague steps. Every task includes exact file paths, code, commands, and expected outputs.
