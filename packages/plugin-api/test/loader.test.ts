import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, test } from "node:test"
import { loadPlugins } from "../src/index.js"

let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function createFakeEngine(): any {
  return { refreshScope() {} }
}

function createFakeConfig(): any {
  return { semantic: { enabled: false, embeddings: { profiles: {} } } }
}

test("loadPlugins calls plugin default export and collects registrations", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-plugin-api-test-"))
  cleanup = () => fs.rmSync(dir, { recursive: true, force: true })

  const pluginPath = path.join(dir, "fake-plugin.js")
  fs.writeFileSync(pluginPath, `
    export default function (api) {
      api.registerMcpTool({ name: "fake_tool", title: "Fake", description: "...", inputSchema: {}, async handler() { return { content: [] } } })
      api.registerCliCommand({ name: "fake", description: "...", usage: "fake", handler() {} })
    }
  `)

  const plugins = await loadPlugins({
    pluginNames: [pluginPath],
    engine: createFakeEngine(),
    config: createFakeConfig(),
    context: "mcp",
  })

  assert.equal(plugins.length, 1)
  assert.equal(plugins[0].mcpTools.length, 1)
  assert.equal(plugins[0].mcpTools[0].name, "fake_tool")
  assert.equal(plugins[0].cliCommands.length, 0) // ignored in mcp context
})

test("MCP plugin engineResolver defaults to active tool projectPath", async () => {
  const calls: Array<string | undefined> = []
  const plugins = await loadPlugins({
    pluginNames: ["fake-bundled"],
    engine: createFakeEngine(),
    engineResolver(projectPath) {
      calls.push(projectPath)
      return createFakeEngine()
    },
    config: createFakeConfig(),
    context: "mcp",
    bundledPlugins: [{
      name: "fake-bundled",
      default(api) {
        api.registerMcpTool({
          name: "fake_tool",
          title: "Fake",
          description: "...",
          inputSchema: {},
          async handler() {
            api.engineResolver()
            api.engineResolver("explicit-project")
            void api.engine
            return { content: [] }
          },
        })
      },
    }],
  })

  await plugins[0].mcpTools[0].handler({ projectPath: "request-project" })

  assert.deepEqual(calls, ["request-project", "explicit-project", "request-project"])
})

test("loadPlugins collects CLI commands in cli context", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-plugin-api-test-"))
  cleanup = () => fs.rmSync(dir, { recursive: true, force: true })

  const pluginPath = path.join(dir, "fake-plugin.js")
  fs.writeFileSync(pluginPath, `
    export default function (api) {
      api.registerMcpTool({ name: "fake_tool", title: "Fake", description: "...", inputSchema: {}, async handler() { return { content: [] } } })
      api.registerCliCommand({ name: "fake", description: "...", usage: "fake", handler() {} })
    }
  `)

  const plugins = await loadPlugins({
    pluginNames: [pluginPath],
    engine: createFakeEngine(),
    config: createFakeConfig(),
    context: "cli",
  })

  assert.equal(plugins[0].cliCommands.length, 1)
  assert.equal(plugins[0].mcpTools.length, 0) // ignored in cli context
})

test("loadPlugins fails with clear error for nonexistent plugin", async () => {
  await assert.rejects(
    () => loadPlugins({
      pluginNames: ["nonexistent-plugin-12345"],
      engine: createFakeEngine(),
      config: createFakeConfig(),
      context: "mcp",
    }),
    /nonexistent-plugin-12345/,
  )
})

test("loadPlugins fails for plugin without default export", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-plugin-api-test-"))
  cleanup = () => fs.rmSync(dir, { recursive: true, force: true })

  const pluginPath = path.join(dir, "bad-plugin.js")
  fs.writeFileSync(pluginPath, `export const x = 1`)

  await assert.rejects(
    () => loadPlugins({
      pluginNames: [pluginPath],
      engine: createFakeEngine(),
      config: createFakeConfig(),
      context: "mcp",
    }),
    /does not export a default function/,
  )
})
