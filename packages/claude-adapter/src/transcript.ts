import * as fs from "node:fs"
import type { SessionMessage } from "@memory-lane/lifecycle"

export interface TranscriptTurn {
  lastUserMessage?: string
  lastAssistantMessage?: string
}

const DEFAULT_MAX_BYTES = 200 * 1024

// Tool payloads are not conversation prose; extracting them would let raw
// tool output masquerade as user or assistant messages.
const TOOL_BLOCK_TYPES = new Set(["tool_use", "tool_result"])

function contentToText(content: unknown): string | undefined {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object") {
          const obj = part as Record<string, unknown>
          if (typeof obj.type === "string" && TOOL_BLOCK_TYPES.has(obj.type)) return ""
          if (typeof obj.text === "string") return obj.text
          if (typeof obj.content === "string") return obj.content
        }
        return ""
      })
      .filter(Boolean)
    return parts.length ? parts.join("\n") : undefined
  }
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>
    if (typeof obj.type === "string" && TOOL_BLOCK_TYPES.has(obj.type)) return undefined
    if (typeof obj.text === "string") return obj.text
    return contentToText(obj.content)
  }
  return undefined
}

// Claude Code JSONL wraps each turn as { type, uuid, timestamp, message: { role, content } }.
function transcriptMessageObject(obj: Record<string, unknown>): Record<string, unknown> {
  if (obj.message && typeof obj.message === "object" && !Array.isArray(obj.message)) {
    return obj.message as Record<string, unknown>
  }
  return obj
}

function roleFromObject(obj: Record<string, unknown>): string | undefined {
  const message = transcriptMessageObject(obj)
  const role = message.role ?? obj.role ?? obj.type ?? obj.author
  return typeof role === "string" ? role.toLowerCase() : undefined
}

function textFromObject(obj: Record<string, unknown>): string | undefined {
  const message = transcriptMessageObject(obj)
  return contentToText(message.content ?? message.message ?? message.text)
}

function sessionMessageRole(role: string): SessionMessage["role"] | undefined {
  if (role.includes("user")) return "user"
  if (role.includes("assistant")) return "assistant"
  if (role.includes("tool")) return "tool"
  return undefined
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  return typeof obj[key] === "string" ? obj[key] as string : undefined
}

function readBoundedTranscriptLines(filePath?: string, maxBytes = DEFAULT_MAX_BYTES): string[] {
  if (!filePath) return []
  try {
    const stat = fs.statSync(filePath)
    const safeMaxBytes = Math.max(0, maxBytes)
    const start = Math.max(0, stat.size - safeMaxBytes)
    const length = stat.size - start
    const fd = fs.openSync(filePath, "r")
    try {
      const buffer = Buffer.alloc(length)
      fs.readSync(fd, buffer, 0, length, start)
      return buffer.toString("utf8").split(/\r?\n/u).filter((line) => line.trim())
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return []
  }
}

export function readLatestTurnFromTranscript(filePath?: string, maxBytes = DEFAULT_MAX_BYTES): TranscriptTurn {
  const turn: TranscriptTurn = {}

  for (const line of readBoundedTranscriptLines(filePath, maxBytes)) {
    try {
      const parsed = JSON.parse(line) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue
      const obj = parsed as Record<string, unknown>
      const role = roleFromObject(obj)
      const text = textFromObject(obj)
      if (!role || !text) continue
      if (role.includes("user")) turn.lastUserMessage = text
      if (role.includes("assistant")) turn.lastAssistantMessage = text
    } catch {
      // Transcript formats are best-effort and may contain non-JSON lines.
    }
  }

  return turn
}

export function readSessionMessagesFromTranscript(filePath?: string, maxBytes = DEFAULT_MAX_BYTES): SessionMessage[] {
  const messages: SessionMessage[] = []

  for (const line of readBoundedTranscriptLines(filePath, maxBytes)) {
    try {
      const parsed = JSON.parse(line) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue
      const obj = parsed as Record<string, unknown>
      const role = roleFromObject(obj)
      const messageRole = role ? sessionMessageRole(role) : undefined
      const content = textFromObject(obj)
      if (!messageRole || !content) continue
      messages.push({
        role: messageRole,
        content,
        timestamp: stringField(obj, "timestamp"),
        toolName: stringField(obj, "toolName") ?? stringField(obj, "tool_name"),
      })
    } catch {
      // Transcript formats are best-effort and may contain non-JSON lines.
    }
  }

  return messages
}
