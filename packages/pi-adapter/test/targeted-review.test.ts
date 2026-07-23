import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, test } from "node:test"
import memoryLaneExtension, { type ExtensionAPI, type ExtensionContext } from "../src/index.js"

interface FakePi extends ExtensionAPI {
  tools: Map<string, any>
}

function createFakePi(): FakePi {
  const tools = new Map<string, any>()
  return {
    tools,
    registerCommand() {},
    registerTool(tool) { tools.set(tool.name, tool) },
    on() {},
  }
}

function makeHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-pi-targeted-review-"))
  const previous = {
    PI_MEMORY_FILE: process.env.PI_MEMORY_FILE,
    PI_MEMORY_EMBEDDINGS_FILE: process.env.PI_MEMORY_EMBEDDINGS_FILE,
    PI_MEMORY_CONFIG_FILE: process.env.PI_MEMORY_CONFIG_FILE,
  }
  process.env.PI_MEMORY_FILE = path.join(dir, "memory.jsonl")
  process.env.PI_MEMORY_EMBEDDINGS_FILE = path.join(dir, "embeddings.jsonl")
  process.env.PI_MEMORY_CONFIG_FILE = path.join(dir, "config.json")
  fs.writeFileSync(process.env.PI_MEMORY_CONFIG_FILE, JSON.stringify({ semantic: { enabled: false } }))
  fs.writeFileSync(path.join(dir, ".memory-lane-scope"), JSON.stringify({ id: "pi-targeted-review" }))
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx: ExtensionContext = { cwd: dir, ui: { notify() {} } }
  return {
    dir,
    pi,
    ctx,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

async function execute(pi: FakePi, name: string, params: Record<string, string>, ctx: ExtensionContext) {
  const tool = pi.tools.get(name)
  assert.ok(tool, `${name} should be registered`)
  return tool.execute("tool-call", params, undefined, () => {}, ctx)
}

function currentRecords(dir: string): any[] {
  return fs.readFileSync(path.join(dir, "memory.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
}

let cleanup: (() => void) | undefined
afterEach(() => { cleanup?.(); cleanup = undefined })

test("registers first-class same-ID pending revision guidance", () => {
  const harness = makeHarness()
  cleanup = harness.restore

  const suggest = harness.pi.tools.get("memory_suggest")
  const revise = harness.pi.tools.get("memory_revise")
  assert.ok(revise)
  assert.match(suggest.description, /same (?:pending )?memory ID/iu)
  assert.match(suggest.description, /rerun/iu)
  assert.match(suggest.description, /explicit user approval/iu)
  assert.match(revise.description, /same ID/iu)
  assert.match(revise.description, /rerun/iu)
  assert.match(revise.description, /never (?:automatically )?approve|explicit user approval/iu)
  assert.deepEqual(Object.keys(revise.parameters.properties), ["id", "text"])
})

test("pending memory_suggest returns only its clean targeted receipt while approved semantics stay direct", async () => {
  const harness = makeHarness()
  cleanup = harness.restore

  const unrelated = await execute(harness.pi, "memory_suggest", { text: "What should we do with this?", category: "project" }, harness.ctx)
  const clean = await execute(harness.pi, "memory_suggest", { text: "The repository uses pnpm for package installation.", category: "project" }, harness.ctx)

  assert.equal(clean.details.id, clean.details.review.id)
  assert.equal(clean.details.review.outcome, "clean")
  assert.equal(clean.details.review.currentText, "The repository uses pnpm for package installation.")
  assert.deepEqual(Object.keys(clean.details).sort(), ["id", "review"])
  assert.equal(JSON.stringify(clean).includes(unrelated.details.id), false)
  assert.match(clean.content[0].text, /clean|no quality signals/iu)
  assert.match(clean.content[0].text, /explicit user approval/iu)
  assert.match(clean.content[0].text, /pending/iu)

  const approved = await execute(harness.pi, "memory_suggest", { text: "The repository release is complete.", category: "project", status: "approved" }, harness.ctx)
  assert.deepEqual(approved.details, { id: approved.details.id })
  assert.doesNotMatch(approved.content[0].text, /pending|review|approval/iu)
})

test("flagged suggestion and same-ID revision return actionable structured review without approval", async () => {
  const harness = makeHarness()
  cleanup = harness.restore

  const flagged = await execute(harness.pi, "memory_suggest", { text: "What should we do with this?", category: "project" }, harness.ctx)
  assert.equal(flagged.details.review.outcome, "revise")
  assert.deepEqual(flagged.details.review.qualitySignals.map((signal: any) => signal.code), ["contains-question", "ambiguous-reference"])
  assert.match(flagged.content[0].text, new RegExp(flagged.details.id, "u"))
  assert.match(flagged.content[0].text, /revise the same (?:pending )?memory ID/iu)
  assert.match(flagged.content[0].text, /memory_revise/iu)
  assert.match(flagged.content[0].text, /rerun/iu)

  const revised = await execute(harness.pi, "memory_revise", {
    id: flagged.details.id,
    text: "The repository uses pnpm for package installation.",
  }, harness.ctx)
  assert.equal(revised.details.id, flagged.details.id)
  assert.equal(revised.details.review.id, flagged.details.id)
  assert.equal(revised.details.review.outcome, "clean")
  assert.equal(revised.details.review.attemptState.revisionAttempts, 1)
  assert.match(revised.content[0].text, /explicit user approval/iu)

  const latest = currentRecords(harness.dir).filter((record) => record.id === flagged.details.id).at(-1)
  assert.equal(latest.id, flagged.details.id)
  assert.equal(latest.status, "pending")
  assert.equal(currentRecords(harness.dir).some((record) => record.id === flagged.details.id && record.status === "approved"), false)
  assert.equal(currentRecords(harness.dir).some((record) => record.id === flagged.details.id && record.status === "rejected"), false)
})

test("repeated flagged same-ID revisions clearly stop at needs-human-review", async () => {
  const harness = makeHarness()
  cleanup = harness.restore

  const initial = await execute(harness.pi, "memory_suggest", { text: "What should we do with this?", category: "project" }, harness.ctx)
  const first = await execute(harness.pi, "memory_revise", { id: initial.details.id, text: "What should we do with this task one?" }, harness.ctx)
  assert.equal(first.details.review.outcome, "revise")
  const exhausted = await execute(harness.pi, "memory_revise", { id: initial.details.id, text: "What should we do with this task two?" }, harness.ctx)

  assert.equal(exhausted.details.id, initial.details.id)
  assert.equal(exhausted.details.review.outcome, "needs-human-review")
  assert.equal(exhausted.details.review.attemptState.remainingRevisionAttempts, 0)
  assert.match(exhausted.content[0].text, /needs-human-review/iu)
  assert.match(exhausted.content[0].text, /human review/iu)
  assert.doesNotMatch(exhausted.content[0].text, /revise .*rerun/iu)
  const latest = currentRecords(harness.dir).filter((record) => record.id === initial.details.id).at(-1)
  assert.equal(latest.status, "pending")
})
