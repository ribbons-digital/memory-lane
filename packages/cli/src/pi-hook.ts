import {
  appendHookDebugLog, hookDebugEnabled, loadConfig, skippedSecretCount, type HookDebugLogStatus, type MemoryEngine, type SaveResult,
} from "@memory-lane/core"
import { captureLifecycleTrace, classifyTraceFidelity, createOpenAICompatibleProvider, handlePreCompact, shouldCaptureLifecycleTrace, type SessionMessage } from "@memory-lane/lifecycle"

export interface RunPiHookOptions {
  engine: MemoryEngine
  payloadText: string
  env?: NodeJS.ProcessEnv
  hookDebugLogPath?: string
  configPath?: string
}

type PiCommand = "pre-compact"

interface PiPreCompactPayloadInput {
  cwd: string
  sessionId?: string
  turnId?: string
  trigger?: string
  messages: SessionMessage[]
}

type ParsedPiPayload =
  | { kind: "pre-compact"; input: PiPreCompactPayloadInput }
  | { kind: "invalid"; reason: string }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  return typeof obj[key] === "string" ? obj[key] as string : undefined
}

function parseSessionMessages(value: unknown): SessionMessage[] {
  if (!Array.isArray(value)) return []
  const messages: SessionMessage[] = []
  for (const item of value) {
    const obj = asRecord(item)
    if (!obj) continue
    const role = stringField(obj, "role")
    const content = stringField(obj, "content")
    if ((role !== "user" && role !== "assistant" && role !== "tool") || !content) continue
    const message: SessionMessage = { role, content }
    const timestamp = stringField(obj, "timestamp")
    const toolName = stringField(obj, "toolName") ?? stringField(obj, "tool_name")
    if (timestamp) message.timestamp = timestamp
    if (toolName) message.toolName = toolName
    messages.push(message)
  }
  return messages
}

function parsePiPayload(text: string): ParsedPiPayload {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return { kind: "invalid", reason: "invalid JSON payload" }
  }

  const obj = asRecord(payload)
  if (!obj) return { kind: "invalid", reason: "payload is not an object" }
  const cwd = stringField(obj, "cwd")
  if (!cwd) return { kind: "invalid", reason: "payload missing cwd" }
  return {
    kind: "pre-compact",
    input: {
      cwd,
      sessionId: (stringField(obj, "session_id") ?? stringField(obj, "sessionId"))?.trim() || undefined,
      turnId: (stringField(obj, "turn_id") ?? stringField(obj, "turnId"))?.trim() || undefined,
      trigger: stringField(obj, "trigger"),
      messages: parseSessionMessages(obj.messages),
    },
  }
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

function saveSessionSummaryCandidates(engine: MemoryEngine, candidates: Awaited<ReturnType<typeof handlePreCompact>>): SaveResult[] {
  return candidates.map((candidate) => engine.save({
    text: candidate.text,
    category: candidate.category,
    scopeType: candidate.scopeType,
    status: candidate.status,
    source: candidate.source,
    kind: candidate.kind,
    provenance: { ...candidate.provenance, adapter: "pi" },
    freshness: candidate.freshness,
  }))
}

function output(data: { saved?: number; skipped?: number; discarded?: number; reason?: string; message?: string }): string {
  return JSON.stringify({ ok: true, data: { saved: 0, skipped: 0, discarded: 0, ...data } })
}

function counts(saved: SaveResult[]): { saved: number; skipped: number; skippedSecret?: number } {
  return {
    saved: saved.filter((result) => result.status === "saved").length,
    skipped: saved.filter((result) => result.status === "skipped").length,
    skippedSecret: skippedSecretCount(saved),
  }
}

export async function runPiHookCommand(command: PiCommand, options: RunPiHookOptions): Promise<string> {
  const startedAt = Date.now()
  const debug = hookDebugEnabled(options.env)
  const log = (status: HookDebugLogStatus, fields: Record<string, unknown> = {}) => {
    if (!debug) return
    appendHookDebugLog({
      adapter: "pi",
      event: command,
      cwd: process.cwd(),
      status,
      ...fields,
      durationMs: Date.now() - startedAt,
    }, { filePath: options.hookDebugLogPath })
  }

  const parsed = parsePiPayload(options.payloadText)
  if (parsed.kind === "invalid") {
    log("noop", { reason: parsed.reason })
    return output({ reason: parsed.reason })
  }

  try {
    const config = loadConfig(options.configPath)
    if (parsed.input.messages.length && shouldCaptureLifecycleTrace(parsed.input.cwd, config)) {
      captureLifecycleTrace({
        ...parsed.input,
        messages: parsed.input.messages,
      }, {
        adapter: "pi",
        lifecycleEvent: "pre_compact",
        trigger: parsed.input.trigger,
        fidelity: classifyTraceFidelity(parsed.input.messages.length, parsed.input.messages.length),
        configPath: options.configPath,
        env: options.env,
      })
    }
    if (!preCompactSummaryEnabled(config)) {
      const reason = "pre-compact summarization disabled"
      log("noop", { reason })
      return output({ reason, message: "Pre-compact summarization is not enabled." })
    }

    const summaryProvider = createSessionEndSummaryProvider(config, options.env)
    if (summaryProvider.status !== "configured") {
      const reason = "pre-compact summary provider not configured"
      const message = "Pre-compact summarization requires memory.sessionEndSummary.baseUrl and model."
      log("noop", { reason })
      return output({ reason, message })
    }

    if (summaryProvider.config.requireConfirmation !== false) {
      const reason = "pre-compact confirmation required"
      const message = "Pre-compact summarization requires memory.sessionEndSummary.requireConfirmation to be false because PreCompact hooks cannot ask for confirmation."
      log("noop", { reason })
      return output({ reason, message })
    }

    if (!parsed.input.messages.length) {
      const reason = "no conversation text found"
      log("noop", { reason })
      return output({ reason })
    }

    options.engine.refreshScope(parsed.input.cwd)
    const candidates = await handlePreCompact(options.engine, {
      ...parsed.input,
      messages: parsed.input.messages,
    }, {
      provider: summaryProvider.provider,
      promptTemplate: summaryProvider.config.promptTemplate ?? undefined,
      maxTokens: summaryProvider.config.maxTokens,
      requireConfirmation: false,
      confirmed: true,
      includeToolOutputs: summaryProvider.config.includeToolOutputs,
      adapter: "pi",
      trigger: parsed.input.trigger,
      captureTrace: false,
    }, options.env)

    const savedResults = saveSessionSummaryCandidates(options.engine, candidates)
    const resultCounts = counts(savedResults)
    log("ok", { saved: resultCounts.saved, skipped: resultCounts.skipped, skippedSecret: resultCounts.skippedSecret, discarded: 0, additionalContext: false, warningCount: 0 })
    return output(resultCounts)
  } catch (error) {
    const reason = "hook handling failed"
    log("error", { reason })
    return output({ reason, ...(debug ? { message: error instanceof Error ? error.message : String(error) } : {}) })
  }
}
