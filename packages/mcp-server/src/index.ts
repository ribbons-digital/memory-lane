#!/usr/bin/env node
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { BundledPluginModule } from "@memory-lane/plugin-api"
import { createMemoryLaneEngine } from "./engine.js"
import { createMemoryLaneMcpServer } from "./server.js"

export interface MainOptions {
  bundledPlugins?: BundledPluginModule[]
}

async function waitForStdinClose(): Promise<void> {
  if (process.stdin.readableEnded || process.stdin.destroyed) return
  await new Promise<void>((resolve) => {
    const done = () => resolve()
    process.stdin.once("end", done)
    process.stdin.once("close", done)
  })
}

export async function main(options: MainOptions = {}): Promise<void> {
  const { engine, plugins } = await createMemoryLaneEngine({ bundledPlugins: options.bundledPlugins })
  const server = createMemoryLaneMcpServer({ engine, plugins })
  const transport = new StdioServerTransport()
  await server.connect(transport)
  await waitForStdinClose()
}

export function isDirectExecution(metaUrl = import.meta.url, argv1 = process.argv[1]): boolean {
  if (!argv1) return false
  try {
    return fs.realpathSync(fileURLToPath(metaUrl)) === fs.realpathSync(path.resolve(argv1))
  } catch {
    return false
  }
}

if (isDirectExecution()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Memory Lane MCP server failed: ${message}`)
    process.exit(1)
  })
}
