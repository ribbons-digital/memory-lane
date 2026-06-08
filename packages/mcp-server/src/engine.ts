import {
  MemoryEngine, createOpenAIEmbeddingProvider, loadConfig, resolveWritableMemoryPaths,
  type MemoryEngineConfig,
} from "@memory-lane/core"

export interface CreateMemoryLaneEngineOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
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

export function createMemoryLaneEngine(options: CreateMemoryLaneEngineOptions = {}): MemoryEngine {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const paths = resolveWritableMemoryPaths({ cwd, env, autoInitProjectLocalOnHomeFailure: true })
  const engine = new MemoryEngine({
    memoryPath: paths.memoryPath,
    embeddingsPath: paths.embeddingsPath,
    configPath: paths.configPath,
    embeddingProvider: createEmbeddingProvider(paths.configPath, env),
    env,
  })
  engine.refreshScope(cwd)
  return engine
}
