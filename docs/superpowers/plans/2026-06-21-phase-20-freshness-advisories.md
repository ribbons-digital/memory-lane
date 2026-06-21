# Phase 20 Slice 4 — Read-only Freshness Advisories Plan

## Entry gate

User approved the Opus 4.8 recommendation to implement Phase 20 Slice 4 as read-only freshness advisories and said to continue.

## Definition of done

- Existing freshness metadata is classified as `none | current | stale | expired` for approved visible memories.
- Existing status/doctor/MCP status and continuity read-model surfaces expose text-free advisory counts/metadata.
- Continuity hints/warnings include `freshness-advisory` when expired/stale visible approved memories exist.
- No new commands/tools/flags/payload fields are introduced.
- No recall, injection, cleanup, refresh, consolidation, approval, rejection, deletion, or ranking behavior changes are introduced.
- Tests and docs cover the advisory behavior.

## Implementation todos

1. Update core types for freshness classification, advisory metadata, `referenceNow`, and continuity hint/warning codes.
2. Implement classification and advisory aggregation in `packages/core/src/freshness.ts`.
3. Wire `freshness-advisory` through `packages/core/src/continuity-hints.ts` and `packages/core/src/continuity-read-model.ts`.
4. Update CLI human status/doctor/continuity formatting only if existing generic rendering does not make the advisory visible; keep JSON text-free.
5. Add tests and docs, then run verification and request independent review.

## Verification plan

Run:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm build
pnpm test
git diff --check
```

## Review focus

Ask reviewer to check:

- No behavior changes to recall/injection/cleanup/refresh/consolidation.
- No new CLI/MCP commands/tools/flags.
- No memory text in freshness advisory metadata.
- Strict timestamp validation and deterministic `referenceNow` tests.
- `capturedAt` is preferred over `updatedAt`, with `updatedAt` fallback only for stale-window calculation.
