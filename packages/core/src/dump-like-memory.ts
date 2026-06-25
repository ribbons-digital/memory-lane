const LEADING_SKILL_BLOCK_PATTERN = /^\s*<skill>[\s\S]*?<\/skill>/iu
const LEADING_SKILL_OPEN_PATTERN = /^\s*<skill>\s*\n\s*<name>[^\n<]+<\/name>/iu
const SKILL_METADATA_PATTERN = /^\s*(?:<skill>[\s\S]{0,600}?)?---\s*\n\s*name:\s*[^\n]+\n\s*description:\s*[^\n]+/iu
const CLI_REFERENCE_SHAPE_PATTERN = /\n\s*(?:##\s+(?:Quick Reference|Common Patterns|Safety Rules|Workflow)|\|\s*Command\s*\|\s*Purpose\s*\|)/iu

export function isDumpLikeMemoryBody(text: string): boolean {
  const normalized = text.trimStart()
  if (LEADING_SKILL_BLOCK_PATTERN.test(normalized)) return true
  if (LEADING_SKILL_OPEN_PATTERN.test(normalized) && SKILL_METADATA_PATTERN.test(normalized)) return true
  if (SKILL_METADATA_PATTERN.test(normalized) && CLI_REFERENCE_SHAPE_PATTERN.test(normalized)) return true
  return false
}
