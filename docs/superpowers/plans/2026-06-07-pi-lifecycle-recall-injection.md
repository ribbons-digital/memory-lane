# pi Lifecycle Recall Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only Memory Lane recall injection to pi via pi's documented `before_agent_start` extension event.

**Architecture:** Keep `@memory-lane/pi-adapter` as the pi-specific integration layer. Add `@memory-lane/lifecycle` as a workspace dependency, then delegate prompt recall and memory block rendering to `handleUserPromptSubmit`. Return pi's documented injected custom-message shape only when relevant context exists.

**Tech Stack:** TypeScript, Node `node:test`, `tsx`, pi extension event API, `@memory-lane/core`, `@memory-lane/lifecycle`, pnpm workspaces.

---

## File Structure

- Modify `packages/pi-adapter/package.json`
  - Add `@memory-lane/lifecycle` dependency.
  - Add a `test` script using `node --test --import tsx test/*.test.ts`.
  - Add `tsx` dev dependency if needed for package-local tests.
- Modify `packages/pi-adapter/src/index.ts`
  - Import `handleUserPromptSubmit`.
  - Extend the local `ExtensionContext` shim with optional `sessionManager` shape.
  - Register `before_agent_start` handler.
  - Add small helper(s) only if needed for session id extraction and custom message construction.
- Create `packages/pi-adapter/test/extension.test.ts`
  - Fake pi extension API captures registered commands, tools, and event handlers.
  - Temporary storage paths isolate tests from real `~/.memory-lane`.
  - Tests cover no-context, context injection, no writes during injection, and existing registration preservation.
- Modify `README.md`
  - Document pi read-only lifecycle recall support and deferred autosave/tool capture.
- Modify `skills/memory-lane/SKILL.md`
  - Add same agent-facing pi support boundary.

---

### Task 1: Add pi-adapter test harness and failing recall-injection tests

**Files:**
- Modify: `packages/pi-adapter/package.json`
- Create: `packages/pi-adapter/test/extension.test.ts`

- [ ] **Step 1: Add package test script and test runtime dependency**

Edit `packages/pi-adapter/package.json` so the scripts and dev dependencies become:

```json
{
  "scripts": {
    "build": "tsc",
    "test": "node --test --import tsx test/*.test.ts"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.4.0"
  }
}
```

Keep existing package fields and dependencies unchanged in this step.

- [ ] **Step 2: Create the failing test file**

Create `packages/pi-adapter/test/extension.test.ts`:

```ts
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, test } from "node:test"
import memoryLaneExtension, { type ExtensionAPI, type ExtensionContext } from "../src/index.js"

type EventHandler = (event: any, ctx: ExtensionContext) => Promise<any> | any

interface FakePi extends ExtensionAPI {
  commands: Map<string, any>
  tools: Map<string, any>
  events: Map<string, EventHandler[]>
}

function createFakePi(): FakePi {
  const commands = new Map<string, any>()
  const tools = new Map<string, any>()
  const events = new Map<string, EventHandler[]>()

  return {
    commands,
    tools,
    events,
    registerCommand(name, handler) {
      commands.set(name, handler)
    },
    registerTool(tool) {
      tools.set(tool.name, tool)
    },
    on(event, handler) {
      const handlers = events.get(event) ?? []
      handlers.push(handler)
      events.set(event, handlers)
    },
  }
}

function makeTempEnv(): { dir: string; restore: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-pi-test-"))
  const previous = {
    MEMORY_LANE_FILE: process.env.MEMORY_LANE_FILE,
    MEMORY_LANE_EMBEDDINGS_FILE: process.env.MEMORY_LANE_EMBEDDINGS_FILE,
    MEMORY_LANE_CONFIG: process.env.MEMORY_LANE_CONFIG,
    PI_MEMORY_FILE: process.env.PI_MEMORY_FILE,
    PI_MEMORY_EMBEDDINGS_FILE: process.env.PI_MEMORY_EMBEDDINGS_FILE,
    PI_MEMORY_CONFIG_FILE: process.env.PI_MEMORY_CONFIG_FILE,
  }

  process.env.PI_MEMORY_FILE = path.join(dir, "memory.jsonl")
  process.env.PI_MEMORY_EMBEDDINGS_FILE = path.join(dir, "embeddings.jsonl")
  process.env.PI_MEMORY_CONFIG_FILE = path.join(dir, "config.json")
  delete process.env.MEMORY_LANE_FILE
  delete process.env.MEMORY_LANE_EMBEDDINGS_FILE
  delete process.env.MEMORY_LANE_CONFIG
  fs.writeFileSync(process.env.PI_MEMORY_CONFIG_FILE, JSON.stringify({ semantic: { enabled: false } }))

  return {
    dir,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

function baseCtx(cwd: string): ExtensionContext {
  return {
    cwd,
    ui: { notify() {} },
    sessionManager: {
      getSessionFile: () => path.join(cwd, ".pi-session.jsonl"),
    },
  }
}

async function runBeforeAgentStart(pi: FakePi, event: any, ctx: ExtensionContext): Promise<any> {
  const handlers = pi.events.get("before_agent_start") ?? []
  assert.equal(handlers.length, 1)
  return handlers[0](event, ctx)
}

let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

test("registers pi commands tools input and before_agent_start handlers", () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()

  memoryLaneExtension(pi)

  assert.ok(pi.commands.has("remember"))
  assert.ok(pi.commands.has("memory"))
  assert.ok(pi.tools.has("memory_save"))
  assert.ok(pi.tools.has("memory_suggest"))
  assert.ok(pi.tools.has("memory_recall"))
  assert.equal(pi.events.get("input")?.length, 1)
  assert.equal(pi.events.get("before_agent_start")?.length, 1)
})

test("before_agent_start returns nothing when no relevant memory exists", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)

  const result = await runBeforeAgentStart(pi, { prompt: "How should I run tests?" }, baseCtx(env.dir))

  assert.equal(result, undefined)
  assert.equal(fs.existsSync(path.join(env.dir, "memory.jsonl")), false)
})

test("before_agent_start injects shared lifecycle memory block for relevant approved memory", async () => {
  const env = makeTempEnv()
  cleanup = env.restore
  const pi = createFakePi()
  memoryLaneExtension(pi)
  const ctx = baseCtx(env.dir)

  const saveTool = pi.tools.get("memory_save")
  await saveTool.execute("tool-1", { text: "This repo uses pnpm test for verification", category: "project" }, undefined, () => {}, ctx)
  const before = fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8")

  const result = await runBeforeAgentStart(pi, { prompt: "How do I verify this repo?" }, ctx)

  assert.deepEqual(result, {
    message: {
      customType: "memory-lane",
      content: "## Relevant Memory\n\n- This repo uses pnpm test for verification",
      display: false,
      details: {
        source: "memory-lane",
        lifecycleEvent: "user_prompt_submit",
      },
    },
  })
  assert.equal(fs.readFileSync(path.join(env.dir, "memory.jsonl"), "utf8"), before)
})
```

- [ ] **Step 3: Run tests and verify they fail for the missing feature**

Run:

```bash
pnpm --filter @memory-lane/pi-adapter test
```

Expected: FAIL. At least one failure must show `before_agent_start` has no registered handler or no injected message is returned.

- [ ] **Step 4: Commit the failing tests**

```bash
git add packages/pi-adapter/package.json packages/pi-adapter/test/extension.test.ts
git commit -m "test(pi): cover lifecycle recall injection"
```

---

### Task 2: Implement read-only before_agent_start lifecycle recall

**Files:**
- Modify: `packages/pi-adapter/package.json`
- Modify: `packages/pi-adapter/src/index.ts`
- Test: `packages/pi-adapter/test/extension.test.ts`

- [ ] **Step 1: Add lifecycle dependency**

In `packages/pi-adapter/package.json`, add the workspace dependency:

```json
"dependencies": {
  "@memory-lane/core": "workspace:*",
  "@memory-lane/lifecycle": "workspace:*",
  "typebox": "^1.1.38"
}
```

- [ ] **Step 2: Import lifecycle handler**

At the top of `packages/pi-adapter/src/index.ts`, add:

```ts
import { handleUserPromptSubmit } from "@memory-lane/lifecycle"
```

- [ ] **Step 3: Extend context shim for optional session manager**

Update `ExtensionContext` in `packages/pi-adapter/src/index.ts` to include optional session manager support:

```ts
export interface ExtensionContext {
  cwd: string
  ui?: { notify(message: string, level?: "info" | "warning" | "error"): void }
  llmProvider?: { generate(prompt: string, options?: any): Promise<string> }
  sessionManager?: { getSessionFile?(): string | undefined }
}
```

- [ ] **Step 4: Add helper for session id and injected message**

Add these helpers near `notify()` or before the main extension function:

```ts
function piSessionId(ctx: ExtensionContext): string | undefined {
  try {
    return ctx.sessionManager?.getSessionFile?.()
  } catch {
    return undefined
  }
}

function memoryLaneContextMessage(content: string) {
  return {
    customType: "memory-lane",
    content,
    display: false,
    details: {
      source: "memory-lane",
      lifecycleEvent: "user_prompt_submit",
    },
  }
}
```

- [ ] **Step 5: Register before_agent_start handler**

Inside `memoryLaneExtension(pi: ExtensionAPI)`, after command/tool registration or before the existing `input` handler, add:

```ts
  // ── Read-only lifecycle recall injection ─────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    const prompt = typeof event.prompt === "string" ? event.prompt.trim() : ""
    if (!prompt) return undefined

    try {
      const e = getEngine(ctx.cwd)
      const result = await handleUserPromptSubmit(e, {
        cwd: ctx.cwd,
        prompt,
        sessionId: piSessionId(ctx),
      })

      if (!result.additionalContext) return undefined
      return { message: memoryLaneContextMessage(result.additionalContext) }
    } catch (err) {
      notify(ctx, storageGuidance(err), "warning")
      return undefined
    }
  })
```

This handler must not call `save`, `suggest`, `handleStop`, or `handlePostToolUse`.

- [ ] **Step 6: Run pi-adapter tests and verify green**

Run:

```bash
pnpm --filter @memory-lane/pi-adapter test
```

Expected: PASS, including all new tests.

- [ ] **Step 7: Run pi-adapter build**

Run:

```bash
pnpm --filter @memory-lane/pi-adapter build
```

Expected: PASS.

- [ ] **Step 8: Commit implementation**

```bash
git add packages/pi-adapter/package.json packages/pi-adapter/src/index.ts
git commit -m "feat(pi): inject lifecycle recall context"
```

---

### Task 3: Document pi recall support boundary

**Files:**
- Modify: `README.md`
- Modify: `skills/memory-lane/SKILL.md`

- [ ] **Step 1: Update README pi adapter docs**

In `README.md`, in the harness integrations or package/adapter section, add concise text:

```md
### pi adapter

The pi adapter supports manual Memory Lane tools and commands (`memory_save`, `memory_suggest`, `memory_recall`, and `/memory ...`). It also performs read-only lifecycle recall injection through pi's documented `before_agent_start` event: relevant approved memories may be injected as hidden `memory-lane` context before the agent starts.

pi lifecycle recall does not autosave new memories and does not capture tool outcomes yet. Codex and Claude Code hook adapters still own automatic stop/post-tool-use memory writes for those harnesses; pi autosave/tool capture is deferred to a later roadmap phase.
```

Place it near the existing hook adapter discussion so users can compare harness support.

- [ ] **Step 2: Update skill docs**

In `skills/memory-lane/SKILL.md`, add agent-facing guidance:

```md
### pi adapter boundary

In pi, Memory Lane provides manual tools/commands and read-only lifecycle recall injection before the agent starts. Do not assume pi currently performs Codex/Claude-style automatic stop autosave or post-tool-use capture. When a durable pi workflow rule, preference, or project fact should be saved, use `memory_save` for explicit user requests or `memory_suggest` for proactive suggestions.
```

Place it near the hook adapter or sandboxed storage guidance.

- [ ] **Step 3: Verify docs mention pi boundary**

Run:

```bash
rg -n "pi adapter|before_agent_start|read-only lifecycle recall|autosave|tool outcomes" README.md skills/memory-lane/SKILL.md
```

Expected: Matches in both files describing pi read-only recall and deferred autosave/tool capture.

- [ ] **Step 4: Commit docs**

```bash
git add README.md skills/memory-lane/SKILL.md
git commit -m "docs: explain pi lifecycle recall"
```

---

### Task 4: Final verification and review handoff

**Files:**
- No production edits expected unless verification finds a bug.

- [ ] **Step 1: Run full build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Manual adapter smoke using test harness path**

Run the pi-adapter test directly to prove the focused integration still passes:

```bash
pnpm --filter @memory-lane/pi-adapter test
```

Expected: PASS.

- [ ] **Step 4: Inspect git status and log**

Run:

```bash
git status --short --branch
git log --oneline --decorate --max-count=8
```

Expected: clean worktree, branch contains spec, test, implementation, and docs commits.

- [ ] **Step 5: Request code review**

Ask a reviewer to verify:

- `before_agent_start` follows pi docs.
- Recall injection is read-only.
- Existing pi tools/commands are preserved.
- Tests use temporary storage only.
- Docs accurately defer pi autosave/tool capture.

Do not merge until review is approved.
