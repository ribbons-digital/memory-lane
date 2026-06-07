# Hook Debug JSONL Log

## Status

Approved for implementation.

## Context

Memory Lane hook adapters already support `MEMORY_LANE_HOOK_DEBUG=1` or `true`, but the debug signal is emitted only through hook JSON `systemMessage` output. In Codex Desktop and Claude Code hook soak testing, that output may not be persisted in a place users can reliably inspect.

A project-level Codex hook config can enable debug, but Memory Lane currently does not write a dedicated debug log under `~/.memory-lane`.

## Goal

When hook debug is enabled, persist one concise JSONL diagnostic record per hook invocation to:

```text
~/.memory-lane/hooks-log.jsonl
```

This improves real-user hook observability while keeping hooks silent, fast, deterministic, and privacy-preserving.

## Non-Goals

- Do not log raw prompts, transcripts, tool outputs, memory text, or injected additional context.
- Do not change normal hook stdout behavior.
- Do not write logs unless hook debug is enabled.
- Do not add log rotation in this slice.
- Do not add configurable log path in this slice.
- Do not add `doctor` hook-debug reporting in this slice.
- Do not add a CLI log viewer in this slice.

## User Experience

If a hook command runs with debug enabled:

```bash
MEMORY_LANE_HOOK_DEBUG=1 memory-lane codex stop
```

Memory Lane appends one JSON object line to:

```text
~/.memory-lane/hooks-log.jsonl
```

Example successful lifecycle hook record:

```json
{
  "timestamp": "2026-06-07T00:00:00.000Z",
  "adapter": "codex",
  "event": "stop",
  "cwd": "/Users/shiang/projects/example",
  "status": "ok",
  "saved": 1,
  "skipped": 0,
  "discarded": 0,
  "additionalContext": false,
  "warningCount": 0,
  "durationMs": 42
}
```

Example no-op record:

```json
{
  "timestamp": "2026-06-07T00:00:00.000Z",
  "adapter": "codex",
  "event": "user-prompt-submit",
  "cwd": "/Users/shiang/projects/example",
  "status": "noop",
  "reason": "invalid JSON payload",
  "durationMs": 3
}
```

Example error record:

```json
{
  "timestamp": "2026-06-07T00:00:00.000Z",
  "adapter": "claude",
  "event": "stop",
  "cwd": "/Users/shiang/projects/example",
  "status": "error",
  "reason": "hook handling failed",
  "durationMs": 12
}
```

## Log Path

The default log path is always:

```text
~/.memory-lane/hooks-log.jsonl
```

It is based on `os.homedir()`, not `MEMORY_LANE_FILE`, `MEMORY_LANE_CONFIG`, project-local storage, or the current cwd. The purpose is user-level hook observability across harnesses and projects.

## Debug Enablement

Logging is enabled only when the hook adapter sees:

```text
MEMORY_LANE_HOOK_DEBUG=1
```

or:

```text
MEMORY_LANE_HOOK_DEBUG=true
```

Other values disable hook debug logging.

## Privacy and Safety

Log records must not contain:

- user prompt text;
- assistant transcript text;
- tool output body;
- memory text;
- injected additional context text;
- raw hook payloads.

Allowed fields are metadata and counts only:

- `timestamp`
- `adapter`
- `event`
- `cwd`
- `status`
- `reason`
- `saved`
- `skipped`
- `discarded`
- `additionalContext`
- `warningCount`
- `durationMs`

Logging failures are swallowed and must not change hook output or hook exit behavior.

## Architecture

Add a small shared helper in core:

```text
packages/core/src/hook-debug-log.ts
```

Export it from:

```text
packages/core/src/index.ts
```

The helper should provide:

- `defaultHookDebugLogPath()` returning `path.join(os.homedir(), ".memory-lane", "hooks-log.jsonl")`.
- `hookDebugEnabled(env)` matching existing adapter debug flag behavior.
- `appendHookDebugLog(record, options?)` that creates the parent directory and appends one JSON line. It should catch and swallow all write errors.

Adapter runners should call the helper when debug is enabled:

```text
packages/codex-adapter/src/runner.ts
packages/claude-adapter/src/runner.ts
```

Each `run*HookCommand()` should measure duration once per invocation and write at most one log record before returning.

## Status Semantics

- `ok`: parsed event matched the requested command and handler completed.
- `noop`: invalid JSON, invalid parsed payload, or event mismatch.
- `error`: handler threw and the adapter returned the existing debug no-op output.

## Testing

Core tests should verify:

1. `hookDebugEnabled()` accepts `1` and `true`, rejects other values.
2. `appendHookDebugLog()` writes one JSONL line to a test path.
3. `appendHookDebugLog()` swallows write errors.
4. Written records contain only supplied safe metadata.

Adapter tests should verify:

1. Codex debug-enabled stop/post-tool/user-prompt hook writes one record with adapter/event/status/count fields.
2. Claude debug-enabled stop/post-tool/user-prompt hook writes one record with adapter/event/status/count fields.
3. Invalid/no-op payloads write `status: "noop"` and a safe reason.
4. Handler exceptions write `status: "error"` and a safe reason.
5. Debug-disabled hooks do not write a log.
6. Log lines do not include prompt text, transcript text, tool output body, memory text, or additional context text.

Tests may inject a test log path through helper options or environment-only test affordances, but production behavior must default to `~/.memory-lane/hooks-log.jsonl`.

## Documentation

Update:

- `README.md`
- `examples/harness-integrations/codex-cli.md`
- `examples/harness-integrations/claude-code.md` if present
- `skills/memory-lane/SKILL.md`

Docs should say:

- Set `MEMORY_LANE_HOOK_DEBUG=1` to enable persistent hook debug logging.
- Logs are written to `~/.memory-lane/hooks-log.jsonl`.
- Logs contain counts/metadata only, not prompts/transcripts/tool output.

## Open Questions

None for this slice.
