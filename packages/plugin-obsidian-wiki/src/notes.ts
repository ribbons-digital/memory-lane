import * as fs from "node:fs"
import * as path from "node:path"
import type { ObsidianWikiConfig } from "./config.js"

export interface WikiNote {
  relativePath: string
  absolutePath: string
  title: string
}

export function* discoverNotes(config: ObsidianWikiConfig): Generator<WikiNote> {
  const root = config.vaultPath
  if (!fs.existsSync(root)) {
    throw new Error(`Vault path does not exist: ${root}`)
  }

  const include = config.includeFolders?.length ? new Set(config.includeFolders) : undefined
  const exclude = new Set(config.excludeFolders ?? ["Private", "Daily"])

  function* walk(dir: string, relPrefix: string): Generator<WikiNote, void, unknown> {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = path.join(relPrefix, entry.name)
      if (entry.isDirectory()) {
        if (exclude.has(entry.name)) continue
        if (include && relPrefix === "" && !include.has(entry.name)) continue
        walk(path.join(dir, entry.name), rel)
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        yield {
          relativePath: rel,
          absolutePath: path.join(dir, entry.name),
          title: entry.name.replace(/\.md$/u, ""),
        }
      }
    }
  }

  walk(root, "")
}

export function readNote(note: WikiNote): { text: string; headings: string[] } {
  const text = fs.readFileSync(note.absolutePath, "utf8")
  const headings: string[] = []
  for (const line of text.split("\n")) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (match) headings.push(match[2].trim())
  }
  return { text, headings }
}
