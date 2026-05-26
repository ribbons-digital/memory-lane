import * as fs from "node:fs"
import * as path from "node:path"
import { containsLikelySecret } from "@memory-lane/core"
import type { MemoryCandidate, PostToolUseInput } from "./types.js"

const MAX_TOOL_RESPONSE_CHARS = 12_000
const MAX_SAVED_MEMORY_CHARS = 500

export function isShellToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase()
  return normalized === "bash"
    || normalized === "shell"
    || normalized.startsWith("shell:")
    || normalized.includes("localshell")
}

const KNOWN_PREVIEW_FIELDS = ["output", "stdout", "stderr", "message", "text"]
const MAX_PREVIEW_FIELD_CHARS = 2_000

function primitivePreview(value: unknown, maxChars: number): string | undefined {
  if (typeof value === "string") return value.slice(0, maxChars)
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value).slice(0, maxChars)
  return undefined
}

function appendPart(parts: string[], part: string | undefined, currentLength: number): number {
  if (!part) return currentLength
  const remaining = MAX_TOOL_RESPONSE_CHARS - currentLength
  if (remaining <= 0) return currentLength
  const clipped = part.slice(0, remaining)
  parts.push(clipped)
  return currentLength + clipped.length
}

function stringifyPreview(value: unknown): string {
  const primitive = primitivePreview(value, MAX_TOOL_RESPONSE_CHARS)
  if (primitive !== undefined) return primitive
  if (!value || typeof value !== "object") return String(value).slice(0, MAX_TOOL_RESPONSE_CHARS)

  const obj = value as Record<string, unknown>
  const parts: string[] = []
  let currentLength = 0

  for (const key of KNOWN_PREVIEW_FIELDS) {
    currentLength = appendPart(parts, primitivePreview(obj[key], MAX_PREVIEW_FIELD_CHARS), currentLength)
  }

  for (const [key, fieldValue] of Object.entries(obj)) {
    if (currentLength >= MAX_TOOL_RESPONSE_CHARS) break
    if (KNOWN_PREVIEW_FIELDS.includes(key) || key === "toJSON") continue
    currentLength = appendPart(parts, primitivePreview(fieldValue, MAX_PREVIEW_FIELD_CHARS), currentLength)
  }

  return parts.join("\n").slice(0, MAX_TOOL_RESPONSE_CHARS)
}

function commandFromInput(input: unknown): string {
  if (typeof input === "string") return input
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>
    for (const key of ["command", "cmd", "script"]) {
      if (typeof obj[key] === "string") return obj[key] as string
    }
  }
  return ""
}

function exitCodeFromResponse(response: unknown): number | undefined {
  if (!response || typeof response !== "object") return undefined
  const obj = response as Record<string, unknown>
  for (const key of ["exit_code", "exitCode", "code", "status"]) {
    if (typeof obj[key] === "number") return obj[key] as number
  }
  return undefined
}

function isSuccessful(response: unknown, preview: string): boolean {
  const code = exitCodeFromResponse(response)
  if (code !== undefined) return code === 0
  return /\b(?:passed|passes|success|succeeded|completed)\b/iu.test(preview)
}

function hasPnpmLockfile(cwd: string): boolean {
  try {
    return fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))
  } catch {
    return false
  }
}

function projectWorkflowCandidate(
  text: string,
  decision: MemoryCandidate["decision"],
  confidence: number,
  reason: string,
): MemoryCandidate[] {
  if (!text || text.length > MAX_SAVED_MEMORY_CHARS || containsLikelySecret(text)) return []
  return [{
    text,
    category: "project",
    scopeType: "project",
    kind: "workflow_rule",
    confidence,
    decision,
    reason,
    source: "agent-suggested",
  }]
}

export function summarizeToolOutcome(input: PostToolUseInput): MemoryCandidate[] {
  if (!isShellToolName(input.toolName)) return []

  const command = commandFromInput(input.toolInput).trim()
  if (!command || containsLikelySecret(command)) return []

  const responsePreview = stringifyPreview(input.toolResponse)
  if (containsLikelySecret(responsePreview)) return []

  const success = isSuccessful(input.toolResponse, responsePreview)
  if (success && /^pnpm\s+test\b/u.test(command)) {
    return projectWorkflowCandidate("`pnpm test` is the test command for this repo.", "save-approved", 0.92, "successful test command")
  }

  if (success && /^pnpm\s+build\b/u.test(command)) {
    return projectWorkflowCandidate("`pnpm build` is the build command for this repo.", "save-approved", 0.92, "successful build command")
  }

  if (success && /^pnpm\s+install\b/u.test(command)) {
    return projectWorkflowCandidate("This repo installs packages with `pnpm install`.", "save-approved", 0.9, "successful package install command")
  }

  const pnpmEvidence = hasPnpmLockfile(input.cwd) || /\bpnpm\b|pnpm-lock\.yaml/iu.test(responsePreview)
  if (!success && /^npm\s+install\b/u.test(command) && pnpmEvidence) {
    return projectWorkflowCandidate(
      "This repo appears to use pnpm; `npm install` may conflict with the package manager convention.",
      "save-pending",
      0.72,
      "npm install failure with pnpm evidence",
    )
  }

  return []
}
