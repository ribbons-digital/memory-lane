import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import { MemoryEngine, writeConfig } from "@memory-lane/core"
import { tempDir } from "../../core/test/helpers.js"
import { handleSessionStart, handleUserPromptSubmit } from "../src/handlers.ts"

function engineInTemp(cwd?: string, memoryConfig?: Record<string, unknown>): MemoryEngine {
  const dir = tempDir()
  const configPath = path.join(dir, "config.json")
  if (memoryConfig) writeConfig(configPath, { memory: memoryConfig } as any)
  const engine = new MemoryEngine({
    memoryPath: path.join(dir, "memory.jsonl"),
    embeddingsPath: path.join(dir, "embeddings.jsonl"),
    configPath,
  })
  if (cwd) engine.refreshScope(cwd)
  return engine
}

function saveWorkflowAgreement(engine: MemoryEngine): void {
  engine.save({
    text: "PRIVATE WORKFLOW AGREEMENT TEXT Project workflow loop: inspect roadmap before implementation.",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "workflow_rule",
  })
}

function waitForNextMillisecond(): void {
  const started = Date.now()
  while (Date.now() === started) {
    // Wait for storage timestamps to differ in tests that assert recency behavior.
  }
}

test("user-prompt list-memory intent returns authoritative list guidance instead of filtered relevant memory", async () => {
  const project = tempDir()
  const engine = engineInTemp(project)
  engine.save({ text: "This repo uses pnpm", status: "approved", category: "project", scopeType: "project" })

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "list current memory",
  })

  assert.match(result.additionalContext ?? "", /authoritative Memory Lane list/u)
  assert.match(result.additionalContext ?? "", /memory-lane list --json/u)
  assert.doesNotMatch(result.additionalContext ?? "", /## Relevant Memory/u)
  assert.doesNotMatch(result.additionalContext ?? "", /This repo uses pnpm/u)
})

test("user-prompt policy-only returns guidance without recalling memory bodies", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only" } })
  engine.save({ text: "This repo uses pnpm", status: "approved", category: "project", scopeType: "project" })

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "how do we run tests in this repo",
  })

  assert.match(result.additionalContext ?? "", /mode="policy-only"/u)
  assert.match(result.additionalContext ?? "", /Use Memory Lane recall\/list tools/u)
  assert.doesNotMatch(result.additionalContext ?? "", /This repo uses pnpm/u)
  assert.deepEqual(result.contextDecision, {
    event: "prompt",
    mode: "policy-only",
    maxItems: 6,
    maxChars: 3000,
    selected: 0,
    omitted: 0,
    omittedReasons: ["policy-only"],
  })
})

test("user-prompt policy-only emits continuity guidance without memory bodies", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only" } })
  engine.save({ text: "PRIVATE CONTINUITY BODY", status: "approved", category: "project", scopeType: "project" })

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "Where are we in the project?",
  })

  assert.match(result.additionalContext ?? "", /<memory-context mode="policy-only" event="prompt">/u)
  assert.match(result.additionalContext ?? "", /Memory Lane continuity guidance/u)
  assert.match(result.additionalContext ?? "", /memory-lane continuity --json/u)
  assert.match(result.additionalContext ?? "", /memory_continuity\(\{ projectPath \}\)/u)
  assert.match(result.additionalContext ?? "", /Do not answer from memory_recall alone/u)
  assert.match(result.additionalContext ?? "", /memory-lane status --json/u)
  assert.match(result.additionalContext ?? "", /memory-lane dashboard/u)
  assert.match(result.additionalContext ?? "", /Use Memory Lane recall\/list tools/u)
  assert.doesNotMatch(result.additionalContext ?? "", /PRIVATE CONTINUITY BODY/u)
  assert.deepEqual(result.contextDecision?.continuityIntent, {
    detected: true,
    family: "project-position",
    guidanceInjected: true,
  })
})

test("user-prompt off policy suppresses continuity guidance", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "off" } })

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "What should we work on next?",
  })

  assert.equal(result.additionalContext, undefined)
  assert.equal(result.contextDecision?.continuityIntent, undefined)
  assert.deepEqual(result.contextDecision?.omittedReasons, ["off"])
})

test("user-prompt selective emits continuity guidance before relevant memory", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective" } })
  engine.save({
    text: "Prompt continuity intents were implemented in the lifecycle package.",
    status: "approved",
    category: "project",
    scopeType: "project",
  })
  const originalRecall = engine.recall.bind(engine)
  let recallQuery: string | undefined
  engine.recall = async (query, options) => {
    recallQuery = query
    return originalRecall(query, options)
  }

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "Where was prompt continuity intents implemented?",
  })
  const context = result.additionalContext ?? ""

  assert.equal(recallQuery, "prompt continuity intents")
  assert.match(context, /<memory-context mode="selective" event="prompt">/u)
  assert.match(context, /Memory Lane continuity guidance/u)
  assert.match(context, /memory-lane continuity --json/u)
  assert.match(context, /memory_continuity\(\{ projectPath \}\)/u)
  assert.match(context, /Do not answer from memory_recall alone/u)
  assert.match(context, /memory-lane recall 'prompt continuity intents'/u)
  assert.match(context, /## Relevant Memory/u)
  assert.match(context, /Prompt continuity intents were implemented/u)
  assert.ok(context.indexOf("Memory Lane continuity guidance") < context.indexOf("## Relevant Memory"))
  assert.deepEqual(result.contextDecision?.continuityIntent, {
    detected: true,
    family: "lookup",
    topic: "prompt continuity intents",
    guidanceInjected: true,
  })
})

test("user-prompt ordinary prompt remains unchanged", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective" } })
  engine.save({ text: "This repo uses pnpm", status: "approved", category: "project", scopeType: "project" })

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "How do I run tests in this repo?",
  })

  assert.doesNotMatch(result.additionalContext ?? "", /Memory Lane continuity guidance/u)
  assert.equal(result.contextDecision?.continuityIntent, undefined)
})

test("user-prompt selective labels current project memory", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective" } })
  engine.save({ text: "This repo uses pnpm for package management", status: "approved", category: "project", scopeType: "project", kind: "project_fact" })

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "pnpm package management",
  })
  const context = result.additionalContext ?? ""

  assert.match(context, /### Current project/u)
  assert.match(context, /\*\*Project fact\*\*/u)
  assert.doesNotMatch(context, /### Project-specific memory/u)
})

test("session-start off policy injects no baseline context or continuity notice", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "off" } })
  engine.save({ text: "This repo uses pnpm", status: "approved", category: "project", scopeType: "project" })
  saveWorkflowAgreement(engine)

  const result = handleSessionStart(engine, { cwd: project })

  assert.equal(result.additionalContext, undefined)
  assert.equal(result.contextDecision?.continuity, undefined)
  assert.deepEqual(result.contextDecision, {
    event: "sessionStart",
    mode: "off",
    maxItems: 4,
    maxChars: 1600,
    selected: 0,
    omitted: 0,
    omittedReasons: ["off"],
  })
})

test("session-start policy-only injects continuity notice without memory bodies", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only" } })
  saveWorkflowAgreement(engine)

  const result = handleSessionStart(engine, { cwd: project })

  assert.match(result.additionalContext ?? "", /mode="policy-only"/u)
  assert.match(result.additionalContext ?? "", /Continuity notice:/u)
  assert.match(result.additionalContext ?? "", /Current workflow agreements are available/u)
  assert.match(result.additionalContext ?? "", /memory-lane agreements/u)
  assert.doesNotMatch(result.additionalContext ?? "", /PRIVATE WORKFLOW AGREEMENT TEXT/u)
  assert.equal(result.contextDecision?.continuity?.generated, true)
  assert.equal(result.contextDecision?.continuity?.injected, true)
  assert.equal(result.contextDecision?.continuity?.operatingAgreementPrimaryCount, 1)
  assert.equal("text" in (result.contextDecision?.continuity ?? {}), false)
})

test("session-start selective injects continuity notice before relevant memory", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective", maxItems: { sessionStart: 1 } } })
  saveWorkflowAgreement(engine)
  engine.save({ text: "Baseline memory body", status: "approved", category: "project", scopeType: "project" })

  const result = handleSessionStart(engine, { cwd: project })
  const context = result.additionalContext ?? ""

  assert.match(context, /Continuity notice:/u)
  assert.match(context, /## Relevant Memory/u)
  assert.ok(context.indexOf("Continuity notice:") < context.indexOf("## Relevant Memory"))
  assert.match(context, /### Current project/u)
  assert.match(context, /\*\*Project fact\*\*/u)
  assert.match(context, /Baseline memory body/u)
  assert.doesNotMatch(context, /PRIVATE WORKFLOW AGREEMENT TEXT/u)
  assert.equal(result.contextDecision?.selected, 1)
  assert.equal(result.contextDecision?.omitted, 0)
  assert.deepEqual(result.contextDecision?.omittedReasons, [])
  assert.equal(result.contextDecision?.continuity?.injected, true)
})

test("session-start selects current project memory before newer global memory", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective", maxItems: { sessionStart: 1, prompt: 6 } } })
  engine.save({ text: "Current project checkpoint should win baseline selection", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })
  waitForNextMillisecond()
  engine.save({ text: "Global preference newest for all projects", status: "approved", category: "preference", scopeType: "global", kind: "preference" })

  const result = handleSessionStart(engine, { cwd: project }, {
    maxItems: 1,
    targetChars: 500,
    hardMaxChars: 1000,
    absoluteMaxChars: 1000,
  })
  const context = result.additionalContext ?? ""

  assert.match(context, /Current project checkpoint should win baseline selection/u)
  assert.doesNotMatch(context, /Global preference newest for all projects/u)
  assert.match(context, /### Current project/u)
})

test("session-start continuity notice reports newer approved state from since", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only" } })
  engine.save({ text: "PRIVATE NEW CHECKPOINT TEXT", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })

  const result = handleSessionStart(engine, { cwd: project, since: "2000-01-01T00:00:00.000Z" })

  assert.match(result.additionalContext ?? "", /There is newer approved Memory Lane state/u)
  assert.match(result.additionalContext ?? "", /memory-lane status --json --since 2000-01-01T00:00:00.000Z/u)
  assert.doesNotMatch(result.additionalContext ?? "", /PRIVATE NEW CHECKPOINT TEXT/u)
  assert.equal(result.contextDecision?.continuity?.newerApprovedCount, 1)
  assert.deepEqual(result.contextDecision?.continuity?.hintCodes.includes("newer-approved"), true)
  assert.equal("text" in (result.contextDecision?.continuity ?? {}), false)
})

test("session-start tight budget records continuity budget omission", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only", maxChars: { sessionStart: 20 } } })
  saveWorkflowAgreement(engine)

  const result = handleSessionStart(engine, { cwd: project })

  assert.doesNotMatch(result.additionalContext ?? "", /Continuity notice:/u)
  assert.equal(result.contextDecision?.continuity?.generated, true)
  assert.equal(result.contextDecision?.continuity?.injected, false)
  assert.deepEqual(result.contextDecision?.continuity?.omittedReasons, ["continuity-budget"])
})

test("session-start selective policy uses configured item budget", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective", maxItems: { sessionStart: 1 } } })
  engine.save({ text: "First baseline memory", status: "approved", category: "project", scopeType: "project" })
  engine.save({ text: "Second baseline memory", status: "approved", category: "project", scopeType: "project" })

  const result = handleSessionStart(engine, { cwd: project })

  assert.match(result.additionalContext ?? "", /<memory-context/u)
  assert.match(result.additionalContext ?? "", /baseline memory/u)
  assert.equal((result.additionalContext?.match(/baseline memory/gu) ?? []).length, 1)
  assert.deepEqual(result.contextDecision, {
    event: "sessionStart",
    mode: "selective",
    maxItems: 1,
    maxChars: 1600,
    selected: 1,
    omitted: 1,
    continuity: {
      generated: false,
      injected: false,
      omittedReasons: [],
      hintCount: 0,
      hintCodes: [],
      newerApprovedCount: undefined,
      operatingAgreementPrimaryCount: 0,
      suggestedActions: [],
    },
    omittedReasons: ["budget-or-filter"],
  })
})
