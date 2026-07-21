import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { tempDir } from "./helpers.js"
import { initProjectLocalStorage, resolveEngineStoragePaths, resolveMemoryPaths, resolveWritableEngineStoragePaths, resolveWritableMemoryPaths } from "../src/storage-locations.js"

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

function configureGitRepo(cwd: string): void {
  execFileSync("git", ["init"], { cwd, stdio: "ignore" })
  execFileSync("git", ["config", "user.email", "memory-lane@example.invalid"], { cwd, stdio: "ignore" })
  execFileSync("git", ["config", "user.name", "Memory Lane Tests"], { cwd, stdio: "ignore" })
  fs.writeFileSync(path.join(cwd, "README.md"), "# test repo\n", "utf8")
  execFileSync("git", ["add", "README.md"], { cwd, stdio: "ignore" })
  execFileSync("git", ["commit", "-m", "initial"], { cwd, stdio: "ignore" })
}

describe("storage locations", () => {
  it("initializes project-local storage and prints env exports", () => {
    const dir = tempDir()

    const result = initProjectLocalStorage(dir)

    assert.equal(result.root, dir)
    assert.ok(fs.existsSync(path.join(dir, ".memory-lane", "memory.jsonl")))
    assert.ok(fs.existsSync(path.join(dir, ".memory-lane", "embeddings.jsonl")))
    const configPath = path.join(dir, ".memory-lane", "config.json")
    assert.equal(fs.readFileSync(configPath, "utf8"), "{}\n")
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), {})
    assert.ok(fs.existsSync(path.join(dir, ".memory-lane-scope")))
    assert.ok(fs.readFileSync(path.join(dir, ".gitignore"), "utf8").includes(".memory-lane/"))
    assert.match(result.env.MEMORY_LANE_FILE, /\.memory-lane\/memory\.jsonl$/)
  })

  it("prefers project-local storage when initialized", () => {
    const dir = tempDir()
    initProjectLocalStorage(dir)

    const paths = resolveMemoryPaths({ cwd: path.join(dir, "nested") })

    assert.equal(paths.kind, "project-local")
    assert.equal(paths.memoryPath, path.join(dir, ".memory-lane", "memory.jsonl"))
    assert.equal(paths.configPath, path.join(dir, ".memory-lane", "config.json"))
  })

  it("lets explicit environment paths override project-local storage", () => {
    const dir = tempDir()
    const explicit = tempDir()
    initProjectLocalStorage(dir)

    const paths = resolveMemoryPaths({
      cwd: dir,
      env: {
        MEMORY_LANE_FILE: path.join(explicit, "mem.jsonl"),
        MEMORY_LANE_EMBEDDINGS_FILE: path.join(explicit, "emb.jsonl"),
        MEMORY_LANE_CONFIG: path.join(explicit, "cfg.json"),
      },
    })

    assert.equal(paths.kind, "environment")
    assert.equal(paths.memoryPath, path.join(explicit, "mem.jsonl"))
    assert.equal(paths.embeddingsPath, path.join(explicit, "emb.jsonl"))
    assert.equal(paths.configPath, path.join(explicit, "cfg.json"))
  })

  it("auto-initializes project-local storage when home storage is not writable", () => {
    const dir = tempDir()
    const fakeHomeFile = path.join(tempDir(), "not-a-directory")
    fs.writeFileSync(fakeHomeFile, "file blocks ~/.memory-lane", "utf8")

    const paths = resolveWritableMemoryPaths({
      cwd: dir,
      env: { HOME: fakeHomeFile },
      autoInitProjectLocalOnHomeFailure: true,
    })

    assert.equal(paths.kind, "project-local")
    assert.equal(paths.memoryPath, path.join(dir, ".memory-lane", "memory.jsonl"))
    assert.ok(fs.existsSync(paths.memoryPath))
    assert.ok(fs.readFileSync(path.join(dir, ".gitignore"), "utf8").includes(".memory-lane/"))
  })

  it("does not auto-fallback when explicit environment storage is not writable", () => {
    const dir = tempDir()
    const fakeFile = path.join(tempDir(), "not-a-directory")
    fs.writeFileSync(fakeFile, "file blocks explicit path", "utf8")

    assert.throws(
      () => resolveWritableMemoryPaths({
        cwd: dir,
        env: { MEMORY_LANE_FILE: path.join(fakeFile, "memory.jsonl") },
        autoInitProjectLocalOnHomeFailure: true,
      }),
      /ENOTDIR|not a directory|EEXIST|file already exists/i,
    )
    assert.equal(fs.existsSync(path.join(dir, ".memory-lane")), false)
  })

  it("resolves default engine storage as home-primary two-tier even when project-local exists", () => {
    const dir = tempDir()
    const home = tempDir()
    initProjectLocalStorage(dir)

    const paths = resolveEngineStoragePaths({ cwd: path.join(dir, "nested"), env: { HOME: home } })

    assert.equal(paths.kind, "default-two-tier")
    assert.equal(paths.home.memoryPath, path.join(home, ".memory-lane", "memory.jsonl"))
    assert.equal(paths.project?.memoryPath, path.join(dir, ".memory-lane", "memory.jsonl"))
    assert.equal(paths.configPath, path.join(home, ".memory-lane", "config.json"))
  })

  it("does not use absolute-looking scope file ids as storage roots", () => {
    const root = tempDir()
    const identity = path.join(tempDir(), "identity-only")
    fs.writeFileSync(path.join(root, ".memory-lane-scope"), JSON.stringify({ id: identity }), "utf8")

    const paths = resolveEngineStoragePaths({ cwd: root, env: { HOME: tempDir() } })

    assert.equal(paths.project?.memoryPath, path.join(root, ".memory-lane", "memory.jsonl"))
    assert.notEqual(paths.project?.memoryPath, path.join(identity, ".memory-lane", "memory.jsonl"))
    assert.equal(paths.projectScopeKey, identity)
  })

  it("uses shared git scope storage for linked worktrees", () => {
    const main = tempDir()
    configureGitRepo(main)
    const linked = path.join(path.dirname(main), `${path.basename(main)}-linked`)
    git(["worktree", "add", linked, "-b", "feature-storage-location-test"], main)

    const paths = resolveEngineStoragePaths({ cwd: linked, env: { HOME: tempDir() } })

    assert.equal(fs.realpathSync(paths.project!.root), fs.realpathSync(main))
    assert.equal(fs.realpathSync(path.dirname(path.dirname(paths.project!.memoryPath))), fs.realpathSync(main))
  })

  it("uses resolved project root for engine project-local fallback when home is blocked", () => {
    const root = tempDir()
    const nested = path.join(root, "packages", "app")
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(root, ".memory-lane-scope"), JSON.stringify({ id: "stable-root-scope" }), "utf8")
    const fakeHomeFile = path.join(tempDir(), "not-a-directory")
    fs.writeFileSync(fakeHomeFile, "file blocks ~/.memory-lane", "utf8")

    const paths = resolveWritableEngineStoragePaths({
      cwd: nested,
      env: { HOME: fakeHomeFile },
      autoInitProjectLocalOnHomeFailure: true,
    })

    assert.equal(paths.kind, "project-local-fallback")
    assert.equal(paths.home.memoryPath, path.join(root, ".memory-lane", "memory.jsonl"))
    assert.equal(fs.existsSync(path.join(nested, ".memory-lane")), false)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, ".memory-lane-scope"), "utf8")), { id: "stable-root-scope" })
    assert.ok(fs.readFileSync(path.join(root, ".gitignore"), "utf8").includes(".memory-lane/"))
  })

  it("keeps absolute scope ids separate from project-local storage roots", () => {
    const root = tempDir()
    const nested = path.join(root, "packages", "app")
    const scopeId = path.join(tempDir(), "stable-identity")
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(root, ".memory-lane-scope"), JSON.stringify({ id: scopeId }), "utf8")

    const readOnlyPlan = resolveEngineStoragePaths({ cwd: nested, env: { HOME: tempDir() } })
    assert.equal(readOnlyPlan.projectScopeKey, scopeId)
    assert.equal(readOnlyPlan.project?.memoryPath, path.join(root, ".memory-lane", "memory.jsonl"))

    const fakeHomeFile = path.join(tempDir(), "not-a-directory")
    fs.writeFileSync(fakeHomeFile, "file blocks ~/.memory-lane", "utf8")

    const paths = resolveWritableEngineStoragePaths({
      cwd: nested,
      env: { HOME: fakeHomeFile },
      autoInitProjectLocalOnHomeFailure: true,
    })

    assert.equal(paths.kind, "project-local-fallback")
    assert.equal(paths.home.memoryPath, path.join(root, ".memory-lane", "memory.jsonl"))
    assert.equal(fs.existsSync(path.join(scopeId, ".memory-lane")), false)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, ".memory-lane-scope"), "utf8")), { id: scopeId })
  })

  it("keeps explicit engine storage overrides single-store", () => {
    const dir = tempDir()
    const explicit = tempDir()

    const paths = resolveWritableEngineStoragePaths({
      cwd: dir,
      env: {
        MEMORY_LANE_FILE: path.join(explicit, "mem.jsonl"),
        MEMORY_LANE_EMBEDDINGS_FILE: path.join(explicit, "emb.jsonl"),
        MEMORY_LANE_CONFIG: path.join(explicit, "cfg.json"),
      },
    })

    assert.equal(paths.kind, "environment")
    assert.equal(paths.home.memoryPath, path.join(explicit, "mem.jsonl"))
    assert.equal(paths.project, undefined)
  })
})
