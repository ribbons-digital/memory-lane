#!/usr/bin/env node
import { main } from "./index.js"

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Memory Lane MCP server failed: ${message}`)
  process.exit(1)
})
