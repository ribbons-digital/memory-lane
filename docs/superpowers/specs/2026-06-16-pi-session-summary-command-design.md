# pi Explicit Session Summary Command Design

## Goal

Add an explicit pi command that lets a user summarize the current pi session into a pending Memory Lane `session_summary` memory, without adding automatic session-shutdown, per-turn, or compaction summarization.

## Implementation update: pre-compact summaries

As of 2026-07-03, a later slice added native pi `session_before_compact` support for pending pre-compact summaries.
It runs only when `memory.sessionEndSummary.enabled` is configured, `memory.sessionEndSummary.requireConfirmation` is `false`, and `memory.preCompactSummary.enabled` is not `false`.
It saves pending `session_summary` memories with pi `pre_compact` provenance and does not override pi's own compaction summary.
Automatic `agent_end` and `session_shutdown` summarization remain out of scope.

## Context

Phase 13 already supports:

- Manual summaries through `memory-lane session-end --confirm`.
- Codex summaries through the documented `Stop` hook only when the latest user prompt explicitly asks for a session summary.
- Claude Code summaries through the documented `SessionEnd` hook.

The supported-hook design intentionally deferred pi automation. pi has lifecycle events such as `agent_end`, `session_before_compact`, `session_compact`, and `session_shutdown`, but the safer first pi slice is an explicit user command because session teardown may be too late for model calls or interactive review, compaction may be automatic, and per-prompt `agent_end` is not a true session end.

## Supported pi APIs

This design uses documented pi extension APIs only:

- `pi.registerCommand(...)` to add an interactive slash command.
- `ctx.sessionManager.getBranch()` to read the current conversation branch.
- `ctx.sessionManager.getSessionFile()` as the session identifier when available.
- `ctx.ui.confirm(...)` to ask for explicit confirmation before generating a summary.
- `ctx.ui.notify(...)` for status and error feedback.

The command does not use unsupported hook names and does not add a new automatic lifecycle event handler.

## User-facing command

Add a subcommand to the existing pi `/memory` command:

```text
/memory session-summary
```

Aliases may be added only if they remain explicit and unambiguous:

```text
/memory summarize-session
```

The first implementation should document `/memory session-summary` as the canonical command.

## Behavior

When the user runs `/memory session-summary`:

1. The pi adapter reads the current branch from `ctx.sessionManager.getBranch()`.
2. It extracts bounded user and assistant text messages into lifecycle `SessionMessage[]`.
3. It excludes raw tool results by default. Tool-call names may be omitted in the first slice; full tool output must not be included unless the existing `memory.sessionEndSummary.includeToolOutputs` config is true and a later design defines safe extraction.
4. It checks `memory.sessionEndSummary` from the resolved Memory Lane config.
5. If summarization is disabled, it notifies the user that session-end summarization is not enabled and does not save.
6. If provider config is missing, it notifies the user that `memory.sessionEndSummary.baseUrl` and `model` are required and does not save.
7. If no conversation text is available, it notifies the user and does not save.
8. It asks for confirmation with `ctx.ui.confirm(...)` before calling the provider, regardless of `requireConfirmation`. The command itself is explicit, but the LLM call is still visible and user-confirmed in pi.
9. If cancelled, it notifies the user and does not save.
10. If confirmed, it calls `handleSessionEnd(...)` with `confirmed: true`, the configured OpenAI-compatible provider, and the extracted messages.
11. It saves generated candidates as pending memories with:

```json
{
  "source": "session-summary",
  "kind": "session_summary",
  "status": "pending",
  "provenance": {
    "adapter": "pi",
    "lifecycleEvent": "session_end"
  }
}
```

12. It notifies the user how many pending summaries were created, or that no durable summary was generated.

## Privacy boundaries

- Do not persist raw pi branch entries, raw prompts, raw assistant messages, tool calls, or tool outputs.
- Only save the provider-produced summary candidate through `MemoryEngine.save(...)`.
- Reuse `handleSessionEnd(...)` for secret-line redaction and default tool-output exclusion.
- Tests must include sentinel strings in raw messages and verify only the mock-provider summary is persisted.
- Debug logging, if any, must stay count/metadata-only. This slice does not require adding new debug logs.

## Configuration

Use the existing `memory.sessionEndSummary` config:

- `enabled`
- `baseUrl`
- `apiKeyEnv`
- `model`
- `promptTemplate`
- `maxTokens`
- `includeToolOutputs`

`requireConfirmation` remains meaningful for hook/CLI paths, but the pi command should always confirm interactively because it is initiated from a live TUI command.

## Error handling

- Storage/config failures use the existing pi `storageGuidance(...)` notification pattern.
- Provider failures should notify a concise failure message and save nothing.
- Missing `ctx.sessionManager.getBranch()` should notify that the current pi session cannot be summarized and save nothing.
- Non-TUI mode should not attempt an interactive provider call. If `ctx.ui.confirm` is unavailable, notify that `/memory session-summary` requires interactive confirmation and save nothing.

## Tests

Add pi adapter tests that prove:

1. The command is registered through the existing `/memory` command path.
2. Disabled summarization notifies and saves nothing.
3. Missing provider config notifies and saves nothing before confirmation.
4. Missing or empty branch notifies and saves nothing.
5. User cancellation saves nothing and does not call the provider.
6. Confirmed configured command saves a pending `session_summary` with pi provenance using a mock provider, no real network.
7. Raw user/assistant/tool sentinel strings from the branch are not persisted in the saved memory.

## Non-goals

- No `agent_end` automatic summarization.
- No `session_shutdown` automatic summarization.
- This original explicit-command slice added no `session_before_compact` or `session_compact` integration; a later 2026-07-03 slice added guarded native `session_before_compact` support.
- No automatic approval of generated summaries.
- No new memory review dashboard or Phase 14 UI work.
- No real provider calls in tests.

## Acceptance criteria

- `/memory session-summary` works in pi's existing extension command surface.
- It is explicit and confirmation-gated in the pi UI.
- It reuses `handleSessionEnd` and existing config/provider behavior.
- It saves only pending `session_summary` records with pi `session_end` provenance.
- It does not persist raw session branch content.
- It does not add automatic pi lifecycle summarization.
