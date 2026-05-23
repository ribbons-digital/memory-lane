import type { MemoryRecord, MemoryCategory, MemoryKind } from "./types.js"
import { foldMemoryRecords } from "./storage.js"
import { containsLikelySecret } from "./secret-detection.js"
export { containsLikelySecret } from "./secret-detection.js"

export function normalizeMemoryText(text: string): string {
  return text.trim().replace(/[.!?]+$/u, "").trim()
}

function normalizeForDuplicate(text: string): string {
  return normalizeMemoryText(text).toLowerCase().replace(/\s+/gu, " ").trim()
}

// ── Category & Kind ──────────────────────────────────────────

export function inferCategory(text: string): MemoryCategory {
  const n = text.toLowerCase()
  if (/\b(this project|this repo|repository|repo|project|test command|build command|deploy)\b/u.test(n)) return "project"
  if (/\b(i prefer|i like|i usually|always|never|use .* for|my preference)\b/u.test(n)) return "preference"
  // Broader project indicators: "run tests", "build with", etc.
  if (/\b(?:run\s+(?:the\s+)?tests?|tests?\s+(?:run|use|with)|build\s+(?:command|with)|deploy\s+with)\b/u.test(n)) return "project"
  return "personal"
}

export function inferMemoryKind(text: string, category: MemoryCategory): MemoryKind {
  const n = normalizeMemoryText(text).toLowerCase().replace(/\s+/gu, " ").trim()
  if (/^(?:current\s+progress|progress|checkpoint|current\s+checkpoint)\s*:/u.test(n)) return "project_checkpoint"
  if (/\bwhere\s+we\s+left\s+off\b/u.test(n)) return "project_checkpoint"
  if (/\b(?:tests?\s+run\s+with|test\s+command|build\s+command|deploy\s+command|always\s+use|never\s+use|use\s+.+\s+for\s+package\s+installation)\b/u.test(n)) return "workflow_rule"
  if (/^(?:decision|decided)\s*:/u.test(n) || /\bwe\s+decided\b/u.test(n)) return "decision"
  if (category === "preference") return "preference"
  if (category === "personal") return "personal_context"
  if (category === "project") return "project_fact"
  return "misc"
}

export function effectiveMemoryKind(memory: { text: string; category: MemoryCategory; kind?: unknown }): MemoryKind {
  const kinds = new Set(["preference","personal_context","project_fact","project_checkpoint","workflow_rule","decision","misc"])
  if (typeof memory.kind === "string" && kinds.has(memory.kind)) return memory.kind as MemoryKind
  return inferMemoryKind(memory.text, memory.category)
}

// ── Scope ─────────────────────────────────────────────────────

export function memoryMatchesContext(memory: MemoryRecord, projectKey: string): boolean {
  if (memory.status !== "approved") return false
  if (memory.scope.type === "global") return true
  const key = memory.scope.key ?? memory.project?.key ?? memory.project?.root
  return Boolean(key && key === projectKey)
}

export function filterMemoriesForContext(memories: MemoryRecord[], projectKey: string): MemoryRecord[] {
  return foldMemoryRecords(memories).filter((m) => memoryMatchesContext(m, projectKey))
}

export function searchMemories(memories: MemoryRecord[], query: string, projectKey: string): MemoryRecord[] {
  const visible = filterMemoriesForContext(memories, projectKey)
  const q = query.trim().toLowerCase()
  if (!q) return visible
  return visible.filter((m) =>
    [m.id, m.text, m.category, effectiveMemoryKind(m), m.source, m.scope.type]
      .some((v) => v.toLowerCase().includes(q)))
}

// ── Duplicate ───────────────────────────────────────────────

export function findDuplicateMemory(
  memories: MemoryRecord[], text: string, category: MemoryCategory, scopeType: string, projectKey?: string,
): MemoryRecord | undefined {
  const nt = normalizeForDuplicate(text)
  if (!nt) return undefined
  return foldMemoryRecords(memories).find((m) => {
    if (m.status === "deleted" || m.status === "rejected") return false
    if (m.category !== category || m.scope.type !== scopeType) return false
    if (scopeType === "project") {
      const mk = m.scope.key ?? m.project?.key ?? m.project?.root
      if (!projectKey || !mk || mk !== projectKey) return false
    }
    return normalizeForDuplicate(m.text) === nt
  })
}

// ── Checkpoint Recall ───────────────────────────────────────

export function isCheckpointRecallQuery(query: string): boolean {
  const n = query.toLowerCase().replace(/\s+/gu, " ").trim()
  if (!n) return false
  return /\bwhere\s+(?:did\s+)?we\s+leave\s+off\b/u.test(n) ||
    /\bcontinue\s+(?:where\s+we\s+left\s+off|from\s+last\s+time)\b/u.test(n) ||
    /\bwhat\s+(?:were|was)\s+(?:we|i)\s+working\s+on\b/u.test(n) ||
    /\bcurrent\s+progress\b/u.test(n) ||
    /\bresume\s+work\b/u.test(n)
}

// ── Regex Detection (for adapters that don't have LLM classifier) ─

export function parseExplicitMemoryRequest(text: string): string | undefined {
  const patterns = [
    /^(?:please\s+)?remember(?:\s+that)?\s*[:\-]?\s+(.+)$/iu,
    /^(?:can|could|would|will)\s+you\s+(?:please\s+)?remember(?:\s+that)?\s*[:\-]?\s+(.+)$/iu,
    /^(?:please\s+)?(?:save|store)\s+(?:this\s+)?(?:to|in)\s+memory\s*[:\-]?\s+(.+)$/iu,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text.trim())
    if (match) {
      const memoryText = normalizeMemoryText(match[1] ?? "")
      if (memoryText && !isReferentialMemoryText(memoryText)) return memoryText
    }
  }
  return undefined
}

function isReferentialMemoryText(text: string): boolean {
  const n = text.toLowerCase().replace(/\s+/gu, " ").trim()
  return /\b(?:your|our)\s+(?:progress|work|state|context)\b/u.test(n) ||
    /\b(?:the\s+)?current\s+(?:progress|work|state|context)(?:\s+so\s+far|\s+now)?\b/u.test(n) ||
    /\bprogress\s+so\s+far\b/u.test(n) ||
    /\bwhere\s+(?:we|you)\s+(?:are|were|left\s+off)\b/u.test(n)
}

export function detectUserMemorySuggestion(text: string, _projectKey?: string): { text: string; category: string; scope: string } | undefined {
  const n = normalizeMemoryText(text).toLowerCase().replace(/\s+/gu, " ")
  if (!n || containsLikelySecret(text)) return undefined
  if (/\b(this project|in this repo|this repo|this repository|test command)\b/u.test(n)) return { text: normalizeMemoryText(text), category: "project", scope: "project" }
  if (/\b(i prefer|i like|i usually|my preference is|always use|never use|please always|please never)\b/u.test(n)) return { text: normalizeMemoryText(text), category: "preference", scope: "global" }
  if (/\b(?:my (?:name|timezone|email|role) is|i work at|i live in|i use)\b/u.test(n)) return { text: normalizeMemoryText(text), category: "personal", scope: "global" }
  return undefined
}

export function isCheckpointMemorySaveRequest(text: string): boolean {
  const n = text.toLowerCase().replace(/\s+/gu, " ").trim()
  if (!n || containsLikelySecret(text)) return false
  if (/^(?:what|how|why|when|where|who|do|does|did|is|are)\b/u.test(n)) return false
  return /\b(?:remember|save|store|checkpoint)\b/u.test(n) && (
    /\b(?:your|our)\s+(?:progress|work|state|context)\b/u.test(n) ||
    /\b(?:the\s+)?current\s+(?:progress|work|state|context)/u.test(n) ||
    /\bwhere\s+(?:we|you)\s+(?:are|were|left\s+off)\b/u.test(n)
  )
}
