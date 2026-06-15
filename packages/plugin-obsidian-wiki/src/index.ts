import type { MemoryLanePluginAPI } from "@memory-lane/plugin-api"
import { getConfig } from "./config.js"
import { discoverNotes, readNote } from "./notes.js"
import { formatAnswerWithCitations, cite } from "./citations.js"

export default function obsidianWikiPlugin(api: MemoryLanePluginAPI): void {
  const config = getConfig(api)

  api.registerMcpTool({
    name: "obsidian_wiki_search",
    title: "Search Obsidian Wiki",
    description: "Search selected Obsidian/Garden notes for relevant knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    async handler(input) {
      const query = String(input.query ?? "").toLowerCase()
      const notes = Array.from(discoverNotes(config))
      const matches = notes.filter(
        (n) => n.title.toLowerCase().includes(query) || n.relativePath.toLowerCase().includes(query),
      )
      return {
        content: [{
          type: "text",
          text: matches.length
            ? `Found ${matches.length} note(s):\n` + matches.map((m) => `- ${m.relativePath}`).join("\n")
            : "No matching notes.",
        }],
        details: { matches: matches.map((m) => m.relativePath) },
      }
    },
  })

  api.registerMcpTool({
    name: "obsidian_wiki_read",
    title: "Read Obsidian Wiki Note",
    description: "Read a selected Obsidian/Garden note with source-backed citations.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the note within the vault" },
      },
      required: ["path"],
    },
    async handler(input) {
      const targetPath = String(input.path ?? "")
      const note = Array.from(discoverNotes(config)).find((n) => n.relativePath === targetPath)
      if (!note) {
        return { content: [{ type: "text", text: `Note not found: ${targetPath}` }] }
      }
      const { text } = readNote(note)
      return {
        content: [{
          type: "text",
          text: formatAnswerWithCitations(text, [cite(note.relativePath)]),
        }],
        details: { path: note.relativePath },
      }
    },
  })

  api.registerMcpResource({
    uri: "memory-lane://obsidian-wiki/notes",
    name: "Obsidian Wiki Notes",
    description: "List of indexable Obsidian/Garden notes.",
    async handler() {
      const notes = Array.from(discoverNotes(config))
      return {
        contents: [{
          uri: "memory-lane://obsidian-wiki/notes",
          mimeType: "application/json",
          text: JSON.stringify(notes.map((n) => ({ path: n.relativePath, title: n.title }))),
        }],
      }
    },
  })

  api.registerCliCommand({
    name: "obsidian-wiki",
    description: "Show Obsidian Wiki plugin status",
    usage: "obsidian-wiki status",
    handler(ctx) {
      const subcommand = ctx.rest[0]
      if (subcommand !== "status") {
        console.log("Usage: memory-lane obsidian-wiki status")
        return
      }
      const notes = Array.from(discoverNotes(config))
      const lines = [
        `Vault: ${config.vaultPath}`,
        `Include: ${config.includeFolders?.join(", ") ?? "(all)"}`,
        `Exclude: ${config.excludeFolders.join(", ")}`,
        `Indexable notes: ${notes.length}`,
      ]
      console.log(lines.join("\n"))
    },
  })
}
