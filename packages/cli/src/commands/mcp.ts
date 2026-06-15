import * as path from "node:path"
import { loadConfig } from "@memory-lane/core"
import { main as runMcpServer } from "@memory-lane/mcp-server"
import { resolveBundledPlugin } from "../plugins.js"

function resolveConfigPath(): string {
  return process.env.MEMORY_LANE_CONFIG || path.join(process.env.HOME || "/", ".memory-lane", "config.json")
}

export async function handleMcp(): Promise<void> {
  const config = loadConfig(resolveConfigPath())
  const bundledPlugins = config.plugins?.length
    ? config.plugins.map(resolveBundledPlugin).filter((p): p is { name: string; default: (api: any) => void } => Boolean(p))
    : []
  await runMcpServer({ bundledPlugins })
}
