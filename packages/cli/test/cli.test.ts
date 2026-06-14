import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function run(args: string[], env?: NodeJS.ProcessEnv) {
  const cli = path.resolve(__dirname, "../dist/index.js")
  const result = execFileSync("node", [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
  return result.trim()
}

function runProcess(args: string[], options?: { env?: NodeJS.ProcessEnv; stdin?: string; cwd?: string }) {
  const cli = path.resolve(__dirname, "../dist/index.js")
  return spawnSync("node", [cli, ...args], {
    input: options?.stdin,
    encoding: "utf8",
    cwd: options?.cwd,
    env: { ...process.env, ...options?.env },
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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

  it("init --project-local creates project storage and save uses it", () => {
    const project = tempDir()
    const home = tempDir()
    const init = runProcess(["init", "--project-local", "--project", project], { env: { HOME: home } })

    assert.equal(init.status, 0)
    assert.match(init.stdout, /Initialized project-local Memory Lane storage/)
    assert.match(init.stdout, /MEMORY_LANE_FILE=/)
    assert.ok(fs.existsSync(path.join(project, ".memory-lane", "memory.jsonl")))
    assert.ok(fs.existsSync(path.join(project, ".memory-lane", "embeddings.jsonl")))
    assert.ok(fs.existsSync(path.join(project, ".memory-lane", "config.json")))

    const saved = runProcess(["save", "project-local memory", "--project", project], { env: { HOME: home } })

    assert.equal(saved.status, 0)
    assert.ok(fs.readFileSync(path.join(project, ".memory-lane", "memory.jsonl"), "utf8").includes("project-local memory"))
    assert.equal(fs.existsSync(path.join(home, ".memory-lane", "memory.jsonl")), false)
  })

  it("save auto-falls back to project-local storage when home storage is blocked", () => {
    const project = tempDir()
    const fakeHomeFile = path.join(tempDir(), "not-a-directory")
    fs.writeFileSync(fakeHomeFile, "file blocks ~/.memory-lane", "utf8")

    const saved = runProcess(["save", "auto fallback memory", "--project", project], { env: { HOME: fakeHomeFile } })

    assert.equal(saved.status, 0)
    assert.ok(fs.readFileSync(path.join(project, ".memory-lane", "memory.jsonl"), "utf8").includes("auto fallback memory"))
    assert.ok(fs.readFileSync(path.join(project, ".gitignore"), "utf8").includes(".memory-lane/"))
  })

  it("save rejects invalid category without writing", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const result = runProcess(["save", "invalid category", "--category", "research"], { env })

    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /Invalid category.*research/)
    assert.equal(fs.existsSync(memFile) ? fs.readFileSync(memFile, "utf8") : "", "")
  })

  it("list shows saved timestamp", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    run(["save", "timestamp test"], env)
    const list = run(["list"], env)
    assert.ok(list.includes("saved "), `Expected 'saved <date>' in output, got: ${list}`)
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

  it("JSON save output includes Obsidian mirror warnings", () => {
    const missingVault = path.join(dir, "missing-vault")
    fs.writeFileSync(cfgFile, JSON.stringify({
      obsidian: { enabled: true, vaultPath: missingVault, folder: "Memory Lane", mode: "mirror" },
    }), "utf8")
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const result = runProcess(["save", "json warning test", "--json"], { env })

    assert.equal(result.status, 0)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.data.saved.text, "json warning test")
    assert.ok(Array.isArray(parsed.data.warnings))
    assert.match(parsed.data.warnings.join("\n"), /Vault path does not exist/u)
  })


  it("JSON delete output includes Obsidian mirror warnings", () => {
    const missingVault = path.join(dir, "missing-vault")
    fs.writeFileSync(cfgFile, JSON.stringify({
      obsidian: { enabled: true, vaultPath: missingVault, folder: "Memory Lane", mode: "mirror" },
    }), "utf8")
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    run(["save", "delete warning json", "--status", "approved"], env)
    const before = JSON.parse(run(["list", "--json"], env))
    const id = before.data.memories[0].id

    const result = runProcess(["delete", id, "--json"], { env })

    assert.equal(result.status, 0)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.data.deleted.status, "deleted")
    assert.ok(Array.isArray(parsed.data.warnings))
    assert.match(parsed.data.warnings.join("\n"), /Vault path does not exist/u)
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
    assert.equal(typeof parsed.data.integrations, "object")
    assert.equal(parsed.data.integrations.summary.mcpExplicitToolsOnly, true)
  })

  it("doctor human output renders integration diagnostics readably", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const output = run(["doctor"], env)
    assert.match(output, /integrations:/u)
    assert.match(output, /mcpExplicitToolsOnly/u)
    assert.doesNotMatch(output, /\[object Object\]/u)
  })

  it("codex unknown event returns usage error", () => {
    const result = runProcess(["codex", "unknown-event"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /Unknown Codex hook event/)
  })

  it("codex user-prompt-submit accepts hook payload on stdin", () => {
    const result = runProcess(["codex", "user-prompt-submit"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
      stdin: JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        cwd: process.cwd(),
        transcript_path: null,
        model: "gpt-5-codex",
        permission_mode: "default",
        prompt: "ok",
      }),
    })
    assert.equal(result.status, 0)
    assert.equal(result.stdout.trim(), "{}")
  })

  it("codex session-start accepts hook payload on stdin", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    run(["save", "This repo runs tests with pnpm test", "--status", "approved"], env)
    const result = runProcess(["codex", "session-start"], {
      env,
      stdin: JSON.stringify({
        hook_event_name: "SessionStart",
        session_id: "session-1",
        cwd: process.cwd(),
        transcript_path: null,
        model: "gpt-5-codex",
        permission_mode: "default",
      }),
    })
    assert.equal(result.status, 0)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart")
  })

  it("claude unknown event returns usage error", () => {
    const result = runProcess(["claude", "unknown-event"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /Unknown Claude hook event/)
  })

  it("claude user-prompt-submit accepts hook payload on stdin", () => {
    const result = runProcess(["claude", "user-prompt-submit"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
      stdin: JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        cwd: process.cwd(),
        transcript_path: null,
        permission_mode: "default",
        prompt: "ok",
      }),
    })
    assert.equal(result.status, 0)
    assert.equal(result.stdout.trim(), "{}")
  })

  it("obsidian status reports unconfigured mirror", () => {
    const result = runProcess(["obsidian", "status"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
    })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Obsidian mirror: disabled/)
  })

  it("obsidian init configures mirror and performs initial sync", () => {
    const home = tempDir()
    const vault = path.join(home, "Vault")
    fs.mkdirSync(vault)
    const env = {
      HOME: home,
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    runProcess(["save", "This repo uses pnpm", "--category", "project"], { env })

    const result = runProcess(["obsidian", "init", "--vault", "~/Vault"], { env })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Configured Obsidian mirror/)
    assert.match(result.stdout, /Warning: No \.obsidian\/ directory found/)
    assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "README.md")), true)
    assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "imports")), true)
    const files = fs.readdirSync(path.join(vault, "Memory Lane", "memories"))
    assert.equal(files.length, 1)
    const config = JSON.parse(fs.readFileSync(cfgFile, "utf8"))
    assert.equal(config.obsidian.enabled, true)
    assert.equal(config.obsidian.vaultPath, vault)
    assert.equal(config.obsidian.folder, "Memory Lane")
    assert.equal(config.obsidian.mode, "mirror")
  })

  it("obsidian init expands home with os.homedir when HOME is unset", () => {
    const home = os.homedir()
    assert.notEqual(home, "")
    const missingVaultName = `.memory-lane-missing-${path.basename(tempDir())}`
    const expectedVaultPath = path.join(home, missingVaultName)

    const result = runProcess(["obsidian", "init", "--vault", `~/${missingVaultName}`], {
      env: {
        HOME: undefined,
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
    })

    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, new RegExp(`Vault path does not exist: ${escapeRegExp(expectedVaultPath)}`))
  })

  it("obsidian sync dry-run does not write files", () => {
    const vault = tempDir()
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    runProcess(["save", "Dry run memory", "--category", "project"], { env })
    runProcess(["config", "set", "obsidian", JSON.stringify({ enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" })], { env })

    const result = runProcess(["obsidian", "sync", "--dry-run"], { env })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Would create:/)
    assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories")), false)
    assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "imports")), false)
  })

  it("obsidian sync creates imports folder when writing", () => {
    const vault = tempDir()
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    runProcess(["config", "set", "obsidian", JSON.stringify({ enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" })], { env })

    const result = runProcess(["obsidian", "sync"], { env })

    assert.equal(result.status, 0)
    assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "imports")), true)
  })

  it("obsidian sync requires configured enabled mirror", () => {
    const result = runProcess(["obsidian", "sync"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
    })

    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /Obsidian mirror is not configured/)
  })

  it("obsidian import dry-run plans creates and skips without writing", () => {
    const home = tempDir()
    const vault = path.join(home, "Vault")
    const imports = path.join(vault, "Memory Lane", "imports")
    fs.mkdirSync(imports, { recursive: true })
    fs.writeFileSync(path.join(imports, "pnpm.md"), "---\nmemory_lane: true\ncategory: project\nstatus: approved\n---\nUse pnpm for installs", "utf8")
    fs.writeFileSync(path.join(imports, "draft.md"), "---\ncategory: project\n---\nIgnore me", "utf8")
    const env = {
      HOME: home,
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    runProcess(["obsidian", "init", "--vault", vault], { env })

    const result = runProcess(["obsidian", "import", "--dry-run", "--json"], { env })

    assert.equal(result.status, 0)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.data.summary.wouldCreate, 1)
    assert.equal(parsed.data.summary.wouldUpdate, 0)
    assert.equal(parsed.data.summary.skipped, 0)
    assert.equal(parsed.data.results[0].action, "create")
    assert.equal(parsed.data.results[0].status, "approved")
    const list = JSON.parse(run(["list", "--json"], env))
    assert.equal(list.data.memories.length, 0)
  })

  it("obsidian import dry-run requires configured mirror", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const result = runProcess(["obsidian", "import", "--dry-run"], { env })

    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /Obsidian mirror is not configured/u)
  })

  it("obsidian import dry-run human output summarizes empty plan", () => {
    const vault = tempDir()
    fs.mkdirSync(path.join(vault, "Memory Lane", "imports"), { recursive: true })
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    runProcess(["config", "set", "obsidian", JSON.stringify({ enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" })], { env })

    const result = runProcess(["obsidian", "import", "--dry-run"], { env })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Obsidian import dry run:/u)
    assert.match(result.stdout, /Would import: 0/u)
    assert.match(result.stdout, /Would update: 0/u)
    assert.match(result.stdout, /Skipped: 0/u)
    assert.match(result.stdout, /No importable notes found/u)
  })

  it("obsidian import applies creates and leaves source notes untouched", () => {
    const vault = tempDir()
    const imports = path.join(vault, "Memory Lane", "imports")
    fs.mkdirSync(imports, { recursive: true })
    const sourcePath = path.join(imports, "pnpm.md")
    const source = "---\nmemory_lane: true\ncategory: project\nstatus: approved\nkind: project_fact\n---\nUse pnpm for installs\n"
    fs.writeFileSync(sourcePath, source, "utf8")
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    runProcess(["config", "set", "obsidian", JSON.stringify({ enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" })], { env })

    const result = runProcess(["obsidian", "import", "--json"], { env })

    assert.equal(result.status, 0)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.ok, true)
    assert.deepEqual(parsed.data.summary, { created: 1, updated: 0, skipped: 0 })
    assert.equal(parsed.data.results[0].action, "created")
    assert.equal(parsed.data.results[0].status, "approved")
    assert.equal(typeof parsed.data.results[0].memoryId, "string")
    const list = JSON.parse(run(["list", "--json"], env))
    assert.equal(list.data.memories.length, 1)
    assert.equal(list.data.memories[0].text, "Use pnpm for installs")
    assert.equal(list.data.memories[0].source, "manual")
    assert.equal(fs.readFileSync(sourcePath, "utf8"), source)
  })

  it("obsidian import applies updates by memory_lane_id", () => {
    const vault = tempDir()
    const imports = path.join(vault, "Memory Lane", "imports")
    fs.mkdirSync(imports, { recursive: true })
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    run(["save", "Old text", "--status", "pending", "--category", "personal"], env)
    const before = JSON.parse(run(["list", "--json"], env))
    const id = before.data.memories[0].id
    fs.writeFileSync(
      path.join(imports, "update.md"),
      `---\nmemory_lane: true\nmemory_lane_id: ${id}\nstatus: approved\ncategory: preference\nkind: workflow_rule\n---\nUpdated text\n`,
      "utf8",
    )
    runProcess(["config", "set", "obsidian", JSON.stringify({ enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" })], { env })

    const result = runProcess(["obsidian", "import", "--json"], { env })

    assert.equal(result.status, 0)
    const parsed = JSON.parse(result.stdout)
    assert.deepEqual(parsed.data.summary, { created: 0, updated: 1, skipped: 0 })
    assert.equal(parsed.data.results[0].action, "updated")
    assert.equal(parsed.data.results[0].memoryId, id)
    assert.equal(parsed.data.results[0].status, "approved")
    const after = JSON.parse(run(["list", "--json"], env))
    assert.equal(after.data.memories.length, 1)
    assert.equal(after.data.memories[0].id, id)
    assert.equal(after.data.memories[0].text, "Updated text")
    assert.equal(after.data.memories[0].category, "preference")
    assert.equal(after.data.memories[0].status, "approved")
    assert.equal(after.data.memories[0].kind, "workflow_rule")
  })

  it("obsidian import partially succeeds and skips invalid notes by default", () => {
    const vault = tempDir()
    const imports = path.join(vault, "Memory Lane", "imports")
    fs.mkdirSync(imports, { recursive: true })
    fs.writeFileSync(path.join(imports, "valid.md"), "---\nmemory_lane: true\n---\nValid memory\n", "utf8")
    fs.writeFileSync(path.join(imports, "invalid.md"), "---\nmemory_lane: true\ncategory: research\n---\nInvalid memory\n", "utf8")
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    runProcess(["config", "set", "obsidian", JSON.stringify({ enabled: true, vaultPath: vault, folder: "Memory Lane", mode: "mirror" })], { env })

    const result = runProcess(["obsidian", "import"], { env })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Obsidian import:/u)
    assert.match(result.stdout, /Imported: 1/u)
    assert.match(result.stdout, /Updated: 0/u)
    assert.match(result.stdout, /Skipped: 1/u)
    assert.match(result.stdout, /invalid\.md: invalid category value/u)
    const list = JSON.parse(run(["list", "--json"], env))
    assert.equal(list.data.memories.length, 1)
    assert.equal(list.data.memories[0].text, "Valid memory")
  })

})
