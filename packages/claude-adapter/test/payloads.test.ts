import test from "node:test"
import assert from "node:assert/strict"
import { parseClaudePayload } from "../src/payloads.ts"

function inputRecord(input: object): Record<string, unknown> {
  return input as Record<string, unknown>
}

test("parses SessionStart since timestamp when present", () => {
  const parsed = parseClaudePayload({
    hook_event_name: "SessionStart",
    cwd: "/tmp/memory-lane-fixture",
    session_id: "session-1",
    timestamp: "2026-06-18T12:00:00.000Z",
  })

  assert.equal(parsed.kind, "session-start")
  assert.equal(parsed.kind === "session-start" ? parsed.input.since : undefined, "2026-06-18T12:00:00.000Z")
})

test("parses SessionStart since fallback timestamp fields when present", () => {
  const startedAt = parseClaudePayload({
    hook_event_name: "SessionStart",
    cwd: "/tmp/memory-lane-fixture",
    session_id: "session-1",
    started_at: "2026-06-18T12:01:00.000Z",
  })
  const sessionStartedAt = parseClaudePayload({
    hook_event_name: "SessionStart",
    cwd: "/tmp/memory-lane-fixture",
    session_id: "session-1",
    session_started_at: "2026-06-18T12:02:00.000Z",
  })

  assert.equal(startedAt.kind, "session-start")
  assert.equal(startedAt.kind === "session-start" ? startedAt.input.since : undefined, "2026-06-18T12:01:00.000Z")
  assert.equal(sessionStartedAt.kind, "session-start")
  assert.equal(sessionStartedAt.kind === "session-start" ? sessionStartedAt.input.since : undefined, "2026-06-18T12:02:00.000Z")
})

test("parses SessionStart since with timestamp precedence", () => {
  const parsed = parseClaudePayload({
    hook_event_name: "SessionStart",
    cwd: "/tmp/memory-lane-fixture",
    session_id: "session-1",
    timestamp: "2026-06-18T12:00:00.000Z",
    started_at: "2026-06-18T12:01:00.000Z",
    session_started_at: "2026-06-18T12:02:00.000Z",
  })

  assert.equal(parsed.kind, "session-start")
  assert.equal(parsed.kind === "session-start" ? parsed.input.since : undefined, "2026-06-18T12:00:00.000Z")
})

test("does not include since on non-SessionStart inputs", () => {
  const timestamp = "2026-06-18T12:00:00.000Z"
  const payloads = [
    parseClaudePayload({ hook_event_name: "UserPromptSubmit", cwd: "/tmp/memory-lane-fixture", prompt: "hello", timestamp }),
    parseClaudePayload({ hook_event_name: "Stop", cwd: "/tmp/memory-lane-fixture", timestamp }),
    parseClaudePayload({ hook_event_name: "PostToolUse", cwd: "/tmp/memory-lane-fixture", tool_name: "Bash", timestamp }),
    parseClaudePayload({ hook_event_name: "SessionEnd", cwd: "/tmp/memory-lane-fixture", messages: [], timestamp }),
  ]

  for (const parsed of payloads) {
    assert.notEqual(parsed.kind, "invalid")
    assert.equal(parsed.kind === "invalid" ? undefined : "since" in inputRecord(parsed.input), false)
  }
})

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

test("parses SessionEnd edge cases for confirmation and messages", () => {
  const parsed = parseClaudePayload({
    hook_event_name: "SessionEnd",
    session_id: "session-1",
    cwd: "/tmp/memory-lane-fixture",
    confirmed: false,
    messages: [
      { role: "tool", content: "shell output", tool_name: "Bash" },
      { role: "invalid", content: "ignored role" },
      { role: "user", content: "" },
      { role: "assistant" },
      "not an object",
      null,
    ],
  })

  assert.equal(parsed.kind, "session-end")
  assert.equal(parsed.kind === "session-end" ? parsed.confirmed : undefined, false)
  assert.deepEqual(parsed.kind === "session-end" ? parsed.input.messages : undefined, [
    { role: "tool", content: "shell output", toolName: "Bash" },
  ])
})

test("parses SessionEnd missing or non-array messages as empty", () => {
  const missingMessages = parseClaudePayload({
    hook_event_name: "SessionEnd",
    session_id: "session-1",
    cwd: "/tmp/memory-lane-fixture",
  })
  const nonArrayMessages = parseClaudePayload({
    hook_event_name: "SessionEnd",
    session_id: "session-1",
    cwd: "/tmp/memory-lane-fixture",
    messages: { role: "user", content: "not an array" },
  })

  assert.equal(missingMessages.kind, "session-end")
  assert.deepEqual(missingMessages.kind === "session-end" ? missingMessages.input.messages : undefined, [])
  assert.equal(nonArrayMessages.kind, "session-end")
  assert.deepEqual(nonArrayMessages.kind === "session-end" ? nonArrayMessages.input.messages : undefined, [])
})
