import {
  appendHookDebugLog, hookDebugEnabled, loadConfig, type HookDebugLogStatus, type MemoryEngine,
} from "@memory-lane/core"
import { captureLifecycleTrace, createOpenAICompatibleProvider, handlePostToolUse, handlePreCompact, handleSessionEnd, handleSessionStart, handleStop, handleUserPromptSubmit, lifecycleDebugCounts, shouldCaptureLifecycleTrace, type LifecycleResult, type TraceFidelity } from "@memory-lane/lifecycle"
import { lifecycleNoopOutput, noopOutput, sessionStartOutput, userPromptSubmitOutput } from "./outputs.js"
import { parseClaudePayload, type ClaudeCommand } from "./payloads.js"
import { readLatestTurnFromTranscript, readSessionMessagesFromTranscript } from "./transcript.js"

export interface RunClaudeHookOptions {
  engine: MemoryEngine
  payloadText: string
  env?: NodeJS.ProcessEnv
  hookDebugLogPath?: string
  configPath?: string
}

function parseJson(text: string): unknown {
  return JSON.parse(text)
}

function systemMessageOutput(message: string): string {
  return JSON.stringify({ systemMessage: `Memory Lane: ${message}` })
}

function createSessionEndSummaryProvider(config: ReturnType<typeof loadConfig>, env: NodeJS.ProcessEnv | undefined) {
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
      timeoutMs: summaryConfig.timeoutMs,
    }, env),
  }
}

function preCompactSummaryEnabled(config: ReturnType<typeof loadConfig>): boolean {
  return config.memory?.sessionEndSummary?.enabled === true && config.memory?.preCompactSummary?.enabled !== false
}

function traceFidelity(inputMessagesLength: number, capturedMessagesLength: number, transcriptPath?: string): TraceFidelity {
  if (transcriptPath && inputMessagesLength === 0 && capturedMessagesLength > 0) return "full-transcript"
  return "payload-messages"
}

function saveSessionEndCandidates(engine: MemoryEngine, candidates: Awaited<ReturnType<typeof handleSessionEnd>>): LifecycleResult {
  return {
    saved: candidates.map((candidate) => engine.save({
      text: candidate.text,
      category: candidate.category,
      scopeType: candidate.scopeType,
      status: candidate.status,
      source: candidate.source,
      kind: candidate.kind,
      provenance: { ...candidate.provenance, adapter: "claude" },
      freshness: candidate.freshness,
    })),
    discarded: [],
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
    if (parsed.kind === "session-start") {
      const result = handleSessionStart(options.engine, parsed.input)
      log("ok", lifecycleDebugCounts(result))
      return sessionStartOutput(result, debug)
    }

    if (parsed.kind === "user-prompt-submit") {
      const result = await handleUserPromptSubmit(options.engine, parsed.input)
      log("ok", lifecycleDebugCounts(result))
      return userPromptSubmitOutput(result, debug)
    }

    if (parsed.kind === "stop") {
      const latest = readLatestTurnFromTranscript(parsed.transcriptPath)
      const result = handleStop(options.engine, {
        ...parsed.input,
        lastUserMessage: parsed.input.lastUserMessage ?? latest.lastUserMessage,
        lastAssistantMessage: parsed.input.lastAssistantMessage ?? latest.lastAssistantMessage,
      }, { adapter: "claude" })
      log("ok", lifecycleDebugCounts(result))
      return lifecycleNoopOutput(result, debug)
    }

    if (parsed.kind === "session-end") {
      const config = loadConfig(options.configPath)
      const summaryProvider = createSessionEndSummaryProvider(config, options.env)
      let transcriptMessages = parsed.input.messages.length ? parsed.input.messages : undefined
      if (shouldCaptureLifecycleTrace(parsed.input.cwd, config)) {
        transcriptMessages ??= readSessionMessagesFromTranscript(parsed.input.transcriptPath)
        captureLifecycleTrace({
          ...parsed.input,
          messages: transcriptMessages,
        }, {
          adapter: "claude",
          lifecycleEvent: "session_end",
          fidelity: traceFidelity(parsed.input.messages.length, transcriptMessages.length, parsed.input.transcriptPath),
          configPath: options.configPath,
          env: options.env,
        })
      }
      if (summaryProvider.status === "disabled") {
        log("noop", { reason: "session-end summarization disabled" })
        return systemMessageOutput("Session-end summarization is not enabled.")
      }
      if (summaryProvider.status === "missing-provider") {
        log("noop", { reason: "session-end summary provider not configured" })
        return systemMessageOutput("Session-end summarization requires memory.sessionEndSummary.baseUrl and model.")
      }
      const requireConfirmation = summaryProvider.config.requireConfirmation !== false
      if (requireConfirmation && !parsed.confirmed) {
        log("noop", { reason: "session-end confirmation required" })
        return systemMessageOutput("Session-end summarization requires confirmation. Rerun the Claude SessionEnd payload with confirmed: true or set memory.sessionEndSummary.requireConfirmation to false.")
      }
      transcriptMessages ??= readSessionMessagesFromTranscript(parsed.input.transcriptPath)
      const candidates = await handleSessionEnd(options.engine, {
        ...parsed.input,
        messages: transcriptMessages,
      }, {
        provider: summaryProvider.provider,
        promptTemplate: summaryProvider.config.promptTemplate ?? undefined,
        maxTokens: summaryProvider.config.maxTokens,
        requireConfirmation: false,
        confirmed: true,
        includeToolOutputs: summaryProvider.config.includeToolOutputs,
        captureTrace: false,
        adapter: "claude",
      }, options.env)
      const result = saveSessionEndCandidates(options.engine, candidates)
      log("ok", lifecycleDebugCounts(result))
      return lifecycleNoopOutput(result, debug)
    }

    if (parsed.kind === "pre-compact") {
      const config = loadConfig(options.configPath)
      let transcriptMessages = parsed.input.messages?.length ? parsed.input.messages : undefined
      if (shouldCaptureLifecycleTrace(parsed.input.cwd, config)) {
        transcriptMessages ??= readSessionMessagesFromTranscript(parsed.input.transcriptPath)
        captureLifecycleTrace({
          ...parsed.input,
          messages: transcriptMessages,
        }, {
          adapter: "claude",
          lifecycleEvent: "pre_compact",
          trigger: parsed.input.trigger,
          fidelity: traceFidelity(parsed.input.messages?.length ?? 0, transcriptMessages.length, parsed.input.transcriptPath),
          configPath: options.configPath,
          env: options.env,
        })
      }
      if (!preCompactSummaryEnabled(config)) {
        log("noop", { reason: "pre-compact summarization disabled" })
        return noopOutput("Pre-compact summarization is not enabled.", debug)
      }
      const summaryProvider = createSessionEndSummaryProvider(config, options.env)
      if (summaryProvider.status !== "configured") {
        log("noop", { reason: "pre-compact summary provider not configured" })
        const message = "Pre-compact summarization requires memory.sessionEndSummary.baseUrl and model."
        return parsed.input.trigger === "auto" ? noopOutput(message, debug) : systemMessageOutput(message)
      }
      if (summaryProvider.config.requireConfirmation !== false) {
        log("noop", { reason: "pre-compact confirmation required" })
        const message = "Pre-compact summarization requires memory.sessionEndSummary.requireConfirmation to be false because PreCompact hooks cannot ask for confirmation."
        return parsed.input.trigger === "auto" ? noopOutput(message, debug) : systemMessageOutput(message)
      }
      transcriptMessages ??= readSessionMessagesFromTranscript(parsed.input.transcriptPath)
      const candidates = await handlePreCompact(options.engine, {
        ...parsed.input,
        messages: transcriptMessages,
      }, {
        provider: summaryProvider.provider,
        promptTemplate: summaryProvider.config.promptTemplate ?? undefined,
        maxTokens: summaryProvider.config.maxTokens,
        requireConfirmation: false,
        confirmed: true,
        includeToolOutputs: summaryProvider.config.includeToolOutputs,
        captureTrace: false,
        adapter: "claude",
      }, options.env)
      const result = saveSessionEndCandidates(options.engine, candidates)
      log("ok", lifecycleDebugCounts(result))
      return lifecycleNoopOutput(result, debug)
    }

    const result = handlePostToolUse(options.engine, parsed.input, { adapter: "claude" })
    log("ok", lifecycleDebugCounts(result))
    return lifecycleNoopOutput(result, debug)
  } catch {
    log("error", { reason: "hook handling failed" })
    return noopOutput("hook handling failed", debug)
  }
}
