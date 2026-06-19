## Review
Approval status: Approved.

### Blocker
- None found.

### Major
- None found.

### Minor
- None found.

### Correct
- Pending-review notice is derived only from saved pending memories: `pendingReviewCount` filters `status === "saved"` and `memory.status === "pending"`, and the renderer emits only count, command, and approve/reject wording (`packages/lifecycle/src/review-notices.ts:3-13`).
- Claude and Codex lifecycle outputs prefer the pending-review notice over debug counts, while falling back to `{}` when debug is off and no pending memory was saved (`packages/claude-adapter/src/outputs.ts:35-42`, `packages/codex-adapter/src/outputs.ts:31-38`).
- Pending summary saves still emit a review notice because Claude `SessionEnd`, Codex explicit `Stop` summary intent, and Codex legacy `session-end` all route saved summary results through `lifecycleNoopOutput(result, debug)` (`packages/claude-adapter/src/runner.ts:164-178`, `packages/codex-adapter/src/runner.ts:186-197`, `packages/codex-adapter/src/runner.ts:221-232`).
- No-candidate/no-durable explicit summary outputs are quiet without debug: no-durable tests assert `{}` for Claude SessionEnd and Codex explicit Stop summary (`packages/claude-adapter/test/runner.test.ts:324-340`, `packages/codex-adapter/test/runner.test.ts:447-460`).
- Disabled/missing-provider explanatory messages remain for explicit Codex Stop summary intent and Claude SessionEnd (`packages/codex-adapter/src/runner.ts:176-184`, `packages/claude-adapter/src/runner.ts:148-157`), with tests covering disabled/missing Codex Stop messages (`packages/codex-adapter/test/runner.test.ts:367-405`) and Claude missing/disabled messages (`packages/claude-adapter/test/runner.test.ts:247-273`).
- Privacy holds: helper tests assert memory body/id absence (`packages/lifecycle/test/review-notices.test.ts:46-50`); adapter tests assert prompt/tool/transcript details are not emitted in notices (`packages/claude-adapter/test/runner.test.ts:170-186`, `packages/codex-adapter/test/runner.test.ts:314-348`, `packages/codex-adapter/test/runner.test.ts:408-443`).
- Out-of-scope behavior appears unchanged: diff is limited to docs, shared notice helper/export, adapter output routing, runner output selection for explicit summary results, and tests; candidate extraction/save heuristics/ranking were not changed.
- README documents compact count-only pending review reminders for Claude and Codex hooks (`README.md:822`, `README.md:837`).

### Verification
- `pnpm --filter @memory-lane/lifecycle test -- review-notices.test.ts` passed.
- `pnpm --filter @memory-lane/claude-adapter test -- runner.test.ts` passed.
- `pnpm --filter @memory-lane/codex-adapter test -- runner.test.ts` passed.
- `git diff --check` passed.
- `pnpm build` passed.
- `pnpm test` passed.

### Note
- The requested root `plan.md` and `progress.md` paths were not present in this worktree; review used `docs/superpowers/plans/2026-06-19-pending-review-visibility.md` and `docs/superpowers/specs/2026-06-19-pending-review-visibility-design.md`.
