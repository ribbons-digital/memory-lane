import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { MemoryEngine, writeConfig } from "@memory-lane/core"
import { tempDir } from "../../core/test/helpers.js"
import { handlePostToolUse, handleSessionStart, handleStop, handleUserPromptSubmit } from "../src/handlers.ts"

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

test("user-prompt selective next-work continuity intent suppresses ordinary recall bodies", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective" } })
  engine.save({
    text: "STALE NEXT SLICE BODY: proceed with an old already-completed implementation slice.",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "project_fact",
  })
  engine.recall = async () => {
    throw new Error("broad next-work prompts should not run ordinary recall")
  }

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "What should we work on next?",
  })
  const context = result.additionalContext ?? ""

  assert.match(context, /<memory-context mode="selective" event="prompt">/u)
  assert.match(context, /Memory Lane continuity guidance/u)
  assert.match(context, /memory-lane continuity --json/u)
  assert.match(context, /memory_continuity\(\{ projectPath \}\)/u)
  assert.match(context, /Do not answer from memory_recall alone/u)
  assert.match(context, /review current plan, roadmap, and review queue when present/u)
  assert.doesNotMatch(context, /## Relevant Memory/u)
  assert.doesNotMatch(context, /STALE NEXT SLICE BODY/u)
  assert.equal(result.contextDecision?.selected, 0)
  assert.equal(result.contextDecision?.omitted, 0)
  assert.deepEqual(result.contextDecision?.omittedReasons, ["broad-continuity-no-recall"])
  assert.deepEqual(result.contextDecision?.continuityIntent, {
    detected: true,
    family: "next-work",
    guidanceInjected: true,
  })
})

test("user-prompt selective natural next-item scope prompt routes to continuity", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective" } })
  engine.save({
    text: "STALE NEXT ITEM BODY: ordinary recall should not answer broad next-action prompts.",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "project_fact",
  })
  engine.recall = async () => {
    throw new Error("natural next-item prompts should not run ordinary recall")
  }

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "what's the next item we should work on and what's its scope?",
  })
  const context = result.additionalContext ?? ""

  assert.match(context, /Memory Lane continuity guidance/u)
  assert.match(context, /memory-lane continuity --json/u)
  assert.doesNotMatch(context, /## Relevant Memory/u)
  assert.doesNotMatch(context, /STALE NEXT ITEM BODY/u)
  assert.equal(result.contextDecision?.continuityIntent?.family, "next-work")
  assert.equal(result.contextDecision?.continuityIntent?.guidanceInjected, true)
})

test("user-prompt selective project-position continuity intent suppresses ordinary recall bodies", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective" } })
  engine.save({
    text: "STALE PROJECT POSITION BODY: an old checkpoint should not compete with continuity.",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "project_fact",
  })
  engine.recall = async () => {
    throw new Error("broad project-position prompts should not run ordinary recall")
  }

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "What were we last working on?",
  })
  const context = result.additionalContext ?? ""

  assert.match(context, /<memory-context mode="selective" event="prompt">/u)
  assert.match(context, /Memory Lane continuity guidance/u)
  assert.match(context, /memory-lane continuity --json/u)
  assert.match(context, /memory_continuity\(\{ projectPath \}\)/u)
  assert.match(context, /Do not answer from memory_recall alone/u)
  assert.match(context, /review current plan, roadmap, and review queue when present/u)
  assert.doesNotMatch(context, /## Relevant Memory/u)
  assert.doesNotMatch(context, /STALE PROJECT POSITION BODY/u)
  assert.equal(result.contextDecision?.selected, 0)
  assert.equal(result.contextDecision?.omitted, 0)
  assert.deepEqual(result.contextDecision?.omittedReasons, ["broad-continuity-no-recall"])
  assert.deepEqual(result.contextDecision?.continuityIntent, {
    detected: true,
    family: "project-position",
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

test("user-prompt greeting injects no prompt context", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective" } })
  engine.save({ text: "This repo uses pnpm", status: "approved", category: "project", scopeType: "project" })

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "Hi!",
  })

  assert.equal(result.additionalContext, undefined)
  assert.equal(result.contextDecision?.selected, 0)
  assert.equal(result.contextDecision?.continuityIntent, undefined)
  assert.deepEqual(result.contextDecision?.omittedReasons, ["low-signal-prompt"])
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

test("user-prompt selective applies project scope before global preferences", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, {
    contextPolicy: {
      mode: "selective",
      maxItems: { prompt: 1 },
      preferenceMaxItems: { prompt: 1 },
    },
  })
  engine.save({ text: "Use pnpm package manager for this repo", status: "approved", category: "preference", scopeType: "project", kind: "preference" })
  waitForNextMillisecond()
  engine.save({ text: "Use pnpm package manager globally", status: "approved", category: "preference", scopeType: "global", kind: "preference" })

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "pnpm package manager",
  })
  const context = result.additionalContext ?? ""

  assert.match(context, /Use pnpm package manager for this repo/u)
  assert.doesNotMatch(context, /Use pnpm package manager globally/u)
  assert.match(context, /### Current project/u)
})

test("user-prompt selective renders project preference before relevant global preference", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, {
    contextPolicy: {
      mode: "selective",
      maxItems: { prompt: 4 },
      preferenceMaxItems: { prompt: 2 },
    },
  })
  engine.save({ text: "Use pnpm package manager for this repo", status: "approved", category: "preference", scopeType: "project", kind: "preference" })
  waitForNextMillisecond()
  engine.save({ text: "Use pnpm package manager globally", status: "approved", category: "preference", scopeType: "global", kind: "preference" })

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "pnpm package manager",
  })
  const context = result.additionalContext ?? ""

  assert.match(context, /### Current project/u)
  assert.match(context, /### Global preferences and workflow rules/u)
  assert.match(context, /Use pnpm package manager for this repo/u)
  assert.match(context, /Use pnpm package manager globally/u)
  assert.ok(context.indexOf("Use pnpm package manager for this repo") < context.indexOf("Use pnpm package manager globally"))
})

test("session-start off policy injects no baseline context or continuity notice", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "off" } })
  engine.save({ text: "This repo uses pnpm", status: "approved", category: "project", scopeType: "project" })
  saveWorkflowAgreement(engine)

  const baselineFile = engine.continuityBaselineDoctor().stateFile
  const result = handleSessionStart(engine, { cwd: project })

  assert.equal(result.additionalContext, undefined)
  assert.equal(result.contextDecision?.continuity, undefined)
  assert.equal(fs.existsSync(baselineFile), false)
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

test("session-start output is unchanged across manual and review handoff modes", () => {
  const project = tempDir()
  const modes = ["manual", "review"] as const
  const outputs = modes.map((handoffMode) => {
    const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only" }, handoffMode })
    return handleSessionStart(engine, { cwd: project })
  })

  assert.deepEqual(outputs[1], outputs[0])
  assert.doesNotMatch(JSON.stringify(outputs), /handoffProposal/u)
})

test("session-start automatic policy-only emits text-free handoff guidance without memory body", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only" }, handoffMode: "automatic" })
  engine.save({ text: "PRIVATE APPROVED HANDOFF BODY", status: "approved", category: "project", scopeType: "project", source: "session-summary", kind: "session_summary" })

  const result = handleSessionStart(engine, { cwd: project })

  assert.match(result.additionalContext ?? "", /approved handoff pointer is available/u)
  assert.doesNotMatch(result.additionalContext ?? "", /PRIVATE APPROVED HANDOFF BODY/u)
  assert.deepEqual(result.contextDecision?.automaticHandoff, {
    active: true,
    eligibleCount: 1,
    selectedCount: 0,
    omittedCount: 1,
    omittedReasons: [],
  })
})

test("session-start automatic selective prioritizes latest approved handoff as a descriptor without double rendering", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective", maxItems: { sessionStart: 1, prompt: 6 } }, handoffMode: "automatic" })
  engine.save({ text: "Latest approved handoff body", status: "approved", category: "project", scopeType: "project", source: "session-summary", kind: "session_summary" })
  waitForNextMillisecond()
  engine.save({ text: "Newer project fact that would otherwise crowd out handoff", status: "approved", category: "project", scopeType: "project", kind: "project_fact" })

  const result = handleSessionStart(engine, { cwd: project })
  const context = result.additionalContext ?? ""

  assert.match(context, /## Memory Index/u)
  assert.match(context, /### Latest approved handoff/u)
  assert.match(context, /\[[a-f0-9]+\] Session summary — Latest approved handoff body/u)
  assert.doesNotMatch(context, /## Always-on Memory[\s\S]*Latest approved handoff body/u)
  assert.equal((context.match(/Latest approved handoff body/gu) ?? []).length, 1)
  assert.equal(result.contextDecision?.descriptorIndex?.selected, 2)
  assert.deepEqual(result.contextDecision?.automaticHandoff, {
    active: true,
    eligibleCount: 1,
    selectedCount: 1,
    omittedCount: 0,
    omittedReasons: [],
  })
})

test("session-start automatic omits pending secret and expired handoff pointers", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective" }, handoffMode: "automatic" })
  engine.save({ text: "Pending handoff body", status: "pending", category: "project", scopeType: "project", source: "session-summary", kind: "session_summary" })
  engine.save({ text: "Expired handoff body", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint", freshness: { expiresAt: "2000-01-01T00:00:00.000Z" } })
  engine.save({ text: "API key is sk-1234567890abcdef1234567890abcdef", status: "approved", category: "project", scopeType: "project", kind: "session_summary" })

  const result = handleSessionStart(engine, { cwd: project })
  const context = result.additionalContext ?? ""

  assert.doesNotMatch(context, /Pending handoff body/u)
  assert.doesNotMatch(context, /Expired handoff body/u)
  assert.doesNotMatch(context, /sk-1234567890/u)
  assert.equal(result.contextDecision?.automaticHandoff?.eligibleCount, 0)
  assert.deepEqual(result.contextDecision?.automaticHandoff?.omittedReasons, ["expired"])
})

test("session-start context policy off does not report automatic handoff metadata", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "off" }, handoffMode: "automatic" })
  engine.save({ text: "Approved handoff body", status: "approved", category: "project", scopeType: "project", source: "session-summary", kind: "session_summary" })

  const result = handleSessionStart(engine, { cwd: project })

  assert.equal(result.additionalContext, undefined)
  assert.equal(result.contextDecision?.automaticHandoff, undefined)
  assert.equal(engine.list({ all: true }).length, 1)
})

test("session-start selective injects continuity notice before memory index", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective", maxItems: { sessionStart: 1 } } })
  saveWorkflowAgreement(engine)
  engine.save({ text: "Baseline memory body", status: "approved", category: "project", scopeType: "project" })

  const result = handleSessionStart(engine, { cwd: project })
  const context = result.additionalContext ?? ""

  assert.match(context, /Continuity notice:/u)
  assert.match(context, /## Memory Index/u)
  assert.ok(context.indexOf("Continuity notice:") < context.indexOf("## Memory Index"))
  assert.match(context, /### Current project/u)
  assert.match(context, /\[[a-f0-9]+\] Project fact — Baseline memory body/u)
  assert.match(context, /memory_get <id>/u)
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
  assert.match(context, /Global preference newest for all projects/u)
  assert.match(context, /### Current project/u)
  assert.match(context, /### Global preferences and workflow rules/u)
})

test("session-start selective preserves preference caps while applying remaining continuity budget", () => {
  const project = tempDir()
  const engine = engineInTemp(project, {
    contextPolicy: {
      mode: "selective",
      maxItems: { sessionStart: 4, prompt: 6 },
      preferenceMaxItems: { sessionStart: 1, prompt: 2 },
    },
  })
  engine.save({ text: "Project checkpoint should remain in baseline context", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })
  waitForNextMillisecond()
  engine.save({ text: "User prefers pnpm globally", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
  waitForNextMillisecond()
  engine.save({ text: "User prefers concise replies globally", status: "approved", category: "preference", scopeType: "global", kind: "preference" })

  const result = handleSessionStart(engine, { cwd: project })
  const context = result.additionalContext ?? ""

  assert.match(context, /Project checkpoint should remain in baseline context/u)
  assert.match(context, /User prefers pnpm globally|User prefers concise replies globally/u)
  assert.equal((context.match(/User prefers/gu) ?? []).length, 1)
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
  assert.equal(result.contextDecision?.continuity?.continuityBaseline?.source, "payload")
  assert.equal(result.contextDecision?.continuity?.continuityBaseline?.since, "2000-01-01T00:00:00.000Z")
  assert.deepEqual(result.contextDecision?.continuity?.hintCodes.includes("newer-approved"), true)
  assert.equal("text" in (result.contextDecision?.continuity ?? {}), false)
})

test("session-start uses prior continuity baseline marker before updating it", () => {
  const project = tempDir()
  const projectKey = fs.realpathSync(project)
  const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only" } })

  const first = handleSessionStart(engine, { cwd: project, since: "2000-01-01T00:00:00.000Z" })
  assert.doesNotMatch(first.additionalContext ?? "", /There is newer approved Memory Lane state/u)
  assert.equal(first.contextDecision?.continuity?.continuityBaseline?.source, "payload")

  engine.save({ text: "PRIVATE APPROVED BETWEEN SESSIONS", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })
  const second = handleSessionStart(engine, { cwd: project, since: "2000-01-02T00:00:00.000Z" })

  assert.match(second.additionalContext ?? "", /There is newer approved Memory Lane state since 2000-01-01T00:00:00.000Z/u)
  assert.doesNotMatch(second.additionalContext ?? "", /PRIVATE APPROVED BETWEEN SESSIONS/u)
  assert.equal(second.contextDecision?.continuity?.continuityBaseline?.source, "marker")
  assert.equal(second.contextDecision?.continuity?.continuityBaseline?.since, "2000-01-01T00:00:00.000Z")
  assert.equal(second.contextDecision?.continuity?.newerApprovedCount, 1)

  const marker = JSON.parse(fs.readFileSync(engine.continuityBaselineDoctor().stateFile, "utf8"))
  assert.equal(marker.projects[projectKey].lastSeenAt, "2000-01-02T00:00:00.000Z")
  assert.equal(engine.list({ all: true }).length, 1)
})

test("session-start continuity baseline is project scoped", () => {
  const projectA = tempDir()
  const projectB = tempDir()
  const engine = engineInTemp(projectA, { contextPolicy: { mode: "policy-only" } })

  handleSessionStart(engine, { cwd: projectB, since: "2000-01-01T00:00:00.000Z" })
  engine.refreshScope(projectB)
  engine.save({ text: "PRIVATE PROJECT B CHECKPOINT", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })

  const result = handleSessionStart(engine, { cwd: projectA, since: "2000-01-02T00:00:00.000Z" })

  assert.doesNotMatch(result.additionalContext ?? "", /There is newer approved Memory Lane state/u)
  assert.doesNotMatch(result.additionalContext ?? "", /PRIVATE PROJECT B CHECKPOINT/u)
  assert.equal(result.contextDecision?.continuity?.continuityBaseline?.source, "payload")
})

test("session-start ignores invalid since without throwing", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only" } })

  let result: ReturnType<typeof handleSessionStart> | undefined
  assert.doesNotThrow(() => { result = handleSessionStart(engine, { cwd: project, since: "2026-06-22T00:00:00Z" }) })

  assert.equal(result?.contextDecision?.continuity?.continuityBaseline?.source, "none")
  assert.doesNotMatch(result?.additionalContext ?? "", /Invalid since timestamp/u)
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
  assert.match(result.additionalContext ?? "", /## Memory Index/u)
  assert.match(result.additionalContext ?? "", /baseline memory/u)
  assert.equal((result.additionalContext?.match(/baseline memory/gu) ?? []).length, 2)
  assert.deepEqual(result.contextDecision, {
    event: "sessionStart",
    mode: "selective",
    maxItems: 1,
    maxChars: 1600,
    selected: 2,
    omitted: 0,
    continuity: {
      generated: false,
      injected: false,
      omittedReasons: [],
      hintCount: 0,
      hintCodes: [],
      newerApprovedCount: undefined,
      operatingAgreementPrimaryCount: 0,
      suggestedActions: [],
      continuityBaseline: { source: "none" },
    },
    descriptorIndex: {
      injected: true,
      maxItems: 16,
      maxChars: 1200,
      effectiveMaxChars: 1200,
      selected: 2,
      omitted: 0,
      generatedFallbackCount: 2,
      fullBodySelected: 0,
      fullBodyOmitted: 0,
    },
    omittedReasons: [],
  })
})

test("session-start descriptor fallback diagnostics reflect final budget trim", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective", maxChars: { sessionStart: 420 } } })
  engine.save({
    text: "Older fallback descriptor body that is safe to summarize after the structured record.",
    status: "approved",
    category: "project",
    scopeType: "project",
  })
  waitForNextMillisecond()
  engine.save({
    text: "Structured descriptor body should not be rendered when descriptor metadata exists.",
    status: "approved",
    category: "project",
    scopeType: "project",
    descriptor: {
      description: "Structured descriptor summary",
      fetchHint: "when descriptor persistence diagnostics are inspected",
    },
  })

  const result = handleSessionStart(engine, { cwd: project })
  const context = result.additionalContext ?? ""

  assert.match(context, /Structured descriptor summary/u)
  assert.doesNotMatch(context, /Older fallback descriptor body/u)
  assert.equal(result.contextDecision?.descriptorIndex?.selected, 1)
  assert.equal(result.contextDecision?.descriptorIndex?.generatedFallbackCount, 0)
})

test("stop captures checkpoint progress as pending project checkpoint", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handleStop(engine, {
    cwd: project,
    sessionId: "session-1",
    turnId: "turn-1",
    lastUserMessage: "Released v0.2.12 and verified the release workflow.",
  }, { adapter: "test" })

  assert.equal(result.saved.length, 1)
  assert.equal(result.saved[0]?.status, "saved")
  if (result.saved[0]?.status !== "saved") throw new Error("expected saved checkpoint")
  assert.equal(result.saved[0].memory.status, "pending")
  assert.equal(result.saved[0].memory.kind, "project_checkpoint")
  assert.equal(result.saved[0].memory.category, "project")
  assert.equal(result.saved[0].memory.scope.type, "project")
  assert.equal(result.saved[0].memory.source, "agent-suggested")
  assert.equal(result.saved[0].memory.provenance?.adapter, "test")
  assert.equal(result.saved[0].memory.provenance?.lifecycleEvent, "turn_stop")
  assert.equal(result.saved[0].memory.provenance?.sessionId, "session-1")
  assert.equal(result.saved[0].memory.provenance?.turnId, "turn-1")
})

test("stop keeps inferred checkpoint for release text that also looks like a project fact", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handleStop(engine, {
    cwd: project,
    lastUserMessage: "This project released v0.2.12.",
  })

  const savedMemories = result.saved.flatMap((save) => save.status === "saved" ? [save.memory] : [])
  const pendingCheckpoints = savedMemories.filter((memory) => memory.status === "pending" && memory.kind === "project_checkpoint")
  assert.equal(pendingCheckpoints.length, 1)
  assert.equal(pendingCheckpoints[0]?.text, "This project released v0.2.12.")
  assert.equal(pendingCheckpoints[0]?.source, "agent-suggested")
})

test("stop keeps inferred checkpoint for merged PR text that also looks like a project fact", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handleStop(engine, {
    cwd: project,
    lastUserMessage: "This repo PR #19 merged after review.",
  })

  const savedMemories = result.saved.flatMap((save) => save.status === "saved" ? [save.memory] : [])
  const pendingCheckpoints = savedMemories.filter((memory) => memory.status === "pending" && memory.kind === "project_checkpoint")
  assert.equal(pendingCheckpoints.length, 1)
  assert.equal(pendingCheckpoints[0]?.text, "This repo PR #19 merged after review.")
  assert.equal(pendingCheckpoints[0]?.source, "agent-suggested")
})

test("stop does not infer duplicate checkpoint for explicit release memory request", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handleStop(engine, {
    cwd: project,
    lastUserMessage: "Remember that we released v0.2.12.",
  })

  assert.equal(result.saved.length, 1)
  assert.equal(result.saved[0]?.status, "saved")
  if (result.saved[0]?.status !== "saved") throw new Error("expected saved explicit memory")
  assert.equal(result.saved[0].memory.text, "we released v0.2.12")
  assert.equal(result.saved[0].memory.status, "approved")
  assert.equal(result.saved[0].memory.kind, "personal_context")
  assert.equal(result.saved[0].memory.source, "user-suggested")
  assert.equal(engine.list({ status: "pending" }).length, 0)
})

test("stop does not infer duplicate checkpoint for explicit merge memory request", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handleStop(engine, {
    cwd: project,
    lastUserMessage: "remember that PR #19 merged after review",
  })

  assert.equal(result.saved.length, 1)
  assert.equal(result.saved[0]?.status, "saved")
  if (result.saved[0]?.status !== "saved") throw new Error("expected saved explicit memory")
  assert.equal(result.saved[0].memory.text, "PR #19 merged after review")
  assert.equal(result.saved[0].memory.status, "approved")
  assert.equal(result.saved[0].memory.kind, "personal_context")
  assert.equal(result.saved[0].memory.source, "user-suggested")
  assert.equal(engine.list({ status: "pending" }).length, 0)
})

test("stop skips duplicate checkpoint candidates", () => {
  const project = tempDir()
  const engine = engineInTemp(project)
  engine.save({ text: "Released v0.2.12.", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })

  const result = handleStop(engine, {
    cwd: project,
    lastUserMessage: "Released v0.2.12.",
  })

  assert.equal(result.saved.length, 0)
  assert.equal(engine.list({ status: "pending" }).length, 0)
})

test("stop captures explicit PR workflow correction as pending project correction", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handleStop(engine, {
    cwd: project,
    sessionId: "session-1",
    turnId: "turn-1",
    lastUserMessage: "You forgot our PR-protected workflow. Do not merge directly to main; open a PR and wait for me to merge before cleanup.",
  }, { adapter: "test" })

  assert.equal(result.saved.length, 1)
  assert.equal(result.saved[0]?.status, "saved")
  if (result.saved[0]?.status !== "saved") throw new Error("expected saved correction")
  assert.equal(result.saved[0].memory.status, "pending")
  assert.equal(result.saved[0].memory.kind, "correction")
  assert.equal(result.saved[0].memory.category, "project")
  assert.equal(result.saved[0].memory.scope.type, "project")
  assert.equal(result.saved[0].memory.source, "agent-suggested")
  assert.match(result.saved[0].memory.text, /^Workflow correction:/u)
  assert.match(result.saved[0].memory.text, /PR-protected workflow/u)
  assert.doesNotMatch(result.saved[0].memory.text, /You forgot/u)
  assert.equal(result.saved[0].memory.provenance?.adapter, "test")
  assert.equal(result.saved[0].memory.provenance?.lifecycleEvent, "turn_stop")
  assert.equal(result.saved[0].memory.provenance?.sessionId, "session-1")
  assert.equal(result.saved[0].memory.provenance?.turnId, "turn-1")
})

test("stop captures review-gate correction as pending project correction", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handleStop(engine, {
    cwd: project,
    lastUserMessage: "You skipped the review gate; do not start implementation before I approve the spec.",
  })

  assert.equal(result.saved.length, 1)
  assert.equal(result.saved[0]?.status, "saved")
  if (result.saved[0]?.status !== "saved") throw new Error("expected saved correction")
  assert.equal(result.saved[0].memory.kind, "correction")
  assert.match(result.saved[0].memory.text, /review gate/u)
})

test("stop ignores generic factual correction and explicit preference requests", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const factual = handleStop(engine, { cwd: project, lastUserMessage: "You got the package name wrong." })
  assert.equal(factual.saved.length, 0)

  const preference = handleStop(engine, { cwd: project, lastUserMessage: "Remember that I prefer concise answers." })
  assert.equal(preference.saved.length, 1)
  assert.equal(preference.saved[0]?.status, "saved")
  if (preference.saved[0]?.status !== "saved") throw new Error("expected explicit preference")
  assert.notEqual(preference.saved[0].memory.kind, "correction")
})

test("stop ignores correction capture for meta wrappers and likely secrets", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const meta = handleStop(engine, {
    cwd: project,
    lastUserMessage: `Task: ## Acceptance Finalization
You skipped the review gate; do not start implementation before approval.`,
  })
  assert.equal(meta.saved.length, 0)

  const secret = handleStop(engine, {
    cwd: project,
    lastUserMessage: "You forgot the review gate and the token api_key = sk-1234567890abcdef1234567890abcdef should not be saved.",
  })
  assert.equal(secret.saved.length, 0)
})

test("stop skips duplicate workflow correction candidates", () => {
  const project = tempDir()
  const engine = engineInTemp(project)
  engine.save({ text: "Workflow correction: When working in this project, follow the PR-protected workflow: open a PR and wait for the user to merge before syncing main, deleting branches or worktrees, or starting the next item.", status: "pending", category: "project", scopeType: "project", kind: "correction" })

  const result = handleStop(engine, {
    cwd: project,
    lastUserMessage: "You violated the PR workflow; wait for me to merge before cleanup.",
  })

  assert.equal(result.saved.length, 0)
})

test("stop skips workflow correction candidate when approved workflow rule already covers it", () => {
  const project = tempDir()
  const engine = engineInTemp(project)
  engine.save({ text: "PR process: open a pull request and wait for merge before deleting branches or worktrees.", status: "approved", category: "project", scopeType: "project", kind: "workflow_rule" })

  const result = handleStop(engine, {
    cwd: project,
    lastUserMessage: "You forgot our PR-protected workflow; don't delete the worktree before I merge the PR.",
  })

  assert.equal(result.saved.length, 0)
})

test("stop persists high-confidence postmortem learning candidate as pending with provenance", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handleStop(engine, {
    cwd: project,
    lastUserMessage: "Why did Pi prompt submit crash after upgrade?",
    lastAssistantMessage: "Pi prompt submit crashed after upgrade. The root cause was that the generated native bridge returned a raw string instead of Pi's custom-message object, violating the host API return shape. Future generated harness adapter changes should add executable contract tests for lifecycle return shape and dogfood the installed artifact through prompt submit before release. Verified by smoke-loading the installed Pi extension and running the prompt-submit lifecycle.",
  }, { adapter: "test" })

  assert.equal(result.saved.length, 1)
  assert.equal(result.saved[0]?.status, "saved")
  if (result.saved[0]?.status !== "saved") throw new Error("expected saved postmortem learning")
  assert.equal(result.saved[0].memory.status, "pending")
  assert.equal(result.saved[0].memory.kind, "procedure")
  assert.equal(result.saved[0].memory.category, "project")
  assert.equal(result.saved[0].memory.scope.type, "project")
  assert.equal(result.saved[0].memory.source, "agent-suggested")
  assert.equal(result.saved[0].memory.provenance?.adapter, "test")
  assert.equal(result.saved[0].memory.provenance?.lifecycleEvent, "turn_stop")
  assert.match(result.saved[0].memory.text, /Pi memory context messages use Pi custom-message shape/u)
})

test("stop skips duplicate same-turn correction and postmortem learning candidates", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handleStop(engine, {
    cwd: project,
    lastUserMessage: "You missed that generated harness adapter contract tests and installed artifact dogfood are required; reviewer inspection was not enough.",
    lastAssistantMessage: "The issue happened because generated harness adapter behavior differed from repo-local adapter behavior. Future generated harness adapter changes should add contract tests and installed artifact dogfood before release. Verified by installed-artifact dogfood.",
  })

  const learningMemories = result.saved
    .filter((entry) => entry.status === "saved")
    .map((entry) => entry.memory)
    .filter((memory) => memory.kind === "correction" || memory.kind === "procedure")

  assert.equal(learningMemories.length, 1)
  assert.equal(learningMemories[0]?.kind, "procedure")
  assert.match(learningMemories[0]?.text ?? "", /Dogfood generated harness adapter changes/u)
})

test("stop preserves distinct same-turn correction when postmortem learning is unrelated", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handleStop(engine, {
    cwd: project,
    lastUserMessage: "You forgot our PR-protected workflow; don't delete the worktree before I merge the PR. Why did Pi prompt submit crash?",
    lastAssistantMessage: "Pi prompt submit crashed. The root cause was the native CLI bridge returned a raw string instead of Pi's custom-message object. Future Pi bridge changes should assert the custom-message return shape and dogfood prompt submit before release. Verified by installed Pi prompt-submit dogfood.",
  })

  const savedMemories = result.saved
    .filter((entry) => entry.status === "saved")
    .map((entry) => entry.memory)

  assert.equal(savedMemories.length, 2)
  assert.ok(savedMemories.some((memory) => memory.kind === "correction" && /PR-protected workflow/u.test(memory.text)))
  assert.ok(savedMemories.some((memory) => memory.kind === "procedure" && /Pi memory context messages use Pi custom-message shape/u.test(memory.text)))
})

test("stop skips duplicate postmortem learning candidate when approved workflow rule covers it", () => {
  const project = tempDir()
  const engine = engineInTemp(project)
  engine.save({
    text: "Procedure: Verify Pi memory context messages use Pi custom-message shape. When: changing the Pi adapter or native CLI bridge prompt-submit behavior. Steps: invoke before_agent_start with realistic fake Pi context; assert returned message is an object with customType, content, and display; dogfood prompt submit in the installed Pi extension. Pitfall: returning a raw string can crash prompt submit even when startup smoke passes. Verify: the installed Pi extension handles prompt submit without crashing.",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "workflow_rule",
  })

  const result = handleStop(engine, {
    cwd: project,
    lastAssistantMessage: "Pi prompt submit crashed. The root cause was generated bridge return shape mismatch. Future generated harness adapter changes should add contract tests and installed artifact dogfood. Verified by prompt-submit dogfood.",
  })

  assert.equal(result.saved.length, 0)
})

test("post-tool-use captures successful release command as pending checkpoint", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handlePostToolUse(engine, {
    cwd: project,
    toolName: "Bash",
    toolInput: { command: "gh release create v0.2.12 --notes-file release.md" },
    toolResponse: { stdout: "https://github.com/ribbons-digital/memory-lane/releases/tag/v0.2.12", exit_code: 0 },
  }, { adapter: "test" })

  assert.equal(result.saved.length, 1)
  assert.equal(result.saved[0]?.status, "saved")
  if (result.saved[0]?.status !== "saved") throw new Error("expected saved checkpoint")
  assert.equal(result.saved[0].memory.text, "Released v0.2.12.")
  assert.equal(result.saved[0].memory.status, "pending")
  assert.equal(result.saved[0].memory.kind, "project_checkpoint")
  assert.equal(result.saved[0].memory.category, "project")
  assert.equal(result.saved[0].memory.scope.type, "project")
  assert.equal(result.saved[0].memory.source, "agent-suggested")
  assert.equal(result.saved[0].memory.provenance?.adapter, "test")
  assert.equal(result.saved[0].memory.provenance?.lifecycleEvent, "post_tool_use")
  assert.equal(result.saved[0].memory.provenance?.toolName, "Bash")
})

test("post-tool-use captures successful merge command as pending checkpoint", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handlePostToolUse(engine, {
    cwd: project,
    toolName: "Bash",
    toolInput: { command: "gh pr merge 19 --squash --delete-branch" },
    toolResponse: { stdout: "Merged pull request #19", exit_code: 0 },
  }, { adapter: "test" })

  assert.equal(result.saved.length, 1)
  assert.equal(result.saved[0]?.status, "saved")
  if (result.saved[0]?.status !== "saved") throw new Error("expected saved checkpoint")
  assert.equal(result.saved[0].memory.text, "Merged PR #19.")
  assert.equal(result.saved[0].memory.status, "pending")
  assert.equal(result.saved[0].memory.kind, "project_checkpoint")
  assert.equal(result.saved[0].memory.category, "project")
  assert.equal(result.saved[0].memory.scope.type, "project")
  assert.equal(result.saved[0].memory.source, "agent-suggested")
  assert.equal(result.saved[0].memory.provenance?.adapter, "test")
  assert.equal(result.saved[0].memory.provenance?.lifecycleEvent, "post_tool_use")
  assert.equal(result.saved[0].memory.provenance?.toolName, "Bash")
})

test("post-tool-use ignores failed release command", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handlePostToolUse(engine, {
    cwd: project,
    toolName: "Bash",
    toolInput: { command: "gh release create v0.2.12" },
    toolResponse: { stderr: "failed", exit_code: 1 },
  })

  assert.equal(result.saved.length, 0)
})

test("post-tool-use persists recovery-backed procedure candidate as pending", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handlePostToolUse(engine, {
    cwd: project,
    toolName: "Bash",
    toolInput: { command: "pnpm test" },
    toolResponse: { stdout: "Tests passed", exit_code: 0 },
    recentToolUses: [{
      toolName: "Bash",
      toolInput: { command: "npm test" },
      toolResponse: { stderr: "missing script: test", exit_code: 1 },
    }],
  }, { adapter: "test" })

  const savedProcedures = result.saved
    .filter((entry) => entry.status === "saved")
    .map((entry) => entry.memory)
    .filter((memory) => memory.kind === "procedure")

  assert.equal(savedProcedures.length, 1)
  assert.equal(savedProcedures[0].status, "pending")
  assert.equal(savedProcedures[0].category, "project")
  assert.equal(savedProcedures[0].scope.type, "project")
  assert.equal(savedProcedures[0].source, "agent-suggested")
  assert.equal(savedProcedures[0].provenance?.adapter, "test")
  assert.equal(savedProcedures[0].provenance?.lifecycleEvent, "post_tool_use")
  assert.equal(savedProcedures[0].provenance?.toolName, "Bash")
  assert.match(savedProcedures[0].text, /^Procedure:/u)
  assert.match(savedProcedures[0].text, /`pnpm test` succeeded/u)
})

test("post-tool-use skips duplicate recovery-backed procedure candidates", () => {
  const project = tempDir()
  const engine = engineInTemp(project)
  engine.save({
    text: "Procedure: Use pnpm for tests in this repo. When: verifying changes. Steps: run `pnpm test`. Pitfall: `npm test` failed or was unavailable. Verify: `pnpm test` succeeded.",
    status: "pending",
    category: "project",
    scopeType: "project",
    kind: "procedure",
  })

  const result = handlePostToolUse(engine, {
    cwd: project,
    toolName: "Bash",
    toolInput: { command: "pnpm test" },
    toolResponse: { stdout: "Tests passed", exit_code: 0 },
    recentToolUses: [{
      toolName: "Bash",
      toolInput: { command: "npm test" },
      toolResponse: { stderr: "missing script: test", exit_code: 1 },
    }],
  })

  const savedProcedures = result.saved
    .filter((entry) => entry.status === "saved")
    .map((entry) => entry.memory)
    .filter((memory) => memory.kind === "procedure")

  assert.equal(savedProcedures.length, 0)
})

test("post-tool-use skips recovery-backed procedure when approved workflow rule already covers it", () => {
  const project = tempDir()
  const engine = engineInTemp(project)
  engine.save({
    text: "`pnpm test` is the test command for this repo.",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "workflow_rule",
  })

  const result = handlePostToolUse(engine, {
    cwd: project,
    toolName: "Bash",
    toolInput: { command: "pnpm test" },
    toolResponse: { stdout: "Tests passed", exit_code: 0 },
    recentToolUses: [{
      toolName: "Bash",
      toolInput: { command: "npm test" },
      toolResponse: { stderr: "missing script: test", exit_code: 1 },
    }],
  })

  assert.equal(result.saved.filter((entry) => entry.status === "saved" && entry.memory.kind === "procedure").length, 0)
})

test("post-tool-use skips recovery-backed procedure when pending correction already covers package manager convention", () => {
  const project = tempDir()
  const engine = engineInTemp(project)
  engine.save({
    text: "Workflow correction: The user corrected the agent because this repo uses pnpm for package manager convention and `npm install` should not be used.",
    status: "pending",
    category: "project",
    scopeType: "project",
    kind: "correction",
  })

  const result = handlePostToolUse(engine, {
    cwd: project,
    toolName: "Bash",
    toolInput: { command: "pnpm install" },
    toolResponse: { stdout: "Already up to date", exit_code: 0 },
    recentToolUses: [{
      toolName: "Bash",
      toolInput: { command: "npm install left-pad" },
      toolResponse: { stderr: "dependency conflict", exit_code: 1 },
    }],
  })

  assert.equal(result.saved.filter((entry) => entry.status === "saved" && entry.memory.kind === "procedure").length, 0)
})
