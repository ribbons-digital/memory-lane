import type { SaveResult } from "./types.js"

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export type HookDebugLogStatus = "ok" | "noop" | "error"

export interface HookDebugLogRecord {
  timestamp?: string
  adapter?: string
  event?: string
  cwd?: string
  status?: HookDebugLogStatus
  reason?: string
  saved?: number
  skipped?: number
  discarded?: number
  skippedSecret?: number
  additionalContext?: boolean
  warningCount?: number
  contextPolicyMode?: string
  contextEvent?: string
  contextSelected?: number
  contextOmitted?: number
  contextMaxItems?: number
  contextMaxChars?: number
  contextOmittedReasons?: string[]
  durationMs?: number
}

export interface AppendHookDebugLogOptions {
  filePath?: string
}

const SAFE_FIELDS = [
  "timestamp",
  "adapter",
  "event",
  "cwd",
  "status",
  "reason",
  "saved",
  "skipped",
  "discarded",
  "skippedSecret",
  "additionalContext",
  "warningCount",
  "contextPolicyMode",
  "contextEvent",
  "contextSelected",
  "contextOmitted",
  "contextMaxItems",
  "contextMaxChars",
  "contextOmittedReasons",
  "durationMs",
] as const

export function hookDebugEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): boolean {
  return env.MEMORY_LANE_HOOK_DEBUG === "1" || env.MEMORY_LANE_HOOK_DEBUG === "true"
}

export function defaultHookDebugLogPath(): string {
  return path.join(os.homedir(), ".memory-lane", "hooks-log.jsonl")
}

function safeRecord(record: HookDebugLogRecord): Record<string, unknown> {
  const safe: Record<string, unknown> = { timestamp: record.timestamp ?? new Date().toISOString() }
  for (const field of SAFE_FIELDS) {
    if (field === "timestamp") continue
    const value = record[field]
    if (value !== undefined) safe[field] = value
  }
  return safe
}

export function appendHookDebugLog(record: HookDebugLogRecord, options?: AppendHookDebugLogOptions): void {
  try {
    const filePath = options?.filePath ?? defaultHookDebugLogPath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.appendFileSync(filePath, JSON.stringify(safeRecord(record)) + "\n", "utf8")
  } catch {
    // Hook debug logging must never affect hook output or exit behavior.
  }
}

export function skippedSecretCount(results: SaveResult[]): number | undefined {
  const count = results.filter((result) => result.status === "skipped" && result.reason === "secret").length
  return count > 0 ? count : undefined
}
