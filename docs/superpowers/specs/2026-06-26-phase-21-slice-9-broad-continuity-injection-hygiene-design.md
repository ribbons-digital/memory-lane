# Phase 21 Slice 9 — Broad Continuity Injection Hygiene Design

## Goal

For broad prior-work / project-status / next-action prompts in Claude/Codex prompt-submit lifecycle injection, stop injecting ordinary recall-selected memory bodies that can compete with canonical continuity state. Keep explicit recall/get full-fidelity and preserve topic-specific recall for prompts that name a concrete workstream or implementation topic.

## Problem

Post-v0.2.35 validation (`docs/superpowers/validation/2026-06-26-phase-21-post-v0.2.35-memory-cleanup-exit-validation.md`) found that memory cleanup, low-signal greeting suppression, SessionStart bounding, summary hygiene, and cross-project scoping are working. However, Claude/Codex broad prompts such as `what should we work on next?` still produce prompt-time context containing:

1. `## Memory Lane continuity guidance`, and
2. normal `## Relevant Memory` recall-selected bodies.

One selected body was stale Slice 6a next-slice guidance (`3058f847`), while canonical continuity correctly identified v0.2.35 release memory `311283e6` as latest progress. This is not cross-project leakage and stays within budgets, but it can bias the context window away from the canonical continuity read model.

At the time of Slice 9, the installed Pi generated bridge already behaved better for broad prompts: it used local deterministic continuity detection, routed broad continuity prompts to `memory-lane continuity --query <prompt> --json`, and rendered the continuity read model instead of ordinary recall bodies. A later continuity-routing hygiene slice replaced that local bridge-only routing with the shared `memory-lane route --prompt <text> --json` decision, with fallback continuity heuristics only when route subprocesses fail in selective mode.

## Scope

Change the shared lifecycle `handleUserPromptSubmit` behavior for broad continuity intent families:

- `project-position`
- `next-work`

For those families in `selective` mode:

- inject continuity guidance only, or a compact canonical continuity read-model context if available through existing core APIs;
- do **not** call normal recall / do **not** render `## Relevant Memory` bodies;
- report `contextDecision.continuityIntent.detected = true` and `guidanceInjected = true`;
- mark omitted reason clearly, e.g. `broad-continuity-no-recall`, so debug/status consumers can understand why selected recall memories are zero.

Keep existing behavior for topic-specific families:

- `resume` with `topic`
- `lookup` with `topic`

Those should still use topic-specific recall query and render `## Relevant Memory`, because the user is asking for a specific implementation/workstream and targeted recall is useful.

Keep low-signal suppression earlier than continuity intent, so `hi` still returns no context.

Keep `policy-only` behavior unchanged: it already emits guidance without bodies.

## Non-goals

- No retrieval/ranking rewrite.
- No recall filtering change outside broad continuity prompt injection.
- No schema expansion.
- No raw transcript/tool-output indexing.
- No persisted workstream ids.
- No memory mutation, cleanup, approval, rejection, or auto-consolidation.
- No explicit `memory_recall` / `memory_get` behavior changes.
- No generated Pi bridge change in Slice 9. A later continuity-routing hygiene slice intentionally changed the generated Pi bridge to use the shared CLI route decision for parity.

## Proposed implementation

### Minimal option

In `packages/lifecycle/src/handlers.ts`, after detecting continuity intent and before recall:

1. If `policy.mode === "selective"` and intent family is `project-position` or `next-work`, render only `renderContinuityIntentGuidance(intent)` using `composePromptContext({ guidance, memoryContext: "", policy })`.
2. Return a context decision with:
   - `selected: 0`
   - `omitted: 0` initially, because recall was intentionally not run
   - `omittedReasons: ["broad-continuity-no-recall"]`
   - existing `continuityIntent`

This avoids stale recall bodies and keeps implementation small.

### Richer option

Use `engine.continuity({ query: input.prompt })` if available in core and render a compact read-model body similar to generated Pi. This would improve answer quality but may require adding a lifecycle renderer over core continuity models and additional tests. Since the current guidance already explicitly tells agents to inspect canonical continuity, minimal option is safer for the first bounded follow-up.

## Recommended approach

Use the minimal option for Slice 9.

Rationale:

- It directly fixes the validated pollution source: ordinary recall bodies on broad prompts.
- It preserves the existing answer contract: agents are guided to inspect canonical continuity before answering.
- It avoids introducing a second continuity renderer in lifecycle code.
- It keeps Pi behavior untouched for Slice 9; later routing-hygiene work aligned generated Pi routing through the shared CLI route decision.
- It has a small test surface and low regression risk.

A later enhancement can inject a compact continuity read model into Claude/Codex prompt context if evidence shows guidance-only broad prompts are too weak.

## Test plan

Add lifecycle tests in `packages/lifecycle/test/handlers.test.ts`:

1. `user-prompt selective broad next-work emits continuity guidance without relevant memory bodies`
   - Save an approved stale project fact mentioning `STALE NEXT SLICE BODY`.
   - Prompt: `What should we work on next?`.
   - Assert context includes `Memory Lane continuity guidance`.
   - Assert context includes `memory-lane continuity --json`.
   - Assert context does not include `## Relevant Memory`.
   - Assert context does not include stale body.
   - Assert `selected === 0`.
   - Assert `omittedReasons === ["broad-continuity-no-recall"]`.
   - Assert `continuityIntent.family === "next-work"`.

2. `user-prompt selective broad project-position emits continuity guidance without relevant memory bodies`
   - Prompt: `What were we last working on?`.
   - Same expectations, family `project-position`.

3. Existing topic-specific test `user-prompt selective emits continuity guidance before relevant memory` should remain valid:
   - Prompt: `Where was prompt continuity intents implemented?`.
   - Assert recall query remains `prompt continuity intents`.
   - Assert `## Relevant Memory` still appears.

4. Existing ordinary prompt and `pnpm` behavior remains unchanged.

5. Existing `hi` low-signal test remains unchanged.

Add adapter-level tests only if current tests have stable hook fixtures for Claude/Codex prompt-submit output. Lifecycle tests should be sufficient because both adapters call `handleUserPromptSubmit`.

## Verification commands

Before PR:

```bash
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/codex-adapter test
pnpm --filter @memory-lane/claude-adapter test
pnpm build
pnpm test
git diff --check
```

Manual installed/repo-local smoke after implementation:

```bash
printf '{"hook_event_name":"UserPromptSubmit","prompt":"what should we work on next?","cwd":"%s","session_id":"validation","turn_id":"next"}\n' "$PWD" \
  | node packages/cli/dist/index.js codex user-prompt-submit

printf '{"hook_event_name":"UserPromptSubmit","prompt":"hi","cwd":"%s","session_id":"validation","turn_id":"hi"}\n' "$PWD" \
  | node packages/cli/dist/index.js codex user-prompt-submit
```

Expected:

- broad prompt output includes continuity guidance and no `## Relevant Memory`;
- `hi` output remains `{}`.

## Documentation updates

Update after implementation:

- Validation doc or add a short Slice 9 validation note.
- `ROADMAP.md` Phase 21 status.
- `HANDOFF.md` current state / next step.
- README/skill docs only if user-facing behavior wording for broad prompt injection changes materially. Since existing docs already say broad continuity prompts should inspect continuity before targeted recall, README changes may be unnecessary unless tests reveal doc mismatch.
