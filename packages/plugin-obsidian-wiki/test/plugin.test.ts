import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, test } from "node:test"
import type { MemoryLanePluginAPI, McpResourceDefinition, McpToolDefinition, CliCommandDefinition } from "@memory-lane/plugin-api"
import obsidianWikiPlugin from "../src/index.js"

let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

test("registers MCP tools, resource, and CLI command", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-wiki-test-"))
  cleanup = () => fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, "Garden"))
  fs.writeFileSync(path.join(dir, "Garden", "Hello.md"), "# Hello\n\nWorld.")

  const tools: McpToolDefinition[] = []
  const resources: McpResourceDefinition[] = []
  const commands: CliCommandDefinition[] = []

  const api = {
    name: "@memory-lane/plugin-obsidian-wiki",
    version: "0.0.0",
    engine: {} as any,
    config: {
      pluginConfig: {
        "@memory-lane/plugin-obsidian-wiki": { vaultPath: dir, includeFolders: ["Garden"] },
      },
    },
    registerMcpTool(t) { tools.push(t) },
    registerMcpResource(r) { resources.push(r) },
    registerCliCommand(c) { commands.push(c) },
  } as MemoryLanePluginAPI

  obsidianWikiPlugin(api)

  assert.equal(tools.length, 2)
  assert.equal(tools[0].name, "obsidian_wiki_search")
  assert.equal(tools[1].name, "obsidian_wiki_read")
  assert.equal(resources.length, 1)
  assert.equal(resources[0].uri, "memory-lane://obsidian-wiki/notes")
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, "obsidian-wiki")
})
