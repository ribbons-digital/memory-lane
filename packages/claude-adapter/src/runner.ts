import {
  appendHookDebugLog, hookDebugEnabled, type HookDebugLogStatus, type MemoryEngine,
} from "@memory-lane/core"
import { handlePostToolUse, handleStop, handleUserPromptSubmit, type LifecycleResult } from "@memory-lane/lifecycle"
import { lifecycleNoopOutput, noopOutput, userPromptSubmitOutput } from "./outputs.js"
import { parseClaudePayload, type ClaudeCommand } from "./payloads.js"
import { readLatestTurnFromTranscript } from "./transcript.js"

export interface RunClaudeHookOptions {
  engine: MemoryEngine
  payloadText: string
  env?: NodeJS.ProcessEnv
  hookDebugLogPath?: string
}

function parseJson(text: string): unknown {
  return JSON.parse(text)
}

function lifecycleCounts(result: LifecycleResult): {
  saved: number
  skipped: number
  discarded: number
  additionalContext: boolean
  warningCount: number
} {
  return {
    saved: result.saved.filter((saveResult) => saveResult.status === "saved").length,
    skipped: result.saved.filter((saveResult) => saveResult.status === "skipped").length,
    discarded: result.discarded.length,
    additionalContext: Boolean(result.additionalContext),
    warningCount: result.saved.reduce((count, saveResult) => count + (saveResult.warnings?.length ?? 0), 0),
  }
}

export async function runClaudeHookCommand(command: ClaudeCommand, options: RunClaudeHookOptions): Promise<string> {
  const startedAt = Date.now()
  const debug = hookDebugEnabled(options.env)
  const log = (status: HookDebugLogStatus, fields: Record<string, unknown> = {}) => {
    if (!debug) return
    appendHookDebugLog({
      adapter: "claude",
      event: command,
      cwd: process.cwd(),
      status,
      ...fields,
      durationMs: Date.now() - startedAt,
    }, { filePath: options.hookDebugLogPath })
  }

  let payload: unknown
  try {
    payload = parseJson(options.payloadText)
  } catch {
    log("noop", { reason: "invalid JSON payload" })
    return noopOutput("invalid JSON payload", debug)
  }

  const parsed = parseClaudePayload(payload)
  if (parsed.kind === "invalid") {
    log("noop", { reason: parsed.reason })
    return noopOutput(parsed.reason, debug)
  }
  if (parsed.kind !== command) {
    const reason = `event mismatch: command ${command} received ${parsed.kind}`
    log("noop", { reason })
    return noopOutput(reason, debug)
  }

  try {
    if (parsed.kind === "user-prompt-submit") {
      const result = await handleUserPromptSubmit(options.engine, parsed.input)
      log("ok", lifecycleCounts(result))
      return userPromptSubmitOutput(result, debug)
    }

    if (parsed.kind === "stop") {
      const latest = readLatestTurnFromTranscript(parsed.transcriptPath)
      const result = handleStop(options.engine, {
        ...parsed.input,
        lastUserMessage: parsed.input.lastUserMessage ?? latest.lastUserMessage,
        lastAssistantMessage: parsed.input.lastAssistantMessage ?? latest.lastAssistantMessage,
      }, { adapter: "claude" })
      log("ok", lifecycleCounts(result))
      return lifecycleNoopOutput(result, debug)
    }

    const result = handlePostToolUse(options.engine, parsed.input, { adapter: "claude" })
    log("ok", lifecycleCounts(result))
    return lifecycleNoopOutput(result, debug)
  } catch {
    log("error", { reason: "hook handling failed" })
    return noopOutput("hook handling failed", debug)
  }
}
