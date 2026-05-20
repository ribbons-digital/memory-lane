import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { resolveProjectScope } from "../src/project-scope.js"
import { tempDir } from "./helpers.js"

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
})
