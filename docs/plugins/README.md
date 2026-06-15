# Memory Lane Plugins

Memory Lane supports lightweight opt-in plugins. Core features stay built-in; optional capabilities ship as separate packages that you activate in `~/.memory-lane/config.json`.

## How plugins work

A plugin is a Node.js module that exports a single default function. Memory Lane calls this function at startup with a `MemoryLanePluginAPI` object. The plugin can register:

- MCP tools and resources (when running as an MCP server)
- CLI subcommands (when running the `memory-lane` CLI)

Plugins are loaded by module name or absolute file path. They run in the same Node.js process as Memory Lane.

## Activating a plugin

Add the plugin to `~/.memory-lane/config.json`:

```json
{
  "plugins": [
    "@memory-lane/plugin-obsidian-wiki"
  ],
  "pluginConfig": {
    "@memory-lane/plugin-obsidian-wiki": {
      "vaultPath": "/Users/alice/Documents/Obsidian",
      "includeFolders": ["Garden"],
      "excludeFolders": ["Private", "Daily"]
    }
  }
}
```

Each plugin defines its own `pluginConfig` schema. See the plugin's documentation for valid options.

## Installing plugins

### When building from source

If you cloned the Memory Lane repository and run `pnpm build`, plugins are resolved the same way as any Node.js dependency:

```bash
cd /path/to/memory-lane
sfw pnpm add @memory-lane/plugin-obsidian-wiki
```

If the plugin is another workspace package in your checkout, add it to `pnpm-workspace.yaml` and reference it by name.

### When using the standalone binary

The standalone `memory-lane` binary is produced with Bun `--compile`. It does **not** resolve npm packages at runtime. For binary users, plugins must be:

1. **Compiled into the binary.** The official Memory Lane releases bundle first-party plugins such as `@memory-lane/plugin-obsidian-wiki`.
2. **Referenced by absolute file path.** You can write a plugin as a local `.js` file and configure it with its absolute path:

```json
{
  "plugins": ["/Users/alice/.memory-lane/plugins/my-plugin.js"]
}
```

> **Current limitation:** Binary users cannot `npm install` arbitrary plugins today. If you need that workflow, build Memory Lane from source or request that the plugin be bundled in an official release.

## Developing a plugin

Create a package with the following structure:

```
my-memory-lane-plugin/
  package.json
  tsconfig.json (optional)
  src/
    index.ts
```

`package.json`:

```json
{
  "name": "my-memory-lane-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "dependencies": {
    "@memory-lane/plugin-api": "^0.2.0"
  }
}
```

`src/index.ts`:

```ts
import type { MemoryLanePluginAPI } from "@memory-lane/plugin-api"

export default function myPlugin(api: MemoryLanePluginAPI): void {
  api.registerMcpTool({
    name: "my_tool",
    title: "My Tool",
    description: "Does something useful",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" }
      },
      required: ["query"]
    },
    async handler(input) {
      return {
        content: [{ type: "text", text: `You asked: ${input.query}` }]
      }
    }
  })

  api.registerCliCommand({
    name: "my-command",
    description: "Run my plugin command",
    usage: "my-command",
    handler(ctx) {
      console.log("Hello from my plugin")
    }
  })
}
```

## Distributing plugins

You can distribute a plugin in several ways:

1. **npm registry.** Publish the package to npm and users install it when building from source.
2. **GitHub release.** Attach a compiled plugin `.js` file to a release and users reference it by absolute path.
3. **Bundled with Memory Lane.** Propose adding first-party plugins to the main repository; they will be included in official releases.

## First-party plugins

| Plugin | Description |
|--------|-------------|
| `@memory-lane/plugin-obsidian-wiki` | Search and read selected Obsidian/Garden notes as source-backed knowledge. |

## Plugin API reference

See `packages/plugin-api/src/index.ts` for the full TypeScript interface. Key types:

- `MemoryLanePluginAPI` — the object passed to your plugin function
- `McpToolDefinition` — register an MCP tool
- `McpResourceDefinition` — register an MCP resource
- `CliCommandDefinition` — register a CLI subcommand
