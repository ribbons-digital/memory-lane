# Phase 20 Slice 5 — Actionable Freshness Advisory Plan

## Entry gate

User approved the Opus 4.8 consensus recommendation to implement actionable freshness advisories and explicitly defer a dedicated `memory-lane refresh` command.

## Definition of done

- Stale/expired freshness advisory entries include deterministic, text-free suggested existing revision commands.
- Suggestions use actual memory ids and are dry-run-biased.
- Existing status/doctor/MCP status and continuity read-model surfaces expose the suggestions without memory text.
- No new commands, MCP tools, config, lifecycle payloads, mutations, recall/injection changes, cleanup, or consolidation behavior are added.
- Tests and docs cover behavior and boundaries.

## Implementation todos

1. Update core freshness metadata types and classification metadata to include per-id `suggestedActions` for stale/expired entries.
2. Aggregate those per-id actions into the existing `freshness-advisory` continuity hint suggestions.
3. Add/adjust core, CLI, and MCP tests for suggestions, bounding, text-free JSON, and read-only behavior.
4. Update README/CONTEXT/ROADMAP/HANDOFF to document dry-run advisory actions and deferred refresh command.
5. Run verification, request independent review, repair blockers, then open a PR and stop for user merge.

## Verification plan

Run:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
pnpm build
pnpm test
git diff --check
```

## Review focus

Ask reviewer to verify:

- No new commands/tools/flags/config/payloads.
- No recall/injection/filtering/ranking changes.
- No mutation/cleanup/refresh/consolidation behavior.
- No destructive `reject`/`delete` suggestions.
- Suggestions are text-free, deterministic, bounded, and use existing dry-run revision commands.
