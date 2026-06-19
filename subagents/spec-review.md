## Review
Approval status: Approved.

### Blocker
- None found.

### Major
- None found.

### Minor
- None found.

### Correct
- SessionStart baseline selection now matches the project-first tier order required by the design: current project, global, other project, then other/legacy when `projectScope` is known, with recency inside each tier (`docs/superpowers/specs/2026-06-19-project-first-session-start-design.md:36-45`; implemented in `packages/lifecycle/src/injection.ts:601-614`).
- No-scope fallback remains recency-first because `baselineTier` returns `0` for every memory when `projectScope` is absent and the comparator then sorts only by `updatedAt` descending (`packages/lifecycle/src/injection.ts:601-614`). The existing no-scope budget test still expects recent IDs `2`, `3`, `4` without passing `projectScope` (`packages/lifecycle/test/injection.test.ts:497-513`).
- Global memories remain eligible after current-project memories under the same budget: the selection loop is unchanged after sorting and still applies approved-only/secret/dedupe/fit/budget checks (`packages/lifecycle/src/injection.ts:621-645`), and the new project-first test selects a global after two project memories when budget remains (`packages/lifecycle/test/injection.test.ts:516-532`).
- `handleSessionStart` passes the current project scope into baseline selection while preserving continuity-notice budget subtraction and rendering with the same scope (`packages/lifecycle/src/handlers.ts:206-221`), satisfying the design/API requirement (`docs/superpowers/specs/2026-06-19-project-first-session-start-design.md:80-88`).
- Prompt-time recall/ranking is unchanged: `handleUserPromptSubmit` still calls `engine.recall(recallQuery)` and `selectMemoriesForInjection(...)` for prompt events (`packages/lifecycle/src/handlers.ts:162-166`), and `selectMemoriesForInjection` still iterates recalled order with the existing lexical/secret/dedupe/budget filters (`packages/lifecycle/src/injection.ts:216-245`).
- Scope stayed bounded: `git diff --name-only main...HEAD` is limited to the spec/plan docs, README, lifecycle selector/handler, and lifecycle tests; no MCP, config, cleanup, or package/lock files changed.
- README accurately documents that only `SessionStart` baseline selection is project-first and that prompt-time `UserPromptSubmit` recall remains relevance-based (`README.md:796-799`), matching acceptance criteria (`docs/superpowers/specs/2026-06-19-project-first-session-start-design.md:104-112`).
- Tests cover the requested behavior: project-first selection, recency within tiers/other-project fallback, no-scope recency fallback, and lifecycle handler integration (`packages/lifecycle/test/injection.test.ts:497-552`; `packages/lifecycle/test/handlers.test.ts:243-260`).

### Verification
- `pnpm --filter @memory-lane/lifecycle test -- injection.test.ts` passed.
- `pnpm --filter @memory-lane/lifecycle test -- handlers.test.ts` passed.
- `git diff --check main...HEAD` passed.
- `pnpm build` passed.
- `pnpm test` passed.

### Note
- The requested root `plan.md` and `progress.md` files were not present in this worktree; review used `docs/superpowers/specs/2026-06-19-project-first-session-start-design.md` and `docs/superpowers/plans/2026-06-19-project-first-session-start.md` as requested for spec/plan comparison.
