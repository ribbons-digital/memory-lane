import { containsLikelySecret, type MemoryEngine } from "@memory-lane/core"
import { createOpenAICompatibleProvider } from "./llm-provider.js"
import type { LLMProvider, SessionEndInput, SessionEndOptions } from "./types.js"

export const DEFAULT_SESSION_END_PROMPT = `You are summarizing an AI-assisted coding session for a memory system.
Read the session transcript and produce a concise, structured summary.

Include only these sections if they have content:
- Decisions made
- Blockers or failures
- Open questions
- Next steps
- Key facts about the project, codebase, or user preferences

Rules:
- Do not include secrets, API keys, passwords, or private data.
- Do not include transient commands or raw tool output.
- Be specific but brief. Use Markdown bullet lists.
- If the session had no durable takeaways, return exactly NO_DURABLE_MEMORY.

Transcript:
{{transcript}}`

function renderTranscript(messages: SessionEndInput["messages"], includeToolOutputs: boolean): string {
  return messages
    .filter((m) => includeToolOutputs || m.role !== "tool")
    .map((m) => {
      const prefix = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : `Tool (${m.toolName ?? "unknown"})`
      const safeContent = m.content.split("\n").map((line) => (containsLikelySecret(line) ? "[redacted]" : line)).join("\n")
      return `[${prefix}]: ${safeContent}`
    })
    .join("\n\n")
}

function createPrompt(template: string, transcript: string): string {
  return template.replace("{{transcript}}", transcript)
}

function resolveProvider(options: SessionEndOptions, env: NodeJS.ProcessEnv): LLMProvider | undefined {
  if (options.provider) return options.provider
  if (options.providerConfig) return createOpenAICompatibleProvider(options.providerConfig, env)
  return undefined
}

export interface SessionEndCandidate {
  text: string
  category: "project"
  scopeType: "project" | "global"
  kind: "session_summary"
  status: "pending"
  source: "session-summary"
  provenance: {
    adapter: string
    lifecycleEvent: "session_end"
    sessionId?: string
  }
}

export async function handleSessionEnd(
  engine: MemoryEngine,
  input: SessionEndInput,
  options: SessionEndOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionEndCandidate[]> {
  engine.refreshScope(input.cwd)
  const scope = engine.getProjectScope()

  if (options.requireConfirmation !== false && !options.confirmed) {
    return []
  }

  const provider = resolveProvider(options, env)
  if (!provider) {
    throw new Error("Session-end summarization is enabled but no LLM provider is configured")
  }

  const transcript = renderTranscript(input.messages, options.includeToolOutputs ?? false)
  if (!transcript.trim()) return []

  const prompt = createPrompt(options.promptTemplate ?? DEFAULT_SESSION_END_PROMPT, transcript)
  const raw = await provider.complete(prompt, { maxTokens: options.maxTokens })

  if (/^NO_DURABLE_MEMORY[.\s]*$/iu.test(raw.trim())) return []

  const heading = `## Session Summary (${new Date().toISOString().slice(0, 10)})`
  const text = [heading, "", raw].join("\n")

  return [{
    text,
    category: "project",
    scopeType: scope ? "project" : "global",
    kind: "session_summary",
    status: "pending",
    source: "session-summary",
    provenance: {
      adapter: options.providerConfig?.provider ?? "manual",
      lifecycleEvent: "session_end",
      sessionId: input.sessionId,
    },
  }]
}
