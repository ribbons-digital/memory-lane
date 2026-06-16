# Claude Code Session-End Summary Design

## Goal

Add Phase 13 Slice 3 support for Claude Code's documented `SessionEnd` hook so Memory Lane can generate pending session summaries at a real session lifecycle boundary without relying on unsupported Codex hook names.

This slice extends the existing opt-in session-end summarization foundation. It does not change the default disabled posture, does not auto-approve generated memories, and does not store raw transcripts.

## Current context

Phase 13 already includes:

- shared `memory.sessionEndSummary` config, disabled by default
- `handleSessionEnd` in `@memory-lane/lifecycle`
- manual `memory-lane session-end --confirm`
- Codex explicit-intent automation through the supported `Stop` hook
- Codex-shaped `session-end` tests for future compatibility, while documenting that Codex does not currently support `SessionEnd`

Claude Code differs from Codex because Claude Code documents a real `SessionEnd` hook. That makes Claude the next adapter to support before moving to pi or review/dashboard work.

## Supported command

Add a Claude adapter command:

```bash
memory-lane claude session-end
```

The command reads Claude hook JSON from stdin, matching existing adapter command style.

The CLI should accept `claude session-end` alongside the existing Claude commands:

```text
memory-lane claude user-prompt-submit
memory-lane claude stop
memory-lane claude post-tool-use
memory-lane claude session-start
memory-lane claude session-end
```

## Payload contract

Parse only the documented Claude hook event name:

```json
{
  "hook_event_name": "SessionEnd",
  "session_id": "session-1",
  "cwd": "/path/to/project",
  "transcript_path": "/path/to/transcript.jsonl",
  "reason": "clear",
  "confirmed": true,
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

Fields:

- `hook_event_name`: required, must be `SessionEnd`
- `cwd`: required, used for project scoping
- `session_id`: optional, forwarded to lifecycle provenance when present
- `transcript_path`: optional; used as fallback input when explicit `messages` are absent
- `reason`: optional; captured as adapter metadata if useful later, but not required for saving
- `confirmed`: optional boolean for tests/manual invocations
- `messages`: optional array of `{ role, content, timestamp?, toolName? }` session messages

If both `messages` and `transcript_path` exist, prefer `messages` because they are explicit hook payload data. Use the bounded transcript reader only as fallback.

## Confirmation behavior

Session summaries may send session content to a configured LLM, so Claude `SessionEnd` must keep the same cautious posture as the manual and Codex paths.

Behavior:

1. If `memory.sessionEndSummary.enabled` is false, return a no-save explanatory output.
2. If `baseUrl` or `model` is missing, return a no-save explanatory output.
3. If `requireConfirmation !== false` and the payload is not `confirmed: true`, do not save. Return a confirmation-required message.
4. If `confirmed: true` or `requireConfirmation === false`, call `handleSessionEnd` and save generated candidates as pending `session_summary` memories.

This means configuring the hook alone does not silently summarize every Claude session unless the user has explicitly disabled confirmation in config.

## Save behavior

Confirmed saves should:

- call the shared `handleSessionEnd` lifecycle handler
- use the configured OpenAI-compatible summary provider
- save candidates with `status: "pending"`
- preserve `source: "session-summary"`
- preserve `kind: "session_summary"`
- add provenance with `adapter: "claude"` and `lifecycleEvent: "session_end"`
- use project scope from `cwd`

Generated summaries remain pending until approved through existing review/approve flows.

## Privacy behavior

The adapter must not persist raw session messages, raw transcript lines, tool markers, prompts, or provider inputs. Only the summary candidate returned by `handleSessionEnd` may be saved.

Tests should include sentinel strings in raw transcript/messages and assert they do not appear in saved memory when the mock provider returns a sanitized summary.

Debug logs should stay metadata-only, following existing Claude adapter behavior.

## Documentation

Update Claude Code integration docs and README to document `SessionEnd` only for Claude.

Do not add or imply a real Codex `SessionEnd` hook. Codex remains supported through `Stop` with explicit user intent.

Recommended docs wording:

- Claude Code supports `SessionEnd`; Memory Lane can wire `memory-lane claude session-end` there.
- Session-end summarization is disabled by default.
- If confirmation is required, a bare hook payload will not save automatically.
- Users who want automatic Claude session summaries must opt in by setting `memory.sessionEndSummary.enabled: true` and `requireConfirmation: false`.

## Tests

Add tests for:

1. parsing `SessionEnd` payload with `messages`, `reason`, and `confirmed`
2. runner no-op when summarization is disabled
3. runner no-op when provider config is missing
4. confirmation-required output without save when `requireConfirmation` is true and `confirmed` is absent
5. confirmed save path using a mock provider
6. no raw transcript/message sentinel persistence
7. CLI accepts `memory-lane claude session-end`
8. docs do not instruct Codex users to configure unsupported `SessionEnd`

## Out of scope

- pi session summary automation
- Codex `SessionEnd` user-facing hook configuration
- automatic summary approval
- Phase 14 review/dashboard UX
- structured machine-readable session-summary schema beyond current Markdown summaries
- global duplicate-hook installer policy changes beyond existing doctor warning

## Acceptance criteria

This slice is complete when:

- `memory-lane claude session-end` exists and is tested
- Claude `SessionEnd` payloads parse into shared `SessionEndInput`
- confirmation gating prevents surprise saves by default
- confirmed/configured runs save pending `session_summary` memories with Claude provenance
- raw transcripts are not persisted
- Claude docs show the supported hook
- Codex docs still warn that Codex has no supported `SessionEnd`
- build and tests pass
