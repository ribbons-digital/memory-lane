import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-test-"))
  process.on("exit", () => {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  })
  return dir
}

export function writeJsonl(file: string, records: unknown[]): void {
  const lines = records.map((r) => JSON.stringify(r)).join("\n")
  fs.writeFileSync(file, lines + (lines.endsWith("\n") ? "" : "\n"), "utf8")
}
