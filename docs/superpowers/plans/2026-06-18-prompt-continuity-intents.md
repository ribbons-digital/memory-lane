# Prompt-Time Continuity Intents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make natural prompts like “resume building X,” “where was X implemented,” and “what should we work on next” trigger bounded Memory Lane continuity inspection guidance.

**Architecture:** Add a deterministic continuity-intent detector and guidance renderer in lifecycle injection code, then wire `handleUserPromptSubmit` so `policy-only` and `selective` modes can emit guidance without adding writes, new config, or recall ranking changes. Topic-specific intents reuse existing budgeted recall/selection; broad project-position and next-work intents remain inspection-first.

**Tech Stack:** TypeScript, Node test runner, existing `@memory-lane/lifecycle` handlers/injection utilities, `@memory-lane/core` test helpers.

---

## File structure

- Modify `packages/lifecycle/src/injection.ts`
  - Add `ContinuityIntentFamily`, `ContinuityIntent`, `detectContinuityIntent`, and `renderContinuityIntentGuidance`.
  - Keep deterministic regex detection and guidance rendering close to existing prompt-injection helpers.
- Modify `packages/lifecycle/src/types.ts`
  - Add optional text-free `continuityIntent` metadata on `MemoryContextDecision`.
- Modify `packages/lifecycle/src/handlers.ts`
  - In `handleUserPromptSubmit`, detect continuity intent after memory-management list intent and after resolving context policy.
  - For `policy-only`, render continuity guidance plus existing policy guidance.
  - For `selective`, render continuity guidance before relevant memory context and use extracted topic for recall when present.
  - For `off`, suppress continuity guidance.
- Modify `packages/lifecycle/test/injection.test.ts`
  - Unit-test detector and guidance renderer behavior.
- Modify `packages/lifecycle/test/handlers.test.ts`
  - Integration-test prompt policy modes and recall behavior.
- Modify `README.md`, `ROADMAP.md`, `HANDOFF.md`, and `skills/memory-lane/SKILL.md`
  - Document natural prompt continuity behavior and mark this slice complete after implementation.

---

### Task 1: Continuity intent detector and guidance renderer

**Files:**
- Modify: `packages/lifecycle/src/injection.ts`
- Test: `packages/lifecycle/test/injection.test.ts`

- [ ] **Step 1: Add failing detector tests**

Append tests like these to `packages/lifecycle/test/injection.test.ts`:

```ts
import { detectContinuityIntent, renderContinuityIntentGuidance } from "../src/injection.ts"

test("detects resume/build continuity intents with topic", () => {
  assert.deepEqual(detectContinuityIntent("Let's resume building prompt continuity intents"), {
    detected: true,
    family: "resume",
    topic: "prompt continuity intents",
  })
  assert.deepEqual(detectContinuityIntent("continue working on lifecycle notices"), {
    detected: true,
    family: "resume",
    topic: "lifecycle notices",
  })
})

test("detects prior-work lookup continuity intents with topic", () => {
  assert.deepEqual(detectContinuityIntent("Where was lifecycle continuity implemented?"), {
    detected: true,
    family: "lookup",
    topic: "lifecycle continuity",
  })
  assert.deepEqual(detectContinuityIntent("Find the session where prompt intents happened"), {
    detected: true,
    family: "lookup",
    topic: "prompt intents",
  })
})

test("detects project-position and next-work continuity intents", () => {
  assert.deepEqual(detectContinuityIntent("Where are we in the project?"), {
    detected: true,
    family: "project-position",
  })
  assert.deepEqual(detectContinuityIntent("What should we work on next?"), {
    detected: true,
    family: "next-work",
  })
})

test("does not detect ordinary prompts as continuity intents", () => {
  assert.deepEqual(detectContinuityIntent("How do I run tests?"), { detected: false })
  assert.deepEqual(detectContinuityIntent("Use pnpm for installs"), { detected: false })
})

test("renders text-free continuity intent guidance", () => {
  const guidance = renderContinuityIntentGuidance({
    detected: true,
    family: "lookup",
    topic: "lifecycle continuity",
  })

  assert.match(guidance, /Memory Lane continuity guidance/u)
  assert.match(guidance, /prior or ongoing project work/u)
  assert.match(guidance, /memory-lane status --json/u)
  assert.match(guidance, /memory-lane dashboard/u)
  assert.match(guidance, /memory-lane recall "lifecycle continuity"/u)
  assert.doesNotMatch(guidance, /operating agreement/u)
  assert.doesNotMatch(guidance, /continuity hint/u)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- test/injection.test.ts
```

Expected: FAIL because `detectContinuityIntent` and `renderContinuityIntentGuidance` are not exported yet.

- [ ] **Step 3: Implement detector and renderer**

In `packages/lifecycle/src/injection.ts`, add the exported types and helpers near existing prompt-intent helpers:

```ts
export type ContinuityIntentFamily = "resume" | "lookup" | "project-position" | "next-work"

export type ContinuityIntent =
  | { detected: false }
  | { detected: true; family: ContinuityIntentFamily; topic?: string }

function cleanContinuityTopic(topic: string | undefined): string | undefined {
  const cleaned = (topic ?? "")
    .replace(/[?.!]+$/u, "")
    .replace(/^the\s+/iu, "")
    .trim()
    .replace(/\s+/gu, " ")
  return cleaned.length > 0 ? cleaned : undefined
}

export function detectContinuityIntent(prompt: string): ContinuityIntent {
  const input = prompt.trim()
  const normalized = normalizedPrompt(prompt)
  if (!normalized) return { detected: false }

  const resumePatterns = [
    /^(?:let'?s\s+)?resume\s+(?:building|working\s+on|work\s+on)\s+(.+?)\s*$/iu,
    /^continue\s+(?:building|working\s+on|work\s+on)\s+(.+?)\s*$/iu,
    /^pick\s+up\s+(.+?)(?:\s+again)?\s*$/iu,
  ]
  for (const pattern of resumePatterns) {
    const match = input.match(pattern)
    const topic = cleanContinuityTopic(match?.[1])
    if (topic) return { detected: true, family: "resume", topic }
  }

  const lookupPatterns = [
    /^where\s+was\s+(.+?)\s+implemented\??$/iu,
    /^when\s+did\s+we\s+implement\s+(.+?)\??$/iu,
    /^find\s+the\s+(?:thread|session)\s+where\s+(.+?)\s+(?:was\s+built|was\s+implemented|happened|happens|built|implemented)\??$/iu,
  ]
  for (const pattern of lookupPatterns) {
    const match = input.match(pattern)
    const topic = cleanContinuityTopic(match?.[1])
    if (topic) return { detected: true, family: "lookup", topic }
  }

  if (/\bwhere\s+are\s+we\s+(?:in|on)\s+(?:the\s+)?project\b/iu.test(normalized)
    || /\bwhat(?:\s+s|\s+is)\s+the\s+latest\s+progress\b/iu.test(normalized)
    || /\bwhat\s+were\s+we\s+last\s+working\s+on\b/iu.test(normalized)) {
    return { detected: true, family: "project-position" }
  }

  if (/\bwhat\s+should\s+we\s+work\s+on\s+next\b/iu.test(normalized)
    || /\bwhat(?:\s+s|\s+is)\s+next\b/iu.test(normalized)
    || /\bnext\s+slice\b/iu.test(normalized)) {
    return { detected: true, family: "next-work" }
  }

  return { detected: false }
}

export function renderContinuityIntentGuidance(intent: ContinuityIntent): string {
  if (!intent.detected) return ""

  const lines = [
    "## Memory Lane continuity guidance",
    "",
    "This prompt appears to ask about prior or ongoing project work.",
    "Before answering from chat context alone, inspect Memory Lane project state and current project workflow when available.",
    "",
    "Suggested inspection:",
    "- memory-lane status --json",
    "- memory-lane dashboard",
  ]

  if (intent.topic) lines.push(`- memory-lane recall "${intent.topic.replace(/"/gu, "\\\"")}"`)
  if (intent.family === "next-work" || intent.family === "project-position") {
    lines.push("- review ROADMAP.md and HANDOFF.md when present")
  }

  return lines.join("\n")
}
```

- [ ] **Step 4: Run detector tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- test/injection.test.ts
```

Expected: PASS for the new detector/renderer tests and existing injection tests.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add packages/lifecycle/src/injection.ts packages/lifecycle/test/injection.test.ts
git commit -m "feat(lifecycle): detect prompt continuity intents"
```

---

### Task 2: Wire continuity intents into prompt handling

**Files:**
- Modify: `packages/lifecycle/src/types.ts`
- Modify: `packages/lifecycle/src/handlers.ts`
- Test: `packages/lifecycle/test/handlers.test.ts`

- [ ] **Step 1: Add failing handler tests**

Append tests like these to `packages/lifecycle/test/handlers.test.ts`:

```ts
test("user-prompt policy-only emits continuity guidance without memory bodies", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "policy-only" } })
  engine.save({ text: "PRIVATE CONTINUITY BODY", status: "approved", category: "project", scopeType: "project" })

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "Where are we in the project?",
  })

  assert.match(result.additionalContext ?? "", /Memory Lane continuity guidance/u)
  assert.match(result.additionalContext ?? "", /memory-lane status --json/u)
  assert.match(result.additionalContext ?? "", /memory-lane dashboard/u)
  assert.doesNotMatch(result.additionalContext ?? "", /PRIVATE CONTINUITY BODY/u)
  assert.equal(result.contextDecision?.continuityIntent?.detected, true)
  assert.equal(result.contextDecision?.continuityIntent?.family, "project-position")
  assert.equal(result.contextDecision?.continuityIntent?.guidanceInjected, true)
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

  const result = await handleUserPromptSubmit(engine, {
    cwd: project,
    prompt: "Where was prompt continuity intents implemented?",
  })
  const context = result.additionalContext ?? ""

  assert.match(context, /Memory Lane continuity guidance/u)
  assert.match(context, /memory-lane recall "prompt continuity intents"/u)
  assert.match(context, /## Relevant Memory/u)
  assert.match(context, /Prompt continuity intents were implemented/u)
  assert.ok(context.indexOf("Memory Lane continuity guidance") < context.indexOf("## Relevant Memory"))
  assert.equal(result.contextDecision?.continuityIntent?.family, "lookup")
  assert.equal(result.contextDecision?.continuityIntent?.topic, "prompt continuity intents")
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- test/handlers.test.ts
```

Expected: FAIL because handler wiring and `continuityIntent` metadata do not exist yet.

- [ ] **Step 3: Add prompt continuity metadata type**

In `packages/lifecycle/src/types.ts`, add:

```ts
export interface PromptContinuityIntentDecision {
  detected: boolean
  family?: "resume" | "lookup" | "project-position" | "next-work"
  topic?: string
  guidanceInjected: boolean
}
```

Then extend `MemoryContextDecision`:

```ts
export interface MemoryContextDecision {
  event: "prompt" | "sessionStart"
  mode: "off" | "policy-only" | "selective"
  maxItems: number
  maxChars: number
  selected: number
  omitted: number
  omittedReasons: string[]
  continuity?: ContinuityContextDecision
  continuityIntent?: PromptContinuityIntentDecision
}
```

- [ ] **Step 4: Wire handler logic**

Update imports in `packages/lifecycle/src/handlers.ts`:

```ts
import { detectContinuityIntent, isMemoryManagementListIntent, limitsFromContextPolicy, renderContinuityIntentGuidance, renderContinuityNotice, renderMemoryContext, renderMemoryManagementListGuidance, resolveContextPolicy, selectBaselineMemories, selectMemoriesForInjection, type MemoryInjectionLimits } from "./injection.js"
```

Add helper functions near `continuityDecision`:

```ts
function promptContinuityDecision(intent: ReturnType<typeof detectContinuityIntent>, guidanceInjected: boolean): MemoryContextDecision["continuityIntent"] {
  if (!intent.detected) return undefined
  return {
    detected: true,
    family: intent.family,
    topic: intent.topic,
    guidanceInjected,
  }
}

function composePromptContext(input: { guidance: string; memoryContext: string; policy: ReturnType<typeof resolveContextPolicy> }): string {
  const guidance = input.guidance.trim()
  const memoryContext = input.memoryContext.trim()
  if (!guidance && !memoryContext) return ""
  if (!guidance) return memoryContext

  const rawInner = memoryContext.startsWith("<memory-context")
    ? memoryContext
      .replace(/^<memory-context[^>]*>\n?/u, "")
      .replace(/\n?<\/memory-context>$/u, "")
    : memoryContext
  const body = [guidance, rawInner].filter((part) => part.trim().length > 0).join("\n\n")
  return [`<memory-context mode="${input.policy.mode}" event="prompt">`, body, "</memory-context>"].join("\n")
}
```

Then update `handleUserPromptSubmit` after resolving policy and budget:

```ts
  const intent = detectContinuityIntent(input.prompt)
  const guidance = renderContinuityIntentGuidance(intent)
  const guidanceInjected = Boolean(guidance)
```

For `policy-only`, replace the existing return with:

```ts
  if (policy.mode === "policy-only") {
    const policyGuidance = renderMemoryContext({ event: "prompt", memories: [], policy })
    const rendered = composePromptContext({ guidance, memoryContext: policyGuidance, policy })
    return createResult(rendered || undefined, contextDecision({
      event: "prompt",
      mode: policy.mode,
      ...budget,
      selected: 0,
      omitted: 0,
      omittedReasons: ["policy-only"],
      continuityIntent: promptContinuityDecision(intent, guidanceInjected),
    }))
  }
```

For `selective`, use topic-aware recall and compose guidance before memory context:

```ts
  const recallQuery = intent.detected && intent.topic ? intent.topic : input.prompt
  const recalled = await engine.recall(recallQuery)
  const selected = selectMemoriesForInjection(recallQuery, recalled, limitsFromContextPolicy("prompt", policy, options))
  const memoryContext = renderMemoryContext({ event: "prompt", memories: selected, policy })
  const rendered = composePromptContext({ guidance, memoryContext, policy })
  return createResult(rendered || undefined, contextDecision({
    event: "prompt",
    mode: policy.mode,
    ...budget,
    selected: selected.length,
    omitted: Math.max(0, recalled.memories.length - selected.length),
    continuityIntent: promptContinuityDecision(intent, guidanceInjected),
  }))
```

Keep the existing `off` branch before guidance rendering or make sure it returns without `continuityIntent`.

- [ ] **Step 5: Run handler tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- test/handlers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full lifecycle tests and build**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/lifecycle build
```

Expected: all lifecycle tests pass and TypeScript compile passes.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add packages/lifecycle/src/types.ts packages/lifecycle/src/handlers.ts packages/lifecycle/test/handlers.test.ts
git commit -m "feat(lifecycle): guide prompt continuity intents"
```

---

### Task 3: Documentation, roadmap, and final verification

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`
- Modify: `skills/memory-lane/SKILL.md`

- [ ] **Step 1: Update README prompt-context docs**

In `README.md`, near the context policy / lifecycle continuity section, add a short subsection:

```md
### Prompt-time continuity guidance

When lifecycle prompt hooks receive natural continuity questions such as “resume building X,” “where was X implemented,” “what were we last working on,” or “what should we work on next,” Memory Lane may add a compact inspection-first guidance block. The guidance tells the agent to inspect project state with commands such as `memory-lane status --json`, `memory-lane dashboard`, and targeted `memory-lane recall "X"` when a topic is detected.

This prompt-time guidance is governed by `memory.contextPolicy.mode`: `off` suppresses it, `policy-only` emits guidance without memory bodies, and `selective` can render guidance before the normal budgeted relevant-memory block. It does not write memories, run cleanup, change recall ranking, or require users to know Memory Lane internal terms such as operating agreements or continuity hints.
```

- [ ] **Step 2: Update skill guidance**

In `skills/memory-lane/SKILL.md`, add concise user-facing guidance near existing context/lifecycle notes:

```md
Prompt-time continuity guidance: if the user asks natural questions like “resume building X,” “where was X implemented,” “where are we,” “what were we last working on,” or “what should we work on next,” Memory Lane may inject inspection-first guidance. Treat it as a cue to inspect status/dashboard/recall/roadmap before answering from chat context alone. It is not a memory body and does not mean Memory Lane performed cleanup or saved new progress.
```

- [ ] **Step 3: Update ROADMAP**

In `ROADMAP.md`, add a completed item immediately after Phase 16 or as the first Phase 17-enabling continuity slice:

```md
Completed prompt-continuity bridge:

1. Added deterministic prompt-time continuity intents for natural prompts such as “resume building X,” “where was X implemented,” “what were we last working on,” and “what should we work on next.”
2. Kept behavior inspection-first and policy-governed: `off` suppresses guidance, `policy-only` emits guidance without memory bodies, and `selective` can render guidance before normal budgeted recall.
3. Did not add checkpoint capture, writes, cleanup, recall ranking changes, workstream/thread ids, new config flags, or LLM intent classification.
```

Do not mark Phase 17 checkpoint capture complete.

- [ ] **Step 4: Update HANDOFF**

Add a top Recent changes bullet:

```md
- Prompt-time continuity intents complete: natural prompts like “resume building X,” “where was X implemented,” “what were we last working on,” and “what should we work on next” now trigger bounded Memory Lane inspection guidance under existing context policy. Topic-specific prompts can use targeted budgeted recall. No checkpoint capture, memory writes, cleanup, recall ranking changes, workstream/thread ids, new config flags, or LLM classifier were added. Next recommended item remains Phase 17 review-first progress/checkpoint capture.
```

Also fix the stale current-state sentence if it still claims current `main` is tagged exactly at `v0.2.9`; change it to:

```md
Current `main` is ahead of the last documented `v0.2.9` release tag; use `git describe --tags --always` for the exact local state.
```

- [ ] **Step 5: Run full verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: all tests pass, all packages build, and no whitespace errors.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add README.md ROADMAP.md HANDOFF.md skills/memory-lane/SKILL.md
git commit -m "docs: document prompt continuity intents"
```

- [ ] **Step 7: Final PR readiness check**

Run:

```bash
git status --short
git log --oneline --decorate --max-count=8
git diff --stat main..HEAD
```

Expected:

- working tree clean;
- commits include spec, detector, handler, docs;
- diff includes only lifecycle prompt-continuity implementation, tests, docs, and glossary/spec/plan files.

---

## Self-review checklist

- Spec coverage: Task 1 covers deterministic detection and renderer. Task 2 covers policy behavior, topic-specific recall, ordinary prompt unchanged, text-free metadata, and guidance ordering. Task 3 covers docs/roadmap/handoff and final verification.
- Scope control: No task adds memory writes, config flags, LLM classification, MCP mutation tools, recall ranking changes, exact thread lookup, workstream IDs, or Phase 17 checkpoint capture.
- Type consistency: `ContinuityIntentFamily`, `ContinuityIntent`, `PromptContinuityIntentDecision`, `continuityIntent`, `detectContinuityIntent`, and `renderContinuityIntentGuidance` names are used consistently across tasks.
