import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseCodexPayload } from "../src/payloads.ts"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(__dirname, "fixtures")

test("parses UserPromptSubmit payload", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(fixtures, "user-prompt-submit.json"), "utf8"))
  const parsed = parseCodexPayload(raw)
  assert.equal(parsed.kind, "user-prompt-submit")
  assert.equal(parsed.kind === "user-prompt-submit" ? parsed.input.prompt : undefined, "How do we run tests in this repo?")
  assert.equal(parsed.kind === "user-prompt-submit" ? parsed.input.sessionId : undefined, "session-1")
})

test("parses PostToolUse payload", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(fixtures, "post-tool-use-shell-success.json"), "utf8"))
  const parsed = parseCodexPayload(raw)
  assert.equal(parsed.kind, "post-tool-use")
  assert.equal(parsed.kind === "post-tool-use" ? parsed.input.toolName : undefined, "Bash")
})

test("returns invalid for malformed payload", () => {
  const parsed = parseCodexPayload({ hook_event_name: "Stop" })
  assert.equal(parsed.kind, "invalid")
})
