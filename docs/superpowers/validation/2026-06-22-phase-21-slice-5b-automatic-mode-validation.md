# Phase 21 Slice 5b — Automatic Mode Validation / Dogfooding

## Summary

Phase 21 Slice 5b validated the Slice 5a automatic handoff layer before adding workstream discovery or broader handoff-free automation.

Validated Slice 5a behavior:

- `memory.handoffMode: "automatic"` is behavior-active only for `SessionStart`.
- Automatic mode selects approved current-project `session_summary` / `project_checkpoint` handoff pointers only.
- The handoff layer is budget-neutral and can prevent a latest approved handoff pointer from being crowded out by generic recency selection.
- `manual` and `review` modes do not activate automatic handoff selection.
- `contextPolicy.mode: "off"` disables automatic context behavior.
- `policy-only` emits text-free handoff guidance without memory bodies.
- Diagnostics remain text-free through CLI status/doctor and MCP `memory_status`.
- No SessionStart memory JSONL writes or memory mutations were observed.

Verdict: **Automatic mode passes Slice 5b validation. Proceed next to workstream discovery design/spec unless new dogfooding evidence reveals a bounded safeguard issue.**

## Environment

- Validation branch: `docs/phase-21-automatic-mode-validation`
- Validation worktree: `/Users/shiang/.config/superpowers/worktrees/memory-lane/phase-21-automatic-mode-validation`
- Base commit: `b6d323e feat: add automatic handoff layer (#37)`
- Release baseline before validation: `v0.2.21` tag on `b6d323e`
- Isolated validation temp root: `/var/folders/f6/lm8c20wn4yv1hyk_23y65yk40000gn/T/memory-lane-phase21-5b-nxAxnJ`
- Storage policy: all write-capable validation used isolated temp memory/config/embedding paths except explicit real Memory Lane review/approval and release checkpoint queueing performed before this validation branch.
- Live desktop clients: not exercised. Validation used shared lifecycle handlers, real CLI entrypoints for Codex/Claude `SessionStart`, CLI status/doctor, and MCP package handlers.

## Pre-validation Project Hygiene and Release

Before starting Slice 5b validation, the agreed preconditions were completed:

1. **Pending Memory Lane continuity review/curation**
   - Approved 16 Memory Lane-scoped pending project facts/checkpoints covering Phase 18–20 merge/release continuity.
   - Left 4 Sitewright-scoped pending items untouched for Sitewright-specific review.

2. **Release current main**
   - Created and pushed tag `v0.2.21` at `b6d323e`.
   - Release workflow `27954672321` completed successfully.
   - Release URL: `https://github.com/ribbons-digital/memory-lane/releases/tag/v0.2.21`
   - Local pre-release verification passed before tagging:
     - `pnpm build`
     - `pnpm test`
     - `git diff --check`
     - clean `git status --short --branch`

A pending release checkpoint memory was queued separately for review.

## Commands Run

Dependency/setup in the validation worktree:

```bash
sfw pnpm install
pnpm build
```

Synthetic isolated validation runner:

```bash
node --import tsx ./phase21-slice5b-validation-runner.mjs
```

Runner output:

```json
{
  "ok": true,
  "tempRoot": "/var/folders/f6/lm8c20wn4yv1hyk_23y65yk40000gn/T/memory-lane-phase21-5b-nxAxnJ",
  "evidence": [
    "automatic/selective selected one latest approved handoff, kept maxItems=1/maxChars=500, crowded out generic recency, and wrote zero memory rows",
    "manual/review SessionStart remained free of automatic handoff metadata and label",
    "automatic/policy-only emitted handoff guidance without id/body/preview",
    "automatic/off produced no context and no automaticHandoff decision",
    "pending and expired handoff candidates were omitted",
    "CLI status/doctor diagnostics were text-free; Codex and Claude SessionStart entrypoints rendered latest approved handoff",
    "MCP memory_status exposed text-free automatic handoff diagnostics"
  ]
}
```

## Scenario Evidence

All handoff body strings below were synthetic temp-store sentinels. No real memory bodies, real transcripts, real prompts, or real tool outputs were used in the validation runner.

### A. Automatic + selective SessionStart

| Check | Evidence |
| --- | --- |
| Latest approved handoff wins under crowd-out pressure | With `maxItems.sessionStart = 1`, a newer generic `project_fact` was saved after an approved `session_summary`; automatic mode still rendered the handoff pointer under `### Latest approved handoff`. |
| Budget-neutral item cap | `contextDecision.maxItems` remained `1`; `selected` remained `1`. |
| Budget-neutral char cap | `contextDecision.maxChars` remained the configured `500`. |
| No duplicate/generic crowd-out body | The newer generic synthetic body was absent from the rendered context. |
| Lifecycle metadata | `contextDecision.automaticHandoff` reported `active: true`, `eligibleCount: 1`, `selectedCount: 1`, `omittedCount: 0`, and empty `omittedReasons`. |
| No memory mutation | Memory JSONL row count before and after `handleSessionStart()` was unchanged. |

### B. Manual and review modes

| Check | Evidence |
| --- | --- |
| Manual mode boundary | `manual` SessionStart did not render the `Latest approved handoff` label and did not include `automaticHandoff` metadata. |
| Review mode boundary | `review` SessionStart did not render the `Latest approved handoff` label and did not include `automaticHandoff` metadata. |
| Review-mode proposal boundary | This validation did not find proposal injection in SessionStart; review-mode handoff proposals remain limited to continuity surfaces from Slice 2. |

### C. Automatic + policy-only

| Check | Evidence |
| --- | --- |
| Text-free handoff guidance | Rendered context said an approved handoff pointer was available. |
| No memory body | The synthetic body `POLICY ONLY SECRET HANDOFF BODY` was absent. |
| Lifecycle metadata | `contextDecision.automaticHandoff` reported `active: true`, `eligibleCount: 1`, `selectedCount: 0`, and `omittedCount: 1`. |
| Observation | Current implementation/test expectations leave `omittedReasons` empty in this policy-only automatic metadata path. This is not a safety defect because no body/id/preview is exposed, but it may be worth tightening in a future diagnostics-polish slice if users need reason-level accounting. |

### D. Automatic + off

| Check | Evidence |
| --- | --- |
| Context suppressed | `additionalContext` was `undefined`. |
| Automatic metadata suppressed | `contextDecision.automaticHandoff` was `undefined`. |
| Off reason preserved | `contextDecision.omittedReasons` was `["off"]`. |

### E. Pending and expired handoff candidates

| Check | Evidence |
| --- | --- |
| Pending not injected | Pending synthetic `session_summary` handoff body was absent. |
| Expired not injected | Expired synthetic `project_checkpoint` handoff body was absent. |
| Omission metadata | `automaticHandoff.eligibleCount` was `0`; `omittedReasons` contained `expired`. |

### F. CLI status/doctor and SessionStart entrypoints

| Check | Evidence |
| --- | --- |
| CLI status diagnostics | `memory-lane status --json` reported `handoffMode: automatic`, behavior active, and `automaticHandoffDiagnostics.mode: active` with `eligibleCount: 1`. |
| CLI doctor diagnostics | `memory-lane doctor --json` reported equivalent text-free automatic handoff diagnostics. |
| Diagnostics text-free | The synthetic diagnostic handoff body was absent from serialized status/doctor JSON. |
| Codex SessionStart entrypoint | `memory-lane codex session-start` returned `hookSpecificOutput.hookEventName: "SessionStart"` and rendered `Latest approved handoff` with the synthetic body in selective mode. |
| Claude SessionStart entrypoint | `memory-lane claude session-start` returned `hookSpecificOutput.hookEventName: "SessionStart"` and rendered `Latest approved handoff` with the synthetic body in selective mode. |

### G. MCP status

| Check | Evidence |
| --- | --- |
| MCP status diagnostics | Package-level MCP `memory_status` returned `handoffMode: automatic`, `automaticHandoffDiagnostics.mode: active`, and `eligibleCount: 1`. |
| MCP diagnostics text-free | The synthetic MCP handoff body was absent from serialized MCP status JSON. |

## Limitations

- Live desktop MCP, Claude Code, Codex Desktop, and pi clients were not exercised in this validation session.
- MCP evidence used package-level `memory_status` handler calls with isolated storage rather than a live stdio MCP client.
- Codex/Claude evidence used real CLI entrypoints with synthetic hook payloads rather than live harness-generated events.
- The runner script was intentionally not committed as product code; it was a validation artifact.

These limitations do not block the verdict because the validated behavior lives in shared core/lifecycle code and thin CLI/hook entrypoints. A future live-client dogfood pass remains useful before broader automatic-mode rollout, but no behavior blocker was found for moving to the next design slice.

## Defects / Fixes

No product defects were found and no behavior code changed in this validation slice.

One diagnostics nuance was observed: `automaticHandoff.omittedCount` increments for policy-only mode, while `omittedReasons` remains empty. Existing tests expect this behavior. It is safe because no body/id/preview is exposed, but reason-level accounting could be polished later if diagnostics need to be more explanatory.

Setup issues encountered and resolved:

- The validation worktree initially had no `node_modules`; resolved with project-required `sfw pnpm install`.
- A first runner attempt from `/tmp` could not resolve workspace imports; resolved by running the validation artifact from the worktree with relative source imports.

## Required Verification Results

Final verification for this documentation/validation slice passed:

```bash
pnpm build
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
git diff --check
```

Observed package test summaries included:

- `@memory-lane/lifecycle`: 143 tests, 143 pass.
- `@memory-lane/cli`: 114 tests, 114 pass.
- `@memory-lane/mcp-server`: 39 tests, 39 pass.

No whitespace errors were reported by `git diff --check`.

## Verdict

**Proceed to workstream discovery design/spec next.**

Rationale:

- The automatic handoff layer stayed approved-only, project-scoped, SessionStart-only, and budget-neutral.
- Manual/review/off policy boundaries remained intact.
- Policy-only and diagnostics surfaces stayed text-free.
- Existing CLI/MCP/lifecycle surfaces were sufficient for validation.
- No evidence justified adding refresh, recall filtering, consolidation, retrieval rewrites, token retuning, viewer work, automatic approvals, or broader handoff injection before workstream discovery design.

Recommended next product slice after this PR lands: **Phase 21 Slice 6 / next Slice 5b+ capability — Natural-language workstream discovery design/spec**, starting with terminology and safety boundaries before implementation.
