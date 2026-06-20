# Phase 18 Follow-up Design: Preference Diagnostics Metadata

Date: 2026-06-20
Status: Draft for review

## Goal

Expose text-free preference-layer diagnostics through existing status/doctor/MCP surfaces so users and MCP clients can inspect which preference pools may influence automatic context without dumping preference bodies or adding new commands/tools.

This is the deferred Phase 18 follow-up after PR #21 global preference layering.

## Background

PR #21 added bounded preference layering for automatic lifecycle context:

- current-project preferences
- current-project content
- bounded global preferences
- other global memory
- other visible project memory

It also added optional `memory.contextPolicy.preferenceMaxItems` and `preferenceMaxChars` fields. The remaining Phase 18 inspection gap is that `memory-lane status`, `memory-lane doctor`, and MCP `memory_status` expose the active policy budgets, but not the preference-layer pools or bounded selection counts that help explain why a global preference may or may not influence a session.

## Scope

In scope:

1. Add shared text-free preference diagnostics in core.
2. Surface diagnostics through existing:
   - `MemoryEngine.doctor()`
   - CLI `memory-lane doctor --json`
   - CLI `memory-lane status --json`
   - MCP `memory_status`
3. Add concise human status/doctor output for preference diagnostics when useful.
4. Update docs and roadmap wording now that PR #21 is merged.
5. Add tests proving diagnostics are count/metadata only and do not expose memory text.

Out of scope:

- New CLI commands.
- New MCP tools or schema-only tool additions.
- Lifecycle context-selection behavior changes.
- Prompt-time actual selected/omitted diagnostics for arbitrary future prompts.
- Automatic preference learning, approval, cleanup, rescope, delete, supersede, or semantic conflict resolution.
- Returning preference memory bodies in status/doctor/MCP surfaces.

## Definitions

### Preference-like memory

Same convention as PR #21 lifecycle selection:

A memory is preference-like when approved, visible in the current status scope, and any of the following is true:

- `category === "preference"`
- `kind === "preference"`
- `kind === "workflow_rule"`

### Preference diagnostics

A read-only, text-free summary of preference-like memories visible to the current project scope and how SessionStart preference caps would bound them.

It is an inspection model, not lifecycle injection and not recall.

## Desired metadata

Add a compact object to doctor/status/MCP status data. Suggested name:

```ts
interface PreferenceDiagnostics {
  projectScope: string | "none"
  visiblePreferenceCount: number
  currentProjectPreferenceCount: number
  globalPreferenceCount: number
  workflowRulePreferenceCount: number
  sessionStart: {
    maxPreferenceItems: number
    maxPreferenceChars: number
    selectedPreferenceCount: number
    omittedPreferenceCount: number
    selectedCurrentProjectPreferenceCount: number
    selectedGlobalPreferenceCount: number
  }
  notes: string[]
}
```

Rules:

- Counts are based on approved active memories only.
- Project visibility follows existing visible-in-scope behavior: current project + global by default; `--all` remains outside this slice.
- `currentProjectPreferenceCount` is zero when project scope is `none`.
- Other-project preference counts are out of scope because status/doctor/MCP diagnostics describe the current visible scope only. Do not inspect or report non-visible project-scoped preference pools.
- Scope counts and kind counts are overlapping dimensions; `workflowRulePreferenceCount` can overlap project/global counts. Only `visiblePreferenceCount` is the preference-like pool total.
- `sessionStart` counts are a baseline SessionStart preference-cap diagnostic, not a guarantee of actual lifecycle injection. Compute them over approved memories visible to the current project scope after excluding current operating-agreement primary/related ids, using the same preference-like classifier, layer order, duplicate omission, secret filtering, truncation, total caps, `preferenceMaxItems.sessionStart`, and `preferenceMaxChars.sessionStart` rules as baseline selection.
- Do not subtract dynamic continuity-notice text or adapter-specific runtime overrides from diagnostics. Add a note that actual lifecycle output may select fewer items when continuity notices consume budget or hooks pass overrides.
- `sessionStart.omittedPreferenceCount` is the visible preference-like pool count minus selected preference count, clamped at zero.
- `notes` are plain-language and text-free, e.g.:
  - "Global preferences are bounded by memory.contextPolicy.preferenceMaxItems.sessionStart and preferenceMaxChars.sessionStart."
  - "Pass --project or MCP projectPath to inspect project-specific preference layering."

## Surface behavior

### Core doctor

`MemoryEngine.doctor()` should include:

```json
{
  "preferenceDiagnostics": { ... }
}
```

It should also continue exposing the existing context policy scalar fields, including `contextPolicySessionStartMaxItems`, `contextPolicyPromptMaxItems`, etc. If missing today, doctor should include preference budget scalars too:

- `contextPolicySessionStartPreferenceMaxItems`
- `contextPolicyPromptPreferenceMaxItems`
- `contextPolicySessionStartPreferenceMaxChars`
- `contextPolicyPromptPreferenceMaxChars`

### CLI JSON

`memory-lane doctor --json` and `memory-lane status --json` should include the same `preferenceDiagnostics` object. They must not include preference text through this object.

### CLI human

Human `status`/`doctor` may add concise lines such as:

```text
Preference context: visible 3, selected for SessionStart 2, omitted 1
Preference caps: SessionStart 2 items / 600 chars, Prompt 2 items / 900 chars
```

Human output must not list preference bodies. Existing list/review/recall commands remain the explicit text-returning surfaces.

### MCP

`memory_status` should automatically include `data.status.preferenceDiagnostics` because it wraps `engine.doctor()`. `data.notes` may add one short text-free note explaining that preference diagnostics are counts only and MCP does not run lifecycle hooks.

No new MCP tool is added.

## Implementation shape

Preferred approach:

1. Add a core helper such as `buildPreferenceDiagnostics(memories, options)` in `packages/core/src/preference-diagnostics.ts`.
2. Add types to `packages/core/src/types.ts`.
3. Extract pure preference classifier/layering/budget helpers into core; update lifecycle to consume those helpers in behavior-preserving tests, or explicitly mark diagnostics as an estimate if lifecycle remains private. Implementation must avoid a core → lifecycle dependency.
4. Use existing context policy config from `MemoryEngine` to supply caps.
5. Expose through `MemoryEngine.doctor()`.
6. Update `contextPolicyDoctorKeys` and human context-policy formatting to include `contextPolicySessionStartPreferenceMaxItems`, `contextPolicyPromptPreferenceMaxItems`, `contextPolicySessionStartPreferenceMaxChars`, and `contextPolicyPromptPreferenceMaxChars` so human doctor output is concise and avoids duplicate raw scalar lines.
7. CLI and MCP consume doctor output as they already do.

## Docs polish

Update only Phase 18 ROADMAP/HANDOFF status wording and nearby deferred-follow-up text from "implemented locally" to merged/main wording after PR #21; do not rewrite later Phase 19+ scope.

Add README language that status/doctor/MCP status now show preference diagnostics as counts/metadata only, and that actual preference text remains available through explicit list/review/recall/continuity surfaces.

## Acceptance criteria

1. `MemoryEngine.doctor()` returns text-free `preferenceDiagnostics` with visible/current-project/global/sessionStart selected/omitted preference counts.
2. Existing CLI `status --json` and `doctor --json` include the diagnostics object and do not expose preference text through it.
3. Existing MCP `memory_status` includes the same diagnostics via doctor output and does not add a new tool.
4. Human status/doctor output, if changed, stays concise and text-free.
5. Tests cover:
   - global preference counts,
   - current-project preference counts with project scope,
   - SessionStart selected/omitted preference counts under `preferenceMaxItems`,
   - SessionStart selected/omitted preference counts under `preferenceMaxChars`,
   - `mode: "off"` and `mode: "policy-only"` reporting selected `0`,
   - duplicate preference text counted in the visible pool but selected once, matching lifecycle dedupe,
   - no preference text leakage in status/doctor/MCP diagnostics,
   - projectPath scoping in MCP status,
   - no CLI/MCP command/tool additions.
6. Docs update Phase 18 status to reflect PR #21 merged and this diagnostics slice scope.

## Risks and mitigations

### Risk: diagnostics imply prompt-time selection certainty

Mitigation: label computed counts as SessionStart diagnostics only. Prompt-time selection depends on the actual user prompt and recall result, so this slice only shows prompt preference caps, not prompt selected counts.

### Risk: duplication between lifecycle and core preference rules

Mitigation: keep the rule intentionally small and documented: category/kind/workflow_rule. If later lifecycle rules become more complex, move the shared classifier into core and import it from lifecycle.

### Risk: status surfaces become too noisy

Mitigation: JSON gets structured diagnostics; human output gets one or two concise lines only.

### Risk: memory text leaks through diagnostics

Mitigation: diagnostics expose counts, caps, and notes only. Tests must save unique preference body strings and assert they are absent from the serialized full outputs of `MemoryEngine.doctor()`, CLI `doctor --json`, CLI `status --json`, and MCP `memory_status`. Tests should also recursively assert `preferenceDiagnostics` contains only numbers, booleans/strings for labels/notes, and nested metadata objects—no ids, previews, or memory text.
