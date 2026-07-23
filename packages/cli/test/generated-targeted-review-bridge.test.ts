import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"
import { installOmp, installPi, piCliBridgeSource } from "../src/installer/config.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cleanups: string[] = []

type Tool = {
  description: string
  parameters: { properties: Record<string, unknown> }
  execute(id: string, params: any, signal?: AbortSignal, onUpdate?: unknown, ctx?: any): Promise<any>
}

function setupBridge() {
  const root = tempDir()
  cleanups.push(root)
  const project = path.join(root, "project")
  const home = path.join(root, "home")
  fs.mkdirSync(path.join(project, ".git"), { recursive: true })
  fs.mkdirSync(home, { recursive: true })
  const cli = path.resolve(__dirname, "../dist/index.js")
  const binary = path.join(root, "memory-lane.mjs")
  fs.writeFileSync(binary, [
    `process.env.MEMORY_LANE_FILE = ${JSON.stringify(path.join(root, "memories.jsonl"))}`,
    `process.env.MEMORY_LANE_EMBEDDINGS_FILE = ${JSON.stringify(path.join(root, "embeddings.jsonl"))}`,
    `process.env.MEMORY_LANE_CONFIG = ${JSON.stringify(path.join(root, "config.json"))}`,
    `await import(${JSON.stringify(pathToFileURL(cli).href)})`,
  ].join("\n"), "utf8")
  const extension = path.join(root, "bridge.ts")
  fs.writeFileSync(extension, piCliBridgeSource(binary), "utf8")
  return { root, home, project, binary, extension }
}

async function loadTools(extension: string): Promise<Map<string, Tool>> {
  const mod = await import(`${pathToFileURL(extension).href}?test=${Date.now()}-${Math.random()}`)
  const tools = new Map<string, Tool>()
  mod.default({
    registerCommand() {},
    registerTool(tool: Tool & { name: string }) { tools.set(tool.name, tool) },
    on() {},
  })
  return tools
}

async function execute(tool: Tool, params: any, cwd: string): Promise<any> {
  return tool.execute("tool-id", params, undefined, undefined, { cwd, ui: { notify() {} } })
}

afterEach(() => {
  for (const dir of cleanups.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("generated CLI-backed Pi/OMP targeted review bridge", () => {
  it("registers first-class targeted suggestion review and same-ID revision guidance", async () => {
    const { extension } = setupBridge()
    const tools = await loadTools(extension)
    const suggest = tools.get("memory_suggest")
    const revise = tools.get("memory_revise")

    assert.ok(suggest)
    assert.ok(revise)
    assert.match(suggest.description, /same (?:pending )?memory ID/iu)
    assert.match(suggest.description, /reruns targeted review/iu)
    assert.match(suggest.description, /explicit user approval/iu)
    assert.match(revise.description, /same ID/iu)
    assert.match(revise.description, /needs-human-review/iu)
    assert.match(revise.description, /never automatically approve or reject/iu)
    assert.deepEqual(Object.keys(revise.parameters.properties), ["id", "text"])
  })

  it("returns candidate-only clean and flagged receipts, then revises the same ID to clean", async () => {
    const { extension, project } = setupBridge()
    const tools = await loadTools(extension)
    const suggest = tools.get("memory_suggest")!
    const revise = tools.get("memory_revise")!

    const unrelated = await execute(suggest, { text: "Should we keep this unrelated item?", category: "project" }, project)
    const clean = await execute(suggest, { text: "The repository uses pnpm for package installation.", category: "project" }, project)
    assert.equal(clean.details.id, clean.details.review.id)
    assert.equal(clean.details.review.outcome, "clean")
    assert.match(clean.content[0].text, /ready for explicit user approval or rejection/iu)
    assert.doesNotMatch(clean.content[0].text, new RegExp(unrelated.details.id, "u"))

    const flagged = await execute(suggest, { text: "What should we do with this?", category: "project" }, project)
    assert.equal(flagged.details.review.outcome, "revise")
    assert.deepEqual(flagged.details.review.qualitySignals.map((signal: any) => signal.code), ["contains-question", "ambiguous-reference"])
    assert.doesNotMatch(flagged.content[0].text, new RegExp(unrelated.details.id, "u"))
    assert.match(flagged.content[0].text, /memory_revise/iu)
    assert.match(flagged.content[0].text, /same pending memory ID/iu)

    const revised = await execute(revise, { id: flagged.details.id, text: "The repository retains durable release decisions." }, project)
    assert.equal(revised.details.id, flagged.details.id)
    assert.equal(revised.details.review.id, flagged.details.id)
    assert.equal(revised.details.review.outcome, "clean")
    assert.equal(revised.details.review.attemptState.revisionAttempts, 1)
    assert.match(revised.content[0].text, /Updated pending memory/iu)
    assert.match(revised.content[0].text, /ready for explicit user approval or rejection/iu)
  })

  it("stops same-ID automatic revision at exhaustion and preserves the approval boundary", async () => {
    const { extension, project, root } = setupBridge()
    const tools = await loadTools(extension)
    const suggest = tools.get("memory_suggest")!
    const revise = tools.get("memory_revise")!

    const initial = await execute(suggest, { text: "What should we do with this?" }, project)
    const first = await execute(revise, { id: initial.details.id, text: "What should we do with this task one?" }, project)
    assert.equal(first.details.review.outcome, "revise")
    const exhausted = await execute(revise, { id: initial.details.id, text: "What should we do with this task two?" }, project)
    assert.equal(exhausted.details.id, initial.details.id)
    assert.equal(exhausted.details.review.outcome, "needs-human-review")
    assert.equal(exhausted.details.review.attemptState.remainingRevisionAttempts, 0)
    assert.match(exhausted.content[0].text, /request human review/iu)
    assert.doesNotMatch(exhausted.content[0].text, /Revision is recommended/iu)

    const latest = fs.readFileSync(path.join(root, "memories.jsonl"), "utf8").trim().split("\n")
      .map((line) => JSON.parse(line)).filter((memory) => memory.id === initial.details.id).at(-1)
    assert.equal(latest.status, "pending")
  })

  it("keeps explicit approved suggestions direct without manufacturing a pending receipt", async () => {
    const { extension, project } = setupBridge()
    const tools = await loadTools(extension)
    const approved = await execute(tools.get("memory_suggest")!, {
      text: "The repository uses pnpm.",
      category: "project",
      status: "approved",
    }, project)

    assert.ok(approved.details.id)
    assert.equal(approved.details.review, undefined)
    assert.match(approved.content[0].text, /Memory .* saved/u)
    assert.doesNotMatch(approved.content[0].text, /pending|approval or rejection/iu)
  })

  it("writes byte-identical generated production source for Pi and OMP", () => {
    const { home, binary } = setupBridge()
    const options = { binaryPath: binary, dataDir: path.join(home, ".memory-lane"), projectMode: false, yes: true, homeDir: home, env: {} }
    const pi = installPi(options)
    const omp = installOmp(options)
    assert.equal(fs.readFileSync(pi.configPath!, "utf8"), piCliBridgeSource(binary))
    assert.equal(fs.readFileSync(omp.configPath!, "utf8"), piCliBridgeSource(binary))
    assert.equal(fs.readFileSync(pi.configPath!, "utf8"), fs.readFileSync(omp.configPath!, "utf8"))
  })
})
