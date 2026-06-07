# Autosave Meta-Prompt Filter

## Status

Approved for implementation.

## Context

Memory Lane lifecycle hooks infer durable memories from the last user message on turn stop. Current filtering already skips questions, secrets, and obvious transient imperatives such as “Fix the bug in this repo.”

A live memory showed a quality issue:

```text
Task: Code quality/docs quality review for Task 4 only. Do not modify files.
```

This is an operational reviewer/subagent instruction, not durable user or project knowledge. If saved automatically, such prompts add noise to Memory Lane and to the Obsidian mirror.

## Goal

Prevent turn-stop autosave from saving meta task prompts, reviewer prompts, and subagent handoff instructions as memories.

## Non-Goals

- Do not change explicit memory requests such as `Remember that ...`.
- Do not change post-tool-use summarization.
- Do not add LLM classification.
- Do not add manual cleanup/audit commands.
- Do not modify existing stored memories.

## Behavior

`extractStopCandidates()` should return no candidates for non-explicit messages that are primarily operational meta prompts, including patterns like:

- `Task: Code quality/docs quality review for Task 4 only. Do not modify files.`
- `Review commit abc123 and report APPROVED or CHANGES_REQUESTED.`
- `Report status as DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED.`
- `Implement plan Task 2 only...`
- prompts dominated by instructions to a reviewer/subagent, especially with phrases such as `Do not modify files`, `Report APPROVED or CHANGES_REQUESTED`, or `Review commit`.

These messages should be filtered before candidate classification so they are neither saved nor queued pending.

## Preserved Behavior

The filter must not suppress:

- explicit memory requests: `Remember that I prefer concise implementation plans`;
- project facts: `This repo uses pnpm for package management.`;
- project conventions: `In this repo, use pnpm instead of npm.`;
- normal user-authored durable preferences or project facts.

If an explicit memory request contains text that looks operational, the explicit request remains authoritative. Example: `Remember that reviewer agents must not modify files` should still produce a memory candidate.

## Architecture

Add a local helper in:

```text
packages/lifecycle/src/candidates.ts
```

Suggested shape:

```ts
function isMetaTaskPrompt(text: string): boolean
```

Call it only on non-explicit user messages inside `extractStopCandidates()`, after secret/question checks and before suggestion/default candidate extraction.

Keep the implementation deterministic and regex-based.

## Testing

Add lifecycle tests in:

```text
packages/lifecycle/test/candidates.test.ts
```

Required cases:

1. Reviewer task prompt with `Task:` and `Do not modify files` produces no candidates.
2. Commit review prompt with `APPROVED or CHANGES_REQUESTED` produces no candidates.
3. Subagent implementation handoff with `Implement plan Task 2 only` and `Report status as DONE...` produces no candidates.
4. Explicit memory request about reviewer behavior still produces one approved candidate.
5. Existing project fact/preference tests continue to pass.

## Documentation

Update:

- `README.md`
- `skills/memory-lane/SKILL.md`

Docs should explain that lifecycle autosave intentionally filters transient reviewer/subagent/task prompts and that explicit memory requests remain the way to save durable workflow rules.

## Open Questions

None for this slice.
