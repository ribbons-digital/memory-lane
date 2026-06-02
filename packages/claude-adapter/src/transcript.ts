import * as fs from "node:fs"

export interface TranscriptTurn {
  lastUserMessage?: string
  lastAssistantMessage?: string
}

const DEFAULT_MAX_BYTES = 200 * 1024

function contentToText(content: unknown): string | undefined {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object") {
          const obj = part as Record<string, unknown>
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
    if (typeof obj.text === "string") return obj.text
    if (typeof obj.content === "string") return obj.content
  }
  return undefined
}

function roleFromObject(obj: Record<string, unknown>): string | undefined {
  const role = obj.role ?? obj.type ?? obj.author
  return typeof role === "string" ? role.toLowerCase() : undefined
}

function textFromObject(obj: Record<string, unknown>): string | undefined {
  return contentToText(obj.content ?? obj.message ?? obj.text)
}

export function readLatestTurnFromTranscript(filePath?: string, maxBytes = DEFAULT_MAX_BYTES): TranscriptTurn {
  if (!filePath) return {}
  try {
    const stat = fs.statSync(filePath)
    const safeMaxBytes = Math.max(0, maxBytes)
    const start = Math.max(0, stat.size - safeMaxBytes)
    const length = stat.size - start
    const fd = fs.openSync(filePath, "r")
    try {
      const buffer = Buffer.alloc(length)
      fs.readSync(fd, buffer, 0, length, start)
      const lines = buffer.toString("utf8").split(/\r?\n/u).filter((line) => line.trim())
      const turn: TranscriptTurn = {}

      for (const line of lines) {
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
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return {}
  }
}
