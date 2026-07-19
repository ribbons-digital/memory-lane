import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import { MemoryEngine } from "@memory-lane/core"
import { tempDir } from "../../core/test/helpers.js"
import {
  checkpointIdentityFromText,
  checkpointKeyFromText,
  checkpointKeysFromText,
  extractCheckpointCandidatesFromPostToolUse,
  extractCheckpointCandidatesFromStop,
  filterDuplicateCheckpointCandidates,
  resolveCheckpointCandidates,
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

test("marks bare merge checkpoint from successful shell tool evidence for suppression", () => {
  const candidates = extractCheckpointCandidatesFromPostToolUse({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "gh pr merge 19 --squash --delete-branch" },
    toolResponse: { stdout: "Merged pull request #19", exit_code: 0 },
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].text, "Merged PR #19.")
  assert.equal(candidates[0].kind, "project_checkpoint")
  assert.equal(candidates[0].decision, "discard")
  assert.match(candidates[0].reason, /bare merge.*durable project context/iu)
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

test("derives stable checkpoint keys and project-scoped identities across wording variants", () => {
  assert.equal(checkpointKeyFromText("Released v0.2.12."), "release:v0.2.12")
  assert.equal(checkpointKeyFromText("Merged PR #19."), "merge:pr-19")
  assert.equal(checkpointKeyFromText("Pull request 19 was merged after tests passed."), "merge:pr-19")
  assert.equal(checkpointIdentityFromText("memory-lane", "PR #19 has been merged with checkpoint deduplication."), "memory-lane:merge:pr-19")
})

test("marks bare Stop merge notifications for suppression but preserves durable merge context", () => {
  for (const prNumber of [201, 205, 206, 207, 208, 209, 210, 211, 212]) {
    const bare = extractCheckpointCandidatesFromStop({ cwd: process.cwd(), lastUserMessage: `PR #${prNumber} merged.` })
    assert.equal(bare.length, 1)
    assert.equal(bare[0].decision, "discard")
    assert.match(bare[0].reason, /bare merge.*durable project context/iu)
  }

  const enriched = extractCheckpointCandidatesFromStop({
    cwd: process.cwd(),
    lastUserMessage: "PR #201 merged with checkpoint identity deduplication and regression coverage.",
  })
  assert.equal(enriched.length, 1)
  assert.equal(enriched[0].decision, "save-pending")
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

test("rejected equivalent checkpoints are reported as suppressed and deletion resets suppression", () => {
  const cwd = tempDir()
  const engine = engineInTemp(cwd)
  const saved = engine.save({
    text: "PR #201 merged with checkpoint identity deduplication.",
    status: "pending",
    category: "project",
    scopeType: "project",
    kind: "project_checkpoint",
  })
  if (saved.status !== "saved") throw new Error("expected saved checkpoint")
  engine.reject(saved.memory.id)

  const candidate = extractCheckpointCandidatesFromStop({
    cwd,
    lastUserMessage: "Pull request 201 was merged with checkpoint identity deduplication.",
  })
  const suppressed = resolveCheckpointCandidates(engine, candidate)
  assert.equal(suppressed.candidates.length, 1)
  assert.equal(suppressed.candidates[0].decision, "discard")
  assert.match(suppressed.candidates[0].reason, /rejected equivalent.*memory lane suppression/iu)

  const bareSuppressed = resolveCheckpointCandidates(engine, extractCheckpointCandidatesFromStop({
    cwd,
    lastUserMessage: "PR #201 merged.",
  }))
  assert.match(bareSuppressed.candidates[0].reason, /rejected equivalent.*memory lane suppression/iu)

  engine.delete(saved.memory.id)
  const reset = resolveCheckpointCandidates(engine, candidate)
  assert.equal(reset.candidates.length, 1)
  assert.equal(reset.candidates[0].decision, "save-pending")
})

test("canonical checkpoint identity is project-scoped and later session summaries block equivalent events", () => {
  const projectA = tempDir()
  const projectB = tempDir()
  const engine = engineInTemp(projectA)
  engine.save({
    text: "## Session Summary (2026-07-19)\n\n- PR #201 merged with checkpoint identity deduplication and released v0.9.0.",
    status: "pending",
    category: "project",
    scopeType: "project",
    kind: "session_summary",
    source: "session-summary",
  })

  const candidateA = extractCheckpointCandidatesFromStop({
    cwd: projectA,
    lastAssistantMessage: "Pull request 201 was merged with checkpoint identity deduplication.",
  })
  assert.equal(resolveCheckpointCandidates(engine, candidateA).candidates.length, 0)

  engine.refreshScope(projectB)
  const candidateB = extractCheckpointCandidatesFromStop({
    cwd: projectB,
    lastAssistantMessage: "Pull request 201 was merged with checkpoint identity deduplication.",
  })
  assert.equal(resolveCheckpointCandidates(engine, candidateB).candidates.length, 1)
})

test("compound checkpoint text keeps a novel event when another identity is already represented", () => {
  const cwd = tempDir()
  const engine = engineInTemp(cwd)
  engine.save({
    text: "PR #201 merged with checkpoint identity deduplication.",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "project_checkpoint",
  })
  const compound = extractCheckpointCandidatesFromStop({
    cwd,
    lastAssistantMessage: "PR #201 merged with checkpoint identity deduplication and released v0.9.1.",
  })

  const resolution = resolveCheckpointCandidates(engine, compound)
  assert.equal(resolution.candidates.length, 1)
  assert.equal(resolution.candidates[0].text, "released v0.9.1.")
  assert.deepEqual(checkpointKeysFromText(resolution.candidates[0].text), ["release:v0.9.1"])
})

test("global candidates use global checkpoint identity instead of current project identity", () => {
  const cwd = tempDir()
  const engine = engineInTemp(cwd)
  engine.save({
    text: "Released v0.9.2.",
    status: "approved",
    category: "project",
    scopeType: "global",
    kind: "project_checkpoint",
  })
  const [projectCandidate] = extractCheckpointCandidatesFromStop({ cwd, lastAssistantMessage: "Released v0.9.2." })
  if (!projectCandidate) throw new Error("expected release candidate")

  const globalCandidate = { ...projectCandidate, scopeType: "global" as const }
  assert.equal(resolveCheckpointCandidates(engine, [globalCandidate]).candidates.length, 0)
  assert.equal(resolveCheckpointCandidates(engine, [projectCandidate]).candidates.length, 1)
})

test("later enriched checkpoint revises a provisional pending record instead of creating a second candidate", () => {
  const cwd = tempDir()
  const engine = engineInTemp(cwd)
  const provisional = engine.save({
    text: "PR #201 merged.",
    status: "pending",
    category: "project",
    scopeType: "project",
    kind: "project_checkpoint",
  })
  if (provisional.status !== "saved") throw new Error("expected provisional checkpoint")

  const candidate = extractCheckpointCandidatesFromStop({
    cwd,
    lastAssistantMessage: "PR #201 merged with canonical checkpoint identity and rejected-event suppression.",
  })
  const resolution = resolveCheckpointCandidates(engine, candidate)

  assert.equal(resolution.candidates.length, 0)
  assert.equal(resolution.revised.length, 1)
  assert.equal(resolution.revised[0].id, provisional.memory.id)
  assert.match(resolution.revised[0].text, /canonical checkpoint identity/u)
  assert.equal(engine.list({ status: "pending" }).filter((memory) => checkpointKeyFromText(memory.text) === "merge:pr-201").length, 1)
})
