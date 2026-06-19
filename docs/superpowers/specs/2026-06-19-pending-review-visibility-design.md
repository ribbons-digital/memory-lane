# Pending Review Visibility Design

## Status

Draft — Slice C of cross-harness continuity explainability work.

## Context

Manual Sitewright testing in Codex Desktop showed that Memory Lane can create pending review items in the background while the user works, but the user may not see any visible indication inside the harness. The pending items are visible later through `memory-lane review`, but review-first behavior is only trustworthy if the user knows there is something to review.

Current write-hook outputs are intentionally quiet by default:

- `Stop` and `PostToolUse` return `{}` unless hook debug is enabled.
- Debug mode can emit counts such as `saved 1, skipped 0, discarded 0`, but normal users do not see this.
- Claude/Codex explicit session-summary paths may emit a save count, but the message does not consistently guide the user to the review queue.

This slice adds a compact, text-free notice when a lifecycle hook saves pending memories. It does not approve memories, expose memory bodies, or change what gets saved.

## Goals

1. Make review-first pending suggestions discoverable in Codex/Claude hook environments.
2. Emit a compact notice only when a hook actually saves one or more pending memories.
3. Tell the user exactly how to review: `memory-lane review`.
4. Keep notices privacy-safe: no memory text, transcript snippets, tool output, or prompt bodies.
5. Preserve quiet no-op behavior when nothing pending was saved.
6. Keep implementation harness-neutral where possible by using shared output helpers or shared lifecycle metadata.

## Non-goals

- Do not change candidate extraction or save heuristics.
- Do not change pending vs approved decisions.
- Do not add automatic approval/rejection or cleanup.
- Do not add duplicate/debounce behavior.
- Do not add new config flags.
- Do not expose pending memory text in hook output.
- Do not change prompt/session-start recall selection or ranking.
- Do not require MCP clients to receive lifecycle notices; MCP remains explicit tools only.

## Proposed user experience

When a write hook saves pending memory candidates, the harness receives a visible system message:

```json
{
  "systemMessage": "Memory Lane: suggested 1 pending memory for review. Run `memory-lane review` to approve or reject it."
}
```

Plural form:

```json
{
  "systemMessage": "Memory Lane: suggested 3 pending memories for review. Run `memory-lane review` to approve or reject them."
}
```

If a hook saves no pending memories, normal behavior remains quiet:

```json
{}
```

If debug mode is enabled and no pending memories are saved, existing debug count output can remain:

```json
{
  "systemMessage": "Memory Lane: saved 0, skipped 0, discarded 0."
}
```

If debug mode is enabled and pending memories are saved, prefer the pending-review notice over generic counts because it is more actionable.

## Scope by lifecycle event

In scope:

- Claude `Stop`
- Claude `PostToolUse`
- Claude `SessionEnd` summary saves
- Codex `Stop`
- Codex `PostToolUse`
- Codex supported `Stop` + explicit session-summary intent path
- Codex legacy/manual `session-end` command behavior only insofar as it already uses shared save output helpers

Out of scope:

- `SessionStart` and `UserPromptSubmit`, because those inject context rather than save review items.
- MCP explicit tools, because they return direct tool results and do not run automatic lifecycle hooks.
- pi extension behavior in this slice unless it already consumes the shared lifecycle adapter output helpers. Pi-specific review visibility can be a follow-up if its extension has different output constraints.

## Data model

No persistent data model changes are required.

The notice can be derived from existing `LifecycleResult.saved` entries:

- Count entries where `status === "saved"` and `memory.status === "pending"`.
- Ignore skipped saves.
- Ignore approved saves for this slice, because the user does not need to approve them.

## Output behavior

Add a helper, likely in each adapter's `outputs.ts` or shared through lifecycle if practical:

```ts
function pendingReviewCount(result: LifecycleResult): number {
  return result.saved.filter((saveResult) => saveResult.status === "saved" && saveResult.memory.status === "pending").length
}
```

Then `lifecycleNoopOutput(result, debug)` should return:

1. Pending-review notice if `pendingReviewCount(result) > 0`.
2. Existing debug count message if debug is enabled.
3. `{}` otherwise.

The message must include:

- `Memory Lane:` prefix through existing `systemMessage` helpers.
- pending memory count.
- `memory-lane review` command.
- approve/reject wording.

The message must not include:

- memory ids;
- memory text;
- prompt text;
- transcript text;
- tool input/output.

## Interaction with explicit session summaries

Codex supported `Stop` + explicit summary intent currently emits a generic save count after saving pending `session_summary` memories. This should be aligned with the same pending-review notice when the saved summary is pending.

If summarization is disabled or provider configuration is missing, keep existing explanatory no-save messages.

## Acceptance criteria

1. Claude and Codex write-hook outputs emit a visible pending-review system message when one or more pending memories are saved.
2. Write hooks remain quiet by default when no pending memories are saved.
3. Debug count output still works for no-pending cases.
4. The notice contains the review command and approve/reject guidance.
5. The notice is text-free: no memory body, transcript, prompt, tool input/output, or memory ids.
6. Tests cover Codex Stop, Codex PostToolUse or equivalent shared output helper, Claude Stop, and at least one explicit session-summary save path.
7. README documents that write hooks may show a compact review reminder when pending memories are suggested.
8. No candidate extraction, selection, ranking, or save decision behavior changes are introduced.

## Risks and mitigations

- **Risk:** Notices become noisy if hooks save too eagerly.
  - **Mitigation:** Emit only when pending memories are actually saved; do not emit when candidates are skipped/discarded.

- **Risk:** Desktop apps render `systemMessage` differently.
  - **Mitigation:** Use existing adapter output shape already used for debug/no-op messages.

- **Risk:** Users might think Memory Lane approved the memory.
  - **Mitigation:** Use “suggested pending memory for review” and “approve or reject” wording.

- **Risk:** Notices expose sensitive content.
  - **Mitigation:** Count-only, command-only notice; tests assert body/id absence.

## Follow-up slices

1. Project-first SessionStart selection and budgeting.
2. Duplicate/debounce logic for repeated pending checkpoint candidates.
3. Optional dashboard/status hint for global memories that look project-specific.
4. Pi-specific review visibility if the extension needs separate UX beyond shared lifecycle outputs.
