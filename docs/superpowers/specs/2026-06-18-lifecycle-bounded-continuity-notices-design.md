# Lifecycle Bounded Continuity Notices Design

## Status

Draft for review. This spec covers **Phase 16 Slice 5 — lifecycle bounded notices**.

## Goal

Add bounded, plain-language continuity notices to SessionStart lifecycle context so a new session can cheaply notice newer approved state, available operating agreements, and continuity hints without injecting large memory bodies, mutating memories, or changing recall behavior.

This slice should make Memory Lane feel more like a cross-session continuity layer while preserving the project’s low-noise and review-governed principles.

## Background

Phase 16 has built the foundations for canonical continuity:

1. Slice 1 added read-only freshness/status detection.
2. Slice 2 added read-only operating-agreement discovery.
3. Slice 3 added explicit update/replace/supersede revision primitives.
4. Slice 4 added read-only continuity/status hints.

Slice 5 routes those signals through lifecycle SessionStart context in a bounded, human-readable way. It does not add new learning, cleanup, persistence, or recall ranking behavior.

## Domain terminology

Add or use this term in `CONTEXT.md`:

**Continuity notice**:
A compact, plain-language lifecycle signal that Memory Lane has newer approved state, current operating agreements, or continuity hints worth inspecting. A continuity notice is not a memory body, not a transcript summary, and not a command to mutate memory. It should guide the agent to inspect authoritative Memory Lane surfaces when relevant.

Avoid: relevant memory, session summary, automatic handoff, cleanup recommendation.

## Design decisions

### 1. Notice is separate from Relevant Memory

Lifecycle context currently has two visible concepts:

- selected memory bodies rendered as relevant memory;
- policy-only guidance that tells the agent to use Memory Lane tools.

Slice 5 adds a third concept:

- **Continuity notice** — compact guidance that important continuity signals exist.

The notice should render inside the existing guarded `<memory-context>` block, but as a separate section from memory bodies. It must not be rendered as a bullet in `Relevant Memory`.

Example:

```xml
<memory-context mode="selective" event="sessionStart">
Continuity notice:
- There is newer approved Memory Lane state for this project.
- Current workflow agreements are available.
- Some approved memories are superseded historical guidance.

If relevant, inspect before proceeding:
- `memory-lane dashboard`
- `memory-lane agreements`
- `memory-lane status --json --since 2026-06-18T12:00:00.000Z`

## Relevant Memory

- Use pnpm for installs.
</memory-context>
```

### 2. SessionStart only for this slice

Slice 5 should add continuity notices to `handleSessionStart` only.

Do not add UserPromptSubmit notices in this slice. Prompt-specific recall already runs on UserPromptSubmit, and adding notices on every prompt risks repetition and context noise.

The design should keep helpers reusable enough that prompt notices can be added later if real usage proves they are valuable.

### 3. Plain-language injected text, structured diagnostics in metadata

Injected notice text should prioritize human readability if a user sees hidden context. It should avoid raw implementation jargon where possible.

Use plain-language lines such as:

- “There is newer approved Memory Lane state for this project.”
- “Current workflow agreements are available.”
- “Some approved memories are superseded historical guidance.”
- “Multiple workflow guidance candidates may need review.”

Then include a short inspection section:

```text
If relevant, inspect before proceeding:
- `memory-lane dashboard`
- `memory-lane agreements`
- `memory-lane status --json --since <timestamp>`
```

Do not include memory ids, text previews, or full memory text in injected notice text.

`contextDecision` should carry structured diagnostic metadata for agents/debug logs, including counts, hint codes, whether a notice was generated, whether it was injected, and omission reasons.

### 4. Context policy controls notices

No new configuration flag in this slice.

Use existing `memory.contextPolicy.mode`:

- `off` — no continuity notice and no memory context.
- `policy-only` — continuity notice is allowed because it is guidance/metadata, not memory bodies.
- `selective` — continuity notice is allowed alongside selected baseline memories.

Existing context policy budgets remain authoritative.

### 5. Shared SessionStart budget, notice first

Continuity notice text shares the existing SessionStart character budget.

Render priority:

1. continuity notice header and highest-value plain-language lines;
2. inspection commands;
3. selected baseline memory bodies.

If the SessionStart budget is tight:

- keep the notice short;
- drop lower-priority notice details first;
- reduce/omit baseline memory bodies using existing budget behavior;
- if no notice text can fit, omit the notice and record `continuity-budget` in `contextDecision.omittedReasons` or continuity metadata.

The notice must never bypass `maxChars.sessionStart` / SessionStart injection limits.

### 6. Signal sources

Use deterministic existing signals only:

1. `MemoryEngine.continuityHints({ since })` from Slice 4.
2. `MemoryEngine.operatingAgreementSummary()` from Slice 2.

Signals to summarize:

- newer approved state when `since` is provided;
- superseded-visible memories;
- operating-agreement overlaps;
- project/global overlaps;
- availability of primary operating agreements.

Do not call LLMs, semantic duplicate detection, or background learning logic.

### 7. Optional since timestamp on SessionStartInput

Extend lifecycle `SessionStartInput` with an optional timestamp field:

```ts
interface SessionStartInput {
  cwd: string
  sessionId?: string
  since?: string
}
```

`since` is a caller-provided checkpoint/session-start timestamp used for newer-approved hints. If it is absent, notices may still report operating-agreement availability and non-time-based continuity hints.

Adapters may pass `since` only when the harness payload already contains a suitable timestamp. Do not persist session timestamps, infer long-lived state, or add adapter-specific timestamp storage in this slice.

If a supplied `since` timestamp is invalid, reuse existing freshness/continuity validation behavior and return the same kind of handler error/failure the current lifecycle path uses for invalid core calls.

### 8. Opportunistic adapter pass-through only

Update adapters only where a SessionStart timestamp is already naturally available in the incoming payload.

Rules:

- No new adapter state.
- No persistence of session start times.
- No synthetic “last session” clock.
- No harness-specific continuity rules.
- Adapters should continue calling shared lifecycle/core helpers.

If no adapter exposes a timestamp today, it is acceptable for this slice to add the lifecycle API and tests without meaningful timestamp pass-through. The non-time-based notice still provides value.

### 9. ContextDecision metadata

Extend lifecycle context decision metadata with optional continuity fields. The implementation should preserve the existing `MemoryContextDecision` fields and add a `continuity` object with this shape:

```ts
interface MemoryContextDecision {
  // existing fields...
  continuity?: {
    generated: boolean
    injected: boolean
    omittedReasons: string[]
    hintCount: number
    hintCodes: string[]
    newerApprovedCount?: number
    operatingAgreementPrimaryCount?: number
    suggestedActions: string[]
  }
}
```

This metadata is safe for debug logs: no memory text, no previews, no raw transcripts, no tool outputs.

### 10. Rendering helper

Add a lifecycle helper that converts `ContinuityHintSummary` and `OperatingAgreementSummary` into a bounded notice, likely in `packages/lifecycle/src/injection.ts`:

```ts
renderContinuityNotice(input: {
  hints: ContinuityHintSummary
  operatingAgreements: OperatingAgreementSummary
  since?: string
  maxChars: number
}): {
  text: string
  generated: boolean
  injected: boolean
  omittedReasons: string[]
  suggestedActions: string[]
}
```

The helper should be deterministic, plain-language, text-free, and budget-aware.

## Expected behavior

### Policy off

Input:

- `contextPolicy.mode = "off"`
- continuity hints exist

Output:

- `additionalContext` is undefined;
- `contextDecision.continuity` is absent or reports `generated: false, injected: false`;
- no notice text.

### Policy-only

Input:

- `contextPolicy.mode = "policy-only"`
- operating agreements exist
- continuity hints exist

Output:

- `<memory-context mode="policy-only" event="sessionStart">` contains policy guidance and a continuity notice;
- no memory bodies;
- `contextDecision.continuity.injected = true`.

### Selective

Input:

- `contextPolicy.mode = "selective"`
- baseline memories selected
- continuity hints exist

Output:

- `<memory-context mode="selective" event="sessionStart">` contains continuity notice and relevant memory bodies if budget allows;
- continuity notice appears before `## Relevant Memory`;
- `contextDecision.continuity` reports counts/codes/actions.

### Tight budget

Input:

- `maxChars.sessionStart` too small for notice and memory bodies

Output:

- notice is shortened or omitted within budget;
- memory bodies do not cause budget overflow;
- `contextDecision.continuity.omittedReasons` includes `continuity-budget` if generated but not injected.

## Explicit non-goals

Slice 5 must not add:

- UserPromptSubmit notices;
- lifecycle memory writes;
- automatic consolidation or cleanup;
- recall/retrieval filtering or deprioritization;
- new memory record fields;
- workstream ids or thread ids;
- new context policy config flags;
- LLM or semantic duplicate analysis;
- automatic session timestamp persistence;
- MCP mutation tools;
- injection of large session summaries;
- memory ids or memory text in continuity notice text.

## Testing requirements

Lifecycle tests should cover:

- `handleSessionStart` with policy `off` injects no continuity notice.
- `policy-only` can inject notice without memory bodies.
- `selective` injects notice before relevant memory bodies.
- notice includes plain-language lines and inspection commands.
- notice does not include memory ids or memory text.
- `since` produces newer-approved notice when newer approved memories exist.
- absence of `since` still allows operating-agreement/continuity-hint notice.
- tight budget truncates or omits notice without exceeding budget and records metadata.
- `contextDecision.continuity` is text-free and includes counts/codes/actions.

Adapter tests should cover timestamp pass-through only if a supported SessionStart payload already carries a timestamp.

Docs should explain:

- continuity notices are SessionStart-only in this slice;
- notices are bounded, plain-language, and inspection-first;
- notices are governed by existing `contextPolicy.mode`;
- `off` disables them;
- `policy-only` may include notices without memory bodies;
- Slice 5 does not add cleanup, recall filtering, new config, workstream ids, or prompt notices.
