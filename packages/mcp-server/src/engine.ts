import {
  MemoryEngine, createOpenAIEmbeddingProvider, loadConfig, resolveWritableMemoryPaths,
  type MemoryEngineConfig,
} from "@memory-lane/core"
import { loadPlugins, type BundledPluginModule, type LoadedPlugin } from "@memory-lane/plugin-api"

export interface CreateMemoryLaneEngineOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  bundledPlugins?: BundledPluginModule[]
}

function createEmbeddingProvider(
  configPath: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): MemoryEngineConfig["embeddingProvider"] | undefined {
  try {
    const cfg = loadConfig(configPath)
    if (!cfg.semantic.enabled) return undefined
    const profile = cfg.semantic.embeddings.profiles[cfg.semantic.activeEmbeddingProfile]
    return profile ? createOpenAIEmbeddingProvider(profile, env as NodeJS.ProcessEnv) : undefined
  } catch {
    return undefined
  }
}

export interface MemoryLaneEngineResult {
  engine: MemoryEngine
  plugins: LoadedPlugin[]
}

export async function createMemoryLaneEngine(options: CreateMemoryLaneEngineOptions = {}): Promise<MemoryLaneEngineResult> {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const paths = resolveWritableMemoryPaths({ cwd, env, autoInitProjectLocalOnHomeFailure: true })
  const config = loadConfig(paths.configPath)
  const engine = new MemoryEngine({
    memoryPath: paths.memoryPath,
    embeddingsPath: paths.embeddingsPath,
    configPath: paths.configPath,
    embeddingProvider: createEmbeddingProvider(paths.configPath, env),
    env,
  })
  engine.refreshScope(cwd)

  const plugins = config.plugins?.length
    ? await loadPlugins({ pluginNames: config.plugins, engine, config, context: "mcp", bundledPlugins: options.bundledPlugins })
    : []

  return { engine, plugins }
}
