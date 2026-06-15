# Memory Lane Plugin System Design

## Goal

Add a lightweight, opt-in plugin system so Memory Lane can ship optional features as separate packages instead of growing the core binary. The first plugin will be Phase 9 — Obsidian LLM Wiki / Knowledge Base Integration — which exercises the MCP tool/resource and CLI extension points.

## Principles

1. **Core stays lean.** Built-in features are limited to universal agent memory: JSONL storage, recall, lifecycle hooks, MCP, and first-party harness adapters. Optional capabilities ship as plugins.
2. **Plugins are ordinary packages.** A plugin is an npm package or local file that exports a single default function. No custom registry, marketplace, or dynamic download in the first version.
3. **Activation is explicit.** Users opt in via config. No plugin runs by default.
4. **Well-typed, versioned API.** The plugin contract is a TypeScript interface in `@memory-lane/core` or a new `@memory-lane/plugin-api` package.
5. **Privacy and security by default.** Plugins run in the same Node process as the CLI/MCP server. Users must install and configure them deliberately; Memory Lane never auto-installs plugins.
6. **No breaking changes to existing behavior.** When no plugins are configured, Memory Lane behaves exactly as before.

## Non-goals

- Dynamic plugin installation from a remote marketplace.
- Process-level sandboxing or permission prompts for plugins.
- Rewriting existing first-party packages (core, lifecycle, adapters, obsidian-mirror/import, mcp-server) as plugins.
- Supporting browser-only or non-Node runtimes.

## Plugin contract

A plugin is a module that exports a default function:

```ts
import type { MemoryLanePluginAPI } from "@memory-lane/plugin-api"

export default function myPlugin(api: MemoryLanePluginAPI): void {
  api.registerMcpTool({ ... })
  api.registerCliCommand({ ... })
}
```

The function is called synchronously during CLI/MCP server startup, after the `MemoryEngine` is initialized but before the MCP server starts serving requests.

### API surface

```ts
export interface MemoryLanePluginAPI {
  /** Plugin metadata for help/status output. */
  readonly name: string
  readonly version: string

  /** Read-only access to the configured MemoryEngine. */
  readonly engine: MemoryEngine

  /** Resolved Memory Lane config object. */
  readonly config: MemoryLaneConfig

  /** Register an MCP tool. Only available when running the MCP server. */
  registerMcpTool(tool: McpToolDefinition): void

  /** Register an MCP resource. Only available when running the MCP server. */
  registerMcpResource(resource: McpResourceDefinition): void

  /** Register a top-level CLI subcommand. Only available when running the CLI. */
  registerCliCommand(command: CliCommandDefinition): void
}
```

### MCP tool definition

```ts
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
```

### MCP resource definition

```ts
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
```

### CLI command definition

```ts
export interface CliCommandDefinition {
  name: string
  description: string
  usage: string
  handler: (ctx: CliCommandContext) => Promise<void> | void
}

export interface CliCommandContext {
  argv: string[]
  rest: string[]
  json: boolean
  configPath: string
  engine: MemoryEngine
}
```

## Configuration

Plugins are activated in `~/.memory-lane/config.json`:

```json
{
  "plugins": [
    "@memory-lane/plugin-obsidian-wiki"
  ]
}
```

Plugins may receive their own config under a namespaced key:

```json
{
  "plugins": ["@memory-lane/plugin-obsidian-wiki"],
  "pluginConfig": {
    "@memory-lane/plugin-obsidian-wiki": {
      "vaultPath": "/Users/alice/Documents/Obsidian",
      "includeFolders": ["Garden"],
      "excludeFolders": ["Private", "Daily"]
    }
  }
}
```

### Config validation

- The `plugins` array is optional.
- Duplicate plugin names are deduplicated while preserving order.
- Unknown plugin entries fail gracefully with a clear error message at startup.
- Plugin config is passed through as an opaque object; each plugin validates its own section.

## Plugin loading

1. Read `config.plugins`.
2. For each plugin name:
   - Resolve via standard Node.js module resolution (supports npm packages and absolute file paths).
   - Import the module.
   - Validate that the default export is a function.
   - Call the function with a `MemoryLanePluginAPI` instance.
3. If any plugin fails to load, log a clear error and exit with non-zero status (CLI) or surface the error via MCP server logs.

### Loading contexts

- **CLI**: plugins can register CLI commands and MCP tools/resources. MCP registrations are ignored unless the CLI command is `mcp`.
- **MCP server**: plugins can register MCP tools/resources. CLI registrations are ignored.

In practice, the same plugin function is called in both contexts. It should check `api.registerMcpTool` availability or simply register everything and let the host ignore irrelevant registrations.

## Phase 9 plugin: Obsidian LLM Wiki

The first plugin implements the existing Phase 9 spec:

- MCP tools:
  - `obsidian_wiki_search` — search selected Obsidian/Garden notes.
  - `obsidian_wiki_read` — read a note by path with source-backed citations.
- MCP resources:
  - `memory-lane://obsidian-wiki/notes` — list indexable notes.
- CLI command:
  - `memory-lane obsidian-wiki status` — show configured vault, included/excluded folders, and note counts.

Promotion to Memory Lane uses the existing `memory_save` MCP tool; the plugin does not add a separate save path.

## Impact on existing packages

- `@memory-lane/core`: adds `plugins` and `pluginConfig` to config schema; exports plugin API types.
- `@memory-lane/mcp-server`: accepts a list of loaded plugins and registers their MCP tools/resources alongside built-in tools.
- `@memory-lane/cli`: loads plugins and registers their CLI commands alongside built-in commands.
- New package: `@memory-lane/plugin-api` (optional; can live in core if small).
- New package: `@memory-lane/plugin-obsidian-wiki`.

## Security and privacy

- Plugins run with the same filesystem access as the CLI/MCP server.
- Plugin names must be installed by the user (e.g., `pnpm install -g @memory-lane/plugin-obsidian-wiki` or bundled in a custom build).
- No network calls are made to discover or install plugins.
- Debug logging for plugin loading is disabled by default; enable with `MEMORY_LANE_DEBUG=1`.

## Future extension points

The API is intentionally narrow for the first version. Future versions may add:

- `registerLifecycleHook` for custom stop/post-tool-use/user-prompt handlers.
- `registerStorageBackend` for alternative backends (Phase 10).
- `registerRetriever` for custom memory recall strategies.
- `registerDoctorCheck` for plugin-specific diagnostics.

## Success criteria

1. No plugins configured → Memory Lane behaves identically to before.
2. Configured plugin loads successfully in both CLI and MCP server contexts.
3. Phase 9 functionality works end-to-end as `@memory-lane/plugin-obsidian-wiki`.
4. Full build and test suite passes.
5. Documentation explains how to write, install, and configure a plugin.
