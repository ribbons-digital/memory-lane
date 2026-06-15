import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export interface PiDebugRecord {
  event: string
  harness: "pi"
  timestamp: string
  sessionId?: string
  turnId?: string
  savedCount: number
  discardedCount: number
  error?: string
}

export function piDebugPath(): string {
  const home = process.env.HOME ?? os.homedir()
  return path.join(home, ".memory-lane", "pi-debug.jsonl")
}

export function isPiDebugEnabled(): boolean {
  const env = process.env.MEMORY_LANE_DEBUG ?? process.env.MEMORY_LANE_PI_DEBUG
  return env === "1" || env?.toLowerCase() === "true"
}

export function writePiDebugLog(
  logPath: string,
  record: Omit<PiDebugRecord, "timestamp" | "harness">,
): void {
  const entry: PiDebugRecord = {
    ...record,
    harness: "pi",
    timestamp: new Date().toISOString(),
  }
  try {
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8")
  } catch {
    // Debug logging is best-effort; never surface to users.
  }
}
