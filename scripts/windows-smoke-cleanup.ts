import * as fs from "node:fs"

export const WINDOWS_SMOKE_CLEANUP_MAX_RETRIES = 10
export const WINDOWS_SMOKE_CLEANUP_RETRY_DELAY_MS = 100

type RemoveDirectory = typeof fs.rmSync

interface WindowsSmokeCleanupOptions {
  beforeRemove?: () => Promise<void>
  removeDirectory?: RemoveDirectory
  reportSecondaryCleanupError?: (error: unknown) => void
}

export function removeWindowsSmokeRoot(
  root: string,
  removeDirectory: RemoveDirectory = fs.rmSync,
): void {
  removeDirectory(root, {
    recursive: true,
    force: true,
    maxRetries: WINDOWS_SMOKE_CLEANUP_MAX_RETRIES,
    retryDelay: WINDOWS_SMOKE_CLEANUP_RETRY_DELAY_MS,
  })
}

export async function runWithWindowsSmokeCleanup<T>(
  root: string,
  smoke: () => Promise<T>,
  options: WindowsSmokeCleanupOptions = {},
): Promise<T> {
  let operationFailed = false
  let operationError: unknown
  let result: T | undefined
  const report = options.reportSecondaryCleanupError
    ?? ((error: unknown) => console.error("Windows self-maintenance smoke cleanup also failed:", error))
  const preserveFailure = (error: unknown): void => {
    if (!operationFailed) {
      operationFailed = true
      operationError = error
    } else {
      report(error)
    }
  }

  try {
    result = await smoke()
  } catch (error) {
    preserveFailure(error)
  }

  if (options.beforeRemove) {
    try {
      await options.beforeRemove()
    } catch (error) {
      preserveFailure(error)
    }
  }

  try {
    removeWindowsSmokeRoot(root, options.removeDirectory)
  } catch (error) {
    preserveFailure(error)
  }

  if (operationFailed) throw operationError
  return result as T
}
