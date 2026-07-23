import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function fixture() {
  const dir = tempDir()
  return {
    dir,
    env: {
      MEMORY_LANE_FILE: path.join(dir, "memories.jsonl"),
      MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"),
      MEMORY_LANE_CONFIG: path.join(dir, "config.json"),
      NO_COLOR: "1",
    },
  }
}

function run(args: string[], env: NodeJS.ProcessEnv, stdin?: string, cwd?: string) {
  return spawnSync("node", [path.resolve(__dirname, "../dist/index.js"), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    input: stdin,
    cwd,
  })
}

function json(args: string[], env: NodeJS.ProcessEnv, stdin?: string, cwd?: string): any {
  const result = run([...args, "--json"], env, stdin, cwd)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

describe("targeted suggestion review CLI", () => {
  it("returns a stable clean receipt and human approval-boundary guidance", () => {
    const { env } = fixture()
    const payload = json(["suggest", "Across all projects, prefer pnpm for package installation.", "--scope", "global", "--category", "preference"], env)

    assert.deepEqual(Object.keys(payload), ["ok", "data", "meta"])
    assert.deepEqual(Object.keys(payload.data), ["saved", "targetedReview"])
    assert.deepEqual(Object.keys(payload.data.targetedReview), [
      "id", "currentText", "scope", "kind", "qualitySignals", "reasons", "suggestedAction", "attemptState", "outcome",
    ])
    assert.equal(payload.data.targetedReview.id, payload.data.saved.id)
    assert.equal(payload.data.targetedReview.outcome, "clean")
    assert.equal(payload.data.saved.status, "pending")

    const human = run(["suggest", "Across all projects, prefer concise dependency guidance.", "--scope", "global", "--category", "preference"], env)
    assert.equal(human.status, 0, human.stderr)
    assert.match(human.stdout, /ready for user approval/iu)
    assert.match(human.stdout, /Do not approve or reject automatically/iu)
  })

  it("returns only the newly saved flagged suggestion with same-ID revision guidance", () => {
    const { env } = fixture()
    const unrelated = json(["suggest", "Should we keep unrelated text?", "--scope", "global"], env).data.targetedReview.id
    const result = run(["suggest", "What should we do with this?", "--scope", "global"], env)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Outcome: revise/u)
    assert.match(result.stdout, /revise this same ID/iu)
    assert.match(result.stdout, /revise-suggestion/u)
    assert.doesNotMatch(result.stdout, new RegExp(unrelated, "u"))
  })

  it("revises exactly one pending suggestion from text or stdin while preserving its ID", () => {
    const { env } = fixture()
    const first = json(["suggest", "What should we do with this?", "--scope", "global"], env).data.targetedReview
    const revised = json(["revise-suggestion", first.id, "--text", "Across all projects, use pnpm for package installation."], env).data.targetedReview
    assert.equal(revised.id, first.id)
    assert.equal(revised.currentText, "Across all projects, use pnpm for package installation.")
    assert.equal(revised.attemptState.revisionAttempts, 1)
    assert.equal(revised.outcome, "clean")

    const second = json(["suggest", "Should we retain this?", "--scope", "global"], env).data.targetedReview
    const fromStdin = json(["revise-suggestion", second.id, "--stdin"], env, "The repository retains durable release decisions.").data.targetedReview
    assert.equal(fromStdin.id, second.id)
    assert.equal(fromStdin.outcome, "clean")
  })

  it("reports exhaustion as needs-human-review without approving or rejecting", () => {
    const { env } = fixture()
    const initial = json(["suggest", "What should we do with this?", "--scope", "global"], env).data.targetedReview
    const first = json(["revise-suggestion", initial.id, "--text", "What should we do with this task one?"], env).data.targetedReview
    assert.equal(first.outcome, "revise")
    const secondResult = run(["revise-suggestion", initial.id, "--text", "What should we do with this task two?"], env)
    assert.equal(secondResult.status, 0, secondResult.stderr)
    assert.match(secondResult.stdout, /Outcome: needs-human-review/u)
    assert.match(secondResult.stdout, /revision attempts are exhausted/iu)
    assert.match(secondResult.stdout, /Do not approve or reject automatically/iu)

    const stored = fs.readFileSync(env.MEMORY_LANE_FILE!, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((memory) => memory.id === initial.id).at(-1)
    assert.equal(stored.status, "pending")
  })

  it("preserves explicit approved suggest semantics without targeted review", () => {
    const { env } = fixture()
    const payload = json(["suggest", "The project uses pnpm.", "--scope", "global", "--status", "approved"], env)
    assert.deepEqual(Object.keys(payload.data), ["saved"])
    assert.equal(payload.data.saved.status, "approved")
    assert.equal(payload.data.targetedReview, undefined)
  })

  it("supports --all for explicit cross-project same-ID revision", () => {
    const { env, dir } = fixture()
    const projectA = path.join(dir, "project-a")
    const projectB = path.join(dir, "project-b")
    fs.mkdirSync(projectA)
    fs.mkdirSync(projectB)
    fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "targeted-a" }))
    fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "targeted-b" }))
    const created = json(["suggest", "Should we retain this?", "--scope", "project"], env, undefined, projectA).data.targetedReview

    const hidden = run(["revise-suggestion", created.id, "--text", "The project retains durable release decisions.", "--json"], env, undefined, projectB)
    assert.equal(hidden.status, 1)
    const revised = json(["revise-suggestion", created.id, "--text", "The project retains durable release decisions.", "--all"], env, undefined, projectB).data.targetedReview
    assert.equal(revised.id, created.id)
  })
})
