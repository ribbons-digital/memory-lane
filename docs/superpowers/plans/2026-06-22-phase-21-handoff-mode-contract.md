# Phase 21 Handoff Mode Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the non-breaking `memory.handoffMode` contract, diagnostics, tests, and docs without changing lifecycle behavior.

**Architecture:** Add a typed `HandoffMode` field under existing `memory` config, default and validate it in core config, expose flat text-free diagnostics through `MemoryEngine.doctor()`, and render those diagnostics in existing CLI/MCP status surfaces. `review` and `automatic` are declared but behavior-inactive in this slice.

**Tech Stack:** TypeScript monorepo, Node test runner, pnpm workspace, existing MemoryEngine/config/CLI/MCP patterns.

---

## File Structure

- Modify: `packages/core/src/types.ts`
  - Add `HandoffMode` type and `memory.handoffMode?: HandoffMode`.
- Modify: `packages/core/src/config.ts`
  - Default `handoffMode: "manual"` and validate it.
- Modify: `packages/core/src/engine.ts`
  - Add `getHandoffMode()` and handoff-mode doctor diagnostics.
- Modify: `packages/cli/src/formatters.ts`
  - Add human doctor handoff-mode block and exclude raw fields from generic detail output.
- Modify: `packages/core/test/engine.test.ts`
  - Add config/doctor/no-behavior-change tests.
- Modify: `packages/cli/test/cli.test.ts`
  - Add CLI human doctor and JSON status/doctor coverage.
- Modify: `packages/mcp-server/test/handlers.test.ts`
  - Add MCP status handoff-mode field coverage.
- Modify: `CONTEXT.md`, `README.md`, `ROADMAP.md`, `HANDOFF.md`
  - Document the contract and declared-but-inactive boundary.

## Task 1: Core Config and Doctor Contract

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Add the type and config field**

In `packages/core/src/types.ts`, add near the config types:

```ts
export type HandoffMode = "manual" | "review" | "automatic"
```

Update `SemanticMemoryConfig.memory` to include:

```ts
handoffMode?: HandoffMode
```

- [ ] **Step 2: Add the default**

In `packages/core/src/config.ts`, update `DEFAULT_CONFIG.memory`:

```ts
memory: {
  handoffMode: "manual",
  sessionEndSummary: {
    enabled: false,
    requireConfirmation: true,
    includeToolOutputs: false,
    maxTokens: 800,
  },
  contextPolicy: {
    mode: "selective",
    maxItems: { sessionStart: 4, prompt: 6 },
    maxChars: { sessionStart: 1600, prompt: 3000 },
    preferenceMaxItems: { sessionStart: 2, prompt: 2 },
    preferenceMaxChars: { sessionStart: 600, prompt: 900 },
    includePending: false,
    fallbackToSearch: true,
  },
},
```

- [ ] **Step 3: Add validation helper**

In `packages/core/src/config.ts`, add near the context/session summary validators:

```ts
function validateHandoffMode(v: unknown): void {
  if (v === undefined) return
  if (v !== "manual" && v !== "review" && v !== "automatic") {
    throw new ConfigError("memory.handoffMode must be manual, review, or automatic")
  }
}
```

Call it from `validateConfig` before or near the existing memory validators:

```ts
const memory = root.memory as Record<string, unknown> | undefined
validateHandoffMode(memory?.handoffMode)
validateContextPolicyConfig(memory?.contextPolicy)
validateSessionEndSummaryConfig(memory?.sessionEndSummary)
```

- [ ] **Step 4: Add engine helpers**

In `packages/core/src/engine.ts`, import `HandoffMode` if needed and add:

```ts
getHandoffMode(): HandoffMode {
  const mode = this.config.memory?.handoffMode ?? "manual"
  return mode === "review" || mode === "automatic" ? mode : "manual"
}

private handoffModeDoctor(): Record<string, unknown> {
  const mode = this.getHandoffMode()
  return {
    handoffMode: mode,
    handoffModeBehaviorActive: mode === "manual",
    handoffModeNote: mode === "manual"
      ? "Current inspection-first behavior is active."
      : "Declared for Phase 21; currently behaves like manual mode.",
  }
}
```

Spread it into `doctor()` near `contextPolicyDoctor()`:

```ts
...this.handoffModeDoctor(),
...this.contextPolicyDoctor(),
```

- [ ] **Step 5: Add core tests**

In `packages/core/test/engine.test.ts`, add tests that:

- missing config reports `handoffMode: "manual"`;
- each valid value loads and reports the expected behavior-active boolean/note;
- invalid value throws `ConfigError` from `loadConfig` or `validateConfig`;
- for a fixed store/config, doctor output for `manual`, `review`, and `automatic` differs only in `handoffMode`, `handoffModeBehaviorActive`, and `handoffModeNote`.

Use existing temp-directory/config-file test patterns already present in `engine.test.ts`.

- [ ] **Step 6: Run core tests**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: all core tests pass.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add packages/core/src/types.ts packages/core/src/config.ts packages/core/src/engine.ts packages/core/test/engine.test.ts
git commit -m "feat(core): add handoff mode diagnostics"
```

## Task 2: CLI and MCP Status Surfaces

**Files:**
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `packages/mcp-server/test/handlers.test.ts`

- [ ] **Step 1: Add CLI formatter block**

In `packages/cli/src/formatters.ts`, add a handoff-mode field exclusion set or extend the existing context-policy generic exclusion logic:

```ts
const handoffModeDoctorKeys = new Set([
  "handoffMode",
  "handoffModeBehaviorActive",
  "handoffModeNote",
])
```

Add a formatter:

```ts
function formatHandoffModeDoctor(report: Record<string, unknown>): string[] {
  if (!("handoffMode" in report)) return []
  return [
    "Handoff mode",
    `  mode: ${report.handoffMode}`,
    `  behavior active: ${report.handoffModeBehaviorActive ? "yes" : "no"}`,
    `  note: ${report.handoffModeNote}`,
  ]
}
```

In `formatDoctor`, render this block near context policy and omit the fields from generic detail rendering:

```ts
const handoffModeLines = formatHandoffModeDoctor(report)
if (handoffModeLines.length) sections.push(handoffModeLines.join("\n"))
```

Add `!handoffModeDoctorKeys.has(k)` to the generic detail filter.

- [ ] **Step 2: Add CLI tests**

In `packages/cli/test/cli.test.ts`, add or extend tests to assert:

- `memory-lane doctor` human output includes `Handoff mode`, `mode: manual`, and `behavior active: yes` by default.
- `memory-lane status --json` includes `handoffMode`, `handoffModeBehaviorActive`, and `handoffModeNote`.
- `memory-lane doctor --json` includes the same fields.
- A temp config with `{ memory: { handoffMode: "review" } }` reports `behavior active: false` and the declared-but-inactive note.

- [ ] **Step 3: Add MCP status test**

In `packages/mcp-server/test/handlers.test.ts`, add coverage that `memory_status` response data includes:

```ts
handoffMode: "manual"
handoffModeBehaviorActive: true
handoffModeNote: "Current inspection-first behavior is active."
```

Use existing `memory_status` tests as the pattern.

- [ ] **Step 4: Run CLI and MCP tests**

Run:

```bash
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
```

Expected: all CLI and MCP tests pass.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add packages/cli/src/formatters.ts packages/cli/test/cli.test.ts packages/mcp-server/test/handlers.test.ts
git commit -m "feat(cli): surface handoff mode status"
```

## Task 3: Documentation and Final Verification

**Files:**
- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update CONTEXT terms**

Add terms from the approved spec:

- Handoff mode
- Manual handoff mode
- Review handoff mode
- Automatic handoff mode

Keep them domain-focused and avoid implementation details.

- [ ] **Step 2: Update README config docs**

In the configuration/context-policy area of `README.md`, add a section explaining:

- `memory.handoffMode` values: `manual`, `review`, `automatic`;
- default `manual`;
- `review` and `automatic` are declared but inactive in this slice;
- handoff mode is continuity posture, while context policy controls injection budget/body inclusion.

Include a minimal JSON example:

```json
{
  "memory": {
    "handoffMode": "manual"
  }
}
```

- [ ] **Step 3: Update ROADMAP and HANDOFF**

In `ROADMAP.md`, mark Phase 21 Slice 1 as implementing the handoff-mode contract only. In `HANDOFF.md`, add a recent-changes bullet describing the non-breaking contract and inactive modes.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
pnpm build
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add CONTEXT.md README.md ROADMAP.md HANDOFF.md
git commit -m "docs: document handoff mode contract"
```

## Task 4: Final Review and PR

**Files:**
- No required edits unless review finds issues.

- [ ] **Step 1: Inspect final diff**

Run:

```bash
git status --short
git log --oneline -8
git diff --stat main...HEAD
```

Expected: working tree clean; changes include spec, plan, core/CLI/MCP implementation, tests, and docs only.

- [ ] **Step 2: Request independent review**

Ask a reviewer to check:

- spec compliance;
- no lifecycle behavior change;
- `review`/`automatic` declared but inactive;
- diagnostics are memory-body-free;
- tests and docs cover the contract.

- [ ] **Step 3: Repair if needed**

If reviewer finds blockers, fix them, rerun affected tests and `git diff --check`, and commit repairs.

- [ ] **Step 4: Push and open PR**

Run:

```bash
git push -u origin feature/phase-21-handoff-mode-contract
```

Open PR title:

```text
feat: add handoff mode contract
```

PR body should include summary, tests run, and explicit note that `review`/`automatic` are declared but inactive.
