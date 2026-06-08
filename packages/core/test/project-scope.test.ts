import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { resolveProjectScope } from "../src/project-scope.js"
import { tempDir } from "./helpers.js"

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

function configureGitRepo(cwd: string): void {
  execFileSync("git", ["init"], { cwd, stdio: "ignore" })
  execFileSync("git", ["config", "user.email", "memory-lane@example.invalid"], { cwd, stdio: "ignore" })
  execFileSync("git", ["config", "user.name", "Memory Lane Tests"], { cwd, stdio: "ignore" })
  fs.writeFileSync(path.join(cwd, "README.md"), "# test repo\n", "utf8")
  execFileSync("git", ["add", "README.md"], { cwd, stdio: "ignore" })
  execFileSync("git", ["commit", "-m", "initial"], { cwd, stdio: "ignore" })
}

describe("resolveProjectScope", () => {
  let dir: string
  beforeEach(() => { dir = tempDir() })

  it("returns null when no scope file or git", () => assert.equal(resolveProjectScope(dir), null))

  it("finds scope file walking up", () => {
    fs.writeFileSync(path.join(dir, ".memory-lane-scope"), JSON.stringify({ id: "uuid-123" }))
    const sub = path.join(dir, "a", "b")
    fs.mkdirSync(sub, { recursive: true })
    const s = resolveProjectScope(sub)
    assert.notEqual(s, null)
    assert.equal(s!.key, "uuid-123")
    assert.equal(s!.root, dir)
  })

  it("falls back to git root", () => {
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" })
    const s = resolveProjectScope(dir)
    assert.notEqual(s, null)
    // macOS /var → /private/var path resolution
    assert.equal(fs.realpathSync(s!.root), fs.realpathSync(dir))
  })

  it("scope file takes priority over git", () => {
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" })
    fs.writeFileSync(path.join(dir, ".memory-lane-scope"), JSON.stringify({ id: "scope-beats-git" }))
    assert.equal(resolveProjectScope(dir)!.key, "scope-beats-git")
  })

  it("uses the main checkout key for linked git worktrees", () => {
    configureGitRepo(dir)
    const linked = path.join(path.dirname(dir), `${path.basename(dir)}-linked`)
    git(["worktree", "add", linked, "-b", "feature-memory-lane-test"], dir)

    const mainScope = resolveProjectScope(dir)
    const linkedScope = resolveProjectScope(linked)

    assert.notEqual(mainScope, null)
    assert.notEqual(linkedScope, null)
    assert.equal(fs.realpathSync(mainScope!.key), fs.realpathSync(dir))
    assert.equal(fs.realpathSync(linkedScope!.key), fs.realpathSync(dir))
    assert.equal(fs.realpathSync(linkedScope!.root), fs.realpathSync(linked))
  })
})
