## Review

Approval status: Approved

- Correct: `renderMemoryBlock` now groups memories in the required stable readability order and preserves selected-memory order within each group (`packages/lifecycle/src/injection.ts:352-410`, `packages/lifecycle/src/injection.ts:422-426`).
- Correct: Plain-language memory kind labels cover the requested known kinds with category fallback (`packages/lifecycle/src/injection.ts:369-383`).
- Correct: Prompt and session-start lifecycle handlers refresh scope first, then pass `engine.getProjectScope()?.key` into selective rendering, so current-project memories can be labeled in both injection paths (`packages/lifecycle/src/handlers.ts:162-166`, `packages/lifecycle/src/handlers.ts:206-220`).
- Correct: Policy-only/off behavior remains separated from body rendering; selective mode returns no context when there are no selected memories (`packages/lifecycle/src/injection.ts:572-594`).
- Correct: Tests cover current project + global grouping, unknown project scope, other visible project memory, guarded context composition, and lifecycle handler integration (`packages/lifecycle/test/injection.test.ts:298-333`, `packages/lifecycle/test/injection.test.ts:447-462`, `packages/lifecycle/test/handlers.test.ts:159-172`, `packages/lifecycle/test/handlers.test.ts:214-230`).
- Correct: README documents grouped/labeled selective injection and clarifies that labels do not change ranking or selection (`README.md:790-797`).

Findings by severity:

- Blocker: None.
- Major: None.
- Minor: None.

Notes:

- The requested root files `plan.md` and `progress.md` were not present at the provided paths. I reviewed the checked-in plan/spec changed in this diff instead.
- Verified commands: `pnpm --filter @memory-lane/lifecycle test`, `pnpm --filter @memory-lane/lifecycle build`, and `pnpm -r test` all passed.
