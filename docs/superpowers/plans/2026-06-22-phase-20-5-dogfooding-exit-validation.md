# Phase 20.5 Dogfooding and Exit Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a no-code validation note that determines whether Memory Lane can exit Phase 20 or needs one evidence-backed follow-up.

**Architecture:** This plan uses only existing CLI/MCP/lifecycle surfaces and writes one Markdown validation note. It does not change product code, schema, commands, MCP tools, config, hooks, or runtime behavior. The validation note is the source of truth for any ROADMAP/HANDOFF updates.

**Tech Stack:** Markdown docs, existing `memory-lane` CLI, existing MCP tools where available, Git, pnpm verification only when needed.

---

## File Structure

- Create: `docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md`
  - The validation evidence report and exit verdict.
- Modify only if the validation produces a durable decision:
  - `ROADMAP.md`
  - `HANDOFF.md`
- Existing approved spec:
  - `docs/superpowers/specs/2026-06-22-phase-20-5-dogfooding-exit-validation-design.md`

## Task 1: Establish Validation Baseline

**Files:**
- Create: `docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md`

- [ ] **Step 1: Record repo and environment baseline**

Run:

```bash
git status --short
git rev-parse HEAD
git log --oneline -5
memory-lane status --json
```

Expected:

- `git status --short` shows only planned doc/spec files or is clean.
- `git rev-parse HEAD` returns the commit under validation.
- `memory-lane status --json` returns valid JSON with counts and config metadata.

- [ ] **Step 2: Choose the `--since` timestamp**

Use a real continuity boundary. Prefer this order:

1. Current session start timestamp if available.
2. Latest release/checkpoint timestamp from the recent work, such as the `v0.2.20` release timestamp.
3. A prior session-start/checkpoint timestamp visible in Memory Lane state.

Record the chosen timestamp and why in the validation note. Do not choose an arbitrary timestamp to force output.

- [ ] **Step 3: Create validation note skeleton**

Create `docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md` with this exact structure:

```markdown
# Phase 20.5 Dogfooding and Exit Validation

## Environment

- Memory Lane commit under test: `<commit>`
- Memory Lane version/release context: `<version-or-release>`
- Validation date: `2026-06-22`
- Project path/scope: `<path-and-scope>`
- Summarization provider configured: `<yes/no/not-tested>`
- Harnesses/surfaces tested:
  - CLI: `<yes/no>`
  - Claude Code hooks: `<yes/no/not-available>`
  - Codex hooks: `<yes/no/not-available>`
  - pi: `<yes/no/not-available>`
  - MCP: `<yes/no/not-available>`
- `--since` timestamp used: `<ISO>`
- Timestamp rationale: `<why-this-is-a-real-continuity-boundary>`

## Commands and Surfaces Exercised

| Surface | Command/tool | Result | Notes |
| --- | --- | --- | --- |

## Review Queue Health

### Counts

| Dimension | Count summary |
| --- | --- |
| Status | `<summary>` |
| Kind | `<summary>` |
| Source | `<summary>` |
| Provenance | `<summary>` |

### Findings

- Duplicates or near-duplicates: `<finding>`
- False positives: `<finding>`
- False negatives: `<finding>`
- Candidate understandability: `<finding>`
- Validation-generated candidates: `<none-or-summary>`

## Continuity Usefulness

- Last-work/current-status quality: `<finding>`
- Next-step quality: `<finding>`
- Pending continuity visibility: `<finding>`
- MCP `projectPath` guidance: `<finding>`

## Freshness Advisory Usefulness

- Stale advisory count basis: `<count-basis>`
- Expired advisory count basis: `<count-basis>`
- Human output visibility: `<finding>`
- Dry-run command usefulness: `<finding>`
- Refresh workflow justification: `<yes/no-with-evidence>`

## Context Policy Observations

- Context policy mode: `<mode>`
- Item/character budgets: `<summary>`
- Selected/omitted counts: `<summary>`
- Evidence for token-accounting follow-up: `<finding>`

## Exit Verdict

Choose exactly one:

- `<Exit Phase 20 | One Phase 20 follow-up | Hardening pause>`

Evidence:

- `<bullet>`
- `<bullet>`
- `<bullet>`

## Recommended Next Slice

- Recommendation: `<one-sentence-next-slice-or-stop>`
- Why next: `<why>`
- Explicitly out of scope: `<out-of-scope>`

## Not Tested

- `<surface-or-harness>`: `<reason>`
```

- [ ] **Step 4: Commit baseline note skeleton**

Run:

```bash
git add docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md
git commit -m "docs: add phase 20.5 validation note skeleton"
```

Expected: commit succeeds.

## Task 2: Exercise CLI Review and Continuity Surfaces

**Files:**
- Modify: `docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md`

- [ ] **Step 1: Run review and dashboard commands**

Run:

```bash
memory-lane dashboard
memory-lane dashboard --json
memory-lane review
memory-lane review --json
memory-lane review --kind session_summary --json
memory-lane review --kind project_checkpoint --json
memory-lane review --kind correction --json
memory-lane review --kind procedure --json
```

Expected:

- Human commands are readable and bounded.
- JSON commands return structured output.
- Missing kinds are clean empty states, not failures.

- [ ] **Step 2: Run continuity commands**

Run:

```bash
memory-lane continuity
memory-lane continuity --json
```

Expected:

- Human continuity output is compact enough to read.
- JSON continuity output includes approved/pending/freshness/operating-agreement/harness guidance fields as available.
- Continuity does not require topic-specific recall to answer basic project state.

- [ ] **Step 3: Update validation note**

Record:

- Commands run and whether they succeeded.
- Review counts by kind/source/provenance.
- Any duplicate/noisy candidates.
- Whether candidates were understandable without memory body dumps.
- Continuity usefulness findings.

Do not paste full memory bodies. Use ids/counts/kinds and short paraphrases only.

- [ ] **Step 4: Commit CLI findings**

Run:

```bash
git add docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md
git commit -m "docs: record cli validation findings"
```

Expected: commit succeeds.

## Task 3: Exercise Freshness and Context-Policy Surfaces

**Files:**
- Modify: `docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md`

- [ ] **Step 1: Run status and doctor with the chosen timestamp**

Replace `<ISO>` with the timestamp chosen in Task 1.

```bash
memory-lane status --since <ISO>
memory-lane status --json --since <ISO>
memory-lane doctor --since <ISO>
memory-lane doctor --json --since <ISO>
```

Expected:

- Human output is bounded and text-free for freshness/status diagnostics.
- JSON output includes freshness and context policy metadata.
- Invalid or unavailable freshness data is reported as metadata, not memory body dumps.

- [ ] **Step 2: Inspect context-policy diagnostics**

From `status --json` and `doctor --json`, record:

- context policy mode;
- prompt/session-start item budgets;
- prompt/session-start character budgets;
- pending inclusion setting;
- fallback-to-search setting;
- preference diagnostics if present;
- selected/omitted counts where present.

- [ ] **Step 3: Update validation note**

Record:

- Stale/expired/current counts and advisory usefulness.
- Whether dry-run action blocks are visible and copy-pasteable.
- Whether a refresh workflow is justified.
- Whether token-accounting reporting is justified by evidence.

- [ ] **Step 4: Commit freshness/context findings**

Run:

```bash
git add docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md
git commit -m "docs: record freshness and context validation findings"
```

Expected: commit succeeds.

## Task 4: Exercise MCP and Lifecycle Surfaces Where Available

**Files:**
- Modify: `docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md`

- [ ] **Step 1: Check MCP availability**

If an MCP client is available, use existing Memory Lane MCP tools only:

- `memory_status({ projectPath })`
- `memory_review({ projectPath })`
- `memory_continuity({ projectPath })`

Expected:

- MCP status/review/continuity correspond to CLI surfaces for the same project path.
- MCP output is usable without returning raw memory bodies except where review/list tools intentionally expose memory records for explicit inspection.
- If the MCP client has no project cwd, `projectPath` guidance is clear.

If no MCP client is available, record `MCP: not tested` with reason.

- [ ] **Step 2: Check lifecycle surface availability**

Use only already configured and safe lifecycle paths. Do not change hook configuration.

Allowed:

- Claude Code: `SessionStart`, `UserPromptSubmit`, `Stop`, `PostToolUse`, `SessionEnd` if already configured and appropriate.
- Codex: `SessionStart`, `UserPromptSubmit`, `Stop`, `PostToolUse` only.
- pi: existing memory tools and explicit `/memory session-summary` only.

Forbidden:

- Adding unsupported Codex `SessionEnd`.
- Treating the test/future-compatible Codex-shaped session-end adapter as a user-facing hook.
- Adding automatic pi compaction/agent-end behavior.

- [ ] **Step 3: Record lifecycle side effects**

If lifecycle paths generate pending candidates, record them separately as validation-generated side effects. Do not count them as pre-existing review queue noise.

- [ ] **Step 4: Commit MCP/lifecycle findings**

Run:

```bash
git add docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md
git commit -m "docs: record mcp and lifecycle validation findings"
```

Expected: commit succeeds, or if MCP/lifecycle was not available, commit records not-tested reasons.

## Task 5: Decide Exit Verdict and Update Durable Docs If Needed

**Files:**
- Modify: `docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md`
- Modify if needed: `ROADMAP.md`
- Modify if needed: `HANDOFF.md`

- [ ] **Step 1: Apply decision rules**

Use the spec rules:

- Choose `Exit Phase 20` only if review candidates are understandable, continuity output is useful, freshness advisories are not noisy, and no blocking harness-specific confusion is found.
- Choose token-accounting only if character budgets or selected/omitted counts are insufficient for context-window risk.
- Choose refresh only if stale/expired advisories are useful and common enough that manual dry-run command lists are insufficient.
- Choose retrieval-eval only if failures are retrieval failures, not capture failures.
- Choose onboarding/doctor hardening only if setup/project-scope confusion blocks validation.
- Choose viewer/dashboard only if CLI/MCP have signal but repeated inspection is too cumbersome.

- [ ] **Step 2: Fill the Exit Verdict and Recommended Next Slice sections**

The validation note must choose exactly one verdict and exactly one next-slice recommendation or stop recommendation.

- [ ] **Step 3: Update ROADMAP/HANDOFF only if needed**

If the verdict changes durable direction, update `ROADMAP.md` and `HANDOFF.md` to restate the validation note's verdict. Do not introduce a decision absent from the validation note.

- [ ] **Step 4: Run markdown diff check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 5: Commit final validation result**

Run:

```bash
git add docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md ROADMAP.md HANDOFF.md
git commit -m "docs: record phase 20.5 validation verdict"
```

Expected: commit succeeds. If ROADMAP/HANDOFF were unchanged, Git stages only the validation note.

## Task 6: Open Review PR and Stop

**Files:**
- No file changes beyond committed docs.

- [ ] **Step 1: Inspect final status**

Run:

```bash
git status --short
git log --oneline -5
git diff --stat main...HEAD
```

Expected:

- Working tree clean.
- Diff includes the approved spec, plan, validation note, and optional ROADMAP/HANDOFF updates only.

- [ ] **Step 2: Push branch and open PR**

Run:

```bash
git push -u origin docs/phase-20-5-validation-spec
```

Open a PR with a title that does not mention external repositories:

```text
docs: validate phase 20 exit gate
```

PR body should include:

- spec path;
- validation note path;
- exit verdict;
- recommended next slice;
- verification (`git diff --check`);
- statement that no product code changed.

- [ ] **Step 3: Stop for user review/merge**

Do not merge locally. Wait for user review/merge confirmation before cleanup or release decisions.
