import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import { MemoryEngine } from "@memory-lane/core"
import { tempDir } from "../../core/test/helpers.js"
import {
  checkpointKeyFromText,
  extractCheckpointCandidatesFromPostToolUse,
  extractCheckpointCandidatesFromStop,
  filterDuplicateCheckpointCandidates,
} from "../src/checkpoint-capture.ts"

function engineInTemp(cwd: string): MemoryEngine {
  const dir = tempDir()
  const engine = new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath: path.join(dir, "config.json"),
  })
  engine.refreshScope(cwd)
  return engine
}

test("extracts release checkpoint from explicit Stop progress statement", () => {
  const candidates = extractCheckpointCandidatesFromStop({
    cwd: process.cwd(),
    lastUserMessage: "Released v0.2.12 and verified the release workflow.",
    lastAssistantMessage: "Done.",
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].text, "Released v0.2.12 and verified the release workflow.")
  assert.equal(candidates[0].category, "project")
  assert.equal(candidates[0].scopeType, "project")
  assert.equal(candidates[0].kind, "project_checkpoint")
  assert.equal(candidates[0].decision, "save-pending")
  assert.equal(candidates[0].source, "agent-suggested")
})

test("extracts merge checkpoint from explicit Stop progress statement", () => {
  const candidates = extractCheckpointCandidatesFromStop({
    cwd: process.cwd(),
    lastUserMessage: "PR #19 merged after review; continue with Phase 17 next.",
  })

  assert.equal(candidates.length, 1)
  assert.match(candidates[0].text, /PR #19 merged/u)
  assert.equal(candidates[0].kind, "project_checkpoint")
  assert.equal(candidates[0].decision, "save-pending")
})

test("does not extract ambiguous future-tense checkpoint-like statements", () => {
  assert.deepEqual(extractCheckpointCandidatesFromStop({ cwd: process.cwd(), lastUserMessage: "We should release v0.2.12 later." }), [])
  assert.deepEqual(extractCheckpointCandidatesFromStop({ cwd: process.cwd(), lastUserMessage: "Can you merge PR #19?" }), [])
  assert.deepEqual(extractCheckpointCandidatesFromStop({ cwd: process.cwd(), lastUserMessage: "Remember to update ROADMAP.md eventually." }), [])
})

test("does not extract question-shaped Stop checkpoint statements", () => {
  for (const message of [
    "Has PR #19 merged?",
    "Please confirm PR #19 merged?",
    "Was PR #19 merged?",
    "Have we released v0.2.12?",
    "Released v0.2.12?",
    "PR #19 merged?",
  ]) {
    assert.deepEqual(extractCheckpointCandidatesFromStop({ cwd: process.cwd(), lastUserMessage: message }), [])
  }
})

test("does not extract request-wrapped Stop checkpoint checks", () => {
  for (const message of [
    "Please confirm PR #19 merged.",
    "Please check if released v0.2.12.",
    "Please verify tests passed.",
  ]) {
    assert.deepEqual(extractCheckpointCandidatesFromStop({ cwd: process.cwd(), lastUserMessage: message }), [])
  }
})

test("does not extract failed or negative Stop checkpoint statements", () => {
  for (const message of [
    "Released v0.2.12 failed.",
    "Tagged v0.2.12 was unsuccessful.",
    "Published v0.2.12 but could not complete release.",
    "Released v0.2.12. It failed.",
    "Published v0.2.12. Release failed.",
    "Merged PR #19 failed.",
    "PR #19 merged with error.",
    "Merged pull request 19 but was cancelled.",
    "Released v0.2.12 was rolled back.",
    "Released v0.2.12 hit rollback.",
    "Merged PR #19 but reverted it.",
    "Merged PR #19 but will revert.",
  ]) {
    assert.deepEqual(extractCheckpointCandidatesFromStop({ cwd: process.cwd(), lastUserMessage: message }), [])
  }
})

test("extracts Stop checkpoint from assistant response when user prompt is not a checkpoint", () => {
  const candidates = extractCheckpointCandidatesFromStop({
    cwd: process.cwd(),
    lastUserMessage: "Please summarize what changed.",
    lastAssistantMessage: "Released v0.2.12.",
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].text, "Released v0.2.12.")
  assert.equal(candidates[0].kind, "project_checkpoint")
})

test("extracts valid checkpoint sentence before separate future reminder sentence", () => {
  const candidates = extractCheckpointCandidatesFromStop({
    cwd: process.cwd(),
    lastAssistantMessage: "Released v0.2.12. Next time update docs.",
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].text, "Released v0.2.12.")
})

test("extracts release checkpoint from successful shell tool evidence", () => {
  const candidates = extractCheckpointCandidatesFromPostToolUse({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "gh release create v0.2.12 --notes-file release.md" },
    toolResponse: { stdout: "https://github.com/ribbons-digital/memory-lane/releases/tag/v0.2.12", exit_code: 0 },
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].text, "Released v0.2.12.")
  assert.equal(candidates[0].kind, "project_checkpoint")
  assert.equal(candidates[0].decision, "save-pending")
  assert.equal(candidates[0].source, "agent-suggested")
})

test("extracts merge checkpoint from successful shell tool evidence", () => {
  const candidates = extractCheckpointCandidatesFromPostToolUse({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "gh pr merge 19 --squash --delete-branch" },
    toolResponse: { stdout: "Merged pull request #19", exit_code: 0 },
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].text, "Merged PR #19.")
  assert.equal(candidates[0].kind, "project_checkpoint")
  assert.equal(candidates[0].decision, "save-pending")
})

test("does not extract checkpoint from failed shell tool evidence", () => {
  const candidates = extractCheckpointCandidatesFromPostToolUse({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "gh release create v0.2.12" },
    toolResponse: { stderr: "release failed", exit_code: 1 },
  })

  assert.deepEqual(candidates, [])
})

test("does not extract checkpoint from secret-like Stop or tool evidence", () => {
  assert.deepEqual(extractCheckpointCandidatesFromStop({
    cwd: process.cwd(),
    lastUserMessage: "Released v0.2.12 with API_KEY=abcdef1234567890abcdef1234567890.",
  }), [])

  assert.deepEqual(extractCheckpointCandidatesFromPostToolUse({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "gh release create v0.2.12 --notes secret=abcdef1234567890abcdef1234567890" },
    toolResponse: { stdout: "created", exit_code: 0 },
  }), [])

  assert.deepEqual(extractCheckpointCandidatesFromPostToolUse({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "gh pr merge 19" },
    toolResponse: { stdout: "Merged pull request #19\nTOKEN=abcdef1234567890abcdef1234567890", exit_code: 0 },
  }), [])
})

test("stores compact checkpoint text instead of raw tool payloads", () => {
  const candidates = extractCheckpointCandidatesFromPostToolUse({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "gh release create v0.2.12 --notes-file release.md" },
    toolResponse: { stdout: "https://github.com/ribbons-digital/memory-lane/releases/tag/v0.2.12\nFull release notes and command output omitted.", exit_code: 0 },
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].text, "Released v0.2.12.")
  assert.doesNotMatch(candidates[0].text, /gh release create|release\.md|Full release notes/u)
})

test("derives stable checkpoint keys", () => {
  assert.equal(checkpointKeyFromText("Released v0.2.12."), "release:v0.2.12")
  assert.equal(checkpointKeyFromText("Merged PR #19."), "merge:pr-19")
})

test("filters duplicate pending and approved checkpoint candidates in current project", () => {
  const cwd = tempDir()
  const engine = engineInTemp(cwd)
  engine.save({ text: "Released v0.2.12.", status: "pending", category: "project", scopeType: "project", kind: "project_checkpoint" })
  engine.save({ text: "Merged PR #19.", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })
  engine.save({ text: "Verification passed: pnpm build and pnpm test.", status: "pending", category: "project", scopeType: "project", kind: "project_checkpoint" })

  const candidates = [
    ...extractCheckpointCandidatesFromStop({ cwd, lastUserMessage: "Released v0.2.12." }),
    ...extractCheckpointCandidatesFromStop({ cwd, lastUserMessage: "PR #19 merged." }),
    ...extractCheckpointCandidatesFromStop({ cwd, lastUserMessage: "Verification passed: pnpm build and pnpm test." }),
    ...extractCheckpointCandidatesFromStop({ cwd, lastUserMessage: "Released v0.2.13." }),
  ]

  const filtered = filterDuplicateCheckpointCandidates(engine, candidates)
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].text, "Released v0.2.13.")
})
