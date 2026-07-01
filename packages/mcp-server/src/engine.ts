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
  engineForProjectPath: (projectPath?: string) => MemoryEngine
  plugins: LoadedPlugin[]
}

export async function createMemoryLaneEngine(options: CreateMemoryLaneEngineOptions = {}): Promise<MemoryLaneEngineResult> {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const engineCache = new Map<string, MemoryEngine>()

  function buildEngine(engineCwd: string): MemoryEngine {
    const paths = resolveWritableEngineStoragePaths({ cwd: engineCwd, env, autoInitProjectLocalOnHomeFailure: true })
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
    engine.refreshScope(engineCwd)
    return engine
  }

  function engineForProjectPath(projectPath?: string): MemoryEngine {
    const engineCwd = projectPath ?? cwd
    const cached = engineCache.get(engineCwd)
    if (cached) {
      cached.refreshScope(engineCwd)
      return cached
    }
    const engine = buildEngine(engineCwd)
    engineCache.set(engineCwd, engine)
    return engine
  }

  const engine = engineForProjectPath()
  const config = loadConfig(resolveWritableEngineStoragePaths({ cwd, env, autoInitProjectLocalOnHomeFailure: true }).configPath)
  const plugins = config.plugins?.length
    ? await loadPlugins({ pluginNames: config.plugins, engine, config, context: "mcp", bundledPlugins: options.bundledPlugins })
    : []

  return { engine, engineForProjectPath, plugins }
}
