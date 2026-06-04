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

test("initObsidianMirror creates README, memories, imports, and indexes folders", (t) => {
  const vault = tempDir(t)
  const result = initObsidianMirror({ vaultPath: vault, folder: "Memory Lane" })
  assert.equal(result.ok, true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "README.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "imports")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "indexes")), true)
})

test("syncObsidianMirror writes active memories and skips deleted", (t) => {
  const vault = tempDir(t)
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved, pending, deleted])
  assert.equal(result.created, 7)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", "11111111.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", "22222222.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", "33333333.md")), false)
})

test("syncObsidianMirror dry-run reports indexes without writing them", (t) => {
  const vault = tempDir(t)
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved], { dryRun: true })
  assert.equal(result.created, 6)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "memories", "11111111.md")), false)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "imports")), false)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "index.md")), false)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "indexes")), false)
})

test("syncObsidianMirror creates imports and indexes folders when writing", (t) => {
  const vault = tempDir(t)
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved])
  assert.equal(result.ok, true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "imports")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "indexes")), true)
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

test("rendered memory files include lightweight Obsidian tags", (t) => {
  const vault = tempDir(t)
  syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [{ ...approved, kind: "project_fact" }])
  const file = path.join(vault, "Memory Lane", "memories", "11111111.md")
  const content = fs.readFileSync(file, "utf8")
  assert.match(content, /tags:\n  - memory-lane\n  - memory-lane\/memory\n  - memory-lane\/status\/approved\n  - memory-lane\/category\/project/)
  assert.match(content, /  - memory-lane\/kind\/project_fact/)
})

test("syncObsidianMirror writes generated index files", (t) => {
  const vault = tempDir(t)
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved, pending])
  assert.equal(result.ok, true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "index.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "indexes", "pending.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "indexes", "approved.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "indexes", "project.md")), true)
  assert.equal(fs.existsSync(path.join(vault, "Memory Lane", "indexes", "recent.md")), true)
  const pendingIndex = fs.readFileSync(path.join(vault, "Memory Lane", "indexes", "pending.md"), "utf8")
  assert.match(pendingIndex, /memory_lane_index: true/)
  assert.match(pendingIndex, /\[Pending memory\]\(\.\.\/memories\/22222222\.md\)/)
})

test("syncObsidianMirror deletes stale generated index files only", (t) => {
  const vault = tempDir(t)
  syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved])
  const stale = path.join(vault, "Memory Lane", "indexes", "old.md")
  fs.writeFileSync(stale, "---\nmemory_lane_mirror: true\nmemory_lane_index: true\n---\nold\n")
  const handwritten = path.join(vault, "Memory Lane", "indexes", "handwritten.md")
  fs.writeFileSync(handwritten, "---\nmemory_lane_mirror: true\n---\n# User note\n")
  const generatedMemory = path.join(vault, "Memory Lane", "indexes", "memory.md")
  fs.writeFileSync(generatedMemory, "---\nmemory_lane_mirror: true\nmemory_lane_id: abc\n---\n# Generated memory-like file\n")
  const result = syncObsidianMirror({ vaultPath: vault, folder: "Memory Lane" }, [approved])
  assert.equal(result.deleted, 1)
  assert.equal(fs.existsSync(stale), false)
  assert.equal(fs.existsSync(handwritten), true)
  assert.equal(fs.existsSync(generatedMemory), true)
})

test("statusObsidianMirror validates missing vault", (t) => {
  const result = statusObsidianMirror({ vaultPath: path.join(tempDir(t), "missing"), folder: "Memory Lane" })
  assert.equal(result.ok, false)
  assert.match(result.warnings.join("\n"), /does not exist/)
})
