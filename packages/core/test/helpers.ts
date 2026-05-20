import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempDirs = new Set<string>()
let listenerRegistered = false

function registerCleanup(): void {
  if (listenerRegistered) return
  listenerRegistered = true
  process.setMaxListeners(100)
  process.on("exit", () => {
    for (const dir of tempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
    }
  })
}

export function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-test-"))
  tempDirs.add(dir)
  registerCleanup()
  return dir
}

export function writeJsonl(file: string, records: unknown[]): void {
  const lines = records.map((r) => JSON.stringify(r)).join("\n")
  fs.writeFileSync(file, lines + (lines.endsWith("\n") ? "" : "\n"), "utf8")
}
