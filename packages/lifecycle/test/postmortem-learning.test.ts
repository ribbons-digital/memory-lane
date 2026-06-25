import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import { MemoryEngine } from "@memory-lane/core"
import { tempDir } from "../../core/test/helpers.js"
import {
  extractPostmortemLearningCandidatesFromStop,
  filterDuplicatePostmortemLearningCandidates,
  postmortemLearningKeyFromText,
} from "../src/postmortem-learning.ts"

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

test("extracts procedure from high-confidence assistant postmortem", () => {
  const candidates = extractPostmortemLearningCandidatesFromStop({
    cwd: process.cwd(),
    lastUserMessage: "Why did Pi crash after the release?",
    lastAssistantMessage: "Pi prompt submit crashed after upgrade. The root cause was that the generated native bridge returned a raw string instead of Pi's custom-message object, violating the host API return shape. Future generated harness adapter changes should add executable contract tests for lifecycle return shape and dogfood the installed artifact through prompt submit before release. Verified by smoke-loading the installed Pi extension and running the prompt-submit lifecycle.",
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].kind, "procedure")
  assert.equal(candidates[0].category, "project")
  assert.equal(candidates[0].scopeType, "project")
  assert.equal(candidates[0].decision, "save-pending")
  assert.equal(candidates[0].source, "agent-suggested")
  assert.match(candidates[0].text, /^Procedure:/u)
  assert.match(candidates[0].text, /Pi memory context messages use Pi custom-message shape/u)
  assert.equal(postmortemLearningKeyFromText(candidates[0].text), "postmortem:pi-custom-message-shape")
})

test("extracts candidate from explicit user challenge plus assistant diagnosis", () => {
  const candidates = extractPostmortemLearningCandidatesFromStop({
    cwd: process.cwd(),
    lastUserMessage: "You missed that installed artifact dogfood is the actual guardrail here; reviewer inspection was not enough.",
    lastAssistantMessage: "Agreed. The issue happened because repo-local adapter tests passed while the generated installed artifact had different behavior. Future harness-template changes should compare generated behavior with repo-local behavior and dogfood the installed artifact before release.",
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].kind, "procedure")
  assert.match(candidates[0].text, /Dogfood generated harness adapter changes/u)
  assert.match(candidates[0].reason, /postmortem learning/u)
})

test("uses assistant diagnostic evidence even when long user text would otherwise dominate the combined text", () => {
  const candidates = extractPostmortemLearningCandidatesFromStop({
    cwd: process.cwd(),
    lastUserMessage: `You missed the actual durable lesson here. ${"filler ".repeat(140)}`,
    lastAssistantMessage: "Pi prompt submit crashed. The root cause was the native CLI bridge returned a raw string instead of Pi's custom-message object. Future Pi bridge changes should assert the custom-message return shape and dogfood prompt submit before release. Verified by installed Pi prompt-submit dogfood.",
  })

  assert.equal(candidates.length, 1)
  assert.match(candidates[0]?.text ?? "", /Pi memory context messages use Pi custom-message shape/u)
  assert.equal(candidates[0]?.confidence, 0.86)
})

test("ignores vague reflections without durable evidence", () => {
  const candidates = extractPostmortemLearningCandidatesFromStop({
    cwd: process.cwd(),
    lastAssistantMessage: "This was tricky. We should be more careful next time.",
  })

  assert.deepEqual(candidates, [])
})

test("ignores ordinary failed command narrative without cause and prevention", () => {
  const candidates = extractPostmortemLearningCandidatesFromStop({
    cwd: process.cwd(),
    lastAssistantMessage: "The test failed. I will fix it.",
  })

  assert.deepEqual(candidates, [])
})

test("ignores explicit memory requests so explicit save path remains authoritative", () => {
  const candidates = extractPostmortemLearningCandidatesFromStop({
    cwd: process.cwd(),
    lastUserMessage: "Remember that generated harness adapters need installed artifact dogfood before release.",
    lastAssistantMessage: "Saved.",
  })

  assert.deepEqual(candidates, [])
})

test("ignores likely secrets and meta-task prompt pollution", () => {
  const secretCandidates = extractPostmortemLearningCandidatesFromStop({
    cwd: process.cwd(),
    lastAssistantMessage: "The release failed because the token api_key = sk-1234567890abcdef1234567890abcdef was wrong. Future agents should verify secrets. Verified by rerun.",
  })
  assert.deepEqual(secretCandidates, [])

  const metaCandidates = extractPostmortemLearningCandidatesFromStop({
    cwd: process.cwd(),
    lastUserMessage: "Task: ## Acceptance Finalization\nThe root cause was skipped review. Future agents should add a guardrail. Verified by tests.",
    lastAssistantMessage: "Done.",
  })
  assert.deepEqual(metaCandidates, [])
})

test("deduplicates pi custom-message learning against existing workflow rule", () => {
  const project = tempDir()
  const engine = engineInTemp(project)
  engine.save({
    text: "Procedure: Verify Pi memory context messages use Pi custom-message shape. When: changing the Pi adapter or native CLI bridge prompt-submit behavior. Steps: invoke before_agent_start with realistic fake Pi context; assert returned message is an object with customType, content, and display; dogfood prompt submit in the installed Pi extension. Pitfall: returning a raw string can crash prompt submit even when startup smoke passes. Verify: the installed Pi extension handles prompt submit without crashing.",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "workflow_rule",
  })

  const candidates = extractPostmortemLearningCandidatesFromStop({
    cwd: project,
    lastAssistantMessage: "Pi prompt submit crashed. The root cause was the native CLI bridge returned a raw string instead of Pi's custom-message object. Future Pi bridge changes should assert return shape and dogfood prompt submit before release. Verified by installed Pi prompt-submit dogfood.",
  })

  assert.equal(candidates.length, 1)
  assert.equal(filterDuplicatePostmortemLearningCandidates(engine, candidates).length, 0)
})

test("deduplicates against existing pending and approved project learning memories", () => {
  const project = tempDir()
  const engine = engineInTemp(project)
  engine.save({
    text: "Procedure: Dogfood generated harness adapter changes through the installed artifact before release. When: changing generated harness adapters or templates. Steps: add contract tests for generated lifecycle branches; compare generated behavior with repo-local adapters when both exist; run installed-artifact dogfood. Pitfall: reviewer inspection or load-smoke tests can miss host API shape regressions. Verify: the installed artifact exercised the lifecycle event users trigger.",
    status: "pending",
    category: "project",
    scopeType: "project",
    kind: "procedure",
  })

  const candidates = extractPostmortemLearningCandidatesFromStop({
    cwd: project,
    lastAssistantMessage: "The issue happened because generated harness adapter behavior differed from repo-local behavior. Future generated harness adapter changes should add contract tests and installed artifact dogfood before release. Verified by prompt-submit dogfood.",
  })

  assert.equal(candidates.length, 1)
  assert.equal(filterDuplicatePostmortemLearningCandidates(engine, candidates).length, 0)
})

test("postmortem learning keys identify known domains", () => {
  assert.equal(postmortemLearningKeyFromText("Procedure: Verify generated harness adapter return shapes with executable contract tests and installed-artifact dogfood."), "postmortem:harness-generated-adapter-contract-tests")
  assert.equal(postmortemLearningKeyFromText("Procedure: Verify Pi memory context messages use Pi custom-message shape before prompt submit."), "postmortem:pi-custom-message-shape")
  assert.equal(postmortemLearningKeyFromText("Procedure: Reapply harness configuration through the freshly installed binary after self-upgrade."), "postmortem:upgrade-reapply-fresh-installed-binary")
  assert.equal(postmortemLearningKeyFromText("Workflow correction: Future work should verify before claiming completion."), "postmortem:workflow-correction:verify-before-completion")
})
