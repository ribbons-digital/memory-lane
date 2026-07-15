import { containsLikelySecret } from "./secret-detection.js"
import type { MemoryRecord } from "./types.js"

export interface DescriptorPreviewResult {
  text: string
  source: "descriptor" | "body"
  truncated: boolean
}

export function formatPreviewText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/gu, " ").trim()
  if (normalized.length <= maxChars) return normalized
  if (maxChars <= 1) return "…"
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

function compactPreview(text: string, maxChars: number): { text: string; truncated: boolean } {
  const normalized = text.replace(/\s+/gu, " ").trim()
  const formatted = formatPreviewText(text, maxChars)
  return { text: formatted, truncated: formatted !== normalized }
}

export function hasSecretDescriptorMetadata(memory: MemoryRecord): boolean {
  const descriptor = memory.descriptor
  if (!descriptor) return false
  return [descriptor.description, descriptor.fetchHint, ...(descriptor.keywords ?? [])]
    .filter((value): value is string => typeof value === "string")
    .some((value) => containsLikelySecret(value))
}

function compactDescriptorLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim()
}

export function structuredDescriptorText(memory: MemoryRecord): string | undefined {
  const descriptor = memory.descriptor
  const description = descriptor?.description ? compactDescriptorLine(descriptor.description) : undefined
  if (!description) return undefined
  if (hasSecretDescriptorMetadata(memory)) return undefined
  const fetchHint = descriptor?.fetchHint ? compactDescriptorLine(descriptor.fetchHint) : undefined
  return fetchHint
    ? `${description} Fetch when: ${fetchHint}`
    : description
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
