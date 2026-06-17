import type { MemoryLifecycleEvent, MemoryRecord, MemorySource } from "./types.js"

export interface ReviewGroup {
  key: string
  label: string
  projectScope: string
  source: MemorySource
  kind: string
  adapter: string
  lifecycleEvent: MemoryLifecycleEvent | "none"
  count: number
  memoryIds: string[]
}

export function reviewProjectScope(memory: MemoryRecord): string {
  if (memory.scope.type === "global") return "global"
  return memory.scope.key ?? memory.project?.key ?? memory.project?.root ?? "project:unknown"
}

export function reviewProvenance(memory: MemoryRecord): { adapter: string; lifecycleEvent: MemoryLifecycleEvent | "none" } {
  return {
    adapter: memory.provenance?.adapter ?? "none",
    lifecycleEvent: memory.provenance?.lifecycleEvent ?? "none",
  }
}

export function groupReviewMemories(memories: MemoryRecord[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>()
  for (const memory of memories) {
    const projectScope = reviewProjectScope(memory)
    const kind = memory.kind ?? "misc"
    const provenance = reviewProvenance(memory)
    const key = [projectScope, memory.source, kind, provenance.adapter, provenance.lifecycleEvent].join("\u0000")
    const label = `Project: ${projectScope} | Source: ${memory.source} | Kind: ${kind} | Provenance: ${provenance.adapter === "none" ? "none" : `${provenance.adapter}/${provenance.lifecycleEvent}`}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      existing.memoryIds.push(memory.id)
      continue
    }
    groups.set(key, {
      key,
      label,
      projectScope,
      source: memory.source,
      kind,
      adapter: provenance.adapter,
      lifecycleEvent: provenance.lifecycleEvent,
      count: 1,
      memoryIds: [memory.id],
    })
  }
  return [...groups.values()]
}
