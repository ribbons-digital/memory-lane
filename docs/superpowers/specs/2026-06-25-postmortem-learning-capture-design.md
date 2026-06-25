# Phase 21 Learning Follow-up — Postmortem Learning Capture Design

## Status

Implemented on feature branch `docs/v0-2-29-handoff-and-learning-design`; pending final verification and PR review.

## Background

Memory Lane already has review-first learning foundations:

- `correction` and `procedure` memory kinds exist.
- Explicit user workflow corrections can become pending project-scoped `correction` candidates from bounded Stop context.
- Tool-outcome recovery can produce conservative pending `procedure` candidates, such as recovering from `npm test` to `pnpm test`.
- Pending candidates flow through existing review, list, continuity, and MCP review surfaces.
- Recent Pi dogfooding exposed a useful pattern: high-confidence debugging postmortems and explicit user challenge turns often contain durable lessons that should become pending Memory Lane candidates, but today they require manual `memory_suggest`.

The next learning slice should capture those lessons without turning Memory Lane into silent background learning or a transcript ingester.

## Problem

Some of the most valuable project learning appears after debugging incidents:

- an installed harness artifact behaves differently from repo-local code,
- an adapter return shape violates host API expectations,
- upgrade reconfiguration uses stale in-memory code after replacing the binary,
- a user challenges an agent assumption and the agent identifies a durable prevention rule.

These moments often include enough information to form a compact procedure/correction memory:

- what failed,
- why it failed,
- what future agents should do,
- how the fix or diagnosis was verified.

Today, Memory Lane can capture narrow explicit workflow corrections and some tool-recovery procedures, but it does not detect assistant-authored debugging postmortems unless the user explicitly asks to save them.

## Goals

1. Add review-first capture for high-confidence debugging postmortems and explicit user challenge/correction turns.
2. Allow loose natural-language detection so users and agents do not need fixed section headings.
3. Require strict evidence gates before saving any candidate.
4. Save only compact pending project-scoped `correction` or `procedure` candidates.
5. Keep the feature harness-neutral in `@memory-lane/lifecycle`; adapters should only pass bounded lifecycle context they already have.
6. Reuse existing review/list/continuity/MCP surfaces; do not add commands or tools.
7. Deduplicate against visible project `correction`, `procedure`, and `workflow_rule` memories.
8. Preserve Memory Lane's core promise: no silent durable rule mutation, no broad transcript capture, no auto-approval.

## Non-goals

- No LLM classifier in this slice.
- No auto-approved memories.
- No raw transcript or raw tool-output storage.
- No recall ranking or injection behavior changes.
- No native skill/rule export.
- No persisted workstream ids.
- No automatic consolidation or replacement of existing memories.
- No requirement that agents use exact headings such as `Root cause`, `Prevention`, or `Verified`.
- No attempt to learn from every failed command or every reflective assistant statement.

## Design decision

Use **loose detection with strict capture**.

Detection should accept natural wording such as:

- “root cause was ...”
- “the issue turned out to be ...”
- “this happened because ...”
- “the fix was ...”
- “next time we should ...”
- “avoid doing ...”
- “future agents should ...”
- “we verified by ...”

But capture should require multiple evidence categories before queuing a candidate. The system should ignore ambiguous lessons rather than queue noisy memories.

This balances the user's preference for natural workflows with the project requirement to avoid context pollution.

## Trigger surface

Use the existing `handleStop` lifecycle path first.

Relevant bounded inputs already exist or fit existing lifecycle patterns:

- `lastUserMessage`
- `lastAssistantMessage`
- `cwd`
- adapter/session/turn provenance

PostToolUse can remain focused on concrete tool recovery for this slice. The postmortem detector should operate on Stop context because postmortems usually appear in assistant/user narrative after investigation, not in a single tool result.

## Candidate sources

### 1. Explicit user challenge/correction

A user message may trigger capture when it challenges agent behavior or an assumption, for example:

- “You missed that generated adapter path again.”
- “We already learned that installed artifacts need dogfooding.”
- “Don’t rely on reviewer inspection alone for harness templates.”
- “The issue is not just Pi; future adapters need this guardrail too.”

This overlaps existing correction capture, but this slice broadens coverage from direct workflow violations to postmortem-quality challenge turns when the Stop context also contains assistant diagnosis/prevention evidence.

### 2. Assistant-authored debugging postmortem

An assistant message may trigger capture when it naturally describes a durable incident lesson:

- Symptom: what failed or regressed.
- Cause: why it failed, including mistaken assumption or missing guardrail.
- Prevention/procedure: what future agents should do.
- Verification/recovery: what evidence confirmed the fix or diagnosis, when available.

No exact headings are required, but the meanings must be present.

## Evidence gates

A candidate may be queued only when the extracted postmortem has high confidence.

Required categories:

1. **Symptom/failure** — words or phrases indicating an incident, regression, failure, crash, bug, mismatch, violation, or user correction.
2. **Cause/assumption** — phrases indicating root cause, reason, mistaken assumption, mismatch, stale behavior, missing coverage, unsupported API, wrong path, or violated host contract.
3. **Prevention/procedure** — phrases indicating future action: should, must, next time, future agents, add guardrail, add contract test, dogfood installed artifact, avoid relying on X.

Strongly preferred category:

4. **Verification/recovery** — phrases indicating verified, passed, dogfooded, smoke-tested, reproduced, fixed by, confirmed, release validated, or tests added.

Capture threshold:

- Queue when categories 1–3 are present and either:
  - category 4 is present, or
  - the user message is an explicit correction/challenge and the assistant message contains cause plus prevention.
- Ignore when only one or two categories appear.
- Ignore generic praise, generic “lesson learned,” or speculative “we might want to” without a concrete failure/cause.

## Candidate text

Saved memory text must be compact, standalone, and normalized. It should not copy full messages.

### Procedure candidate form

Use `kind: "procedure"` when the durable lesson is an action sequence or guardrail:

```text
Procedure: Dogfood generated harness adapter changes through the installed artifact before release. When: changing generated harness adapters or templates. Steps: add contract tests for generated lifecycle branches; compare generated behavior with repo-local adapters when both exist; run installed-artifact lifecycle dogfood. Pitfall: reviewer inspection or load-smoke tests can miss host API shape regressions. Verify: the installed artifact exercised the lifecycle event users trigger.
```

### Correction candidate form

Use `kind: "correction"` when the durable lesson is primarily a “do not repeat this mistake” rule:

```text
Workflow correction: The agent learned from a debugging postmortem that generated harness adapter changes must not rely on reviewer inspection alone; future work should include executable contract coverage and installed-artifact dogfood before release.
```

Selection rule:

- Prefer `procedure` when the text can name a repeatable `When`, `Steps`, `Pitfall`, and `Verify`.
- Prefer `correction` when the lesson is a project workflow guardrail without clear ordered steps.

## Safety filters

Before saving a candidate:

- Run likely-secret filtering on extracted text.
- Skip meta-task prompt pollution using existing meta-task filters.
- Skip explicit memory requests so existing explicit save/suggest behavior remains authoritative.
- Enforce a compact maximum candidate length, aligned with existing lifecycle candidate limits.
- Do not include raw command output, stack traces, screenshots, long quotes, or hidden harness internals.
- Do not save global memories from this path; default to current project scope only.

## Dedup and debounce

Reuse and extend existing learning dedup patterns.

Minimum rules:

- Compare against visible pending and approved current-project memories with kinds `correction`, `procedure`, and `workflow_rule`.
- Normalize text before comparison.
- Add topic keys for common postmortem domains where possible, for example:
  - `harness-generated-adapter-contract-tests`
  - `installed-artifact-dogfood-before-release`
  - `upgrade-reapply-fresh-installed-binary`
  - `pi-custom-message-shape`
- Skip same-turn duplicates when explicit user correction capture and assistant postmortem capture would queue the same key.
- Do not use semantic dedup in this slice.

## Proposed implementation shape

Add a small pure helper in lifecycle, for example:

```ts
extractPostmortemLearningCandidatesFromStop(input: StopInput): MemoryCandidate[]
```

It should:

1. Normalize bounded `lastUserMessage` and `lastAssistantMessage`.
2. Detect candidate windows around loose natural-language signals.
3. Score evidence categories.
4. Build at most one compact candidate per Stop event in the first slice.
5. Return `[]` when confidence is below threshold.

Integrate it into the existing Stop candidate flow after explicit memory requests and existing correction capture, then filter same-turn duplicates.

Do not add new lifecycle events, config flags, commands, or MCP tools.

## Review and continuity surfacing

Candidates are normal pending project memories, so existing surfaces should continue to work:

- `memory-lane review`
- `memory-lane review --kind correction`
- `memory-lane review --kind procedure`
- MCP `memory_review`
- `memory-lane continuity` pending continuity sections when applicable
- Obsidian mirror after pending memory write, if configured

Docs should explain that these are review-first suggestions. They are not durable operating agreements until approved.

## Examples

### Should capture: generated adapter postmortem

Input meaning:

- Symptom: Pi prompt submit crashed after upgrade.
- Cause: generated bridge returned raw string instead of Pi custom-message object.
- Prevention: generated harness adapters need contract tests for lifecycle branch return shape.
- Verification: installed Pi artifact should be dogfooded through prompt submit.

Candidate:

```text
Procedure: Verify generated harness adapter return shapes with executable contract tests and installed-artifact dogfood. When: changing generated harness adapters or templates. Steps: invoke each generated lifecycle branch with realistic fake harness inputs; assert host API return shape; compare generated behavior with repo-local adapter behavior when both exist; dogfood the installed artifact through the user-triggered lifecycle event. Pitfall: load-smoke tests and reviewer inspection can miss host API shape regressions. Verify: the installed artifact exercises the lifecycle event without crashing.
```

### Should capture: upgrade postmortem

Input meaning:

- Symptom: `memory-lane upgrade --yes` installed a fixed binary but rewrote old Pi shim.
- Cause: old in-memory process reapplied harness config after binary replacement.
- Prevention: self-upgrade should invoke freshly installed binary for reapply.
- Verification: smoke generated Pi extension after upgrade.

Candidate:

```text
Procedure: Reapply harness configuration through the freshly installed binary after self-upgrade. When: changing installer or upgrade reconfiguration behavior. Steps: replace the binary; invoke the new binary for manifest reapply; smoke the generated harness artifact. Pitfall: the old in-memory process can rewrite stale adapter templates after replacement. Verify: the generated artifact contains the new bridge behavior after upgrade.
```

### Should not capture: vague reflection

```text
This was tricky. We should be more careful next time.
```

Reason: no concrete symptom, cause, or procedure.

### Should not capture: ordinary failed command

```text
The test failed. I will fix it.
```

Reason: no durable cause/prevention; existing tool-outcome learning handles narrow recovery cases.

### Should not capture: explicit memory request

```text
Remember that this repo uses pnpm.
```

Reason: explicit save/suggest path is authoritative.

## Documentation updates

Update:

- `ROADMAP.md` Phase 21 status after design approval.
- `HANDOFF.md` current state and next steps.
- `skills/memory-lane/SKILL.md` lifecycle learning notes if implementation proceeds.

The design itself does not require README changes until implementation.

## Acceptance criteria for this design slice

The design slice is complete when:

1. The spec defines loose natural-language detection with strict evidence gates.
2. The spec distinguishes explicit user corrections from assistant postmortems.
3. The spec preserves review-first behavior and rejects auto-approval/autonomous mutation.
4. The spec identifies candidate text conventions, safety filters, dedup/debounce, and integration surfaces.
5. `ROADMAP.md` and `HANDOFF.md` point to this spec as the next implementation candidate.

## Acceptance criteria for future implementation

Future implementation is complete when:

1. Unit tests prove high-confidence assistant postmortems produce one pending project candidate.
2. Unit tests prove explicit user challenge plus assistant diagnosis/prevention can produce a candidate.
3. Unit tests prove vague reflections, ordinary failed commands, explicit memory requests, secrets, and meta-task prompts do not produce candidates.
4. Dedup tests prove candidates are skipped when equivalent pending/approved correction/procedure/workflow-rule memories exist.
5. Existing correction capture and tool-outcome procedure capture continue to pass.
6. Existing review and continuity surfaces expose the new pending candidates through normal memory paths.
7. Verification passes with focused lifecycle tests, package tests, build, full test suite, and `git diff --check`.

## Open questions for implementation planning

1. Should the first implementation cap at one candidate per Stop event, or allow one correction plus one procedure when both are clearly distinct?
2. Should postmortem topic keys be hand-authored for known domains only, or generated from extracted cause/prevention phrases?
3. Should implementation update `correction-capture.ts` or create a separate `postmortem-learning.ts` module to keep responsibilities clearer?

Recommended answers for first implementation:

1. Cap at one candidate per Stop event for noise control.
2. Start with deterministic hand-authored keys plus normalized text fallback.
3. Create a separate `postmortem-learning.ts` module and reuse shared helpers from correction/procedure capture where practical.
