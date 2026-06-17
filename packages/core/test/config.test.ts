import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { loadConfig, DEFAULT_CONFIG, isLocalBaseUrl, validateConfig, ConfigError, writeConfig } from "../src/config.js"
import { tempDir } from "./helpers.js"

describe("loadConfig", () => {
  let dir: string
  beforeEach(() => { dir = tempDir() })

  it("returns defaults when file missing", () => {
    const cfg = loadConfig(path.join(dir, "nope.json"))
    assert.equal(cfg.semantic.enabled, false)
    assert.equal(cfg.semantic.retrieval.topK, 8)
    assert.equal(DEFAULT_CONFIG.obsidian?.enabled, false)
    assert.equal(cfg.obsidian?.enabled, false)
  })

  it("merges user config over defaults", () => {
    const f = path.join(dir, "c.json")
    fs.writeFileSync(f, JSON.stringify({ semantic: { enabled: true } }))
    const cfg = loadConfig(f)
    assert.equal(cfg.semantic.enabled, true)
    // other defaults still present
    assert.equal(cfg.semantic.retrieval.topK, 8)
  })

  it("deep merges retrieval overrides", () => {
    const f = path.join(dir, "c.json")
    fs.writeFileSync(f, JSON.stringify({ semantic: { retrieval: { topK: 12 } } }))
    const cfg = loadConfig(f)
    assert.equal(cfg.semantic.retrieval.topK, 12)
    // other retrieval fields still present
    assert.ok(Number.isFinite(cfg.semantic.retrieval.minSimilarity))
  })

  it("validates on load — throws for bad boolean", () => {
    const f = path.join(dir, "b.json")
    fs.writeFileSync(f, JSON.stringify({ semantic: { enabled: "bad" } }))
    assert.throws(() => loadConfig(f), ConfigError)
  })

  it("validates on load — throws for bad number", () => {
    const f = path.join(dir, "b.json")
    fs.writeFileSync(f, JSON.stringify({ semantic: { retrieval: { topK: "not-a-number" } } }))
    assert.throws(() => loadConfig(f), ConfigError)
  })
})

describe("writeConfig", () => {
  let dir: string
  beforeEach(() => { dir = tempDir() })

  it("preserves existing semantic embedding profiles when writing partial semantic updates", () => {
    const f = path.join(dir, "c.json")
    fs.writeFileSync(f, JSON.stringify({
      semantic: {
        enabled: false,
        activeEmbeddingProfile: "local-profile",
        embeddings: {
          profiles: {
            "local-profile": {
              provider: "openai-compatible-embeddings",
              baseUrl: "http://localhost:11434/v1",
              model: "nomic-embed-text",
            },
          },
        },
        retrieval: { topK: 3 },
      },
    }))

    writeConfig(f, { semantic: { enabled: true } as any })

    const cfg = loadConfig(f)
    assert.equal(cfg.semantic.enabled, true)
    assert.equal(cfg.semantic.activeEmbeddingProfile, "local-profile")
    assert.deepEqual(cfg.semantic.embeddings.profiles["local-profile"], {
      provider: "openai-compatible-embeddings",
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed-text",
    })
    assert.equal(cfg.semantic.retrieval.topK, 3)
  })
})

describe("validateConfig", () => {
  it("accepts disabled obsidian mirror config", () => {
    const config = validateConfig({
      semantic: {
        enabled: false,
        activeEmbeddingProfile: "local-example",
        embeddings: { profiles: {} },
        retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
        privacy: { allowRemoteEmbeddings: false },
      },
      obsidian: { enabled: false },
    })

    assert.equal(config.obsidian?.enabled, false)
  })

  it("accepts enabled obsidian mirror config", () => {
    const config = validateConfig({
      semantic: {
        enabled: false,
        activeEmbeddingProfile: "local-example",
        embeddings: { profiles: {} },
        retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
        privacy: { allowRemoteEmbeddings: false },
      },
      obsidian: {
        enabled: true,
        vaultPath: "/tmp/memory-lane-vault",
        folder: "Memory Lane",
        mode: "mirror",
      },
    })

    assert.deepEqual(config.obsidian, {
      enabled: true,
      vaultPath: "/tmp/memory-lane-vault",
      folder: "Memory Lane",
      mode: "mirror",
    })
  })

  it("defaults enabled obsidian mirror folder", () => {
    const config = validateConfig({
      semantic: {
        enabled: false,
        activeEmbeddingProfile: "local-example",
        embeddings: { profiles: {} },
        retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
        privacy: { allowRemoteEmbeddings: false },
      },
      obsidian: {
        enabled: true,
        vaultPath: "/tmp/memory-lane-vault",
        mode: "mirror",
      },
    })

    assert.equal(config.obsidian?.folder, "Memory Lane")
  })

  it("rejects unsafe obsidian folders", () => {
    const baseConfig = {
      semantic: {
        enabled: false,
        activeEmbeddingProfile: "local-example",
        embeddings: { profiles: {} },
        retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
        privacy: { allowRemoteEmbeddings: false },
      },
    }

    for (const folder of ["../escape", "memories/../escape", "/absolute"] as const) {
      assert.throws(() => validateConfig({
        ...baseConfig,
        obsidian: {
          enabled: true,
          vaultPath: "/tmp/memory-lane-vault",
          folder,
          mode: "mirror",
        },
      }), /obsidian\.folder/)
    }
  })

  it("accepts valid config with profile", () => {
    const cfg = {
      semantic: {
        enabled: false,
        activeEmbeddingProfile: "my-profile",
        embeddings: {
          profiles: {
            "my-profile": {
              provider: "openai-compatible-embeddings",
              baseUrl: "http://localhost:8000",
              model: "text-embedding-3-small",
            },
          },
        },
        retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
        privacy: { allowRemoteEmbeddings: false },
      },
    }
    assert.doesNotThrow(() => validateConfig(cfg))
  })

  it("rejects missing activeEmbeddingProfile when profiles are non-empty", () => {
    const cfg = {
      semantic: {
        enabled: false,
        activeEmbeddingProfile: "missing",
        embeddings: {
          profiles: {
            "other": { provider: "openai-compatible-embeddings", baseUrl: "http://localhost:8000", model: "x" },
          },
        },
        retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
        privacy: { allowRemoteEmbeddings: false },
      },
    }
    assert.throws(() => validateConfig(cfg), ConfigError)
  })

  it("sessionEndSummary defaults to disabled on load", () => {
    const dir = tempDir()
    const f = path.join(dir, "c.json")
    fs.writeFileSync(f, JSON.stringify({
      semantic: {
        enabled: false,
        activeEmbeddingProfile: "local-example",
        embeddings: { profiles: {} },
        retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
        privacy: { allowRemoteEmbeddings: false },
      },
    }))
    const config = loadConfig(f)
    assert.equal(config.memory?.sessionEndSummary?.enabled, false)
    assert.equal(config.memory?.sessionEndSummary?.requireConfirmation, true)
    assert.equal(config.memory?.sessionEndSummary?.includeToolOutputs, false)
    assert.equal(config.memory?.sessionEndSummary?.maxTokens, 800)
    assert.equal(config.memory?.contextPolicy?.mode, "selective")
    assert.equal(config.memory?.contextPolicy?.maxItems?.sessionStart, 4)
    assert.equal(config.memory?.contextPolicy?.maxItems?.prompt, 6)
    assert.equal(config.memory?.contextPolicy?.maxChars?.sessionStart, 1600)
    assert.equal(config.memory?.contextPolicy?.maxChars?.prompt, 3000)
    assert.equal(config.memory?.contextPolicy?.includePending, false)
    assert.equal(config.memory?.contextPolicy?.fallbackToSearch, true)
  })

  it("accepts contextPolicy modes and budgets", () => {
    const config = validateConfig({
      semantic: {
        enabled: false,
        activeEmbeddingProfile: "local-example",
        embeddings: { profiles: {} },
        retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
        privacy: { allowRemoteEmbeddings: false },
      },
      memory: {
        contextPolicy: {
          mode: "policy-only",
          maxItems: { sessionStart: 2, prompt: 3 },
          maxChars: { sessionStart: 400, prompt: 900 },
          includePending: false,
          fallbackToSearch: true,
        },
      },
    })
    assert.equal(config.memory?.contextPolicy?.mode, "policy-only")
    assert.equal(config.memory?.contextPolicy?.maxItems?.prompt, 3)
  })

  it("rejects invalid contextPolicy mode", () => {
    assert.throws(() => validateConfig({
      semantic: {
        enabled: false,
        activeEmbeddingProfile: "local-example",
        embeddings: { profiles: {} },
        retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
        privacy: { allowRemoteEmbeddings: false },
      },
      memory: { contextPolicy: { mode: "loud" } },
    }), /contextPolicy\.mode/)
  })

  it("accepts enabled sessionEndSummary config", () => {
    const config = validateConfig({
      semantic: {
        enabled: false,
        activeEmbeddingProfile: "local-example",
        embeddings: { profiles: {} },
        retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
        privacy: { allowRemoteEmbeddings: false },
      },
      memory: {
        sessionEndSummary: {
          enabled: true,
          provider: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          apiKeyEnv: "MEMORY_LANE_SUMMARY_API_KEY",
          model: "gpt-4.1-mini",
          maxTokens: 800,
          requireConfirmation: true,
          includeToolOutputs: false,
        },
      },
    })
    assert.equal(config.memory?.sessionEndSummary?.enabled, true)
    assert.equal(config.memory?.sessionEndSummary?.model, "gpt-4.1-mini")
  })

  it("rejects unknown sessionEndSummary provider", () => {
    assert.throws(() => validateConfig({
      semantic: {
        enabled: false,
        activeEmbeddingProfile: "local-example",
        embeddings: { profiles: {} },
        retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
        privacy: { allowRemoteEmbeddings: false },
      },
      memory: {
        sessionEndSummary: { enabled: true, provider: "unknown" },
      },
    }), /provider/)
  })
})

describe("isLocalBaseUrl", () => {
  it("detects localhost", () => assert.equal(isLocalBaseUrl("http://localhost:8000"), true))
  it("detects 127.0.0.1", () => assert.equal(isLocalBaseUrl("http://127.0.0.1:11434"), true))
  it("rejects remote", () => assert.equal(isLocalBaseUrl("https://api.openai.com"), false))
  it("handles invalid URL", () => assert.equal(isLocalBaseUrl("not-a-url"), false))
})
