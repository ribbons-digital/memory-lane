import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, test } from "node:test"
import { spawnSync } from "node:child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function run(args: string[], env: NodeJS.ProcessEnv = {}): ReturnType<typeof spawnSync> {
  const cli = path.resolve(__dirname, "../dist/index.js")
  return spawnSync("node", [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
}

let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function makeTempConfig(): { dir: string; configPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-plugin-cli-test-"))
  cleanup = () => fs.rmSync(dir, { recursive: true, force: true })
  const configPath = path.join(dir, "config.json")
  fs.writeFileSync(configPath, JSON.stringify({
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
    plugins: ["nonexistent-plugin-12345"],
  }))
  return { dir, configPath }
}

test("unknown plugin produces clear error", () => {
  const { configPath } = makeTempConfig()

  const result = run(["status"], {
    MEMORY_LANE_CONFIG: configPath,
    MEMORY_LANE_FILE: path.join(path.dirname(configPath), "memory.jsonl"),
    MEMORY_LANE_EMBEDDINGS_FILE: path.join(path.dirname(configPath), "embeddings.jsonl"),
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /nonexistent-plugin-12345/)
})

test("configured plugin CLI command runs", () => {
  const { dir, configPath } = makeTempConfig()
  const pluginDir = path.join(dir, "plugin")
  fs.mkdirSync(pluginDir)
  const pluginPath = path.join(pluginDir, "fake-plugin.js")
  fs.writeFileSync(pluginPath, `
    export default function (api) {
      api.registerCliCommand({
        name: "fake-status",
        description: "Fake plugin status",
        usage: "fake-status",
        handler(ctx) {
          console.log("fake-status-ok")
        },
      })
    }
  `)

  fs.writeFileSync(configPath, JSON.stringify({
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
    plugins: [pluginPath],
  }))

  const result = run(["fake-status"], {
    MEMORY_LANE_CONFIG: configPath,
    MEMORY_LANE_FILE: path.join(dir, "memory.jsonl"),
    MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"),
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /fake-status-ok/)
})
