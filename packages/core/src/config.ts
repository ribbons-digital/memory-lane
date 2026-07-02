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
  memory: {
    handoffMode: "manual",
    sessionEndSummary: {
      enabled: false,
      requireConfirmation: true,
      includeToolOutputs: false,
      maxTokens: 800,
    },
    contextPolicy: {
      mode: "selective",
      maxItems: { sessionStart: 4, prompt: 6 },
      maxChars: { sessionStart: 1600, prompt: 3000 },
      preferenceMaxItems: { sessionStart: 2, prompt: 2 },
      preferenceMaxChars: { sessionStart: 600, prompt: 900 },
      includePending: false,
      fallbackToSearch: true,
    },
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
function positiveInt(v: unknown, p: string): number {
  const n = num(v, p)
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(`${p} must be a non-negative integer`)
  return n
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
  const memory = root.memory as Record<string, unknown> | undefined
  validateHandoffMode(memory?.handoffMode)
  validateContextPolicyConfig(memory?.contextPolicy)
  validateSessionEndSummaryConfig(memory?.sessionEndSummary)
  validatePluginsConfig(root.plugins, root.pluginConfig)
  return config as SemanticMemoryConfig
}

function validateHandoffMode(v: unknown): void {
  if (v === undefined) return
  if (v !== "manual" && v !== "review" && v !== "automatic") {
    throw new ConfigError("memory.handoffMode must be manual, review, or automatic")
  }
}

function validateContextPolicyConfig(v: unknown): void {
  if (v === undefined) return
  const o = obj(v, "memory.contextPolicy")
  if (o.mode !== undefined && o.mode !== "off" && o.mode !== "policy-only" && o.mode !== "selective") {
    throw new ConfigError("memory.contextPolicy.mode must be off, policy-only, or selective")
  }
  if (o.maxItems !== undefined) {
    const maxItems = obj(o.maxItems, "memory.contextPolicy.maxItems")
    if (maxItems.sessionStart !== undefined) positiveInt(maxItems.sessionStart, "memory.contextPolicy.maxItems.sessionStart")
    if (maxItems.prompt !== undefined) positiveInt(maxItems.prompt, "memory.contextPolicy.maxItems.prompt")
  }
  if (o.maxChars !== undefined) {
    const maxChars = obj(o.maxChars, "memory.contextPolicy.maxChars")
    if (maxChars.sessionStart !== undefined) positiveInt(maxChars.sessionStart, "memory.contextPolicy.maxChars.sessionStart")
    if (maxChars.prompt !== undefined) positiveInt(maxChars.prompt, "memory.contextPolicy.maxChars.prompt")
  }
  if (o.preferenceMaxItems !== undefined) {
    const preferenceMaxItems = obj(o.preferenceMaxItems, "memory.contextPolicy.preferenceMaxItems")
    if (preferenceMaxItems.sessionStart !== undefined) positiveInt(preferenceMaxItems.sessionStart, "memory.contextPolicy.preferenceMaxItems.sessionStart")
    if (preferenceMaxItems.prompt !== undefined) positiveInt(preferenceMaxItems.prompt, "memory.contextPolicy.preferenceMaxItems.prompt")
  }
  if (o.preferenceMaxChars !== undefined) {
    const preferenceMaxChars = obj(o.preferenceMaxChars, "memory.contextPolicy.preferenceMaxChars")
    if (preferenceMaxChars.sessionStart !== undefined) positiveInt(preferenceMaxChars.sessionStart, "memory.contextPolicy.preferenceMaxChars.sessionStart")
    if (preferenceMaxChars.prompt !== undefined) positiveInt(preferenceMaxChars.prompt, "memory.contextPolicy.preferenceMaxChars.prompt")
  }
  if (o.includePending !== undefined) bool(o.includePending, "memory.contextPolicy.includePending")
  if (o.fallbackToSearch !== undefined) bool(o.fallbackToSearch, "memory.contextPolicy.fallbackToSearch")
}

function validateSessionEndSummaryConfig(v: unknown): void {
  if (v === undefined) return
  const o = obj(v, "memory.sessionEndSummary")
  const enabled = o.enabled === undefined ? false : bool(o.enabled, "memory.sessionEndSummary.enabled")
  if (!enabled) return
  if (o.provider !== undefined && o.provider !== "openai-compatible") {
    throw new ConfigError("memory.sessionEndSummary.provider must be openai-compatible")
  }
  if (o.baseUrl !== undefined) str(o.baseUrl, "memory.sessionEndSummary.baseUrl")
  if (o.apiKeyEnv !== undefined && o.apiKeyEnv !== null) str(o.apiKeyEnv, "memory.sessionEndSummary.apiKeyEnv")
  if (o.model !== undefined) str(o.model, "memory.sessionEndSummary.model")
  if (o.promptTemplate !== undefined && o.promptTemplate !== null) str(o.promptTemplate, "memory.sessionEndSummary.promptTemplate")
  if (o.maxTokens !== undefined) num(o.maxTokens, "memory.sessionEndSummary.maxTokens")
  if (o.timeoutMs !== undefined) positiveInt(o.timeoutMs, "memory.sessionEndSummary.timeoutMs")
  if (o.requireConfirmation !== undefined) bool(o.requireConfirmation, "memory.sessionEndSummary.requireConfirmation")
  if (o.includeToolOutputs !== undefined) bool(o.includeToolOutputs, "memory.sessionEndSummary.includeToolOutputs")
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

function validateConfigOverrides(config: unknown): void {
  if (!plain(config)) return
  if (plain(config.memory) && Object.prototype.hasOwnProperty.call(config.memory, "handoffMode")) {
    validateHandoffMode(config.memory.handoffMode)
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
  validateConfigOverrides(raw)
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
