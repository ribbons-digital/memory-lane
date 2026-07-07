import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { SessionMessage } from "@memory-lane/lifecycle"
import { readLatestTurnFromTranscript, readSessionMessagesFromTranscript } from "../src/transcript.ts"

const SESSION_ID = "b2a7c9e4-1f3d-4e8a-9c5b-6d2f8a1e0b47"
const MAX_BYTES = 64 * 1024

function stamp(minute: number): string {
  return `2026-07-07T10:${String(minute).padStart(2, "0")}:00.000Z`
}

function writeTranscript(records: Array<Record<string, unknown>>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-claude-transcript-"))
  const file = path.join(dir, "transcript.jsonl")
  fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n"), "utf8")
  return file
}

interface RecordMeta {
  uuid: string
  parentUuid: string | null
  timestamp: string
}

function userRecord(content: unknown, meta: RecordMeta): Record<string, unknown> {
  return {
    parentUuid: meta.parentUuid,
    isSidechain: false,
    userType: "external",
    cwd: "/Users/dev/project",
    sessionId: SESSION_ID,
    version: "1.0.44",
    type: "user",
    message: { role: "user", content },
    uuid: meta.uuid,
    timestamp: meta.timestamp,
  }
}

function assistantRecord(content: unknown[], meta: RecordMeta): Record<string, unknown> {
  return {
    parentUuid: meta.parentUuid,
    isSidechain: false,
    userType: "external",
    cwd: "/Users/dev/project",
    sessionId: SESSION_ID,
    version: "1.0.44",
    type: "assistant",
    message: {
      id: `msg_${meta.uuid}`,
      type: "message",
      role: "assistant",
      model: "claude-x",
      content,
    },
    uuid: meta.uuid,
    timestamp: meta.timestamp,
  }
}

function extracted(messages: SessionMessage[]): Array<Pick<SessionMessage, "role" | "content" | "timestamp">> {
  return messages.map(({ role, content, timestamp }) => ({ role, content, timestamp }))
}

function writeMixedTranscript(): string {
  return writeTranscript([
    { type: "summary", summary: "Earlier work on the transcript parser", leafUuid: "leaf-1" },
    userRecord("Set up the project", { uuid: "u-1", parentUuid: null, timestamp: stamp(1) }),
    assistantRecord(
      [
        { type: "text", text: "I'll read the config first." },
        { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/Users/dev/project/package.json" } },
      ],
      { uuid: "a-1", parentUuid: "u-1", timestamp: stamp(2) },
    ),
    userRecord(
      [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"name":"project"}' }],
      { uuid: "u-2", parentUuid: "a-1", timestamp: stamp(3) },
    ),
    assistantRecord(
      [
        { type: "text", text: "Config looks good." },
        { type: "text", text: "Next I'll wire the adapter." },
      ],
      { uuid: "a-2", parentUuid: "u-2", timestamp: stamp(4) },
    ),
    userRecord([{ type: "text", text: "Now add regression tests" }], { uuid: "u-3", parentUuid: "a-2", timestamp: stamp(5) }),
    assistantRecord([{ type: "text", text: "Added tests covering the parser." }], { uuid: "a-3", parentUuid: "u-3", timestamp: stamp(6) }),
  ])
}

test("extracts user records with nested plain-string content", () => {
  const file = writeTranscript([
    userRecord("Remember that this repo uses pnpm", { uuid: "u-1", parentUuid: null, timestamp: stamp(0) }),
  ])

  assert.deepEqual(extracted(readSessionMessagesFromTranscript(file, MAX_BYTES)), [
    { role: "user", content: "Remember that this repo uses pnpm", timestamp: stamp(0) },
  ])
  assert.equal(readLatestTurnFromTranscript(file, MAX_BYTES).lastUserMessage, "Remember that this repo uses pnpm")
})

test("extracts assistant records with nested array text content", () => {
  const file = writeTranscript([
    assistantRecord([{ type: "text", text: "I will remember that." }], { uuid: "a-1", parentUuid: "u-1", timestamp: stamp(1) }),
  ])

  assert.deepEqual(extracted(readSessionMessagesFromTranscript(file, MAX_BYTES)), [
    { role: "assistant", content: "I will remember that.", timestamp: stamp(1) },
  ])
  assert.equal(readLatestTurnFromTranscript(file, MAX_BYTES).lastAssistantMessage, "I will remember that.")
})

test("joins multiple text blocks in one assistant message with a newline", () => {
  const file = writeTranscript([
    assistantRecord(
      [
        { type: "text", text: "Config looks good." },
        { type: "text", text: "Next I'll wire the adapter." },
      ],
      { uuid: "a-1", parentUuid: "u-1", timestamp: stamp(1) },
    ),
  ])

  const messages = readSessionMessagesFromTranscript(file, MAX_BYTES)
  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.content, "Config looks good.\nNext I'll wire the adapter.")
})

test("extracts user records with nested array text content", () => {
  const file = writeTranscript([
    userRecord([{ type: "text", text: "Now add regression tests" }], { uuid: "u-1", parentUuid: null, timestamp: stamp(2) }),
  ])

  assert.deepEqual(extracted(readSessionMessagesFromTranscript(file, MAX_BYTES)), [
    { role: "user", content: "Now add regression tests", timestamp: stamp(2) },
  ])
})

test("ignores records whose array content is only tool_use or tool_result blocks", () => {
  const file = writeTranscript([
    userRecord("Please run the tests", { uuid: "u-1", parentUuid: null, timestamp: stamp(1) }),
    assistantRecord(
      [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "pnpm test" } }],
      { uuid: "a-1", parentUuid: "u-1", timestamp: stamp(2) },
    ),
    userRecord(
      [{ type: "tool_result", tool_use_id: "toolu_1", content: "raw tool output" }],
      { uuid: "u-2", parentUuid: "a-1", timestamp: stamp(3) },
    ),
    userRecord(
      [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "nested tool output" }] }],
      { uuid: "u-3", parentUuid: "u-2", timestamp: stamp(4) },
    ),
  ])

  assert.deepEqual(extracted(readSessionMessagesFromTranscript(file, MAX_BYTES)), [
    { role: "user", content: "Please run the tests", timestamp: stamp(1) },
  ])

  const turn = readLatestTurnFromTranscript(file, MAX_BYTES)
  assert.equal(turn.lastUserMessage, "Please run the tests")
  assert.equal(turn.lastAssistantMessage, undefined)
})

test("skips summary records", () => {
  const file = writeTranscript([
    { type: "summary", summary: "Earlier work on the transcript parser", leafUuid: "leaf-1" },
    userRecord("Continue where we left off", { uuid: "u-1", parentUuid: null, timestamp: stamp(1) }),
  ])

  assert.deepEqual(extracted(readSessionMessagesFromTranscript(file, MAX_BYTES)), [
    { role: "user", content: "Continue where we left off", timestamp: stamp(1) },
  ])
})

test("still reads flat legacy records", () => {
  const file = writeTranscript([
    { role: "user", content: "Old user", timestamp: stamp(1) },
    { role: "assistant", content: "Old assistant", timestamp: stamp(2) },
  ])

  assert.deepEqual(extracted(readSessionMessagesFromTranscript(file, MAX_BYTES)), [
    { role: "user", content: "Old user", timestamp: stamp(1) },
    { role: "assistant", content: "Old assistant", timestamp: stamp(2) },
  ])

  const turn = readLatestTurnFromTranscript(file, MAX_BYTES)
  assert.equal(turn.lastUserMessage, "Old user")
  assert.equal(turn.lastAssistantMessage, "Old assistant")
})

test("takes the timestamp from the top-level record, not the nested message", () => {
  const file = writeTranscript([
    {
      parentUuid: null,
      sessionId: SESSION_ID,
      type: "user",
      message: { role: "user", content: "Use the outer timestamp", timestamp: "1999-12-31T23:59:59.000Z" },
      uuid: "u-1",
      timestamp: stamp(1),
    },
  ])

  const messages = readSessionMessagesFromTranscript(file, MAX_BYTES)
  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.timestamp, stamp(1))
})

test("reads session messages from a realistic mixed transcript", () => {
  const messages = readSessionMessagesFromTranscript(writeMixedTranscript(), MAX_BYTES)

  assert.deepEqual(extracted(messages), [
    { role: "user", content: "Set up the project", timestamp: stamp(1) },
    { role: "assistant", content: "I'll read the config first.", timestamp: stamp(2) },
    { role: "assistant", content: "Config looks good.\nNext I'll wire the adapter.", timestamp: stamp(4) },
    { role: "user", content: "Now add regression tests", timestamp: stamp(5) },
    { role: "assistant", content: "Added tests covering the parser.", timestamp: stamp(6) },
  ])
})

test("reads the latest turn from a realistic mixed transcript", () => {
  const turn = readLatestTurnFromTranscript(writeMixedTranscript(), MAX_BYTES)

  assert.equal(turn.lastUserMessage, "Now add regression tests")
  assert.equal(turn.lastAssistantMessage, "Added tests covering the parser.")
})
