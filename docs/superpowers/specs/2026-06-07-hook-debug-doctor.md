# Hook Debug Doctor Diagnostics

## Status

Approved for implementation.

## Context

Memory Lane now writes privacy-safe hook debug JSONL records to:

```text
~/.memory-lane/hooks-log.jsonl
```

when hook adapters run with:

```text
MEMORY_LANE_HOOK_DEBUG=1
```

Users need a cheap way to discover whether that log exists and where it is without opening filesystem paths manually.

## Goal

Add read-only hook debug log diagnostics to `memory-lane doctor`.

## Non-Goals

- Do not enable or disable hook debug logging.
- Do not read, parse, tail, rotate, truncate, or archive the log.
- Do not add a CLI log viewer.
- Do not add configurable hook debug log paths.
- Do not report historical hook success/failure summaries.
- Do not inspect Codex or Claude hook configuration files in this slice.

## Report Fields

Add these stable fields to `MemoryEngine.doctor()`:

- `hookDebugEnabledInCurrentEnv`: boolean; true only when current process env has `MEMORY_LANE_HOOK_DEBUG=1` or `true`.
- `hookDebugLogPath`: string; default path from `defaultHookDebugLogPath()`.
- `hookDebugLogExists`: boolean.
- `hookDebugLogSizeBytes`: number; `0` when missing or inaccessible.
- `hookDebugLogLastModified`: ISO string or `null`; `null` when missing or inaccessible.
- `hookDebugWarnings`: string array.

Warnings should stay cheap and filesystem-only. First-slice warnings:

- If the log path exists but is not a file, warn: `Hook debug log path is not a file: <path>`.
- If stat fails unexpectedly, warn: `Hook debug log is not accessible: <path>`.

## Behavior

`doctor()` must remain read-only. It may call `fs.statSync`, but must not create `~/.memory-lane`, create the log file, rotate logs, or modify anything.

`hookDebugEnabledInCurrentEnv` reflects only the environment of the `doctor` process. It does not imply hooks are configured with debug enabled.

## Architecture

Add a private helper near `MemoryEngine.doctor()` in:

```text
packages/core/src/engine.ts
```

The helper should reuse:

```text
packages/core/src/hook-debug-log.ts
```

specifically:

- `defaultHookDebugLogPath()`
- `hookDebugEnabled()`

No adapter changes are needed.

## Testing

Add core tests for:

1. Missing log file: reports path, exists false, size 0, lastModified null, warnings empty.
2. Existing log file: reports exists true, size > 0, lastModified ISO string, warnings empty.
3. Current env debug flag: reports `hookDebugEnabledInCurrentEnv: true` when `MEMORY_LANE_HOOK_DEBUG=1` is present.
4. Directory at log path: reports exists true, size 0, lastModified null, warning about not being a file.
5. `doctor()` does not create the log directory or file when missing.

Tests may need an injectable hook debug log path to avoid touching the real home directory. Production behavior must use `defaultHookDebugLogPath()`.

## Documentation

Update:

- `README.md`
- `skills/memory-lane/SKILL.md`

Docs should explain that `doctor` reports hook debug log path/existence/size/mtime and remains read-only.

## Open Questions

None for this slice.
