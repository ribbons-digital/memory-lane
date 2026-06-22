# Phase 20 Slice 6 — Freshness Advisory Human-Output Polish Plan

## Spec

- `docs/superpowers/specs/2026-06-22-phase-20-freshness-advisory-human-output-design.md`

## Definition of done

- Human `memory-lane status --since ...` and `memory-lane doctor --since ...` render bounded manual dry-run freshness advisory actions when stale/expired approved visible memories exist.
- Human `memory-lane continuity` renders a dedicated freshness advisory action block sourced from `model.freshness.advisory`, not from substring matching generic actions.
- Freshness advisory human output remains text-free and does not suggest `reject`/`delete`.
- JSON contract shape is unchanged.
- README/ROADMAP/HANDOFF are updated; no CONTEXT update expected.

## Steps

1. Add formatter helper(s) in `packages/cli/src/formatters.ts` for freshness advisory action lines.
2. Wire helper into `formatFreshnessSummary` / status / doctor human paths without changing JSON output.
3. Wire helper into `formatContinuityReadModel`, avoiding duplicate generic freshness command lines.
4. Add CLI tests for status/doctor/continuity human output, bounding, non-leakage, destructive-action absence, and JSON stability.
5. Update README/ROADMAP/HANDOFF.
6. Verify with `pnpm --filter @memory-lane/cli test`, `pnpm build`, `pnpm test`, and `git diff --check`.
7. Request independent review focused on guardrails before PR.
