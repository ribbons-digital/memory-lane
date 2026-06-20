## Review
Approval status: Approved.

### Blocker
- None found.

### Major
- None found.

### Minor
- None found.

### Correct
- `ContinuityHintSummary` now carries text-free scope hygiene metadata and a typed `scope-hygiene-candidate` hint code/reason set; the metadata includes ids/status/category/scope/source/timestamps/kind/provenance/reason but no memory body text (`packages/core/src/types.ts:106-160`).
- Candidate detection is conservative and read-only: it only considers approved global memories, flags project category, project-specific kinds, or high-signal path-like text, and returns structured reason codes without text (`packages/core/src/continuity-hints.ts:59-87`).
- `buildContinuityHints` emits one aggregate `scope-hygiene-candidate` review hint only when candidates exist, caps `memoryIds`/metadata by `maxIds`, uses the non-mutating inspection action `memory-lane list --json`, and retains the existing read-only continuity note (`packages/core/src/continuity-hints.ts:96-130`, `packages/core/src/continuity-hints.ts:209-225`).
- Non-detection requirements are covered and implemented: pending/non-approved records and project-scoped records are excluded by the approved/global guard, and ordinary global workflow preferences with generic project/PR/roadmap language are not flagged by the tested path/category/kind rules (`packages/core/src/continuity-hints.ts:67-72`; `packages/core/test/continuity-hints.test.ts:107-136`).
- Text-free JSON/human surface coverage exists for dashboard/status/doctor and MCP `memory_status`: CLI tests assert metadata/reason exposure plus private text absence, and MCP tests assert the candidate reason/hint code with no text leak (`packages/cli/test/cli.test.ts:1005-1061`; `packages/mcp-server/test/handlers.test.ts:338-363`).
- No source changes were made to recall, ranking/scoring, save/review mutation paths, config, or MCP mutation handlers; the only runtime source changes in the diff are core continuity hint types/detection, with lifecycle test fixture adjustment for the new required summary field (`packages/core/src/types.ts:106-160`; `packages/core/src/continuity-hints.ts:59-225`; `packages/lifecycle/test/injection.test.ts:95-99`).
- Docs/glossary match the design: `CONTEXT.md` defines “Scope hygiene candidate” as an inspection signal with no automatic rescope/delete/reject/supersede, and README documents scope hygiene hints as text-free inspection-only diagnostics using `memory-lane list --json` (`CONTEXT.md:71-76`; `README.md:480-487`).

### Verification
- `git diff --check main...HEAD` passed.
- `pnpm --filter @memory-lane/core test -- continuity-hints.test.ts` passed.
- `pnpm --filter @memory-lane/cli test -- cli.test.ts` passed.
- `pnpm --filter @memory-lane/mcp-server test -- handlers.test.ts` passed.
- `pnpm build` passed.
- `pnpm test` passed.

### Note
- The requested root `plan.md` and `progress.md` files were not present in this worktree; review used `docs/superpowers/specs/2026-06-19-global-memory-hygiene-hints-design.md` and `docs/superpowers/plans/2026-06-19-global-memory-hygiene-hints.md` for the spec/plan comparison.
