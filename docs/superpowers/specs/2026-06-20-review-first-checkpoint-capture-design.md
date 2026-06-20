# Review-First Checkpoint Capture Design

## Status

Draft for review. This spec covers the remaining Phase 17 checkpoint-capture work after checkpoint candidate review labels and the unified continuity contract.

## Goal

Make Memory Lane more autonomous about continuity by detecting high-value project progress from existing lifecycle evidence, saving compact checkpoint candidates as pending memories, deduplicating repeated captures, and automatically reminding users to review them across harnesses.

The goal is not to add more explicit commands or APIs. Users should not need to remember another Memory Lane command for continuity to improve. Memory Lane should notice strong checkpoint evidence, queue it safely for review, remind the user that review is needed, and then surface approved checkpoints through the already-canonical continuity surfaces.

## Background

Phase 17 Slice 1 added deterministic checkpoint candidate labeling in CLI `memory-lane review`, CLI `review --json`, and MCP `memory_review`. The unified continuity contract then added the core continuity read model plus CLI/MCP continuity surfaces. Those pieces make pending and approved continuity state inspectable, but Memory Lane still relies mostly on users or agents explicitly saving checkpoint memories.

The current product direction is to move from a mostly explicit/manual system toward more autonomous continuity. Review-first remains the safety boundary: inferred checkpoint captures should default to `pending`, but pending records must never disappear silently. Any automatic pending write must produce a bounded, text-free reminder path so the user can approve or reject it.

## Domain terminology

`CONTEXT.md` already defines **Checkpoint candidate** as a pending Memory Lane memory that represents high-value project progress.

This slice adds a related term:

**Checkpoint capture**:
A lifecycle-driven suggestion of a compact checkpoint candidate from high-confidence project progress evidence such as a release, merged PR, verification milestone, docs sync, major fix, or roadmap decision. It writes only pending Memory Lane records, deduplicates near-duplicate events, and relies on automatic review reminders before affecting future continuity.
Avoid: approved checkpoint, automatic approval, transcript capture, explicit memory API.

## Design principles

1. **Autonomy with review**: Memory Lane should proactively suggest checkpoint candidates from strong evidence, but inferred captures must be pending until the user approves them.
2. **No silent pending queues**: If Memory Lane writes a pending checkpoint candidate, the hook response must include a compact review reminder. SessionStart/continuity surfaces should also count pending continuity candidates.
3. **Unified harness semantics**: Shared lifecycle/core code decides what counts as a checkpoint candidate. Claude Code, Codex, Pi, MCP clients, and future harnesses should get equivalent behavior through their existing transport surfaces.
4. **No new explicit API burden**: Do not add new CLI commands, MCP tools, config flags, or required user workflows in this slice. Reuse `memory-lane review`, `memory_review`, `memory-lane continuity`, and `memory_continuity`.
5. **Compact memory bodies**: Store short checkpoint summaries, not transcripts, tool outputs, command logs, or raw hook payloads.
6. **Conservative evidence only**: Prefer strong lifecycle evidence and explicit user progress statements over broad LLM inference.
7. **Deduplicate by event**: Multiple harnesses or repeated hooks should not queue the same release/merge/checkpoint repeatedly.

## In scope

### 1. Lifecycle checkpoint capture

Add a shared lifecycle helper that turns high-confidence evidence into `MemoryCandidate` objects with:

- `category: "project"`
- `scopeType: "project"`
- `kind: "project_checkpoint"`
- `decision: "save-pending"` for inferred captures
- `source: "agent-suggested"` unless the user explicitly asked Memory Lane to remember/save the checkpoint
- lifecycle provenance from the adapter/event

Capture should run from existing lifecycle paths where bounded evidence already exists:

- `Stop`: latest user/assistant messages can show explicit progress statements such as “PR #19 merged” or “released v0.2.11”.
- `PostToolUse`: tool outcomes may show commands that strongly imply a checkpoint, such as successful `gh release create`, `gh pr merge`, `git tag`, or equivalent safe shell command results.

The first implementation should stay deterministic and heuristic-based. No LLM classifier is needed.

### 2. Candidate categories

Capture these checkpoint classes when evidence is strong:

- **Release**: successful release/tag/publish evidence, e.g. `released v0.2.11`, `gh release create v0.2.11` success, or a successful tag workflow signal.
- **Merge**: merged PR evidence, e.g. `PR #19 merged`, `gh pr merge 19` success, or a merge commit/PR URL in a successful command result.
- **Verification**: explicit verification milestone, e.g. build/test/diff-check all passed for a named slice.
- **Docs sync / roadmap decision**: explicit durable docs or roadmap decision statements.
- **Major fix**: explicit blocker/critical fix statements.

Avoid capturing ambiguous plans, wishes, questions, future-tense reminders, or generic command text without success evidence.

### 3. Pending review reminders

Re-use and strengthen the existing pending-review notice path:

- When a lifecycle write saves one or more pending checkpoint candidates, adapters should emit the existing count-only review reminder.
- The reminder must not include memory text, raw prompts, transcripts, command output, or tool payloads.
- The reminder should be equivalent across Claude Code, Codex, Pi, and future harnesses where their hook transport supports a system message/additional context.
- MCP clients do not run lifecycle hooks, so they should see the same pending state through existing `memory_review`, `memory_status`, and `memory_continuity` surfaces.

This is required because the product goal is enhanced continuity without users manually discovering explicit review APIs.

### 4. Dedup/debounce

Before saving an inferred checkpoint candidate, lifecycle/core should check visible pending and approved memories for likely duplicates in the current project scope.

Dedup should be deterministic and conservative:

- derive a stable checkpoint key from checkpoint class plus event identifier when available:
  - release version, e.g. `release:v0.2.11`
  - PR number, e.g. `merge:pr-19`
  - normalized roadmap/verification/fix phrase when no stronger id exists
- skip saving if a pending or approved `project_checkpoint` with the same key or highly similar compact text already exists in the current project scope
- keep dedup local to the project plus visible globals; do not scan unrelated project memories as candidates for suppression

The first slice may store the key only implicitly in text if adding metadata fields is too broad. The plan should prefer a helper function that can later evolve to explicit metadata without changing user-facing behavior.

### 5. Continuity/read-model integration

Do not add a new continuity API. Existing continuity surfaces should already expose pending continuity candidates. This slice should verify and, if needed, tighten behavior so captured pending `project_checkpoint` records appear as pending continuity candidates in:

- `memory-lane continuity`
- `memory-lane continuity --json`
- MCP `memory_continuity({ projectPath })`

The read model may include bounded previews according to existing preview safety rules, but status/doctor metadata surfaces should remain text-free.

### 6. Documentation alignment

Update documentation to explain:

- Memory Lane can automatically suggest pending checkpoint candidates from strong lifecycle evidence.
- Pending is a review safety boundary, not a silent sink.
- Users are reminded automatically when pending candidates are saved.
- Approval still determines what becomes durable continuity.
- No new CLI/MCP commands are required.

## Out of scope

- Automatic approval of checkpoint memories.
- Broad transcript summarization or raw transcript capture.
- New CLI commands, MCP tools, or config flags.
- LLM-based checkpoint classification.
- Workstream/thread IDs.
- Recall ranking changes.
- Phase 18 preference layering.
- Phase 19 correction/procedure learning.
- Time-aware staleness/consolidation from Phase 20.
- Native harness skill/rule exports.

## User-facing behavior

### Successful inferred capture

When a supported lifecycle event strongly indicates a checkpoint, Memory Lane queues a pending memory and emits a reminder. Example hook-visible message:

```text
Memory Lane: suggested 1 pending memory for review. Run memory-lane review to approve or reject it.
```

The exact text can keep the existing `renderPendingReviewNotice` wording.

### Duplicate capture

If another harness sees the same event, Memory Lane skips the duplicate and stays quiet unless debug logging is enabled. It should not nag the user about duplicates it did not save.

### Continuity inspection

Before approval, `memory-lane continuity` and MCP `memory_continuity` should show pending checkpoint candidates as pending continuity review items. After approval, they become approved project continuity state.

## Testing requirements

Add tests for:

1. Stop lifecycle captures explicit release checkpoint statements as pending `project_checkpoint` memories.
2. Stop lifecycle captures explicit merged PR statements as pending `project_checkpoint` memories.
3. Stop lifecycle does not capture future-tense or ambiguous checkpoint-like statements.
4. PostToolUse captures successful release/merge command evidence when tool response indicates success.
5. PostToolUse does not capture failed command evidence.
6. Captured checkpoint candidates use project scope, `project_checkpoint` kind, `agent-suggested` source, and lifecycle provenance.
7. Inferred checkpoint captures are pending by default.
8. Explicit “remember/save this checkpoint” behavior remains approved only where existing explicit-save semantics already allow it.
9. Duplicate pending checkpoint evidence is skipped.
10. Duplicate approved checkpoint evidence is skipped.
11. Pending review notices appear when checkpoint candidates are saved in Claude/Codex adapter outputs.
12. Pi adapter output behavior remains equivalent if it renders lifecycle results directly.
13. `memory-lane continuity --json` includes pending checkpoint candidates created by the capture path.
14. MCP `memory_continuity` includes the same pending checkpoint state when `projectPath` is provided.
15. Existing review labeling still labels captured candidates.

## Success criteria

Phase 17 is complete when Memory Lane can autonomously queue compact, deduplicated, review-first checkpoint candidates from strong progress evidence across existing lifecycle paths; users are automatically reminded when pending checkpoint candidates exist; and canonical continuity surfaces expose those candidates consistently across CLI and MCP without adding new explicit APIs or approving anything silently.
