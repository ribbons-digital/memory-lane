# Integration Doctor Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only integration diagnostics to `memory-lane doctor` for Claude Desktop MCP, Codex hooks, Claude Code hooks, and the pi extension.

**Architecture:** Add a focused `packages/core/src/integration-diagnostics.ts` module that reads only config/entrypoint files and returns a nested diagnostics object. `MemoryEngine.doctor()` will include that object using injected testable paths from `MemoryEngineConfig`. CLI formatter changes stay limited to making nested doctor fields readable.

**Tech Stack:** TypeScript, Node `fs`/`path`/`os`, built-in `node:test`, existing Memory Lane CLI/core package structure.

---

## File structure

- Create `packages/core/src/integration-diagnostics.ts`
  - Owns all integration config path defaults, config parsing, command-string detection, warning generation, and notes.
- Modify `packages/core/src/types.ts`
  - Adds narrow `integrationPaths?: Partial<IntegrationDiagnosticPaths>` to `MemoryEngineConfig` for deterministic tests.
- Modify `packages/core/src/engine.ts`
  - Imports `diagnoseIntegrations` and merges `integrations` into `doctor()`.
- Modify `packages/core/src/index.ts`
  - Exports integration diagnostics types/functions if needed by tests or downstream users.
- Modify `packages/core/test/engine.test.ts`
  - Adds end-to-end `MemoryEngine.doctor()` coverage for injected integration paths and read-only behavior.
- Create `packages/core/test/integration-diagnostics.test.ts`
  - Unit tests for config detection and malformed/unreadable file behavior.
- Modify `packages/cli/src/formatters.ts`
  - Keeps JSON output unchanged and renders nested doctor values as JSON strings in human output instead of `[object Object]`.
- Modify `packages/cli/test/cli.test.ts`
  - Adds CLI coverage that doctor JSON includes `integrations`, and human output is readable.
- Modify `README.md`
  - Documents integration diagnostics and the MCP-vs-hooks boundary under existing doctor/integration sections.
- Modify `ROADMAP.md`
  - Marks Phase 8 Slice 1 diagnostics as complete after implementation.

---

### Task 1: Add pure integration diagnostics module

**Files:**
- Create: `packages/core/src/integration-diagnostics.ts`
- Test: `packages/core/test/integration-diagnostics.test.ts`

- [ ] **Step 1: Write failing tests for missing configs and default notes**

Create `packages/core/test/integration-diagnostics.test.ts` with this initial content:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { diagnoseIntegrations } from "../src/integration-diagnostics.js"

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-integrations-"))
}

test("reports missing integration configs without creating files", () => {
  const root = tempDir()
  const project = path.join(root, "project")
  const report = diagnoseIntegrations({
    cwd: project,
    paths: {
      claudeDesktopConfig: path.join(root, "Claude", "claude_desktop_config.json"),
      codexUserHooks: path.join(root, ".codex", "hooks.json"),
      codexProjectHooks: path.join(project, ".codex", "hooks.json"),
      claudeCodeUserSettings: [path.join(root, ".claude", "settings.json"), path.join(root, ".claude", "settings.local.json")],
      claudeCodeProjectSettings: path.join(project, ".claude", "settings.local.json"),
      piExtension: path.join(root, ".pi", "agent", "extensions", "memory-lane", "index.ts"),
    },
  })

  assert.equal(report.claudeDesktopMcp.exists, false)
  assert.equal(report.claudeDesktopMcp.configured, false)
  assert.equal(report.codexHooks.user.exists, false)
  assert.equal(report.codexHooks.project.exists, false)
  assert.equal(report.claudeCodeHooks.user.exists, false)
  assert.equal(report.claudeCodeHooks.project.exists, false)
  assert.equal(report.piExtension.exists, false)
  assert.equal(report.piExtension.detected, false)
  assert.equal(report.summary.mcpExplicitToolsOnly, true)
  assert.equal(report.summary.hooksAutomaticLifecycle, true)
  assert.equal(report.summary.piAutosaveEnabled, false)
  assert.ok(report.notes.some((note) => note.includes("MCP provides explicit")))
  assert.equal(fs.existsSync(path.dirname(report.claudeDesktopMcp.checkedPath)), false)
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/integration-diagnostics.test.ts
```

Expected: FAIL because `../src/integration-diagnostics.js` does not exist.

- [ ] **Step 3: Implement the diagnostics module skeleton**

Create `packages/core/src/integration-diagnostics.ts`:

```ts
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export interface HookCommandStatus {
  userPromptSubmit: boolean
  stop: boolean
  postToolUse: boolean
}

export interface SingleHookConfigDiagnostic {
  checkedPath: string | null
  exists: boolean
  configured: boolean
  commands: HookCommandStatus
  warnings: string[]
}

export interface MultiHookConfigDiagnostic {
  checkedPaths: string[]
  exists: boolean
  configured: boolean
  commands: HookCommandStatus
  warnings: string[]
}

export interface IntegrationDiagnosticPaths {
  claudeDesktopConfig: string
  codexUserHooks: string
  codexProjectHooks: string | null
  claudeCodeUserSettings: string[]
  claudeCodeProjectSettings: string | null
  piExtension: string
}

export interface IntegrationDiagnostics {
  summary: {
    mcpExplicitToolsOnly: true
    hooksAutomaticLifecycle: true
    piAutosaveEnabled: false
  }
  claudeDesktopMcp: {
    checkedPath: string
    exists: boolean
    configured: boolean
    hasCommand: boolean
    hasArgs: boolean
    warnings: string[]
  }
  codexHooks: {
    user: SingleHookConfigDiagnostic
    project: SingleHookConfigDiagnostic
  }
  claudeCodeHooks: {
    user: MultiHookConfigDiagnostic
    project: SingleHookConfigDiagnostic
  }
  piExtension: {
    checkedPath: string
    exists: boolean
    detected: boolean
    warnings: string[]
  }
  notes: string[]
}

export interface DiagnoseIntegrationsOptions {
  cwd?: string | null
  paths?: Partial<IntegrationDiagnosticPaths>
}

const emptyCommands = (): HookCommandStatus => ({ userPromptSubmit: false, stop: false, postToolUse: false })

export function defaultIntegrationDiagnosticPaths(cwd?: string | null): IntegrationDiagnosticPaths {
  const home = os.homedir()
  return {
    claudeDesktopConfig: path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    codexUserHooks: path.join(home, ".codex", "hooks.json"),
    codexProjectHooks: cwd ? path.join(cwd, ".codex", "hooks.json") : null,
    claudeCodeUserSettings: [path.join(home, ".claude", "settings.json"), path.join(home, ".claude", "settings.local.json")],
    claudeCodeProjectSettings: cwd ? path.join(cwd, ".claude", "settings.local.json") : null,
    piExtension: path.join(home, ".pi", "agent", "extensions", "memory-lane", "index.ts"),
  }
}

function mergePaths(cwd: string | null | undefined, overrides?: Partial<IntegrationDiagnosticPaths>): IntegrationDiagnosticPaths {
  const defaults = defaultIntegrationDiagnosticPaths(cwd)
  return { ...defaults, ...overrides }
}

function missingSingle(checkedPath: string | null): SingleHookConfigDiagnostic {
  return { checkedPath, exists: false, configured: false, commands: emptyCommands(), warnings: [] }
}

function missingMulti(checkedPaths: string[]): MultiHookConfigDiagnostic {
  return { checkedPaths, exists: false, configured: false, commands: emptyCommands(), warnings: [] }
}

export function diagnoseIntegrations(options: DiagnoseIntegrationsOptions = {}): IntegrationDiagnostics {
  const paths = mergePaths(options.cwd, options.paths)
  return {
    summary: { mcpExplicitToolsOnly: true, hooksAutomaticLifecycle: true, piAutosaveEnabled: false },
    claudeDesktopMcp: { checkedPath: paths.claudeDesktopConfig, exists: false, configured: false, hasCommand: false, hasArgs: false, warnings: [] },
    codexHooks: { user: missingSingle(paths.codexUserHooks), project: missingSingle(paths.codexProjectHooks) },
    claudeCodeHooks: { user: missingMulti(paths.claudeCodeUserSettings), project: missingSingle(paths.claudeCodeProjectSettings) },
    piExtension: { checkedPath: paths.piExtension, exists: false, detected: false, warnings: [] },
    notes: [
      "MCP provides explicit Memory Lane tools only; it does not run lifecycle hooks.",
      "Codex and Claude Code hooks provide automatic lifecycle recall/save where configured.",
      "pi currently supports manual Memory Lane tools and read-only lifecycle recall; pi autosave/tool capture is deferred.",
    ],
  }
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/integration-diagnostics.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/core/src/integration-diagnostics.ts packages/core/test/integration-diagnostics.test.ts
git commit -m "test(core): cover integration diagnostics defaults"
```

---

### Task 2: Detect MCP, hook, pi configs and warnings

**Files:**
- Modify: `packages/core/src/integration-diagnostics.ts`
- Modify: `packages/core/test/integration-diagnostics.test.ts`

- [ ] **Step 1: Add failing tests for configured integrations and malformed JSON**

Append to `packages/core/test/integration-diagnostics.test.ts`:

```ts
test("detects Claude Desktop MCP config", () => {
  const root = tempDir()
  const claudeConfig = path.join(root, "Claude", "claude_desktop_config.json")
  fs.mkdirSync(path.dirname(claudeConfig), { recursive: true })
  fs.writeFileSync(claudeConfig, JSON.stringify({
    mcpServers: {
      "memory-lane": { command: "node", args: ["/repo/packages/mcp-server/dist/index.js"] },
    },
  }), "utf8")

  const report = diagnoseIntegrations({ paths: { claudeDesktopConfig: claudeConfig } })

  assert.equal(report.claudeDesktopMcp.exists, true)
  assert.equal(report.claudeDesktopMcp.configured, true)
  assert.equal(report.claudeDesktopMcp.hasCommand, true)
  assert.equal(report.claudeDesktopMcp.hasArgs, true)
  assert.deepEqual(report.claudeDesktopMcp.warnings, [])
})

test("detects Codex and Claude Code hook commands", () => {
  const root = tempDir()
  const project = path.join(root, "project")
  const codexUser = path.join(root, ".codex", "hooks.json")
  const codexProject = path.join(project, ".codex", "hooks.json")
  const claudeUser = path.join(root, ".claude", "settings.json")
  const claudeProject = path.join(project, ".claude", "settings.local.json")
  for (const file of [codexUser, codexProject, claudeUser, claudeProject]) fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(codexUser, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: "memory-lane codex user-prompt-submit" }] }] } }), "utf8")
  fs.writeFileSync(codexProject, JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "memory-lane codex stop" }] }], PostToolUse: [{ hooks: [{ command: "memory-lane codex post-tool-use" }] }] } }), "utf8")
  fs.writeFileSync(claudeUser, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: "memory-lane claude user-prompt-submit" }] }], Stop: [{ hooks: [{ command: "memory-lane claude stop" }] }] } }), "utf8")
  fs.writeFileSync(claudeProject, JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ command: "memory-lane claude post-tool-use" }] }] } }), "utf8")

  const report = diagnoseIntegrations({ cwd: project, paths: {
    codexUserHooks: codexUser,
    codexProjectHooks: codexProject,
    claudeCodeUserSettings: [claudeUser, path.join(root, ".claude", "settings.local.json")],
    claudeCodeProjectSettings: claudeProject,
  } })

  assert.deepEqual(report.codexHooks.user.commands, { userPromptSubmit: true, stop: false, postToolUse: false })
  assert.deepEqual(report.codexHooks.project.commands, { userPromptSubmit: false, stop: true, postToolUse: true })
  assert.deepEqual(report.claudeCodeHooks.user.commands, { userPromptSubmit: true, stop: true, postToolUse: false })
  assert.deepEqual(report.claudeCodeHooks.project.commands, { userPromptSubmit: false, stop: false, postToolUse: true })
})

test("detects pi extension and reports malformed JSON warnings without throwing", () => {
  const root = tempDir()
  const badJson = path.join(root, ".codex", "hooks.json")
  const piExtension = path.join(root, ".pi", "agent", "extensions", "memory-lane", "index.ts")
  fs.mkdirSync(path.dirname(badJson), { recursive: true })
  fs.mkdirSync(path.dirname(piExtension), { recursive: true })
  fs.writeFileSync(badJson, "{ invalid json", "utf8")
  fs.writeFileSync(piExtension, "export default async function memoryLaneExtension(pi) { return import('@memory-lane/pi-adapter') }", "utf8")

  const report = diagnoseIntegrations({ paths: { codexUserHooks: badJson, piExtension } })

  assert.equal(report.codexHooks.user.exists, true)
  assert.equal(report.codexHooks.user.configured, false)
  assert.match(report.codexHooks.user.warnings.join("\n"), /Invalid JSON/u)
  assert.equal(report.piExtension.exists, true)
  assert.equal(report.piExtension.detected, true)
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/integration-diagnostics.test.ts
```

Expected: FAIL because detection still reports everything missing/unconfigured.

- [ ] **Step 3: Implement config reading and command detection**

Replace the lower half of `integration-diagnostics.ts` with helpers like these, preserving exported interfaces from Task 1:

```ts
function readText(file: string): { exists: boolean; text?: string; warning?: string } {
  try {
    if (!fs.existsSync(file)) return { exists: false }
    const stat = fs.statSync(file)
    if (!stat.isFile()) return { exists: true, warning: `Path is not a file: ${file}` }
    return { exists: true, text: fs.readFileSync(file, "utf8") }
  } catch {
    return { exists: true, warning: `File is not accessible: ${file}` }
  }
}

function parseJson(file: string): { exists: boolean; value?: unknown; warnings: string[] } {
  const read = readText(file)
  if (!read.exists) return { exists: false, warnings: [] }
  if (read.warning) return { exists: true, warnings: [read.warning] }
  try {
    return { exists: true, value: JSON.parse(read.text ?? ""), warnings: [] }
  } catch {
    return { exists: true, warnings: [`Invalid JSON in integration config: ${file}`] }
  }
}

function stringifyForCommandScan(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(stringifyForCommandScan).join("\n")
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(stringifyForCommandScan).join("\n")
  return ""
}

function detectCommands(text: string, adapter: "codex" | "claude"): HookCommandStatus {
  return {
    userPromptSubmit: text.includes(`memory-lane ${adapter} user-prompt-submit`),
    stop: text.includes(`memory-lane ${adapter} stop`),
    postToolUse: text.includes(`memory-lane ${adapter} post-tool-use`),
  }
}

function anyCommand(commands: HookCommandStatus): boolean {
  return commands.userPromptSubmit || commands.stop || commands.postToolUse
}

function diagnoseJsonHookFile(file: string | null, adapter: "codex" | "claude"): SingleHookConfigDiagnostic {
  if (!file) return missingSingle(null)
  const parsed = parseJson(file)
  const commands = parsed.value ? detectCommands(stringifyForCommandScan(parsed.value), adapter) : emptyCommands()
  return { checkedPath: file, exists: parsed.exists, configured: anyCommand(commands), commands, warnings: parsed.warnings }
}

function diagnoseJsonHookFiles(files: string[], adapter: "codex" | "claude"): MultiHookConfigDiagnostic {
  const parts = files.map((file) => diagnoseJsonHookFile(file, adapter))
  const commands = parts.reduce((acc, part) => ({
    userPromptSubmit: acc.userPromptSubmit || part.commands.userPromptSubmit,
    stop: acc.stop || part.commands.stop,
    postToolUse: acc.postToolUse || part.commands.postToolUse,
  }), emptyCommands())
  return {
    checkedPaths: files,
    exists: parts.some((part) => part.exists),
    configured: anyCommand(commands),
    commands,
    warnings: parts.flatMap((part) => part.warnings),
  }
}

function diagnoseClaudeDesktopMcp(file: string): IntegrationDiagnostics["claudeDesktopMcp"] {
  const parsed = parseJson(file)
  const server = parsed.value && typeof parsed.value === "object"
    ? (((parsed.value as Record<string, unknown>).mcpServers as Record<string, unknown> | undefined)?.["memory-lane"] as Record<string, unknown> | undefined)
    : undefined
  const hasCommand = typeof server?.command === "string" && server.command.length > 0
  const hasArgs = Array.isArray(server?.args)
  return { checkedPath: file, exists: parsed.exists, configured: Boolean(server), hasCommand, hasArgs, warnings: parsed.warnings }
}

function diagnosePiExtension(file: string): IntegrationDiagnostics["piExtension"] {
  const read = readText(file)
  const detected = Boolean(read.text && (read.text.includes("memory-lane") || read.text.includes("@memory-lane/pi-adapter") || read.text.includes("memoryLaneExtension")))
  return { checkedPath: file, exists: read.exists, detected, warnings: read.warning ? [read.warning] : [] }
}
```

Then update `diagnoseIntegrations()` to call these helpers.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/integration-diagnostics.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/core/src/integration-diagnostics.ts packages/core/test/integration-diagnostics.test.ts
git commit -m "feat(core): detect integration configurations"
```

---

### Task 3: Wire diagnostics into MemoryEngine.doctor()

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Add failing engine doctor tests**

Append near the existing doctor tests in `packages/core/test/engine.test.ts`:

```ts
  it("doctor includes integration diagnostics from injected paths", () => {
    const integrationRoot = path.join(dir, "integration-doctor")
    const claudeDesktopConfig = path.join(integrationRoot, "Claude", "claude_desktop_config.json")
    fs.mkdirSync(path.dirname(claudeDesktopConfig), { recursive: true })
    fs.writeFileSync(claudeDesktopConfig, JSON.stringify({ mcpServers: { "memory-lane": { command: "node", args: ["server.js"] } } }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-integration.jsonl"),
      embeddingsPath: path.join(dir, "emb-integration.jsonl"),
      configPath: path.join(dir, "cfg-integration.json"),
      integrationPaths: { claudeDesktopConfig },
    })

    const report = e.doctor() as any

    assert.equal(report.integrations.claudeDesktopMcp.exists, true)
    assert.equal(report.integrations.claudeDesktopMcp.configured, true)
    assert.equal(report.integrations.summary.mcpExplicitToolsOnly, true)
  })

  it("doctor integration diagnostics do not create missing config folders", () => {
    const integrationRoot = path.join(dir, "missing-integration-root")
    const claudeDesktopConfig = path.join(integrationRoot, "Claude", "claude_desktop_config.json")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-integration-missing.jsonl"),
      embeddingsPath: path.join(dir, "emb-integration-missing.jsonl"),
      configPath: path.join(dir, "cfg-integration-missing.json"),
      integrationPaths: { claudeDesktopConfig },
    })

    const report = e.doctor() as any

    assert.equal(report.integrations.claudeDesktopMcp.exists, false)
    assert.equal(fs.existsSync(integrationRoot), false)
  })
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/engine.test.ts
```

Expected: FAIL because `integrationPaths` is not in `MemoryEngineConfig` and `doctor()` has no `integrations` field.

- [ ] **Step 3: Add type/config wiring**

In `packages/core/src/types.ts`, import the path type and extend config:

```ts
import type { IntegrationDiagnosticPaths } from "./integration-diagnostics.js"
```

Then add this field to `MemoryEngineConfig`:

```ts
  integrationPaths?: Partial<IntegrationDiagnosticPaths>
```

In `packages/core/src/engine.ts`, import and store diagnostics paths:

```ts
import { diagnoseIntegrations, type IntegrationDiagnosticPaths } from "./integration-diagnostics.js"
```

Add class field:

```ts
  private readonly integrationPaths?: Partial<IntegrationDiagnosticPaths>
```

Set it in constructor:

```ts
    this.integrationPaths = opts?.integrationPaths
```

In `doctor()`, add:

```ts
      integrations: diagnoseIntegrations({ cwd: this.scope?.cwd ?? null, paths: this.integrationPaths }),
```

In `packages/core/src/index.ts`, export the module:

```ts
export * from "./integration-diagnostics.js"
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/engine.test.ts test/integration-diagnostics.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add packages/core/src/types.ts packages/core/src/engine.ts packages/core/src/index.ts packages/core/test/engine.test.ts
git commit -m "feat(core): include integrations in doctor"
```

---

### Task 4: Improve CLI doctor formatting and docs

**Files:**
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `README.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Add failing CLI tests**

Update the existing `doctor reports stats` test in `packages/cli/test/cli.test.ts` to assert JSON integrations:

```ts
    assert.equal(typeof parsed.data.integrations, "object")
    assert.equal(parsed.data.integrations.summary.mcpExplicitToolsOnly, true)
```

Add a human output test nearby:

```ts
  it("doctor human output renders integration diagnostics readably", () => {
    const env = {
      MEMORY_LANE_FILE: memFile,
      MEMORY_LANE_EMBEDDINGS_FILE: embFile,
      MEMORY_LANE_CONFIG: cfgFile,
    }
    const output = run(["doctor"], env)
    assert.match(output, /integrations:/u)
    assert.match(output, /mcpExplicitToolsOnly/u)
    assert.doesNotMatch(output, /\[object Object\]/u)
  })
```

- [ ] **Step 2: Run CLI tests and verify RED**

Run:

```bash
pnpm --filter @memory-lane/cli test -- test/cli.test.ts
```

Expected: FAIL because human doctor formatting currently prints nested objects as `[object Object]`. The JSON assertion may pass after Task 3.

- [ ] **Step 3: Update `formatDoctor()` for nested values**

In `packages/cli/src/formatters.ts`, replace `formatDoctor()` human branch with:

```ts
export function formatDoctor(report: Record<string, unknown>, json: boolean): string {
  if (json) {
    return JSON.stringify({ ok: true, data: report, meta: meta() }, null, 2)
  }
  return Object.entries(report).map(([k, v]) => {
    if (v && typeof v === "object") return `${k}: ${JSON.stringify(v, null, 2)}`
    return `${k}: ${v}`
  }).join("\n")
}
```

- [ ] **Step 4: Update README and ROADMAP docs**

In `README.md`, extend the doctor paragraph around hook debug diagnostics with:

```md
`memory-lane doctor` also reports read-only integration diagnostics. It checks whether common local config files appear to contain Memory Lane setup for Claude Desktop MCP, Codex hooks, Claude Code hooks, and the pi extension. These checks inspect config/entrypoint files only; they do not read prompts, transcripts, tool outputs, memory text, MCP traffic, or hook debug log contents. MCP provides explicit tools; hooks provide automatic lifecycle recall/save where supported; pi currently has manual tools and read-only lifecycle recall.
```

In `ROADMAP.md`, change Phase 8 status/scope to mention Slice 1 complete while leaving remaining todos as future work:

```md
**Status:** Slice 1 complete: read-only integration diagnostics in `memory-lane doctor`.
```

Then adjust the Phase 8 todo list so diagnostics is completed and resources/status remain open.

- [ ] **Step 5: Run CLI tests and docs reference check**

Run:

```bash
pnpm --filter @memory-lane/cli test -- test/cli.test.ts
rg -n "integration diagnostics|Claude Desktop MCP|MCP provides explicit|hooks provide automatic|Slice 1 complete" README.md ROADMAP.md
```

Expected: CLI tests PASS, `rg` finds the new docs text.

- [ ] **Step 6: Commit Task 4**

```bash
git add packages/cli/src/formatters.ts packages/cli/test/cli.test.ts README.md ROADMAP.md
git commit -m "docs: explain integration doctor diagnostics"
```

---

### Task 5: Final verification and implementation review

**Files:**
- No new source files unless verification reveals a defect.

- [ ] **Step 1: Run full build and tests**

Run:

```bash
pnpm build
pnpm test
```

Expected: both PASS.

- [ ] **Step 2: Run manual doctor smoke checks**

Run:

```bash
node packages/cli/dist/index.js doctor --json | node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { const parsed = JSON.parse(s); console.log(Boolean(parsed.data.integrations), parsed.data.integrations.summary.mcpExplicitToolsOnly); })'
node packages/cli/dist/index.js doctor | rg -n "integrations|mcpExplicitToolsOnly|\[object Object\]" || true
```

Expected:

```text
true true
```

Human output should include `integrations` and `mcpExplicitToolsOnly`; it should not include `[object Object]`.

- [ ] **Step 3: Review against spec**

Check:

```bash
rg -n "prompts|transcripts|tool outputs|MCP traffic|SessionStart|pi autosave" packages/core/src/integration-diagnostics.ts README.md ROADMAP.md docs/superpowers/specs/2026-06-08-integration-doctor-diagnostics.md
```

Expected: code does not mention or inspect private runtime artifacts; docs/spec retain the non-goal boundaries.

- [ ] **Step 4: Commit final fixes only if needed**

If Step 1-3 find fixes, commit them:

```bash
git add packages/core/src/integration-diagnostics.ts packages/core/src/engine.ts packages/core/src/types.ts packages/core/src/index.ts packages/core/test/integration-diagnostics.test.ts packages/core/test/engine.test.ts packages/cli/src/formatters.ts packages/cli/test/cli.test.ts README.md ROADMAP.md
git commit -m "fix: harden integration doctor diagnostics"
```

If no fixes are needed, do not create an empty commit.

- [ ] **Step 5: Summarize branch state**

Report:

- changed files;
- verification commands and results;
- spec deviations, if any;
- remaining next step.

Expected remaining next step: merge `phase-8-integration-doctor` back to `main` after approval.
