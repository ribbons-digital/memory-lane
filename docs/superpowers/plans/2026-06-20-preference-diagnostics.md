# Preference Diagnostics Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose text-free preference-layer diagnostics through existing Memory Lane status/doctor/MCP status surfaces.

**Architecture:** Add pure preference classification/layering/counting helpers in `@memory-lane/core`, expose the resulting `preferenceDiagnostics` through `MemoryEngine.doctor()`, and let existing CLI/MCP status surfaces carry the metadata without new commands or tools. Keep lifecycle behavior unchanged; if lifecycle imports shared pure helpers, verify behavior-preserving tests.

**Tech Stack:** TypeScript, Node test runner, pnpm monorepo, Memory Lane core/CLI/MCP packages.

---

## Approved spec

Spec path: `docs/superpowers/specs/2026-06-20-preference-diagnostics-design.md`

Important constraints:

- No new CLI commands.
- No new MCP tools or schema-only tool additions.
- No lifecycle behavior changes.
- No preference memory text, ids, or previews in diagnostics.
- Diagnostics are SessionStart baseline preference-cap diagnostics, not actual hook-output guarantees.
- Other-project preference pools are out of scope.

## Files

Create:

- `packages/core/src/preference-diagnostics.ts`
  - Pure helper(s) for preference-like classification, visible preference pools, baseline SessionStart preference-cap diagnostics, and text-free metadata.

Modify:

- `packages/core/src/types.ts`
  - Add `PreferenceDiagnostics`, nested SessionStart diagnostics type, and option type if needed.
- `packages/core/src/engine.ts`
  - Use helper in `doctor()`.
  - Add preference budget scalar fields to `contextPolicyDoctor()`.
- `packages/core/src/index.ts`
  - Export new helper/types if needed by lifecycle or tests.
- `packages/lifecycle/src/injection.ts`
  - Optional: import shared pure `isPreferenceLikeMemory` from core, preserving behavior.
- `packages/lifecycle/test/injection.test.ts`
  - Behavior-preserving tests only if lifecycle imports shared helper.
- `packages/core/test/engine.test.ts`
  - Core diagnostics tests.
- `packages/cli/src/formatters.ts`
  - Human status/doctor concise formatting and context policy key suppression for new scalar fields.
- `packages/cli/test/cli.test.ts`
  - CLI status/doctor JSON and human text-free tests.
- `packages/mcp-server/src/handlers.ts`
  - Optional: add a text-free note for preference diagnostics in `memory_status` notes.
- `packages/mcp-server/test/handlers.test.ts`
  - MCP `memory_status` diagnostics and text-free tests.
- `README.md`
  - Document preference diagnostics on status/doctor/MCP status.
- `ROADMAP.md`
  - Update Phase 18 status wording: Slice 1 merged, diagnostics slice implemented/in progress, remaining deferred items.
- `HANDOFF.md`
  - Update current branch/status.

---

## Task 1: Core preference diagnostics helper and doctor output

**Files:**
- Create: `packages/core/src/preference-diagnostics.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Write failing core diagnostics tests**

Add tests in `packages/core/test/engine.test.ts` near existing doctor/context policy tests.

Test A: global/current-project counts and text-free serialization:

```ts
it("doctor includes text-free preference diagnostics for visible scope", () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "pref-diagnostics-project" }))
  const e = engine()
  e.save({ text: "GLOBAL_SECRET_PREF_BODY prefer concise answers", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
  e.refreshScope(project)
  e.save({ text: "PROJECT_SECRET_PREF_BODY include verification output", status: "approved", category: "preference", scopeType: "project", kind: "preference" })
  e.save({ text: "Workflow rule should count as preference-like", status: "approved", category: "project", scopeType: "project", kind: "workflow_rule" })
  e.save({ text: "Pending preference should not count", status: "pending", category: "preference", scopeType: "global", kind: "preference" })

  const report = e.doctor() as any
  const diagnostics = report.preferenceDiagnostics
  const serialized = JSON.stringify(report)

  assert.equal(diagnostics.projectScope, "pref-diagnostics-project")
  assert.equal(diagnostics.visiblePreferenceCount, 3)
  assert.equal(diagnostics.currentProjectPreferenceCount, 2)
  assert.equal(diagnostics.globalPreferenceCount, 1)
  assert.equal(diagnostics.workflowRulePreferenceCount, 1)
  assert.equal(diagnostics.sessionStart.maxPreferenceItems, 2)
  assert.equal(diagnostics.sessionStart.maxPreferenceChars, 600)
  assert.equal(typeof diagnostics.sessionStart.selectedPreferenceCount, "number")
  assert.equal(typeof diagnostics.sessionStart.omittedPreferenceCount, "number")
  assert.doesNotMatch(serialized, /GLOBAL_SECRET_PREF_BODY|PROJECT_SECRET_PREF_BODY|Pending preference should not count/u)
})
```

Test B: caps and duplicate behavior:

```ts
it("doctor preference diagnostics apply session-start preference caps and dedupe", () => {
  fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({
    memory: {
      contextPolicy: {
        mode: "selective",
        maxItems: { sessionStart: 4, prompt: 6 },
        maxChars: { sessionStart: 1000, prompt: 3000 },
        preferenceMaxItems: { sessionStart: 1, prompt: 2 },
        preferenceMaxChars: { sessionStart: 1000, prompt: 900 },
      },
    },
  }), "utf8")
  const e = engine()
  e.save({ text: "Use pnpm for installs", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
  e.save({ text: "Use pnpm for installs", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
  e.save({ text: "Prefer concise answers", status: "approved", category: "preference", scopeType: "global", kind: "preference" })

  const diagnostics = (e.doctor() as any).preferenceDiagnostics

  assert.equal(diagnostics.visiblePreferenceCount, 3)
  assert.equal(diagnostics.sessionStart.selectedPreferenceCount, 1)
  assert.equal(diagnostics.sessionStart.omittedPreferenceCount, 2)
  assert.equal(diagnostics.sessionStart.selectedGlobalPreferenceCount, 1)
})
```

Test C: char cap and off/policy-only mode:

```ts
it("doctor preference diagnostics respect preference char cap and disabled body modes", () => {
  fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({
    memory: {
      contextPolicy: {
        mode: "policy-only",
        maxItems: { sessionStart: 4, prompt: 6 },
        maxChars: { sessionStart: 1000, prompt: 3000 },
        preferenceMaxItems: { sessionStart: 2, prompt: 2 },
        preferenceMaxChars: { sessionStart: 1, prompt: 900 },
      },
    },
  }), "utf8")
  const e = engine()
  e.save({ text: "Preference too long for one char cap", status: "approved", category: "preference", scopeType: "global", kind: "preference" })

  let diagnostics = (e.doctor() as any).preferenceDiagnostics
  assert.equal(diagnostics.visiblePreferenceCount, 1)
  assert.equal(diagnostics.sessionStart.selectedPreferenceCount, 0)
  assert.equal(diagnostics.sessionStart.omittedPreferenceCount, 1)

  fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({ memory: { contextPolicy: { mode: "off" } } }), "utf8")
  const offEngine = engine()
  offEngine.save({ text: "Another global preference", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
  diagnostics = (offEngine.doctor() as any).preferenceDiagnostics
  assert.equal(diagnostics.visiblePreferenceCount, 1)
  assert.equal(diagnostics.sessionStart.selectedPreferenceCount, 0)
  assert.equal(diagnostics.sessionStart.omittedPreferenceCount, 1)
})
```

- [ ] **Step 2: Run focused core test and verify RED**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-diagnostics/packages/core
pnpm test -- test/engine.test.ts
```

Expected: FAIL because `preferenceDiagnostics` is absent.

- [ ] **Step 3: Add core types**

In `packages/core/src/types.ts`, add:

```ts
export interface PreferenceSessionStartDiagnostics {
  maxPreferenceItems: number
  maxPreferenceChars: number
  selectedPreferenceCount: number
  omittedPreferenceCount: number
  selectedCurrentProjectPreferenceCount: number
  selectedGlobalPreferenceCount: number
}

export interface PreferenceDiagnostics {
  projectScope: string | "none"
  visiblePreferenceCount: number
  currentProjectPreferenceCount: number
  globalPreferenceCount: number
  workflowRulePreferenceCount: number
  sessionStart: PreferenceSessionStartDiagnostics
  notes: string[]
}
```

- [ ] **Step 4: Implement `preference-diagnostics.ts`**

Create `packages/core/src/preference-diagnostics.ts` with pure helpers:

- `isPreferenceLikeMemory(memory: MemoryRecord): boolean`
- `buildPreferenceDiagnostics(memories, options): PreferenceDiagnostics`

Use these rules:

- Only approved memories.
- Visible scope: global + matching project when `projectScopeKey` exists; global only when no project scope.
- Exclude operating agreement ids provided by caller from SessionStart selected counts, but not from visible pool counts unless the spec says otherwise. The diagnostics should explain baseline selection excludes agreement bodies already surfaced separately.
- Secret filtering for selected counts should use `containsLikelySecret`.
- Deduplicate selected counts by normalized text, using the same normalization as lifecycle (`normalizeMemoryText(...).toLowerCase().replace(/\s+/gu, " ").trim()`).
- Layer selected diagnostics: current project preferences first, then global preferences.
- Respect total session-start `maxItems` and `maxChars` plus `preferenceMaxItems` and `preferenceMaxChars`.
- If `contextPolicyMode` is `off` or `policy-only`, `selectedPreferenceCount` is `0` and omitted is visible pool count.

- [ ] **Step 5: Wire doctor output**

In `packages/core/src/engine.ts`:

- Import `buildPreferenceDiagnostics`.
- Add preference budget scalars to `contextPolicyDoctor()`:
  - `contextPolicySessionStartPreferenceMaxItems`
  - `contextPolicyPromptPreferenceMaxItems`
  - `contextPolicySessionStartPreferenceMaxChars`
  - `contextPolicyPromptPreferenceMaxChars`
- In `doctor()`, compute operating agreements once and pass agreement ids to diagnostics so baseline selected counts exclude those ids.
- Add `preferenceDiagnostics` to returned object.

- [ ] **Step 6: Export helper if needed**

In `packages/core/src/index.ts`, export the new helper if lifecycle or tests import it.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-diagnostics/packages/core
pnpm test -- test/engine.test.ts
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-diagnostics
pnpm build
```

Expected: PASS.

---

## Task 2: CLI and MCP status surfaces

**Files:**
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `packages/mcp-server/src/handlers.ts`
- Modify: `packages/mcp-server/test/handlers.test.ts`

- [ ] **Step 1: Add failing CLI tests**

In `packages/cli/test/cli.test.ts`, add tests near status/doctor tests:

```ts
it("status and doctor json include text-free preference diagnostics", () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-pref-diagnostics" }))
  const env = {
    MEMORY_LANE_FILE: memFile,
    MEMORY_LANE_EMBEDDINGS_FILE: embFile,
    MEMORY_LANE_CONFIG: cfgFile,
  }
  const engine = new MemoryEngine({ memoryPath: memFile, embeddingsPath: embFile, configPath: cfgFile })
  engine.save({ text: "CLI_SECRET_GLOBAL_PREF prefer concise answers", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
  engine.refreshScope(project)
  engine.save({ text: "CLI_SECRET_PROJECT_PREF include verification output", status: "approved", category: "preference", scopeType: "project", kind: "preference" })

  const status = JSON.parse(runProcess(["status", "--json"], { env, cwd: project }).stdout)
  const doctor = JSON.parse(runProcess(["doctor", "--json"], { env, cwd: project }).stdout)

  assert.equal(status.data.preferenceDiagnostics.projectScope, "cli-pref-diagnostics")
  assert.equal(status.data.preferenceDiagnostics.visiblePreferenceCount, 2)
  assert.equal(doctor.data.preferenceDiagnostics.visiblePreferenceCount, 2)
  assert.doesNotMatch(JSON.stringify(status), /CLI_SECRET_GLOBAL_PREF|CLI_SECRET_PROJECT_PREF/u)
  assert.doesNotMatch(JSON.stringify(doctor), /CLI_SECRET_GLOBAL_PREF|CLI_SECRET_PROJECT_PREF/u)
})
```

Add a human output test if formatter changes are implemented:

```ts
it("doctor human output summarizes preference diagnostics without preference text", () => {
  const env = { MEMORY_LANE_FILE: memFile, MEMORY_LANE_EMBEDDINGS_FILE: embFile, MEMORY_LANE_CONFIG: cfgFile, NO_COLOR: "1" }
  const engine = new MemoryEngine({ memoryPath: memFile, embeddingsPath: embFile, configPath: cfgFile })
  engine.save({ text: "HUMAN_SECRET_PREF_BODY", status: "approved", category: "preference", scopeType: "global", kind: "preference" })

  const output = run(["doctor"], env)

  assert.match(output, /Preference context:/u)
  assert.match(output, /Preference caps:/u)
  assert.doesNotMatch(output, /HUMAN_SECRET_PREF_BODY/u)
})
```

- [ ] **Step 2: Add failing MCP tests**

In `packages/mcp-server/test/handlers.test.ts`, add:

```ts
test("memory_status includes text-free preference diagnostics", async () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "mcp-pref-diagnostics" }))
  const engine = engineInTemp(project)
  engine.save({ text: "MCP_SECRET_GLOBAL_PREF", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
  engine.refreshScope(project)
  engine.save({ text: "MCP_SECRET_PROJECT_PREF", status: "approved", category: "preference", scopeType: "project", kind: "preference" })

  const result = parseToolResult(await handleMemoryStatus(engine, { projectPath: project }))
  const serialized = JSON.stringify(result)

  assert.equal(result.ok, true)
  assert.equal(result.data.status.preferenceDiagnostics.projectScope, "mcp-pref-diagnostics")
  assert.equal(result.data.status.preferenceDiagnostics.visiblePreferenceCount, 2)
  assert.equal(result.data.status.preferenceDiagnostics.currentProjectPreferenceCount, 1)
  assert.equal(result.data.status.preferenceDiagnostics.globalPreferenceCount, 1)
  assert.doesNotMatch(serialized, /MCP_SECRET_GLOBAL_PREF|MCP_SECRET_PROJECT_PREF/u)
})
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-diagnostics/packages/cli
pnpm test -- test/cli.test.ts
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-diagnostics/packages/mcp-server
pnpm test -- test/handlers.test.ts
```

Expected: FAIL until formatters/MCP notes are updated and core diagnostics exist.

- [ ] **Step 4: Update CLI formatter**

In `packages/cli/src/formatters.ts`:

- Add the four preference budget scalar keys to `contextPolicyDoctorKeys`.
- Update `formatContextPolicyDoctor()` with a concise preference cap line.
- Add `isPreferenceDiagnostics()` and `formatPreferenceDiagnosticsSummary()` helpers.
- In `formatDoctor()` human output, include the preference summary and suppress raw `preferenceDiagnostics` object from generic detail lines.

Human lines should be equivalent to:

```text
Preference context: visible 2, selected for SessionStart 2, omitted 0
Preference caps: SessionStart 2 items / 600 chars, Prompt 2 items / 900 chars
```

- [ ] **Step 5: Update MCP status note if useful**

In `packages/mcp-server/src/handlers.ts`, append a text-free status note:

```ts
"Preference diagnostics in memory_status are counts/metadata only; use memory_list or memory_recall when you need preference text."
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-diagnostics/packages/cli
pnpm test -- test/cli.test.ts
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-diagnostics/packages/mcp-server
pnpm test -- test/handlers.test.ts
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-diagnostics
pnpm build
```

Expected: PASS.

---

## Task 3: Lifecycle helper sharing / behavior preservation

**Files:**
- Modify: `packages/lifecycle/src/injection.ts` only if importing `isPreferenceLikeMemory` from core.
- Test: `packages/lifecycle/test/injection.test.ts`

- [ ] **Step 1: Decide whether helper sharing is needed**

If Task 1 exports `isPreferenceLikeMemory` from core, update lifecycle to import it and remove the local duplicate. If doing so causes churn or behavior risk, leave lifecycle private and ensure diagnostics notes call themselves baseline diagnostics, not exact lifecycle trace.

- [ ] **Step 2: If changed, run lifecycle behavior tests**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-diagnostics/packages/lifecycle
pnpm test -- test/injection.test.ts
```

Expected: PASS with no behavior changes.

- [ ] **Step 3: Build**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-diagnostics
pnpm build
```

Expected: PASS.

---

## Task 4: Docs and roadmap/handoff polish

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`
- Maybe modify: `CONTEXT.md` only if adding a new glossary term is useful; do not over-document.

- [ ] **Step 1: Update README**

Add a concise paragraph near the context policy / global preferences docs:

```md
`memory-lane status --json`, `memory-lane doctor --json`, and MCP `memory_status` include text-free `preferenceDiagnostics` counts. These diagnostics show the visible preference pool and SessionStart preference-cap selection counts without returning preference bodies, ids, or previews. Use `memory-lane list --json`, `memory-lane review --json`, targeted recall, or MCP `memory_list`/`memory_recall` when you need the actual preference text.
```

- [ ] **Step 2: Update ROADMAP**

In Phase 18:

- Change Slice 1 wording from “implemented locally” to merged via PR #21 on main.
- Add diagnostics slice status as implemented/in progress depending on current completion.
- Keep remaining deferred follow-ups narrow: conflict/override inspection and dashboard/review guidance if needed.
- Do not rewrite Phase 19+.

- [ ] **Step 3: Update HANDOFF**

Add current branch summary:

- `feature/phase-18-preference-diagnostics`
- spec/plan paths
- scope and non-goals
- verification commands run
- next step: PR and user merge/cleanup if completed

- [ ] **Step 4: Verify docs only with diff check**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-diagnostics
git diff --check
```

Expected: PASS.

---

## Task 5: Final verification, review, and PR

**Files:**
- All changed files.

- [ ] **Step 1: Full verification**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-diagnostics
pnpm build
pnpm test
git diff --check
git status --short
```

Expected:

- Build passes.
- Tests pass.
- Diff check passes.
- Only intended files changed/untracked.

- [ ] **Step 2: Request final implementation review**

Ask reviewer to check:

- Spec compliance.
- Text-free guarantees.
- Count semantics and SessionStart baseline wording.
- No new CLI/MCP surfaces.
- No lifecycle behavior changes.
- Docs accuracy.

- [ ] **Step 3: Repair required findings with TDD**

For each required finding:

1. Add/update failing test.
2. Verify RED.
3. Fix implementation/docs.
4. Verify GREEN.
5. Re-run full verification.

- [ ] **Step 4: Commit and open PR**

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-diagnostics
git status --short
git add docs/superpowers/specs/2026-06-20-preference-diagnostics-design.md docs/superpowers/plans/2026-06-20-preference-diagnostics.md packages README.md ROADMAP.md HANDOFF.md CONTEXT.md
git commit -m "feat: add preference diagnostics metadata"
git push -u origin feature/phase-18-preference-diagnostics
gh pr create --title "feat: add preference diagnostics metadata" --body-file /tmp/memory-lane-phase-18-preference-diagnostics-pr.md
```

Do not merge locally. Wait for user merge/approval per the Memory Lane PR-protected workflow.
