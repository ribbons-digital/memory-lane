# SessionStart Descriptor Index Design

## Status

Approved and implemented for Slice A. Slice B structured descriptor persistence is tracked separately in `docs/superpowers/specs/2026-06-30-session-start-descriptor-metadata-design.md`.

## Entry gate

Slice A implementation approved by the user on 2026-06-30. Later slices remain gated on separate approval.

## Background

Memory Lane currently injects a bounded SessionStart context block when `memory.contextPolicy.mode` allows it. In `selective` mode, `handleSessionStart` renders:

1. a continuity notice; then
2. selected approved baseline memory bodies, capped by `memory.contextPolicy.maxItems.sessionStart` and `memory.contextPolicy.maxChars.sessionStart`.

The defaults are intentionally conservative: 4 memory bodies and 1600 chars, with separate preference caps. This prevents unbounded context pollution, but it still spends SessionStart budget on full memory bodies before the agent knows whether those details are needed.

Dogfooding and user feedback suggest a better default shape: inject a compact index of available high-value memories at session start, then steer the agent to fetch full bodies by id only when needed.

## Problem

Full-body SessionStart baseline injection is safe but not always optimal:

- Even bounded full bodies can consume unnecessary context window at the start of a session.
- The 4-item cap is appropriate for bodies but too low for compact descriptors.
- Large project checkpoints or session summaries are often useful as discoverable pointers, not as always-on body text.
- Raising `maxItems.sessionStart` without changing representation would risk context pollution.
- Across harnesses, Memory Lane needs token-aware lifecycle behavior that is useful in small windows and does not depend on any one harness.

## Goals

- Reduce SessionStart context cost while preserving cross-session discoverability.
- Support a wider SessionStart surface by injecting descriptor cards rather than full bodies for most memories.
- Keep critical always-on rules/preferences available without requiring a fetch.
- Make every descriptor actionable by including a stable memory id and clear fetch guidance.
- Keep behavior harness-neutral for Codex, Claude Code, Pi, future Cursor/Hermes integrations, and MCP-capable agents.
- Preserve backward compatibility for existing memory records and explicit `memory_get`/`memory_recall` full-fidelity tools.
- Make the policy budget-aware rather than simply increasing item counts; Slice A remains char-budget-aware using existing `maxChars` knobs, while true harness token-limit awareness is deferred.

## Non-goals

- No retrieval/ranking rewrite.
- No public eval command.
- No raw transcript indexing.
- No automatic consolidation or silent memory mutation.
- No requirement to migrate every existing memory before the feature works.
- No removal of full-body injection for critical small memories.
- No YAML parsing as the canonical storage model; YAML/frontmatter can be a display/import/export shape, but core storage should remain structured JSONL.

## Terminology

**Memory descriptor**: A compact, structured summary of a memory used for discovery. It should include the memory id, kind/category, short description, and optional fetch hint.

**Descriptor index**: The SessionStart section containing memory descriptors. It tells the agent what exists and when to fetch full details.

**Full-body memory**: The current rendered memory text. This remains available through explicit `memory_get <id>` and may still be injected for small critical rules.

**Always-on memory**: A tiny high-priority preference or workflow rule that should be followed immediately and is cheaper/safer to inject as text than as a descriptor that requires a fetch.

## Slice A record model

Slice A is schema-free. It must not add a `MemoryRecord.descriptor` field, change JSONL storage, or require migration of existing memories. SessionStart descriptor cards are generated deterministically from existing approved `MemoryRecord` fields.

Slice B adds optional structured descriptor metadata rather than embedding YAML in `text`:

```ts
interface MemoryDescriptorMetadata {
  description?: string
  fetchHint?: string
  keywords?: string[]
}

interface MemoryRecord {
  // existing fields...
  descriptor?: MemoryDescriptorMetadata
}
```

Future Slice B rationale:

- JSONL remains the canonical storage format.
- Existing records continue to work without migration.
- Obsidian mirror/import can render these fields as YAML frontmatter later, e.g. `description`, `fetchHint`, `keywords`.
- The lifecycle renderer can fall back to deterministic generated descriptions for older records.

### Slice A generated descriptor

For Slice A, generate a bounded description from existing data:

1. Prefer a first-sentence or boundary-truncated preview of `memory.text`.
2. Strip boilerplate prefixes only where existing helpers already do so safely.
3. Cap per-card text, e.g. 120-180 chars.
4. Never include secrets; reuse existing `containsLikelySecret` filtering.
5. Include id, kind, and scope group so the agent can fetch details.

Descriptor generation must run secret detection against the original full memory body before truncation or preview extraction. If the original body is secret-looking, omit the whole memory from both full-body and descriptor lanes; do not try to salvage a truncated preview.

## SessionStart rendering policy

Replace the current single body-selection concept with a hybrid policy:

1. Render the continuity notice first, sharing the SessionStart budget as today.
2. Select a tiny set of full-body always-on memories.
3. Fill remaining budget with descriptor cards.
4. Include explicit fetch instruction: use `memory_get <id>` or CLI `memory-lane show <id>` / `memory-lane get <id>` before relying on details not shown. Both `show` and `get` are supported CLI aliases today; tests should verify whichever instruction is rendered.

Example:

```xml
<memory-context mode="selective" event="sessionStart">
Continuity notice:
- Current workflow agreements are available. Inspect them before changing project process or operating agreements.

## Always-on Memory

- **Workflow rule**
  Use pnpm for package management.

## Memory Index

Memory Lane selected compact descriptors for this session. Fetch the full body only when needed with `memory_get <id>` or `memory-lane show <id>`.

### Current project

- [311283e6] Project checkpoint — v0.2.35 context-pollution hardening release. Fetch for prompt injection, low-signal filtering, or oversized-memory cleanup details.
- [1098781c] Project fact — Cross-harness review surfaced installer/onboarding preferences and context-pollution hygiene lessons. Fetch for installer UX or memory hygiene work.

### Global preferences and workflow rules

- [b3a4128f] Preference — Opus 4.8 review gate before Memory Lane specs and pre-PR implementation reviews. Fetch before planning/review gates.
</memory-context>
```

## Selection policy

This is a real SessionStart selection change, not only a text-format change. `handleSessionStart` currently performs one baseline selection pass and `renderMemoryBlock` only renders full bodies under `## Relevant Memory`. Slice A must add a parallel descriptor renderer and adjust SessionStart composition so `## Always-on Memory` and `## Memory Index` are preserved inside the existing guarded `<memory-context>` wrapper.

### Full-body always-on lane

Inject full bodies only for memories that are both small and immediately actionable. Candidate kinds:

- `workflow_rule`
- `preference`
- optionally `correction` only when it is tiny and immediately operational
- optionally small `procedure` records only when the procedure is likely required before tool use

The first slice should use an explicit `isAlwaysOnMemory` predicate rather than assuming existing `isPreferenceLikeMemory` covers all candidates. If Slice A derives caps from current preference caps for compatibility, non-preference corrections/procedures must still be separately bounded so they cannot crowd out descriptor breadth.

Suggested default caps:

```json
{
  "memory": {
    "contextPolicy": {
      "fullBodyMaxItems": { "sessionStart": 2, "prompt": 6 },
      "fullBodyMaxChars": { "sessionStart": 500, "prompt": 3000 }
    }
  }
}
```

Implementation may initially derive these from existing `preferenceMaxItems`/`preferenceMaxChars` to avoid config expansion in the first slice, but the design should leave room for explicit config once behavior is proven.

### Descriptor index lane

Descriptors should prioritize breadth under a strict budget:

- current project preferences/workflow rules;
- current project checkpoints/session summaries/decisions;
- global preferences/workflow rules;
- other visible project memory only when relevant and safely scoped.

Suggested default caps:

```json
{
  "memory": {
    "contextPolicy": {
      "descriptorMaxItems": { "sessionStart": 16, "prompt": 0 },
      "descriptorMaxChars": { "sessionStart": 1200, "prompt": 0 }
    }
  }
}
```

The exact first implementation can keep the public config smaller by using internal defaults under the existing `maxChars.sessionStart`, but descriptor count should not remain tied to the old body-oriented cap of 4.

### Overall budget

Do not simply raise the existing cap. Make Slice A SessionStart char-budget-aware by enforcing:

```text
continuity notice chars
+ always-on full-body chars
+ descriptor index chars
<= memory.contextPolicy.maxChars.sessionStart
```

If space is tight, preserve in this order:

1. continuity notice;
2. smallest highest-priority always-on rules;
3. descriptor cards;
4. lower-priority full bodies.

## Context decision metadata

Extend `MemoryContextDecision` with safe counts, not memory bodies. The top-level `selected` and `omitted` fields represent the overall hybrid SessionStart lifecycle decision: always-on full-body items plus descriptor-index items selected or omitted from the approved baseline candidate set. They do not represent only full-body items.

Descriptor-index-specific fields are scoped as follows:

- `descriptorIndex.selected`: descriptor cards selected for `## Memory Index` only.
- `descriptorIndex.omitted`: descriptor-eligible candidates omitted from `## Memory Index` only.
- `descriptorIndex.generatedFallbackCount`: selected descriptor cards whose preview was generated from existing memory text. Slice B keeps this field but excludes cards that use structured `descriptor.description`.
- `descriptorIndex.fullBodySelected`: always-on full-body items selected for `## Always-on Memory`.
- `descriptorIndex.fullBodyOmitted`: always-on-eligible full-body candidates omitted from `## Always-on Memory`.

```ts
interface MemoryContextDecision {
  // existing top-level fields keep overall hybrid lifecycle semantics.
  descriptorIndex?: {
    injected: boolean
    maxItems: number
    maxChars: number
    effectiveMaxChars: number
    selected: number
    omitted: number
    generatedFallbackCount: number
    fullBodySelected: number
    fullBodyOmitted: number
  }
}
```

No text previews, transcript content, or tool outputs should be written to debug logs.

## CLI / MCP implications

- `memory_get <id>` remains the authoritative full-body fetch path.
- `memory_recall <query>` remains full-fidelity because it is explicitly invoked.
- A future `memory_list`/`memory_index` surface could expose descriptors directly, but this slice can start with lifecycle rendering only.
- Existing `memory-lane show/get <id>` remains sufficient for CLI fetch guidance.

## Obsidian / YAML frontmatter implications

The user-facing mental model can be YAML frontmatter:

```md
---
id: 1098781c
kind: project_fact
description: Cross-harness installer/onboarding and memory hygiene lessons.
fetchHint: Fetch for installer UX, harness setup, or context hygiene work.
keywords: [installer, onboarding, hygiene, harnesses]
---
Full memory body...
```

But this should be a rendered/import/export representation, not the canonical in-memory schema. Core should store structured fields and mirror them to YAML where useful.

## Backward compatibility

- Existing memories without descriptors render using generated fallback descriptors.
- Existing config continues to work.
- `selective`, `policy-only`, and `off` retain their meaning.
- `policy-only` must return before descriptor selection, just as it returns before full-body baseline selection today; descriptors are memory context and must not leak into policy-only mode.
- `off` injects no continuity notice, full bodies, or descriptors.
- Existing top-level `MemoryContextDecision.maxItems`, `maxChars`, `selected`, and `omitted` should keep compatibility semantics for the overall lifecycle decision; descriptor-specific counts belong in the nested `descriptorIndex` object.
- Existing full-body prompt-time injection behavior should not change in this slice unless explicitly included.
- Existing tests for bounded context should be updated to assert total budget, not exact old body count.

## Proposed implementation slices

### Slice A — Descriptor renderer and SessionStart hybrid selection

- Add descriptor helper types and rendering in lifecycle only.
- Add generated fallback descriptors from existing records.
- Split SessionStart selection into always-on bodies plus descriptor cards under the existing overall char budget.
- Decide automatic-handoff interaction explicitly: automatic handoff pointers should appear once, either as a high-priority descriptor or an always-on body, but never both.
- Lift descriptor item count internally while preserving total char cap.
- Add tests for budget, ids, fetch guidance, policy modes, automatic-handoff no-duplication, and no secret leakage.

### Slice B — Structured descriptor persistence

- Add optional `descriptor` field to `MemoryRecord`.
- Preserve it through save/update/replace/list/show JSON paths.
- Keep it optional and non-breaking.
- Add CLI display in `show --json` and human `show` only where useful.

### Slice C — Obsidian/frontmatter rendering and optional import support

- Render descriptor metadata as YAML frontmatter in mirror files.
- For explicit Obsidian import, preview descriptor fields before applying.
- Do not import generated mirror files.

### Slice D — Token-aware policy refinement

- Add explicit descriptor/full-body caps if dogfooding shows internal defaults are insufficient.
- Consider harness-reported context limits when available.
- Keep fallback behavior deterministic when harness token limits are unavailable.

## Validation for Slice A

Run:

```bash
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/cli test
pnpm test
pnpm build
git diff --check
```

Focused tests should cover:

- SessionStart uses descriptor cards beyond the old 4-item body cap while staying under `maxChars.sessionStart`.
- Descriptor cards include memory ids and fetch instruction.
- Full-body lane remains small and preference/workflow-rule-oriented.
- Long checkpoint/session-summary memories are rendered as descriptors, not full bodies.
- `policy-only` injects no memory bodies/descriptors except guidance/continuity notices.
- `off` injects nothing.
- Automatic handoff pointers are not double-rendered as both a body and descriptor.
- Secret-looking text is omitted from both lanes.
- Explicit `memory_get` still returns full text.

## Risks and mitigations

- **Agent may under-fetch details.** Mitigation: inject clear instruction to fetch full body before relying on details, and keep critical tiny rules full-body.
- **Descriptors may be too vague.** Mitigation: structured `description`/`fetchHint` fields plus fallback generation; test card usefulness on real dogfood prompts.
- **Config complexity.** Mitigation: start with internal descriptor defaults under existing `maxChars.sessionStart`; add public config only after evidence.
- **Loss of current helpful behavior.** Mitigation: hybrid lane keeps small critical rules as full bodies.
- **Schema expansion too early.** Mitigation: Slice A can be lifecycle-only with generated descriptors; structured persistence can be Slice B.

## Open decisions

1. Should Slice A avoid schema changes entirely and use generated descriptors only?
2. What first default descriptor budget is best: 12, 16, or budget-only with no item cap beyond safety maximum?
3. Which memories qualify for always-on full-body injection beyond preferences/workflow rules?
4. Should `memory.contextPolicy.maxItems.sessionStart` continue to refer to full bodies only, or become a total selected-item diagnostic with separate internal caps?
5. Should descriptor cards appear at prompt-time for continuity/resume prompts, or remain SessionStart-only initially?

## Recommendation

Start with Slice A as a lifecycle-only, non-schema implementation:

- no storage migration;
- generated descriptors only;
- full bodies limited to tiny current-project/global workflow rules and preferences;
- descriptor cards allowed beyond the old 4-item body cap but bounded by existing `maxChars.sessionStart`;
- explicit fetch guidance by id.

This validated the product behavior before adding persistent descriptor metadata in Slice B. YAML/frontmatter support remains deferred.
