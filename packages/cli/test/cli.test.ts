import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { tempDir } from "../../core/test/helpers.js"

function run(args: string[], env?: Record<string, string>) {
  const cli = path.resolve("packages/cli/dist/index.js")
  const result = execFileSync("node", [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd: path.resolve("."),
  })
  return result.trim()
}

describe("CLI integration", () => {
  let dir: string, memFile: string, embFile: string, cfgFile: string
  beforeEach(() => {
    dir = tempDir()
    memFile = path.join(dir, "mem.jsonl")
    embFile = path.join(dir, "emb.jsonl")
    cfgFile = path.join(dir, "cfg.json")
  })

  it("save and list", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    run(["save", "use pnpm"], env)
    const list = run(["list"], env)
    assert.ok(list.includes("use pnpm"))
  })

  it("search finds matching memory", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    run(["save", "use pnpm for projects", "--status", "approved"], env)
    run(["save", "deploy with docker", "--status", "approved"], env)
    const result = run(["search", "pnpm"], env)
    assert.ok(result.includes("pnpm"))
    assert.ok(!result.includes("docker"))
  })

  it("delete removes memory", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    run(["save", "delete me", "--status", "approved"], env)
    const before = JSON.parse(run(["list", "--json"], env))
    assert.ok(before.data.memories.length > 0)
    const id = before.data.memories[0].id
    run(["delete", id], env)
    const after = JSON.parse(run(["list", "--json"], env))
    const deletedMem = after.data.memories.find((m: any) => m.id === id)
    assert.ok(deletedMem)
    assert.equal(deletedMem.status, "deleted")
  })

  it("JSON output", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    run(["save", "json test"], env)
    const json = run(["list", "--json"], env)
    const parsed = JSON.parse(json)
    assert.equal(parsed.ok, true)
    assert.ok(Array.isArray(parsed.data.memories))
  })

  it("doctor reports stats", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    run(["save", "test 1", "--status", "approved"], env)
    run(["save", "test 2"], env)
    const doc = run(["doctor", "--json"], env)
    const parsed = JSON.parse(doc)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.data.totalMemories, 2)
  })
})
