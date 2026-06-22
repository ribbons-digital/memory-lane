# Phase 21 Slice 4 — Handoff Review + Cross-Session Continuity Validation

## Summary

Phase 21 Slice 4 validated the first behavior-bearing Phase 21 slices before moving toward automatic mode or workstream discovery:

- Slice 2: review-mode handoff proposals on existing continuity surfaces.
- Slice 3: cross-session continuity baseline marker for existing SessionStart newer-approved notices.

Verdict: **Proceed to automatic-mode design**.

Rationale: deterministic isolated-storage validation demonstrated that review-mode proposals are mode-gated, bounded, secret-filtered, and non-mutating; cross-session baseline behavior makes existing newer-approved notices fire across sessions without memory JSONL writes; diagnostics remain text-free; lifecycle output remains unchanged across handoff modes; and `automatic` remains inactive. The next step should be design/spec only, not immediate automatic-mode implementation.

## Environment

- Branch: `docs/phase-21-validation`
- Base at validation start: `ac7b5f1 feat: add cross-session continuity baseline (#35)`
- Validation worktree: `/Users/shiang/.config/superpowers/worktrees/memory-lane/phase-21-validation`
- Isolated temp root: `/var/folders/f6/lm8c20wn4yv1hyk_23y65yk40000gn/T/memory-lane-phase21-validation-yVzdMD`
- Storage policy: all write-capable validation used isolated temp memory/config/embedding paths.
- Real/default Memory Lane storage: not mutated.
- Live desktop clients: not exercised. Validation used deterministic lifecycle handlers, real CLI entrypoint commands against isolated storage, and MCP package handlers.

## Commands Run

Validation setup and scenario runner:

```bash
sfw pnpm install
pnpm build
node /tmp/phase21-slice4-validation-runner.mjs
```

Required verification, in the spec-required order:

```bash
pnpm build
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
git diff --check
```

Note: the first `pnpm build` in this fresh worktree failed before `sfw pnpm install` because `node_modules` was absent. After installing workspace dependencies with the project-required command, build and validation proceeded.

## Scenario Evidence

All memory bodies below are synthetic temp-store data. No real memory bodies or real continuity/proposal previews are included.

### A. Cross-session baseline marker

Source: isolated temp storage plus lifecycle `handleSessionStart()` and real CLI diagnostics.

| Check | Evidence |
| --- | --- |
| First SessionStart/no marker | No false newer-approved notice. Baseline source was `payload`; marker was written at `2000-01-01T00:00:00.000Z`. |
| Two-session newer-approved notice | Session B used marker baseline `2000-01-01T00:00:00.000Z`, reported `newerApprovedCount: 1`, and emitted the existing newer-approved continuity notice. |
| Read-before-write marker update | After Session B result construction, marker updated to `2100-01-01T00:00:00.000Z`. |
| `contextPolicy.mode: "off"` | No additional context, no continuity decision, and no marker file was written. |
| Invalid payload `since` | Non-canonical `2026-06-22T00:00:00Z` did not throw; resolved baseline source was `none`. |
| Corrupt marker | Invalid marker JSON did not throw; diagnostics reported `readable: false` and warning present. |
| Cross-project isolation | Project B marker did not become Project A's baseline; Project B synthetic text was absent from Project A SessionStart output. |
| No active project scope | Core no-scope API path had `projectScope: none`; marker record was a no-op. |
| Marker text-free fields | Sidecar version `1`; project marker fields were exactly `lastSeenAt`, `projectScope`, `updatedAt`. No text/id/prompt/transcript/tool/model/branch fields were present. |
| No memory JSONL writes by SessionStart | Only two explicit synthetic approved saves created memory rows; SessionStart marker handling created zero memory JSONL rows. |

### B. Review-mode handoff proposals

Source: isolated temp storage with synthetic pending continuity candidates.

| Check | Evidence |
| --- | --- |
| Manual mode | `handoffProposal` absent. |
| Review mode | `handoffProposal` present with `pendingCount: 7`, `items.length: 5`, `omittedCount: 2`. |
| Automatic mode | `handoffProposal` absent; mode remains inactive. |
| Existing actions only | Suggested actions were `memory-lane review --json` and bounded `memory-lane approve <id>` commands only. |
| Bounded previews | Max observed synthetic preview length was 41 chars. |
| Secret-filtering | A synthetic secret-like pending record was omitted from proposal items and did not appear in serialized proposal output. |
| No mutation | Store snapshot before and after continuity/proposal viewing was identical. |
| No proposal previews in diagnostics | `doctor()` had no `handoffProposal` field and did not include proposal preview text. |

### C. Diagnostics surfaces

Source: real CLI entrypoint against isolated storage and MCP package handlers.

| Check | Evidence |
| --- | --- |
| `memory-lane status --json` | Included `continuityBaseline` with state file/readable/source metadata; no memory text in baseline diagnostics. |
| `memory-lane doctor --json` | Included `continuityBaseline` with state file/readable/source metadata; no memory text in baseline diagnostics. |
| MCP `memory_status` | Package handler returned `continuityBaseline` diagnostics; no memory text in baseline diagnostics. |
| Handoff mode matrix | `manual`: active true, inspection-first note. `review`: active true, read-only proposal note. `automatic`: active false, declared/inactive note. |
| MCP continuity | Package-level MCP continuity path was exercised; live desktop MCP client was not available. |

### D. Lifecycle cross-mode boundary

Source: isolated temp storage, lifecycle `handleSessionStart()` and `handleUserPromptSubmit()`.

| Check | Evidence |
| --- | --- |
| SessionStart across modes | Output was identical for `manual`, `review`, and `automatic` when only `memory.handoffMode` varied. |
| UserPromptSubmit across modes | Output was identical for `manual`, `review`, and `automatic` when only `memory.handoffMode` varied. |
| Automatic inactive | `automatic` mode did not inject handoff bodies and did not emit proposal text. |

## Limitations

- No live desktop MCP client, Claude Code, Codex Desktop, or pi client was exercised during this validation session.
- MCP evidence used package-level handlers with isolated storage rather than a live MCP stdio client.
- Lifecycle evidence used shared handlers and real CLI entrypoints where practical, not live harness-generated events.

These limitations do not block the verdict because the validated behavior is implemented in shared core/lifecycle/MCP/CLI paths and all write-capable checks used isolated storage.

## Defects / Fixes

No product defects were found and no behavior code was changed in this validation slice.

One setup issue was encountered: this fresh worktree lacked `node_modules`, so the first `pnpm build` failed with `tsc: command not found`. It was resolved by running `sfw pnpm install` as required by project instructions. This did not change product code.

No README documentation gap was found: the README already documents the continuity baseline marker, review-mode handoff proposals, diagnostics, and guardrails.

## Required Verification Results

Final required verification passed after the validation report/doc updates were prepared:

- `pnpm build` — passed
- `pnpm --filter @memory-lane/core test` — passed
- `pnpm --filter @memory-lane/lifecycle test` — passed
- `pnpm --filter @memory-lane/cli test` — passed
- `pnpm --filter @memory-lane/mcp-server test` — passed
- `git diff --check` — passed

## Verdict

**Proceed to automatic-mode design.**

This means the next slice should be a design/spec slice for `memory.handoffMode: "automatic"`, with Opus 4.8 high-effort review and explicit user approval before implementation. It should not jump directly to implementation.

Evidence supporting the verdict:

- Review-mode proposals are useful, bounded, review-first, mode-gated, and non-mutating.
- Cross-session continuity baseline enables the existing newer-approved notice across sessions without writing memories or injecting handoff bodies.
- Diagnostics stay text-free and existing surfaces are sufficient.
- Lifecycle output remains stable across handoff modes.
- `automatic` remains inactive until explicitly designed and approved.

Recommended next slice: **Phase 21 Slice 5 — Automatic Mode Design and Safety Contract**.
