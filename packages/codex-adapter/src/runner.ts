import {
  appendHookDebugLog, hookDebugEnabled, loadConfig, type HookDebugLogStatus, type MemoryEngine,
} from "@memory-lane/core"
import { createOpenAICompatibleProvider, handlePostToolUse, handleSessionEnd, handleSessionStart, handleStop, handleUserPromptSubmit, type LifecycleResult } from "@memory-lane/lifecycle"
import { additionalContextOutput, lifecycleNoopOutput, noopOutput, userPromptSubmitOutput } from "./outputs.js"
import { parseCodexPayload, type CodexCommand } from "./payloads.js"
import { readLatestTurnFromTranscript } from "./transcript.js"

export interface RunCodexHookOptions {
  engine: MemoryEngine
  payloadText: string
  env?: NodeJS.ProcessEnv
  hookDebugLogPath?: string
  configPath?: string
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

function confirmationRequiredOutput(): string {
  return JSON.stringify({
    systemMessage: "Memory Lane: Session-end summarization requires confirmation. Rerun the Codex SessionEnd hook with confirmed: true to save a pending summary.",
  })
}

function createSessionEndSummaryProvider(configPath: string | undefined, env: NodeJS.ProcessEnv | undefined) {
  const config = loadConfig(configPath)
  const summaryConfig = config.memory?.sessionEndSummary
  if (!summaryConfig?.enabled) return { status: "disabled" as const }
  if (!summaryConfig.baseUrl || !summaryConfig.model) return { status: "missing-provider" as const, config: summaryConfig }
  return {
    status: "configured" as const,
    config: summaryConfig,
    provider: createOpenAICompatibleProvider({
      provider: "openai-compatible",
      baseUrl: summaryConfig.baseUrl,
      apiKeyEnv: summaryConfig.apiKeyEnv,
      model: summaryConfig.model,
    }, env),
  }
}

export async function runCodexHookCommand(command: CodexCommand, options: RunCodexHookOptions): Promise<string> {
  const startedAt = Date.now()
  const debug = hookDebugEnabled(options.env)
  const log = (status: HookDebugLogStatus, fields: Record<string, unknown> = {}) => {
    if (!debug) return
    appendHookDebugLog({
      adapter: "codex",
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

  const parsed = parseCodexPayload(payload)
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
      })
      log("ok", lifecycleCounts(result))
      return lifecycleNoopOutput(result, debug)
    }

    if (parsed.kind === "session-start") {
      const result = handleSessionStart(options.engine, parsed.input)
      log("ok", lifecycleCounts(result))
      return additionalContextOutput(result, "SessionStart", debug)
    }

    if (parsed.kind === "session-end") {
      const summaryProvider = createSessionEndSummaryProvider(options.configPath, options.env)
      if (summaryProvider.status === "disabled") {
        log("noop", { reason: "session-end summarization disabled" })
        return noopOutput("Session-end summarization is not enabled.", debug)
      }
      if (summaryProvider.status === "missing-provider") {
        log("noop", { reason: "session-end summary provider not configured" })
        return noopOutput("Session-end summarization requires memory.sessionEndSummary.baseUrl and model.", debug)
      }
      const requireConfirmation = summaryProvider.config.requireConfirmation !== false
      if (requireConfirmation && !parsed.confirmed) {
        log("noop", { reason: "session-end confirmation required" })
        return confirmationRequiredOutput()
      }
      const candidates = await handleSessionEnd(options.engine, parsed.input, {
        provider: summaryProvider.provider,
        promptTemplate: summaryProvider.config.promptTemplate ?? undefined,
        maxTokens: summaryProvider.config.maxTokens,
        // The Codex adapter performs confirmation gating above.
        requireConfirmation: false,
        confirmed: true,
        includeToolOutputs: summaryProvider.config.includeToolOutputs,
      }, options.env)
      const result: LifecycleResult = {
        saved: candidates.map((candidate) => options.engine.save({
          text: candidate.text,
          category: candidate.category,
          scopeType: candidate.scopeType,
          status: candidate.status,
          source: candidate.source,
          kind: candidate.kind,
          provenance: { ...candidate.provenance, adapter: "codex" },
        })),
        discarded: [],
      }
      log("ok", lifecycleCounts(result))
      return lifecycleNoopOutput(result, debug)
    }

    const result = handlePostToolUse(options.engine, parsed.input)
    log("ok", lifecycleCounts(result))
    return lifecycleNoopOutput(result, debug)
  } catch {
    log("error", { reason: "hook handling failed" })
    return noopOutput("hook handling failed", debug)
  }
}
