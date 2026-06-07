import test from "node:test"
import assert from "node:assert/strict"
import { extractStopCandidates } from "../src/candidates.ts"

test("explicit remember request becomes approved global preference", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "Remember that I prefer concise implementation plans",
    lastAssistantMessage: "Got it.",
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].text, "I prefer concise implementation plans")
  assert.equal(candidates[0].category, "preference")
  assert.equal(candidates[0].scopeType, "global")
  assert.equal(candidates[0].decision, "save-approved")
})

test("project convention in user message becomes approved project fact", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "This repo uses pnpm for package management.",
    lastAssistantMessage: "Understood.",
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].category, "project")
  assert.equal(candidates[0].scopeType, "project")
  assert.equal(candidates[0].decision, "save-approved")
})

test("question-only messages produce no candidates", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "What package manager does this repo use?",
    lastAssistantMessage: "It appears to use pnpm.",
  })

  assert.deepEqual(candidates, [])
})

test("transient project imperatives produce no candidates", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "Fix the bug in this repo",
    lastAssistantMessage: "I'll investigate the bug.",
  })

  assert.deepEqual(candidates, [])
})

test("project-like reviewer task prompts produce no candidates", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "Task: Review the code quality in this repo. Do not modify files.",
    lastAssistantMessage: "Review complete.",
  })

  assert.deepEqual(candidates, [])
})

test("commit review prompts produce no candidates", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "Review commit abc123 and report APPROVED or CHANGES_REQUESTED.",
    lastAssistantMessage: "I'll review it.",
  })

  assert.deepEqual(candidates, [])
})

test("subagent implementation handoff prompts produce no candidates", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "Implement plan Task 2 only. Report status as DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED.",
    lastAssistantMessage: "I'll execute Task 2.",
  })

  assert.deepEqual(candidates, [])
})

test("standalone subagent status instructions produce no candidates", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "Report status as DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED for this repo task.",
    lastAssistantMessage: "DONE",
  })

  assert.deepEqual(candidates, [])
})

test("explicit memory requests about reviewer behavior are preserved", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "Remember that reviewer agents must not modify files",
    lastAssistantMessage: "Got it.",
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].text, "reviewer agents must not modify files")
  assert.equal(candidates[0].decision, "save-approved")
})
