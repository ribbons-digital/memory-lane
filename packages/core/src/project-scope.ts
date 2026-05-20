import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import type { ProjectScope } from "./types.js"

const SCOPE_FILENAME = ".memory-lane-scope"

function findScopeFile(cwd: string): { id: string; root: string } | null {
  let current = path.resolve(cwd)
  while (true) {
    const candidate = path.join(current, SCOPE_FILENAME)
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"))
      if (parsed && typeof parsed.id === "string" && parsed.id) return { id: parsed.id, root: current }
    } catch { /* walk up */ }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

function findGitRoot(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null
  } catch { return null }
}

/** Resolve project scope: scope file → git root → null. Never auto-creates scope files. */
export function resolveProjectScope(cwd?: string): ProjectScope | null {
  const resolvedCwd = path.resolve(cwd ?? process.cwd())
  const scope = findScopeFile(resolvedCwd)
  if (scope) return { cwd: resolvedCwd, root: scope.root, key: scope.id }
  const gitRoot = findGitRoot(resolvedCwd)
  if (gitRoot) return { cwd: resolvedCwd, root: gitRoot, key: gitRoot }
  return null
}
