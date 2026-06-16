import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { readLatestTurnFromTranscript } from "../src/transcript.ts"

test("reads latest user and assistant messages from bounded jsonl transcript", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-transcript-"))
  const file = path.join(dir, "transcript.jsonl")
  fs.writeFileSync(file, [
    JSON.stringify({ role: "user", content: "Old user" }),
    JSON.stringify({ role: "assistant", content: "Old assistant" }),
    JSON.stringify({ role: "user", content: "Remember that this repo uses pnpm" }),
    JSON.stringify({ role: "assistant", content: "I will remember that." }),
  ].join("\n"), "utf8")

  const turn = readLatestTurnFromTranscript(file, 4096)
  assert.equal(turn.lastUserMessage, "Remember that this repo uses pnpm")
  assert.equal(turn.lastAssistantMessage, "I will remember that.")
})

test("returns partial messages for mixed transcript shapes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-transcript-"))
  const file = path.join(dir, "transcript.jsonl")
  fs.writeFileSync(file, [
    "not json",
    JSON.stringify({ type: "user", message: [{ text: "Please remember pnpm" }] }),
    JSON.stringify({ author: "assistant", text: "Acknowledged" }),
  ].join("\n"), "utf8")

  const turn = readLatestTurnFromTranscript(file, 4096)
  assert.equal(turn.lastUserMessage, "Please remember pnpm")
  assert.equal(turn.lastAssistantMessage, "Acknowledged")
})

test("reads Codex Desktop response_item payload messages", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-transcript-"))
  const file = path.join(dir, "transcript.jsonl")
  fs.writeFileSync(file, [
    JSON.stringify({
      timestamp: "2026-06-16T04:59:57.746Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "remember this session\n" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-06-16T05:00:21.711Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Saved a checkpoint." }],
      },
    }),
  ].join("\n"), "utf8")

  const turn = readLatestTurnFromTranscript(file, 4096)
  assert.equal(turn.lastUserMessage, "remember this session\n")
  assert.equal(turn.lastAssistantMessage, "Saved a checkpoint.")
})

test("returns empty object for missing transcript", () => {
  assert.deepEqual(readLatestTurnFromTranscript("/path/that/does/not/exist"), {})
})
