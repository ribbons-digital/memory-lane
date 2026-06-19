# Prompt-Time Continuity Intents Design

## Status

Draft for review. This spec covers the next continuity slice after Phase 16: **prompt-time continuity intents**.

## Goal

Make Phase 16 continuity capabilities accessible through natural user prompts without requiring users to know Memory Lane internal terms such as "operating agreements," "freshness," or "continuity hints."

When a user asks to resume prior work, locate where prior work happened, understand project position, or decide the next item, Memory Lane should provide bounded inspection guidance and, when a topic is present, continue to use existing budgeted recall/search behavior. It must stay low-noise, harness-neutral, and review-friendly.

## Background

Phase 16 added the underlying continuity surfaces:

1. read-only freshness/status metadata;
2. operating-agreement discovery;
3. explicit update/replace/supersede revision primitives;
4. read-only continuity hints;
5. SessionStart continuity notices.

Those surfaces are mostly available through lifecycle SessionStart, CLI, MCP, dashboard/status, and explicit commands. They are not yet naturally discoverable from prompts such as "What were we last working on?" or "Where was X implemented?"

This slice adds deterministic prompt-time continuity intent handling. It does not add automatic checkpoint capture, session timestamp persistence, new memory writes, or true workstream/thread lookup. Those remain later roadmap work.

## Domain terminology

`CONTEXT.md` defines this term:

**Continuity intent**:
A natural-language user prompt that asks an agent to resume prior work, locate where or when prior work happened, understand current project progress, or decide the next work item. It triggers bounded Memory Lane inspection guidance and, when topic-specific, targeted recall/search. It is not a lifecycle continuity notice, session summary, or automatic handoff.

Avoid: continuity notice, session summary, automatic handoff, lifecycle event.

## User-facing behavior

Memory Lane should recognize natural continuity prompts such as:

- "Let's resume building X"
- "Continue working on X"
- "Where was X implemented?"
- "When did we implement X?"
- "Find the thread/session where we built X"
- "Where are we in the project?"
- "What's the latest progress?"
- "What were we last working on?"
- "What should we work on next?"
- "What's the next slice?"

User-facing guidance should avoid Memory Lane-internal language. Prefer:

- "latest project progress"
- "prior work"
- "current project workflow"
- "current plan"
- "review queue"
- "project state"

Do not make users ask for "operating agreements" or "continuity hints" to get useful continuity behavior.

## Intent families

Use deterministic phrase detection for the first slice. Do not add an LLM classifier.

### 1. Resume/build intent

Examples:

- "Let's resume building X"
- "Continue working on X"
- "Pick up X again"

Behavior:

- Detect the prompt as continuity-sensitive.
- Extract topic `X` when straightforward.
- Use `X` or the full prompt as the recall/search query under existing selective recall behavior.
- Include guidance telling the agent to inspect project state before assuming the current chat has all context.

### 2. Prior-work lookup intent

Examples:

- "Where was X implemented?"
- "When did we implement X?"
- "Find the thread where we built X"
- "Find the session where X happened"

Behavior:

- Detect the prompt as a continuity lookup.
- Extract topic `X` when straightforward.
- Include guidance that the exact thread/session lookup may require inspecting Memory Lane recall/search and project records.
- Use existing recall when policy permits.

This slice should not claim to provide exact thread/session discovery. It should prepare the agent to use available Memory Lane surfaces and any project artifacts.

### 3. Project-position intent

Examples:

- "Where are we in the project?"
- "What's the latest progress?"
- "What were we last working on?"

Behavior:

- Detect the prompt as project-position continuity intent.
- Provide inspection-first guidance.
- Do not answer from injected context alone. The guidance should tell the agent to inspect status/dashboard/roadmap or equivalent tools before concluding.

### 4. Next-work intent

Examples:

- "What should we work on next?"
- "What's next?"
- "What's the next slice?"

Behavior:

- Detect the prompt as next-work continuity intent.
- Provide inspection-first guidance.
- Do not pretend Memory Lane knows the correct next item without checking roadmap/status/review surfaces.
- This is especially important because Phase 17 checkpoint capture is not implemented yet.

## Context output behavior

Prompt-time continuity intent handling belongs in `handleUserPromptSubmit`.

### `contextPolicy.mode = off`

No automatic prompt-time continuity guidance is emitted.

Return the same kind of context decision already used for prompt policy-off behavior.

### `contextPolicy.mode = policy-only`

Return guidance only. Do not include memory bodies.

Example shape:

```text
## Memory Lane continuity guidance

This prompt appears to ask about prior or ongoing project work.
Before answering from chat context alone, inspect Memory Lane project state.

Suggested inspection:
- memory-lane status --json
- memory-lane dashboard
- memory-lane recall "<topic>"
```

When no topic is detected, omit the topic-specific recall command and prefer status/dashboard/review/roadmap inspection guidance.

### `contextPolicy.mode = selective`

Render the guidance before normal relevant memory context.

For topic-specific continuity intents:

- Run existing recall/selection using the extracted topic when available, otherwise the full prompt.
- Keep selection budgeted by the existing prompt context policy.
- Do not bypass secret filtering, duplicate filtering, lexical filtering, or character budgets.

For broad project-position and next-work intents:

- Emit guidance first.
- Existing recall may still run if the prompt has lexical signal, but the guidance should warn the agent to inspect authoritative surfaces before answering.

## Context decision metadata

Extend prompt `contextDecision` only as needed to make behavior inspectable without memory text.

A minimal optional shape is acceptable, for example:

```ts
continuityIntent?: {
  detected: boolean
  family?: "resume" | "lookup" | "project-position" | "next-work"
  topic?: string
  guidanceInjected: boolean
}
```

Constraints:

- Do not include memory text.
- Do not include raw prompts if a normalized family/topic is enough.
- Avoid adding memory ids unless already part of existing selected-memory diagnostics. Prefer counts and booleans.

If adding metadata would make the slice larger than necessary, it can be deferred, but tests must still assert the rendered guidance behavior.

## Implementation boundaries

In scope:

- Add a shared deterministic continuity-intent detector in lifecycle code.
- Add a renderer for prompt-time continuity guidance.
- Update `handleUserPromptSubmit` to use this guidance in `policy-only` and `selective` modes.
- Keep normal unrelated prompts unchanged.
- Add lifecycle tests for the intent families and policy modes.
- Update docs/roadmap/handoff for the slice.

Out of scope:

- New memory writes.
- New config flags.
- LLM intent classification.
- Automatic session timestamp persistence.
- New MCP mutation tools.
- Recall ranking changes.
- Full natural-language thread/workstream lookup.
- Phase 17 checkpoint capture.
- Prompt-time lifecycle continuity notices on every prompt.
- Requiring users to know terms like "operating agreement" or "continuity hint."

## Testing requirements

Add tests for:

1. Resume/build prompt detects continuity intent and includes guidance.
2. Prior-work lookup prompt detects continuity intent and includes topic-aware guidance.
3. Project-position prompt includes inspection-first guidance.
4. Next-work prompt includes inspection-first guidance.
5. Normal unrelated prompt behavior is unchanged.
6. `contextPolicy.mode = off` suppresses prompt-time continuity guidance.
7. `policy-only` emits guidance without memory bodies.
8. `selective` emits guidance before relevant memory context.
9. Guidance text itself contains no memory bodies, memory ids, raw transcripts, or tool output.
10. Topic-specific recall remains budgeted through existing selection logic.

## Manual test examples

After implementation, these prompts should produce guidance:

- "Let's resume building prompt continuity intents"
- "Where was lifecycle continuity implemented?"
- "Where are we in the project?"
- "What were we last working on?"
- "What should we work on next?"

This prompt should behave like normal recall and should not emit continuity guidance:

- "How do I run tests?"

## Success criteria

The slice is successful when a user can ask natural continuity questions and receive bounded, inspection-first Memory Lane guidance without needing internal vocabulary, while preserving existing low-noise prompt injection behavior for ordinary prompts.
