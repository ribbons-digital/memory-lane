#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { BundledPluginModule } from "@memory-lane/plugin-api"
import { createMemoryLaneEngine } from "./engine.js"
import { createMemoryLaneMcpServer } from "./server.js"

export interface MainOptions {
  bundledPlugins?: BundledPluginModule[]
}

export async function main(options: MainOptions = {}): Promise<void> {
  const { engine, plugins } = await createMemoryLaneEngine({ bundledPlugins: options.bundledPlugins })
  const server = createMemoryLaneMcpServer({ engine, plugins })
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
