import test from "node:test"
import assert from "node:assert/strict"
import { parseClaudePayload } from "../src/payloads.ts"

test("parses SessionEnd payload with messages and confirmation", () => {
  const parsed = parseClaudePayload({
    hook_event_name: "SessionEnd",
    session_id: "session-1",
    cwd: "/tmp/memory-lane-fixture",
    transcript_path: "/tmp/transcript.jsonl",
    reason: "clear",
    confirmed: true,
    messages: [
      { role: "user", content: "remember this session" },
      { role: "assistant", content: "I will summarize it." },
      { role: "tool", content: "TOOL_MARKER", toolName: "Bash", timestamp: "2026-06-16T00:00:00.000Z" },
    ],
  })

  assert.equal(parsed.kind, "session-end")
  assert.equal(parsed.kind === "session-end" ? parsed.input.cwd : undefined, "/tmp/memory-lane-fixture")
  assert.equal(parsed.kind === "session-end" ? parsed.input.sessionId : undefined, "session-1")
  assert.equal(parsed.kind === "session-end" ? parsed.input.transcriptPath : undefined, "/tmp/transcript.jsonl")
  assert.equal(parsed.kind === "session-end" ? parsed.confirmed : undefined, true)
  assert.equal(parsed.kind === "session-end" ? parsed.reason : undefined, "clear")
  assert.deepEqual(parsed.kind === "session-end" ? parsed.input.messages : undefined, [
    { role: "user", content: "remember this session" },
    { role: "assistant", content: "I will summarize it." },
    { role: "tool", content: "TOOL_MARKER", toolName: "Bash", timestamp: "2026-06-16T00:00:00.000Z" },
  ])
})
