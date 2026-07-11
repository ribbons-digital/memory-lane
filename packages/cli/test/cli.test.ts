import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import * as http from "node:http"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"
import { MemoryEngine, type ContinuityReadModel, type MemoryRecord } from "@memory-lane/core"
import { formatContinuityReadModel, formatMemoryGet } from "../src/formatters.ts"
import { runPiHookCommand } from "../src/pi-hook.ts"

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
  const env = { ...process.env, ...options?.env }
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key]
  }
  return spawnSync("node", [cli, ...args], {
    input: options?.stdin,
    encoding: "utf8",
    cwd: options?.cwd,
    env,
  })
}

function runProcessAsync(args: string[], options?: { env?: NodeJS.ProcessEnv; stdin?: string; cwd?: string }): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const cli = path.resolve(__dirname, "../dist/index.js")
  const env = { ...process.env, ...options?.env }
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key]
  }
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cli, ...args], { cwd: options?.cwd, env, stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (status) => resolve({ status, stdout, stderr }))
    child.stdin.end(options?.stdin)
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function withHangingServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = http.createServer((req) => {
    req.resume()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address")
  }
  try {
    return await fn(`http://127.0.0.1:${address.port}/v1`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function withMockSummaryServer<T>(summary: string, fn: (baseUrl: string, requests: unknown[]) => Promise<T>): Promise<T> {
  const requests: unknown[] = []
  const server = http.createServer((req, res) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      try { requests.push(JSON.parse(body)) } catch { requests.push(body) }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ choices: [{ message: { content: summary } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected TCP server address")
  try {
    return await fn(`http://127.0.0.1:${address.port}/v1`, requests)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function writeMemoryRecords(filePath: string, records: MemoryRecord[]): void {
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
}

function writeTraceFixture(root: string, directoryName: string, fileName: string, content: string): string {
  const dir = path.join(root, directoryName)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, fileName)
  fs.writeFileSync(filePath, content, "utf8")
  return filePath
}

describe("config command", () => {
  function configFixture(): { env: NodeJS.ProcessEnv; configPath: string } {
    const dir = tempDir()
    const configPath = path.join(dir, "config.json")
    const env = {
      MEMORY_LANE_FILE: path.join(dir, "memories.jsonl"),
      MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"),
      MEMORY_LANE_CONFIG: configPath,
      NO_COLOR: "1",
    }
    return { env, configPath }
  }

  it("rejects invalid numeric writes without changing the config file", () => {
    const { env, configPath } = configFixture()
    const original = JSON.stringify({ semantic: { retrieval: { topK: 8 } } }, null, 2) + "\n"
    fs.writeFileSync(configPath, original)

    const result = runProcess(["config", "set", "semantic.retrieval.topK", "banana"], { env })

    assert.equal(result.status, 1)
    assert.match(result.stdout, /semantic\.retrieval\.topK must be finite number/u)
    assert.equal(fs.readFileSync(configPath, "utf8"), original)
  })

  it("rejects invalid boolean writes without changing the config file", () => {
    const { env, configPath } = configFixture()
    const original = JSON.stringify({ semantic: { privacy: { allowRemoteEmbeddings: false } } }, null, 2) + "\n"
    fs.writeFileSync(configPath, original)

    const result = runProcess(["config", "set", "semantic.privacy.allowRemoteEmbeddings", "maybe"], { env })

    assert.equal(result.status, 1)
    assert.match(result.stdout, /semantic\.privacy\.allowRemoteEmbeddings must be boolean/u)
    assert.equal(fs.readFileSync(configPath, "utf8"), original)
  })

  it("rejects invalid object writes without changing the config file", () => {
    const { env, configPath } = configFixture()
    const original = JSON.stringify({ semantic: { retrieval: { topK: 8 } } }, null, 2) + "\n"
    fs.writeFileSync(configPath, original)

    const result = runProcess(["config", "set", "semantic.retrieval", "{\"topK\":\"bad\"}"], { env })

    assert.equal(result.status, 1)
    assert.match(result.stdout, /semantic\.retrieval\.topK must be finite number/u)
    assert.equal(fs.readFileSync(configPath, "utf8"), original)
  })

  it("rejects missing config values as usage errors", () => {
    const { env, configPath } = configFixture()

    const result = runProcess(["config", "set", "semantic.retrieval.minSimilarity"], { env })

    assert.equal(result.status, 2)
    assert.match(result.stdout, /Usage: memory-lane config set <json-path> <value>/u)
    assert.equal(fs.existsSync(configPath), false)
  })

  it("repairs a parseable invalid config without constructing the engine", () => {
    const { env, configPath } = configFixture()
    fs.writeFileSync(configPath, JSON.stringify({ semantic: { retrieval: { topK: "banana" } } }, null, 2) + "\n")

    const result = runProcess(["config", "set", "semantic.retrieval.topK", "9"], { env })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Set semantic\.retrieval\.topK/u)
    const repairedConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as { semantic?: { retrieval?: { topK?: unknown } } }
    assert.equal(repairedConfig.semantic?.retrieval?.topK, 9)
  })

  it("reports malformed config JSON with the file path before engine setup", () => {
    const { env, configPath } = configFixture()
    fs.writeFileSync(configPath, "{", "utf8")

    const result = runProcess(["config", "show"], { env })

    assert.equal(result.status, 1)
    assert.match(result.stdout, new RegExp(escapeRegExp(configPath), "u"))
    assert.match(result.stdout, /Expected property name|JSON/u)
  })
})

describe("formatMemoryGet", () => {
  it("renders descriptor metadata on exact human show output", () => {
    const memory: MemoryRecord = {
      id: "descriptor-human",
      text: "Full memory body remains visible.",
      category: "project",
      scope: { type: "project", key: "repo" },
      status: "approved",
      source: "manual",
      kind: "project_fact",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
      descriptor: {
        description: "Compact exact-show descriptor",
        fetchHint: "working on exact memory inspection",
        keywords: ["descriptor", "show"],
      },
    }

    const output = formatMemoryGet(memory.id, memory, false, false)

    assert.match(output, /Descriptor:/u)
    assert.match(output, /Description: Compact exact-show descriptor/u)
    assert.match(output, /Fetch hint: working on exact memory inspection/u)
    assert.match(output, /Keywords: descriptor, show/u)
    assert.match(output, /Full memory body remains visible/u)
  })

  it("includes descriptor metadata in exact JSON show output", () => {
    const memory: MemoryRecord = {
      id: "descriptor-json",
      text: "JSON memory body.",
      category: "project",
      scope: { type: "project", key: "repo" },
      status: "approved",
      source: "manual",
      kind: "project_fact",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
      descriptor: { description: "JSON descriptor" },
    }

    const parsed = JSON.parse(formatMemoryGet(memory.id, memory, true, false))

    assert.deepEqual(parsed.data.memory.descriptor, { description: "JSON descriptor" })
  })
})

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
      freshness: { staleAfterDays: 1, capturedAt: "2026-06-17T08:00:00.000Z" },
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

  it("prints version without config or storage initialization", () => {
    const env = {
      MEMORY_LANE_VERSION: "v9.8.7",
      MEMORY_LANE_CONFIG: path.join(dir, "invalid-config.json"),
      MEMORY_LANE_FILE: path.join(dir, "missing", "mem.jsonl"),
      MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "missing", "emb.jsonl"),
    }
    fs.writeFileSync(env.MEMORY_LANE_CONFIG, "{not-json", "utf8")

    for (const flag of ["--version", "-v", "version"]) {
      const result = runProcess([flag], { env })

      assert.equal(result.status, 0)
      assert.equal(result.stdout.trim(), "9.8.7")
      assert.equal(result.stderr, "")
    }
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

  it("save --kind project_checkpoint persists and reports the explicit kind in JSON", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const payload = JSON.parse(run([
      "save", "Released v1.2.3 after completing the migration",
      "--kind", "project_checkpoint",
      "--json",
    ], env))
    const persisted = JSON.parse(fs.readFileSync(memFile, "utf8").trim())

    assert.equal(payload.data.saved.kind, "project_checkpoint")
    assert.equal(persisted.kind, "project_checkpoint")
  })

  it("save preserves an explicit workflow_rule kind in human list output", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }

    run([
      "save", "Always run focused tests before committing",
      "--category", "preference",
      "--scope", "global",
      "--kind", "workflow_rule",
    ], env)
    const persisted = JSON.parse(fs.readFileSync(memFile, "utf8").trim())
    const list = run(["list"], env)

    assert.equal(persisted.kind, "workflow_rule")
    assert.match(list, /\(global\/preference\/workflow_rule\).*Always run focused tests before committing/u)
  })

  it("save without --kind retains text-based kind inference", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const payload = JSON.parse(run([
      "save", "Checkpoint: migration completed successfully",
      "--category", "project",
      "--json",
    ], env))
    const persisted = JSON.parse(fs.readFileSync(memFile, "utf8").trim())

    assert.equal(payload.data.saved.kind, "project_checkpoint")
    assert.equal(persisted.kind, "project_checkpoint")
  })

  it("save rejects an invalid --kind without persisting a record", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }

    const result = runProcess(["save", "Invalid kind must not persist", "--kind", "not_a_kind", "--json"], { env })

    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /Invalid kind: not_a_kind/u)
    assert.equal(fs.existsSync(memFile) ? fs.readFileSync(memFile, "utf8") : "", "")
  })

  it("save allows long branch-like tokens without secret context", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }

    const output = run(["save", "Deploy from branch release/JIRA-2024-blueGreenRollout-phase3", "--json"], env)
    const payload = JSON.parse(output)

    assert.equal(payload.ok, true)
    assert.equal(payload.data.saved.text, "Deploy from branch release/JIRA-2024-blueGreenRollout-phase3")
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

  it("keeps review and mutations project-scoped unless --all is explicit", () => {
    const projectA = tempDir()
    const projectB = tempDir()
    fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "cli-scope-project-a" }), "utf8")
    fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "cli-scope-project-b" }), "utf8")
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }
    const saveForProjectA = (text: string, status: "pending" | "approved"): string => {
      const payload = JSON.parse(run([
        "save", text,
        "--scope", "project",
        "--category", "project",
        "--status", status,
        "--project", projectA,
        "--json",
      ], env))
      assert.equal(payload.ok, true)
      assert.equal(payload.data.saved.scope.key, "cli-scope-project-a")
      return payload.data.saved.id
    }

    const reviewText = "SECRET project A review text"
    const approveText = "SECRET project A approve text"
    const rejectText = "SECRET project A reject text"
    const deleteText = "SECRET project A delete text"
    const updateText = "SECRET project A update text"
    const dryRunText = "SECRET project A dry-run text"
    saveForProjectA(reviewText, "pending")
    const approveId = saveForProjectA(approveText, "pending")
    const rejectId = saveForProjectA(rejectText, "pending")
    const deleteId = saveForProjectA(deleteText, "approved")
    const updateId = saveForProjectA(updateText, "approved")
    const dryRunId = saveForProjectA(dryRunText, "approved")
    const projectBText = "Visible project B review text"
    const projectBSaved = JSON.parse(run([
      "save", projectBText,
      "--scope", "project",
      "--category", "project",
      "--status", "pending",
      "--project", projectB,
      "--json",
    ], env))
    assert.equal(projectBSaved.data.saved.scope.key, "cli-scope-project-b")

    const scopedReview = runProcess(["review", "--project", projectB, "--json"], { env })
    assert.equal(scopedReview.status, 0, scopedReview.stderr)
    const scopedReviewPayload = JSON.parse(scopedReview.stdout)
    assert.equal(scopedReviewPayload.ok, true)
    assert.equal(scopedReviewPayload.meta.projectScope, "cli-scope-project-b")
    assert.equal(scopedReviewPayload.meta.count, 1)
    assert.deepEqual(scopedReviewPayload.data.memories.map((memory: MemoryRecord) => memory.text), [projectBText])
    assert.doesNotMatch(scopedReview.stdout, /SECRET project A/u)

    const allReview = runProcess(["review", "--all", "--project", projectB, "--json"], { env })
    assert.equal(allReview.status, 0, allReview.stderr)
    const allReviewPayload = JSON.parse(allReview.stdout)
    assert.equal(allReviewPayload.ok, true)
    assert.equal(allReviewPayload.meta.projectScope, "cli-scope-project-b")
    assert.equal(allReviewPayload.meta.count, 4)
    assert.deepEqual(allReviewPayload.data.memories.map((memory: MemoryRecord) => memory.text).sort(), [approveText, projectBText, rejectText, reviewText].sort())

    const refused = {
      approve: runProcess(["approve", approveId, "--project", projectB, "--json"], { env }),
      reject: runProcess(["reject", rejectId, "--project", projectB, "--json"], { env }),
      delete: runProcess(["delete", deleteId, "--project", projectB, "--json"], { env }),
      update: runProcess(["update", updateId, "--text", "cross-project update must not land", "--project", projectB, "--json"], { env }),
      "update --dry-run": runProcess(["update", dryRunId, "--text", "cross-project preview must not leak", "--dry-run", "--project", projectB, "--json"], { env }),
    }
    for (const [command, result] of Object.entries(refused)) {
      assert.notEqual(result.status, 0, `${command} unexpectedly succeeded`)
      const payload = JSON.parse(result.stdout)
      assert.equal(payload.ok, false, command)
      assert.match(payload.error, /Memory not found/u, command)
    }
    assert.doesNotMatch(Object.values(refused).map((result) => result.stdout + result.stderr).join("\n"), /SECRET project A|cross-project preview/u)

    const unchanged = JSON.parse(run(["list", "--all", "--project", projectB, "--json"], env)).data.memories as MemoryRecord[]
    assert.equal(unchanged.find((memory) => memory.id === approveId)?.status, "pending")
    assert.equal(unchanged.find((memory) => memory.id === rejectId)?.status, "pending")
    assert.equal(unchanged.find((memory) => memory.id === deleteId)?.status, "approved")
    assert.equal(unchanged.find((memory) => memory.id === updateId)?.text, updateText)
    assert.equal(unchanged.find((memory) => memory.id === dryRunId)?.text, dryRunText)

    const approved = runProcess(["approve", approveId, "--all", "--project", projectB, "--json"], { env })
    const rejected = runProcess(["reject", rejectId, "--all", "--project", projectB, "--json"], { env })
    const deleted = runProcess(["delete", deleteId, "--all", "--project", projectB, "--json"], { env })
    const updated = runProcess(["update", updateId, "--text", "explicit all update", "--all", "--project", projectB, "--json"], { env })
    const dryRun = runProcess(["update", dryRunId, "--text", "explicit all preview", "--dry-run", "--all", "--project", projectB, "--json"], { env })

    for (const [command, result] of Object.entries({ approved, rejected, deleted, updated, dryRun })) {
      assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout}`)
      assert.equal(JSON.parse(result.stdout).ok, true, command)
    }
    assert.equal(JSON.parse(approved.stdout).data.approved.status, "approved")
    assert.equal(JSON.parse(rejected.stdout).data.rejected.status, "rejected")
    assert.equal(JSON.parse(deleted.stdout).data.deleted.status, "deleted")
    assert.equal(JSON.parse(updated.stdout).data.updated.text, "explicit all update")
    const dryRunPayload = JSON.parse(dryRun.stdout)
    assert.equal(dryRunPayload.data.dryRun, true)
    assert.equal(dryRunPayload.data.current.text, dryRunText)
    assert.equal(dryRunPayload.data.proposed.text, "explicit all preview")

    const after = JSON.parse(run(["list", "--all", "--project", projectB, "--json"], env)).data.memories as MemoryRecord[]
    assert.equal(after.find((memory) => memory.id === approveId)?.status, "approved")
    assert.equal(after.find((memory) => memory.id === rejectId)?.status, "rejected")
    assert.equal(after.find((memory) => memory.id === deleteId)?.status, "deleted")
    assert.equal(after.find((memory) => memory.id === updateId)?.text, "explicit all update")
    assert.equal(after.find((memory) => memory.id === dryRunId)?.text, dryRunText)
  })

  it("keeps rescope supersede and replace project-scoped unless --all is explicit", () => {
    const projectA = tempDir()
    const projectB = tempDir()
    fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "cli-revision-project-a" }), "utf8")
    fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "cli-revision-project-b" }), "utf8")
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }
    const saveForProjectA = (text: string): MemoryRecord => {
      const payload = JSON.parse(run([
        "save", text,
        "--scope", "project",
        "--category", "project",
        "--status", "approved",
        "--project", projectA,
        "--json",
      ], env))
      assert.equal(payload.data.saved.scope.key, "cli-revision-project-a")
      return payload.data.saved as MemoryRecord
    }
    const rescopeTarget = saveForProjectA("SECRET project A rescope source")
    const supersedeOld = saveForProjectA("SECRET project A supersede old source")
    const supersedeSuccessor = saveForProjectA("SECRET project A supersede successor")
    const replaceOld = saveForProjectA("SECRET project A replace source")
    const projectARecordsBefore = JSON.parse(run(["list", "--all", "--project", projectA, "--json"], env)).data.memories as MemoryRecord[]
    const memoryFileBefore = fs.readFileSync(memFile, "utf8")
    const embeddingFileBefore = fs.existsSync(embFile) ? fs.readFileSync(embFile, "utf8") : undefined

    const denied = {
      "rescope --dry-run": runProcess([
        "rescope", rescopeTarget.id, "--scope", "global", "--dry-run", "--project", projectB, "--json",
      ], { env }),
      "rescope --yes": runProcess([
        "rescope", rescopeTarget.id, "--scope", "global", "--yes", "--project", projectB, "--json",
      ], { env }),
      "supersede --dry-run": runProcess([
        "supersede", supersedeSuccessor.id, supersedeOld.id, "--dry-run", "--project", projectB, "--json",
      ], { env }),
      supersede: runProcess([
        "supersede", supersedeSuccessor.id, supersedeOld.id, "--project", projectB, "--json",
      ], { env }),
      "replace --dry-run": runProcess([
        "replace", replaceOld.id, "--text", "DENIED replacement preview", "--dry-run", "--project", projectB, "--json",
      ], { env }),
      replace: runProcess([
        "replace", replaceOld.id, "--text", "DENIED replacement apply", "--project", projectB, "--json",
      ], { env }),
    }
    for (const [command, result] of Object.entries(denied)) {
      assert.notEqual(result.status, 0, `${command} unexpectedly succeeded`)
      const payload = JSON.parse(result.stdout)
      assert.equal(payload.ok, false, command)
      assert.match(payload.error, /memory not found/u, command)
    }
    const deniedOutput = Object.values(denied).map((result) => result.stdout + result.stderr).join("\n")
    assert.doesNotMatch(deniedOutput, /SECRET project A|DENIED replacement/u)

    const projectARecordsAfterDenied = JSON.parse(run(["list", "--all", "--project", projectA, "--json"], env)).data.memories as MemoryRecord[]
    assert.deepEqual(projectARecordsAfterDenied, projectARecordsBefore)
    assert.equal(fs.readFileSync(memFile, "utf8"), memoryFileBefore)
    assert.equal(fs.existsSync(embFile) ? fs.readFileSync(embFile, "utf8") : undefined, embeddingFileBefore)

    const allPreviews = {
      rescope: runProcess([
        "rescope", rescopeTarget.id, "--scope", "global", "--dry-run", "--all", "--project", projectB, "--json",
      ], { env }),
      supersede: runProcess([
        "supersede", supersedeSuccessor.id, supersedeOld.id, "--dry-run", "--all", "--project", projectB, "--json",
      ], { env }),
      replace: runProcess([
        "replace", replaceOld.id, "--text", "Explicit all replacement preview", "--dry-run", "--all", "--project", projectB, "--json",
      ], { env }),
    }
    for (const [command, result] of Object.entries(allPreviews)) {
      assert.equal(result.status, 0, `${command} --all preview: ${result.stderr || result.stdout}`)
      const payload = JSON.parse(result.stdout)
      assert.equal(payload.ok, true, command)
      assert.equal(payload.data.dryRun, true, command)
    }
    assert.equal(JSON.parse(allPreviews.rescope.stdout).data.proposed.scope.type, "global")
    assert.equal(JSON.parse(allPreviews.supersede.stdout).data.successor.id, supersedeSuccessor.id)
    assert.equal(JSON.parse(allPreviews.replace.stdout).data.successor.text, "Explicit all replacement preview")

    const projectARecordsAfterPreviews = JSON.parse(run(["list", "--all", "--project", projectA, "--json"], env)).data.memories as MemoryRecord[]
    assert.deepEqual(projectARecordsAfterPreviews, projectARecordsBefore)
    assert.equal(fs.readFileSync(memFile, "utf8"), memoryFileBefore)
    assert.equal(fs.existsSync(embFile) ? fs.readFileSync(embFile, "utf8") : undefined, embeddingFileBefore)

    const appliedRescope = runProcess([
      "rescope", rescopeTarget.id, "--scope", "global", "--yes", "--all", "--project", projectB, "--json",
    ], { env })
    const appliedSupersede = runProcess([
      "supersede", supersedeSuccessor.id, supersedeOld.id, "--all", "--project", projectB, "--json",
    ], { env })
    const appliedReplace = runProcess([
      "replace", replaceOld.id, "--text", "Explicit all replacement apply", "--all", "--project", projectB, "--json",
    ], { env })
    for (const [command, result] of Object.entries({ appliedRescope, appliedSupersede, appliedReplace })) {
      assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout}`)
      assert.equal(JSON.parse(result.stdout).ok, true, command)
    }

    const rescopePayload = JSON.parse(appliedRescope.stdout)
    const supersedePayload = JSON.parse(appliedSupersede.stdout)
    const replacePayload = JSON.parse(appliedReplace.stdout)
    assert.equal(rescopePayload.data.proposed.scope.type, "global")
    assert.equal(supersedePayload.data.successor.id, supersedeSuccessor.id)
    assert.equal(supersedePayload.data.superseded[0].id, supersedeOld.id)
    assert.equal(replacePayload.data.successor.text, "Explicit all replacement apply")

    const afterMaintenance = JSON.parse(run(["list", "--all", "--project", projectB, "--json"], env)).data.memories as MemoryRecord[]
    assert.equal(afterMaintenance.find((memory) => memory.id === rescopeTarget.id)?.scope.type, "global")
    assert.equal(afterMaintenance.find((memory) => memory.id === supersedeOld.id)?.revision?.supersededBy, supersedeSuccessor.id)
    assert.equal(afterMaintenance.find((memory) => memory.id === replaceOld.id)?.revision?.supersededBy, replacePayload.data.successor.id)
    assert.equal(afterMaintenance.find((memory) => memory.id === replacePayload.data.successor.id)?.text, "Explicit all replacement apply")
  })

  it("init --project-local creates project storage and project saves use it", () => {
    const project = tempDir()
    const home = tempDir()
    const init = runProcess(["init", "--project-local", "--project", project], { env: { HOME: home } })

    assert.equal(init.status, 0)
    assert.match(init.stdout, /Initialized project-local Memory Lane storage/)
    assert.match(init.stdout, /MEMORY_LANE_FILE=/)
    assert.ok(fs.existsSync(path.join(project, ".memory-lane", "memory.jsonl")))
    assert.ok(fs.existsSync(path.join(project, ".memory-lane", "embeddings.jsonl")))
    assert.ok(fs.existsSync(path.join(project, ".memory-lane", "config.json")))

    const saved = runProcess(["save", "project-local memory", "--project", project, "--category", "project"], { env: { HOME: home } })

    assert.equal(saved.status, 0)
    assert.ok(fs.readFileSync(path.join(project, ".memory-lane", "memory.jsonl"), "utf8").includes("project-local memory"))
    assert.equal(fs.existsSync(path.join(home, ".memory-lane", "memory.jsonl")), false)
  })

  it("defaults new project scoped writes project-local and preferences home-side", () => {
    const project = tempDir()
    const home = tempDir()

    const projectSaved = runProcess(["save", "project default local memory", "--project", project, "--category", "project", "--status", "approved"], { env: { HOME: home } })
    const preferenceSaved = runProcess(["save", "always answer crisply", "--project", project, "--category", "preference", "--status", "approved"], { env: { HOME: home } })

    assert.equal(projectSaved.status, 0, projectSaved.stderr)
    assert.equal(preferenceSaved.status, 0, preferenceSaved.stderr)
    assert.ok(fs.readFileSync(path.join(project, ".memory-lane", "memory.jsonl"), "utf8").includes("project default local memory"))
    assert.ok(fs.readFileSync(path.join(project, ".gitignore"), "utf8").includes(".memory-lane/"))
    assert.ok(fs.readFileSync(path.join(home, ".memory-lane", "memory.jsonl"), "utf8").includes("always answer crisply"))
    assert.equal(fs.readFileSync(path.join(home, ".memory-lane", "memory.jsonl"), "utf8").includes("project default local memory"), false)

    const listed = runProcess(["list", "--json", "--project", project], { env: { HOME: home } })
    assert.equal(listed.status, 0, listed.stderr)
    const payload = JSON.parse(listed.stdout)
    assert.deepEqual(payload.data.memories.map((memory: MemoryRecord) => memory.text).sort(), ["always answer crisply", "project default local memory"])
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

  it("reports legacy home-stored project memories in status doctor and dry-run without creating project files", () => {
    const project = tempDir()
    const home = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "legacy-scope" }), "utf8")
    const homeStore = path.join(home, ".memory-lane")
    fs.mkdirSync(homeStore, { recursive: true })
    const memoryFile = path.join(homeStore, "memory.jsonl")
    const embeddingFile = path.join(homeStore, "embeddings.jsonl")
    writeMemoryRecords(memoryFile, [
      { id: "legacy-approved", text: "Legacy approved home project memory", category: "project", scope: { type: "project", key: "legacy-scope" }, status: "approved", source: "manual", kind: "project_fact", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" },
      { id: "legacy-pending", text: "Legacy pending home project memory", category: "project", scope: { type: "project", key: "legacy-scope" }, status: "pending", source: "manual", kind: "project_fact", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
      { id: "other", text: "Other project memory", category: "project", scope: { type: "project", key: "other-scope" }, status: "approved", source: "manual", kind: "project_fact", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-04T00:00:00.000Z" },
    ] as MemoryRecord[])
    fs.writeFileSync(embeddingFile, JSON.stringify({ memoryId: "legacy-approved", memoryUpdatedAt: "2026-01-03T00:00:00.000Z", contentHash: "hash", profileName: "default", model: "test", dimensions: 1, vector: [1], createdAt: "2026-01-03T00:00:00.000Z" }) + "\n", "utf8")
    const beforeMemory = fs.readFileSync(memoryFile, "utf8")
    const beforeEmbedding = fs.readFileSync(embeddingFile, "utf8")

    const status = runProcess(["status", "--json", "--project", project], { env: { HOME: home } })
    const doctor = runProcess(["doctor", "--json", "--project", project], { env: { HOME: home } })
    const dryRun = runProcess(["migrate", "project-local", "--dry-run", "--json", "--project", project], { env: { HOME: home } })

    assert.equal(status.status, 0, status.stderr)
    assert.equal(doctor.status, 0, doctor.stderr)
    assert.equal(dryRun.status, 0, dryRun.stderr)
    const statusReport = JSON.parse(status.stdout).data.legacyProjectMemories
    const doctorReport = JSON.parse(doctor.stdout).data.legacyProjectMemories
    const dryRunReport = JSON.parse(dryRun.stdout).data.legacyProjectMemories
    assert.equal(statusReport.totalLegacyCandidateCount, 2)
    assert.equal(statusReport.approvedLegacyCandidateCount, 1)
    assert.equal(statusReport.pendingLegacyCandidateCount, 1)
    assert.equal(statusReport.hazards.homeSideEmbeddings, 1)
    assert.deepEqual(statusReport.samples.map((sample: { id: string }) => sample.id), ["legacy-approved", "legacy-pending"])
    assert.equal(doctorReport.totalLegacyCandidateCount, 2)
    assert.equal(dryRunReport.totalLegacyCandidateCount, 2)
    assert.equal(fs.existsSync(path.join(project, ".memory-lane")), false)
    assert.equal(fs.existsSync(path.join(project, ".gitignore")), false)
    assert.equal(fs.readFileSync(memoryFile, "utf8"), beforeMemory)
    assert.equal(fs.readFileSync(embeddingFile, "utf8"), beforeEmbedding)
  })

  it("requires dry-run for project-local migration and treats explicit storage as not applicable", () => {
    const project = tempDir()
    const home = tempDir()
    const explicitDir = tempDir()
    const env = {
      HOME: home,
      MEMORY_LANE_FILE: path.join(explicitDir, "memory.jsonl"),
      MEMORY_LANE_EMBEDDINGS_FILE: path.join(explicitDir, "embeddings.jsonl"),
      MEMORY_LANE_CONFIG: path.join(explicitDir, "config.json"),
    }

    const missingDryRun = runProcess(["migrate", "project-local", "--project", project], { env })
    const planPath = path.join(tempDir(), "not-applicable-plan.json")
    const dryRun = runProcess(["migrate", "project-local", "--dry-run", "--json", "--project", project], { env })
    const dryRunWritePlan = runProcess(["migrate", "project-local", "--dry-run", "--write-plan", planPath, "--json", "--project", project], { env })

    assert.notEqual(missingDryRun.status, 0)
    assert.match(missingDryRun.stdout + missingDryRun.stderr, /requires an explicit reviewed plan.*dry-run/u)
    assert.equal(dryRun.status, 0, dryRun.stderr)
    assert.equal(dryRunWritePlan.status, 0, dryRunWritePlan.stderr)
    const report = JSON.parse(dryRun.stdout).data.legacyProjectMemories
    const writePlanReport = JSON.parse(dryRunWritePlan.stdout).data.legacyProjectMemories
    assert.equal(report.status, "not-applicable")
    assert.equal(report.notApplicableReason, "explicit-storage-env")
    assert.equal(writePlanReport.status, "not-applicable")
    assert.equal(writePlanReport.migrationPlan, undefined)
    assert.equal(fs.existsSync(planPath), false)
    assert.equal(fs.existsSync(path.join(project, ".memory-lane")), false)
  })

  it("writes and applies a reviewed project-local migration plan", () => {
    const project = tempDir()
    const home = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "migration-scope" }), "utf8")
    const homeStore = path.join(home, ".memory-lane")
    fs.mkdirSync(homeStore, { recursive: true })
    const memoryFile = path.join(homeStore, "memory.jsonl")
    writeMemoryRecords(memoryFile, [
      { id: "legacy-approved", text: "Legacy approved home project memory", category: "project", scope: { type: "project", key: "migration-scope" }, status: "approved", source: "manual", kind: "project_fact", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" },
      { id: "legacy-pending", text: "Legacy pending home project memory", category: "project", scope: { type: "project", key: "migration-scope" }, status: "pending", source: "manual", kind: "project_fact", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
    ] as MemoryRecord[])
    fs.writeFileSync(path.join(homeStore, "embeddings.jsonl"), "", "utf8")
    const planPath = path.join(tempDir(), "migration-plan.json")

    const plan = runProcess(["migrate", "project-local", "--dry-run", "--write-plan", planPath, "--project", project], { env: { HOME: home } })
    const applyWithoutYes = runProcess(["migrate", "project-local", "--apply-plan", planPath], { env: { HOME: home } })
    const applyJsonWithoutYes = runProcess(["migrate", "project-local", "--apply-plan", planPath, "--json"], { env: { HOME: home } })
    const explicitDir = tempDir()
    const explicitApply = runProcess(["migrate", "project-local", "--apply-plan", planPath, "--yes"], { env: { HOME: home, MEMORY_LANE_FILE: path.join(explicitDir, "memory.jsonl"), MEMORY_LANE_EMBEDDINGS_FILE: path.join(explicitDir, "embeddings.jsonl"), MEMORY_LANE_CONFIG: path.join(explicitDir, "config.json") } })
    const apply = runProcess(["migrate", "project-local", "--apply-plan", planPath, "--yes"], { env: { HOME: home } })
    const status = runProcess(["status", "--json", "--project", project], { env: { HOME: home } })

    assert.equal(plan.status, 0, plan.stderr)
    assert.ok(fs.existsSync(planPath))
    assert.match(plan.stdout, /Warning: the plan file may contain memory text/u)
    assert.notEqual(applyWithoutYes.status, 0)
    assert.match(applyWithoutYes.stdout + applyWithoutYes.stderr, /requires --yes/u)
    assert.match(applyWithoutYes.stdout, /2 active home-stored candidate\(s\) for project migration-scope/u)
    assert.doesNotMatch(applyWithoutYes.stdout, /Wrote review plan/u)
    assert.notEqual(applyJsonWithoutYes.status, 0)
    const applyJsonPreview = JSON.parse(applyJsonWithoutYes.stdout)
    assert.equal(applyJsonPreview.ok, false)
    assert.match(applyJsonPreview.error, /requires --yes/u)
    assert.equal(applyJsonPreview.data.legacyProjectMemories.totalLegacyCandidateCount, 2)
    assert.notEqual(explicitApply.status, 0)
    assert.match(explicitApply.stdout + explicitApply.stderr, /not applicable|Project-local migration requires/u)
    assert.equal(apply.status, 0, apply.stderr)
    assert.match(apply.stdout, /migrated: 2/u)
    const projectMemory = fs.readFileSync(path.join(project, ".memory-lane", "memory.jsonl"), "utf8")
    assert.ok(projectMemory.includes("Legacy approved home project memory"))
    assert.ok(projectMemory.includes("Legacy pending home project memory"))
    assert.equal(projectMemory.includes('"status":"pending"'), true)
    const homeMemory = fs.readFileSync(memoryFile, "utf8")
    assert.ok(homeMemory.includes("Migrated to project-local storage."))
    assert.equal(JSON.parse(status.stdout).data.legacyProjectMemories.totalLegacyCandidateCount, 0)
  })

  it("rejects missing or malformed migration plan files before applying", () => {
    const project = tempDir()
    const home = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "migration-scope" }), "utf8")
    const homeStore = path.join(home, ".memory-lane")
    fs.mkdirSync(homeStore, { recursive: true })
    const memoryFile = path.join(homeStore, "memory.jsonl")
    writeMemoryRecords(memoryFile, [
      { id: "legacy-approved", text: "Legacy approved home project memory", category: "project", scope: { type: "project", key: "migration-scope" }, status: "approved", source: "manual", kind: "project_fact", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" },
    ] as MemoryRecord[])
    fs.writeFileSync(path.join(homeStore, "embeddings.jsonl"), "", "utf8")
    const beforeMemory = fs.readFileSync(memoryFile, "utf8")

    const missingPath = path.join(tempDir(), "does-not-exist.json")
    const missing = runProcess(["migrate", "project-local", "--apply-plan", missingPath, "--yes"], { env: { HOME: home } })
    assert.notEqual(missing.status, 0)
    assert.match(missing.stdout + missing.stderr, /Invalid project-local migration plan file/u)

    const malformedPath = path.join(tempDir(), "malformed-plan.json")
    fs.writeFileSync(malformedPath, "{ not valid json ", "utf8")
    const malformed = runProcess(["migrate", "project-local", "--apply-plan", malformedPath, "--yes"], { env: { HOME: home } })
    assert.notEqual(malformed.status, 0)
    assert.match(malformed.stdout + malformed.stderr, /Invalid project-local migration plan file/u)

    const wrappedSummaryPath = path.join(tempDir(), "wrapped-summary.json")
    fs.writeFileSync(wrappedSummaryPath, JSON.stringify({ ok: true, data: { legacyProjectMemories: { migrationPlan: { version: 1 } } } }), "utf8")
    const wrappedSummary = runProcess(["migrate", "project-local", "--apply-plan", wrappedSummaryPath, "--yes"], { env: { HOME: home } })
    assert.notEqual(wrappedSummary.status, 0)
    assert.match(wrappedSummary.stdout + wrappedSummary.stderr, /Invalid project-local migration plan file/u)

    assert.equal(fs.readFileSync(memoryFile, "utf8"), beforeMemory)
    assert.equal(fs.existsSync(path.join(project, ".memory-lane")), false)
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

  it("review --suspect-meta --include-approved needs --all for cross-project suspects", () => {
    const projectA = tempDir()
    const projectB = tempDir()
    fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "cli-suspect-project-a" }))
    fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "cli-suspect-project-b" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const projectAText = "Task: You are a delegated subagent running from a fork of the parent session. SECRET approved suspect from project A."
    const projectBText = "Task: You are a delegated subagent running from a fork of the parent session. Visible approved suspect from project B."
    run(["save", projectAText, "--status", "approved", "--category", "project", "--scope", "project", "--project", projectA], env)
    run(["save", projectBText, "--status", "approved", "--category", "project", "--scope", "project", "--project", projectB], env)

    const scopedOutput = run(["review", "--suspect-meta", "--include-approved", "--project", projectB, "--json"], env)
    const scoped = JSON.parse(scopedOutput)
    assert.equal(scoped.ok, true)
    assert.equal(scoped.meta.projectScope, "cli-suspect-project-b")
    assert.equal(scoped.meta.count, 1)
    assert.deepEqual(scoped.data.memories.map((memory: MemoryRecord) => memory.text), [projectBText])
    assert.doesNotMatch(scopedOutput, /SECRET approved suspect/u)

    const all = JSON.parse(run(["review", "--suspect-meta", "--include-approved", "--all", "--project", projectB, "--json"], env))
    assert.equal(all.ok, true)
    assert.equal(all.meta.projectScope, "cli-suspect-project-b")
    assert.equal(all.meta.count, 2)
    assert.deepEqual(all.data.memories.map((memory: MemoryRecord) => memory.text).sort(), [projectAText, projectBText].sort())
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

  it("review human output marks likely operational summary chatter", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }
    const engine = new MemoryEngine({ memoryPath: memFile, embeddingsPath: embFile, configPath: cfgFile })
    engine.save({
      text: "## Session Summary\n\n- Delegated subagent completed task 3 only.\n- Acceptance finalization compared the current work to the acceptance contract.",
      category: "project",
      scopeType: "project",
      status: "pending",
      source: "session-summary",
      kind: "session_summary",
    })

    const output = run(["review"], env)

    assert.match(output, /review hint: likely operational chatter/iu)
    assert.match(output, /delegated-subagent/iu)
    assert.match(output, /consider rejecting/iu)
  })

  it("review json includes reviewHygiene metadata for likely operational summary chatter", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const engine = new MemoryEngine({ memoryPath: memFile, embeddingsPath: embFile, configPath: cfgFile })
    engine.save({
      text: "## Session Summary\n\n- Delegated subagent completed task 3 only.\n- Report status as APPROVED.",
      category: "project",
      scopeType: "project",
      status: "pending",
      source: "session-summary",
      kind: "session_summary",
    })

    const payload = JSON.parse(run(["review", "--json"], env))
    const memory = payload.data.memories[0]

    assert.equal(memory.reviewHygiene.operationalChatter, true)
    assert.equal(memory.reviewHygiene.suggestedAction, "consider-rejecting")
    assert.ok(memory.reviewHygiene.reasons.includes("delegated-subagent"))
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

    const output = run(["review", "--all"], env)

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

    const output = run(["review", "--all", "--kind", "session_summary", "--source", "session-summary", "--provenance", "pi/session_end"], env)

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

    const payload = JSON.parse(run(["review", "--all", "--kind", "session_summary", "--source", "session-summary", "--provenance", "pi/session_end", "--json"], env))

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

  it("route --json classifies broad next-work prompts", () => {
    const output = runProcess(["route", "--prompt", "what's the next item we should work on and what's its scope?", "--json"])
    assert.equal(output.status, 0, output.stderr)
    const parsed = JSON.parse(output.stdout)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.data.route.route, "continuity")
    assert.equal(parsed.data.route.intent.family, "next-work")
  })

  it("route --json accepts literal true as prompt value", () => {
    const output = runProcess(["route", "--prompt", "true", "--json"])
    assert.equal(output.status, 0, output.stderr)
    const parsed = JSON.parse(output.stdout)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.data.route.route, "ordinary")
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
      { id: "stale-continuity", text: "SECRET stale continuity body", category: "project", scope: { type: "project", key: "cli-continuity-project" }, status: "approved", source: "manual", kind: "project_fact", createdAt: "2026-06-17T08:00:00.000Z", updatedAt: "2026-06-17T08:00:00.000Z", freshness: { staleAfterDays: 1, capturedAt: "2026-06-17T08:00:00.000Z" } },
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
    assert.ok(parsed.data.warnings.some((item: any) => item.code === "freshness-advisory"))
    assert.match(parsed.data.suggestedActions.join("\n"), /memory-lane update stale-continuity --text <updated-memory-text> --dry-run/u)
    assert.equal(parsed.data.workstreamDiscovery, undefined)
    assert.doesNotMatch(output.stdout, /SECRET stale continuity body/u)
  })

  it("continuity --json includes latest progress and operating guidance alongside legacy latest approved", () => {
    const dir = tempDir()
    const project = path.join(dir, "project")
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity-typing" }))
    const mem = path.join(dir, "memory.jsonl")
    const env = { MEMORY_LANE_FILE: mem, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json"), NO_COLOR: "1" }
    writeMemoryRecords(mem, [
      { id: "release", text: "Released v0.2.30 and Pi Slice D installed-artifact dogfood passed.", category: "project", scope: { type: "project", key: "cli-continuity-typing" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-25T10:00:00.000Z", updatedAt: "2026-06-25T10:00:00.000Z" },
      { id: "correction", text: "Workflow correction: use gh pr edit --body-file for GitHub PR Markdown.", category: "project", scope: { type: "project", key: "cli-continuity-typing" }, status: "approved", source: "manual", kind: "correction", createdAt: "2026-06-25T11:00:00.000Z", updatedAt: "2026-06-25T11:00:00.000Z" },
    ] as MemoryRecord[])

    const jsonOutput = runProcess(["continuity", "--json"], { env, cwd: project })
    assert.equal(jsonOutput.status, 0, jsonOutput.stderr)
    const parsed = JSON.parse(jsonOutput.stdout)
    assert.equal(parsed.data.latestApproved.project.id, "correction")
    assert.equal(parsed.data.latestProgress.id, "release")
    assert.deepEqual(parsed.data.operatingGuidance.map((item: any) => item.id), ["correction"])
    assert.equal(parsed.data.roleSummary, undefined)

    const humanOutput = runProcess(["continuity"], { env, cwd: project })
    assert.equal(humanOutput.status, 0, humanOutput.stderr)
    assert.match(humanOutput.stdout, /Latest progress/u)
    assert.match(humanOutput.stdout, /\[release\]/u)
    assert.equal(humanOutput.stdout.match(/\[correction\]/gu)?.length, 1)
    assert.doesNotMatch(humanOutput.stdout, /Operating guidance/u)
    assert.match(humanOutput.stdout, /Latest approved/u)
  })

  it("continuity human output dedupes continuity sections and promotes actionable warnings", () => {
    const dir = tempDir()
    const project = path.join(dir, "project")
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity-dedupe" }))
    const mem = path.join(dir, "memory.jsonl")
    const env = { MEMORY_LANE_FILE: mem, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json"), NO_COLOR: "1" }
    writeMemoryRecords(mem, [
      { id: "release", text: "Released v0.2.45 with continuity dogfood complete.", category: "project", scope: { type: "project", key: "cli-continuity-dedupe" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-26T12:00:00.000Z", updatedAt: "2026-06-26T12:00:00.000Z" },
      { id: "project-loop", text: "Project loop workflow: run review before implementation.", category: "project", scope: { type: "project", key: "cli-continuity-dedupe" }, status: "approved", source: "manual", kind: "procedure", createdAt: "2026-06-26T11:00:00.000Z", updatedAt: "2026-06-26T11:00:00.000Z" },
      { id: "global-loop", text: "Global project loop workflow preference: run review before implementation.", category: "preference", scope: { type: "global" }, status: "approved", source: "manual", kind: "workflow_rule", createdAt: "2026-06-26T10:30:00.000Z", updatedAt: "2026-06-26T10:30:00.000Z" },
    ] as MemoryRecord[])

    const output = runProcess(["continuity"], { env, cwd: project })
    assert.equal(output.status, 0, output.stderr)
    assert.match(output.stdout, /Latest progress/u)
    assert.equal(output.stdout.match(/\[release\]/gu)?.length, 1)
    assert.doesNotMatch(output.stdout, /Latest approved\n\s+\[release\]/u)
    assert.equal(output.stdout.match(/\[global-loop\]/gu)?.length, 1)
    assert.doesNotMatch(output.stdout, /Latest approved \(global\)\n\s+\[global-loop\]/u)
    assert.match(output.stdout, /Action required before applying continuity guidance/u)
    assert.match(output.stdout, /memory-lane agreements --area project-loop --json/u)
    assert.equal((output.stdout.match(/memory-lane agreements --area project-loop --json/gu) ?? []).length, 1)
    assert.ok(output.stdout.indexOf("Action required before applying continuity guidance") < output.stdout.indexOf("Operating guidance"))
  })

  it("continuity human output renders info warnings as notes and reports omitted warnings", () => {
    const model = {
      projectScope: "cli-info-warning",
      status: { visibleApprovedCount: 0, pendingContinuityCount: 0 },
      latestApproved: {},
      latestProgress: undefined,
      operatingGuidance: [],
      pendingContinuity: [],
      warnings: [
        { code: "mcp-explicit-tools-only", severity: "info", message: "MCP exposes explicit tools only." },
        { code: "operating-agreement-overlap", severity: "review", message: "Overlap.", suggestedActions: ["memory-lane agreements --area project-loop --json"] },
        { code: "scope-hygiene-candidate", severity: "review", message: "Scope." },
        { code: "mcp-explicit-tools-only", severity: "info", message: "Second MCP note." },
      ],
      answerGuidance: [],
      suggestedActions: ["memory-lane continuity --json", "memory-lane agreements --area project-loop --json"],
      freshness: { visibleApprovedCount: 0, newerApprovedCount: 0, newerProjectApprovedCount: 0, newerGlobalApprovedCount: 0, newerGlobalPreferenceCount: 0, advisory: { expiredCount: 0, staleCount: 0, expired: [], stale: [] } },
    } as unknown as ContinuityReadModel

    const output = formatContinuityReadModel(model, false)

    assert.match(output, /Action required before applying continuity guidance/u)
    assert.match(output, /Continuity notes/u)
    assert.match(output, /1 more warnings omitted/u)
    assert.equal((output.match(/memory-lane agreements --area project-loop --json/gu) ?? []).length, 1)
  })

  it("continuity human output includes truncated operating guidance inspection instruction", () => {
    const dir = tempDir()
    const project = path.join(dir, "project")
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity-truncated-guidance" }))
    const mem = path.join(dir, "memory.jsonl")
    const env = { MEMORY_LANE_FILE: mem, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json"), NO_COLOR: "1" }
    const filler = "Review workflow requires Opus before design approval and before PR. ".repeat(6)
    writeMemoryRecords(mem, [
      { id: "release", text: "Released v0.2.32 and Pi continuity dogfood passed.", category: "project", scope: { type: "project", key: "cli-continuity-truncated-guidance" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-26T10:00:00.000Z", updatedAt: "2026-06-26T10:00:00.000Z" },
      { id: "opus001", text: `${filler}Do not summon Opus 4.8 through subagents; invoke it with claude -p --model=claude-opus-4-8 and request high-effort thinking in the prompt.`, category: "preference", scope: { type: "global" }, status: "approved", source: "manual", kind: "workflow_rule", createdAt: "2026-06-26T11:00:00.000Z", updatedAt: "2026-06-26T11:00:00.000Z" },
    ] as MemoryRecord[])

    const output = runProcess(["continuity"], { env, cwd: project })
    assert.equal(output.status, 0, output.stderr)
    assert.match(output.stdout, /Operating guidance/u)
    assert.match(output.stdout, /opus001/u)
    assert.doesNotMatch(output.stdout, /claude -p --model=claude-opus-4-8/u)
    assert.match(output.stdout, /memory-lane show opus001/u)
  })

  it("continuity --query --json returns workstream discovery candidates", () => {
    const dir = tempDir()
    const project = path.join(dir, "project")
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-discovery-json" }))
    const mem = path.join(dir, "memory.jsonl")
    const env = { MEMORY_LANE_FILE: mem, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json") }
    writeMemoryRecords(mem, [
      { id: "checkpoint", text: "Merged PR #39 from branch docs/phase-21-workstream-discovery at commit 84692b9 for workstream discovery implementation.", category: "project", scope: { type: "project", key: "cli-discovery-json" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z" },
      { id: "global", text: "Global workstream discovery note", category: "project", scope: { type: "global" }, status: "approved", source: "manual", kind: "project_fact", createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z" },
    ] as MemoryRecord[])

    const output = runProcess(["continuity", "--query", "where was workstream discovery implemented", "--json"], { env, cwd: project })
    assert.equal(output.status, 0, output.stderr)
    const parsed = JSON.parse(output.stdout)
    assert.equal(parsed.data.workstreamDiscovery.query, "where was workstream discovery implemented")
    assert.deepEqual(parsed.data.workstreamDiscovery.candidates.map((candidate: any) => candidate.id), ["checkpoint"])
    assert.deepEqual(parsed.data.workstreamDiscovery.candidates[0].references.pullRequests, ["#39"])
    assert.equal(parsed.data.workstreamDiscovery.candidates[0].references.branches[0], "docs/phase-21-workstream-discovery")
  })

  it("continuity --query human output includes compact workstream discovery", () => {
    const dir = tempDir()
    const project = path.join(dir, "project")
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-discovery-human" }))
    const mem = path.join(dir, "memory.jsonl")
    const env = { MEMORY_LANE_FILE: mem, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json"), NO_COLOR: "1" }
    writeMemoryRecords(mem, [
      { id: "checkpoint", text: "Merged PR #39 from branch docs/phase-21-workstream-discovery at commit 84692b9 for workstream discovery implementation. Long private body should stay bounded in preview only.", category: "project", scope: { type: "project", key: "cli-discovery-human" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z" },
    ] as MemoryRecord[])

    const output = runProcess(["continuity", "--query", "where was workstream discovery implemented"], { env, cwd: project })
    assert.equal(output.status, 0, output.stderr)
    assert.match(output.stdout, /Workstream discovery/u)
    assert.match(output.stdout, /\[checkpoint\]/u)
    assert.match(output.stdout, /topic:workstream/u)
    assert.match(output.stdout, /PR #39/u)
    assert.match(output.stdout, /branch docs\/phase-21-workstream-discovery/u)
    assert.match(output.stdout, /commit 84692b9/u)
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
      { id: "stale-human", text: "SECRET stale human continuity body", category: "project", scope: { type: "project", key: "cli-continuity-human" }, status: "approved", source: "manual", kind: "project_fact", createdAt: "2026-06-17T08:00:00.000Z", updatedAt: "2026-06-17T08:00:00.000Z", freshness: { staleAfterDays: 1, capturedAt: "2026-06-17T08:00:00.000Z" } },
      { id: "pending", text: "## Session Summary\nNext action: inspect review queue.", category: "project", scope: { type: "project", key: "cli-continuity-human" }, status: "pending", source: "session-summary", kind: "session_summary", createdAt: "2026-06-18T09:00:00.000Z", updatedAt: "2026-06-18T09:00:00.000Z" },
    ] as MemoryRecord[])

    const output = runProcess(["continuity"], { env, cwd: project })
    assert.equal(output.status, 0, output.stderr)
    assert.match(output.stdout, /Memory Lane Continuity/u)
    assert.match(output.stdout, /Project: cli-continuity-human/u)
    assert.match(output.stdout, /Latest progress/u)
    assert.doesNotMatch(output.stdout, /Latest approved\n\s+\[approved\]/u)
    assert.match(output.stdout, /Pending continuity/u)
    assert.doesNotMatch(output.stdout, /Review-mode handoff proposal/u)
    assert.match(output.stdout, /freshness-advisory/u)
    assert.match(output.stdout, /Freshness advisory actions \(manual dry-run\):/u)
    assert.match(output.stdout, /memory-lane update stale-human --text <updated-memory-text> --dry-run/u)
    assert.equal((output.stdout.match(/memory-lane update stale-human/gu) ?? []).length, 1)
    assert.match(output.stdout, /memory-lane review --json/u)
    assert.doesNotMatch(output.stdout, /SECRET stale human continuity body/u)
  })

  it("continuity surfaces review-mode handoff proposal without changing manual or automatic", () => {
    const dir = tempDir()
    const project = path.join(dir, "project")
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-review-proposal" }))
    const mem = path.join(dir, "memory.jsonl")
    const config = path.join(dir, "config.json")
    const env = { MEMORY_LANE_FILE: mem, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"), MEMORY_LANE_CONFIG: config, NO_COLOR: "1" }
    writeMemoryRecords(mem, [
      { id: "approved", text: "Approved project checkpoint", category: "project", scope: { type: "project", key: "cli-review-proposal" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z" },
      { id: "pending-review", text: "## Session Summary\nNext action: inspect review-mode handoff proposal.", category: "project", scope: { type: "project", key: "cli-review-proposal" }, status: "pending", source: "session-summary", kind: "session_summary", createdAt: "2026-06-18T09:00:00.000Z", updatedAt: "2026-06-18T09:00:00.000Z" },
    ] as MemoryRecord[])

    const manualJson = JSON.parse(runProcess(["continuity", "--json"], { env, cwd: project }).stdout)
    assert.equal(manualJson.data.handoffProposal, undefined)

    fs.writeFileSync(config, JSON.stringify({ memory: { handoffMode: "review" } }), "utf8")
    const human = runProcess(["continuity"], { env, cwd: project })
    assert.equal(human.status, 0, human.stderr)
    assert.match(human.stdout, /Review-mode handoff proposal/u)
    assert.match(human.stdout, /Pending candidates: 1/u)
    assert.match(human.stdout, /\[pending-review\] ## Session Summary Next action: inspect review-mode handoff proposal\./u)
    assert.match(human.stdout, /memory-lane review --json/u)
    assert.match(human.stdout, /memory-lane approve pending-review/u)

    const reviewJson = JSON.parse(runProcess(["continuity", "--json"], { env, cwd: project }).stdout)
    assert.equal(reviewJson.data.handoffProposal.mode, "review")
    assert.equal(reviewJson.data.handoffProposal.pendingCount, 1)
    assert.equal(reviewJson.data.handoffProposal.items[0].id, "pending-review")
    assert.ok(reviewJson.data.suggestedActions.includes("memory-lane approve pending-review"))

    const doctorJson = JSON.parse(runProcess(["doctor", "--json"], { env, cwd: project }).stdout)
    assert.equal(doctorJson.data.handoffProposal, undefined)

    fs.writeFileSync(config, JSON.stringify({ memory: { handoffMode: "automatic" } }), "utf8")
    const automaticJson = JSON.parse(runProcess(["continuity", "--json"], { env, cwd: project }).stdout)
    assert.equal(automaticJson.data.handoffProposal, undefined)
  })

  it("continuity human freshness advisory actions are bounded and omitted actions stay out of generic suggestions", () => {
    const dir = tempDir()
    const project = path.join(dir, "project")
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity-bounds" }))
    const mem = path.join(dir, "memory.jsonl")
    const env = { MEMORY_LANE_FILE: mem, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json"), NO_COLOR: "1" }
    writeMemoryRecords(mem, Array.from({ length: 4 }, (_, index) => ({
      id: `expired-continuity-${index}`,
      text: `Expired continuity body ${index}`,
      category: "project" as const,
      scope: { type: "project" as const, key: "cli-continuity-bounds" },
      status: "approved" as const,
      source: "manual" as const,
      kind: "project_fact" as const,
      createdAt: `2026-06-17T0${index}:00:00.000Z`,
      updatedAt: `2026-06-17T0${index}:00:00.000Z`,
      freshness: { expiresAt: "2026-06-18T00:00:00.000Z" },
    })))

    const output = runProcess(["continuity"], { env, cwd: project })

    assert.equal(output.status, 0, output.stderr)
    assert.match(output.stdout, /Freshness advisory actions \(manual dry-run\):/u)
    assert.match(output.stdout, /memory-lane update expired-continuity-3 --text <updated-memory-text> --dry-run/u)
    assert.match(output.stdout, /memory-lane supersede <new-id> expired-continuity-2 --dry-run/u)
    assert.match(output.stdout, /2 more stale\/expired advisory records omitted; use memory-lane status --json for full ids\./u)
    assert.doesNotMatch(output.stdout, /expired-continuity-1|expired-continuity-0/u)
  })

  it("continuity human output skips operating guidance already rendered elsewhere", () => {
    const model: ContinuityReadModel = {
      projectScope: "manual-model",
      generatedAt: "2026-06-22T00:00:00.000Z",
      status: { visibleApprovedCount: 2, pendingReviewCount: 0, pendingContinuityCount: 0 },
      latestApproved: { project: { id: "procedure", preview: "Run review before implementation." } },
      operatingGuidance: [
        { id: "procedure", preview: "Run review before implementation." },
        { id: "followup", preview: "Check CI before merge." },
      ],
      pendingContinuity: [],
      freshness: {
        projectScope: "manual-model",
        advisory: { referenceNow: "2026-06-22T00:00:00.000Z", withFreshnessCount: 0, currentCount: 0, staleCount: 0, expiredCount: 0, stale: [], expired: [] },
        visibleApprovedCount: 2,
        newerApprovedCount: 0,
        newerProjectApprovedCount: 0,
        newerGlobalApprovedCount: 0,
        newerGlobalPreferenceCount: 0,
        newerByKind: {},
        newerBySource: {},
        newerByProvenance: {},
        newestNewerApproved: [],
      },
      operatingAgreements: { projectScope: "manual-model", primaryCount: 0, relatedCandidateCount: 0, omittedPrimaryCount: 0, omittedRelatedCandidateCount: 0, workflowAreas: [], primary: [], relatedCandidates: [], notes: [] },
      continuityHints: { projectScope: "manual-model", hintCount: 0, hints: [], supersededVisible: [], operatingAgreementOverlaps: [], projectGlobalPreferenceOverlaps: [], scopeHygieneCandidates: [], suggestedActions: [], notes: [] },
      warnings: [],
      suggestedActions: [],
      answerGuidance: [],
      harnessGuidance: { summary: [], cli: [], mcp: [] },
      notes: [],
    }

    const output = formatContinuityReadModel(model, false)
    assert.equal(output.match(/\[procedure\]/gu)?.length, 1)
    assert.match(output, /\[followup\]/u)
  })

  it("continuity human output does not label non-freshness dry-run actions as freshness advisories", () => {
    const model: ContinuityReadModel = {
      projectScope: "manual-model",
      generatedAt: "2026-06-22T00:00:00.000Z",
      status: { visibleApprovedCount: 0, pendingReviewCount: 0, pendingContinuityCount: 0 },
      latestApproved: {},
      pendingContinuity: [],
      freshness: {
        projectScope: "manual-model",
        advisory: { referenceNow: "2026-06-22T00:00:00.000Z", withFreshnessCount: 0, currentCount: 0, staleCount: 0, expiredCount: 0, stale: [], expired: [] },
        visibleApprovedCount: 0,
        newerApprovedCount: 0,
        newerProjectApprovedCount: 0,
        newerGlobalApprovedCount: 0,
        newerGlobalPreferenceCount: 0,
        newerByKind: {},
        newerBySource: {},
        newerByProvenance: {},
        newestNewerApproved: [],
      },
      operatingAgreements: { projectScope: "manual-model", primaryCount: 0, relatedCandidateCount: 0, omittedPrimaryCount: 0, omittedRelatedCandidateCount: 0, workflowAreas: [], primary: [], relatedCandidates: [], notes: [] },
      continuityHints: { projectScope: "manual-model", hintCount: 0, hints: [], supersededVisible: [], operatingAgreementOverlaps: [], projectGlobalPreferenceOverlaps: [], scopeHygieneCandidates: [], suggestedActions: [], notes: [] },
      warnings: [],
      suggestedActions: ["memory-lane update unrelated --text <updated-memory-text> --dry-run"],
      answerGuidance: [],
      harnessGuidance: { summary: [], cli: [], mcp: [] },
      notes: [],
    }

    const output = formatContinuityReadModel(model, false)
    assert.doesNotMatch(output, /Freshness advisory actions/u)
    assert.match(output, /memory-lane update unrelated --text <updated-memory-text> --dry-run/u)
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

  it("read-only continuity commands do not require writable home storage", () => {
    const dir = tempDir()
    const home = path.join(dir, "home")
    const storage = path.join(home, ".memory-lane")
    const project = path.join(dir, "project")
    fs.mkdirSync(storage, { recursive: true })
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "readonly-home-project" }))
    writeMemoryRecords(path.join(storage, "memory.jsonl"), [
      { id: "approved", text: "Readonly home continuity checkpoint", category: "project", scope: { type: "project", key: "readonly-home-project" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z" },
    ] as MemoryRecord[])
    fs.writeFileSync(path.join(storage, "embeddings.jsonl"), "")
    fs.writeFileSync(path.join(storage, "config.json"), JSON.stringify({}), "utf8")
    fs.chmodSync(storage, 0o555)

    const env = { HOME: home, MEMORY_LANE_FILE: undefined, MEMORY_LANE_EMBEDDINGS_FILE: undefined, MEMORY_LANE_CONFIG: undefined }

    try {
      const status = runProcess(["status", "--json"], { env, cwd: project })
      assert.equal(status.status, 0, `status stderr=${status.stderr} stdout=${status.stdout}`)
      assert.doesNotMatch(status.stderr + status.stdout, /write-test|EPERM/u)
      assert.equal(JSON.parse(status.stdout).data.approvedMemories, 1)

      const continuity = runProcess(["continuity", "--json"], { env, cwd: project })
      assert.equal(continuity.status, 0, `continuity stderr=${continuity.stderr} stdout=${continuity.stdout}`)
      assert.doesNotMatch(continuity.stderr + continuity.stdout, /write-test|EPERM/u)
      assert.equal(JSON.parse(continuity.stdout).data.latestApproved.project.id, "approved")

      const dashboard = runProcess(["dashboard", "--json"], { env, cwd: project })
      assert.equal(dashboard.status, 0, `dashboard stderr=${dashboard.stderr} stdout=${dashboard.stdout}`)
      assert.doesNotMatch(dashboard.stderr + dashboard.stdout, /write-test|EPERM/u)
      assert.equal(JSON.parse(dashboard.stdout).data.counts.approved, 1)
    } finally {
      fs.chmodSync(storage, 0o755)
    }
  })

  it("read-only inspection commands do not auto-compact storage", () => {
    const dir = tempDir()
    const memoryFile = path.join(dir, "memory.jsonl")
    const records = [
      ...Array.from({ length: 70 }, (_, i) => ({ id: `approved-${i}`, text: `Approved ${i}`, category: "project", scope: { type: "global" }, status: "approved", source: "manual", createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z" })),
      ...Array.from({ length: 40 }, (_, i) => ({ id: `deleted-${i}`, text: `Deleted ${i}`, category: "project", scope: { type: "global" }, status: "deleted", source: "manual", createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z" })),
    ] as MemoryRecord[]
    writeMemoryRecords(memoryFile, records)
    const before = fs.readFileSync(memoryFile, "utf8")
    const env = { MEMORY_LANE_FILE: memoryFile, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json") }

    const status = runProcess(["status", "--json"], { env })

    assert.equal(status.status, 0, `status stderr=${status.stderr} stdout=${status.stdout}`)
    assert.equal(JSON.parse(status.stdout).data.approvedMemories, 70)
    assert.equal(fs.readFileSync(memoryFile, "utf8"), before)
  })

  it("read-only inspection commands do not auto-init project storage", () => {
    const dir = tempDir()
    const blockedHome = path.join(dir, "home-file")
    const project = path.join(dir, "project")
    fs.writeFileSync(blockedHome, "not a directory", "utf8")
    fs.mkdirSync(project)
    const env = { HOME: blockedHome, MEMORY_LANE_FILE: undefined, MEMORY_LANE_EMBEDDINGS_FILE: undefined, MEMORY_LANE_CONFIG: undefined }
    const commands = [
      ["recall", "nothing", "--json"],
      ["list", "--json"],
      ["search", "nothing", "--json"],
      ["review", "--json"],
      ["config", "show", "--json"],
      ["obsidian", "status", "--json"],
      ["mcp"],
    ]

    for (const args of commands) {
      const result = runProcess([...args, "--project", project], { env })
      assert.equal(result.status, 0, `${args[0]} stderr=${result.stderr} stdout=${result.stdout}`)
    }

    assert.equal(fs.existsSync(path.join(project, ".memory-lane")), false)
    assert.equal(fs.existsSync(path.join(project, ".gitignore")), false)
    assert.equal(fs.existsSync(path.join(project, ".memory-lane-scope")), false)
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
    assert.equal(status.data.continuityBaseline.projectScope, "cli-continuity-status")
    assert.equal(status.data.continuityBaseline.source, "none")
    assert.equal(status.data.continuityBaseline.readable, true)
    assert.match(status.data.continuityBaseline.stateFile, /continuity-baselines\.json$/u)
    assert.deepEqual(doctor.data.continuityBaseline, status.data.continuityBaseline)
    assert.doesNotMatch(JSON.stringify(status.data.continuityHints), /PRIVATE OLD LOOP TEXT|PRIVATE CURRENT LOOP TEXT|PRIVATE GLOBAL LOOP TEXT|PRIVATE GLOBAL PROJECT-LIKE TEXT/u)
    assert.doesNotMatch(JSON.stringify(doctor.data.continuityHints), /PRIVATE OLD LOOP TEXT|PRIVATE CURRENT LOOP TEXT|PRIVATE GLOBAL LOOP TEXT|PRIVATE GLOBAL PROJECT-LIKE TEXT/u)
    assert.doesNotMatch(JSON.stringify(status.data.continuityBaseline), /PRIVATE OLD LOOP TEXT|PRIVATE CURRENT LOOP TEXT|PRIVATE GLOBAL LOOP TEXT|PRIVATE GLOBAL PROJECT-LIKE TEXT/u)
    assert.doesNotMatch(JSON.stringify(doctor.data.continuityBaseline), /PRIVATE OLD LOOP TEXT|PRIVATE CURRENT LOOP TEXT|PRIVATE GLOBAL LOOP TEXT|PRIVATE GLOBAL PROJECT-LIKE TEXT/u)
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
    assert.equal(parsed.data.handoffMode, "manual")
    assert.equal(parsed.data.handoffModeBehaviorActive, true)
    assert.equal(parsed.data.handoffModeNote, "Current inspection-first behavior is active.")
    assert.equal(typeof parsed.data.integrations, "object")
    assert.equal(parsed.data.integrations.summary.mcpExplicitToolsOnly, true)

    const status = JSON.parse(run(["status", "--json"], env))
    assert.equal(status.data.handoffMode, "manual")
    assert.equal(status.data.handoffModeBehaviorActive, true)
    assert.equal(status.data.handoffModeNote, "Current inspection-first behavior is active.")
  })

  it("doctor human output renders configured review handoff mode", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }
    fs.writeFileSync(cfgFile, JSON.stringify({ memory: { handoffMode: "review" } }), "utf8")

    const humanDoctor = run(["doctor"], env)
    const doctorJson = JSON.parse(run(["doctor", "--json"], env))
    const statusJson = JSON.parse(run(["status", "--json"], env))

    assert.match(humanDoctor, /Handoff mode\n  mode: review\n  behavior active: yes\n  note: Review mode is active for read-only handoff proposals; approve pending memories before relying on them as handoff state\./u)
    assert.doesNotMatch(humanDoctor, /handoffModeBehaviorActive:/u)
    for (const payload of [doctorJson, statusJson]) {
      assert.equal(payload.data.handoffMode, "review")
      assert.equal(payload.data.handoffModeBehaviorActive, true)
      assert.equal(payload.data.handoffModeNote, "Review mode is active for read-only handoff proposals; approve pending memories before relying on them as handoff state.")
      assert.equal(payload.data.handoffProposal, undefined)
    }
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
    assert.equal(payload.data.freshness.advisory.staleCount, 1)
    assert.deepEqual(payload.data.freshness.advisory.stale[0].freshness.suggestedActions, ["memory-lane update old-project-approved --text <updated-memory-text> --dry-run"])
    const suggestedUpdate = runProcess(["update", "old-project-approved", "--text", "Updated old project approved", "--dry-run", "--json"], { env, cwd: project })
    assert.equal(suggestedUpdate.status, 0, suggestedUpdate.stderr)
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
      assert.match(output, /advisory: 0 expired, 1 stale/u)
      assert.match(output, /Freshness advisory actions \(manual dry-run\):/u)
      assert.match(output, /memory-lane update old-project-approved --text <updated-memory-text> --dry-run/u)
      assert.doesNotMatch(output, /memory-lane reject|memory-lane delete/u)
      assert.doesNotMatch(output, /\[object Object\]/u)
      assert.doesNotMatch(output, /APPROVED PRIVATE CLI FRESHNESS TEXT/u)
      assert.doesNotMatch(output, /PENDING PRIVATE CLI FRESHNESS TEXT/u)
    }
  })

  it("status human freshness advisory actions are bounded with text-free omitted record note", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-freshness-bounds" }))
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
      NO_COLOR: "1",
    }
    const records = Array.from({ length: 4 }, (_, index) => ({
      id: `expired-${index}`,
      text: `SECRET expired freshness ${index}`,
      category: "project" as const,
      scope: { type: "project" as const, key: "cli-freshness-bounds" },
      status: "approved" as const,
      source: "manual" as const,
      kind: "project_fact" as const,
      createdAt: `2026-06-17T0${index}:00:00.000Z`,
      updatedAt: `2026-06-17T0${index}:00:00.000Z`,
      freshness: { expiresAt: "2026-06-18T00:00:00.000Z" },
    }))
    writeMemoryRecords(memFile, records)

    const result = runProcess(["status", "--since", "2026-06-18T08:00:00.000Z"], { env, cwd: project })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Freshness advisory actions \(manual dry-run\):/u)
    assert.match(result.stdout, /memory-lane update expired-3 --text <updated-memory-text> --dry-run/u)
    assert.match(result.stdout, /memory-lane supersede <new-id> expired-2 --dry-run/u)
    assert.doesNotMatch(result.stdout, /expired-1|expired-0/u)
    assert.match(result.stdout, /2 more stale\/expired advisory records omitted; use memory-lane status --json for full ids\./u)
    assert.doesNotMatch(result.stdout, /SECRET expired freshness/u)
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
    assert.match(output, /Handoff mode/u)
    assert.match(output, /mode: manual/u)
    assert.match(output, /behavior active: yes/u)
    assert.match(output, /note: Current inspection-first behavior is active\./u)
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

  it("codex pre-compact accepts hook payload on stdin", () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ memory: { sessionEndSummary: { enabled: true } } }), "utf8")
    const result = runProcess(["codex", "pre-compact"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
      stdin: JSON.stringify({
        hook_event_name: "PreCompact",
        session_id: "session-1",
        turn_id: "turn-1",
        cwd: process.cwd(),
        transcript_path: null,
        model: "gpt-5-codex",
        trigger: "manual",
      }),
    })
    assert.equal(result.status, 0)
    assert.match(result.stdout, /requires memory\.sessionEndSummary\.baseUrl and model/)
  })

  it("pi unknown event returns usage error", () => {
    const result = runProcess(["pi", "unknown-event"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /Unknown Pi hook event/)
  })

  it("pi pre-compact accepts hook payload on stdin", () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ memory: { sessionEndSummary: { enabled: true } } }), "utf8")
    const result = runProcess(["pi", "pre-compact", "--json"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
      stdin: JSON.stringify({
        cwd: process.cwd(),
        session_id: "pi-session-1",
        turn_id: "pi-turn-1",
        trigger: "manual",
        messages: [{ role: "user", content: "Continue the Memory Lane Pi precompact fix." }],
      }),
    })
    assert.equal(result.status, 0)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.data.saved, 0)
    assert.match(parsed.data.message, /requires memory\.sessionEndSummary\.baseUrl and model/)
  })

  it("pi pre-compact saves pending summary with pi provenance and dedupes repeated turn", async () => {
    await withMockSummaryServer("- Decisions made: preserve generated Pi precompact continuity.", async (baseUrl, requests) => {
      fs.writeFileSync(cfgFile, JSON.stringify({
        memory: {
          sessionEndSummary: {
            enabled: true,
            baseUrl,
            model: "summary-model",
            requireConfirmation: false,
          },
        },
      }), "utf8")
      const env = {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      }
      const payload = JSON.stringify({
        cwd: process.cwd(),
        session_id: "pi-session-2",
        turn_id: "pi-turn-2",
        trigger: "auto",
        messages: [
          { role: "user", content: "Fix the generated Pi bridge precompact hook." },
          { role: "assistant", content: "Implemented the generated bridge hook." },
        ],
      })

      const first = await runProcessAsync(["pi", "pre-compact", "--json"], { env, stdin: payload })
      assert.equal(first.status, 0, first.stderr)
      assert.equal(JSON.parse(first.stdout).data.saved, 1)

      const second = await runProcessAsync(["pi", "pre-compact", "--json"], { env, stdin: payload })
      assert.equal(second.status, 0, second.stderr)
      assert.equal(JSON.parse(second.stdout).data.saved, 0)

      const review = JSON.parse(run(["review", "--json", "--provenance", "pi/pre_compact"], env))
      assert.equal(review.meta.count, 1)
      const memory = review.data.memories[0]
      assert.equal(memory.kind, "session_summary")
      assert.equal(memory.source, "session-summary")
      assert.equal(memory.status, "pending")
      assert.equal(memory.provenance.adapter, "pi")
      assert.equal(memory.provenance.lifecycleEvent, "pre_compact")
      assert.equal(memory.provenance.sessionId, "pi-session-2")
      assert.equal(memory.provenance.turnId, "pi-turn-2")
      assert.match(memory.text, /generated Pi precompact continuity/)
      assert.equal(requests.length, 1)
    })
  })

  it("pi pre-compact debug records metadata-only secret skips", async () => {
    await withMockSummaryServer("Session summary includes API_KEY=abcd1234.", async (baseUrl) => {
      const logPath = path.join(dir, "hooks-log.jsonl")
      fs.writeFileSync(cfgFile, JSON.stringify({
        memory: {
          sessionEndSummary: {
            enabled: true,
            baseUrl,
            model: "summary-model",
            requireConfirmation: false,
          },
        },
      }), "utf8")
      const engine = new MemoryEngine({
        memoryPath: memFile,
        embeddingsPath: embFile,
        configPath: cfgFile,
      })

      await runPiHookCommand("pre-compact", {
        engine,
        env: { MEMORY_LANE_HOOK_DEBUG: "1" },
        hookDebugLogPath: logPath,
        configPath: cfgFile,
        payloadText: JSON.stringify({
          cwd: process.cwd(),
          session_id: "pi-secret-session",
          turn_id: "pi-secret-turn",
          trigger: "auto",
          messages: [{ role: "user", content: "Summarize this session." }],
        }),
      })

      const logText = fs.readFileSync(logPath, "utf8")
      const records = logText.trim().split(/\r?\n/u).map((line) => JSON.parse(line))

      assert.equal(records.length, 1)
      assert.equal(records[0].adapter, "pi")
      assert.equal(records[0].event, "pre-compact")
      assert.equal(records[0].status, "ok")
      assert.equal(records[0].saved, 0)
      assert.equal(records[0].skipped, 1)
      assert.equal(records[0].skippedSecret, 1)
      assert.doesNotMatch(logText, /API_KEY|abcd1234/u)
    })
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

  it("claude pre-compact accepts hook payload on stdin", () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ memory: { sessionEndSummary: { enabled: true } } }), "utf8")
    const result = runProcess(["claude", "pre-compact"], {
      env: {
        MEMORY_LANE_FILE: memFile,
        MEMORY_LANE_EMBEDDINGS_FILE: embFile,
        MEMORY_LANE_CONFIG: cfgFile,
      },
      stdin: JSON.stringify({
        hook_event_name: "PreCompact",
        session_id: "session-1",
        turn_id: "turn-1",
        cwd: process.cwd(),
        transcript_path: null,
        permission_mode: "default",
        trigger: "manual",
      }),
    })
    assert.equal(result.status, 0)
    assert.match(result.stdout, /requires memory\.sessionEndSummary\.baseUrl and model/)
  })

  it("claude hooks bound embedding settlement before exit", async () => {
    await withHangingServer(async (baseUrl) => {
      fs.writeFileSync(cfgFile, JSON.stringify({
        semantic: {
          enabled: true,
          activeEmbeddingProfile: "slow",
          embeddings: {
            profiles: {
              slow: {
                provider: "openai-compatible-embeddings",
                baseUrl,
                model: "slow-embedding-model",
                apiKeyEnv: "MEMORY_LANE_TEST_EMBEDDING_KEY",
                timeoutMs: 10_000,
              },
            },
          },
        },
      }), "utf8")

      const startedAt = Date.now()
      const result = runProcess(["claude", "post-tool-use"], {
        env: {
          MEMORY_LANE_FILE: memFile,
          MEMORY_LANE_EMBEDDINGS_FILE: embFile,
          MEMORY_LANE_CONFIG: cfgFile,
          MEMORY_LANE_TEST_EMBEDDING_KEY: "test-key",
        },
        stdin: JSON.stringify({
          hook_event_name: "PostToolUse",
          session_id: "session-1",
          cwd: process.cwd(),
          transcript_path: null,
          permission_mode: "default",
          tool_name: "Bash",
          tool_input: { command: "pnpm test" },
          tool_response: { exit_code: 0, stdout: "tests passed" },
        }),
      })
      const durationMs = Date.now() - startedAt

      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout.trim(), "{}")
      assert.ok(durationMs < 5_000, `hook took ${durationMs}ms`)
    })
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

  it("hook commands fail safe when config cannot be loaded", () => {
    fs.writeFileSync(cfgFile, "{bad json", "utf8")
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

  it("mcp, continuity, and save kind commands are documented in help output", () => {
    const result = runProcess(["help"])
    assert.equal(result.status, 0)
    assert.match(result.stdout, /save <text> .*\[--kind preference\|personal_context\|project_fact\|project_checkpoint\|workflow_rule\|decision\|correction\|procedure\|session_summary\|misc\]/u)
    assert.match(result.stdout, /continuity \[--json\]\s+Canonical continuity read model for resumption\/status questions/u)
    assert.match(result.stdout, /mcp\s+Run the bundled Memory Lane MCP server over stdio/)
  })

  it("upgrade command is documented in help output", () => {
    const result = runProcess(["help"])
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes("upgrade [--yes]"))
    assert.ok(result.stdout.includes("Download latest binary and re-apply configs"))
  })

  it("shows exact ids with scoped defaults and --all", () => {
    const projectA = tempDir()
    const projectB = tempDir()
    fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "cli-show-project-a" }))
    fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "cli-show-project-b" }))
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }

    run(["save", "Project A show text", "--status", "approved", "--category", "project", "--scope", "project", "--project", projectA], env)
    run(["save", "Project B show text", "--status", "approved", "--category", "project", "--scope", "project", "--project", projectB], env)
    const all = JSON.parse(run(["list", "--all", "--json", "--project", projectA], env))
    const idA = all.data.memories.find((m: any) => m.text === "Project A show text").id
    const idB = all.data.memories.find((m: any) => m.text === "Project B show text").id

    const shown = JSON.parse(run(["show", idA, "--json", "--project", projectA], env))
    assert.equal(shown.ok, true)
    assert.equal(shown.data.memory.id, idA)
    assert.equal(shown.data.memory.text, "Project A show text")

    const hidden = runProcess(["get", idB, "--json", "--project", projectA], { env })
    assert.equal(hidden.status, 1)
    assert.match(hidden.stdout, /not_found/u)
    assert.match(hidden.stdout, /--all/u)

    const shownAll = JSON.parse(run(["get", idB, "--all", "--json", "--project", projectA], env))
    assert.equal(shownAll.data.memory.text, "Project B show text")
  })

  it("rejects recall --id and suggests show", () => {
    const result = runProcess(["recall", "--id", "abc123", "--json"])
    assert.equal(result.status, 1)
    assert.match(result.stdout, /Unsupported recall flag: --id/u)
    assert.match(result.stdout, /memory-lane show <id>/u)
  })

  it("rescopes exact ids with dry-run and --yes while preserving the same id", () => {
    const projectA = tempDir()
    const projectB = tempDir()
    fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "cli-rescope-project-a" }))
    fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "cli-rescope-project-b" }))
    const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile }

    run(["save", "Global rule to rescope", "--status", "approved", "--kind", "workflow_rule", "--scope", "global", "--project", projectA], env)
    const before = JSON.parse(run(["list", "--all", "--json", "--project", projectA], env))
    const id = before.data.memories.find((m: any) => m.text === "Global rule to rescope").id

    const missingConfirmation = runProcess(["rescope", id, "--scope", "project", "--project", projectB, "--json"], { env })
    assert.equal(missingConfirmation.status, 1)
    assert.match(missingConfirmation.stdout, /requires --yes or --dry-run/u)

    const preview = JSON.parse(run(["move", id, "--scope", "project", "--project", projectB, "--dry-run", "--json"], env))
    assert.equal(preview.data.dryRun, true)
    assert.equal(preview.data.proposed.id, id)
    assert.equal(preview.data.proposed.scope.key, "cli-rescope-project-b")
    const humanPreview = run(["move", id, "--scope", "project", "--project", projectB, "--dry-run"], env)
    assert.match(humanPreview, new RegExp(`Apply with: memory-lane rescope ${id} --scope project --project .* --yes`, "u"))
    assert.equal(JSON.parse(run(["show", id, "--json", "--project", projectA], env)).data.memory.scope.type, "global")

    const applied = JSON.parse(run(["rescope", id, "--scope", "project", "--project", projectB, "--yes", "--json"], env))
    assert.equal(applied.data.dryRun, false)
    assert.equal(applied.data.proposed.id, id)
    assert.equal(applied.data.proposed.scope.key, "cli-rescope-project-b")

    const hidden = runProcess(["show", id, "--json", "--project", projectA], { env })
    assert.equal(hidden.status, 1)
    assert.equal(JSON.parse(run(["show", id, "--json", "--project", projectB], env)).data.memory.id, id)

    const global = JSON.parse(run(["rescope", id, "--scope", "global", "--yes", "--json", "--project", projectB], env))
    assert.equal(global.data.proposed.scope.type, "global")
    assert.equal(global.data.proposed.project, undefined)
  })


  it("status reports the learning trace block in json and human forms", () => {
    const dir = tempDir()
    const traces = path.join(dir, "traces")
    const configPath = path.join(dir, "config.json")
    const traceA = writeTraceFixture(traces, "project-hash", "a.json", "{\"schemaVersion\":1}\n")
    const traceB = writeTraceFixture(traces, "project-hash", "b.json", "{\"schemaVersion\":1,\"messages\":[]}\n")
    const totalBytes = fs.statSync(traceA).size + fs.statSync(traceB).size
    fs.writeFileSync(configPath, JSON.stringify({ learning: { capture: "on", excludedProjects: ["status-excluded-project"] } }), "utf8")
    const env = {
      MEMORY_LANE_FILE: path.join(dir, "memory.jsonl"),
      MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"),
      MEMORY_LANE_CONFIG: configPath,
      MEMORY_LANE_TRACES_DIR: traces,
      NO_COLOR: "1",
    }

    const jsonResult = runProcess(["status", "--json"], { env })
    assert.equal(jsonResult.status, 0, jsonResult.stderr)
    type StatusLearningPayload = {
      ok: boolean
      data: {
        learning: {
          enabled: boolean
          tracesDirectory: string
          fileCount: number
          totalBytes: number
          excludedProjects: string[]
        }
      }
    }
    const payload = JSON.parse(jsonResult.stdout) as StatusLearningPayload
    assert.equal(payload.ok, true)
    assert.equal(payload.data.learning.enabled, true)
    assert.equal(payload.data.learning.tracesDirectory, traces)
    assert.equal(payload.data.learning.fileCount, 2)
    assert.equal(payload.data.learning.totalBytes, totalBytes)
    assert.deepEqual(payload.data.learning.excludedProjects, ["status-excluded-project"])

    const humanResult = runProcess(["status"], { env })
    assert.equal(humanResult.status, 0, humanResult.stderr)
    assert.match(humanResult.stdout, /Learning: on/u)
    assert.match(humanResult.stdout, /Captured sessions: 2/u)
    assert.match(humanResult.stdout, new RegExp(escapeRegExp(traces), "u"))
    assert.match(humanResult.stdout, /status-excluded-project/u)
  })

  it("tuneup reports learning empty states and purge removes trace files idempotently", () => {
    const dir = tempDir()
    const traces = path.join(dir, "traces")
    const configPath = path.join(dir, "config.json")
    const env = {
      MEMORY_LANE_FILE: path.join(dir, "memory.jsonl"),
      MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"),
      MEMORY_LANE_CONFIG: configPath,
      MEMORY_LANE_TRACES_DIR: traces,
      NO_COLOR: "1",
    }
    fs.writeFileSync(configPath, JSON.stringify({ learning: { capture: "off" } }), "utf8")

    const offResult = runProcess(["tuneup"], { env })
    assert.equal(offResult.status, 0, offResult.stderr)
    assert.match(offResult.stdout, /Local learning is off/u)
    assert.match(offResult.stdout, /learning\.capture.*on/u)

    fs.writeFileSync(configPath, JSON.stringify({ learning: { capture: "on" } }), "utf8")
    writeTraceFixture(traces, "project-hash", "first.json", "{\"schemaVersion\":1}\n")
    writeTraceFixture(traces, "project-hash", "second.json", "{\"schemaVersion\":1}\n")

    const onResult = runProcess(["tuneup"], { env })
    assert.equal(onResult.status, 0, onResult.stderr)
    assert.match(onResult.stdout, /2 sessions captured; useful signal around 50/u)

    const purgeResult = runProcess(["tuneup", "purge", "--json"], { env })
    assert.equal(purgeResult.status, 0, purgeResult.stderr)
    type TuneupPurgePayload = {
      data: {
        removedFiles: number
        removedBytes: number
        tracesDirectory: string
      }
    }
    const purged = JSON.parse(purgeResult.stdout) as TuneupPurgePayload
    assert.equal(purged.data.removedFiles, 2)
    assert.equal(purged.data.removedBytes > 0, true)
    assert.equal(purged.data.tracesDirectory, traces)
    assert.equal(fs.existsSync(traces), false)

    const secondPurge = runProcess(["tuneup", "purge", "--json"], { env })
    assert.equal(secondPurge.status, 0, secondPurge.stderr)
    const secondPurged = JSON.parse(secondPurge.stdout) as TuneupPurgePayload
    assert.equal(secondPurged.data.removedFiles, 0)
    assert.equal(secondPurged.data.removedBytes, 0)
  })
})

describe("boolean flags before positionals (issue #135)", () => {
  let dir: string, env: NodeJS.ProcessEnv
  beforeEach(() => {
    dir = tempDir()
    env = {
      MEMORY_LANE_FILE: path.join(dir, "mem.jsonl"),
      MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "emb.jsonl"),
      MEMORY_LANE_CONFIG: path.join(dir, "cfg.json"),
    }
  })

  it("save --json before the text does not swallow the first word", () => {
    const saved = JSON.parse(run(["save", "--json", "remember", "to", "use", "pnpm"], env))
    assert.equal(saved.data.saved.text, "remember to use pnpm")

    const listed = JSON.parse(run(["list", "--json"], env))
    assert.equal(listed.data.memories.length, 1)
    assert.equal(listed.data.memories[0].text, "remember to use pnpm")
  })

  it("show --json before the id resolves the memory instead of dropping the id", () => {
    const saved = JSON.parse(run(["save", "--json", "remember", "to", "use", "pnpm"], env))
    const id = saved.data.saved.id

    const shown = runProcess(["show", "--json", id], { env })
    assert.equal(shown.status, 0, shown.stderr)
    const payload = JSON.parse(shown.stdout)
    assert.equal(payload.data.memory.id, id)
    assert.equal(payload.data.memory.text, "remember to use pnpm")
  })
})
