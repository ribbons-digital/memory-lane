import { z } from "zod"

export const obsidianWikiConfigSchema = z.object({
  vaultPath: z.string().min(1),
  includeFolders: z.array(z.string()).optional(),
  excludeFolders: z.array(z.string()).optional().default(["Private", "Daily"]),
})

export type ObsidianWikiConfig = z.infer<typeof obsidianWikiConfigSchema>

export interface ConfigApi {
  name: string
  config: { pluginConfig?: Record<string, unknown> }
}

export function getConfig(api: ConfigApi): ObsidianWikiConfig {
  const raw = api.config.pluginConfig?.[api.name]
  const parsed = obsidianWikiConfigSchema.safeParse(raw ?? {})
  if (!parsed.success) {
    throw new Error(`Invalid ${api.name} config: ${parsed.error.message}`)
  }
  return parsed.data
}
