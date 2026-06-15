// Static registry of first-party plugins bundled with the CLI binary.
// Plugins listed here are compiled into the binary but only activate when
// the user includes them in ~/.memory-lane/config.json under "plugins".

import type { MemoryLanePluginAPI } from "@memory-lane/plugin-api"

// Static imports ensure these plugins are included in the compiled binary.
import obsidianWikiPlugin from "@memory-lane/plugin-obsidian-wiki"

export interface BundledPlugin {
  name: string
  default: (api: MemoryLanePluginAPI) => void
}

const bundledPlugins: BundledPlugin[] = [
  { name: "@memory-lane/plugin-obsidian-wiki", default: obsidianWikiPlugin },
]

export function resolveBundledPlugin(name: string): BundledPlugin | undefined {
  return bundledPlugins.find((p) => p.name === name)
}

export function listBundledPlugins(): string[] {
  return bundledPlugins.map((p) => p.name)
}
