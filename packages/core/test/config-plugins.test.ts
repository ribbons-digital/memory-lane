import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, test } from "node:test"
import { loadConfig, writeConfig } from "../src/config.js"

let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function makeTempConfig(): { configPath: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-config-test-"))
  cleanup = () => fs.rmSync(dir, { recursive: true, force: true })
  return { configPath: path.join(dir, "config.json"), dir }
}

test("loads config with plugins and pluginConfig", () => {
  const { configPath } = makeTempConfig()
  writeConfig(configPath, {
    plugins: ["@memory-lane/plugin-obsidian-wiki"],
    pluginConfig: {
      "@memory-lane/plugin-obsidian-wiki": { vaultPath: "/tmp/vault" },
    },
  })

  const cfg = loadConfig(configPath)
  assert.deepEqual(cfg.plugins, ["@memory-lane/plugin-obsidian-wiki"])
  assert.equal((cfg.pluginConfig?.["@memory-lane/plugin-obsidian-wiki"] as any).vaultPath, "/tmp/vault")
})

test("rejects invalid plugins array", () => {
  const { configPath } = makeTempConfig()
  fs.writeFileSync(configPath, JSON.stringify({ semantic: DEFAULT_SEMANTIC, plugins: [123] }))

  assert.throws(() => loadConfig(configPath), /plugins must be an array of strings/)
})

test("rejects invalid pluginConfig", () => {
  const { configPath } = makeTempConfig()
  fs.writeFileSync(configPath, JSON.stringify({ semantic: DEFAULT_SEMANTIC, pluginConfig: ["x"] }))

  assert.throws(() => loadConfig(configPath), /pluginConfig must be an object/)
})

const DEFAULT_SEMANTIC = {
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
}
