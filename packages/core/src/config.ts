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
  return config as SemanticMemoryConfig
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
