import test, { type TestContext } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { MirrorMemoryRecord } from "../src/types.ts"
import { initObsidianMirror, syncObsidianMirror, statusObsidianMirror } from "../src/sync.ts"

function tempDir(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-obsidian-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const approved: MirrorMemoryRecord = {
  id: "11111111",
  status: "approved",
  category: "project",
  text: "Approved memory",
  scope: { type: "global" },
  source: "manual",
  createdAt: "2026-05-29T00:00:00.000Z",
  updatedAt: "2026-05-29T00:00:00.000Z",
}

const pending: MirrorMemoryRecord = { ...approved, id: "22222222", status: "pending", text: "Pending memory" }
const deleted: MirrorMemoryRecord = { ...approved, id: "33333333", status: "deleted", text: "Deleted memory" }

test("initObsidianMirror creates README and memories folder", (t) => {
  const vault = tempDir(t)
  const result = initObsidianMirror({ vaultPath: vault, folder: "Memory Lane" })
  assert.equal(result.ok, true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "README.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories")), true)
})

test("syncObsidianMirror writes active memories and skips deleted", (t) => {
  const vault = tempDir(t)
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved, pending, deleted])
  assert.equal(result.created, 2)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", "11111111.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", "22222222.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", "33333333.md")), false)
})

test("syncObsidianMirror dry-run reports without writing", (t) => {
  const vault = tempDir(t)
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved], { dryRun: true })
  assert.equal(result.created, 1)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", "11111111.md")), false)
})

test("syncObsidianMirror deletes stale generated files only", (t) => {
  const vault = tempDir(t)
  syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved])
  const stale = path.join(vault, "Memory Lane", "memories", "stale.md")
  fs.writeFileSync(stale, "---\nmemory_lane_mirror: true\n---\nold\n")
  const handwritten = path.join(vault, "Memory Lane", "memories", "handwritten.md")
  fs.writeFileSync(handwritten, "# Handwritten note\n\nmemory_lane_mirror: true\n")
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved])
  assert.equal(result.deleted, 1)
  assert.equal(fs.existsSync(stale), false)
  assert.equal(fs.existsSync(handwritten), true)
})

test("statusObsidianMirror validates missing vault", (t) => {
  const result = statusObsidianMirror({ vaultPath: path.join(tempDir(t), "missing"), folder: "Memory Lane" })
  assert.equal(result.ok, false)
  assert.match(result.warnings.join("\n"), /does not exist/)
})
