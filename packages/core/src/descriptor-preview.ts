import { containsLikelySecret } from "./secret-detection.js"
import type { MemoryRecord } from "./types.js"

export interface DescriptorPreviewResult {
  text: string
  source: "descriptor" | "body"
  truncated: boolean
}

function compactPreview(text: string, maxChars: number): { text: string; truncated: boolean } {
  const normalized = text.replace(/\s+/gu, " ").trim()
  if (normalized.length <= maxChars) return { text: normalized, truncated: false }
  if (maxChars <= 1) return { text: "…", truncated: true }
  return { text: `${normalized.slice(0, maxChars - 1).trimEnd()}…`, truncated: true }
}

export function hasSecretDescriptorMetadata(memory: MemoryRecord): boolean {
  const descriptor = memory.descriptor
  if (!descriptor) return false
  return [descriptor.description, descriptor.fetchHint, ...(descriptor.keywords ?? [])]
    .filter((value): value is string => typeof value === "string")
    .some((value) => containsLikelySecret(value))
}

export function structuredDescriptorText(memory: MemoryRecord): string | undefined {
  const descriptor = memory.descriptor
  if (!descriptor?.description) return undefined
  if (hasSecretDescriptorMetadata(memory)) return undefined
  return descriptor.fetchHint
    ? `${descriptor.description} Fetch when: ${descriptor.fetchHint}`
    : descriptor.description
}

export function memoryDescriptorPreview(memory: MemoryRecord, maxChars: number): DescriptorPreviewResult | undefined {
  if (containsLikelySecret(memory.text)) return undefined
  const descriptorText = structuredDescriptorText(memory)
  const compact = compactPreview(descriptorText ?? memory.text, maxChars)
  return {
    text: compact.text,
    source: descriptorText ? "descriptor" : "body",
    truncated: compact.truncated,
  }
}
