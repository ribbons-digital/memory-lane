# Hook Debug Doctor Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only `memory-lane doctor` fields that report hook debug log path, existence, size, mtime, and current env debug state.

**Architecture:** Extend `MemoryEngine.doctor()` with a private filesystem-only helper that uses the existing hook debug log helper. Keep behavior read-only and add docs for support usage.

**Tech Stack:** TypeScript, Node.js `fs`, Node test runner, pnpm workspace.

---

## File Structure

- Modify `packages/core/src/engine.ts`: add hook debug doctor helper and merge fields into `doctor()`.
- Modify `packages/core/src/types.ts`: add optional test-only config field if needed for injectable hook debug log path.
- Modify `packages/core/test/engine.test.ts`: add doctor tests for missing/existing/current-env/directory/read-only cases.
- Modify `README.md`: document hook debug doctor fields.
- Modify `skills/memory-lane/SKILL.md`: agent guidance for reading doctor hook debug diagnostics.

---

### Task 1: Core doctor diagnostics

- [ ] Add failing tests in `packages/core/test/engine.test.ts` for missing log, existing log, current env debug flag, directory-at-log-path warning, and no creation of missing log directory/file.
- [ ] Run targeted doctor tests and verify failure.
- [ ] Implement helper in `packages/core/src/engine.ts` using `defaultHookDebugLogPath()` and `hookDebugEnabled()`.
- [ ] Add a test-only injectable `hookDebugLogPath?: string` to `MemoryEngineConfig` if needed so tests avoid the real home path.
- [ ] Run targeted core tests and all core tests.
- [ ] Commit with `feat(core): report hook debug log in doctor`.

### Task 2: Documentation

- [ ] Update `README.md` to say `doctor` reports hook debug log path/existence/size/mtime and remains read-only.
- [ ] Update `skills/memory-lane/SKILL.md` to tell agents to use doctor hook debug fields for support checks without reading raw log contents unless asked.
- [ ] Run `rg -n "hookDebug|hooks-log.jsonl|doctor" README.md skills/memory-lane/SKILL.md`.
- [ ] Commit with `docs: explain hook debug doctor fields`.

### Task 3: Final verification

- [ ] Run `pnpm build`.
- [ ] Run `pnpm test`.
- [ ] Manual smoke: run `memory-lane doctor` with temp storage/config and inspect hook debug fields.
- [ ] Confirm worktree clean.

---

## Self-Review

- Covers all spec fields and read-only behavior.
- Keeps CLI log viewer, log rotation, configurable production path, and hook config inspection out of scope.
