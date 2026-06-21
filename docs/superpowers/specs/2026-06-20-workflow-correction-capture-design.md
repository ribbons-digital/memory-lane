# Phase 19 Slice 1 Design: Review-First Workflow Correction Capture

## Status

Draft for review.

## Background

Memory Lane now has the foundations needed for safer learning-oriented automation:

- review/dashboard controls for pending memories,
- freshness and continuity inspection,
- operating agreement discovery,
- review-first checkpoint capture,
- project/global preference layering, and
- text-free preference diagnostics.

The next roadmap step is harness-neutral learning. The first useful learning target is not broad background inference; it is narrow correction capture when the user explicitly points out that an agent violated an established workflow or operating agreement.

Example trigger: “you forgot our PR-protected workflow.”

This kind of correction is high-value continuity. If captured as a pending Memory Lane candidate, future sessions can review and approve it into an operating agreement or procedure memory. It should remain review-first and should not silently rewrite approved behavior.

## Problem

Agents can violate project-specific workflow agreements, such as:

- merging locally instead of opening a PR,
- starting implementation before spec approval,
- deleting a branch/worktree before the user confirms merge,
- skipping verification before claiming completion,
- proceeding to the next roadmap phase without an explicit go-ahead.

Today, Memory Lane may already contain approved operating agreements describing these rules, but when a user corrects a violation in-session, there is no dedicated lifecycle path to suggest a durable correction/procedure candidate. The user must manually save the correction or rely on later summaries.

## Goals

1. Add a narrow, deterministic correction-candidate path for explicit user corrections about workflow/process violations.
2. Save detected corrections as pending, project-scoped candidates by default.
3. Keep capture harness-neutral in `@memory-lane/lifecycle`; adapters should only pass bounded recent turn context they already have.
4. Add non-breaking learning `MemoryKind` support needed for the first slice, especially `correction` and `procedure`.
5. Surface correction candidates through existing review, status, continuity, MCP, and mirror/import paths without adding new commands or tools.
6. Avoid raw transcript, raw tool output, secrets, harness-internal markers, and long conversation dumps in saved memory text.
7. Preserve existing explicit memory-save semantics: if the user directly asks to remember something, existing explicit save/suggest paths remain authoritative.

## Non-goals

- No automatic approval of correction memories.
- No broad implicit preference learning.
- No LLM classifier in this slice.
- No new CLI commands.
- No new MCP tools.
- No new lifecycle events.
- No rewrite, rescope, supersede, or deletion of existing memories.
- No recall ranking or injection behavior change beyond existing visibility of newly approved memories after review.
- No native skill/rule export for Pi, Claude, Codex, Cursor, or Hermes.
- No general failed-tool learning; that remains a later Phase 19 slice.
- No automatic detection from assistant-only statements.

## Domain language

### Correction candidate

A pending project-scoped memory suggested from an explicit user correction that says an agent violated, forgot, skipped, or ignored an expected workflow, operating agreement, procedure, review gate, or project rule.

Avoid: approved correction, automatic rule update, transcript summary.

### Procedure memory

A durable memory describing a repeatable workflow or process, typically with when-to-use conditions, ordered steps, pitfalls, and verification. This slice may add the kind, but it does not require structured procedure fields or native skill export.

Avoid: harness-native skill, automatic checklist enforcement.

### Workflow violation

A user-identified mismatch between an agent action and an expected workflow. The user is the authority; the system should not infer violations from arbitrary failures without a user correction in this slice.

Avoid: tool failure, test failure, style preference.

## Proposed behavior

### Trigger surface

Use `handleStop` first.

Inputs already available there:

- `lastUserMessage`
- `lastAssistantMessage`
- `cwd`
- optional `sessionId` / `turnId`

Adapters already passing bounded Stop context can benefit without adding a new lifecycle event. A later slice may consider UserPromptSubmit capture, but this slice should avoid prompt-time writes because prompt-time context injection and save behavior are already busy surfaces.

### Detection approach

Add a pure helper in lifecycle, for example `extractCorrectionCandidatesFromStop(input)`.

Detection should require all of:

1. A user-authored correction signal in `lastUserMessage`.
2. A workflow/process target, not a generic factual correction.
3. Enough text to create a compact standalone candidate without copying the whole conversation.
4. No likely secret in the candidate text.
5. No meta-task wrapper / acceptance-finalization pollution.

High-confidence correction signal examples:

- “you forgot our PR-protected workflow”
- “you violated the PR workflow”
- “you skipped the review gate”
- “you should not merge directly to main”
- “don’t start implementation before I approve the spec”
- “remember, wait for me to merge the PR before cleanup”
- “we already agreed not to proceed to the next phase without approval”

Workflow/process target examples:

- PR / pull request / merge / main / branch / worktree cleanup
- spec / design / plan / approval / review gate
- verification / tests / build / diff-check before completion
- roadmap phase / next item / release process
- operating agreement / workflow / process / procedure / guardrail

Negative examples:

- “you got the package name wrong”
- “that date is incorrect”
- “the test failed”
- “try again”
- “I prefer blue buttons”
- “remember that I like concise answers” (explicit preference save path, not correction capture)
- delegated subagent task wrappers
- acceptance-finalization prompts

### Candidate text

Saved text should be compact and normalized. It should not include ids, command output, raw tool output, or long quotes.

Suggested form:

```text
Workflow correction: When working in this project, follow the PR-protected workflow: open a PR and wait for the user to merge before syncing main, deleting branches/worktrees, or starting the next item.
```

For less-specific corrections, use a conservative text that preserves user intent without inventing details:

```text
Workflow correction: The user corrected the agent for skipping an agreed review gate; future work should pause for explicit user approval before continuing past that gate.
```

### Candidate fields

Default fields:

- `category`: `project`
- `scopeType`: `project`
- `kind`: `correction`
- `status`: `pending`
- `source`: `agent-suggested`
- `provenance.adapter`: current adapter
- `provenance.lifecycleEvent`: `turn_stop`

If the correction explicitly describes a repeatable ordered workflow, `kind: "procedure"` may be considered later. For this first slice, prefer `correction` unless the user literally asks to save a procedure.

### Dedup/debounce

Correction capture should deduplicate against visible pending and approved project correction/procedure/workflow-rule memories using normalized keys.

Minimum dedup:

- Normalize candidate text with existing memory normalization.
- Skip if an existing visible pending/approved project memory with kind `correction`, `procedure`, or `workflow_rule` has the same normalized correction key.
- Skip same-turn duplicates if another explicit/user-suggested candidate in the same Stop result has the same key.

Do not semantic-dedupe in this slice.

### Review surfacing

Existing review/list surfaces should show pending correction candidates automatically because they are normal pending memories.

Add lightweight labeling where relevant:

- CLI `memory-lane review` can label pending `kind: "correction"` as a correction candidate.
- MCP `memory_review` can include structured text-free group metadata by existing kind/source/provenance grouping.
- Continuity read model should count/surface pending correction candidates under pending continuity if it already includes pending project candidates by kind. If not, add text-free metadata or bounded previews consistent with current continuity behavior.

### Operating agreements

Approved correction/procedure memories should become eligible for operating-agreement discovery if they are workflow-like.

First-slice rule:

- `kind: "procedure"` and `kind: "correction"` may be treated as workflow-like only when text also matches workflow/process patterns.
- Do not let generic corrections crowd out explicit `workflow_rule` primaries.
- Existing primary selection priority should continue to prefer explicit `workflow_rule` records over heuristic corrections/procedures.

### Storage and schema compatibility

Add non-breaking `MemoryKind` values:

- `correction`
- `procedure`

Potentially defer other roadmap kinds (`failure`, `insight`, `tool_quirk`, `convention`) unless implementation naturally touches the full union and docs. Smaller is preferred.

Update validation and surfaces that enumerate kinds:

- core types/storage validation
- CLI argument validation/help where kind filters are documented
- MCP schemas/types if kind enum is exposed
- Obsidian mirror/import validation
- tests and docs

Historical records remain valid.

## Safety and privacy

- Do not save raw `lastAssistantMessage` or full `lastUserMessage`.
- Do not save likely secrets.
- Do not save raw tool input/output.
- Do not save harness-internal wrappers or subagent prompts.
- Keep candidates pending by default.
- Keep candidate length bounded.
- Do not include memory ids or review instructions inside saved text.

## Testing requirements

Core/type/schema tests:

- `correction` and `procedure` are accepted `MemoryKind` values.
- Existing older records without these kinds still load.
- Invalid kinds are still rejected.

Lifecycle tests:

- explicit PR workflow correction creates one pending project `correction` candidate on Stop.
- correction candidate has `agent-suggested` source and `turn_stop` provenance.
- generic factual correction does not create a candidate.
- explicit preference request does not get duplicated by correction capture.
- acceptance-finalization/subagent wrapper text is ignored.
- likely-secret correction text is discarded.
- duplicate pending/approved correction/workflow-rule suppresses another candidate.
- same-turn explicit save/suggest candidate suppresses duplicate correction capture.

CLI/MCP/review tests:

- `memory-lane review` labels or at least lists pending correction candidates without special commands.
- `memory_review` includes correction candidates in existing grouped output.
- No review/status/diagnostic surface leaks raw discarded text beyond existing review memory bodies for pending records.

Operating agreement/continuity tests:

- approved workflow-like correction/procedure can be related or selected consistently with existing operating-agreement priority.
- explicit `workflow_rule` remains preferred over correction/procedure candidates.
- pending correction candidate appears in continuity pending state if current continuity read model includes pending project candidates.

Verification:

- `pnpm build`
- `pnpm test`
- `git diff --check`

## Documentation requirements

Update:

- `CONTEXT.md` domain language for correction candidate and procedure memory.
- `ROADMAP.md` Phase 19 status/slice notes.
- `README.md` review-first learning section or lifecycle capture section.
- `HANDOFF.md` current state and next steps.

Docs must emphasize:

- pending-by-default,
- review-first,
- no new commands/tools,
- no broad background learning,
- no transcript/tool-output capture,
- user correction as the authority.

## Open questions for review

1. Should this slice add only `correction` and `procedure`, or add the whole planned Phase 19 kind union now?
   - Recommendation: add only `correction` and `procedure` to keep the slice tight.
2. Should correction detection run on UserPromptSubmit as well as Stop?
   - Recommendation: Stop only for first slice, to avoid prompt-time writes and keep behavior easier to reason about.
3. Should approved `correction` memories participate in automatic context injection as preference-like memories?
   - Recommendation: no special preference-like treatment in this slice; rely on operating-agreement discovery and normal project memory selection after approval.
4. Should saved correction text include the exact user quote?
   - Recommendation: no; save normalized compact correction language to avoid transcript leakage.
