import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import type { MemoryRecord } from "./types.js"
import { normalizeMemoryRecord } from "./storage-validation.js"

export function createMemoryId(): string {
  return crypto.randomBytes(4).toString("hex")
}

export function foldMemoryRecords(records: MemoryRecord[]): MemoryRecord[] {
  const latest = new Map<string, MemoryRecord>()
  for (const record of records) latest.set(record.id, record)
  return Array.from(latest.values()).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

interface LockSnapshot {
  ownerText?: string
  mtimeMs: number
  stale: boolean
}

function lockSnapshot(lockDir: string): LockSnapshot | undefined {
  const ownerFile = path.join(lockDir, "owner.json")
  const stat = fs.statSync(lockDir)
  if (!fs.existsSync(ownerFile)) {
    return { mtimeMs: stat.mtimeMs, stale: Date.now() - stat.mtimeMs > 30_000 }
  }

  const ownerText = fs.readFileSync(ownerFile, "utf8")
  const owner = JSON.parse(ownerText) as { pid?: unknown; createdAt?: unknown }
  const pid = typeof owner.pid === "number" ? owner.pid : undefined
  const createdAt = typeof owner.createdAt === "number" ? owner.createdAt : stat.mtimeMs
  const stale = pid !== undefined ? !processIsAlive(pid) : Date.now() - createdAt > 30_000
  return { ownerText, mtimeMs: stat.mtimeMs, stale }
}

function sameLockSnapshot(a: LockSnapshot, b: LockSnapshot): boolean {
  return a.ownerText === b.ownerText && a.mtimeMs === b.mtimeMs
}

function removeStaleLock(lockDir: string): boolean {
  const reapLockDir = `${lockDir}.reap`
  try {
    const observed = lockSnapshot(lockDir)
    if (!observed?.stale) return false

    try {
      fs.mkdirSync(reapLockDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false
      throw error
    }

    try {
      const current = lockSnapshot(lockDir)
      if (!current?.stale || !sameLockSnapshot(observed, current)) return false
      fs.rmSync(lockDir, { recursive: true, force: true })
      return true
    } finally {
      fs.rmSync(reapLockDir, { recursive: true, force: true })
    }
  } catch {
    return false
  }
}

function releaseFileLock(lockDir: string, token: string): void {
  try {
    const ownerFile = path.join(lockDir, "owner.json")
    const owner = JSON.parse(fs.readFileSync(ownerFile, "utf8")) as { token?: unknown }
    if (owner.token === token) fs.rmSync(lockDir, { recursive: true, force: true })
  } catch {
    return
  }
}

export function withFileLock(filePath: string, write: () => void): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const lockDir = filePath + ".lock"
  const startedAt = Date.now()
  const token = crypto.randomBytes(16).toString("hex")
  while (true) {
    try {
      fs.mkdirSync(lockDir)
      try {
        fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, createdAt: Date.now(), token }), "utf8")
      } catch (error) {
        fs.rmSync(lockDir, { recursive: true, force: true })
        throw error
      }
      break
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "EEXIST") throw error
      if (!fs.existsSync(lockDir) || removeStaleLock(lockDir)) continue
      if (Date.now() - startedAt > 5_000) throw new Error(`Timed out waiting for memory store lock: ${filePath}`)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }

  try {
    write()
  } finally {
    releaseFileLock(lockDir, token)
  }
}

export function withFileLocks(filePaths: string[], write: () => void): void {
  const uniquePaths = Array.from(new Set(filePaths)).sort()
  const run = (index: number): void => {
    if (index >= uniquePaths.length) {
      write()
      return
    }
    withFileLock(uniquePaths[index], () => run(index + 1))
  }
  run(0)
}

export interface MemoryStoreDiagnostics {
  totalRows: number
  validRows: number
  skippedRows: number
  malformedRows: number
  invalidRows: number
}

export interface MemoryStore {
  readonly file: string
  append(record: MemoryRecord): void
  /** Append records in one atomic file rewrite and refresh the folded-read cache. */
  appendMany(records: MemoryRecord[]): void
  readLog(): MemoryRecord[]
  list(): MemoryRecord[]
  diagnostics(): MemoryStoreDiagnostics
}

export function createMemoryStore(filePath: string): MemoryStore {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  let cache: { mtime: number; records: MemoryRecord[] } | null = null

  function analyzeLines(): { records: MemoryRecord[]; diagnostics: MemoryStoreDiagnostics } {
    const diagnostics: MemoryStoreDiagnostics = {
      totalRows: 0,
      validRows: 0,
      skippedRows: 0,
      malformedRows: 0,
      invalidRows: 0,
    }
    const records: MemoryRecord[] = []
    if (!fs.existsSync(filePath)) return { records, diagnostics }

    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
      if (!line.trim()) continue
      diagnostics.totalRows += 1
      try {
        const parsed = JSON.parse(line)
        const record = normalizeMemoryRecord(parsed)
        if (record) {
          diagnostics.validRows += 1
          records.push(record)
        } else {
          diagnostics.invalidRows += 1
        }
      } catch {
        diagnostics.malformedRows += 1
      }
    }
    diagnostics.skippedRows = diagnostics.malformedRows + diagnostics.invalidRows
    return { records, diagnostics }
  }

  function parseLines(): MemoryRecord[] {
    return analyzeLines().records
  }

  function readAll(): MemoryRecord[] {
    try {
      const stat = fs.statSync(filePath)
      if (cache && stat.mtimeMs <= cache.mtime) return cache.records
      const records = foldMemoryRecords(parseLines())
      cache = { mtime: stat.mtimeMs, records }
      return records
    } catch {
      return []
    }
  }

  function existingFilePrefix(): string {
    if (!fs.existsSync(filePath)) return ""
    const existing = fs.readFileSync(filePath, "utf8")
    if (!existing || existing.endsWith("\n")) return existing
    return existing + "\n"
  }

  function appendMany(records: MemoryRecord[]): void {
    const rows = records.map((record) => JSON.stringify(record)).join("\n")
    if (!rows) return
    withFileLock(filePath, () => {
      const tmpFile = filePath + ".tmp." + crypto.randomBytes(4).toString("hex")
      try {
        fs.writeFileSync(tmpFile, existingFilePrefix() + rows + "\n", "utf8")
        fs.renameSync(tmpFile, filePath)
      } finally {
        if (fs.existsSync(tmpFile)) fs.rmSync(tmpFile, { force: true })
      }
    })
    cache = null
  }

  return {
    file: filePath,
    append(record) {
      appendMany([record])
    },
    appendMany,
    readLog: parseLines,
    list: readAll,
    diagnostics() {
      return analyzeLines().diagnostics
    },
  }
}
