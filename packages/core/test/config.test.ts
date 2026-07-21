import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { loadConfig, DEFAULT_CONFIG, isLocalBaseUrl, validateConfig, ConfigError, writeConfig, readRawConfig } from "../src/config.js"
import { tempDir } from "./helpers.js"

function assertMalformedConfigError(action: () => unknown, configPath: string): void {
  assert.throws(
    action,
    (error: unknown) => {
      assert.ok(error instanceof ConfigError)
      assert.ok(error.message.includes(configPath))
      assert.match(error.message, /failed to parse/u)
      assert.match(error.message, /JSON|position|line|column|Unexpected|Expected/u)
      return true
    },
  )
}

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

  it("includes the config path and parse details for malformed JSON", () => {
    const f = path.join(dir, "malformed.json")
    fs.writeFileSync(f, "{ invalid json\n", "utf8")

    assertMalformedConfigError(() => loadConfig(f), f)
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

  it("persists only explicitly provided overrides while loading runtime defaults", () => {
    const f = path.join(dir, "c.json")

    writeConfig(f, { semantic: { enabled: true } })

    assert.deepEqual(readRawConfig(f), { semantic: { enabled: true } })
    const cfg = loadConfig(f)
    assert.equal(cfg.semantic.enabled, true)
    assert.equal(cfg.semantic.retrieval.topK, DEFAULT_CONFIG.semantic.retrieval.topK)
    assert.equal(cfg.memory?.contextPolicy?.mode, DEFAULT_CONFIG.memory?.contextPolicy?.mode)
  })

  it("applies changed runtime defaults to an older minimal config", () => {
    const f = path.join(dir, "c.json")
    writeConfig(f, { semantic: { enabled: true } })
    const originalTopK = DEFAULT_CONFIG.semantic.retrieval.topK

    try {
      DEFAULT_CONFIG.semantic.retrieval.topK = originalTopK + 5

      const cfg = loadConfig(f)
      assert.equal(cfg.semantic.enabled, true)
      assert.equal(cfg.semantic.retrieval.topK, originalTopK + 5)
      assert.deepEqual(readRawConfig(f), { semantic: { enabled: true } })
    } finally {
      DEFAULT_CONFIG.semantic.retrieval.topK = originalTopK
    }
  })

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

    writeConfig(f, { semantic: { enabled: true } })

    const cfg = loadConfig(f)
    assert.equal(cfg.semantic.enabled, true)
    assert.equal(cfg.semantic.activeEmbeddingProfile, "local-profile")
    assert.deepEqual(cfg.semantic.embeddings.profiles["local-profile"], {
      provider: "openai-compatible-embeddings",
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed-text",
    })
    assert.equal(cfg.semantic.retrieval.topK, 3)
    assert.deepEqual(readRawConfig(f), {
      semantic: {
        enabled: true,
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
    })
  })

  it("rejects invalid merged config without changing existing file", () => {
    const f = path.join(dir, "c.json")
    const original = JSON.stringify({ semantic: { retrieval: { topK: 8 } } }, null, 2) + "\n"
    fs.writeFileSync(f, original)

    assert.throws(
      () => writeConfig(f, { semantic: { retrieval: { topK: "banana" } } }),
      /semantic\.retrieval\.topK must be finite number/u,
    )

    assert.equal(fs.readFileSync(f, "utf8"), original)
  })

  it("includes the config path and parse details for malformed existing JSON", () => {
    const f = path.join(dir, "malformed-existing.json")
    const original = "{ invalid json\n"
    fs.writeFileSync(f, original, "utf8")

    assertMalformedConfigError(() => writeConfig(f, { semantic: { enabled: true } }), f)
    assert.equal(fs.readFileSync(f, "utf8"), original)
  })
})

describe("readRawConfig", () => {
  it("includes the config path and parse details for malformed JSON", () => {
    const f = path.join(tempDir(), "malformed-raw.json")
    fs.writeFileSync(f, "{ invalid json\n", "utf8")

    assertMalformedConfigError(() => readRawConfig(f), f)
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

  it("accepts optional positive embedding profile timeoutMs", () => {
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
              timeoutMs: 1000,
            },
          },
        },
        retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
        privacy: { allowRemoteEmbeddings: false },
      },
    }
    assert.doesNotThrow(() => validateConfig(cfg))
  })

  it("rejects invalid embedding profile timeoutMs", () => {
    for (const timeoutMs of ["1000", 0, -1, 1.5] as const) {
      assert.throws(() => validateConfig({
        semantic: {
          enabled: false,
          activeEmbeddingProfile: "my-profile",
          embeddings: {
            profiles: {
              "my-profile": {
                provider: "openai-compatible-embeddings",
                baseUrl: "http://localhost:8000",
                model: "text-embedding-3-small",
                timeoutMs,
              },
            },
          },
          retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
          privacy: { allowRemoteEmbeddings: false },
        },
      }), /semantic\.embeddings\.profiles\.my-profile\.timeoutMs/)
    }
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

  it("rejects invalid sessionEndSummary timeoutMs", () => {
    for (const timeoutMs of ["1000", 0, -1, 1.5] as const) {
      assert.throws(() => validateConfig({
        semantic: {
          enabled: false,
          activeEmbeddingProfile: "local-example",
          embeddings: { profiles: {} },
          retrieval: { topK: 8, minSimilarity: 0.25, semanticWeight: 0.65, lexicalWeight: 0.25, recencyWeight: 0.1, fallbackToAllVisibleOnMiss: true },
          privacy: { allowRemoteEmbeddings: false },
        },
        memory: {
          sessionEndSummary: { enabled: true, timeoutMs },
        },
      }), /memory\.sessionEndSummary\.timeoutMs/)
    }
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
