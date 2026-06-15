#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createMemoryLaneEngine } from "./engine.js"
import { createMemoryLaneMcpServer } from "./server.js"

export async function main(): Promise<void> {
  const server = createMemoryLaneMcpServer({ engine: createMemoryLaneEngine() })
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Memory Lane MCP server failed: ${message}`)
    process.exit(1)
  })
}
