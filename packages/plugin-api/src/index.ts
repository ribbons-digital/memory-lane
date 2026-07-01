import { AsyncLocalStorage } from "node:async_hooks"
import type { MemoryEngine, SemanticMemoryConfig } from "@memory-lane/core"
import type { z } from "zod"

export interface McpToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: z.ZodTypeAny | Record<string, unknown>
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>
    details?: Record<string, unknown>
  }>
}

export type McpResourceContent =
  | { uri: string; mimeType?: string; text: string }
  | { uri: string; mimeType?: string; blob: string }

export interface McpResourceDefinition {
  uri: string
  name: string
  description: string
  mimeType?: string
  handler: (uri: URL) => Promise<{
    contents: McpResourceContent[]
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

export interface EngineResolverOptions {
  writable?: boolean
}

export type EngineResolver = (projectPath?: string, options?: EngineResolverOptions) => MemoryEngine

export interface MemoryLanePluginAPI {
  readonly name: string
  readonly version: string
  readonly engine: MemoryEngine
  readonly engineResolver: EngineResolver
  readonly config: SemanticMemoryConfig
  registerMcpTool(tool: McpToolDefinition): void
  registerMcpResource(resource: McpResourceDefinition): void
  registerCliCommand(command: CliCommandDefinition): void
}

export interface LoadedPlugin {
  name: string
  mcpTools: McpToolDefinition[]
  mcpResources: McpResourceDefinition[]
  cliCommands: CliCommandDefinition[]
}

export interface BundledPluginModule {
  name: string
  default: (api: MemoryLanePluginAPI) => void
}

export interface LoadPluginsOptions {
  pluginNames: string[]
  engine: MemoryEngine
  engineResolver?: EngineResolver
  config: SemanticMemoryConfig
  context: "cli" | "mcp"
  bundledPlugins?: BundledPluginModule[]
}

export function createPluginAPI(
  name: string,
  version: string,
  engine: MemoryEngine,
  config: SemanticMemoryConfig,
  context: "cli" | "mcp",
  engineResolver: EngineResolver = () => engine,
): MemoryLanePluginAPI & { getMcpTools(): McpToolDefinition[]; getMcpResources(): McpResourceDefinition[]; getCliCommands(): CliCommandDefinition[] } {
  const mcpTools: McpToolDefinition[] = []
  const mcpResources: McpResourceDefinition[] = []
  const cliCommands: CliCommandDefinition[] = []
  const mcpProjectContext = new AsyncLocalStorage<string | undefined>()

  return {
    name,
    version,
    get engine() { return engineResolver(mcpProjectContext.getStore()) },
    engineResolver,
    config,
    registerMcpTool(tool) {
      if (context !== "mcp") return
      mcpTools.push({
        ...tool,
        async handler(input) {
          const projectPath = typeof input.projectPath === "string" ? input.projectPath : undefined
          return await mcpProjectContext.run(projectPath, () => tool.handler(input))
        },
      })
    },
    registerMcpResource(resource) {
      if (context !== "mcp") return
      mcpResources.push(resource)
    },
    registerCliCommand(command) {
      if (context !== "cli") return
      cliCommands.push(command)
    },
    getMcpTools: () => mcpTools,
    getMcpResources: () => mcpResources,
    getCliCommands: () => cliCommands,
  }
}

export async function loadPlugins(options: LoadPluginsOptions): Promise<LoadedPlugin[]> {
  const seen = new Set<string>()
  const plugins: LoadedPlugin[] = []

  for (const name of options.pluginNames) {
    if (seen.has(name)) continue
    seen.add(name)

    const bundled = options.bundledPlugins?.find((p) => p.name === name)

    let module: { default?: (api: MemoryLanePluginAPI) => void }
    if (bundled) {
      module = bundled
    } else {
      try {
        module = await import(name)
      } catch (err) {
        throw new Error(`Failed to load plugin "${name}": ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (typeof module.default !== "function") {
      throw new Error(`Plugin "${name}" does not export a default function`)
    }

    const api = createPluginAPI(name, "0.0.0", options.engine, options.config, options.context, options.engineResolver)
    module.default(api)

    plugins.push({
      name,
      mcpTools: api.getMcpTools(),
      mcpResources: api.getMcpResources(),
      cliCommands: api.getCliCommands(),
    })
  }

  return plugins
}
