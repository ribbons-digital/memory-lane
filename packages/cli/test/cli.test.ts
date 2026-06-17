import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"
import { MemoryEngine } from "@memory-lane/core"

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

  it("lists project-scoped memories in non-git directories", () => {
    const project = tempDir()
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const saved = runProcess(["save", "project plain folder rule", "--scope", "project", "--category", "project", "--status", "approved"], { env, cwd: project })
    assert.equal(saved.status, 0, saved.stderr)

    const listed = runProcess(["list", "--json"], { env, cwd: project })
    assert.equal(listed.status, 0, listed.stderr)
    const payload = JSON.parse(listed.stdout)
    assert.equal(payload.meta.count, 1)
    assert.equal(fs.realpathSync(payload.meta.projectScope), fs.realpathSync(project))
    assert.equal(payload.data.memories[0].text, "project plain folder rule")
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
    const deleteOutput = run(["delete", id], env)
    assert.match(deleteOutput, new RegExp(`Deleted: ${id}`, "u"))
    assert.doesNotMatch(deleteOutput, /delete me/u)
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

  it("review --suspect-meta shows likely operational prompt pollution only", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const legacyPollution = {
      id: "oldmeta1",
      text: "Task: ## Acceptance Finalization\nYou are continuing the same subagent session. Before this run can be accepted, compare the current work to the acceptance contract.",
      category: "project",
      scope: { type: "global" },
      status: "pending",
      source: "user-suggested",
      kind: "project_fact",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(memFile, JSON.stringify(legacyPollution) + "\n", "utf8")
    run(["suggest", "User prefers option B for installer onboarding", "--category", "preference"], env)

    const output = run(["review", "--suspect-meta"], env)

    assert.match(output, /Likely operational prompt pollution/u)
    assert.match(output, /oldmeta1/u)
    assert.match(output, /Acceptance Finalization/u)
    assert.doesNotMatch(output, /option B for installer onboarding/u)
  })

  it("review --suspect-meta JSON marks suspect filter and preserves project scope metadata", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const legacyPollution = {
      id: "oldmeta2",
      text: "Task: You are a delegated subagent running from a fork of the parent session. Treat inherited conversation as reference-only context.",
      category: "project",
      scope: { type: "global" },
      status: "pending",
      source: "user-suggested",
      kind: "project_fact",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(memFile, JSON.stringify(legacyPollution) + "\n", "utf8")

    const payload = JSON.parse(run(["review", "--suspect-meta", "--json"], env))

    assert.equal(payload.ok, true)
    assert.equal(payload.meta.count, 1)
    assert.equal(payload.meta.suspectMeta, true)
    assert.equal(payload.meta.includeApproved, false)
    assert.equal(typeof payload.meta.projectScope, "string")
    assert.notEqual(payload.meta.projectScope, "none")
    assert.equal(payload.data.memories[0].id, "oldmeta2")
  })

  it("review --suspect-meta JSON includes historical records missing newer source and scope fields", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const historicalPollution = {
      id: "oldmeta-json",
      text: "Task: ## Acceptance Finalization\nYou are continuing the same subagent session.",
      category: "project",
      status: "pending",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
    fs.writeFileSync(memFile, JSON.stringify(historicalPollution) + "\n", "utf8")

    const payload = JSON.parse(run(["review", "--suspect-meta", "--json"], env))

    assert.equal(payload.ok, true)
    assert.equal(payload.meta.count, 1)
    assert.equal(payload.data.memories[0].id, "oldmeta-json")
    assert.equal(payload.data.memories[0].source, "manual")
    assert.deepEqual(payload.data.memories[0].scope, { type: "global" })
  })

  it("review --suspect-meta excludes approved suspects by default", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const approvedPollution = {
      id: "approvedmeta1",
      text: "Task: ## Acceptance Finalization\nYou are continuing the same subagent session. Before this run can be accepted, compare the current work to the acceptance contract.",
      category: "project",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      kind: "project_fact",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(memFile, JSON.stringify(approvedPollution) + "\n", "utf8")

    const output = run(["review", "--suspect-meta"], env)

    assert.match(output, /No likely operational prompt pollution found/u)
    assert.doesNotMatch(output, /approvedmeta1/u)
  })

  it("review --suspect-meta --include-approved shows approved operational prompt pollution", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const approvedPollution = {
      id: "approvedmeta2",
      text: "Task: You are a delegated subagent running from a fork of the parent session. Treat inherited conversation as reference-only context.",
      category: "project",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      kind: "project_fact",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const regularApproved = {
      id: "approvedreal1",
      text: "Use pnpm test to verify this repository.",
      category: "project",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      kind: "workflow_rule",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(memFile, JSON.stringify(approvedPollution) + "\n" + JSON.stringify(regularApproved) + "\n", "utf8")

    const payload = JSON.parse(run(["review", "--suspect-meta", "--include-approved", "--json"], env))

    assert.equal(payload.ok, true)
    assert.equal(payload.meta.count, 1)
    assert.equal(payload.meta.suspectMeta, true)
    assert.equal(payload.meta.includeApproved, true)
    assert.equal(payload.data.memories[0].id, "approvedmeta2")
    assert.equal(payload.data.memories[0].status, "approved")
    assert.equal(payload.data.memories.some((memory: any) => memory.id === "approvedreal1"), false)
  })

  it("review --suspect-meta human output is compact and actionable", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const longTask = [
      "Task: You are a delegated subagent running from a fork of the parent session.",
      "Treat inherited conversation as reference-only context.",
      "Step 1: create a very long fixture body that should not be dumped in full.",
      "Step 2: run several commands and paste extensive logs.",
      "Step 3: final report with acceptance-report JSON and residual risks.",
      "This trailing sentence should be omitted from compact human output.",
    ].join(" ")
    const approvedPollution = {
      id: "approvedmeta3",
      text: longTask,
      category: "project",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      kind: "project_fact",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(memFile, JSON.stringify(approvedPollution) + "\n", "utf8")

    const output = run(["review", "--suspect-meta", "--include-approved"], env)

    assert.match(output, /\[approvedmeta3\] \[approved\]/u)
    assert.match(output, /Preview:/u)
    assert.match(output, /memory-lane delete approvedmeta3/u)
    assert.doesNotMatch(output, /This trailing sentence should be omitted/u)
  })

  it("review groups pending memories by project source kind and provenance", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-review-project" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const engine = new MemoryEngine({ memoryPath: memFile, embeddingsPath: embFile, configPath: cfgFile })
    engine.suggest("Pending preference", "preference", "global", "preference")
    engine.refreshScope(project)
    engine.save({
      text: "Pending session summary",
      status: "pending",
      category: "project",
      scopeType: "project",
      source: "session-summary",
      kind: "session_summary",
      provenance: { adapter: "pi", lifecycleEvent: "session_end" },
    })

    const output = run(["review"], env)

    assert.match(output, /Pending memories grouped by project, source, kind, and provenance/u)
    assert.match(output, /Project: global \| Source: user-suggested \| Kind: preference \| Provenance: none/u)
    assert.match(output, /Project: cli-review-project \| Source: session-summary \| Kind: session_summary \| Provenance: pi\/session_end/u)
    assert.match(output, /Pending preference/u)
    assert.match(output, /Pending session summary/u)
  })

  it("dashboard --json summarizes memory health without long memory bodies", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "dashboard-project" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const longSummary = "Session summary: released v1.2.3 and completed docs sync. This very long trailing detail should not be dumped in full by dashboard JSON output."
    const engine = new MemoryEngine({ memoryPath: memFile, embeddingsPath: embFile, configPath: cfgFile })
    engine.save({ text: "Global preference", category: "preference", scopeType: "global", status: "approved", kind: "preference" })
    engine.refreshScope(project)
    engine.save({ text: "Project checkpoint", category: "project", scopeType: "project", status: "approved", kind: "project_checkpoint" })
    engine.save({ text: longSummary, category: "project", scopeType: "project", status: "pending", source: "session-summary", kind: "session_summary" })
    engine.save({ text: "Task: ## Acceptance Finalization\nYou are continuing the same subagent session.", category: "project", scopeType: "project", status: "pending", source: "user-suggested", kind: "project_fact" })

    const result = runProcess(["dashboard", "--json"], { env, cwd: project })
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)

    assert.equal(payload.ok, true)
    assert.equal(payload.data.projectScope, "dashboard-project")
    assert.equal(payload.data.counts.total, 4)
    assert.equal(payload.data.counts.approved, 2)
    assert.equal(payload.data.counts.pending, 2)
    assert.equal(payload.data.counts.global, 1)
    assert.equal(payload.data.counts.project, 3)
    assert.equal(payload.data.review.pending, 2)
    assert.equal(payload.data.review.sessionSummaries, 1)
    assert.equal(payload.data.review.suspectMeta, 1)
    assert.equal(payload.data.recent.sessionSummaries.length, 1)
    assert.match(payload.data.recent.sessionSummaries[0].preview, /released v1\.2\.3/u)
    assert.doesNotMatch(JSON.stringify(payload), /This very long trailing detail/u)
    assert.ok(payload.data.suggestedActions.includes("memory-lane review"))
  })

  it("dashboard human output is compact and friendly", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "dashboard-human-project" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }
    const engine = new MemoryEngine({ memoryPath: memFile, embeddingsPath: embFile, configPath: cfgFile })
    engine.refreshScope(project)
    engine.save({ text: "Project dashboard checkpoint with trailing private detail that should not be dumped", category: "project", scopeType: "project", status: "approved", kind: "project_checkpoint" })
    engine.save({ text: "Task: You are a delegated subagent running from a fork of the parent session.", category: "project", scopeType: "project", status: "pending", source: "user-suggested", kind: "project_fact" })

    const result = runProcess(["dashboard"], { env, cwd: project })
    assert.equal(result.status, 0, result.stderr)
    const output = result.stdout

    assert.match(output, /Memory Lane Dashboard/u)
    assert.match(output, /dashboard-human-project/u)
    assert.match(output, /Review Queue/u)
    assert.match(output, /Suspect meta/u)
    assert.match(output, /Suggested actions/u)
    assert.match(output, /memory-lane review --suspect-meta/u)
    assert.doesNotMatch(output, /trailing private detail/u)
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
    assert.equal(parsed.data.contextPolicyMode, "selective")
    assert.equal(parsed.data.contextPolicyPromptMaxItems, 6)
    assert.equal(parsed.data.contextPolicySessionStartMaxItems, 4)
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
    assert.match(output, /Context policy:/u)
    assert.match(output, /mode: selective/u)
    assert.match(output, /prompt budget: 6 items \/ 3000 chars/u)
    assert.match(output, /integrations:/u)
    assert.match(output, /mcpExplicitToolsOnly/u)
    assert.doesNotMatch(output, /\[object Object\]/u)
  })

  it("session-end errors when summarization is not configured", () => {
    const result = runProcess(["session-end"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
      stdin: JSON.stringify({ messages: [] }),
    })

    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /Session-end summarization is not enabled/)
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

  it("claude session-start accepts hook payload on stdin", () => {
    runProcess(["save", "This repo runs tests with pnpm test", "--status", "approved"], {
      env: { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile },
    })
    const result = runProcess(["claude", "session-start"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
      stdin: JSON.stringify({
        hook_event_name: "SessionStart",
        session_id: "session-1",
        cwd: process.cwd(),
        transcript_path: null,
        permission_mode: "default",
        source: "startup",
      }),
    })
    assert.equal(result.status, 0)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart")
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

  it("claude session-end accepts hook payload on stdin and uses temp config", () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ memory: { sessionEndSummary: { enabled: true } } }), "utf8")
    const result = runProcess(["claude", "session-end"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
      stdin: JSON.stringify({
        hook_event_name: "SessionEnd",
        session_id: "session-1",
        cwd: process.cwd(),
        transcript_path: null,
        permission_mode: "default",
        messages: [{ role: "user", content: "remember this session" }],
        confirmed: true,
      }),
    })
    assert.equal(result.status, 0)
    assert.match(result.stdout, /requires memory\.sessionEndSummary\.baseUrl and model/)
    assert.equal(fs.existsSync(memFile) ? fs.readFileSync(memFile, "utf8") : "", "")
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

  it("mcp command is documented in help output", () => {
    const result = runProcess(["help"])
    assert.equal(result.status, 0)
    assert.match(result.stdout, /mcp\s+Run the bundled Memory Lane MCP server over stdio/)
  })

  it("upgrade command is documented in help output", () => {
    const result = runProcess(["help"])
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes("upgrade [--yes]"))
    assert.ok(result.stdout.includes("Download latest binary and re-apply configs"))
  })

})
