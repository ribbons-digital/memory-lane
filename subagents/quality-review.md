# Quality Review: Slice B project-first SessionStart selection

Approval status: **Approved**

## Findings by severity

### Blocker
- None found.

### Major
- None found.

### Minor
- None found.

### Notes / evidence
- Requested `plan.md` and `progress.md` at the repo root were not present; review proceeded from `main...HEAD`, the committed docs, and changed files.
- TypeScript correctness verified: `pnpm --filter @memory-lane/lifecycle build` passed.
- Test coverage verified: `pnpm --filter @memory-lane/lifecycle test` passed (76/76).
- Comparator behavior matches the Slice B intent: `BaselineSelectionOptions` adds optional `projectScope`, `baselineTier` prioritizes current-project, global, other-project, then other memories, and recency is preserved within each tier (`packages/lifecycle/src/injection.ts:21`, `packages/lifecycle/src/injection.ts:601`, `packages/lifecycle/src/injection.ts:609`). With no project scope, all candidates remain in tier 0, preserving recency-first selection (`packages/lifecycle/src/injection.ts:602`, `packages/lifecycle/src/injection.ts:613`).
- Budget, deduplication, secret filtering, and truncation behavior are preserved: `selectBaselineMemories` still filters approved non-secret records, uses the same normalized-text `seen` set, calculates remaining hard budget, and calls `fitMemoryWithinBudget` in the existing selection loop (`packages/lifecycle/src/injection.ts:621`, `packages/lifecycle/src/injection.ts:626`, `packages/lifecycle/src/injection.ts:633`, `packages/lifecycle/src/injection.ts:636`).
- Lifecycle SessionStart scope passing is correct: `handleSessionStart` refreshes scope, reads `engine.getProjectScope()?.key`, carries existing remaining-char policy limits, passes `projectScope` into baseline selection, and still passes it to rendering (`packages/lifecycle/src/handlers.ts:206`, `packages/lifecycle/src/handlers.ts:213`, `packages/lifecycle/src/handlers.ts:214`, `packages/lifecycle/src/handlers.ts:220`, `packages/lifecycle/src/handlers.ts:221`).
- Prompt-time recall path was not changed by this slice; `handleUserPromptSubmit` still uses `selectMemoriesForInjection` rather than `selectBaselineMemories` (`packages/lifecycle/src/handlers.ts:166`).
- Tests cover no-scope recency-first behavior, project-first current-project priority over newer globals, recency within tiers, secret/dedup preservation, and lifecycle integration under a tight item budget (`packages/lifecycle/test/injection.test.ts:497`, `packages/lifecycle/test/injection.test.ts:516`, `packages/lifecycle/test/injection.test.ts:535`, `packages/lifecycle/test/injection.test.ts:555`, `packages/lifecycle/test/handlers.test.ts:243`).
- Documentation was updated to explain SessionStart project-first baseline selection and to clarify that prompt-time `UserPromptSubmit` recall remains relevance-based (`README.md:798`).
