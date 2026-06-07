# Hook Debug Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist privacy-safe hook debug records to `~/.memory-lane/hooks-log.jsonl` when `MEMORY_LANE_HOOK_DEBUG=1|true`.

**Architecture:** Add a core helper for debug flag detection and JSONL append, then instrument Codex and Claude adapter runners to write one record per hook invocation. Keep hook stdout unchanged and swallow logging failures.

**Tech Stack:** TypeScript, Node.js `fs/os/path`, Node test runner, pnpm workspace.

---

## File Structure

- Create `packages/core/src/hook-debug-log.ts`: shared safe JSONL logging helper.
- Modify `packages/core/src/index.ts`: export helper.
- Create `packages/core/test/hook-debug-log.test.ts`: helper tests.
- Modify `packages/codex-adapter/src/runner.ts`: write Codex hook debug records.
- Modify `packages/codex-adapter/test/runner.test.ts`: Codex adapter log tests.
- Modify `packages/claude-adapter/src/runner.ts`: write Claude hook debug records.
- Modify `packages/claude-adapter/test/runner.test.ts`: Claude adapter log tests.
- Modify docs: `README.md`, `examples/harness-integrations/codex-cli.md`, `examples/harness-integrations/claude-code.md`, `skills/memory-lane/SKILL.md`.

---

### Task 1: Core hook debug log helper

- [ ] Add failing tests in `packages/core/test/hook-debug-log.test.ts` for `hookDebugEnabled`, default path suffix, appending one JSONL record, and swallowed write errors.
- [ ] Run `pnpm --filter @memory-lane/core test -- --test-name-pattern "hook debug"` and verify failure.
- [ ] Create `packages/core/src/hook-debug-log.ts` with:
  - `HookDebugLogRecord` type allowing safe metadata fields only.
  - `hookDebugEnabled(env = process.env)` accepting `1` or `true`.
  - `defaultHookDebugLogPath()` returning `path.join(os.homedir(), ".memory-lane", "hooks-log.jsonl")`.
  - `appendHookDebugLog(record, options?)` creating parent directory and appending one JSON line, swallowing errors.
- [ ] Export from `packages/core/src/index.ts`.
- [ ] Run targeted core tests and all core tests.
- [ ] Commit with `feat(core): add hook debug log helper`.

### Task 2: Instrument Codex adapter

- [ ] Add failing tests in `packages/codex-adapter/test/runner.test.ts` for debug-enabled log write, no-op invalid JSON log, error log, debug-disabled no log, and absence of prompt/tool/memory text.
- [ ] Run `pnpm --filter @memory-lane/codex-adapter test` and verify failure.
- [ ] Update `packages/codex-adapter/src/runner.ts` to measure duration and append exactly one log record for each return path when debug is enabled.
- [ ] Records must use `adapter: "codex"`, `event: command`, `status: "ok"|"noop"|"error"`, safe reason/count fields, `cwd: process.cwd()`, and `durationMs`.
- [ ] Run Codex adapter tests.
- [ ] Commit with `feat(codex): log hook debug records`.

### Task 3: Instrument Claude adapter

- [ ] Add failing tests in `packages/claude-adapter/test/runner.test.ts` for debug-enabled log write, no-op invalid JSON log, error log, debug-disabled no log, and absence of prompt/tool/memory text.
- [ ] Run `pnpm --filter @memory-lane/claude-adapter test` and verify failure.
- [ ] Update `packages/claude-adapter/src/runner.ts` to mirror Codex logging behavior with `adapter: "claude"`.
- [ ] Run Claude adapter tests.
- [ ] Commit with `feat(claude): log hook debug records`.

### Task 4: Documentation

- [ ] Update README and integration docs to mention `MEMORY_LANE_HOOK_DEBUG=1` writes to `~/.memory-lane/hooks-log.jsonl`.
- [ ] Update `skills/memory-lane/SKILL.md` to tell agents logs contain metadata/counts only and not raw prompts/transcripts/tool output.
- [ ] Run `rg -n "hooks-log.jsonl|MEMORY_LANE_HOOK_DEBUG|prompt|transcript|tool output" README.md examples/harness-integrations skills/memory-lane/SKILL.md`.
- [ ] Commit with `docs: explain hook debug log`.

### Task 5: Final verification

- [ ] Run `pnpm build`.
- [ ] Run `pnpm test`.
- [ ] Manual smoke: run a debug-enabled Codex hook command with a temp HOME and verify `$HOME/.memory-lane/hooks-log.jsonl` contains one safe JSONL record.
- [ ] Run `git status --short` and ensure clean.

---

## Self-Review

- Covers spec helper, adapter instrumentation, docs, and verification.
- Keeps `doctor` hook-debug reporting, log rotation, configurable paths, and CLI viewer out of scope.
- Ensures privacy by testing absence of raw sensitive text in adapter log lines.
