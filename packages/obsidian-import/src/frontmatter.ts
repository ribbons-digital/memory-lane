import type { ParsedObsidianFrontmatter, ParsedObsidianNote } from "./types.js"

const RECOGNIZED_FIELDS = new Set([
  "memory_lane",
  "memory_lane_mirror",
  "memory_lane_id",
  "category",
  "scope",
  "status",
  "kind",
])

function stripBom(content: string): string {
  return content.startsWith("\uFEFF") ? content.slice(1) : content
}

function isDelimiter(line: string): boolean {
  return line.replace(/\r$/u, "") === "---"
}

function parseScalar(rawValue: string): string | boolean {
  const value = rawValue.trim()
  if (value === "true" || value === "false") return value === "true"

  if (value.length >= 2) {
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
      const inner = value.slice(1, -1)
      if (inner === "true" || inner === "false") return inner === "true"
      if (quote === '"') {
        try {
          const parsed = JSON.parse(value) as unknown
          return typeof parsed === "string" ? parsed : inner
        } catch {
          return inner
        }
      }
      return inner.replace(/''/gu, "'")
    }
  }

  return value
}

function parseFrontmatterBlock(block: string): { fields: ParsedObsidianFrontmatter; warnings: string[] } {
  const fields: ParsedObsidianFrontmatter = {}
  const warnings: string[] = []

  for (const rawLine of block.split(/\n/u)) {
    const line = rawLine.replace(/\r$/u, "")
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const colon = line.indexOf(":")
    if (colon === -1) {
      warnings.push(`malformed frontmatter line: ${trimmed}`)
      continue
    }

    const key = line.slice(0, colon).trim()
    if (!RECOGNIZED_FIELDS.has(key)) continue

    const rawValue = line.slice(colon + 1)
    fields[key as keyof ParsedObsidianFrontmatter] = parseScalar(rawValue)
  }

  return { fields, warnings }
}

export function parseObsidianMarkdown(content: string): ParsedObsidianNote {
  const normalized = stripBom(content)
  const lines = normalized.split(/\n/u)

  if (!lines[0] || !isDelimiter(lines[0])) {
    return {
      frontmatter: null,
      body: normalized.trim(),
      warnings: ["missing top-of-file frontmatter"],
    }
  }

  let closingLineIndex = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (isDelimiter(lines[index] ?? "")) {
      closingLineIndex = index
      break
    }
  }

  if (closingLineIndex === -1) {
    return {
      frontmatter: null,
      body: normalized.trim(),
      warnings: ["malformed frontmatter: missing closing delimiter"],
    }
  }

  const frontmatterBlock = lines.slice(1, closingLineIndex).join("\n")
  const body = lines.slice(closingLineIndex + 1).join("\n").trim()
  const parsed = parseFrontmatterBlock(frontmatterBlock)

  return {
    frontmatter: parsed.fields,
    body,
    warnings: parsed.warnings,
  }
}
