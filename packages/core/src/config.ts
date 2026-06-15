import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { SemanticMemoryConfig } from "./types.js"

export const DEFAULT_CONFIG: SemanticMemoryConfig = {
  semantic: {
    enabled: false,
    activeEmbeddingProfile: "local-example",
    embeddings: { profiles: {} },
    retrieval: {
      topK: 8,
      minSimilarity: 0.25,
      semanticWeight: 0.65,
      lexicalWeight: 0.25,
      recencyWeight: 0.1,
      fallbackToAllVisibleOnMiss: true,
    },
    privacy: { allowRemoteEmbeddings: false },
  },
  obsidian: { enabled: false },
}

export function getDefaultConfigPath(): string {
  return process.env.MEMORY_LANE_CONFIG || path.join(os.homedir(), ".memory-lane", "config.json")
}

// ── Validation ───────────────────────────────────────────────

export class ConfigError extends Error {
  constructor(m: string) { super(`Invalid memory config: ${m}`); this.name = "ConfigError" }
}

function plain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}
function obj(v: unknown, p: string): Record<string, unknown> {
  if (!plain(v)) throw new ConfigError(`${p} must be object`)
  return v
}
function str(v: unknown, p: string): string {
  if (typeof v !== "string" || !v.trim()) throw new ConfigError(`${p} must be non-empty string`)
  return v
}
function bool(v: unknown, p: string): boolean {
  if (typeof v !== "boolean") throw new ConfigError(`${p} must be boolean`)
  return v
}
function num(v: unknown, p: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ConfigError(`${p} must be finite number`)
  return v
}
function optionalStr(v: unknown, p: string): string | undefined {
  if (v === undefined) return undefined
  return str(v, p)
}
function validateObsidianFolder(folder: string, p: string): void {
  if (path.isAbsolute(folder) || path.win32.isAbsolute(folder) || folder.split(/[\\/]+/u).includes("..")) {
    throw new ConfigError(`${p} must be a relative path inside the vault`)
  }
}
function validateObsidianConfig(v: unknown): void {
  if (v === undefined) return
  const o = obj(v, "obsidian")
  const enabled = bool(o.enabled, "obsidian.enabled")
  if (!enabled) return
  str(o.vaultPath, "obsidian.vaultPath")
  const folder = optionalStr(o.folder, "obsidian.folder") ?? "Memory Lane"
  validateObsidianFolder(folder, "obsidian.folder")
  if (o.mode !== "mirror") throw new ConfigError("obsidian.mode must be mirror")
  o.folder = folder
}

function validateProfile(v: unknown, p: string): void {
  const o = obj(v, p)
  if (o.provider !== "openai-compatible-embeddings") throw new ConfigError(`${p}.provider must be openai-compatible-embeddings`)
  str(o.baseUrl, `${p}.baseUrl`)
  str(o.model, `${p}.model`)
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (override === null || override === undefined || !plain(override)) return override ?? base
  const result: Record<string, unknown> = plain(base) ? { ...base } : {}
  for (const [k, v] of Object.entries(override)) {
    if (["__proto__", "constructor", "prototype"].includes(k)) continue
    result[k] = deepMerge(k in result ? result[k] : undefined, v)
  }
  return result
}

export function validateConfig(config: unknown): SemanticMemoryConfig {
  const root = obj(config, "config")
  const s = obj(root.semantic, "semantic")
  bool(s.enabled, "semantic.enabled")
  const ap = str(s.activeEmbeddingProfile, "semantic.activeEmbeddingProfile")
  const embObj = obj(s.embeddings, "semantic.embeddings")
  const ep = obj(embObj.profiles, "semantic.embeddings.profiles")
  for (const [name, profile] of Object.entries(ep)) {
    validateProfile(profile, `semantic.embeddings.profiles.${name}`)
  }
  // Only require activeEmbeddingProfile to exist in profiles if profiles is non-empty
  if (Object.keys(ep).length > 0 && !(ap in ep)) {
    throw new ConfigError(`activeEmbeddingProfile "${ap}" not found in profiles`)
  }
  const r = obj(s.retrieval, "semantic.retrieval")
  num(r.topK, "semantic.retrieval.topK")
  num(r.minSimilarity, "semantic.retrieval.minSimilarity")
  num(r.semanticWeight, "semantic.retrieval.semanticWeight")
  num(r.lexicalWeight, "semantic.retrieval.lexicalWeight")
  num(r.recencyWeight, "semantic.retrieval.recencyWeight")
  bool(r.fallbackToAllVisibleOnMiss, "semantic.retrieval.fallbackToAllVisibleOnMiss")
  bool(obj(s.privacy, "semantic.privacy").allowRemoteEmbeddings, "semantic.privacy.allowRemoteEmbeddings")
  validateObsidianConfig(root.obsidian)
  validatePluginsConfig(root.plugins, root.pluginConfig)
  return config as SemanticMemoryConfig
}

function validatePluginsConfig(plugins: unknown, pluginConfig: unknown): void {
  if (plugins !== undefined) {
    if (!Array.isArray(plugins) || !plugins.every((p) => typeof p === "string")) {
      throw new ConfigError("plugins must be an array of strings")
    }
  }
  if (pluginConfig !== undefined) {
    if (!plain(pluginConfig)) {
      throw new ConfigError("pluginConfig must be an object")
    }
  }
}

export function loadConfig(configPath?: string): SemanticMemoryConfig {
  const file = configPath ?? getDefaultConfigPath()
  if (!fs.existsSync(file)) {
    // Return clean defaults — no active profile required when profiles is empty
    return {
      ...DEFAULT_CONFIG,
      semantic: { ...DEFAULT_CONFIG.semantic, embeddings: { profiles: {} } },
    }
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"))
  return validateConfig(deepMerge(DEFAULT_CONFIG, raw))
}

export function isLocalBaseUrl(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname.toLowerCase())
  } catch { return false }
}

// ── Write helpers ────────────────────────────────────────────

/** Write a config file, merging the given partial config with defaults. */
export function writeConfig(configPath: string, partial: Partial<SemanticMemoryConfig>): void {
  const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {}
  const merged = deepMerge(DEFAULT_CONFIG, deepMerge(existing, partial)) as SemanticMemoryConfig
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8")
}

/** Read raw config JSON (without validation) for editing. */
export function readRawConfig(configPath?: string): unknown {
  const file = configPath ?? getDefaultConfigPath()
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, "utf8"))
}
