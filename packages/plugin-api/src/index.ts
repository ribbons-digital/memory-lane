import type { MemoryEngine, SemanticMemoryConfig } from "@memory-lane/core"
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

export interface LoadPluginsOptions {
  pluginNames: string[]
  engine: MemoryEngine
  config: SemanticMemoryConfig
  context: "cli" | "mcp"
}

export function createPluginAPI(
  name: string,
  version: string,
  engine: MemoryEngine,
  config: SemanticMemoryConfig,
  context: "cli" | "mcp",
): MemoryLanePluginAPI & { getMcpTools(): McpToolDefinition[]; getMcpResources(): McpResourceDefinition[]; getCliCommands(): CliCommandDefinition[] } {
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

    plugins.push({
      name,
      mcpTools: api.getMcpTools(),
      mcpResources: api.getMcpResources(),
      cliCommands: api.getCliCommands(),
    })
  }

  return plugins
}
