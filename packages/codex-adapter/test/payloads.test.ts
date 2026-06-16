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

test("parses Stop payload", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(fixtures, "stop.json"), "utf8"))
  const parsed = parseCodexPayload(raw)
  assert.equal(parsed.kind, "stop")
  assert.equal(parsed.kind === "stop" ? parsed.input.lastAssistantMessage : undefined, "Got it. I will remember that this repo uses pnpm.")
  assert.equal(parsed.kind === "stop" ? parsed.input.sessionId : undefined, "session-1")
})

test("parses PostToolUse payload", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(fixtures, "post-tool-use-shell-success.json"), "utf8"))
  const parsed = parseCodexPayload(raw)
  assert.equal(parsed.kind, "post-tool-use")
  assert.equal(parsed.kind === "post-tool-use" ? parsed.input.toolName : undefined, "Bash")
})

test("parses shell failure PostToolUse payload", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(fixtures, "post-tool-use-shell-failure.json"), "utf8"))
  const parsed = parseCodexPayload(raw)
  assert.equal(parsed.kind, "post-tool-use")
  assert.equal(parsed.kind === "post-tool-use" ? parsed.input.toolName : undefined, "Bash")
  assert.deepEqual(parsed.kind === "post-tool-use" ? parsed.input.toolInput : undefined, { command: "npm install left-pad" })
})

test("returns invalid for malformed payload", () => {
  const parsed = parseCodexPayload({ hook_event_name: "Stop" })
  assert.equal(parsed.kind, "invalid")
})

test("parses SessionStart payload", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(fixtures, "session-start.json"), "utf8"))
  const parsed = parseCodexPayload(raw)
  assert.equal(parsed.kind, "session-start")
  assert.equal(parsed.kind === "session-start" ? parsed.input.cwd : undefined, "/tmp/memory-lane-fixture")
  assert.equal(parsed.kind === "session-start" ? parsed.input.sessionId : undefined, "session-1")
})

test("parses SessionEnd payload with messages and confirmation", () => {
  const parsed = parseCodexPayload({
    hook_event_name: "SessionEnd",
    session_id: "session-1",
    cwd: "/tmp/memory-lane-fixture",
    transcript_path: null,
    model: "gpt-5-codex",
    confirmed: true,
    messages: [
      { role: "user", content: "Use pnpm", timestamp: "2026-06-16T00:00:00Z" },
      { role: "assistant", content: "Done." },
      { role: "tool", tool_name: "Bash", content: "pnpm test" },
    ],
  })
  assert.equal(parsed.kind, "session-end")
  assert.equal(parsed.kind === "session-end" ? parsed.confirmed : undefined, true)
  assert.equal(parsed.kind === "session-end" ? parsed.input.cwd : undefined, "/tmp/memory-lane-fixture")
  assert.equal(parsed.kind === "session-end" ? parsed.input.sessionId : undefined, "session-1")
  assert.deepEqual(parsed.kind === "session-end" ? parsed.input.messages : undefined, [
    { role: "user", content: "Use pnpm", timestamp: "2026-06-16T00:00:00Z", toolName: undefined },
    { role: "assistant", content: "Done.", timestamp: undefined, toolName: undefined },
    { role: "tool", content: "pnpm test", timestamp: undefined, toolName: "Bash" },
  ])
})
