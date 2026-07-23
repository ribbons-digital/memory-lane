import type { LifecycleCaptureResult } from "@memory-lane/lifecycle"
import type { SaveResult } from "@memory-lane/core"

export function lifecyclePendingWritten(saved: SaveResult[], capture?: LifecycleCaptureResult): number {
  return capture?.pendingWritten ?? saved
    .filter((result): result is Extract<SaveResult, { status: "saved" }> => result.status === "saved")
    .filter((result) => result.memory.status === "pending")
    .length
}
