import { spawn, spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { installManifestPath } from "../installer/manifest.js"

export interface ManifestTransaction {
  path: string
  backupPath: string
  existed: boolean
}

export interface UpgradeLock {
  path: string
  owner: string
  manifestBackupPath?: string
}

interface ProcessIdentity {
  pid: number
  processStartedAt: string
}

interface UpgradeLockOwner {
  schema: "current" | "legacy"
  token: string
  createdAt: number
  pid: number
  processStartedAt: string
  parentPid: number
  parentProcessStartedAt: string
  heartbeatAt?: number
  phase?: "starting" | "recovery"
  installerPid?: number
  installerProcessStartedAt?: string
  recoveryPid?: number
  recoveryProcessStartedAt?: string
}

interface LegacyCoordinationIdentity extends ProcessIdentity {
  token: string
}

export interface DurableUpgradeTransaction {
  State: "pending" | "committed" | "restored"
  BackupState: "not-backed-up" | "backed-up" | "no-backup" | "restored" | "no-original-restored"
  ManifestState: "existing" | "missing" | "restored"
  ManifestPath: string
  ManifestBackupPath: string
  LockPath: string
  LockOwner: string
  ParentPid: string
  ParentStartedAt: string
  InstallerPid: string
  InstallerStartedAt: string
  OriginalBinaryHash: string
}

export type ProcessStartTimeInspection =
  | { status: "found"; startedAt: string }
  | { status: "missing" }
  | { status: "unknown" }

export interface UpgradeLockOptions {
  now?: () => number
  createToken?: () => string
  staleAfterMs?: number
  inspectProcessStartTime?: (processId: number) => ProcessStartTimeInspection
  onReclaimInspected?: (lockPath: string) => void
  onReclaimClaimed?: (lockPath: string) => void
  onBeforeQuarantine?: (lockPath: string) => void
  sleep?: (milliseconds: number) => void
}

export const WINDOWS_COMMITTED_CLEANUP_FLAG = "--windows-committed-cleanup"
export const WINDOWS_INSTALLER_HANDSHAKE_TIMEOUT_MS = 10_000
export const WINDOWS_LOCK_PUBLICATION_GUARD_MS = 30_000
export const WINDOWS_COMMITTED_CLEANUP_TIMEOUT_MS = 30_000
const DEFAULT_UPGRADE_LOCK_STALE_AFTER_MS = 60 * 60 * 1000
const STABLE_OBSERVATION_DELAY_MS = 100
const CURRENT_PROCESS_STARTED_AT = String(Math.round(Date.now() - process.uptime() * 1000))

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

export function inspectWindowsProcessStartTime(processId: number): ProcessStartTimeInspection {
  if (process.platform !== "win32") {
    return processId === process.pid
      ? { status: "found", startedAt: CURRENT_PROCESS_STARTED_AT }
      : { status: "missing" }
  }
  const command = [
    "$processId = [int]$env:MEMORY_LANE_UPGRADE_PROCESS_PID",
    "$process = Get-Process -Id $processId -ErrorAction SilentlyContinue",
    "if ($null -eq $process) { [Console]::Out.Write('missing') } else { [Console]::Out.Write($process.StartTime.ToUniversalTime().Ticks) }",
  ].join("; ")
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, MEMORY_LANE_UPGRADE_PROCESS_PID: String(processId) },
    },
  )
  const startedAt = typeof result.stdout === "string" ? result.stdout.trim() : ""
  if (result.status !== 0) return { status: "unknown" }
  if (startedAt === "missing") return { status: "missing" }
  return /^\d+$/u.test(startedAt) ? { status: "found", startedAt } : { status: "unknown" }
}

function isProcessIdentity(pid: unknown, processStartedAt: unknown): boolean {
  return Number.isInteger(pid) && Number(pid) > 0
    && typeof processStartedAt === "string" && /^\d+$/u.test(processStartedAt)
}

function readJsonFile(filePath: string): unknown | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined
    throw error
  }
}

function readUpgradeLockOwner(ownerPath: string): UpgradeLockOwner | undefined {
  const value = readJsonFile(ownerPath) as Record<string, unknown> | undefined
  if (!value || typeof value !== "object") return undefined
  const commonValid = isProcessIdentity(value.pid, value.processStartedAt)
    && typeof value.token === "string" && value.token.length > 0
    && typeof value.createdAt === "number" && Number.isFinite(value.createdAt) && value.createdAt > 0
  if (!commonValid) return undefined

  const currentKeys = Object.keys(value).sort().join(",") === "createdAt,pid,processStartedAt,token"
  if (currentKeys) {
    return {
      schema: "current",
      token: value.token as string,
      createdAt: value.createdAt as number,
      pid: Number(value.pid),
      processStartedAt: value.processStartedAt as string,
      parentPid: Number(value.pid),
      parentProcessStartedAt: value.processStartedAt as string,
    }
  }

  const installerValid = value.installerPid === undefined && value.installerProcessStartedAt === undefined
    || isProcessIdentity(value.installerPid, value.installerProcessStartedAt)
  const recoveryValid = value.phase !== "recovery" || isProcessIdentity(value.recoveryPid, value.recoveryProcessStartedAt)
  if (!isProcessIdentity(value.parentPid, value.parentProcessStartedAt)
    || !installerValid
    || !recoveryValid
    || typeof value.heartbeatAt !== "number"
    || !Number.isFinite(value.heartbeatAt)
    || value.heartbeatAt <= 0
    || (value.phase !== "starting" && value.phase !== "recovery")) return undefined

  return {
    schema: "legacy",
    token: value.token as string,
    createdAt: value.createdAt as number,
    pid: Number(value.pid),
    processStartedAt: value.processStartedAt as string,
    parentPid: Number(value.parentPid),
    parentProcessStartedAt: value.parentProcessStartedAt as string,
    heartbeatAt: value.heartbeatAt,
    phase: value.phase,
    ...(value.installerPid !== undefined
      ? { installerPid: Number(value.installerPid), installerProcessStartedAt: value.installerProcessStartedAt as string }
      : {}),
    ...(value.phase === "recovery"
      ? { recoveryPid: Number(value.recoveryPid), recoveryProcessStartedAt: value.recoveryProcessStartedAt as string }
      : {}),
  }
}

function readLegacyIdentity(filePath: string): LegacyCoordinationIdentity | undefined {
  const value = readJsonFile(filePath) as Record<string, unknown> | undefined
  return value
    && isProcessIdentity(value.pid, value.processStartedAt)
    && typeof value.token === "string"
    && value.token.length > 0
    ? { pid: Number(value.pid), processStartedAt: value.processStartedAt as string, token: value.token }
    : undefined
}


function sameFilesystemPath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function fileSha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
}

function durableWrite(filePath: string, value: unknown, suffix: string | number = process.pid): void {
  const temporaryPath = `${filePath}.tmp.${suffix}`
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(temporaryPath, "wx")
    fs.writeFileSync(descriptor, JSON.stringify(value), "utf8")
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(temporaryPath, filePath)
    if (process.platform !== "win32") {
      const directoryDescriptor = fs.openSync(path.dirname(filePath), "r")
      try {
        fs.fsyncSync(directoryDescriptor)
      } finally {
        fs.closeSync(directoryDescriptor)
      }
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    fs.rmSync(temporaryPath, { force: true })
  }
}

function readTransactionBytes(transactionPath: string): string | undefined {
  try {
    return fs.readFileSync(transactionPath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function readDurableUpgradeTransaction(
  transactionPath: string,
  installPath: string,
  lockPath: string,
  owner: UpgradeLockOwner,
): DurableUpgradeTransaction | undefined {
  const bytes = readTransactionBytes(transactionPath)
  if (bytes === undefined) return undefined
  let value: Partial<DurableUpgradeTransaction>
  try {
    value = JSON.parse(bytes) as Partial<DurableUpgradeTransaction>
  } catch {
    throw new Error(`Cannot safely reconcile the Windows upgrade because ${transactionPath} is malformed.`)
  }

  const validStates = ["pending", "committed", "restored"]
  const validBackupStates = ["not-backed-up", "backed-up", "no-backup", "restored", "no-original-restored"]
  const validManifestStates = ["existing", "missing", "restored"]
  const noOriginal = value.BackupState === "no-backup" || value.BackupState === "no-original-restored"
  const hashValid = noOriginal
    ? value.OriginalBinaryHash === ""
    : typeof value.OriginalBinaryHash === "string" && /^[a-f\d]{64}$/iu.test(value.OriginalBinaryHash)
  const manifestPathsValid = typeof value.ManifestPath === "string" && path.isAbsolute(value.ManifestPath)
    && typeof value.ManifestBackupPath === "string"
    && sameFilesystemPath(value.ManifestBackupPath, `${value.ManifestPath}.upgrade.${owner.parentPid}`)
  const terminalRestoreValid = value.State !== "restored"
    || ((value.BackupState === "restored" || value.BackupState === "no-original-restored")
      && value.ManifestState === "restored")
  const valid = validStates.includes(value.State ?? "")
    && validBackupStates.includes(value.BackupState ?? "")
    && validManifestStates.includes(value.ManifestState ?? "")
    && manifestPathsValid
    && typeof value.LockPath === "string" && sameFilesystemPath(value.LockPath, lockPath)
    && value.LockOwner === owner.token
    && value.ParentPid === String(owner.parentPid)
    && value.ParentStartedAt === owner.parentProcessStartedAt
    && typeof value.InstallerPid === "string" && /^\d+$/u.test(value.InstallerPid)
    && typeof value.InstallerStartedAt === "string" && /^\d+$/u.test(value.InstallerStartedAt)
    && hashValid
    && terminalRestoreValid
    && sameFilesystemPath(transactionPath, `${installPath}.upgrade.${owner.parentPid}`)
  if (!valid) {
    throw new Error(`Cannot safely reconcile the Windows upgrade because ${transactionPath} failed state validation.`)
  }
  return value as DurableUpgradeTransaction
}

function transactionPaths(installDir: string, owner: UpgradeLockOwner): {
  installPath: string
  backupPath: string
  transactionPath: string
} {
  const installPath = path.join(installDir, "memory-lane.exe")
  return {
    installPath,
    backupPath: `${installPath}.backup.${owner.parentPid}`,
    transactionPath: `${installPath}.upgrade.${owner.parentPid}`,
  }
}

function saveDurableUpgradeTransaction(transactionPath: string, transaction: DurableUpgradeTransaction): void {
  durableWrite(transactionPath, transaction)
}

function isRestoredExecutableVerified(installPath: string, transaction: DurableUpgradeTransaction): boolean {
  if (transaction.BackupState === "restored") {
    return fs.existsSync(installPath)
      && fileSha256(installPath).toLowerCase() === transaction.OriginalBinaryHash.toLowerCase()
  }
  return transaction.BackupState === "no-original-restored" && !fs.existsSync(installPath)
}

function ownerStillMatches(lockPath: string, owner: UpgradeLockOwner): boolean {
  const current = readUpgradeLockOwner(path.join(lockPath, "owner"))
  return current?.token === owner.token
    && current.pid === owner.pid
    && current.processStartedAt === owner.processStartedAt
    && current.parentPid === owner.parentPid
    && current.parentProcessStartedAt === owner.parentProcessStartedAt
}

function removeMatchingLock(lockPath: string, owner: UpgradeLockOwner): void {
  if (ownerStillMatches(lockPath, owner)) fs.rmSync(lockPath, { recursive: true, force: true })
}

function cleanupTransactionArtifacts(
  transactionPath: string,
  backupPath: string,
  transaction: DurableUpgradeTransaction,
  owner: UpgradeLockOwner,
): void {
  const installPath = path.resolve(backupPath.replace(/\.backup\.\d+$/u, ""))
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentBytes = readTransactionBytes(transactionPath)
    const lockMatches = ownerStillMatches(transaction.LockPath, owner)
    const backupExists = fs.existsSync(backupPath)
    const manifestBackupExists = fs.existsSync(transaction.ManifestBackupPath)
    if (currentBytes === undefined && !backupExists && !manifestBackupExists) {
      if (lockMatches) removeMatchingLock(transaction.LockPath, owner)
      return
    }
    if (currentBytes !== undefined && !lockMatches) {
      throw new Error("Cannot safely clean Windows upgrade artifacts because the lock owner changed.")
    }
    if (currentBytes !== undefined) {
      const current = readDurableUpgradeTransaction(transactionPath, installPath, transaction.LockPath, owner)
      if (current && JSON.stringify(current) !== JSON.stringify(transaction)) {
        throw new Error("Cannot safely clean Windows upgrade artifacts because the transaction changed.")
      }
      if (current) {
        try {
          fs.rmSync(backupPath, { force: true })
          fs.rmSync(transaction.ManifestBackupPath, { force: true })
          fs.rmSync(transactionPath, { force: true })
          removeMatchingLock(transaction.LockPath, owner)
          return
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        }
      }
    }
    if (attempt < 2) sleep(10)
  }
  if (!fs.existsSync(transactionPath)
    && !fs.existsSync(backupPath)
    && !fs.existsSync(transaction.ManifestBackupPath)) return
  throw new Error("Cannot safely clean Windows upgrade artifacts because concurrent cleanup did not converge.")
}

function rollbackPendingTransaction(
  installPath: string,
  backupPath: string,
  transactionPath: string,
  transaction: DurableUpgradeTransaction,
  owner: UpgradeLockOwner,
): void {
  if (transaction.State === "restored") {
    if (!isRestoredExecutableVerified(installPath, transaction)) {
      throw new Error("Cannot safely finish Windows upgrade cleanup because the restored executable cannot be verified.")
    }
    cleanupTransactionArtifacts(transactionPath, backupPath, transaction, owner)
    return
  }
  if (transaction.State !== "pending") {
    throw new Error("Cannot roll back a Windows upgrade transaction that is not pending.")
  }

  if (transaction.BackupState === "not-backed-up") {
    if (fs.existsSync(backupPath)) {
      transaction.BackupState = "backed-up"
    } else if (fs.existsSync(installPath)
      && fileSha256(installPath).toLowerCase() === transaction.OriginalBinaryHash.toLowerCase()) {
      transaction.BackupState = "restored"
    } else {
      throw new Error("Cannot safely restore the previous Windows executable because its backup is missing.")
    }
    saveDurableUpgradeTransaction(transactionPath, transaction)
  }

  if (transaction.BackupState === "backed-up") {
    if (fs.existsSync(backupPath)) {
      if (fileSha256(backupPath).toLowerCase() !== transaction.OriginalBinaryHash.toLowerCase()) {
        throw new Error("Cannot safely restore the previous Windows executable because its backup does not match.")
      }
      fs.rmSync(installPath, { force: true })
      fs.renameSync(backupPath, installPath)
    } else if (!fs.existsSync(installPath)
      || fileSha256(installPath).toLowerCase() !== transaction.OriginalBinaryHash.toLowerCase()) {
      throw new Error("Cannot safely restore the previous Windows executable because its backup is missing.")
    }
    transaction.BackupState = "restored"
    saveDurableUpgradeTransaction(transactionPath, transaction)
  } else if (transaction.BackupState === "no-backup") {
    fs.rmSync(installPath, { force: true })
    transaction.BackupState = "no-original-restored"
    saveDurableUpgradeTransaction(transactionPath, transaction)
  }

  if (!isRestoredExecutableVerified(installPath, transaction)) {
    throw new Error("Cannot safely finish Windows upgrade cleanup because the restored executable cannot be verified.")
  }
  if (transaction.ManifestState === "existing") {
    if (!fs.existsSync(transaction.ManifestBackupPath)) {
      throw new Error("Cannot safely restore the install manifest because its backup is missing.")
    }
    fs.copyFileSync(transaction.ManifestBackupPath, transaction.ManifestPath)
    transaction.ManifestState = "restored"
    saveDurableUpgradeTransaction(transactionPath, transaction)
  } else if (transaction.ManifestState === "missing") {
    fs.rmSync(transaction.ManifestPath, { force: true })
    transaction.ManifestState = "restored"
    saveDurableUpgradeTransaction(transactionPath, transaction)
  }
  transaction.State = "restored"
  saveDurableUpgradeTransaction(transactionPath, transaction)
  cleanupTransactionArtifacts(transactionPath, backupPath, transaction, owner)
}

function trackedIdentities(
  owner: UpgradeLockOwner,
  transaction: DurableUpgradeTransaction | undefined,
  lockPath: string,
): ProcessIdentity[] {
  const identities: ProcessIdentity[] = [{ pid: owner.parentPid, processStartedAt: owner.parentProcessStartedAt }]
  if (transaction) {
    identities.push({ pid: Number(transaction.InstallerPid), processStartedAt: transaction.InstallerStartedAt })
  }
  if (owner.schema === "legacy" && owner.installerPid !== undefined) {
    identities.push({ pid: owner.installerPid, processStartedAt: owner.installerProcessStartedAt! })
  }
  if (owner.recoveryPid !== undefined) {
    identities.push({ pid: owner.recoveryPid, processStartedAt: owner.recoveryProcessStartedAt! })
  }
  for (const name of [".reclaim", "active-actor"]) {
    const legacyPath = path.join(lockPath, name)
    const identity = readLegacyIdentity(legacyPath)
    if (identity) identities.push(identity)
    else if (fs.existsSync(legacyPath)) {
      throw new Error(`Cannot safely reconcile the Windows upgrade because legacy ${name} state is malformed.`)
    }
  }
  return identities
}

function hasRecoveryResidue(installDir: string): boolean {
  return fs.readdirSync(installDir).some((entry) =>
    /^memory-lane\.exe\.(?:backup|upgrade)\./u.test(entry),
  )
}

interface LockObservation {
  identity: string
  ownerBytes?: string
  transactionBytes?: string
  backupExists: boolean
  manifestBackupExists: boolean
  temporaryResidue: string[]
  legacyClaimBytes?: string
  legacyActorBytes?: string
}

function optionalBytes(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function observeLock(installDir: string, lockPath: string, owner?: UpgradeLockOwner): LockObservation | undefined {
  let stat: fs.Stats
  try {
    stat = fs.statSync(lockPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
  const installPath = path.join(installDir, "memory-lane.exe")
  const transactionPath = owner ? `${installPath}.upgrade.${owner.parentPid}` : undefined
  const transactionBytes = transactionPath ? optionalBytes(transactionPath) : undefined
  let manifestBackupExists = false
  if (transactionBytes) {
    try {
      const value = JSON.parse(transactionBytes) as Partial<DurableUpgradeTransaction>
      manifestBackupExists = typeof value.ManifestBackupPath === "string" && fs.existsSync(value.ManifestBackupPath)
    } catch {
      manifestBackupExists = false
    }
  }
  const temporaryResidue = fs.readdirSync(installDir)
    .filter((entry) => entry.startsWith("memory-lane.exe.upgrade.") && entry.includes(".tmp."))
    .sort()
  return {
    identity: `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`,
    ownerBytes: optionalBytes(path.join(lockPath, "owner")),
    transactionBytes,
    backupExists: owner ? fs.existsSync(`${installPath}.backup.${owner.parentPid}`) : hasRecoveryResidue(installDir),
    manifestBackupExists,
    temporaryResidue,
    legacyClaimBytes: optionalBytes(path.join(lockPath, ".reclaim")),
    legacyActorBytes: optionalBytes(path.join(lockPath, "active-actor")),
  }
}

function sameObservation(left: LockObservation | undefined, right: LockObservation | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function ensureInactive(
  identities: ProcessIdentity[],
  inspect: (processId: number) => ProcessStartTimeInspection,
  owner: UpgradeLockOwner,
): void {
  const states = identities.map((identity) => ({
    identity,
    state: inspect(identity.pid),
  }))
  const unknown = states.find(({ state }) => state.status === "unknown")
  if (unknown) {
    throw new Error(`Cannot safely inspect Windows upgrade process identity for PID ${unknown.identity.pid}.`)
  }
  const active = states.some(({ identity, state }) =>
    state.status === "found" && state.startedAt === identity.processStartedAt,
  )
  if (active) {
    throw new Error(`Another Memory Lane upgrade is already in progress (PID ${owner.parentPid}).`)
  }
}

function reconcileExistingOwner(
  installDir: string,
  lockPath: string,
  owner: UpgradeLockOwner,
  now: () => number,
  inspect: (processId: number) => ProcessStartTimeInspection,
): void {
  const { installPath, backupPath, transactionPath } = transactionPaths(installDir, owner)
  const transaction = readDurableUpgradeTransaction(transactionPath, installPath, lockPath, owner)
  ensureInactive(trackedIdentities(owner, transaction, lockPath), inspect, owner)
  const legacyHandoffAt = owner.heartbeatAt ?? owner.createdAt
  if (owner.schema === "legacy"
    && owner.phase === "starting"
    && now() - legacyHandoffAt < WINDOWS_INSTALLER_HANDSHAKE_TIMEOUT_MS) {
    throw new Error("Another Memory Lane upgrade is starting; legacy recovery handoff is still in progress.")
  }

  if (!transaction) {
    const publicationAge = now() - owner.createdAt
    if (publicationAge < WINDOWS_LOCK_PUBLICATION_GUARD_MS) {
      throw new Error("Another Memory Lane upgrade is starting; transaction publication is still in progress.")
    }
    if (fs.existsSync(backupPath)
      || fs.readdirSync(installDir).some((entry) => entry.startsWith(`${path.basename(transactionPath)}.`))) {
      throw new Error(`Cannot safely reconcile the Windows upgrade because transaction residue remains for owner ${owner.token}.`)
    }
    return
  }

  if (transaction.State === "pending") {
    rollbackPendingTransaction(installPath, backupPath, transactionPath, transaction, owner)
    return
  }
  if (transaction.State === "restored") {
    if (!isRestoredExecutableVerified(installPath, transaction)) {
      throw new Error("Cannot safely finish Windows upgrade cleanup because the restored executable cannot be verified.")
    }
    cleanupTransactionArtifacts(transactionPath, backupPath, transaction, owner)
    return
  }
  cleanupTransactionArtifacts(transactionPath, backupPath, transaction, owner)
}

function quarantineLock(
  installDir: string,
  lockPath: string,
  expected: LockObservation,
  now: () => number,
  attempt: number,
): void {
  const quarantinePath = `${lockPath}.stale.${process.pid}.${now()}.${attempt}`
  try {
    fs.renameSync(lockPath, quarantinePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  const quarantinedOwner = readUpgradeLockOwner(path.join(quarantinePath, "owner"))
  const quarantined = observeLock(installDir, quarantinePath, quarantinedOwner)
  if (!sameObservation(expected, quarantined)) {
    try {
      fs.renameSync(quarantinePath, lockPath)
    } catch {
      throw new Error(`Windows upgrade lock changed during quarantine; preserved unexpected state at ${quarantinePath}.`)
    }
    throw new Error("Windows upgrade lock changed during quarantine and was restored.")
  }
  fs.rmSync(quarantinePath, { recursive: true, force: true })
}

export function acquireUpgradeLock(
  installDir: string,
  upgradePid: number,
  options: UpgradeLockOptions = {},
): UpgradeLock {
  const lockPath = path.join(installDir, ".memory-lane-upgrade.lock")
  const ownerPath = path.join(lockPath, "owner")
  const now = options.now ?? Date.now
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_UPGRADE_LOCK_STALE_AFTER_MS
  const inspect = options.inspectProcessStartTime ?? inspectWindowsProcessStartTime
  const wait = options.sleep ?? sleep
  const upgradeProcess = inspect(upgradePid)
  if (upgradeProcess.status !== "found" || !/^\d+$/u.test(upgradeProcess.startedAt)) {
    throw new Error("Could not identify the running upgrade process.")
  }
  const token = (options.createToken ?? randomUUID)()
  fs.mkdirSync(installDir, { recursive: true })

  const createLock = (): UpgradeLock | undefined => {
    try {
      fs.mkdirSync(lockPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined
      throw error
    }
    try {
      durableWrite(ownerPath, {
        token,
        pid: upgradePid,
        processStartedAt: upgradeProcess.startedAt,
        createdAt: now(),
      }, `${upgradePid}.${token}`)
      return { path: lockPath, owner: token }
    } catch (error) {
      fs.rmSync(lockPath, { recursive: true, force: true })
      throw error
    }
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const created = createLock()
    if (created) return created
    let stat: fs.Stats
    try {
      stat = fs.statSync(lockPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
      throw error
    }
    const owner = readUpgradeLockOwner(ownerPath)
    const first = observeLock(installDir, lockPath, owner)
    if (!first) continue
    options.onReclaimInspected?.(lockPath)

    if (!owner) {
      if (now() - stat.mtimeMs < staleAfterMs) {
        throw new Error("Another Memory Lane upgrade is starting; lock owner metadata is not yet available.")
      }
      if (hasRecoveryResidue(installDir)) {
        throw new Error("Cannot safely reconcile the Windows upgrade because owner metadata is missing or malformed while recovery residue remains.")
      }
    } else {
      reconcileExistingOwner(installDir, lockPath, owner, now, inspect)
      if (!fs.existsSync(lockPath)) continue
    }

    wait(STABLE_OBSERVATION_DELAY_MS)
    const secondOwner = readUpgradeLockOwner(ownerPath)
    const second = observeLock(installDir, lockPath, secondOwner)
    if (!sameObservation(first, second)) {
      throw new Error("Windows upgrade state changed while stale-lock reclamation was being validated.")
    }
    options.onReclaimClaimed?.(lockPath)
    const finalOwner = readUpgradeLockOwner(ownerPath)
    const finalObservation = observeLock(installDir, lockPath, finalOwner)
    if (!sameObservation(second, finalObservation)) {
      throw new Error("Windows upgrade state changed while stale-lock reclamation was being validated.")
    }
    options.onBeforeQuarantine?.(lockPath)
    quarantineLock(installDir, lockPath, finalObservation!, now, attempt)
  }
  const created = createLock()
  if (created) return created
  throw new Error("Could not acquire the Memory Lane upgrade lock.")
}

export function releaseUpgradeLock(lock: UpgradeLock | undefined): void {
  if (!lock) return
  try {
    const owner = readUpgradeLockOwner(path.join(lock.path, "owner"))
    if (!owner || owner.token !== lock.owner) return
    const installDir = path.dirname(lock.path)
    const { backupPath, transactionPath } = transactionPaths(installDir, owner)
    const transaction = readDurableUpgradeTransaction(
      transactionPath,
      path.join(installDir, "memory-lane.exe"),
      lock.path,
      owner,
    )
    const temporaryResidue = fs.readdirSync(installDir)
      .some((entry) => entry.startsWith(`${path.basename(transactionPath)}.`))
    if (!transaction
      && !fs.existsSync(backupPath)
      && !temporaryResidue
      && (!lock.manifestBackupPath || !fs.existsSync(lock.manifestBackupPath))) {
      removeMatchingLock(lock.path, owner)
    }
  } catch (error) {
    console.warn(`Warning: Windows upgrade lock was preserved: ${(error as Error).message}`)
  }
}

export function snapshotInstallManifest(dataDir: string, upgradePid: number): ManifestTransaction {
  const manifestPath = installManifestPath(dataDir)
  const backupPath = `${manifestPath}.upgrade.${upgradePid}`
  const existed = fs.existsSync(manifestPath)
  if (existed) fs.copyFileSync(manifestPath, backupPath)
  return { path: manifestPath, backupPath, existed }
}

export function installerEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  installDir?: string,
  upgradePid?: number,
  manifestTransaction?: ManifestTransaction,
  upgradeLock?: UpgradeLock,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = installDir ? { ...baseEnv, INSTALL_DIR: installDir } : { ...baseEnv }
  if (upgradePid !== undefined) env.MEMORY_LANE_UPGRADE_PID = String(upgradePid)
  if (manifestTransaction) {
    env.MEMORY_LANE_UPGRADE_MANIFEST_PATH = manifestTransaction.path
    env.MEMORY_LANE_UPGRADE_MANIFEST_BACKUP_PATH = manifestTransaction.backupPath
    env.MEMORY_LANE_UPGRADE_MANIFEST_EXISTED = String(manifestTransaction.existed)
  }
  if (upgradeLock) {
    env.MEMORY_LANE_UPGRADE_LOCK_PATH = upgradeLock.path
    env.MEMORY_LANE_UPGRADE_LOCK_OWNER = upgradeLock.owner
  }
  return env
}

function awaitChildExit(child: ReturnType<typeof spawn>): Promise<boolean> {
  return new Promise((resolve) => {
    child.once("error", () => resolve(false))
    child.once("exit", (code) => resolve(code === 0))
  })
}

export interface WindowsInstallerDependencies {
  launch?: typeof spawn
  now?: () => number
  delay?: (milliseconds: number) => Promise<void>
}

export async function runTransactionalWindowsInstaller(
  scriptPath: string,
  installDir: string,
  manifestTransaction: ManifestTransaction,
  upgradeLock: UpgradeLock,
  inspect: (processId: number) => ProcessStartTimeInspection = inspectWindowsProcessStartTime,
  dependencies: WindowsInstallerDependencies = {},
): Promise<boolean> {
  const owner = readUpgradeLockOwner(path.join(upgradeLock.path, "owner"))
  if (!owner || owner.schema !== "current" || owner.token !== upgradeLock.owner) {
    throw new Error("Cannot start the Windows installer because the immutable lock owner is invalid.")
  }
  const installPath = path.join(installDir, "memory-lane.exe")
  const transactionPath = `${installPath}.upgrade.${owner.parentPid}`
  const existingBinary = fs.existsSync(installPath)
  const transactionBase = {
    State: "pending" as const,
    BackupState: existingBinary ? "not-backed-up" as const : "no-backup" as const,
    ManifestState: manifestTransaction.existed ? "existing" as const : "missing" as const,
    ManifestPath: manifestTransaction.path,
    ManifestBackupPath: manifestTransaction.backupPath,
    LockPath: upgradeLock.path,
    LockOwner: upgradeLock.owner,
    ParentPid: String(owner.parentPid),
    ParentStartedAt: owner.parentProcessStartedAt,
    OriginalBinaryHash: existingBinary ? fileSha256(installPath) : "",
  }
  const env = installerEnvironment(process.env, installDir, owner.parentPid, manifestTransaction, upgradeLock)
  const launch = dependencies.launch ?? spawn
  const now = dependencies.now ?? Date.now
  const delay = dependencies.delay
    ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const child = launch("powershell", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    stdio: "inherit",
    env,
    windowsHide: false,
  })
  const childExit = awaitChildExit(child)
  if (!child.pid) {
    child.kill()
    await childExit
    return false
  }
  const deadline = now() + WINDOWS_INSTALLER_HANDSHAKE_TIMEOUT_MS
  let installerStartedAt: string | undefined
  while (now() < deadline) {
    const identity = inspect(child.pid)
    if (identity.status === "unknown") break
    if (identity.status === "found") {
      installerStartedAt = identity.startedAt
      break
    }
    await delay(STABLE_OBSERVATION_DELAY_MS)
  }
  if (!installerStartedAt) {
    child.kill()
    await childExit
    return false
  }
  try {
    saveDurableUpgradeTransaction(transactionPath, {
      ...transactionBase,
      InstallerPid: String(child.pid),
      InstallerStartedAt: installerStartedAt,
    })
  } catch (error) {
    child.kill()
    await childExit
    throw error
  }
  return await childExit
}

export function rollbackWindowsUpgrade(installDir: string, upgradeLock: UpgradeLock): boolean {
  try {
    const owner = readUpgradeLockOwner(path.join(upgradeLock.path, "owner"))
    if (!owner || owner.token !== upgradeLock.owner) return !fs.existsSync(upgradeLock.path)
    const { installPath, backupPath, transactionPath } = transactionPaths(installDir, owner)
    const transaction = readDurableUpgradeTransaction(transactionPath, installPath, upgradeLock.path, owner)
    if (!transaction) {
      const temporaryResidue = fs.readdirSync(installDir)
        .some((entry) => entry.startsWith(`${path.basename(transactionPath)}.`))
      if (fs.existsSync(backupPath) || temporaryResidue) return false
      if (upgradeLock.manifestBackupPath) fs.rmSync(upgradeLock.manifestBackupPath, { force: true })
      removeMatchingLock(upgradeLock.path, owner)
      return true
    }
    rollbackPendingTransaction(installPath, backupPath, transactionPath, transaction, owner)
    return true
  } catch (error) {
    console.error(`Failed to restore the previous Windows installation: ${(error as Error).message}`)
    return false
  }
}

function helperArguments(
  installPath: string,
  transactionPath: string,
  transaction: DurableUpgradeTransaction,
): string[] {
  return [
    "upgrade",
    WINDOWS_COMMITTED_CLEANUP_FLAG,
    "--transaction", transactionPath,
    "--install", installPath,
    "--manifest", transaction.ManifestPath,
    "--manifest-backup", transaction.ManifestBackupPath,
    "--lock", transaction.LockPath,
    "--owner", transaction.LockOwner,
    "--parent-pid", transaction.ParentPid,
    "--parent-started-at", transaction.ParentStartedAt,
  ]
}

export function commitWindowsUpgrade(
  installDir: string,
  upgradeLock: UpgradeLock,
  launch: typeof spawn = spawn,
): boolean {
  try {
    const owner = readUpgradeLockOwner(path.join(upgradeLock.path, "owner"))
    if (!owner || owner.token !== upgradeLock.owner) return false
    const { installPath, transactionPath } = transactionPaths(installDir, owner)
    const transaction = readDurableUpgradeTransaction(transactionPath, installPath, upgradeLock.path, owner)
    if (!transaction || transaction.State !== "pending") return false
    transaction.State = "committed"
    saveDurableUpgradeTransaction(transactionPath, transaction)
    try {
      const helper = launch(installPath, helperArguments(installPath, transactionPath, transaction), {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      })
      helper.once("error", (error) => {
        console.warn(`Warning: committed Windows upgrade cleanup could not be started: ${error.message}`)
      })
      helper.unref()
    } catch (error) {
      console.warn(`Warning: committed Windows upgrade cleanup could not be started: ${(error as Error).message}`)
    }
    return true
  } catch (error) {
    console.error(`Failed to commit the Windows upgrade transaction: ${(error as Error).message}`)
    return false
  }
}

function cleanupArgument(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

export function isCommittedCleanupRequest(argv: string[]): boolean {
  return argv.includes(WINDOWS_COMMITTED_CLEANUP_FLAG)
}

export async function handleCommittedCleanup(
  argv: string[],
  inspect: (processId: number) => ProcessStartTimeInspection = inspectWindowsProcessStartTime,
  now: () => number = Date.now,
  delay: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<void> {
  const transactionPath = cleanupArgument(argv, "--transaction")
  const installPath = cleanupArgument(argv, "--install")
  const manifestPath = cleanupArgument(argv, "--manifest")
  const manifestBackupPath = cleanupArgument(argv, "--manifest-backup")
  const lockPath = cleanupArgument(argv, "--lock")
  const ownerToken = cleanupArgument(argv, "--owner")
  const parentPidValue = cleanupArgument(argv, "--parent-pid")
  const parentStartedAt = cleanupArgument(argv, "--parent-started-at")
  if (!transactionPath || !installPath || !manifestPath || !manifestBackupPath || !lockPath || !ownerToken
    || !parentPidValue || !parentStartedAt || !/^\d+$/u.test(parentPidValue) || !/^\d+$/u.test(parentStartedAt)) return
  const parentPid = Number(parentPidValue)
  const deadline = now() + WINDOWS_COMMITTED_CLEANUP_TIMEOUT_MS
  while (now() < deadline) {
    const state = inspect(parentPid)
    if (state.status === "unknown") return
    if (state.status === "missing" || state.startedAt !== parentStartedAt) break
    await delay(STABLE_OBSERVATION_DELAY_MS)
  }
  const finalParentState = inspect(parentPid)
  if (finalParentState.status === "unknown"
    || (finalParentState.status === "found" && finalParentState.startedAt === parentStartedAt)) return

  const owner = readUpgradeLockOwner(path.join(lockPath, "owner"))
  if (!owner || owner.token !== ownerToken || owner.parentPid !== parentPid || owner.parentProcessStartedAt !== parentStartedAt) return
  if (!sameFilesystemPath(transactionPath, `${installPath}.upgrade.${parentPid}`)) return
  const transaction = readDurableUpgradeTransaction(transactionPath, installPath, lockPath, owner)
  if (!transaction || transaction.State !== "committed"
    || !sameFilesystemPath(transaction.ManifestPath, manifestPath)
    || !sameFilesystemPath(transaction.ManifestBackupPath, manifestBackupPath)) return
  const backupPath = `${installPath}.backup.${parentPid}`
  cleanupTransactionArtifacts(transactionPath, backupPath, transaction, owner)
}
