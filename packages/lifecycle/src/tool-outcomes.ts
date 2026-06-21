import * as fs from "node:fs"
import * as path from "node:path"
import { containsLikelySecret, normalizeMemoryText } from "@memory-lane/core"
import type { MemoryEngine, MemoryRecord } from "@memory-lane/core"
import type { MemoryCandidate, PostToolUseInput, RecentToolUse } from "./types.js"

const MAX_TOOL_RESPONSE_CHARS = 12_000
const MAX_SAVED_MEMORY_CHARS = 500
const MAX_RECENT_TOOL_USES = 6

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

function projectProcedureCandidate(text: string, confidence: number, reason: string): MemoryCandidate[] {
  if (!text || text.length > MAX_SAVED_MEMORY_CHARS || containsLikelySecret(text)) return []
  return [{
    text,
    category: "project",
    scopeType: "project",
    kind: "procedure",
    confidence,
    decision: "save-pending",
    reason,
    source: "agent-suggested",
  }]
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/gu, " ")
}

function commandIs(command: string, pattern: RegExp): boolean {
  return pattern.test(normalizeCommand(command))
}

function isPnpmTest(command: string): boolean {
  return commandIs(command, /^pnpm\s+test\b/u)
}

function isPnpmBuild(command: string): boolean {
  return commandIs(command, /^pnpm\s+build\b/u)
}

function isPnpmInstall(command: string): boolean {
  return commandIs(command, /^pnpm\s+(?:install|i)\b/u)
}

function failedTestCommand(command: string): boolean {
  return commandIs(command, /^(?:npm\s+(?:test|run\s+test)|yarn\s+test|bun\s+test)\b/u)
}

function failedBuildCommand(command: string): boolean {
  return commandIs(command, /^(?:npm\s+(?:build|run\s+build)|yarn\s+build|bun\s+build)\b/u)
}

function failedNpmInstallCommand(command: string): boolean {
  return commandIs(command, /^npm\s+(?:install|i)\b/u)
}

interface SafeToolOutcome {
  command: string
  preview: string
  success: boolean
}

function safeShellOutcome(entry: Pick<PostToolUseInput, "cwd" | "toolName" | "toolInput" | "toolResponse">): SafeToolOutcome | undefined {
  if (!isShellToolName(entry.toolName)) return undefined
  const command = commandFromInput(entry.toolInput).trim()
  if (!command || containsLikelySecret(command)) return undefined
  const preview = stringifyPreview(entry.toolResponse)
  if (containsLikelySecret(preview)) return undefined
  return { command, preview, success: isSuccessful(entry.toolResponse, preview) }
}

function currentRecoveryProcedure(input: PostToolUseInput, current: SafeToolOutcome, pnpmEvidence: boolean): MemoryCandidate[] {
  if (!current.success || !input.recentToolUses?.length) return []

  const recent = input.recentToolUses
    .slice(-MAX_RECENT_TOOL_USES)
    .map((entry: RecentToolUse) => safeShellOutcome({ ...entry, cwd: input.cwd }))
    .filter((entry): entry is SafeToolOutcome => Boolean(entry))

  const hasFailed = (predicate: (command: string) => boolean): boolean => recent.some((entry) => !entry.success && predicate(entry.command))

  if (isPnpmTest(current.command) && hasFailed(failedTestCommand)) {
    return projectProcedureCandidate(
      "Procedure: Use pnpm for tests in this repo. When: verifying changes. Steps: run `pnpm test`. Pitfall: `npm test` or another non-pnpm test command failed or was unavailable. Verify: `pnpm test` succeeded.",
      0.82,
      "test command recovered with pnpm",
    )
  }

  if (isPnpmBuild(current.command) && hasFailed(failedBuildCommand)) {
    return projectProcedureCandidate(
      "Procedure: Use pnpm for builds in this repo. When: verifying build health. Steps: run `pnpm build`. Pitfall: `npm run build` or another non-pnpm build command failed or was unavailable. Verify: `pnpm build` succeeded.",
      0.82,
      "build command recovered with pnpm",
    )
  }

  if ((isPnpmInstall(current.command) || pnpmEvidence) && hasFailed(failedNpmInstallCommand)) {
    return projectProcedureCandidate(
      "Procedure: Use pnpm for package installation in this repo. When: installing dependencies. Steps: run `pnpm install`. Pitfall: `npm install` conflicted with the repo package-manager convention. Verify: pnpm evidence was present or `pnpm install` succeeded.",
      0.8,
      "package install recovered with pnpm",
    )
  }

  return []
}

export function procedureKeyFromText(text: string): string | undefined {
  const normalized = normalizeMemoryText(text).toLowerCase().replace(/\s+/gu, " ").trim()
  if (!normalized) return undefined
  if (/\bpnpm\s+test\b/u.test(normalized) || /test command for this repo/u.test(normalized)) return "procedure:test-command:pnpm-test"
  if (/\bpnpm\s+build\b/u.test(normalized) || /build command for this repo/u.test(normalized)) return "procedure:build-command:pnpm-build"
  if (/\bpnpm\s+(?:install|i)\b/u.test(normalized) || /package manager convention/u.test(normalized) || /uses pnpm|use pnpm|repo installs packages with `pnpm install`/u.test(normalized)) return "procedure:package-manager:pnpm-install"
  return undefined
}

function memoryProjectKey(memory: MemoryRecord): string | undefined {
  return memory.scope.key ?? memory.project?.key ?? memory.project?.root
}

function visibleProjectLearning(memory: MemoryRecord, projectScopeKey?: string): boolean {
  if (memory.status !== "pending" && memory.status !== "approved") return false
  if (memory.scope.type !== "project") return false
  if (!projectScopeKey || memoryProjectKey(memory) !== projectScopeKey) return false
  return memory.kind === "procedure" || memory.kind === "workflow_rule" || memory.kind === "correction"
}

export function filterDuplicateProcedureCandidates(engine: MemoryEngine, candidates: MemoryCandidate[]): MemoryCandidate[] {
  const projectScopeKey = engine.getProjectScope()?.key
  const existingKeys = new Set(
    engine.list()
      .filter((memory) => visibleProjectLearning(memory, projectScopeKey))
      .map((memory) => procedureKeyFromText(memory.text))
      .filter((key): key is string => Boolean(key)),
  )
  const seen = new Set<string>()
  const result: MemoryCandidate[] = []

  for (const candidate of candidates) {
    if (candidate.kind !== "procedure") {
      result.push(candidate)
      continue
    }
    const key = procedureKeyFromText(candidate.text)
    if (!key || existingKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }

  return result
}

export function summarizeToolOutcome(input: PostToolUseInput): MemoryCandidate[] {
  if (!isShellToolName(input.toolName)) return []

  const command = commandFromInput(input.toolInput).trim()
  if (!command || containsLikelySecret(command)) return []

  const responsePreview = stringifyPreview(input.toolResponse)
  if (containsLikelySecret(responsePreview)) return []

  const success = isSuccessful(input.toolResponse, responsePreview)
  const pnpmEvidence = hasPnpmLockfile(input.cwd) || /\bpnpm\b|pnpm-lock\.yaml/iu.test(responsePreview)
  const current = safeShellOutcome(input)
  const recoveryProcedures = current ? currentRecoveryProcedure(input, current, pnpmEvidence) : []
  if (recoveryProcedures.length > 0) return recoveryProcedures

  const candidates: MemoryCandidate[] = []

  if (success && isPnpmTest(command)) {
    candidates.push(...projectWorkflowCandidate("`pnpm test` is the test command for this repo.", "save-approved", 0.92, "successful test command"))
  }

  if (success && isPnpmBuild(command)) {
    candidates.push(...projectWorkflowCandidate("`pnpm build` is the build command for this repo.", "save-approved", 0.92, "successful build command"))
  }

  if (success && isPnpmInstall(command)) {
    candidates.push(...projectWorkflowCandidate("This repo installs packages with `pnpm install`.", "save-approved", 0.9, "successful package install command"))
  }

  if (!success && failedNpmInstallCommand(command) && pnpmEvidence) {
    candidates.push(...projectWorkflowCandidate(
      "This repo appears to use pnpm; `npm install` may conflict with the package manager convention.",
      "save-pending",
      0.72,
      "npm install failure with pnpm evidence",
    ))
  }

  return candidates
}
