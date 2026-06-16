# Supported Session Summary Hook Design Spec

## Goal

Define a safe, documentation-backed path from manual `memory-lane session-end --confirm` summaries to harness automation without relying on unsupported hook names.

## Current reality

As of 2026-06-16, real production usage is **manual / explicit trigger only**:

```bash
memory-lane session-end --confirm
```

Memory Lane contains a Codex-shaped `session-end` adapter path for tests and future compatibility, but current OpenAI Codex hooks documentation does **not** expose a supported `SessionEnd` hook event. Do not configure `SessionEnd` in `.codex/hooks.json`.

## Evidence from current hook documentation

### Codex CLI

Source: OpenAI Codex hooks documentation at `https://developers.openai.com/codex/hooks`.

Supported lifecycle events documented there include:

- `SessionStart`
- `UserPromptSubmit`
- `Stop`
- `PreCompact`
- `PostCompact`
- `SubagentStart`
- `SubagentStop`
- `PreToolUse`
- `PermissionRequest`
- `PostToolUse`

Relevant notes:

- `Stop` fires at turn scope, not session scope.
- `PreCompact` / `PostCompact` match on `manual` or `auto` compaction triggers.
- `SubagentStop` applies to subagents, not the main session.
- `SessionEnd` is not listed as a supported Codex event.
- `transcript_path` is available in common fields, but Codex warns that the transcript format is not a stable hook interface.

### Claude Code

Source: Claude Code hooks reference at `https://code.claude.com/docs/en/hooks.md` and guide at `https://code.claude.com/docs/en/hooks-guide`.

Supported relevant events include:

- `SessionStart`
- `SessionEnd`
- `UserPromptSubmit`
- `Stop`
- `SubagentStart`
- `SubagentStop`
- `PreCompact`
- `PostCompact`

Relevant notes:

- `SessionEnd` is documented and matches on end reason values such as `clear`, `resume`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, and `other`.
- `PreCompact` / `PostCompact` match on `manual` or `auto`.
- `Stop` fires when Claude finishes responding and is turn-scoped.
- `SubagentStop` applies to subagents, not the main session.

### pi

Source: local pi extension docs at:

```text
/Users/shiang/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
```

Supported relevant extension events include:

- `input`
- `before_agent_start`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `tool_result`
- `session_before_compact`
- `session_compact`
- `session_shutdown`

Relevant notes:

- `agent_end` fires once per user prompt and includes `event.messages` from that prompt.
- `turn_end` fires for each LLM response/tool loop and includes `event.message` and `event.toolResults`.
- `session_before_compact` can cancel or customize compaction and exposes compaction preparation data.
- `session_shutdown` fires before a session runtime is torn down with reasons like `quit`, `reload`, `new`, `resume`, and `fork`.
- pi examples include `custom-compaction.ts` and `handoff.ts`, which show how to serialize conversation or compaction context for summaries.

## Hook candidates

### Candidate A — Manual command only

**Status:** Already implemented.

```bash
memory-lane session-end --confirm
```

Pros:

- Supported everywhere.
- Explicit user intent.
- No surprise LLM calls.
- Works before per-harness event semantics are perfected.

Cons:

- Requires manual transcript input or harness-specific helper scripting.
- Does not automatically capture real session endings.

Recommendation: keep this as the stable baseline and primary user-facing path until at least one automated adapter proves useful.

### Candidate B — Codex `Stop` with explicit user intent

Use Codex `Stop`, a real supported hook, but only trigger session summarization when the latest user prompt explicitly asks for it, for example:

- `remember this session`
- `save a session summary`
- `summarize this session to memory`

Pros:

- Uses a supported Codex event.
- Can be tested in current Codex.
- Preserves user confirmation/intent.
- Fits Codex's current turn-scoped lifecycle.

Cons:

- `Stop` is turn-scoped, not session-scoped.
- Needs careful prompt-intent detection to avoid firing every turn.
- Full transcript access depends on `transcript_path`, whose format Codex says is not stable.
- Existing `Stop` already does memory autosave; session-summary logic must not regress current stop-candidate extraction.

Recommended design:

1. Add a `summaryRequested` detector for the last user message only.
2. If not requested, preserve existing `Stop` behavior exactly.
3. If requested, gather a bounded transcript from `transcript_path` using existing bounded transcript reader patterns where possible.
4. Call `handleSessionEnd` only when `memory.sessionEndSummary.enabled` is true and either `requireConfirmation` is false or the request phrase itself is explicit enough to count as confirmation.
5. Save the generated summary as pending.
6. Return a concise `systemMessage` only when useful for user feedback.

This is the best first automation target for Codex because it is supported and explicit.

### Candidate C — Codex `PreCompact` / `PostCompact`

Use compaction as a memory-preservation point.

Pros:

- Compaction is a natural moment to preserve context before/after loss.
- Codex documents both `PreCompact` and `PostCompact`.
- Matchers can distinguish `manual` vs `auto`.

Cons:

- Auto-compaction may happen without direct user intent.
- Sending transcript content to an LLM during auto-compaction could surprise users.
- Pre-compact flows are latency-sensitive; adding another LLM call could slow compaction.
- Summary output and pending memory review may be less visible at compaction time.

Recommended design:

- Do not implement auto-compaction summarization first.
- Consider a later slice for `PreCompact` with matcher `manual` only, or a separate config flag such as `memory.sessionEndSummary.onManualCompact`.
- Never enable for `auto` by default.

### Candidate D — Codex `SubagentStop`

Use subagent completion to summarize delegated work.

Pros:

- Supported by Codex.
- Useful for preserving research/implementation results from subagents.
- Could reduce handoff loss between parent and subagent flows.

Cons:

- Subagent output is not the main session summary.
- Could produce many noisy pending memories.
- Requires separate `subagent_summary` semantics or careful `session_summary` wording.

Recommended design:

- Do not implement before main-session explicit summaries are proven.
- Treat as a later feature, likely a different memory kind or source subtype.

### Candidate E — Claude Code `SessionEnd`

Use Claude Code's real supported `SessionEnd` event.

Pros:

- This is the actual lifecycle point we originally wanted.
- Claude Code docs explicitly support it.
- Cleaner than turn-scoped `Stop` for session-end summaries.

Cons:

- Need to inspect exact `SessionEnd` payload fields and transcript access in current Claude Code.
- Session shutdown may not be a good time for interactive confirmation.
- Output goes to logs/UI depending on Claude Code semantics; user feedback may be limited.

Recommended design:

1. Create a Claude-specific design/implementation slice after manual flow smoke.
2. Support only documented `SessionEnd` event names and reason matchers.
3. If interactive confirmation is not reliable at shutdown, require explicit config `requireConfirmation: false` or an earlier explicit user command/prompt marker.
4. Add tests with fixture payloads from the Claude Code docs and local manual capture.

This is a good second automation target, after Codex explicit `Stop` or after a manual quality smoke, because the event is supported and semantically correct.

### Candidate F — pi `agent_end`, `session_before_compact`, or `session_shutdown`

Use pi extension events.

Pros:

- pi exposes rich extension APIs and UI confirmation (`ctx.ui.confirm`).
- `agent_end` includes messages from the prompt, which avoids unstable transcript parsing.
- `session_before_compact` exposes compaction preparation data.
- `session_shutdown` is a true teardown point.

Cons:

- `agent_end` is per prompt, not per session.
- `session_shutdown` may be too late for slow LLM generation or UI confirmation.
- `session_before_compact` may trigger automatically and is not equivalent to session end.

Recommended design:

- First pi automation should be explicit command/UI driven, not automatic shutdown summarization.
- Add a pi `/memory session-summary` command that uses `ctx.sessionManager` to gather the current branch, asks for confirmation via `ctx.ui.confirm` / editor review, and saves a pending memory.
- Later, consider `session_before_compact` only for manual compaction and only with explicit config.
- Avoid `agent_end` automatic summarization unless keyed off explicit user intent in the prompt.

## Recommended implementation order

1. **Manual quality smoke**
   - Test `memory-lane session-end --confirm` with the user's preferred OpenRouter/local provider.
   - Approve/reject generated pending memory and evaluate whether the summaries are useful.

2. **Codex supported-hook design around `Stop`**
   - Implement explicit-intent `Stop` handling only.
   - Do not use `SessionEnd`.
   - Preserve current stop autosave behavior when no summary is requested.

3. **Claude Code `SessionEnd` adapter**
   - Use the real documented Claude Code `SessionEnd` event.
   - Verify exact payload locally before implementation.
   - Handle confirmation carefully because shutdown may not support interactive prompts.

4. **pi explicit command**
   - Add an interactive pi command using `ctx.sessionManager` and `ctx.ui`.
   - Prefer user review/edit before saving.

5. **Compaction integrations**
   - Add Codex/Claude `PreCompact` or pi `session_before_compact` only after manual/session-end flows prove useful.
   - Start with manual compaction triggers only; never auto by default.

6. **Subagent summaries**
   - Treat as separate feature after main-session summaries are stable.

## Non-goals for the next slice

- No automatic summary on every `Stop` / `agent_end`.
- No unsupported hook names.
- No auto-compaction summarization by default.
- No raw transcript persistence.
- No direct approval of generated summaries; they must stay pending unless the user explicitly approves later.

## Update required before coding

Before implementing any follow-up adapter, update the original Phase 13 design/plan or create a replacement implementation plan that:

1. Lists the exact supported event names from the harness docs.
2. Includes fixture payloads captured from the real harness or copied from official docs.
3. Defines confirmation semantics for that harness.
4. Defines fallback/no-op behavior when config is disabled or provider is missing.
5. Includes tests proving unsupported events are not documented as real hooks.
