import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { loadConfig, DEFAULT_CONFIG, isLocalBaseUrl, validateConfig, ConfigError } from "../src/config.js"
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
})

describe("isLocalBaseUrl", () => {
  it("detects localhost", () => assert.equal(isLocalBaseUrl("http://localhost:8000"), true))
  it("detects 127.0.0.1", () => assert.equal(isLocalBaseUrl("http://127.0.0.1:11434"), true))
  it("rejects remote", () => assert.equal(isLocalBaseUrl("https://api.openai.com"), false))
  it("handles invalid URL", () => assert.equal(isLocalBaseUrl("not-a-url"), false))
})
