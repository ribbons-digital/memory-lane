import type { PostToolUseInput, StopInput, UserPromptInput } from "@memory-lane/lifecycle"

export type CodexCommand = "user-prompt-submit" | "stop" | "post-tool-use"

export type ParsedCodexPayload =
  | { kind: "user-prompt-submit"; hookEventName: "UserPromptSubmit"; input: UserPromptInput }
  | { kind: "stop"; hookEventName: "Stop"; input: StopInput; transcriptPath?: string }
  | { kind: "post-tool-use"; hookEventName: "PostToolUse"; input: PostToolUseInput }
  | { kind: "invalid"; reason: string }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  return typeof obj[key] === "string" ? obj[key] as string : undefined
}

function nullableStringField(obj: Record<string, unknown>, key: string): string | undefined {
  return typeof obj[key] === "string" ? obj[key] as string : undefined
}

function baseContext(obj: Record<string, unknown>) {
  return {
    cwd: stringField(obj, "cwd") ?? "",
    sessionId: stringField(obj, "session_id"),
    turnId: stringField(obj, "turn_id"),
    model: stringField(obj, "model"),
    transcriptPath: nullableStringField(obj, "transcript_path"),
  }
}

export function parseCodexPayload(value: unknown): ParsedCodexPayload {
  const obj = asRecord(value)
  if (!obj) return { kind: "invalid", reason: "payload is not an object" }

  const event = stringField(obj, "hook_event_name")
  const cwd = stringField(obj, "cwd")
  if (!event || !cwd) return { kind: "invalid", reason: "payload missing hook_event_name or cwd" }

  const context = baseContext(obj)

  if (event === "UserPromptSubmit") {
    const prompt = stringField(obj, "prompt")
    if (prompt === undefined) return { kind: "invalid", reason: "UserPromptSubmit missing prompt" }
    return {
      kind: "user-prompt-submit",
      hookEventName: event,
      input: { ...context, prompt },
    }
  }

  if (event === "Stop") {
    return {
      kind: "stop",
      hookEventName: event,
      transcriptPath: context.transcriptPath,
      input: { ...context, lastUserMessage: nullableStringField(obj, "last_user_message"), lastAssistantMessage: nullableStringField(obj, "last_assistant_message") },
    }
  }

  if (event === "PostToolUse") {
    const toolName = stringField(obj, "tool_name")
    if (!toolName) return { kind: "invalid", reason: "PostToolUse missing tool_name" }
    return {
      kind: "post-tool-use",
      hookEventName: event,
      input: {
        ...context,
        toolName,
        toolInput: obj.tool_input,
        toolResponse: obj.tool_response,
      },
    }
  }

  return { kind: "invalid", reason: `unsupported hook_event_name ${event}` }
}
