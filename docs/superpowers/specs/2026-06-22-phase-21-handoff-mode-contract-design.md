# Phase 21 Slice 1 — Handoff Mode Contract Design

## Status

Draft for Opus 4.8 review.

## Context

Phase 20.5 validated that Memory Lane can exit Phase 20. The next roadmap item is Phase 21: handoff-free sessions. Phase 21 should make cross-session and cross-harness continuity smoother without abandoning Memory Lane's review-first, low-noise, harness-neutral posture.

This first slice defines the handoff-mode contract and exposes it through existing diagnostics. It does not change lifecycle injection behavior yet.

## Problem

Memory Lane has several continuity mechanisms, but no explicit user-visible posture for how proactive it should be:

- Existing behavior is effectively manual/inspection-first.
- Future review-mode behavior needs to remain review-first: generated progress should become pending candidates before future sessions rely on it.
- Future automatic behavior needs an explicit opt-in boundary before approved summaries/checkpoints/preferences become eligible for stronger SessionStart continuity.
- Users and adapters need a stable config contract before implementation changes lifecycle behavior.

Without this contract, future Phase 21 slices could blur configuration, context-policy budgets, review boundaries, and automatic handoff behavior.

## Goals

1. Add a non-breaking `memory.handoffMode` config contract with values `manual`, `review`, and `automatic`.
2. Default to `manual`, preserving current behavior for existing users.
3. Validate invalid handoff-mode values with normal config validation.
4. Surface handoff mode through existing read-only status/doctor/MCP status diagnostics.
5. Document that `review` and `automatic` are declared but not active in Slice 1.
6. Add regression coverage proving Slice 1 does not change lifecycle context output.

## Non-goals

Out of scope for Slice 1:

- No change to `SessionStart`, `UserPromptSubmit`, `Stop`, `PostToolUse`, `SessionEnd`, or pi lifecycle behavior.
- No new memory writes or pending candidates.
- No review-mode generation behavior.
- No automatic mode injection behavior.
- No raw transcript or raw tool-output capture.
- No new CLI commands, MCP tools, schema migrations, or adapter payload fields.
- No recall ranking/filtering changes.
- No token-budget retuning.
- No refresh or consolidation behavior.
- No per-project handoff-mode override; this slice adds only global config.

## Terminology

Add or update these domain terms in `CONTEXT.md`:

- **Handoff mode**: The configured continuity posture for how proactive Memory Lane should be across sessions. It is separate from context policy: handoff mode decides the continuity posture, while context policy decides whether and how much memory body content can be injected.
- **Manual handoff mode**: Default mode. Existing inspection-first behavior; users and agents rely on explicit review/status/list/continuity surfaces and current bounded notices.
- **Review handoff mode**: Declared future mode. Generated handoff/progress continuity remains pending until review approval before future sessions rely on it. In Slice 1 it behaves like manual mode.
- **Automatic handoff mode**: Declared future mode. Approved handoff-relevant records may become eligible for stronger budgeted SessionStart continuity. In Slice 1 it behaves like manual mode.

Avoid terms that imply implemented behavior in Slice 1, such as automatic handoff injection, auto-resume, or thread memory.

## Mode semantics

### `manual`

Default and currently active. Existing behavior is unchanged:

- Users inspect continuity through `memory-lane continuity`, `memory-lane dashboard`, `memory-lane status`, `memory-lane review`, and MCP equivalents.
- Existing lifecycle continuity notices remain governed by current context policy.
- No new handoff-specific injection is added.
- No new memories are written because of handoff mode.

### `review`

Reserved for a later Phase 21 slice. In Slice 1:

- Config validation accepts `review`.
- Status/doctor/MCP status report it as configured.
- Runtime behavior remains identical to `manual`.
- Diagnostics should make clear that this mode is declared but not yet behavior-active.

Future intent: generated session/progress handoff candidates remain pending and require review approval before future sessions use them as durable continuity.

### `automatic`

Reserved for a later Phase 21 slice. In Slice 1:

- Config validation accepts `automatic`.
- Status/doctor/MCP status report it as configured.
- Runtime behavior remains identical to `manual`.
- Diagnostics should make clear that this mode is declared but not yet behavior-active.

Future intent: approved session summaries, checkpoint memories, and relevant global preferences may become eligible for stronger budgeted SessionStart continuity. This must remain opt-in and budgeted.

## Data model and config

Add:

```ts
export type HandoffMode = "manual" | "review" | "automatic"
```

Add to the top-level `memory` config block:

```ts
memory?: {
  handoffMode?: HandoffMode
  sessionEndSummary?: SessionEndSummaryConfig
  contextPolicy?: MemoryContextPolicyConfig
}
```

Default:

```json
{
  "memory": {
    "handoffMode": "manual"
  }
}
```

Validation:

- Missing `handoffMode` defaults to `manual`.
- Add `handoffMode: "manual"` to `DEFAULT_CONFIG.memory`.
- Validate the field from `validateConfig` alongside `validateContextPolicyConfig` and `validateSessionEndSummaryConfig`.
- Read doctor/status defensively with `this.config.memory?.handoffMode ?? "manual"` so partial legacy configs never report `undefined`.
- Valid values: `manual`, `review`, `automatic`.
- Any other value throws `ConfigError` with a clear path, e.g. `memory.handoffMode must be manual, review, or automatic`.

## Diagnostics contract

Expose the following through `MemoryEngine.doctor()`, CLI `status --json`, CLI `doctor --json`, MCP `memory_status`, and human `doctor` output:

```ts
handoffMode: "manual" | "review" | "automatic"
handoffModeBehaviorActive: boolean
handoffModeNote: string
```

For Slice 1:

- `handoffModeBehaviorActive` is `true` only when `handoffMode === "manual"` because manual is the only behavior-active mode.
- `handoffModeNote` is canonical and should use these exact strings:
  - `manual`: `Current inspection-first behavior is active.`
  - `review`: `Declared for Phase 21; currently behaves like manual mode.`
  - `automatic`: `Declared for Phase 21; currently behaves like manual mode.`

Human `memory-lane doctor` should render a compact handoff-mode block mirroring the context-policy style. Human `memory-lane status` does not currently render context-policy-style blocks; Slice 1 should not expand it unless needed for consistency. It is sufficient for human `status` to keep its current compact shape while `status --json` includes the fields.

Status/doctor surfaces must not include memory bodies.

## Lifecycle behavior contract

Slice 1 must not change lifecycle output. In current code, lifecycle injection functions receive `MemoryContextPolicyConfig`, not the full `memory` config block, so they cannot read `handoffMode` directly. Make that explicit in tests and docs.

Primary no-behavior-change regression:

- For a fixed memory store and config that varies only by `memory.handoffMode`, `MemoryEngine.doctor()` / status JSON output may differ only in `handoffMode`, `handoffModeBehaviorActive`, and `handoffModeNote`.
- Context-policy diagnostics, continuity metadata, and other doctor/status fields must remain unchanged.

If a lifecycle-level regression is practical, add one asserting adapter/session-start additional context remains identical for configs whose only difference is handoff mode. Do not pass `handoffMode` into shared injection helpers as if it were part of `MemoryContextPolicyConfig`.

## MCP contract

Do not add MCP tools or change existing tool names. `memory_status` should include handoff-mode diagnostics because it already mirrors status/doctor metadata.

`memory_continuity` behavior is unchanged in Slice 1. It may mention existing continuity guidance, but not handoff-mode behavior.

## CLI contract

Do not add new CLI commands. Existing `memory-lane doctor` human output and JSON status/doctor variants should show handoff mode. Human `memory-lane status` may remain compact and unchanged; `memory-lane status --json` is the authoritative status surface for handoff-mode fields.

Human doctor output should be compact, for example:

```text
Handoff mode
  mode: manual
  behavior active: yes
  note: Current inspection-first behavior is active.
```

For inactive modes:

```text
Handoff mode
  mode: review
  behavior active: no
  note: Declared for Phase 21; currently behaves like manual mode.
```

## Documentation updates

Update:

- `README.md`: configuration section explaining handoff mode, the default, the distinction from context policy, and the Slice 1 inactive boundary for `review`/`automatic`.
- `ROADMAP.md`: mark Phase 21 Slice 1 as implementing the handoff-mode contract only.
- `HANDOFF.md`: record the slice and its explicit non-behavior-changing boundary.
- `CONTEXT.md`: add the handoff-mode terms above.

Do not update personal/global skill files in this repository slice. The tracked `skills/memory-lane/SKILL.md` does not need a Slice 1 update because `review` and `automatic` are inert; update it only in a later behavior slice when user-facing skill guidance changes.

## Test requirements

Add tests for:

1. Default config uses `manual` when `memory.handoffMode` is absent.
2. Config accepts `manual`, `review`, and `automatic`.
3. `validateConfig` / `loadConfig` rejects invalid values with `ConfigError`.
4. `MemoryEngine.doctor()` reports `handoffMode`, `handoffModeBehaviorActive`, and canonical `handoffModeNote`.
5. CLI human `doctor` output includes the handoff mode block; human `status` may remain compact.
6. CLI JSON status/doctor includes the handoff mode fields.
7. MCP `memory_status` includes the handoff mode fields via `engine.doctor()`.
8. For a fixed store, doctor/status JSON output for `manual`, `review`, and `automatic` differs only in the three `handoffMode*` fields.
9. If lifecycle-level coverage is practical, lifecycle/session-start context output is unchanged for `review` and `automatic` compared with `manual` in Slice 1.

## Acceptance criteria

The slice is complete when:

1. `memory.handoffMode` is typed, defaulted, validated, and documented.
2. Existing behavior is unchanged for all three configured values.
3. Doctor, status JSON, doctor JSON, and MCP status expose memory-body-free handoff-mode diagnostics.
4. Tests cover defaults, valid values, invalid values, doctor/status/MCP visibility, and no behavior change outside `handoffMode*` diagnostics.
5. README, ROADMAP, HANDOFF, and CONTEXT are updated.
6. Verification passes:
   - `pnpm --filter @memory-lane/core test`
   - `pnpm --filter @memory-lane/cli test`
   - `pnpm --filter @memory-lane/mcp-server test`
   - `pnpm build`
   - `git diff --check`

## Risks and mitigations

- **Risk: Users think `review` or `automatic` already changes behavior.** Mitigation: diagnostics and docs explicitly say they are declared but inactive in Slice 1, using canonical note strings.
- **Risk: Handoff mode is confused with context policy.** Mitigation: docs and CONTEXT define handoff mode as continuity posture and context policy as injection budget/selection behavior.
- **Risk: Scope creep into lifecycle behavior.** Mitigation: regression tests prove no behavior change.
- **Risk: Config breaks existing users.** Mitigation: optional field with `manual` default and clear validation.

## Open questions

None. The design deliberately reserves behavior changes for later Phase 21 slices after this contract is visible and testable.
