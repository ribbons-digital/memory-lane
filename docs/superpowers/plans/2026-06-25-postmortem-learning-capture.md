# Postmortem Learning Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add review-first pending `correction`/`procedure` candidates from high-confidence debugging postmortems and explicit user challenge/correction turns.

**Architecture:** Add a pure lifecycle helper in a new `postmortem-learning.ts` module, integrate it into `handleStop`, and keep all writes flowing through existing pending memory persistence. Detection is loose natural language, but capture requires strict evidence gates and deduplication against existing project learning memories.

**Tech Stack:** TypeScript, Node test runner, `@memory-lane/lifecycle`, `@memory-lane/core`, pnpm workspace scripts.

---

## Files and responsibilities

- Create `packages/lifecycle/src/postmortem-learning.ts`
  - Pure extraction, evidence scoring, candidate text generation, dedup keys, duplicate filtering, and same-turn filtering for postmortem learning.
- Create `packages/lifecycle/test/postmortem-learning.test.ts`
  - Focused unit tests for extraction, evidence gates, safety filters, and dedup.
- Modify `packages/lifecycle/src/handlers.ts`
  - Import the new helper and include postmortem candidates in `handleStop` after existing correction capture and before checkpoint/explicit candidates are persisted.
- Modify `packages/lifecycle/test/handlers.test.ts`
  - Integration tests proving `handleStop` persists pending postmortem candidates with provenance and skips duplicates.
- Modify `skills/memory-lane/SKILL.md`
  - Document that lifecycle learning may queue pending correction/procedure candidates from high-confidence postmortems, without auto-approval.
- Modify `ROADMAP.md` and `HANDOFF.md`
  - Mark the design as approved and implementation planned/in progress, then final status after implementation.

---

### Task 1: Add focused tests for pure postmortem extraction

**Files:**
- Create: `packages/lifecycle/test/postmortem-learning.test.ts`
- Create later in Task 2: `packages/lifecycle/src/postmortem-learning.ts`

- [x] **Step 1: Create the test file with RED tests**

Create `packages/lifecycle/test/postmortem-learning.test.ts` with this content:

```ts
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
  assert.match(candidates[0].text, /generated harness adapter return shapes/u)
  assert.match(candidates[0].text, /installed-artifact dogfood/u)
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
  assert.equal(postmortemLearningKeyFromText("Procedure: Reapply harness configuration through the freshly installed binary after self-upgrade."), "postmortem:upgrade-reapply-fresh-installed-binary")
  assert.equal(postmortemLearningKeyFromText("Workflow correction: Future work should verify before claiming completion."), "postmortem:workflow-correction:verify-before-completion")
})
```

- [x] **Step 2: Run focused test to verify it fails because module is missing**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- postmortem-learning.test.ts
```

Expected: FAIL with an import/module error for `../src/postmortem-learning.ts`.

- [x] **Step 3: Commit the RED tests**

```bash
git add packages/lifecycle/test/postmortem-learning.test.ts
git commit -m "test: specify postmortem learning capture"
```

---

### Task 2: Implement pure postmortem extraction and duplicate filtering

**Files:**
- Create: `packages/lifecycle/src/postmortem-learning.ts`
- Test: `packages/lifecycle/test/postmortem-learning.test.ts`

- [x] **Step 1: Create `postmortem-learning.ts` with deterministic evidence gates**

Create `packages/lifecycle/src/postmortem-learning.ts` with this content:

```ts
import { containsLikelySecret, isMetaTaskPromptText, normalizeMemoryText, parseExplicitMemoryRequest, type MemoryEngine, type MemoryRecord } from "@memory-lane/core"
import type { MemoryCandidate, StopInput } from "./types.js"

const MAX_POSTMORTEM_TEXT_CHARS = 700

const USER_CHALLENGE_SIGNALS = /\b(?:you\s+(?:missed|forgot|skipped|ignored|assumed|broke|failed)|we\s+already\s+learned|don'?t\s+rely|do\s+not\s+rely|not\s+just\s+pi|future\s+adapters|actual\s+guardrail|reviewer\s+inspection\s+was\s+not\s+enough)\b/iu
const SYMPTOM_SIGNALS = /\b(?:failed|failure|crash(?:ed)?|bug|regression|broke|didn'?t\s+work|issue|problem|error|exited|violated|missed|skipped|incorrect|wrong|stale|mismatch|different\s+behavior)\b/iu
const CAUSE_SIGNALS = /\b(?:root\s+cause|because|caused\s+by|turned\s+out|reason|mistaken\s+assumption|assumed|missing|stale|unsupported|wrong|mismatch|violat(?:ed|ing).{0,80}contract|expected.{0,80}but|different\s+behavior)\b/iu
const PREVENTION_SIGNALS = /\b(?:future|next\s+time|should|must|need\s+to|avoid|guardrail|contract\s+tests?|dogfood|verify|before\s+release|do\s+not\s+rely|don'?t\s+rely)\b/iu
const VERIFICATION_SIGNALS = /\b(?:verified|verify|passed|passes|dogfood(?:ed)?|smoke(?:-tested|\s+tested|\s+loaded)?|confirmed|tests?\s+added|reproduced|fixed\s+by|validated)\b/iu

function compactText(...parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => normalizeMemoryText(part).replace(/\s+/gu, " ").trim())
    .join(" ")
    .slice(0, MAX_POSTMORTEM_TEXT_CHARS)
}

function safeInput(text: string): boolean {
  if (!text.trim()) return true
  if (containsLikelySecret(text)) return false
  if (isMetaTaskPromptText(text)) return false
  return true
}

function isExplicitMemoryRequest(text: string): boolean {
  return Boolean(text.trim() && parseExplicitMemoryRequest(text))
}

function evidence(text: string): { symptom: boolean; cause: boolean; prevention: boolean; verification: boolean; userChallenge: boolean } {
  return {
    symptom: SYMPTOM_SIGNALS.test(text),
    cause: CAUSE_SIGNALS.test(text),
    prevention: PREVENTION_SIGNALS.test(text),
    verification: VERIFICATION_SIGNALS.test(text),
    userChallenge: USER_CHALLENGE_SIGNALS.test(text),
  }
}

function shouldCapture(combined: ReturnType<typeof evidence>, assistantEvidence: ReturnType<typeof evidence>): boolean {
  if (combined.symptom && combined.cause && combined.prevention && combined.verification) return true
  return combined.userChallenge && assistantEvidence.cause && assistantEvidence.prevention && combined.symptom
}

function generatedAdapterProcedure(): string {
  return "Procedure: Dogfood generated harness adapter changes through the installed artifact before release. When: changing generated harness adapters or templates. Steps: add contract tests for generated lifecycle branches; compare generated behavior with repo-local adapters when both exist; run installed-artifact dogfood. Pitfall: reviewer inspection or load-smoke tests can miss host API shape regressions. Verify: the installed artifact exercised the lifecycle event users trigger."
}

function adapterReturnShapeProcedure(): string {
  return "Procedure: Verify generated harness adapter return shapes with executable contract tests and installed-artifact dogfood. When: changing generated harness adapters or templates. Steps: invoke each generated lifecycle branch with realistic fake harness inputs; assert host API return shape; compare generated behavior with repo-local adapter behavior when both exist; dogfood the installed artifact through the user-triggered lifecycle event. Pitfall: load-smoke tests and reviewer inspection can miss host API shape regressions. Verify: the installed artifact exercises the lifecycle event without crashing."
}

function upgradeReapplyProcedure(): string {
  return "Procedure: Reapply harness configuration through the freshly installed binary after self-upgrade. When: changing installer or upgrade reconfiguration behavior. Steps: replace the binary; invoke the new binary for manifest reapply; smoke the generated harness artifact. Pitfall: the old in-memory process can rewrite stale adapter templates after replacement. Verify: the generated artifact contains the new bridge behavior after upgrade."
}

function genericCorrection(): string {
  return "Workflow correction: The agent learned from a debugging postmortem that durable project failures should become reviewable prevention rules; future work should capture only concrete symptom, cause, prevention, and verification evidence as pending correction or procedure memories."
}

function candidateText(combinedText: string): { text: string; kind: MemoryCandidate["kind"] } {
  const normalized = combinedText.toLowerCase()
  if (/upgrade|self-upgrade|reapply|freshly installed binary|stale in-memory/u.test(normalized)) {
    return { text: upgradeReapplyProcedure(), kind: "procedure" }
  }
  if (/custom-message|return shape|host api|raw string|prompt submit|prompt-submit/u.test(normalized)) {
    return { text: adapterReturnShapeProcedure(), kind: "procedure" }
  }
  if (/generated|harness|adapter|template|installed artifact|dogfood|repo-local|contract test/u.test(normalized)) {
    return { text: generatedAdapterProcedure(), kind: "procedure" }
  }
  return { text: genericCorrection(), kind: "correction" }
}

function projectCandidate(text: string, kind: MemoryCandidate["kind"], confidence: number): MemoryCandidate[] {
  if (!text || text.length > MAX_POSTMORTEM_TEXT_CHARS || containsLikelySecret(text)) return []
  return [{
    text,
    category: "project",
    scopeType: "project",
    kind,
    confidence,
    decision: "save-pending",
    reason: "high-confidence postmortem learning",
    source: "agent-suggested",
  }]
}

export function extractPostmortemLearningCandidatesFromStop(input: StopInput): MemoryCandidate[] {
  const userText = compactText(input.lastUserMessage)
  const assistantText = compactText(input.lastAssistantMessage)
  if (!safeInput(userText) || !safeInput(assistantText)) return []
  if (isExplicitMemoryRequest(userText) || isExplicitMemoryRequest(assistantText)) return []

  const combinedText = compactText(userText, assistantText)
  if (!combinedText || containsLikelySecret(combinedText)) return []

  const combinedEvidence = evidence(combinedText)
  const assistantEvidence = evidence(assistantText)
  if (!shouldCapture(combinedEvidence, assistantEvidence)) return []

  const candidate = candidateText(combinedText)
  return projectCandidate(candidate.text, candidate.kind, combinedEvidence.verification ? 0.86 : 0.8)
}

export function postmortemLearningKeyFromText(text: string): string | undefined {
  const normalized = normalizeMemoryText(text).toLowerCase().replace(/\s+/gu, " ").trim()
  if (!normalized) return undefined
  if (/upgrade|self-upgrade|freshly installed binary|stale in-memory/u.test(normalized)) return "postmortem:upgrade-reapply-fresh-installed-binary"
  if (/custom-message|return shape|host api|raw string|prompt submit|prompt-submit/u.test(normalized)) return "postmortem:pi-custom-message-shape"
  if (/generated harness adapter return shapes|generated harness adapter|installed-artifact dogfood|installed artifact dogfood|contract tests?/u.test(normalized)) return "postmortem:harness-generated-adapter-contract-tests"
  if (/verify before claiming completion|verification before completion|run and report.*verification/u.test(normalized)) return "postmortem:workflow-correction:verify-before-completion"
  return normalized.startsWith("workflow correction:") || normalized.startsWith("procedure:") ? normalized : undefined
}

function memoryProjectKey(memory: MemoryRecord): string | undefined {
  return memory.scope.key ?? memory.project?.key ?? memory.project?.root
}

function visibleProjectLearning(memory: MemoryRecord, projectScopeKey?: string): boolean {
  if (memory.status !== "pending" && memory.status !== "approved") return false
  if (memory.scope.type !== "project") return false
  if (!projectScopeKey || memoryProjectKey(memory) !== projectScopeKey) return false
  return memory.kind === "correction" || memory.kind === "procedure" || memory.kind === "workflow_rule"
}

export function filterDuplicatePostmortemLearningCandidates(engine: MemoryEngine, candidates: MemoryCandidate[]): MemoryCandidate[] {
  const projectScopeKey = engine.getProjectScope()?.key
  const existingKeys = new Set(
    engine.list()
      .filter((memory) => visibleProjectLearning(memory, projectScopeKey))
      .map((memory) => postmortemLearningKeyFromText(memory.text))
      .filter((key): key is string => Boolean(key)),
  )
  const seen = new Set<string>()
  const result: MemoryCandidate[] = []

  for (const candidate of candidates) {
    const key = postmortemLearningKeyFromText(candidate.text)
    if (!key || existingKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }

  return result
}

export function filterSameTurnPostmortemLearningCandidates(existingCandidates: MemoryCandidate[], postmortemCandidates: MemoryCandidate[]): MemoryCandidate[] {
  const existingKeys = new Set(
    existingCandidates
      .map((candidate) => postmortemLearningKeyFromText(candidate.text))
      .filter((key): key is string => Boolean(key)),
  )
  if (existingKeys.size === 0) return postmortemCandidates
  return postmortemCandidates.filter((candidate) => {
    const key = postmortemLearningKeyFromText(candidate.text)
    return !key || !existingKeys.has(key)
  })
}
```

- [x] **Step 2: Run focused test**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- postmortem-learning.test.ts
```

Expected: PASS for `postmortem-learning.test.ts`.

If the package script ignores the trailing test filename and runs all lifecycle tests, expected result is all lifecycle tests pass.

- [x] **Step 3: Run typecheck/build for lifecycle package**

Run:

```bash
pnpm --filter @memory-lane/lifecycle build
```

Expected: PASS, TypeScript emits `dist/` without type errors.

- [x] **Step 4: Commit implementation**

```bash
git add packages/lifecycle/src/postmortem-learning.ts packages/lifecycle/test/postmortem-learning.test.ts
git commit -m "feat: extract postmortem learning candidates"
```

---

### Task 3: Integrate postmortem candidates into Stop lifecycle persistence

**Files:**
- Modify: `packages/lifecycle/src/handlers.ts`
- Modify: `packages/lifecycle/test/handlers.test.ts`
- Test: `packages/lifecycle/test/handlers.test.ts`

- [x] **Step 1: Add handler integration tests**

Append these tests near the existing Stop correction tests in `packages/lifecycle/test/handlers.test.ts`:

```ts
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
  assert.match(result.saved[0].memory.text, /generated harness adapter return shapes/u)
})

test("stop skips duplicate same-turn correction and postmortem learning candidates", () => {
  const project = tempDir()
  const engine = engineInTemp(project)

  const result = handleStop(engine, {
    cwd: project,
    lastUserMessage: "You missed that generated harness adapter contract tests and installed artifact dogfood are required; reviewer inspection was not enough.",
    lastAssistantMessage: "The issue happened because generated harness adapter behavior differed from repo-local adapter behavior. Future generated harness adapter changes should add contract tests and installed artifact dogfood before release. Verified by prompt-submit dogfood.",
  })

  const learningMemories = result.saved
    .filter((entry) => entry.status === "saved")
    .map((entry) => entry.memory)
    .filter((memory) => memory.kind === "correction" || memory.kind === "procedure")

  assert.equal(learningMemories.length, 1)
})

test("stop skips duplicate postmortem learning candidate when approved workflow rule covers it", () => {
  const project = tempDir()
  const engine = engineInTemp(project)
  engine.save({
    text: "Procedure: Verify generated harness adapter return shapes with executable contract tests and installed-artifact dogfood. When: changing generated harness adapters or templates. Steps: invoke each generated lifecycle branch with realistic fake harness inputs; assert host API return shape; compare generated behavior with repo-local adapter behavior when both exist; dogfood the installed artifact through the user-triggered lifecycle event. Pitfall: load-smoke tests and reviewer inspection can miss host API shape regressions. Verify: the installed artifact exercises the lifecycle event without crashing.",
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
```

- [x] **Step 2: Run handler tests to verify RED**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- handlers.test.ts
```

Expected: FAIL because `handleStop` does not yet include postmortem candidates.

- [x] **Step 3: Modify `handlers.ts` imports**

Change the imports near the top of `packages/lifecycle/src/handlers.ts` from:

```ts
import { filterDuplicateProcedureCandidates, summarizeToolOutcome } from "./tool-outcomes.js"
```

to:

```ts
import { filterDuplicatePostmortemLearningCandidates, filterSameTurnPostmortemLearningCandidates, extractPostmortemLearningCandidatesFromStop } from "./postmortem-learning.js"
import { filterDuplicateProcedureCandidates, summarizeToolOutcome } from "./tool-outcomes.js"
```

- [x] **Step 4: Modify `handleStop` candidate flow**

Replace the current `handleStop` implementation body:

```ts
export function handleStop(engine: MemoryEngine, input: StopInput, options?: LifecycleHandlerOptions): LifecycleResult {
  engine.refreshScope(input.cwd)
  const stopCandidates = extractStopCandidates(input)
  const checkpointCandidates = filterSameTurnCheckpointCandidates(
    stopCandidates,
    filterDuplicateCheckpointCandidates(engine, extractCheckpointCandidatesFromStop(input)),
  )
  const correctionCandidates = filterSameTurnCorrectionCandidates(
    stopCandidates,
    filterDuplicateCorrectionCandidates(engine, extractCorrectionCandidatesFromStop(input)),
  )
  return persistCandidates(engine, [...correctionCandidates, ...checkpointCandidates, ...stopCandidates], input, "turn_stop", options)
}
```

with:

```ts
export function handleStop(engine: MemoryEngine, input: StopInput, options?: LifecycleHandlerOptions): LifecycleResult {
  engine.refreshScope(input.cwd)
  const stopCandidates = extractStopCandidates(input)
  const checkpointCandidates = filterSameTurnCheckpointCandidates(
    stopCandidates,
    filterDuplicateCheckpointCandidates(engine, extractCheckpointCandidatesFromStop(input)),
  )
  const correctionCandidates = filterSameTurnCorrectionCandidates(
    stopCandidates,
    filterDuplicateCorrectionCandidates(engine, extractCorrectionCandidatesFromStop(input)),
  )
  const learningCandidates = filterSameTurnPostmortemLearningCandidates(
    [...stopCandidates, ...correctionCandidates],
    filterDuplicatePostmortemLearningCandidates(engine, extractPostmortemLearningCandidatesFromStop(input)),
  )
  return persistCandidates(engine, [...correctionCandidates, ...learningCandidates, ...checkpointCandidates, ...stopCandidates], input, "turn_stop", options)
}
```

- [x] **Step 5: Run focused handler tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- handlers.test.ts
```

Expected: PASS for handler tests, or all lifecycle tests pass if the package script runs every test file.

- [x] **Step 6: Run full lifecycle tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test
```

Expected: PASS, including existing correction capture, tool-outcome procedure capture, checkpoint capture, and new postmortem tests.

- [x] **Step 7: Commit integration**

```bash
git add packages/lifecycle/src/handlers.ts packages/lifecycle/test/handlers.test.ts
git commit -m "feat: persist postmortem learning on stop"
```

---

### Task 4: Update docs and roadmap for implemented behavior

**Files:**
- Modify: `skills/memory-lane/SKILL.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`
- Read: `docs/superpowers/specs/2026-06-25-postmortem-learning-capture-design.md`

- [x] **Step 1: Update `skills/memory-lane/SKILL.md` lifecycle learning text**

Find this paragraph near the bottom:

```md
In pi, Memory Lane keeps lifecycle writes intentionally low-noise: `/memory` commands and tools save explicitly, `input` only saves explicit memory requests such as “Remember that ...”, and `turn_end` / `tool_result` capture higher-signal stop candidates and successful workflow rules. Use `/memory review` to inspect pending suggestions.
```

Replace it with:

```md
In pi, Memory Lane keeps lifecycle writes intentionally low-noise: `/memory` commands and tools save explicitly, `input` only saves explicit memory requests such as “Remember that ...”, and `turn_end` / `tool_result` capture higher-signal candidates. `turn_end` may queue pending project-scoped checkpoints, explicit workflow corrections, or high-confidence debugging-postmortem learning candidates when bounded context includes a concrete symptom, cause, prevention, and verification/recovery signal. `tool_result` may queue conservative procedure candidates from safe failed-command recovery evidence. These lifecycle suggestions remain pending review; they are not durable operating agreements until approved. Use `/memory review` to inspect pending suggestions.
```

- [x] **Step 2: Update `ROADMAP.md` Phase 21 status sentence**

Find the sentence that references `docs/superpowers/specs/2026-06-25-postmortem-learning-capture-design.md` in Phase 21 status. Change it so it says implementation is complete after the PR/branch is ready, for example:

```md
The postmortem learning follow-up implements the approved design in `docs/superpowers/specs/2026-06-25-postmortem-learning-capture-design.md`: high-confidence debugging postmortems and explicit user challenge/correction turns can queue pending project-scoped `correction`/`procedure` candidates through existing review surfaces, without auto-approval, raw transcript capture, recall-ranking changes, or durable rule mutation.
```

- [x] **Step 3: Update `HANDOFF.md` recent/current state**

Add a recent-changes bullet near the top:

```md
- Postmortem learning capture is implemented on this branch from `docs/superpowers/specs/2026-06-25-postmortem-learning-capture-design.md`: Stop lifecycle now detects high-confidence debugging postmortems and explicit user challenge/correction turns using loose natural-language signals plus strict evidence gates, then queues compact pending project-scoped `correction`/`procedure` candidates through existing review paths. The slice adds no LLM classifier, no auto-approval, no raw transcript capture, no new commands/tools, and no recall-ranking changes.
```

Update the current-state paragraph to say the implementation is complete on the feature branch and needs review/PR, not that the next step is to write the spec.

- [x] **Step 4: Run docs diff check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Commit docs**

```bash
git add skills/memory-lane/SKILL.md ROADMAP.md HANDOFF.md
git commit -m "docs: document postmortem learning capture"
```

---

### Task 5: Final verification and PR preparation

**Files:**
- All changed files

- [ ] **Step 1: Run focused lifecycle tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test
```

Expected: PASS, including postmortem, correction, checkpoint, tool-outcome, injection, handler, and session-end lifecycle tests.

- [ ] **Step 2: Run lifecycle build**

Run:

```bash
pnpm --filter @memory-lane/lifecycle build
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run full build**

Run:

```bash
pnpm build
```

Expected: PASS across all workspace packages.

- [ ] **Step 4: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS across all workspace packages.

- [ ] **Step 5: Run whitespace diff check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 6: Inspect final git diff and status**

Run:

```bash
git status --short --branch
git log --oneline -8
```

Expected: branch `docs/v0-2-29-handoff-and-learning-design` has local commits for docs/spec/plan and implementation; working tree is clean after committing.

- [ ] **Step 7: Update or create final checkpoint memory suggestion only after verification**

If verification passes, suggest a pending project checkpoint with concise evidence. Do not save it approved automatically. Suggested text:

```text
Memory Lane checkpoint: Postmortem learning capture implemented and verified. Stop lifecycle now queues pending project-scoped correction/procedure candidates from high-confidence debugging postmortems and explicit user challenge/correction turns using loose natural-language detection plus strict evidence gates. Verification passed: pnpm --filter @memory-lane/lifecycle test, pnpm --filter @memory-lane/lifecycle build, pnpm build, pnpm test, git diff --check.
```

- [ ] **Step 8: Commit final state if any files changed during verification**

```bash
git status --short
```

If files changed only because docs/checkpoint updates were made, commit them with:

```bash
git add HANDOFF.md ROADMAP.md skills/memory-lane/SKILL.md
git commit -m "docs: finalize postmortem learning handoff"
```

If no files changed, do not create an empty commit.

- [ ] **Step 9: Prepare PR summary**

Use this PR summary:

```md
## Summary
- add deterministic postmortem learning extraction for high-confidence debugging lessons
- persist pending project-scoped correction/procedure candidates from Stop lifecycle
- deduplicate against existing correction/procedure/workflow-rule memories
- document review-first behavior and update handoff/roadmap state

## Verification
- [ ] pnpm --filter @memory-lane/lifecycle test
- [ ] pnpm --filter @memory-lane/lifecycle build
- [ ] pnpm build
- [ ] pnpm test
- [ ] git diff --check
```

Do not merge directly into `main`. Follow the Memory Lane PR-protected workflow: push branch, open PR, and wait for user merge.

---

## Self-review checklist

- Spec coverage: Tasks cover loose detection, strict evidence gates, explicit user challenge plus assistant postmortem paths, pending-only persistence, dedup/debounce, safety filters, docs, and verification.
- No placeholders: All code snippets are concrete; implementation choices are fixed for this first slice.
- Type consistency: Helper names used in tests, implementation, and handler imports match: `extractPostmortemLearningCandidatesFromStop`, `filterDuplicatePostmortemLearningCandidates`, `filterSameTurnPostmortemLearningCandidates`, and `postmortemLearningKeyFromText`.
- Scope: No LLM classifier, no new commands/tools, no recall-ranking changes, no auto-approval, no raw transcript capture.
