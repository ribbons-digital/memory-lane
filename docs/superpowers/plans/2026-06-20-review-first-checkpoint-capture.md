# Review-First Checkpoint Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add autonomous, review-first checkpoint capture from strong lifecycle evidence, with deduplication and automatic pending-review reminders, without adding new explicit APIs.

**Architecture:** Add focused lifecycle helpers that derive compact `project_checkpoint` candidates from Stop and PostToolUse evidence, then filter inferred candidates through deterministic project-scope deduplication before existing persistence. Reuse existing pending-review notice rendering and continuity/read-model surfaces; update tests/docs to prove cross-harness consistency.

**Tech Stack:** TypeScript, Node test runner, existing `@memory-lane/core`, `@memory-lane/lifecycle`, CLI, MCP, Claude/Codex/Pi adapters.

---

## File structure

- Create `packages/lifecycle/src/checkpoint-capture.ts`
  - Extract compact checkpoint candidates from Stop/PostToolUse inputs.
  - Derive stable checkpoint keys for release/merge/verification/docs/roadmap/fix evidence.
  - Deduplicate inferred candidates against current visible project memories.
- Modify `packages/lifecycle/src/handlers.ts`
  - Merge checkpoint capture into `handleStop` and `handlePostToolUse` before persistence.
  - Keep explicit memory requests and existing tool-outcome candidates intact.
- Modify `packages/lifecycle/src/tool-outcomes.ts`
  - Export safe helper functions only if needed by checkpoint capture, or keep checkpoint command parsing isolated in the new file.
- Modify `packages/lifecycle/test/checkpoint-capture.test.ts`
  - Unit-test candidate extraction, safety, and dedup.
- Modify `packages/lifecycle/test/handlers.test.ts`
  - Integration tests for Stop capture, pending defaults, provenance, and continuity visibility.
- Modify `packages/lifecycle/test/tool-outcomes.test.ts`
  - Add PostToolUse capture coverage if the helper remains routed through `summarizeToolOutcome`; otherwise keep PostToolUse tests in `checkpoint-capture.test.ts` / `handlers.test.ts`.
- Modify `packages/claude-adapter/test/runner.test.ts`
  - Verify pending review notice for checkpoint capture without leaking text.
- Modify `packages/codex-adapter/test/runner.test.ts`
  - Verify pending review notice for checkpoint capture without leaking text.
- Modify `packages/pi-adapter/test/*` if existing tests cover lifecycle output; otherwise document why shared lifecycle tests cover Pi semantics.
- Modify `packages/cli/test/cli.test.ts`
  - Verify captured checkpoint records appear in continuity/review surfaces if not already covered at lifecycle/core level.
- Modify `packages/mcp-server/test/handlers.test.ts`
  - Verify MCP continuity sees pending captured checkpoints with `projectPath`.
- Modify `README.md`, `ROADMAP.md`, `HANDOFF.md` if present/current.
  - Document autonomous pending checkpoint capture, reminders, dedup, and no-new-API behavior.

---

## Acceptance criteria

- Inferred checkpoint captures save pending `project_checkpoint` records by default.
- Explicit existing save/remember behavior remains unchanged.
- Stop captures strong release and merged-PR progress statements.
- PostToolUse captures successful release/merge command evidence and ignores failures.
- Dedup skips duplicate pending and approved checkpoint evidence in the current project scope.
- Pending review notices appear through existing Claude and Codex adapter output when a checkpoint candidate is saved.
- Continuity surfaces expose pending captured checkpoints through existing CLI/MCP continuity read models.
- No new CLI commands, MCP tools, config flags, automatic approvals, LLM classifiers, transcript dumps, or recall-ranking changes.
- `pnpm build`, `pnpm test`, and `git diff --check` pass.

---

### Task 1: Add checkpoint capture helper and unit tests

**Files:**
- Create: `packages/lifecycle/src/checkpoint-capture.ts`
- Create: `packages/lifecycle/test/checkpoint-capture.test.ts`

- [ ] **Step 1: Write failing Stop extraction tests**

Create `packages/lifecycle/test/checkpoint-capture.test.ts` with these tests:

```ts
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
```

- [ ] **Step 2: Write failing PostToolUse and dedup tests**

Append to the same test file:

```ts
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

test("derives stable checkpoint keys", () => {
  assert.equal(checkpointKeyFromText("Released v0.2.12."), "release:v0.2.12")
  assert.equal(checkpointKeyFromText("Merged PR #19."), "merge:pr-19")
})

test("filters duplicate pending and approved checkpoint candidates in current project", () => {
  const cwd = tempDir()
  const engine = engineInTemp(cwd)
  engine.save({ text: "Released v0.2.12.", status: "pending", category: "project", scopeType: "project", kind: "project_checkpoint" })
  engine.save({ text: "Merged PR #19.", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })

  const candidates = [
    ...extractCheckpointCandidatesFromStop({ cwd, lastUserMessage: "Released v0.2.12." }),
    ...extractCheckpointCandidatesFromStop({ cwd, lastUserMessage: "PR #19 merged." }),
    ...extractCheckpointCandidatesFromStop({ cwd, lastUserMessage: "Released v0.2.13." }),
  ]

  const filtered = filterDuplicateCheckpointCandidates(engine, candidates)
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].text, "Released v0.2.13.")
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- test/checkpoint-capture.test.ts
```

Expected: fail because `checkpoint-capture.ts` does not exist.

- [ ] **Step 4: Implement `checkpoint-capture.ts`**

Create `packages/lifecycle/src/checkpoint-capture.ts`:

```ts
import { classifyCheckpointCandidate, containsLikelySecret, normalizeMemoryText, type MemoryRecord, type MemoryEngine } from "@memory-lane/core"
import { isShellToolName } from "./tool-outcomes.js"
import type { MemoryCandidate, PostToolUseInput, StopInput } from "./types.js"

const MAX_CHECKPOINT_TEXT_CHARS = 280

function successful(response: unknown): boolean {
  if (!response || typeof response !== "object") return false
  const obj = response as Record<string, unknown>
  for (const key of ["exit_code", "exitCode", "code", "status"]) {
    if (typeof obj[key] === "number") return obj[key] === 0
  }
  return false
}

function commandFromInput(input: unknown): string {
  if (typeof input === "string") return input
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>
    for (const key of ["command", "cmd", "script"]) {
      if (typeof obj[key] === "string") return obj[key] as string
    }
  }
  return ""
}

function previewResponse(response: unknown): string {
  if (!response || typeof response !== "object") return typeof response === "string" ? response.slice(0, 2_000) : ""
  const obj = response as Record<string, unknown>
  return [obj.stdout, obj.output, obj.stderr, obj.message, obj.text]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .slice(0, 2_000)
}

function isQuestion(text: string): boolean {
  return /^(?:what|how|why|when|where|who|do|does|did|is|are|can|could|should)\b/iu.test(text.trim())
}

function isFutureOrReminder(text: string): boolean {
  return /\b(?:should|later|eventually|next time|remember to|need to|todo|plan to|will release|will merge)\b/iu.test(text)
}

function checkpointCandidate(text: string, reason: string, confidence = 0.88): MemoryCandidate[] {
  const normalized = normalizeMemoryText(text)
  if (!normalized || normalized.length > MAX_CHECKPOINT_TEXT_CHARS) return []
  if (containsLikelySecret(normalized) || isQuestion(normalized) || isFutureOrReminder(normalized)) return []
  if (!classifyCheckpointCandidate({
    id: "candidate",
    status: "pending",
    text: normalized,
    category: "project",
    scope: { type: "project", key: "candidate" },
    source: "agent-suggested",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    kind: "project_checkpoint",
  })) return []

  return [{
    text: normalized,
    category: "project",
    scopeType: "project",
    kind: "project_checkpoint",
    confidence,
    decision: "save-pending",
    reason,
    source: "agent-suggested",
  }]
}

export function checkpointKeyFromText(text: string): string | undefined {
  const normalized = normalizeMemoryText(text).toLowerCase()
  const release = normalized.match(/\b(?:released|tagged|published)\s+(v?\d+\.\d+\.\d+(?:[-+][\w.]+)?)/iu)
  if (release) return `release:${release[1].startsWith("v") ? release[1] : `v${release[1]}`}`
  const merge = normalized.match(/\b(?:merged\s+(?:pr|pull request)\s*#?(\d+)|(?:pr|pull request)\s*#?(\d+)\s+merged)\b/iu)
  const prNumber = merge?.[1] ?? merge?.[2]
  if (prNumber) return `merge:pr-${prNumber}`
  const classified = classifyCheckpointCandidate({
    id: "candidate",
    status: "pending",
    text,
    category: "project",
    scope: { type: "project", key: "candidate" },
    source: "agent-suggested",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    kind: "project_checkpoint",
  })
  if (!classified) return undefined
  return `${classified.kind}:${normalized.replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 80)}`
}

export function extractCheckpointCandidatesFromStop(input: StopInput): MemoryCandidate[] {
  const text = input.lastUserMessage?.trim() ?? ""
  if (!text) return []
  return checkpointCandidate(text, "checkpoint progress statement")
}

export function extractCheckpointCandidatesFromPostToolUse(input: PostToolUseInput): MemoryCandidate[] {
  if (!isShellToolName(input.toolName) || !successful(input.toolResponse)) return []
  const command = commandFromInput(input.toolInput)
  const preview = previewResponse(input.toolResponse)
  if (containsLikelySecret(command) || containsLikelySecret(preview)) return []

  const release = command.match(/\bgh\s+release\s+create\s+(v?\d+\.\d+\.\d+(?:[-+][\w.]+)?)/iu)
    ?? preview.match(/\/releases\/tag\/(v?\d+\.\d+\.\d+(?:[-+][\w.]+)?)/iu)
  if (release) {
    const version = release[1].startsWith("v") ? release[1] : `v${release[1]}`
    return checkpointCandidate(`Released ${version}.`, "successful release command", 0.93)
  }

  const merge = command.match(/\bgh\s+pr\s+merge\s+(\d+)\b/iu)
    ?? preview.match(/\bmerged\s+(?:pull request|PR)\s+#?(\d+)\b/iu)
  if (merge) return checkpointCandidate(`Merged PR #${merge[1]}.`, "successful pull request merge command", 0.93)

  return []
}

function visibleInCurrentProject(memory: MemoryRecord, projectScope?: string): boolean {
  if (memory.scope.type === "global") return true
  return Boolean(projectScope) && memory.scope.key === projectScope
}

export function filterDuplicateCheckpointCandidates(engine: MemoryEngine, candidates: MemoryCandidate[]): MemoryCandidate[] {
  const projectScope = engine.getProjectScope()?.key
  const existingKeys = new Set(
    engine.list({ all: true })
      .filter((memory) => (memory.status === "pending" || memory.status === "approved") && visibleInCurrentProject(memory, projectScope))
      .filter((memory) => memory.kind === "project_checkpoint" || Boolean(classifyCheckpointCandidate(memory)))
      .map((memory) => checkpointKeyFromText(memory.text))
      .filter((key): key is string => Boolean(key)),
  )

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = checkpointKeyFromText(candidate.text)
    if (!key) return true
    if (existingKeys.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
```

- [ ] **Step 5: Run lifecycle checkpoint tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- test/checkpoint-capture.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add packages/lifecycle/src/checkpoint-capture.ts packages/lifecycle/test/checkpoint-capture.test.ts
git commit -m "feat: add checkpoint capture helpers"
```

---

### Task 2: Integrate checkpoint capture into lifecycle handlers

**Files:**
- Modify: `packages/lifecycle/src/handlers.ts`
- Modify: `packages/lifecycle/test/handlers.test.ts`

- [ ] **Step 1: Add failing handler tests**

Append to `packages/lifecycle/test/handlers.test.ts`:

```ts
import { handlePostToolUse, handleStop } from "../src/handlers.ts"

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
  assert.equal(result.saved[0].status, "saved")
  assert.equal(result.saved[0].memory.status, "pending")
  assert.equal(result.saved[0].memory.kind, "project_checkpoint")
  assert.equal(result.saved[0].memory.category, "project")
  assert.equal(result.saved[0].memory.source, "agent-suggested")
  assert.equal(result.saved[0].memory.provenance?.adapter, "test")
  assert.equal(result.saved[0].memory.provenance?.lifecycleEvent, "turn_stop")
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
  assert.equal(result.saved[0].memory.text, "Released v0.2.12.")
  assert.equal(result.saved[0].memory.status, "pending")
  assert.equal(result.saved[0].memory.kind, "project_checkpoint")
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
```

If duplicate imports conflict, merge these imports into the existing top-level import list instead of adding a second import statement.

- [ ] **Step 2: Run handler tests to verify failure**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- test/handlers.test.ts
```

Expected: fail because handlers do not call checkpoint capture yet.

- [ ] **Step 3: Integrate capture in `handlers.ts`**

Modify imports in `packages/lifecycle/src/handlers.ts`:

```ts
import { extractCheckpointCandidatesFromPostToolUse, extractCheckpointCandidatesFromStop, filterDuplicateCheckpointCandidates } from "./checkpoint-capture.js"
```

Update `handleStop`:

```ts
export function handleStop(engine: MemoryEngine, input: StopInput, options?: LifecycleHandlerOptions): LifecycleResult {
  engine.refreshScope(input.cwd)
  const candidates = [
    ...extractStopCandidates(input),
    ...filterDuplicateCheckpointCandidates(engine, extractCheckpointCandidatesFromStop(input)),
  ]
  return persistCandidates(engine, candidates, input, "turn_stop", options)
}
```

Update `handlePostToolUse`:

```ts
export function handlePostToolUse(engine: MemoryEngine, input: PostToolUseInput, options?: LifecycleHandlerOptions): LifecycleResult {
  engine.refreshScope(input.cwd)
  const candidates = [
    ...summarizeToolOutcome(input),
    ...filterDuplicateCheckpointCandidates(engine, extractCheckpointCandidatesFromPostToolUse(input)),
  ]
  return persistCandidates(engine, candidates, input, "post_tool_use", options)
}
```

- [ ] **Step 4: Run lifecycle tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test
```

Expected: pass. If any existing test now saves both a workflow fact and checkpoint from the same prompt, tighten checkpoint extraction to avoid ordinary preference/workflow text.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add packages/lifecycle/src/handlers.ts packages/lifecycle/test/handlers.test.ts
git commit -m "feat: capture pending checkpoint candidates"
```

---

### Task 3: Verify adapter review reminders for checkpoint captures

**Files:**
- Modify: `packages/claude-adapter/test/runner.test.ts`
- Modify: `packages/codex-adapter/test/runner.test.ts`
- Inspect: `packages/pi-adapter/src/index.ts`

- [ ] **Step 1: Add Claude adapter test**

Append near existing Stop pending-review notice tests in `packages/claude-adapter/test/runner.test.ts`:

```ts
test("stop shows pending review notice for checkpoint capture without leaking checkpoint text", async () => {
  const engine = engineInTemp()

  const output = await runClaudeHookCommand("stop", {
    engine,
    env: {} as NodeJS.ProcessEnv,
    payloadText: stopPayload({
      last_user_message: "Released v0.2.12 and verified the release workflow.",
      last_assistant_message: "Done.",
    }),
  })

  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /Memory Lane: suggested 1 pending memory for review/u)
  assert.match(parsed.systemMessage, /memory-lane review/u)
  assert.doesNotMatch(parsed.systemMessage, /v0\.2\.12|release workflow/u)

  const saved = engine.list({ all: true })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].status, "pending")
  assert.equal(saved[0].kind, "project_checkpoint")
  assert.equal(saved[0].provenance?.adapter, "claude")
})
```

- [ ] **Step 2: Add Codex adapter test**

Append near existing Stop pending-review notice tests in `packages/codex-adapter/test/runner.test.ts`:

```ts
test("stop shows pending review notice for checkpoint capture without leaking checkpoint text", async () => {
  const engine = engineInTemp()

  const output = await runCodexHookCommand("stop", {
    engine,
    env: {} as NodeJS.ProcessEnv,
    payloadText: stopPayload({
      last_user_message: "PR #19 merged after review.",
      last_assistant_message: "Done.",
    }),
  })

  const parsed = JSON.parse(output)
  assert.match(parsed.systemMessage, /Memory Lane: suggested 1 pending memory for review/u)
  assert.match(parsed.systemMessage, /memory-lane review/u)
  assert.doesNotMatch(parsed.systemMessage, /PR #19|merged after review/u)

  const saved = engine.list({ all: true })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].status, "pending")
  assert.equal(saved[0].kind, "project_checkpoint")
  assert.equal(saved[0].provenance?.adapter, "codex")
})
```

- [ ] **Step 3: Inspect Pi output path**

Inspect `packages/pi-adapter/src/index.ts` and confirm Stop/PostToolUse call shared lifecycle handlers and use a shared lifecycle-result rendering path or otherwise expose pending saved counts. If Pi has no direct test harness for this output, document in the task report that shared lifecycle tests cover candidate creation and existing Pi calls `handleStop` / `handlePostToolUse` with `{ adapter: "pi" }`.

- [ ] **Step 4: Run adapter tests**

Run:

```bash
pnpm --filter @memory-lane/claude-adapter test
pnpm --filter @memory-lane/codex-adapter test
```

Expected: pass.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add packages/claude-adapter/test/runner.test.ts packages/codex-adapter/test/runner.test.ts
git commit -m "test: cover checkpoint review notices"
```

---

### Task 4: Prove continuity and review surfaces expose captured candidates

**Files:**
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `packages/mcp-server/test/handlers.test.ts`

- [ ] **Step 1: Add CLI continuity/review integration test**

In `packages/cli/test/cli.test.ts`, add a test near existing continuity/review tests that invokes the CLI hook path to create a pending checkpoint, then checks review/continuity:

```ts
test("captured checkpoint candidates appear in review and continuity", async () => {
  const dir = tempDir()
  const memoryPath = path.join(dir, "memory.jsonl")
  const embeddingsPath = path.join(dir, "embeddings.jsonl")
  const env = { ...process.env, MEMORY_LANE_PATH: memoryPath, MEMORY_LANE_EMBEDDINGS_PATH: embeddingsPath }

  await runCli(["codex", "stop"], {
    cwd: dir,
    env,
    input: JSON.stringify({
      cwd: dir,
      session_id: "session-1",
      last_user_message: "Released v0.2.12 and verified the release workflow.",
      last_assistant_message: "Done.",
    }),
  })

  const review = await runCli(["review", "--json"], { cwd: dir, env })
  const reviewPayload = JSON.parse(review.stdout)
  assert.equal(reviewPayload.data.memories.length, 1)
  assert.equal(reviewPayload.data.memories[0].kind, "project_checkpoint")
  assert.equal(reviewPayload.data.memories[0].checkpointCandidate.kind, "release")

  const continuity = await runCli(["continuity", "--json"], { cwd: dir, env })
  const continuityPayload = JSON.parse(continuity.stdout)
  assert.equal(continuityPayload.data.status.pendingContinuityCount, 1)
  assert.equal(continuityPayload.data.pendingContinuity[0].kind, "project_checkpoint")
  assert.match(continuityPayload.data.pendingContinuity[0].preview, /Released v0\.2\.12/u)
})
```

Adjust helper names/return shapes to match the existing CLI test harness. Use existing `runCli` / temp env patterns already present in the file.

- [ ] **Step 2: Add MCP continuity integration test**

In `packages/mcp-server/test/handlers.test.ts`, add a test near existing `memory_continuity` tests:

```ts
test("memory_continuity includes pending captured checkpoint candidates", () => {
  const project = tempDir()
  const engine = engineInTemp(project)
  engine.save({
    text: "Released v0.2.12.",
    status: "pending",
    category: "project",
    scopeType: "project",
    kind: "project_checkpoint",
    source: "agent-suggested",
    provenance: { adapter: "codex", lifecycleEvent: "turn_stop" },
  })

  const response = handleMemoryContinuity(engine, { projectPath: project })
  assert.equal(response.data.status.pendingContinuityCount, 1)
  assert.equal(response.data.pendingContinuity[0].kind, "project_checkpoint")
  assert.equal(response.data.pendingContinuity[0].checkpointCandidate.kind, "release")
})
```

Adjust imports/helper names to match the existing MCP tests.

- [ ] **Step 3: Run CLI and MCP tests**

Run:

```bash
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
```

Expected: pass.

- [ ] **Step 4: Commit Task 4**

Run:

```bash
git add packages/cli/test/cli.test.ts packages/mcp-server/test/handlers.test.ts
git commit -m "test: expose captured checkpoints in continuity"
```

---

### Task 5: Update roadmap/docs and run final verification

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md` if present/current and conventionally maintained

- [ ] **Step 1: Update README**

In `README.md`, update the checkpoint/review/lifecycle sections to state:

```md
Memory Lane can also suggest pending checkpoint candidates from strong lifecycle evidence, such as a successful release command, merged PR command, or explicit completed-progress statement. These inferred checkpoints are pending by default and do not affect approved continuity until reviewed. When a hook saves a pending checkpoint candidate, Memory Lane emits the same compact pending-review reminder used for other pending memories. No new command is required; review with `memory-lane review` / MCP `memory_review`, and inspect continuity with `memory-lane continuity` / MCP `memory_continuity`.
```

Keep wording concise and avoid implying automatic approval.

- [ ] **Step 2: Update ROADMAP Phase 17**

Update `ROADMAP.md` Phase 17 status/completed scope after implementation:

- mark review-first checkpoint capture complete
- mark dedup/debounce for checkpoint candidates complete for this first slice
- keep future improvements scoped to broader evidence types or Phase 20 consolidation
- mention no new APIs/config/approval behavior were added

- [ ] **Step 3: Update HANDOFF if current**

If `HANDOFF.md` exists and is being maintained, add:

- branch name
- implemented Phase 17 checkpoint capture summary
- verification commands/results
- remaining next recommendation: Phase 18 global preference layering/context policy

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm build
pnpm test
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add README.md ROADMAP.md HANDOFF.md
git commit -m "docs: document checkpoint capture reminders"
```

If `HANDOFF.md` does not exist or should not be changed, omit it from `git add` and mention that in the task report.

---

## Final review and PR preparation

After all tasks:

1. Run final verification again if any docs/test changes happened after Task 5:

```bash
pnpm build
pnpm test
git diff --check
git status --short
```

2. Request code review before opening PR.
3. Push branch `feature/phase-17-checkpoint-capture` and open a PR against `main` only after review passes.
4. Do **not** merge locally. Wait for user review/merge, then sync `main`, delete branches/worktree, and recommend Phase 18 as the next item.
