# Session-End Summarization Design Spec

## Goal

Let Memory Lane optionally capture a structured summary at the end of an agent session so the next session can start with meaningful project state rather than from scratch. This is the first step toward replacing manual `HANDOFF.md` notes with machine-generated, user-reviewable session memories.

## Principles

1. **Opt-in and disabled by default.** Users must explicitly enable session-end summarization. The feature is off until they configure it, so they acknowledge the privacy and accuracy trade-offs.
2. **User confirmation, not auto-generation.** Even when enabled, the system prompts the user before generating a summary (e.g., "Generate a session-end memory?"). It does not silently summarize every session.
3. **Privacy-safe by design.** Session content may be sent to an LLM for summarization, but only when the user opts in and confirms. The transcript itself is never stored in Memory Lane; only the summary and a reference hash are stored.
4. **Reviewable memories.** Generated summaries enter the pending review queue. They become active only after user approval.
5. **Source-tagged and time-stamped.** Every generated memory is tagged with `source: "session-summary"`, `lifecycleEvent: "session_end"`, and timestamps so later refresh logic can reason about staleness.

## Non-goals

- Fully automatic handoff-free sessions without user review. That is Phase 16.
- Storing full session transcripts in Memory Lane.
- Real-time summarization during a session.
- Cross-project memory inheritance.

## User-facing behavior

### Configuration

In `~/.memory-lane/config.json`:

```json
{
  "memory": {
    "sessionEndSummary": {
      "enabled": false,
      "provider": "openai-compatible",
      "model": "gpt-4.1-mini",
      "promptTemplate": null,
      "maxTokens": 800,
      "requireConfirmation": true,
      "includeToolOutputs": false
    }
  }
}
```

- `enabled`: master switch. Default `false`.
- `provider`/`model`: LLM used for summarization. Optional if using a local default.
- `promptTemplate`: optional override for the summarization prompt.
- `maxTokens`: budget for the summary output.
- `requireConfirmation`: if `true`, the harness must show a prompt before generating. Default `true`.
- `includeToolOutputs`: if `true`, tool outputs are included in the summarization context. Default `false` for privacy.

### Triggering a summary

When a session ends, the harness adapter sends a `SessionEnd` event:

```ts
interface SessionEndInput {
  cwd: string
  sessionId: string
  messages: Array<{ role: "user" | "assistant" | "tool"; content: string; timestamp?: string }>
  transcriptPath?: string
}
```

If `requireConfirmation` is enabled, the harness asks the user:

> "Memory Lane can summarize this session for future context. Generate a session-end memory? (yes/no)"

Only on confirmation does the adapter call `handleSessionEnd`.

### Generated memory

`handleSessionEnd` returns a `MemoryCandidate`:

```ts
{
  text: "## Session Summary (2026-06-16)\n\n- Decisions: …\n- Blockers: …\n- Open questions: …\n- Next steps: …",
  category: "project",
  scopeType: "project",
  kind: "session_summary",
  status: "pending",
  source: "session-summary",
  provenance: {
    adapter: "codex",
    lifecycleEvent: "session_end",
    sessionId: "s1"
  }
}
```

The memory is saved via `MemoryEngine.suggest()` so it enters the pending review queue.

### Review

The user runs `memory-lane review` or uses the MCP `memory_review` tool to approve, reject, or edit the summary. Approved summaries are recalled in future sessions.

## Architecture

### New package/changes

- `@memory-lane/lifecycle`: add `handleSessionEnd(engine, input, options)`.
- `@memory-lane/core`: add `session_summary` to `MemoryKind`, add `MemoryConfig.sessionEndSummary` schema.
- Harness adapters (pi, Codex, Claude Code): emit `SessionEnd` events and prompt for confirmation when configured.
- CLI/MCP: no major changes; reuse existing `suggest` and `review` paths.

### `handleSessionEnd` contract

```ts
export interface SessionEndInput {
  cwd: string
  sessionId?: string
  messages: SessionMessage[]
  transcriptPath?: string
}

export interface SessionMessage {
  role: "user" | "assistant" | "tool"
  content: string
  timestamp?: string
  toolName?: string
}

export interface SessionEndOptions {
  provider?: LLMProvider
  model?: string
  promptTemplate?: string
  maxTokens?: number
  includeToolOutputs?: boolean
}

export function handleSessionEnd(
  engine: MemoryEngine,
  input: SessionEndInput,
  options?: SessionEndOptions,
): Promise<MemoryCandidate[]>
```

### Summarization prompt (default)

```text
You are summarizing an AI-assisted coding session for a memory system.
Read the session transcript and produce a concise, structured summary.

Include only these sections if they have content:
- Decisions made
- Blockers or failures
- Open questions
- Next steps
- Key facts about the project, codebase, or user preferences

Rules:
- Do not include secrets, API keys, passwords, or private data.
- Do not include transient commands or raw tool output.
- Be specific but brief. Use Markdown bullet lists.
- If the session had no durable takeaways, return "NO_DURABLE_MEMORY".

Transcript:
{{transcript}}
```

If the LLM returns `NO_DURABLE_MEMORY`, no candidate is produced.

### Privacy and security

- Tool outputs are excluded unless `includeToolOutputs` is true.
- Secrets are filtered from the transcript using the existing `containsLikelySecret` utility before being sent to the LLM.
- The transcript itself is never persisted; only the summary and a hash of the transcript path or session ID are stored.
- If no LLM provider is configured and the feature is enabled, the adapter surfaces a clear error and falls back to manual mode.

## Data model changes

### `MemoryKind`

Add `"session_summary"` to the union in `packages/core/src/types.ts`.

### `MemoryRecord.provenance`

Reuse existing `MemoryProvenance` with `lifecycleEvent: "session_end"`.

### `SemanticMemoryConfig`

Add optional `memory` section:

```ts
export interface SessionEndSummaryConfig {
  enabled?: boolean
  provider?: string
  model?: string
  promptTemplate?: string
  maxTokens?: number
  requireConfirmation?: boolean
  includeToolOutputs?: boolean
}

export interface MemoryLaneConfig {
  // ... existing fields ...
  memory?: {
    sessionEndSummary?: SessionEndSummaryConfig
  }
}
```

## Error handling

- Config missing or invalid: log a clear error and skip summarization.
- LLM unavailable: return no candidates; notify the user.
- Summary generation fails: no partial memory is saved.
- Secret detection triggers: redact and continue, or abort if redaction removes all useful content.

## Testing strategy

1. Unit tests for `handleSessionEnd` with mock LLM provider and sample transcripts.
2. Tests for secret redaction before LLM call.
3. Tests for config gating (`enabled: false` produces no candidates).
4. Tests for `NO_DURABLE_MEMORY` handling.
5. Adapter tests for `SessionEnd` event handling and confirmation gating.
6. End-to-end: enable feature, run a session, confirm summary, approve via review, start next session and verify recall.

## Open questions

1. Should session summaries be generated per-project or also globally?
2. Should the confirmation prompt be handled by the harness UI or by Memory Lane emitting a special response?
3. What is the default LLM provider when none is configured? (Recommendation: require explicit provider; no silent default to a remote API.)

## Acceptance criteria

- [ ] `enabled: false` by default; no summaries generated.
- [ ] `requireConfirmation: true` prompts the user before generation.
- [ ] Generated summaries are saved as pending memories with `kind: "session_summary"`.
- [ ] Users can approve/reject summaries through existing review paths.
- [ ] Secrets are filtered from LLM input.
- [ ] Full build and test suite passes.
- [ ] Docs explain opt-in, privacy, and review workflow.
