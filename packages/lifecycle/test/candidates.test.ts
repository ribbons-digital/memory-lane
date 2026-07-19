import test from "node:test"
import assert from "node:assert/strict"
import { extractStopCandidates } from "../src/candidates.ts"
import { issue214RegressionFixtures } from "./fixtures/issue-214-inferred-preferences.ts"

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

test("delegated subagent task wrapper prompts produce no candidates", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: `Task: You are a delegated subagent running from a fork of the parent session. Treat the inherited conversation as reference-only context, not a live thread to continue.

Task:
Implement Task 2 of the Codex SessionStart baseline injection plan in worktree /tmp/example.`,
    lastAssistantMessage: "I'll implement the task.",
  })

  assert.deepEqual(candidates, [])
})

test("acceptance finalization prompts produce no candidates", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: `Task: ## Acceptance Finalization
You are continuing the same subagent session. Before this run can be accepted, compare the current work to the acceptance contract and the evidence below.
This is finalization turn 1 of 2.`,
    lastAssistantMessage: "Acceptance criteria satisfied.",
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

test("checkpoint save request becomes approved project checkpoint", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "Save our current progress so we can resume later",
    lastAssistantMessage: "I'll checkpoint the context.",
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].kind, "project_checkpoint")
  assert.equal(candidates[0].category, "project")
  assert.equal(candidates[0].decision, "save-approved")
})

for (const fixture of issue214RegressionFixtures) {
  test(`issue 214 regression: ${fixture.name} produces no global pending preference`, () => {
    const candidates = extractStopCandidates({
      cwd: process.cwd(),
      lastUserMessage: fixture.text,
      lastAssistantMessage: "Understood.",
    })

    assert.deepEqual(candidates, [])
  })
}

test("extracts independently reviewable atomic preferences from a mixed turn", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: `I prefer concise status updates. Never use emojis in status summaries.

Can you update the current issue now?`,
    lastAssistantMessage: "I'll update it.",
  })

  assert.deepEqual(candidates.map(({ text, category, scopeType, decision }) => ({ text, category, scopeType, decision })), [
    { text: "I prefer concise status updates", category: "preference", scopeType: "project", decision: "save-pending" },
    { text: "Never use emojis in status summaries", category: "preference", scopeType: "project", decision: "save-pending" },
  ])
})

test("infers global preference scope only from explicit cross-project language", () => {
  const projectCandidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "I prefer concise status updates.",
  })
  const globalCandidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "Across all projects, I prefer concise status updates.",
  })

  assert.deepEqual(
    projectCandidates.map(({ category, scopeType, decision }) => ({ category, scopeType, decision })),
    [{ category: "preference", scopeType: "project", decision: "save-pending" }],
  )
  assert.deepEqual(
    globalCandidates.map(({ category, scopeType, decision }) => ({ category, scopeType, decision })),
    [{ category: "preference", scopeType: "global", decision: "save-pending" }],
  )
})

test("rejects inferred preferences with unsafe size or structure", () => {
  const messages = [
    "I prefer answers based on https://example.invalid/style-guide",
    "I prefer concise replies, can you implement this task now?",
    "I prefer concise replies, and update the issue now",
    `I prefer commands shown as fenced examples:\n\n\`\`\`sh\npnpm test\n\`\`\``,
    `I prefer ${"very detailed ".repeat(40)}responses`,
    "For now, I prefer verbose status updates",
  ]

  for (const lastUserMessage of messages) {
    assert.deepEqual(extractStopCandidates({ cwd: process.cwd(), lastUserMessage }), [], lastUserMessage)
  }
})

test("never persists an inferred multi-paragraph turn as one preference", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "I prefer concise replies.\n\nI prefer short examples.",
  })

  assert.equal(candidates.length, 2)
  assert.equal(candidates.every((candidate) => !candidate.text.includes("\n")), true)
})

test("keeps self-contained complementizer and determiner preference statements", () => {
  const messages = [
    "I prefer that responses are concise.",
    "I prefer this response format for release notes.",
  ]

  for (const lastUserMessage of messages) {
    const candidates = extractStopCandidates({ cwd: process.cwd(), lastUserMessage })
    assert.deepEqual(candidates.map(({ text, category, scopeType }) => ({ text, category, scopeType })), [
      { text: lastUserMessage.slice(0, -1), category: "preference", scopeType: "project" },
    ])
  }
})

test("keeps preferences with anaphoric it bound by a causal clause", () => {
  const messages = [
    "I prefer ripgrep because it is faster.",
    "Never use force push because it rewrites history.",
    "I prefer squash merges as it keeps history clean.",
  ]

  for (const lastUserMessage of messages) {
    const candidates = extractStopCandidates({ cwd: process.cwd(), lastUserMessage })
    assert.deepEqual(candidates.map(({ text, category, scopeType, decision }) => ({ text, category, scopeType, decision })), [
      { text: lastUserMessage.slice(0, -1), category: "preference", scopeType: "project", decision: "save-pending" },
    ], lastUserMessage)
  }
})

test("keeps preferences with trailing bound demonstrative clauses", () => {
  const messages = [
    "Always use tabs, that is my preference.",
    "I prefer 2-space indent; that is what the team uses.",
    "Never commit secrets, that is critical.",
    "Always use tabs; this is easier to scan.",
  ]

  for (const lastUserMessage of messages) {
    const candidates = extractStopCandidates({ cwd: process.cwd(), lastUserMessage })
    assert.deepEqual(candidates.map(({ text, category, scopeType, decision }) => ({ text, category, scopeType, decision })), [
      { text: lastUserMessage.slice(0, -1), category: "preference", scopeType: "project", decision: "save-pending" },
    ], lastUserMessage)
  }
})

test("rejects unresolved anaphoric and demonstrative pronouns", () => {
  const messages = [
    "I prefer this.",
    "Don't use that.",
    "I prefer it.",
    "Never use it for deployments.",
    "I prefer it because ripgrep is faster.",
    "I prefer because it is faster.",
    "I prefer tabs because it.",
    "Always use that, that is my preference.",
    "Always use, that is my preference.",
    "I prefer this; that is what the team uses.",
  ]

  for (const lastUserMessage of messages) {
    assert.deepEqual(extractStopCandidates({ cwd: process.cwd(), lastUserMessage }), [], lastUserMessage)
  }
})

test("keeps explicit personal-memory semantics while discarding inferred personal candidates", () => {
  const inferred = extractStopCandidates({ cwd: process.cwd(), lastUserMessage: "My name is Alice." })
  const explicit = extractStopCandidates({ cwd: process.cwd(), lastUserMessage: "Remember that my name is Alice." })

  assert.deepEqual(inferred, [])
  assert.deepEqual(
    explicit.map(({ text, category, scopeType, decision }) => ({ text, category, scopeType, decision })),
    [{ text: "my name is Alice", category: "personal", scopeType: "global", decision: "save-approved" }],
  )
})

test("does not split inferred preferences at abbreviations, decimals, or versions", () => {
  const messages = [
    "I prefer using e.g. concise summaries.",
    "I prefer using i.e. expansions sparingly.",
    "I prefer Dr. Smith-style citations.",
    "I prefer concise summaries, etc. for status updates.",
    "I prefer 2.5 line spacing.",
    "I prefer version 2.1.3 examples.",
  ]

  for (const lastUserMessage of messages) {
    const candidates = extractStopCandidates({ cwd: process.cwd(), lastUserMessage })
    assert.deepEqual(candidates.map((candidate) => candidate.text), [lastUserMessage.slice(0, -1)], lastUserMessage)
  }
})

test("preserves atomic I use X for Y preferences", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: "I use pnpm for package installation.",
  })

  assert.deepEqual(candidates.map(({ text, category, scopeType, decision }) => ({ text, category, scopeType, decision })), [
    { text: "I use pnpm for package installation", category: "preference", scopeType: "project", decision: "save-pending" },
  ])
})

test("keeps a benign atomic preference next to rejected fixture-derived content", () => {
  const candidates = extractStopCandidates({
    cwd: process.cwd(),
    lastUserMessage: `I prefer concise status updates.\n${issue214RegressionFixtures[2].text}`,
  })

  assert.deepEqual(candidates.map(({ text, category, scopeType }) => ({ text, category, scopeType })), [
    { text: "I prefer concise status updates", category: "preference", scopeType: "project" },
  ])
})
