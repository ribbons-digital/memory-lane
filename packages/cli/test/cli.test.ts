import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"
import { MemoryEngine, type MemoryRecord } from "@memory-lane/core"

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

function writeMemoryRecords(filePath: string, records: MemoryRecord[]): void {
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
}

function freshnessFixtureRecords(projectScope: string): MemoryRecord[] {
  return [
    {
      id: "fresh-project-approved",
      text: "APPROVED PRIVATE CLI FRESHNESS TEXT",
      category: "project",
      scope: { type: "project", key: projectScope },
      status: "approved",
      source: "session-summary",
      kind: "project_checkpoint",
      provenance: { adapter: "pi", lifecycleEvent: "session_end" },
      createdAt: "2026-06-18T09:00:00.000Z",
      updatedAt: "2026-06-18T10:00:00.000Z",
    },
    {
      id: "fresh-global-approved",
      text: "GLOBAL APPROVED PRIVATE CLI FRESHNESS TEXT",
      category: "preference",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      kind: "preference",
      createdAt: "2026-06-18T08:30:00.000Z",
      updatedAt: "2026-06-18T09:30:00.000Z",
    },
    {
      id: "old-project-approved",
      text: "OLD PRIVATE CLI FRESHNESS TEXT",
      category: "project",
      scope: { type: "project", key: projectScope },
      status: "approved",
      source: "manual",
      kind: "project_fact",
      createdAt: "2026-06-17T08:00:00.000Z",
      updatedAt: "2026-06-17T08:00:00.000Z",
    },
    {
      id: "pending-private",
      text: "PENDING PRIVATE CLI FRESHNESS TEXT",
      category: "project",
      scope: { type: "project", key: projectScope },
      status: "pending",
      source: "user-suggested",
      kind: "project_fact",
      createdAt: "2026-06-18T11:00:00.000Z",
      updatedAt: "2026-06-18T11:00:00.000Z",
    },
  ]
}

function agreementFixtureRecords(projectScope: string): MemoryRecord[] {
  return [
    {
      id: "project-loop-current",
      text: "Project workflow loop: spec, approval, slice implementation.",
      category: "project",
      scope: { type: "project", key: projectScope },
      status: "approved",
      source: "manual",
      kind: "project_fact",
      createdAt: "2026-06-18T10:00:00.000Z",
      updatedAt: "2026-06-18T10:00:00.000Z",
    },
    {
      id: "project-loop-older",
      text: "Project workflow loop: older overlap.",
      category: "project",
      scope: { type: "project", key: projectScope },
      status: "approved",
      source: "manual",
      kind: "project_fact",
      createdAt: "2026-06-18T09:00:00.000Z",
      updatedAt: "2026-06-18T09:00:00.000Z",
    },
    {
      id: "global-pr-process",
      text: "PR process: open a pull request and wait for user merge approval.",
      category: "preference",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      kind: "workflow_rule",
      createdAt: "2026-06-18T08:00:00.000Z",
      updatedAt: "2026-06-18T08:00:00.000Z",
    },
    {
      id: "generic-global-pref",
      text: "User prefers concise answers.",
      category: "preference",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      kind: "preference",
      createdAt: "2026-06-18T07:00:00.000Z",
      updatedAt: "2026-06-18T07:00:00.000Z",
    },
  ]
}

function continuityFixtureRecords(projectScope: string): MemoryRecord[] {
  return [
    {
      id: "current-loop",
      text: "PRIVATE CURRENT LOOP TEXT Project workflow loop: spec approval then implementation.",
      category: "project",
      scope: { type: "project", key: projectScope },
      status: "approved",
      source: "manual",
      kind: "workflow_rule",
      createdAt: "2026-06-18T10:00:00.000Z",
      updatedAt: "2026-06-18T10:00:00.000Z",
      revision: { supersedes: ["old-loop"], revisedAt: "2026-06-18T10:00:00.000Z", revisedBy: "cli" },
    },
    {
      id: "old-loop",
      text: "PRIVATE OLD LOOP TEXT Project workflow loop: older duplicate.",
      category: "project",
      scope: { type: "project", key: projectScope },
      status: "approved",
      source: "manual",
      kind: "project_fact",
      createdAt: "2026-06-18T09:00:00.000Z",
      updatedAt: "2026-06-18T09:00:00.000Z",
      revision: { supersededBy: "current-loop", revisedAt: "2026-06-18T10:00:00.000Z", revisedBy: "cli" },
    },
    {
      id: "global-loop",
      text: "PRIVATE GLOBAL LOOP TEXT Project workflow loop global preference.",
      category: "preference",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      kind: "workflow_rule",
      createdAt: "2026-06-18T08:00:00.000Z",
      updatedAt: "2026-06-18T08:00:00.000Z",
    },
    {
      id: "global-project-like",
      text: "PRIVATE GLOBAL PROJECT-LIKE TEXT docs/superpowers/specs/sitewright-specific.md",
      category: "preference",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      kind: "preference",
      createdAt: "2026-06-18T07:30:00.000Z",
      updatedAt: "2026-06-18T07:30:00.000Z",
    },
  ]
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

  it("save accepts freshness flags", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const output = run([
      "save",
      "Temporary status",
      "--expires-at", "2026-07-01T00:00:00.000Z",
      "--stale-after-days", "30",
      "--captured-at", "2026-06-21T00:00:00.000Z",
      "--json",
    ], env)

    const payload = JSON.parse(output)
    assert.equal(payload.data.saved.freshness.expiresAt, "2026-07-01T00:00:00.000Z")
    assert.equal(payload.data.saved.freshness.staleAfterDays, 30)
    assert.equal(payload.data.saved.freshness.capturedAt, "2026-06-21T00:00:00.000Z")
  })

  it("suggest accepts freshness flags", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const output = run([
      "suggest",
      "Review this temporary fact later",
      "--stale-after-days", "14",
      "--json",
    ], env)

    const payload = JSON.parse(output)
    assert.equal(payload.data.saved.status, "pending")
    assert.equal(payload.data.saved.freshness.staleAfterDays, 14)
  })

  it("save rejects invalid stale-after-days", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const result = runProcess(["save", "Bad stale days", "--stale-after-days", "0", "--json"], { env })

    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /Invalid --stale-after-days/u)
  })

  it("save rejects freshness timestamp flags without values", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const result = runProcess(["save", "Missing expiration", "--expires-at", "--json"], { env })

    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /Invalid --expires-at: missing value/u)
  })

  it("human list and review output show compact freshness labels", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }
    run([
      "save", "Temporary status",
      "--expires-at", "2026-07-01T00:00:00.000Z",
      "--stale-after-days", "30",
      "--captured-at", "2026-06-21T00:00:00.000Z",
    ], env)
    run(["suggest", "Review this temporary fact later", "--stale-after-days", "14"], env)

    const list = run(["list"], env)
    assert.match(list, /expires 2026-07-01/u)
    assert.match(list, /stale after 30d/u)
    assert.match(list, /captured 2026-06-21/u)

    const review = run(["review"], env)
    assert.match(review, /stale after 14d/u)
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

  it("update changes a memory and records revision metadata", () => {
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    run(["save", "old update text", "--status", "pending", "--category", "project"], env)
    const before = JSON.parse(run(["list", "--json"], env))
    const id = before.data.memories[0].id

    const output = JSON.parse(run(["update", id, "--text", "new update text", "--category", "preference", "--kind", "workflow_rule", "--status", "approved", "--reason", "clarified", "--json"], env))
    const after = JSON.parse(run(["list", "--json"], env))

    assert.equal(output.ok, true)
    assert.equal(output.data.updated.text, "new update text")
    assert.equal(output.data.updated.category, "preference")
    assert.equal(output.data.updated.kind, "workflow_rule")
    assert.equal(output.data.updated.status, "approved")
    assert.equal(output.data.updated.revision.reason, "clarified")
    assert.equal(output.data.updated.revision.revisedBy, "cli")
    assert.equal(after.data.memories[0].revision.reason, "clarified")
  })

  it("update supports stdin dry-run without writing", () => {
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    run(["save", "old stdin text", "--status", "approved"], env)
    const id = JSON.parse(run(["list", "--json"], env)).data.memories[0].id

    const result = runProcess(["update", id, "--stdin", "--dry-run", "--json"], { env, stdin: "new stdin text" })
    const list = JSON.parse(run(["list", "--json"], env))
    const payload = JSON.parse(result.stdout)

    assert.equal(result.status, 0)
    assert.equal(payload.data.dryRun, true)
    assert.equal(payload.data.proposed.text, "new stdin text")
    assert.equal(list.data.memories[0].text, "old stdin text")
  })

  it("update rejects missing changes and no-op patches", () => {
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    run(["save", "same text", "--status", "approved"], env)
    const id = JSON.parse(run(["list", "--json"], env)).data.memories[0].id

    const metadataOnly = runProcess(["update", id, "--reason", "reviewed"], { env })
    const noOp = runProcess(["update", id, "--text", "same text"], { env })

    assert.notEqual(metadataOnly.status, 0)
    assert.match(metadataOnly.stdout + metadataOnly.stderr, /No changes to apply|At least one update field/u)
    assert.notEqual(noOp.status, 0)
    assert.match(noOp.stdout + noOp.stderr, /No changes to apply/u)
  })

  it("supersede links an approved successor to an old memory", () => {
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    run(["save", "old supersede", "--status", "approved"], env)
    run(["save", "new supersede", "--status", "approved"], env)
    const memories = JSON.parse(run(["list", "--json"], env)).data.memories
    const oldId = memories.find((m: any) => m.text === "old supersede").id
    const newId = memories.find((m: any) => m.text === "new supersede").id

    const output = JSON.parse(run(["supersede", newId, oldId, "--reason", "newer", "--json"], env))
    const after = JSON.parse(run(["list", "--json"], env)).data.memories

    assert.equal(output.ok, true)
    assert.equal(output.data.successor.revision.supersedes[0], oldId)
    assert.equal(after.find((m: any) => m.id === oldId).revision.supersededBy, newId)
  })

  it("supersede multi-old requires --yes unless dry-run", () => {
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    run(["save", "old one", "--status", "approved"], env)
    run(["save", "old two", "--status", "approved"], env)
    run(["save", "new many", "--status", "approved"], env)
    const memories = JSON.parse(run(["list", "--json"], env)).data.memories
    const oldIds = memories.filter((m: any) => m.text.startsWith("old ")).map((m: any) => m.id)
    const newId = memories.find((m: any) => m.text === "new many").id

    const missingYes = runProcess(["supersede", newId, ...oldIds], { env })
    const dryRun = runProcess(["supersede", newId, ...oldIds, "--dry-run", "--json"], { env })
    const confirmed = runProcess(["supersede", newId, ...oldIds, "--yes", "--json"], { env })

    assert.notEqual(missingYes.status, 0)
    assert.match(missingYes.stdout + missingYes.stderr, /--yes/u)
    assert.equal(dryRun.status, 0)
    assert.equal(JSON.parse(dryRun.stdout).data.dryRun, true)
    assert.equal(confirmed.status, 0)
    assert.equal(JSON.parse(confirmed.stdout).data.superseded.length, 2)
  })

  it("replace multi-old requires --yes unless dry-run", () => {
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    run(["save", "old replace one", "--status", "approved"], env)
    run(["save", "old replace two", "--status", "approved"], env)
    const oldIds = JSON.parse(run(["list", "--json"], env)).data.memories.map((m: any) => m.id)

    const missingYes = runProcess(["replace", ...oldIds, "--text", "new multi replace"], { env })
    const dryRun = runProcess(["replace", ...oldIds, "--text", "new multi replace", "--dry-run", "--json"], { env })
    const confirmed = runProcess(["replace", ...oldIds, "--text", "new multi replace", "--yes", "--json"], { env })

    assert.notEqual(missingYes.status, 0)
    assert.match(missingYes.stdout + missingYes.stderr, /--yes/u)
    assert.equal(dryRun.status, 0)
    assert.equal(JSON.parse(dryRun.stdout).data.dryRun, true)
    assert.equal(confirmed.status, 0)
    assert.equal(JSON.parse(confirmed.stdout).data.superseded.length, 2)
  })

  it("replace approved creates successor and supersedes old memory", () => {
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    run(["save", "old replace", "--status", "approved", "--category", "project"], env)
    const oldId = JSON.parse(run(["list", "--json"], env)).data.memories[0].id

    const output = JSON.parse(run(["replace", oldId, "--text", "new replace", "--kind", "workflow_rule", "--reason", "refined", "--json"], env))
    const after = JSON.parse(run(["list", "--json"], env)).data.memories

    assert.equal(output.data.successor.text, "new replace")
    assert.equal(output.data.successor.revision.supersedes[0], oldId)
    assert.equal(after.find((m: any) => m.id === oldId).revision.supersededBy, output.data.successor.id)
  })

  it("replace pending leaves old memory unchanged", () => {
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    run(["save", "old pending replacement", "--status", "approved"], env)
    const oldId = JSON.parse(run(["list", "--json"], env)).data.memories[0].id

    const output = JSON.parse(run(["replace", oldId, "--text", "draft replacement", "--status", "pending", "--json"], env))
    const after = JSON.parse(run(["list", "--json", "--all"], env)).data.memories

    assert.equal(output.data.successor.status, "pending")
    assert.equal(output.data.superseded.length, 0)
    assert.equal(after.find((m: any) => m.id === oldId).revision, undefined)
  })

  it("replace supports stdin dry-run without writing", () => {
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    run(["save", "old dry replace", "--status", "approved"], env)
    const oldId = JSON.parse(run(["list", "--json"], env)).data.memories[0].id

    const result = runProcess(["replace", oldId, "--stdin", "--dry-run", "--json"], { env, stdin: "new dry replacement" })
    const after = JSON.parse(run(["list", "--json"], env)).data.memories

    assert.equal(result.status, 0)
    assert.equal(JSON.parse(result.stdout).data.dryRun, true)
    assert.equal(after.length, 1)
    assert.equal(after[0].text, "old dry replace")
  })

  it("replace and supersede validate required ids, text, and engine inputs", () => {
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    run(["save", "old validation replace", "--status", "approved"], env)
    const oldId = JSON.parse(run(["list", "--json"], env)).data.memories[0].id

    const missingSupersedeIds = runProcess(["supersede"], { env })
    const missingReplaceIds = runProcess(["replace", "--text", "new text"], { env })
    const missingText = runProcess(["replace", oldId], { env })
    const invalidCategory = runProcess(["replace", oldId, "--text", "new text", "--category", "research"], { env })

    assert.notEqual(missingSupersedeIds.status, 0)
    assert.match(missingSupersedeIds.stdout + missingSupersedeIds.stderr, /Usage: memory-lane supersede/u)
    assert.notEqual(missingReplaceIds.status, 0)
    assert.match(missingReplaceIds.stdout + missingReplaceIds.stderr, /Usage: memory-lane replace/u)
    assert.notEqual(missingText.status, 0)
    assert.match(missingText.stdout + missingText.stderr, /Replacement text required/u)
    assert.notEqual(invalidCategory.status, 0)
    assert.match(invalidCategory.stdout + invalidCategory.stderr, /Invalid category/u)
  })

  it("supersede supports human output", () => {
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    run(["save", "old human supersede", "--status", "approved"], env)
    run(["save", "new human supersede", "--status", "approved"], env)
    const memories = JSON.parse(run(["list", "--json"], env)).data.memories
    const oldId = memories.find((m: any) => m.text === "old human supersede").id
    const newId = memories.find((m: any) => m.text === "new human supersede").id

    const output = run(["supersede", newId, oldId], env)

    assert.match(output, /Superseded memories:/u)
    assert.match(output, new RegExp(`Successor: \\[${escapeRegExp(newId)}\\] new human supersede`, "u"))
    assert.match(output, new RegExp(`Superseded old memories: ${escapeRegExp(oldId)}`, "u"))
    assert.doesNotMatch(output, /Old memories:/u)
  })

  it("replace supports human output", () => {
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    run(["save", "old human replace", "--status", "approved"], env)
    const oldId = JSON.parse(run(["list", "--json"], env)).data.memories[0].id

    const output = run(["replace", oldId, "--text", "new human replace"], env)

    assert.match(output, /Replaced memory:/u)
    assert.match(output, /Successor:/u)
    assert.match(output, /Superseded old memories:/u)
  })

  it("human list review and agreements show revision labels while recall stays unchanged", () => {
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }
    writeMemoryRecords(memFile, [
      {
        id: "agreement-current",
        text: "PR process: open a pull request and wait for user merge approval.",
        category: "preference",
        scope: { type: "global" },
        status: "approved",
        source: "manual",
        kind: "workflow_rule",
        createdAt: "2026-06-18T08:00:00.000Z",
        updatedAt: "2026-06-18T08:00:00.000Z",
        revision: {
          supersedes: ["agreement-old"],
          reason: "consolidated",
          revisedAt: "2026-06-18T09:00:00.000Z",
          revisedBy: "cli",
        },
      },
      {
        id: "pending-old",
        text: "Pending revision label memory",
        category: "project",
        scope: { type: "global" },
        status: "pending",
        source: "manual",
        kind: "project_fact",
        createdAt: "2026-06-18T07:00:00.000Z",
        updatedAt: "2026-06-18T07:00:00.000Z",
        revision: {
          supersededBy: "pending-new",
          revisedAt: "2026-06-18T09:30:00.000Z",
          revisedBy: "cli",
        },
      },
    ])

    const list = run(["list"], env)
    const review = run(["review"], env)
    const agreements = run(["agreements"], env)
    const recall = run(["recall", "PR process"], env)

    assert.match(list, /\[supersedes: agreement-old\]/u)
    assert.match(list, /\[superseded by: pending-new\]/u)
    assert.match(review, /\[superseded by: pending-new\]/u)
    assert.match(agreements, /\[supersedes: agreement-old\]/u)
    assert.doesNotMatch(recall, /supersedes: agreement-old/u)
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
      text: "Task: You are a delegated subagent running from a fork of the parent session. Treat inherited conversation as reference-only context. Merged PR #13 after prompt-continuity work.",
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
    assert.equal(payload.data.memories[0].checkpointCandidate, undefined)
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

  it("review labels checkpoint candidates in human output", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }
    run(["suggest", "Merged PR #13 adding prompt continuity intents.", "--category", "project"], env)
    run(["suggest", "Remember to check the release notes later.", "--category", "project"], env)

    const output = run(["review"], env)

    assert.match(output, /Checkpoint candidate: merge/u)
    assert.match(output, /matched merged pull request phrase/u)
    assert.match(output, /approve if this should become durable project continuity/u)
    assert.equal(output.match(/Checkpoint candidate:/gu)?.length, 1)
    const ambiguousLines = output.split(/\r?\n/u)
    const ambiguousPreviewIndex = ambiguousLines.findIndex((line) => line.includes("Remember to check the release notes later"))
    assert.notEqual(ambiguousPreviewIndex, -1)
    const ambiguousBlock = ambiguousLines.slice(ambiguousPreviewIndex, ambiguousPreviewIndex + 3).join("\n")
    assert.doesNotMatch(ambiguousBlock, /Checkpoint candidate/u)
  })

  it("review --json includes structured checkpoint metadata", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    run(["suggest", "Released v0.2.9.", "--category", "project"], env)
    run(["suggest", "Remember to test release command later.", "--category", "project"], env)

    const payload = JSON.parse(run(["review", "--json"], env))
    const release = payload.data.memories.find((memory: any) => memory.text === "Released v0.2.9.")
    const ambiguous = payload.data.memories.find((memory: any) => memory.text === "Remember to test release command later.")

    assert.deepEqual(release.checkpointCandidate, {
      detected: true,
      kind: "release",
      reason: "matched release version phrase",
    })
    assert.equal(ambiguous.checkpointCandidate, undefined)
  })

  it("captured checkpoint candidates appear in review and continuity", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-captured-checkpoint" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const capture = runProcess(["codex", "stop"], {
      env,
      cwd: project,
      stdin: JSON.stringify({
        hook_event_name: "Stop",
        session_id: "session-1",
        turn_id: "turn-1",
        cwd: project,
        transcript_path: null,
        model: "gpt-5-codex",
        permission_mode: "default",
        last_user_message: "Released v0.2.12.",
        last_assistant_message: "Done.",
      }),
    })
    assert.equal(capture.status, 0, capture.stderr)

    const review = runProcess(["review", "--json"], { env, cwd: project })
    assert.equal(review.status, 0, review.stderr)
    const reviewPayload = JSON.parse(review.stdout)
    assert.equal(reviewPayload.data.memories.length, 1)
    const memory = reviewPayload.data.memories[0]
    assert.equal(memory.status, "pending")
    assert.equal(memory.kind, "project_checkpoint")
    assert.equal(memory.source, "agent-suggested")
    assert.equal(memory.provenance.adapter, "codex")
    assert.equal(memory.provenance.lifecycleEvent, "turn_stop")
    assert.deepEqual(memory.checkpointCandidate, {
      detected: true,
      kind: "project",
      reason: "kind is project_checkpoint",
    })

    const continuity = runProcess(["continuity", "--json"], { env, cwd: project })
    assert.equal(continuity.status, 0, continuity.stderr)
    const continuityPayload = JSON.parse(continuity.stdout)
    assert.equal(continuityPayload.data.projectScope, "cli-captured-checkpoint")
    assert.equal(continuityPayload.data.status.pendingReviewCount, 1)
    assert.equal(continuityPayload.data.status.pendingContinuityCount, 1)
    assert.equal(continuityPayload.data.pendingContinuity.length, 1)
    assert.equal(continuityPayload.data.pendingContinuity[0].id, memory.id)
    assert.equal(continuityPayload.data.pendingContinuity[0].kind, "project_checkpoint")
    assert.match(continuityPayload.data.pendingContinuity[0].preview, /Released v0\.2\.12/u)
    assert.deepEqual(continuityPayload.data.pendingContinuity[0].checkpointCandidate, {
      detected: true,
      kind: "project",
      reason: "kind is project_checkpoint",
    })
  })

  it("captured workflow corrections appear in review and continuity", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-captured-correction" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }

    const capture = runProcess(["codex", "stop"], {
      env,
      cwd: project,
      stdin: JSON.stringify({
        hook_event_name: "Stop",
        session_id: "session-1",
        turn_id: "turn-1",
        cwd: project,
        transcript_path: null,
        model: "gpt-5-codex",
        permission_mode: "default",
        last_user_message: "You forgot our PR-protected workflow. Do not merge directly to main; open a PR and wait for me to merge before cleanup.",
        last_assistant_message: "Acknowledged.",
      }),
    })
    assert.equal(capture.status, 0, capture.stderr)

    const review = runProcess(["review"], { env, cwd: project })
    assert.equal(review.status, 0, review.stderr)
    assert.match(review.stdout, /Kind: correction/u)
    assert.match(review.stdout, /Workflow correction candidate/u)
    assert.match(review.stdout, /review-first learning/u)
    assert.match(review.stdout, /PR-protected workflow/u)
    assert.doesNotMatch(review.stdout, /You forgot/u)

    const continuity = runProcess(["continuity", "--json"], { env, cwd: project })
    assert.equal(continuity.status, 0, continuity.stderr)
    const continuityPayload = JSON.parse(continuity.stdout)
    assert.equal(continuityPayload.data.status.pendingContinuityCount, 1)
    assert.equal(continuityPayload.data.pendingContinuity[0].kind, "correction")
  })

  it("review groups pending memories by project source kind and provenance", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-review-project" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
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

    assert.match(output, /Memory Lane Review/u)
    assert.match(output, /Pending memories grouped by project, source, kind, and provenance/u)
    assert.match(output, /Project: global \| Source: user-suggested \| Kind: preference \| Provenance: none/u)
    assert.match(output, /Project: cli-review-project \| Source: session-summary \| Kind: session_summary \| Provenance: pi\/session_end/u)
    assert.match(output, /Review Queue/u)
    assert.match(output, /Pending preference/u)
    assert.match(output, /Pending session summary/u)
    assert.match(output, /memory-lane approve/u)
  })

  it("review filters pending memories by kind source and provenance", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-review-filter-project" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }
    const engine = new MemoryEngine({ memoryPath: memFile, embeddingsPath: embFile, configPath: cfgFile })
    engine.suggest("Pending preference", "preference", "global", "preference")
    engine.refreshScope(project)
    engine.save({
      text: "## Session Summary (2026-06-16)\n- **Decisions made** Phase 13 summary candidate needs review before freshness work.",
      status: "pending",
      category: "project",
      scopeType: "project",
      source: "session-summary",
      kind: "session_summary",
      provenance: { adapter: "pi", lifecycleEvent: "session_end" },
    })
    engine.save({
      text: "Claude summary candidate",
      status: "pending",
      category: "project",
      scopeType: "project",
      source: "session-summary",
      kind: "session_summary",
      provenance: { adapter: "claude", lifecycleEvent: "session_end" },
    })

    const output = run(["review", "--kind", "session_summary", "--source", "session-summary", "--provenance", "pi/session_end"], env)

    assert.match(output, /Filters: kind=session_summary, source=session-summary/u)
    assert.match(output, /provenance=pi\/session_end/u)
    assert.match(output, /Phase 13 summary candidate needs review/u)
    assert.match(output, /pending · pi\/session_end/u)
    assert.doesNotMatch(output, /Pending preference/u)
    assert.doesNotMatch(output, /Claude summary candidate/u)
    assert.doesNotMatch(output, /## Session Summary/u)
  })

  it("review --json reports active filters and filtered groups", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-review-filter-json-project" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const engine = new MemoryEngine({ memoryPath: memFile, embeddingsPath: embFile, configPath: cfgFile })
    engine.suggest("Pending preference", "preference", "global", "preference")
    engine.refreshScope(project)
    engine.save({
      text: "Pending pi session summary",
      status: "pending",
      category: "project",
      scopeType: "project",
      source: "session-summary",
      kind: "session_summary",
      provenance: { adapter: "pi", lifecycleEvent: "session_end" },
    })

    const payload = JSON.parse(run(["review", "--kind", "session_summary", "--source", "session-summary", "--provenance", "pi/session_end", "--json"], env))

    assert.equal(payload.ok, true)
    assert.equal(payload.meta.count, 1)
    assert.deepEqual(payload.meta.filters, { kind: "session_summary", source: "session-summary", provenance: "pi/session_end" })
    assert.equal(payload.data.memories[0].text, "Pending pi session summary")
    assert.equal(payload.data.groups.length, 1)
    assert.match(payload.data.groups[0].label, /Kind: session_summary/u)
  })

  it("dashboard --json summarizes memory health without long memory bodies", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "dashboard-project" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const longSummary = [
      "## Session Summary (2026-06-16)",
      "- **Decisions made** Phase 13 session-summary work landed in slices; Codex has no real SessionEnd hook, so automation moved to Stop plus explicit intent.",
      "- **Verification** pnpm test and pnpm build passed.",
      "Hidden private tail that should not be dumped in full by dashboard JSON output.",
    ].join("\n")
    const engine = new MemoryEngine({ memoryPath: memFile, embeddingsPath: embFile, configPath: cfgFile })
    engine.save({ text: "Global preference", category: "preference", scopeType: "global", status: "approved", kind: "preference" })
    engine.refreshScope(project)
    engine.save({ text: "Project checkpoint", category: "project", scopeType: "project", status: "approved", kind: "project_checkpoint" })
    engine.save({
      text: longSummary,
      category: "project",
      scopeType: "project",
      status: "pending",
      source: "session-summary",
      kind: "session_summary",
      provenance: { adapter: "pi", lifecycleEvent: "session_end" },
    })
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
    assert.equal(payload.data.recent.sessionSummaries[0].status, "pending")
    assert.equal(payload.data.recent.sessionSummaries[0].provenance, "pi/session_end")
    assert.match(payload.data.recent.sessionSummaries[0].preview, /Phase 13 session-summary work landed in slices/u)
    assert.match(payload.data.recent.sessionSummaries[0].preview, /Codex has no real SessionEnd hook/u)
    assert.doesNotMatch(payload.data.recent.sessionSummaries[0].preview, /## Session Summary/u)
    assert.doesNotMatch(JSON.stringify(payload), /Hidden private tail/u)
    assert.ok(payload.data.suggestedActions.includes("memory-lane review"))
  })

  it("continuity --json returns canonical continuity state", () => {
    const dir = tempDir()
    const project = path.join(dir, "project")
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity-project" }))
    const mem = path.join(dir, "memory.jsonl")
    const env = { MEMORY_LANE_FILE: mem, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json") }
    writeMemoryRecords(mem, [
      { id: "approved", text: "Approved project checkpoint", category: "project", scope: { type: "project", key: "cli-continuity-project" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z" },
      { id: "pending", text: "Merged PR #18 adding global hygiene hints.", category: "project", scope: { type: "project", key: "cli-continuity-project" }, status: "pending", source: "user-suggested", kind: "project_fact", createdAt: "2026-06-18T09:00:00.000Z", updatedAt: "2026-06-18T09:00:00.000Z" },
    ] as MemoryRecord[])

    const output = runProcess(["continuity", "--json"], { env, cwd: project })
    assert.equal(output.status, 0, output.stderr)
    const parsed = JSON.parse(output.stdout)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.data.projectScope, "cli-continuity-project")
    assert.equal(parsed.data.latestApproved.project.id, "approved")
    assert.deepEqual(parsed.data.pendingContinuity.map((item: any) => item.id), ["pending"])
    assert.ok(parsed.data.warnings.some((item: any) => item.code === "pending-continuity-newer-than-approved"))
  })

  it("continuity human output is compact and labels pending continuity", () => {
    const dir = tempDir()
    const project = path.join(dir, "project")
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity-human" }))
    const mem = path.join(dir, "memory.jsonl")
    const env = { MEMORY_LANE_FILE: mem, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json"), NO_COLOR: "1" }
    writeMemoryRecords(mem, [
      { id: "approved", text: "Approved project checkpoint", category: "project", scope: { type: "project", key: "cli-continuity-human" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z" },
      { id: "pending", text: "## Session Summary\nNext action: inspect review queue.", category: "project", scope: { type: "project", key: "cli-continuity-human" }, status: "pending", source: "session-summary", kind: "session_summary", createdAt: "2026-06-18T09:00:00.000Z", updatedAt: "2026-06-18T09:00:00.000Z" },
    ] as MemoryRecord[])

    const output = runProcess(["continuity"], { env, cwd: project })
    assert.equal(output.status, 0, output.stderr)
    assert.match(output.stdout, /Memory Lane Continuity/u)
    assert.match(output.stdout, /Project: cli-continuity-human/u)
    assert.match(output.stdout, /Latest approved/u)
    assert.match(output.stdout, /Pending continuity/u)
    assert.match(output.stdout, /memory-lane review --json/u)
  })

  it("dashboard --json includes text-free continuity hints", () => {
    const dir = tempDir()
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity" }))
    const memoryFile = path.join(dir, "mem.jsonl")
    writeMemoryRecords(memoryFile, continuityFixtureRecords("cli-continuity"))

    const output = run(["dashboard", "--json", "--project", project], { MEMORY_LANE_FILE: memoryFile, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "emb.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json") })
    const parsed = JSON.parse(output)

    assert.equal(parsed.ok, true)
    assert.equal(parsed.data.continuityHints.supersededVisible[0].id, "old-loop")
    assert.equal(parsed.data.continuityHints.scopeHygieneCandidates[0].id, "global-project-like")
    assert.equal(parsed.data.continuityHints.scopeHygieneCandidates[0].reason, "project-path-global-scope")
    assert.ok(parsed.data.continuityHints.hints.some((hint: any) => hint.code === "superseded-visible"))
    assert.ok(parsed.data.continuityHints.hints.some((hint: any) => hint.code === "scope-hygiene-candidate"))
    assert.doesNotMatch(JSON.stringify(parsed.data.continuityHints), /PRIVATE OLD LOOP TEXT|PRIVATE CURRENT LOOP TEXT|PRIVATE GLOBAL LOOP TEXT|PRIVATE GLOBAL PROJECT-LIKE TEXT/u)
  })

  it("dashboard human output shows compact continuity hints without memory text", () => {
    const dir = tempDir()
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity-human" }))
    const memoryFile = path.join(dir, "mem.jsonl")
    writeMemoryRecords(memoryFile, continuityFixtureRecords("cli-continuity-human"))

    const output = run(["dashboard", "--project", project], { MEMORY_LANE_FILE: memoryFile, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "emb.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json") })

    assert.match(output, /Continuity hints/u)
    assert.match(output, /superseded-visible/u)
    assert.match(output, /scope-hygiene-candidate/u)
    assert.match(output, /Suggested actions/u)
    assert.match(output, /memory-lane list --json/u)
    assert.doesNotMatch(output, /Continuity inspection/u)
    assert.equal(output.match(/memory-lane list --json/gu)?.length, 1)
    assert.doesNotMatch(output, /PRIVATE OLD LOOP TEXT|PRIVATE CURRENT LOOP TEXT|PRIVATE GLOBAL LOOP TEXT|PRIVATE GLOBAL PROJECT-LIKE TEXT/u)
  })

  it("status and doctor json include text-free continuity hints", () => {
    const dir = tempDir()
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity-status" }))
    const memoryFile = path.join(dir, "mem.jsonl")
    writeMemoryRecords(memoryFile, continuityFixtureRecords("cli-continuity-status"))
    const env = { MEMORY_LANE_FILE: memoryFile, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "emb.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json") }

    const status = JSON.parse(run(["status", "--json", "--since", "2026-06-18T07:00:00.000Z", "--project", project], env))
    const doctor = JSON.parse(run(["doctor", "--json", "--since", "2026-06-18T07:00:00.000Z", "--project", project], env))
    const humanDoctor = run(["doctor", "--since", "2026-06-18T07:00:00.000Z", "--project", project], env)

    assert.equal(status.data.continuityHints.newerApproved.count, 4)
    assert.equal(doctor.data.continuityHints.newerApproved.count, 4)
    assert.doesNotMatch(JSON.stringify(status.data.continuityHints), /PRIVATE OLD LOOP TEXT|PRIVATE CURRENT LOOP TEXT|PRIVATE GLOBAL LOOP TEXT|PRIVATE GLOBAL PROJECT-LIKE TEXT/u)
    assert.doesNotMatch(JSON.stringify(doctor.data.continuityHints), /PRIVATE OLD LOOP TEXT|PRIVATE CURRENT LOOP TEXT|PRIVATE GLOBAL LOOP TEXT|PRIVATE GLOBAL PROJECT-LIKE TEXT/u)
    assert.match(humanDoctor, /Continuity hints: \d+ \(/u)
    assert.doesNotMatch(humanDoctor, /supersededVisible|PRIVATE OLD LOOP TEXT|PRIVATE CURRENT LOOP TEXT|PRIVATE GLOBAL LOOP TEXT|PRIVATE GLOBAL PROJECT-LIKE TEXT/u)
  })

  it("dashboard human output gives session-summary previews enough context without full dumps", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "dashboard-summary-project" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }
    const summary = [
      "## Session Summary (2026-06-16)",
      "- **Decisions made** Phase 13 session-summary work landed in slices; Codex has no real SessionEnd hook, so automation moved to Stop plus explicit intent.",
      "- **Next step** Review pending session summaries before freshness automation.",
      "Hidden private tail that should not be dumped in dashboard human output.",
    ].join("\n")
    const engine = new MemoryEngine({ memoryPath: memFile, embeddingsPath: embFile, configPath: cfgFile })
    engine.refreshScope(project)
    engine.save({
      text: summary,
      category: "project",
      scopeType: "project",
      status: "pending",
      source: "session-summary",
      kind: "session_summary",
      provenance: { adapter: "pi", lifecycleEvent: "session_end" },
    })

    const result = runProcess(["dashboard"], { env, cwd: project })
    assert.equal(result.status, 0, result.stderr)
    const output = result.stdout

    assert.match(output, /Recent session summaries:/u)
    assert.match(output, /\[.+\] pending · pi\/session_end/u)
    assert.match(output, /Phase 13 session-summary work landed in slices/u)
    assert.match(output, /Codex has no real SessionEnd hook/u)
    assert.doesNotMatch(output, /## Session Summary/u)
    assert.doesNotMatch(output, /Hidden private tail/u)
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

  it("status and doctor json include text-free preference diagnostics", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-pref-diagnostics" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const engine = new MemoryEngine({ memoryPath: memFile, embeddingsPath: embFile, configPath: cfgFile })
    engine.save({ text: "CLI_SECRET_GLOBAL_PREF prefer concise answers", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
    engine.refreshScope(project)
    engine.save({ text: "CLI_SECRET_PROJECT_PREF include verification output", status: "approved", category: "preference", scopeType: "project", kind: "preference" })

    const status = JSON.parse(runProcess(["status", "--json"], { env, cwd: project }).stdout)
    const doctor = JSON.parse(runProcess(["doctor", "--json"], { env, cwd: project }).stdout)

    assert.equal(status.data.preferenceDiagnostics.projectScope, "cli-pref-diagnostics")
    assert.equal(status.data.preferenceDiagnostics.visiblePreferenceCount, 2)
    assert.equal(status.data.preferenceDiagnostics.currentProjectPreferenceCount, 1)
    assert.equal(status.data.preferenceDiagnostics.globalPreferenceCount, 1)
    assert.equal(doctor.data.preferenceDiagnostics.visiblePreferenceCount, 2)
    assert.doesNotMatch(JSON.stringify(status), /CLI_SECRET_GLOBAL_PREF|CLI_SECRET_PROJECT_PREF/u)
    assert.doesNotMatch(JSON.stringify(doctor), /CLI_SECRET_GLOBAL_PREF|CLI_SECRET_PROJECT_PREF/u)
  })

  it("doctor and status human output summarize preference diagnostics without preference text", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }
    const engine = new MemoryEngine({ memoryPath: memFile, embeddingsPath: embFile, configPath: cfgFile })
    engine.save({ text: "HUMAN_SECRET_PREF_BODY", status: "approved", category: "preference", scopeType: "global", kind: "preference" })

    const doctorOutput = run(["doctor"], env)
    const statusOutput = run(["status"], env)

    for (const output of [doctorOutput, statusOutput]) {
      assert.match(output, /Preference context: visible 1, selected for SessionStart 1, omitted 0/u)
      assert.match(output, /Preference caps: SessionStart 2 items \/ 600 chars, Prompt 2 items \/ 900 chars/u)
      assert.doesNotMatch(output, /HUMAN_SECRET_PREF_BODY/u)
      assert.doesNotMatch(output, /\[object Object\]/u)
    }
  })

  it("status --json --since reports freshness metadata without memory text", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-freshness-project" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    writeMemoryRecords(memFile, freshnessFixtureRecords("cli-freshness-project"))

    const result = runProcess(["status", "--json", "--since", "2026-06-18T08:00:00.000Z"], { env, cwd: project })

    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, true)
    assert.equal(payload.data.freshness.referenceTime, "2026-06-18T08:00:00.000Z")
    assert.equal(payload.data.freshness.visibleApprovedCount, 3)
    assert.equal(payload.data.freshness.newerApprovedCount, 2)
    assert.equal(payload.data.freshness.newerProjectApprovedCount, 1)
    assert.equal(payload.data.freshness.newerGlobalApprovedCount, 1)
    assert.equal(payload.data.freshness.newerGlobalPreferenceCount, 1)
    assert.deepEqual(payload.data.freshness.newerByKind, { project_checkpoint: 1, preference: 1 })
    assert.deepEqual(payload.data.freshness.newestNewerApproved.map((memory: any) => memory.id), ["fresh-project-approved", "fresh-global-approved"])
    assert.doesNotMatch(result.stdout, /APPROVED PRIVATE CLI FRESHNESS TEXT/u)
    assert.doesNotMatch(result.stdout, /PENDING PRIVATE CLI FRESHNESS TEXT/u)
  })

  it("doctor --json --since returns the same freshness object shape as status", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-freshness-project" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    writeMemoryRecords(memFile, freshnessFixtureRecords("cli-freshness-project"))

    const statusPayload = JSON.parse(runProcess(["status", "--json", "--since", "2026-06-18T08:00:00.000Z"], { env, cwd: project }).stdout)
    const doctorResult = runProcess(["doctor", "--json", "--since", "2026-06-18T08:00:00.000Z"], { env, cwd: project })

    assert.equal(doctorResult.status, 0, doctorResult.stderr)
    const doctorPayload = JSON.parse(doctorResult.stdout)
    assert.equal(new Date(statusPayload.data.freshness.advisory.referenceNow).toISOString(), statusPayload.data.freshness.advisory.referenceNow)
    assert.equal(new Date(doctorPayload.data.freshness.advisory.referenceNow).toISOString(), doctorPayload.data.freshness.advisory.referenceNow)
    statusPayload.data.freshness.advisory.referenceNow = "<reference-now>"
    doctorPayload.data.freshness.advisory.referenceNow = "<reference-now>"
    assert.deepEqual(doctorPayload.data.freshness, statusPayload.data.freshness)
    assert.doesNotMatch(doctorResult.stdout, /APPROVED PRIVATE CLI FRESHNESS TEXT/u)
    assert.doesNotMatch(doctorResult.stdout, /PENDING PRIVATE CLI FRESHNESS TEXT/u)
  })

  it("doctor and status human --since output compact freshness without memory text", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-freshness-project" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }
    writeMemoryRecords(memFile, freshnessFixtureRecords("cli-freshness-project"))

    const doctorResult = runProcess(["doctor", "--since", "2026-06-18T08:00:00.000Z"], { env, cwd: project })
    const statusResult = runProcess(["status", "--since", "2026-06-18T08:00:00.000Z"], { env, cwd: project })

    assert.equal(doctorResult.status, 0, doctorResult.stderr)
    assert.equal(statusResult.status, 0, statusResult.stderr)
    for (const output of [doctorResult.stdout, statusResult.stdout]) {
      assert.match(output, /Freshness: 2 newer approved memories since 2026-06-18T08:00:00.000Z/u)
      assert.match(output, /visible approved: 3/u)
      assert.doesNotMatch(output, /\[object Object\]/u)
      assert.doesNotMatch(output, /APPROVED PRIVATE CLI FRESHNESS TEXT/u)
      assert.doesNotMatch(output, /PENDING PRIVATE CLI FRESHNESS TEXT/u)
    }
  })

  it("status and doctor --since reject invalid ISO timestamps through core validation", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    for (const command of ["status", "doctor"]) {
      const result = runProcess([command, "--json", "--since", "not-a-date"], { env })

      assert.notEqual(result.status, 0)
      assert.match(result.stdout + result.stderr, /Invalid since timestamp: not-a-date/u)
    }
  })

  it("agreements --json returns primary and related agreement text", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-agreements-project" }), "utf8")
    writeMemoryRecords(memFile, agreementFixtureRecords("cli-agreements-project"))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const payload = JSON.parse(run(["agreements", "--json", "--project", project], env))

    assert.equal(payload.ok, true)
    assert.equal(payload.data.projectScope, "cli-agreements-project")
    assert.deepEqual(payload.data.primary.map((item: any) => item.memory.id), ["global-pr-process", "project-loop-current"])
    assert.deepEqual(payload.data.relatedCandidates.map((item: any) => item.memory.id), ["project-loop-older"])
    assert.match(JSON.stringify(payload.data), /Project workflow loop: spec/u)
    assert.match(JSON.stringify(payload.data), /PR process: open a pull request/u)
    assert.doesNotMatch(JSON.stringify(payload.data), /User prefers concise answers/u)
    assert.equal(payload.data.primary.find((item: any) => item.memory.id === "project-loop-current").recommendedKind, "workflow_rule")
  })

  it("agreements supports area filters and related limits", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-area-project" }), "utf8")
    writeMemoryRecords(memFile, agreementFixtureRecords("cli-area-project"))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const payload = JSON.parse(run(["agreements", "--json", "--project", project, "--area", "project-loop", "--related-limit", "0"], env))

    assert.equal(payload.ok, true)
    assert.deepEqual(payload.data.primary.map((item: any) => item.memory.id), ["project-loop-current"])
    assert.deepEqual(payload.data.relatedCandidates, [])
    assert.equal(payload.data.omittedRelatedCandidateCount, 1)
  })

  it("agreements supports all scope and primary limits", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-all-project" }), "utf8")
    writeMemoryRecords(memFile, [
      ...agreementFixtureRecords("cli-all-project"),
      {
        id: "other-project-release",
        text: "Release process: tag releases after approval.",
        category: "project",
        scope: { type: "project", key: "other-project" },
        status: "approved",
        source: "manual",
        kind: "workflow_rule",
        createdAt: "2026-06-18T11:00:00.000Z",
        updatedAt: "2026-06-18T11:00:00.000Z",
      },
    ])
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const scoped = JSON.parse(run(["agreements", "--json", "--project", project, "--area", "release-process"], env))
    const all = JSON.parse(run(["agreements", "--json", "--project", project, "--area", "release-process", "--all"], env))
    const limited = JSON.parse(run(["agreements", "--json", "--project", project, "--limit", "1"], env))

    assert.deepEqual(scoped.data.primary, [])
    assert.deepEqual(all.data.primary.map((item: any) => item.memory.id), ["other-project-release"])
    assert.equal(limited.data.primary.length, 1)
  })

  it("agreements human output includes primary text and overlap note", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-human-project" }), "utf8")
    writeMemoryRecords(memFile, agreementFixtureRecords("cli-human-project"))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const output = run(["agreements", "--project", project], env)

    assert.match(output, /Operating agreements/u)
    assert.match(output, /project-loop/u)
    assert.match(output, /Project workflow loop: spec/u)
    assert.match(output, /Related candidates/u)
    assert.match(output, /not superseded/u)
  })

  it("agreements rejects invalid area and invalid limits", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const badArea = runProcess(["agreements", "--area", "invalid-area"], { env })
    const badLimit = runProcess(["agreements", "--limit", "-1"], { env })

    assert.notEqual(badArea.status, 0)
    assert.match(badArea.stdout + badArea.stderr, /Invalid workflow area/u)
    assert.notEqual(badLimit.status, 0)
    assert.match(badLimit.stdout + badLimit.stderr, /Invalid --limit/u)
  })

  it("status and doctor expose operating agreement metadata without text", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-status-agreements" }), "utf8")
    writeMemoryRecords(memFile, [
      {
        id: "private-agreement",
        text: "PRIVATE CLI STATUS AGREEMENT TEXT Project workflow loop: review first.",
        category: "project",
        scope: { type: "project", key: "cli-status-agreements" },
        status: "approved",
        source: "manual",
        kind: "workflow_rule",
        createdAt: "2026-06-18T10:00:00.000Z",
        updatedAt: "2026-06-18T10:00:00.000Z",
      },
    ])
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const statusPayload = JSON.parse(run(["status", "--json", "--project", project], env))
    const doctorPayload = JSON.parse(run(["doctor", "--json", "--project", project], env))
    const humanDoctor = run(["doctor", "--project", project], env)

    assert.equal(statusPayload.data.operatingAgreements.primaryCount, 1)
    assert.equal(doctorPayload.data.operatingAgreements.primary[0].id, "private-agreement")
    assert.doesNotMatch(JSON.stringify(statusPayload), /PRIVATE CLI STATUS AGREEMENT TEXT/u)
    assert.doesNotMatch(JSON.stringify(doctorPayload), /PRIVATE CLI STATUS AGREEMENT TEXT/u)
    assert.match(humanDoctor, /Operating agreements/u)
    assert.doesNotMatch(humanDoctor, /PRIVATE CLI STATUS AGREEMENT TEXT/u)
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

  it("mcp and continuity commands are documented in help output", () => {
    const result = runProcess(["help"])
    assert.equal(result.status, 0)
    assert.match(result.stdout, /continuity \[--json\]\s+Canonical continuity read model for resumption\/status questions/u)
    assert.match(result.stdout, /mcp\s+Run the bundled Memory Lane MCP server over stdio/)
  })

  it("upgrade command is documented in help output", () => {
    const result = runProcess(["help"])
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes("upgrade [--yes]"))
    assert.ok(result.stdout.includes("Download latest binary and re-apply configs"))
  })

})
