import { lstat, readdir } from "node:fs/promises"
import path from "node:path"
import type { DiscoverObsidianImportFilesOptions } from "./types.js"

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/")
}

function hasDotSegment(relativePath: string): boolean {
  return normalizeRelativePath(relativePath).split("/").some((segment) => segment.startsWith("."))
}

async function pathExists(directory: string): Promise<boolean> {
  try {
    const stat = await lstat(directory)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

export async function discoverObsidianImportFiles(options: DiscoverObsidianImportFilesOptions): Promise<string[]> {
  const vaultPath = path.resolve(options.vaultPath)
  const folder = options.folder || "Memory Lane"
  const importsPath = path.join(vaultPath, folder, "imports")

  if (!(await pathExists(importsPath))) return []

  const discovered: string[] = []

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue

      const absolute = path.join(directory, entry.name)
      const relativeFromImports = path.relative(importsPath, absolute)
      if (hasDotSegment(relativeFromImports)) continue

      const stat = await lstat(absolute)
      if (stat.isSymbolicLink()) continue

      if (stat.isDirectory()) {
        await visit(absolute)
        continue
      }

      if (stat.isFile() && path.extname(entry.name) === ".md") {
        discovered.push(normalizeRelativePath(path.relative(vaultPath, absolute)))
      }
    }
  }

  await visit(importsPath)
  return discovered.sort((left, right) => left.localeCompare(right))
}
