import * as fs from "node:fs"
import {
  MemoryEngine, createOpenAIEmbeddingProvider, createSingleStoreEngineStorage, createTwoTierEngineStorage, loadConfig, resolveEngineStoragePaths, resolveWritableEngineStoragePaths,
  type EngineStoragePaths,
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

export interface EngineForProjectPathOptions {
  writable?: boolean
}

export interface MemoryLaneEngineResult {
  engine: MemoryEngine
  engineForProjectPath: (projectPath?: string, options?: EngineForProjectPathOptions) => MemoryEngine
  settleEngines: () => Promise<void>
  plugins: LoadedPlugin[]
}

export async function createMemoryLaneEngine(options: CreateMemoryLaneEngineOptions = {}): Promise<MemoryLaneEngineResult> {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const engineCache = new Map<string, { engine: MemoryEngine; signature: string }>()

  function configFingerprint(configPath: string): string {
    try {
      const stat = fs.statSync(configPath)
      return `${stat.mtimeMs}:${stat.size}`
    } catch {
      return "missing"
    }
  }

  function storageSignature(paths: EngineStoragePaths): string {
    return JSON.stringify({
      kind: paths.kind,
      configPath: paths.configPath,
      configFingerprint: configFingerprint(paths.configPath),
      projectScopeKey: paths.projectScopeKey,
      home: paths.home,
      project: paths.project,
    })
  }

  function resolvePaths(engineCwd: string, writable: boolean): EngineStoragePaths {
    return writable
      ? resolveWritableEngineStoragePaths({ cwd: engineCwd, env, autoInitProjectLocalOnHomeFailure: true })
      : resolveEngineStoragePaths({ cwd: engineCwd, env })
  }

  function buildEngine(engineCwd: string, writable: boolean, paths: EngineStoragePaths): MemoryEngine {
    const storage = paths.kind === "default-two-tier"
      ? createTwoTierEngineStorage(paths.home, paths.project, paths.projectScopeKey)
      : createSingleStoreEngineStorage(paths.home.memoryPath, paths.home.embeddingsPath)
    const engine = new MemoryEngine({
      memoryPath: paths.home.memoryPath,
      embeddingsPath: paths.home.embeddingsPath,
      storage,
      autoCompact: writable,
      configPath: paths.configPath,
      embeddingProvider: createEmbeddingProvider(paths.configPath, env),
      env,
    })
    engine.refreshScope(engineCwd)
    return engine
  }

  function engineForProjectPath(projectPath?: string, options: EngineForProjectPathOptions = {}): MemoryEngine {
    const engineCwd = projectPath ?? cwd
    const writable = options.writable ?? true
    const cacheKey = `${writable ? "write" : "read"}\0${engineCwd}`
    const paths = resolvePaths(engineCwd, writable)
    const signature = storageSignature(paths)
    const cached = engineCache.get(cacheKey)
    if (cached && cached.signature === signature) {
      cached.engine.refreshScope(engineCwd)
      return cached.engine
    }
    const engine = buildEngine(engineCwd, writable, paths)
    engineCache.set(cacheKey, { engine, signature })
    return engine
  }

  async function settleEngines(): Promise<void> {
    await Promise.allSettled(Array.from(engineCache.values(), ({ engine }) => engine.settle()))
  }

  const engine = engineForProjectPath(undefined, { writable: false })
  const config = loadConfig(resolveEngineStoragePaths({ cwd, env }).configPath)
  const plugins = config.plugins?.length
    ? await loadPlugins({ pluginNames: config.plugins, engine, engineResolver: engineForProjectPath, config, context: "mcp", bundledPlugins: options.bundledPlugins })
    : []

  return { engine, engineForProjectPath, settleEngines, plugins }
}
