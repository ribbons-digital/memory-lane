import type { MemoryEngine } from "@memory-lane/core"
import { handlePostToolUse, handleStop, handleUserPromptSubmit } from "@memory-lane/lifecycle"
import { lifecycleNoopOutput, noopOutput, userPromptSubmitOutput } from "./outputs.js"
import { parseClaudePayload, type ClaudeCommand } from "./payloads.js"
import { readLatestTurnFromTranscript } from "./transcript.js"

export interface RunClaudeHookOptions {
  engine: MemoryEngine
  payloadText: string
  env?: NodeJS.ProcessEnv
}

function isDebug(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MEMORY_LANE_HOOK_DEBUG === "1" || env.MEMORY_LANE_HOOK_DEBUG === "true"
}

function parseJson(text: string): unknown {
  return JSON.parse(text)
}

export async function runClaudeHookCommand(command: ClaudeCommand, options: RunClaudeHookOptions): Promise<string> {
  const debug = isDebug(options.env)
  let payload: unknown
  try {
    payload = parseJson(options.payloadText)
  } catch {
    return noopOutput("invalid JSON payload", debug)
  }

  const parsed = parseClaudePayload(payload)
  if (parsed.kind === "invalid") return noopOutput(parsed.reason, debug)
  if (parsed.kind !== command) return noopOutput(`event mismatch: command ${command} received ${parsed.kind}`, debug)

  try {
    if (parsed.kind === "user-prompt-submit") {
      const result = await handleUserPromptSubmit(options.engine, parsed.input)
      return userPromptSubmitOutput(result, debug)
    }

    if (parsed.kind === "stop") {
      const latest = readLatestTurnFromTranscript(parsed.transcriptPath)
      const result = handleStop(options.engine, {
        ...parsed.input,
        lastUserMessage: parsed.input.lastUserMessage ?? latest.lastUserMessage,
        lastAssistantMessage: parsed.input.lastAssistantMessage ?? latest.lastAssistantMessage,
      }, { adapter: "claude" })
      return lifecycleNoopOutput(result, debug)
    }

    const result = handlePostToolUse(options.engine, parsed.input, { adapter: "claude" })
    return lifecycleNoopOutput(result, debug)
  } catch {
    return noopOutput("hook handling failed", debug)
  }
}
