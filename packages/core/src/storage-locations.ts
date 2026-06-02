import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { DEFAULT_CONFIG, writeConfig } from "./config.js"

export type MemoryStorageKind = "environment" | "project-local" | "home"

export interface MemoryPaths {
  kind: MemoryStorageKind
  root: string
  memoryPath: string
  embeddingsPath: string
  configPath: string
}

export interface InitProjectLocalStorageResult {
  root: string
  paths: MemoryPaths
  env: {
    MEMORY_LANE_FILE: string
    MEMORY_LANE_EMBEDDINGS_FILE: string
    MEMORY_LANE_CONFIG: string
  }
}

interface ResolveMemoryPathsOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
}

interface ResolveWritableMemoryPathsOptions extends ResolveMemoryPathsOptions {
  autoInitProjectLocalOnHomeFailure?: boolean
}

function projectLocalRoot(root: string): string {
  return path.join(root, ".memory-lane")
}

function projectLocalPaths(root: string): MemoryPaths {
  const localRoot = projectLocalRoot(root)
  return {
    kind: "project-local",
    root,
    memoryPath: path.join(localRoot, "memory.jsonl"),
    embeddingsPath: path.join(localRoot, "embeddings.jsonl"),
    configPath: path.join(localRoot, "config.json"),
  }
}

function homePaths(env: NodeJS.ProcessEnv | Record<string, string | undefined>): MemoryPaths {
  const root = path.join(env.HOME ?? os.homedir(), ".memory-lane")
  return {
    kind: "home",
    root,
    memoryPath: path.join(root, "memory.jsonl"),
    embeddingsPath: path.join(root, "embeddings.jsonl"),
    configPath: path.join(root, "config.json"),
  }
}

function findProjectLocalRoot(cwd: string): string | undefined {
  let current = path.resolve(cwd)
  while (true) {
    if (fs.existsSync(projectLocalRoot(current))) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function appendGitignore(root: string): void {
  const gitignore = path.join(root, ".gitignore")
  const line = ".memory-lane/"
  const existing = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : ""
  if (existing.split(/\r?\n/u).includes(line)) return
  const prefix = existing && !existing.endsWith("\n") ? "\n" : ""
  fs.writeFileSync(gitignore, existing + prefix + line + "\n", "utf8")
}

export function resolveMemoryPaths(options?: ResolveMemoryPathsOptions): MemoryPaths {
  const env = options?.env ?? process.env
  const memoryPath = env.MEMORY_LANE_FILE
  const embeddingsPath = env.MEMORY_LANE_EMBEDDINGS_FILE
  const configPath = env.MEMORY_LANE_CONFIG
  if (memoryPath || embeddingsPath || configPath) {
    const home = homePaths(env)
    return {
      kind: "environment",
      root: path.dirname(memoryPath ?? embeddingsPath ?? configPath ?? home.memoryPath),
      memoryPath: memoryPath ?? home.memoryPath,
      embeddingsPath: embeddingsPath ?? home.embeddingsPath,
      configPath: configPath ?? home.configPath,
    }
  }

  const cwd = options?.cwd ? path.resolve(options.cwd) : process.cwd()
  const localRoot = findProjectLocalRoot(cwd)
  if (localRoot) return projectLocalPaths(localRoot)
  return homePaths(env)
}

export function initProjectLocalStorage(cwd = process.cwd()): InitProjectLocalStorageResult {
  const root = path.resolve(cwd)
  const paths = projectLocalPaths(root)
  fs.mkdirSync(paths.root, { recursive: true })
  fs.mkdirSync(path.dirname(paths.memoryPath), { recursive: true })
  for (const file of [paths.memoryPath, paths.embeddingsPath]) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, "", "utf8")
  }
  if (!fs.existsSync(paths.configPath)) writeConfig(paths.configPath, DEFAULT_CONFIG)

  const scopePath = path.join(root, ".memory-lane-scope")
  if (!fs.existsSync(scopePath)) fs.writeFileSync(scopePath, JSON.stringify({ id: root }, null, 2) + "\n", "utf8")
  appendGitignore(root)

  return {
    root,
    paths,
    env: {
      MEMORY_LANE_FILE: paths.memoryPath,
      MEMORY_LANE_EMBEDDINGS_FILE: paths.embeddingsPath,
      MEMORY_LANE_CONFIG: paths.configPath,
    },
  }
}

export function assertWritableMemoryPath(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = path.join(path.dirname(filePath), `.write-test-${process.pid}-${Date.now()}`)
  fs.writeFileSync(tmp, "", "utf8")
  fs.unlinkSync(tmp)
}

export function resolveWritableMemoryPaths(options?: ResolveWritableMemoryPathsOptions): MemoryPaths {
  const paths = resolveMemoryPaths(options)
  try {
    assertWritableMemoryPath(paths.memoryPath)
    assertWritableMemoryPath(paths.embeddingsPath)
    assertWritableMemoryPath(paths.configPath)
    return paths
  } catch (err) {
    if (paths.kind === "home" && options?.autoInitProjectLocalOnHomeFailure) {
      return initProjectLocalStorage(options.cwd ?? process.cwd()).paths
    }
    throw err
  }
}
