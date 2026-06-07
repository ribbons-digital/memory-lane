# Autosave Meta-Prompt Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent turn-stop autosave from saving transient reviewer/subagent/task prompts as memories.

**Architecture:** Add a deterministic regex-based meta-prompt filter in lifecycle candidate extraction. Apply it only to non-explicit user messages so explicit memory requests remain authoritative.

**Tech Stack:** TypeScript, Node test runner, pnpm workspace.

---

## File Structure

- Modify `packages/lifecycle/src/candidates.ts`: add `isMetaTaskPrompt()` and call it in `extractStopCandidates()`.
- Modify `packages/lifecycle/test/candidates.test.ts`: add tests for reviewer/task/subagent prompts and explicit memory preservation.
- Modify `README.md`: document autosave filters for transient meta prompts.
- Modify `skills/memory-lane/SKILL.md`: agent guidance around explicit memory requests vs transient prompts.

---

### Task 1: Lifecycle filter

- [ ] Add failing tests for:
  - `Task: Code quality/docs quality review for Task 4 only. Do not modify files.` → no candidates.
  - `Review commit abc123 and report APPROVED or CHANGES_REQUESTED.` → no candidates.
  - `Implement plan Task 2 only... Report status as DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED.` → no candidates.
  - `Remember that reviewer agents must not modify files` → one approved candidate.
- [ ] Run `pnpm --filter @memory-lane/lifecycle test` and verify failure.
- [ ] Implement `isMetaTaskPrompt(text)` in `packages/lifecycle/src/candidates.ts`.
- [ ] Call it only after explicit memory request handling, so explicit requests still save.
- [ ] Run lifecycle tests.
- [ ] Commit with `feat(lifecycle): filter autosave meta prompts`.

### Task 2: Documentation

- [ ] Update `README.md` to explain hook autosave filters transient reviewer/subagent/task prompts and explicit memory requests remain supported.
- [ ] Update `skills/memory-lane/SKILL.md` with the same agent guidance.
- [ ] Run `rg -n "autosave|meta prompt|reviewer|subagent|explicit memory" README.md skills/memory-lane/SKILL.md`.
- [ ] Commit with `docs: explain autosave meta-prompt filtering`.

### Task 3: Final verification

- [ ] Run `pnpm build`.
- [ ] Run `pnpm test`.
- [ ] Manual smoke using lifecycle tests or CLI hook with a reviewer prompt to confirm no save occurs.
- [ ] Confirm worktree clean.

---

## Self-Review

- Keeps post-tool-use and existing memories out of scope.
- Applies filter only to non-explicit messages.
- Uses deterministic local regex rules only.
