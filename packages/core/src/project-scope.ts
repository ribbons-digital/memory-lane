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

function runGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null
  } catch { return null }
}

function realpathOrResolved(inputPath: string): string {
  try {
    return fs.realpathSync(inputPath)
  } catch {
    return path.resolve(inputPath)
  }
}

function resolveGitPath(rawPath: string, cwd: string): string {
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath)
}

function canonicalKeyFromGitCommonDir(showTopLevel: string, gitCommonDirRaw: string): string {
  const commonDir = realpathOrResolved(resolveGitPath(gitCommonDirRaw, showTopLevel))
  if (path.basename(commonDir) === ".git") return path.dirname(commonDir)
  return realpathOrResolved(showTopLevel)
}

function resolveGitScope(cwd: string): ProjectScope | null {
  const showTopLevelRaw = runGit(cwd, ["rev-parse", "--show-toplevel"])
  if (!showTopLevelRaw) return null

  const root = realpathOrResolved(showTopLevelRaw)
  const gitCommonDirRaw = runGit(cwd, ["rev-parse", "--git-common-dir"])
  const key = gitCommonDirRaw ? canonicalKeyFromGitCommonDir(root, gitCommonDirRaw) : root

  return { cwd, root, key, source: "git" }
}

/**
 * Resolve project scope without creating scope files.
 * Resolution order is:
 * 1. nearest parent `.memory-lane-scope` file (`source: "scope-file"`);
 * 2. git checkout root, using the shared common-dir identity for linked worktrees (`source: "git"`);
 * 3. when `cwd` is explicitly supplied, a canonical cwd scope (`source: "cwd"`).
 * Without an explicit `cwd`, returns null when no scope file or git scope is found.
 */
export function resolveProjectScope(cwd?: string): ProjectScope | null {
  const hasExplicitCwd = cwd !== undefined
  const resolvedCwd = path.resolve(cwd ?? process.cwd())
  const scope = findScopeFile(resolvedCwd)
  if (scope) return { cwd: resolvedCwd, root: scope.root, key: scope.id, source: "scope-file" }
  const gitScope = resolveGitScope(resolvedCwd)
  if (gitScope) return gitScope
  if (!hasExplicitCwd) return null
  const canonical = realpathOrResolved(resolvedCwd)
  return { cwd: resolvedCwd, root: canonical, key: canonical, source: "cwd" }
}
