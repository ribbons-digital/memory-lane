import {
  MemoryEngine, createOpenAIEmbeddingProvider, createSingleStoreEngineStorage, createTwoTierEngineStorage, loadConfig, resolveWritableEngineStoragePaths,
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
  const paths = resolveWritableEngineStoragePaths({ cwd, env, autoInitProjectLocalOnHomeFailure: true })
  const config = loadConfig(paths.configPath)
  const storage = paths.kind === "default-two-tier"
    ? createTwoTierEngineStorage(paths.home, paths.project, paths.projectScopeKey)
    : createSingleStoreEngineStorage(paths.home.memoryPath, paths.home.embeddingsPath)
  const engine = new MemoryEngine({
    memoryPath: paths.home.memoryPath,
    embeddingsPath: paths.home.embeddingsPath,
    storage,
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
