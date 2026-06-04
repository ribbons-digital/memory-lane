import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { discoverObsidianImportFiles } from "../src/discovery.ts"

async function withTempVault(run: (vaultPath: string) => Promise<void>): Promise<void> {
  const vaultPath = await mkdtemp(path.join(os.tmpdir(), "obsidian-import-"))
  try {
    await run(vaultPath)
  } finally {
    await rm(vaultPath, { recursive: true, force: true })
  }
}

test("discoverObsidianImportFiles returns empty array when imports folder is missing", async () => {
  await withTempVault(async (vaultPath) => {
    assert.deepEqual(await discoverObsidianImportFiles({ vaultPath }), [])
  })
})

test("discoverObsidianImportFiles recurses under imports and returns sorted normalized markdown paths", async () => {
  await withTempVault(async (vaultPath) => {
    const importsPath = path.join(vaultPath, "Memory Lane", "imports")
    await mkdir(path.join(importsPath, "nested"), { recursive: true })
    await mkdir(path.join(importsPath, ".dotfolder"), { recursive: true })
    await mkdir(path.join(vaultPath, "Memory Lane", "memories"), { recursive: true })

    await writeFile(path.join(importsPath, "z.md"), "")
    await writeFile(path.join(importsPath, "a.md"), "")
    await writeFile(path.join(importsPath, "not-markdown.txt"), "")
    await writeFile(path.join(importsPath, ".hidden.md"), "")
    await writeFile(path.join(importsPath, "nested", "b.md"), "")
    await writeFile(path.join(importsPath, ".dotfolder", "c.md"), "")
    await writeFile(path.join(vaultPath, "outside.md"), "")
    await writeFile(path.join(vaultPath, "Memory Lane", "memories", "mirror.md"), "")

    try {
      await symlink(path.join(importsPath, "a.md"), path.join(importsPath, "link.md"))
      await symlink(path.join(importsPath, "nested"), path.join(importsPath, "linked-folder"), "dir")
    } catch {
      // Some platforms disallow symlinks for unprivileged users; the non-symlink cases still verify discovery.
    }

    assert.deepEqual(await discoverObsidianImportFiles({ vaultPath }), [
      "Memory Lane/imports/a.md",
      "Memory Lane/imports/nested/b.md",
      "Memory Lane/imports/z.md",
    ])
  })
})

test("discoverObsidianImportFiles supports a custom configured folder", async () => {
  await withTempVault(async (vaultPath) => {
    await mkdir(path.join(vaultPath, "Configured", "imports"), { recursive: true })
    await writeFile(path.join(vaultPath, "Configured", "imports", "note.md"), "")

    assert.deepEqual(await discoverObsidianImportFiles({ vaultPath, folder: "Configured" }), [
      "Configured/imports/note.md",
    ])
  })
})
