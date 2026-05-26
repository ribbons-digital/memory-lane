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
