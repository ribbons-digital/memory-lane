import { loadConfig } from "@memory-lane/core"
import { main as runMcpServer } from "@memory-lane/mcp-server"
import * as os from "node:os"
import * as path from "node:path"
import type { BundledPluginModule } from "@memory-lane/plugin-api"
import { resolveBundledPlugin } from "../plugins.js"
import { formatError } from "../formatters.js"
import type { CliCommandContext } from "@memory-lane/plugin-api"

export function resolveMcpConfigPath(): string {
  if (process.env.MEMORY_LANE_CONFIG) return process.env.MEMORY_LANE_CONFIG
  const homeDir = process.env.HOME || os.homedir()
  return path.join(homeDir, ".memory-lane", "config.json")
}

export async function handleMcp(ctx?: CliCommandContext): Promise<void> {
  let config
  try {
    config = loadConfig(resolveMcpConfigPath())
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(formatError(`Failed to load config: ${msg}`, ctx?.json ?? false))
    process.exit(1)
  }
  const bundledPlugins = config.plugins?.length
    ? config.plugins.map(resolveBundledPlugin).filter((p): p is BundledPluginModule => Boolean(p))
    : []
  await runMcpServer({ bundledPlugins })
}
