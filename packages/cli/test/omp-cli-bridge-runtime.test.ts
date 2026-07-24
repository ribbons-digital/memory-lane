import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { tempDir } from "../../core/test/helpers.js"
import { piCliBridgeSource } from "../src/installer/config.js"

type BridgeTool = {
  execute(id: string, params: any, signal: AbortSignal, onUpdate: unknown, ctx: any): Promise<any>
}

const cleanups: string[] = []

afterEach(() => {
  while (cleanups.length) fs.rmSync(cleanups.pop()!, { recursive: true, force: true })
})

async function loadBridgeTool(binaryPath: string, toolName = "memory_save"): Promise<BridgeTool> {
  const root = tempDir()
  cleanups.push(root)
  const extensionPath = path.join(root, "index.ts")
  fs.writeFileSync(extensionPath, piCliBridgeSource(binaryPath), "utf8")
  const tools = new Map<string, BridgeTool>()
  const extension = await import(`${pathToFileURL(extensionPath).href}?runtime=${Date.now()}-${Math.random()}`)
  extension.default({
    registerCommand() {},
    registerTool(tool: BridgeTool & { name: string }) { tools.set(tool.name, tool) },
    on() {},
  })
  const tool = tools.get(toolName)
  assert.ok(tool, `expected ${toolName} registration`)
  return tool
}

async function withCompiledHostRuntime<T>(execPath: string, pathValue: string | undefined, operation: () => Promise<T>): Promise<T> {
  const originalExecPath = Object.getOwnPropertyDescriptor(process, "execPath")
  const originalPath = process.env.PATH
  Object.defineProperty(process, "execPath", { configurable: true, enumerable: true, writable: true, value: execPath })
  if (pathValue === undefined) delete process.env.PATH
  else process.env.PATH = pathValue
  try {
    return await operation()
  } finally {
    if (originalExecPath) Object.defineProperty(process, "execPath", originalExecPath)
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
  }
}

function nodePathDirectory(): string {
  const root = tempDir()
  cleanups.push(root)
  const executableName = process.platform === "win32" ? "node.exe" : "node"
  const target = path.join(root, executableName)
  try {
    fs.symlinkSync(process.execPath, target)
  } catch {
    fs.copyFileSync(process.execPath, target)
    fs.chmodSync(target, 0o755)
  }
  return root
}

test("generated source-checkout bridge resolves Node from PATH under a compiled OMP host", async () => {
  const root = tempDir()
  cleanups.push(root)
  const logPath = path.join(root, "cli-call.json")
  const cliPath = path.join(root, "memory-lane.mjs")
  fs.writeFileSync(cliPath, [
    'import * as fs from "node:fs"',
    `fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify({ execPath: process.execPath, args: process.argv.slice(2) }))`,
    'console.log(JSON.stringify({ data: { saved: { id: "source-save" } } }))',
  ].join("\n"), "utf8")
  const tool = await loadBridgeTool(cliPath)
  const nodeDir = nodePathDirectory()

  const result = await withCompiledHostRuntime(path.join(root, "omp"), nodeDir, () => tool.execute(
    "call-source",
    { text: "Node-backed source operation", category: "project" },
    new AbortController().signal,
    undefined,
    { cwd: root },
  ))

  assert.equal(result.content[0].text, "Saved memory source-save")
  const call = JSON.parse(fs.readFileSync(logPath, "utf8")) as { execPath: string; args: string[] }
  assert.match(path.basename(call.execPath), /^node(?:\.exe)?$/u)
  assert.deepEqual(call.args, [
    "save",
    "Node-backed source operation",
    "--status",
    "approved",
    "--json",
    "--category",
    "project",
    "--project",
    root,
  ])
})

test("generated source-checkout bridge reports an actionable error when Node is unavailable", async () => {
  const root = tempDir()
  cleanups.push(root)
  const cliPath = path.join(root, "memory-lane.js")
  fs.writeFileSync(cliPath, "throw new Error('must not execute')\n", "utf8")
  const tool = await loadBridgeTool(cliPath)

  await assert.rejects(
    withCompiledHostRuntime(path.join(root, "omp"), "", () => tool.execute(
      "call-missing-node",
      { text: "Missing Node" },
      new AbortController().signal,
      undefined,
      { cwd: root },
    )),
    /Memory Lane requires Node\.js.*Install Node\.js.*node is available on PATH/u,
  )
})

test("generated release bridge invokes a native Memory Lane binary directly", {
  skip: process.platform === "win32",
}, async () => {
  const root = tempDir()
  cleanups.push(root)
  const logPath = path.join(root, "native-args.json")
  const nativeBinary = path.join(root, "memory-lane")
  fs.writeFileSync(nativeBinary, [
    "#!/bin/sh",
    `printf '["%s"]' "$*" > ${JSON.stringify(logPath)}`,
    `printf '%s\\n' '{"data":{"saved":{"id":"release-save"}}}'`,
  ].join("\n"), { encoding: "utf8", mode: 0o755 })
  const tool = await loadBridgeTool(nativeBinary)

  const result = await withCompiledHostRuntime(path.join(root, "omp"), "", () => tool.execute(
    "call-release",
    { text: "Native release operation" },
    new AbortController().signal,
    undefined,
    { cwd: root },
  ))

  assert.equal(result.content[0].text, "Saved memory release-save")
  assert.match(fs.readFileSync(logPath, "utf8"), /save Native release operation --status approved --json --project/u)
})
