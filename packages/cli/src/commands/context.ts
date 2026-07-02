import type { MemoryEngine } from "@memory-lane/core"

export interface CliContext {
  argv: string[]
  rest: string[]
  json: boolean
  configPath: string
  engine: MemoryEngine
}
