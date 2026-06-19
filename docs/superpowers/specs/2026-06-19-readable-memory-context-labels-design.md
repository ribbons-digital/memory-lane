# Readable Memory Context Labels Design

## Status

Draft — Slice A of the cross-harness continuity explainability work.

## Context

Manual testing across Sitewright in Codex Desktop and Claude Code CLI showed that Memory Lane can retrieve useful continuity context, but the injected `Relevant Memory` block is hard to understand when it mixes current-project memories with global preferences or workflow rules.

The current rendering is text-first:

```md
## Relevant Memory

- Librarian skill warning — ...
- Memory system design intent — ...
- Latest Sitewright checkpoint — ...
```

That leaves users and agents unable to quickly tell:

- whether a memory applies to the current project or globally;
- whether a memory is a preference, project fact, workflow rule, or checkpoint;
- why apparently cross-project memories are visible in a different project session;
- whether confusing context is a selection bug, a scoping mistake, or a valid global preference.

Semantic search already works for recall quality, but it does not make injected context explainable. This slice improves readability and provenance cues without changing selection behavior.

## Goals

1. Make lifecycle-injected memory context readable for humans in visible harness output.
2. Clearly separate current-project memories from global memories and any other visible scope.
3. Render plain-language memory type labels such as `Project checkpoint`, `Workflow rule`, and `Preference`.
4. Preserve existing context budgets and non-breaking lifecycle behavior.
5. Keep the change harness-neutral so Claude Code, Codex, pi, and future adapters share the same rendering.

## Non-goals

- Do not change recall ranking, semantic weighting, or memory selection.
- Do not hide global memories or change eligibility rules.
- Do not add new config flags.
- Do not add automatic memory cleanup, rescoping, or mutation.
- Do not add pending review visibility; that is a later slice.
- Do not add selection score explanations or “why selected” ranking details in this slice.

## Terminology

No new glossary term is required. This slice uses the descriptive phrase **memory context label** for implementation/spec discussion only: a plain-language label rendered near an injected memory to identify scope, category, and kind.

## Proposed user experience

Instead of a flat list, `renderMemoryBlock` should group selected approved memories by applicability:

```md
## Relevant Memory

Memory Lane selected these approved memories for this session. They may include current-project memories and global preferences or workflow rules.

### Current project

- **Project checkpoint**
  Latest Sitewright checkpoint (2026-06-16) — Main is clean after commit...

### Global preferences and workflow rules

- **Workflow rule**
  HANDOFF.md sync rule — @HANDOFF.md should always be kept in sync...

- **Tooling preference**
  Librarian skill warning — Do not use the pi-web-access librarian skill...
```

If the renderer cannot identify a current project key, project-scoped memories should still be labeled plainly:

```md
### Project-specific memory

- **Project fact**
  This repo uses pnpm for tests.
```

If selected memories include records from a project scope that is not the current project scope, they should be separated instead of silently mixed:

```md
### Other visible project memory

- **Project fact**
  Memory system design intent — ...
```

This does not decide whether those records should have been selected. It makes the situation visible so later slices can address selection or scope hygiene with evidence.

## Rendering rules

### Inputs

`renderMemoryBlock` currently accepts only `MemoryRecord[]`. To distinguish current-project from other-project memories, the lifecycle rendering path should be able to pass an optional current project key, derived from existing project scope/cwd information already available to recall and context rendering.

Proposed shape:

```ts
interface MemoryBlockRenderOptions {
  projectScope?: string
}
```

The existing function signature can remain source-compatible by making options optional:

```ts
renderMemoryBlock(memories: MemoryRecord[], options?: MemoryBlockRenderOptions): string
```

### Grouping

For each selected memory:

1. If `scope.type === "project"` and `scope.key === options.projectScope`, group under `Current project`.
2. If `scope.type === "global"` and the memory is category `preference`, kind `workflow_rule`, or otherwise preference-like, group under `Global preferences and workflow rules`.
3. If `scope.type === "global"` but not preference-like, group under `Global memory`.
4. If `scope.type === "project"` and there is no `options.projectScope`, group under `Project-specific memory`.
5. If `scope.type === "project"` and the key differs from `options.projectScope`, group under `Other visible project memory`.
6. Otherwise, group under `Other visible memory`.

Group order should be stable and readability-first:

1. Current project
2. Project-specific memory
3. Global preferences and workflow rules
4. Global memory
5. Other visible project memory
6. Other visible memory

Within each group, preserve the existing selected-memory order. This avoids changing ranking semantics.

### Human labels

The bold label should be plain English and based on `kind`, with category fallback.

Suggested mappings:

- `project_checkpoint` → `Project checkpoint`
- `workflow_rule` → `Workflow rule`
- `session_summary` → `Session summary`
- `project_fact` → `Project fact`
- `preference` → `Preference`
- unknown/other kind → title-cased kind with underscores replaced, or category fallback

Avoid compact slash labels such as `[global/preference/workflow_rule]` because the explicit product direction is readability over compactness.

### Budget behavior

Existing budget enforcement happens before rendering and counts only selected memory text length. Adding headings and labels increases final rendered characters slightly.

For this slice:

- Preserve existing memory selection budget behavior.
- Keep labels and group headings short.
- Do not redesign budget accounting or token policy.

A later token-policy slice may account for rendered overhead more precisely.

## Harness behavior

All hook adapters should benefit through the shared lifecycle renderer:

- Claude Code `SessionStart` and `UserPromptSubmit` receive readable grouped context.
- Codex `SessionStart` and `UserPromptSubmit` receive readable grouped context.
- pi read-only lifecycle recall receives readable grouped context where it uses the same renderer.
- MCP explicit tools are not changed by this slice because they already return structured list/review/status surfaces.

## Acceptance criteria

1. `renderMemoryBlock` renders selected memories under readable group headings instead of a flat opaque list.
2. Current-project, global, and other-project/project-specific memories are distinguishable in rendered context.
3. Memory type labels are plain English, not compact slash metadata.
4. Existing selection behavior and selected-memory order within groups are preserved.
5. Existing lifecycle tests still pass, and new tests cover current-project, global preference/workflow, unknown project scope, and other-project grouping.
6. README lifecycle/context-policy docs mention that injected memory blocks are grouped and labeled for readability.
7. `CONTEXT.md` remains unchanged unless a durable domain term is introduced; this slice should not require one.

## Risks and mitigations

- **Risk:** More headings slightly increase context size.
  - **Mitigation:** Keep labels short and avoid changing memory body selection budgets in this slice.

- **Risk:** Grouping by scope may appear to imply selection correctness.
  - **Mitigation:** Intro text says memories “may include” current-project and global items; this slice explains applicability but does not claim ranking rationale.

- **Risk:** Other-project memories become more visibly surprising.
  - **Mitigation:** That is intentional; later scope hygiene work can address whether they should be selected.

## Follow-up slices

1. Project-first SessionStart selection and budgeting.
2. Pending review visibility in hooks.
3. Global memory hygiene hints for global memories that look project-specific.
