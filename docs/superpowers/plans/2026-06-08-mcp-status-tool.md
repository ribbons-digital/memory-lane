# MCP Status Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `memory_status` MCP tool that exposes `MemoryEngine.doctor()` status data to Claude Desktop and other MCP clients.

**Architecture:** Reuse the existing MCP handler pattern in `packages/mcp-server/src/handlers.ts`. The new handler calls `engine.doctor()` after applying optional `projectPath`, wraps the result in the existing JSON envelope, and registers the tool in `server.ts`.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, Node `node:test`, existing Memory Lane core and MCP server packages.

---

## File structure

- Modify `packages/mcp-server/src/types.ts`
  - Add `StatusToolInput = ProjectPathInput`.
- Modify `packages/mcp-server/src/handlers.ts`
  - Add `handleMemoryStatus(engine, input)`.
- Modify `packages/mcp-server/src/server.ts`
  - Add `memory_status` to `MEMORY_LANE_TOOL_NAMES` and register the MCP tool.
- Modify `packages/mcp-server/test/handlers.test.ts`
  - Add handler tests for counts, no memory text, and projectPath scope.
- Modify `packages/mcp-server/test/server.test.ts`
  - Update tool-name and registration tests.
- Modify `README.md`
  - Add `memory_status` to MCP tools and status explanation.
- Modify `examples/harness-integrations/mcp.md`
  - Add `memory_status` to tools and example usage.
- Modify `ROADMAP.md`
  - Mark Phase 8 Slice 2 complete, keeping MCP resources/prompts deferred.

---

### Task 1: Add red tests for memory_status

**Files:**
- Modify: `packages/mcp-server/test/handlers.test.ts`
- Modify: `packages/mcp-server/test/server.test.ts`

- [ ] **Step 1: Update handler imports and add failing handler tests**

In `packages/mcp-server/test/handlers.test.ts`, add `handleMemoryStatus` to the handler import list.

Append these tests:

```ts
test("memory_status returns doctor counts without memory text", async () => {
  const engine = engineInTemp()
  engine.save({ text: "Do not leak this exact memory text", status: "approved", category: "project", scopeType: "global" })
  engine.suggest("Do not leak this pending text")

  const result = parseToolResult(await handleMemoryStatus(engine, {}))
  const serialized = JSON.stringify(result)

  assert.equal(result.ok, true)
  assert.equal(result.data.status.totalMemories, 2)
  assert.equal(result.data.status.approvedMemories, 1)
  assert.equal(result.data.status.pendingMemories, 1)
  assert.equal(result.data.status.semanticEnabled, false)
  assert.equal(result.data.status.projectScope, "none")
  assert.equal(result.meta.projectScope, "none")
  assert.ok(Array.isArray(result.data.notes))
  assert.match(result.data.notes.join("\n"), /MCP provides explicit/u)
  assert.doesNotMatch(serialized, /Do not leak this exact memory text/u)
  assert.doesNotMatch(serialized, /Do not leak this pending text/u)
})

test("memory_status applies projectPath before reading scope", async () => {
  const projectA = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "status-project-a" }))
  const engine = engineInTemp()

  const result = parseToolResult(await handleMemoryStatus(engine, { projectPath: projectA }))

  assert.equal(result.ok, true)
  assert.equal(result.data.status.projectScope, "status-project-a")
  assert.equal(result.meta.projectScope, "status-project-a")
})
```

- [ ] **Step 2: Update server tests to expect memory_status**

In `packages/mcp-server/test/server.test.ts`, update `MEMORY_LANE_TOOL_NAMES` expected array to include:

```ts
"memory_status",
```

and update registered tool names to include:

```ts
"memory_status",
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test
```

Expected: FAIL because `handleMemoryStatus` is not exported and `memory_status` is not registered.

- [ ] **Step 4: Commit red tests**

```bash
git add packages/mcp-server/test/handlers.test.ts packages/mcp-server/test/server.test.ts
git commit -m "test(mcp): cover memory status tool"
```

---

### Task 2: Implement memory_status tool

**Files:**
- Modify: `packages/mcp-server/src/types.ts`
- Modify: `packages/mcp-server/src/handlers.ts`
- Modify: `packages/mcp-server/src/server.ts`

- [ ] **Step 1: Add StatusToolInput type**

In `packages/mcp-server/src/types.ts`, add:

```ts
export type StatusToolInput = ProjectPathInput
```

- [ ] **Step 2: Implement handler**

In `packages/mcp-server/src/handlers.ts`, import `StatusToolInput` and add:

```ts
const STATUS_NOTES = [
  "MCP provides explicit Memory Lane tools only; it does not run lifecycle hooks.",
  "Use memory-lane doctor in a terminal for the same read-only diagnostics outside MCP.",
]

function statusData(engine: MemoryEngine): { status: Record<string, unknown>; notes: string[] } {
  return { status: engine.doctor(), notes: STATUS_NOTES }
}

export async function handleMemoryStatus(engine: MemoryEngine, input: StatusToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    return jsonContent(envelope(engine, statusData(engine)))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}
```

Place the helper near other small data helpers. Do not include memory list data; use `engine.doctor()` only.

- [ ] **Step 3: Register server tool**

In `packages/mcp-server/src/server.ts`:

Add `handleMemoryStatus` to imports.

Add `"memory_status"` to `MEMORY_LANE_TOOL_NAMES` after `memory_recall` or before mutation tools.

Register:

```ts
  server.registerTool(
    "memory_status",
    {
      title: "Memory Lane Status",
      description: "Read Memory Lane status, counts, project scope, and integration diagnostics without modifying memory.",
      inputSchema: {
        projectPath,
      },
    },
    async (input) => handleMemoryStatus(engine, input),
  )
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test
```

Expected: PASS.

- [ ] **Step 5: Commit implementation**

```bash
git add packages/mcp-server/src/types.ts packages/mcp-server/src/handlers.ts packages/mcp-server/src/server.ts
git commit -m "feat(mcp): add memory status tool"
```

---

### Task 3: Update docs and roadmap

**Files:**
- Modify: `README.md`
- Modify: `examples/harness-integrations/mcp.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Add docs references**

In `README.md` MCP tool list, add:

```md
- `memory_status` — read Memory Lane counts, config paths, project scope, and integration diagnostics
```

Add one short paragraph after the list:

```md
Use `memory_status` from MCP clients when you want the same kind of read-only setup/status overview that `memory-lane doctor` provides in a terminal. It reports counts and diagnostics only; it does not return raw memory text or run lifecycle hooks.
```

In `examples/harness-integrations/mcp.md`, add `memory_status` to the tools list and add:

```md
Ask your MCP client: "Use Memory Lane to check my status." The client can call `memory_status` to inspect counts, project scope, semantic status, storage/config paths, and integration diagnostics without modifying memory.
```

In `ROADMAP.md`, update Phase 8 status:

```md
**Status:** Slice 1 and Slice 2 complete: read-only integration diagnostics in `memory-lane doctor`, and read-only MCP `memory_status` tool.
```

Move the status/config visibility todo into completed scope, while keeping MCP resources, broader project behavior, optional Obsidian MCP status, and deeper diagnostics as future todos.

- [ ] **Step 2: Run docs reference check**

Run:

```bash
rg -n "memory_status|read-only setup/status|Slice 1 and Slice 2" README.md examples/harness-integrations/mcp.md ROADMAP.md
```

Expected: finds the new docs in all three files.

- [ ] **Step 3: Commit docs**

```bash
git add README.md examples/harness-integrations/mcp.md ROADMAP.md
git commit -m "docs: explain mcp memory status"
```

---

### Task 4: Final verification and review

**Files:**
- No source changes unless verification reveals defects.

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm build
pnpm test
pnpm --filter @memory-lane/mcp-server build
node --input-type=module -e "import { MEMORY_LANE_TOOL_NAMES } from './packages/mcp-server/dist/server.js'; console.log(MEMORY_LANE_TOOL_NAMES.join(','))"
```

Expected:

- build PASS;
- test PASS;
- MCP server build PASS;
- smoke output includes `memory_status`.

- [ ] **Step 2: Review against spec and non-goals**

Run:

```bash
rg -n "memory_status|engine\.doctor|Memory Lane Status" packages/mcp-server/src packages/mcp-server/test README.md examples/harness-integrations/mcp.md ROADMAP.md
rg -n "resources|prompts|SessionStart|pi autosave|tool-output|transcript|MCP traffic" packages/mcp-server/src README.md examples/harness-integrations/mcp.md ROADMAP.md docs/superpowers/specs/2026-06-08-mcp-status-tool.md
```

Expected: implementation only adds a tool backed by `engine.doctor()` and docs/spec retain non-goal boundaries.

- [ ] **Step 3: Commit fixes only if needed**

If verification reveals defects, fix and commit:

```bash
git add packages/mcp-server/src/types.ts packages/mcp-server/src/handlers.ts packages/mcp-server/src/server.ts packages/mcp-server/test/handlers.test.ts packages/mcp-server/test/server.test.ts README.md examples/harness-integrations/mcp.md ROADMAP.md
git commit -m "fix(mcp): harden memory status tool"
```

If no fixes are needed, do not create an empty commit.

- [ ] **Step 4: Summarize branch state**

Report:

- commits created;
- verification commands and results;
- spec deviations, if any;
- whether branch is ready to merge.
