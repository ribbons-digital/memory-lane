# Memory Lane Handoff

## Current state

- Branch context: active PR branch `chore/untrack-internal-docs-pi-dogfood` updates PR #104.
- PR #104 removes internal `docs/` files from repository tracking, keeps `docs/plugins/README.md` tracked as user-facing documentation, ignores the rest of on-disk `docs/`, and syncs `ROADMAP.md` plus `HANDOFF.md`.
- Latest known release: `v0.2.46` from main commit `cadd261`, after PR #99 fixed generated Pi pre-compact bridge session-summary behavior.
- Project-local storage defaults are implemented through Slice 2b: PR #80, PR #89, and PR #94 shipped the write default, legacy diagnostics, and review-first migration protocol.
- Continuity routing/context hygiene shipped in PR #82; duplicate continuity rendering hygiene shipped in PR #97.
- Generated Pi pre-compact bridge parity shipped in PR #99 and is no longer the next implementation slice.
- Prompt-routing eval baseline merged in PR #102.
- Conflict/update recall eval baseline merged in PR #103.
- Internal feature specs, validation notes, and archived handoffs under `docs/` are intentionally removed from repository tracking.
- User-facing plugin documentation remains at `docs/plugins/README.md` and is linked from the main README.

## Current decision / next work

The current PR #104 scope is docs hygiene and status sync only.
It should not change product behavior.

PR #104 acceptance shape:

1. `.gitignore` ignores `docs/*` while unignoring `docs/plugins/` and `docs/plugins/README.md`.
2. `docs/plugins/README.md` is tracked.
3. No other `docs/` files are tracked.
4. `ROADMAP.md` and `HANDOFF.md` no longer point at deleted internal docs.
5. Verification proves the ignored on-disk docs state and the restored tracked plugin README.

After PR #104, the likely next product slice is conflict/update microbench expansion.
Keep it deterministic, local-fixture-only, and read-only unless a fixture exposes a real production recall bug.
Do not add LongMemEval, embeddings, LLM judges, or ranking rewrites in that slice.

## Load-bearing constraints

- For broad prior-work, project-status, or next-work questions, call Memory Lane continuity first and verify against compact repo state when available.
- At phase, slice, release, merge, or next-work boundaries, sync `ROADMAP.md` and `HANDOFF.md` before calling work complete.
- Keep `docs/plugins/README.md` tracked because it is user-facing and linked from `README.md`.
- Keep internal feature notes out of tracked `docs/` unless a future user decision explicitly reintroduces them.
- Use Fable 5 for explicit Fable 5 follow-up planning and code review with `claude --model claude-fable-5 -p '<review prompt>'`.
- Use Opus 4.8 for ordinary Memory Lane design/spec and pre-PR implementation reviews outside the Fable 5 wave with `claude --model claude-opus-4-8 -p '<review prompt>'`.
- PR-protected workflow applies: feature branch or worktree, PR, wait for user merge, sync main, delete feature branch, recommend next item.
- Avoid retrieval rewrites, auto-consolidation, silent deletion, schema expansion, raw transcript indexing, token retuning, public eval commands, production eval APIs, or persisted workstream IDs unless a new approved slice explicitly includes them.

## Current verification evidence

- PR #104 first pass verification: `pnpm build` passed.
- PR #104 first pass verification: `pnpm test` passed.
- PR #104 first pass verification: targeted CLI Pi dogfood tests passed from `packages/cli` with 122 tests.
- PR #104 first pass verification: installed-artifact generated Pi extension smoke passed from `packages/cli/dist/index.js`, called `memory-lane pi pre-compact --json --project <tmp-project>`, and returned without blocking compaction.
- PR #103 conflict/update recall eval baseline merged before this PR branch was created.
- PR #102 prompt-routing eval baseline merged before PR #103.
- PR #99 generated Pi pre-compact bridge parity released in `v0.2.46`; local pre-release verification passed `pnpm build`, `pnpm test`, and `git diff --check`.

## Key references

- Active roadmap/current direction: `ROADMAP.md`
- User-facing plugin documentation: `docs/plugins/README.md`
- Memory Lane skill guidance: `skills/memory-lane/SKILL.md`
- User-facing package documentation: `README.md`
- Latest release reference: `v0.2.46` / commit `cadd261`
- Current docs hygiene PR: #104
- Latest deterministic eval baselines: PR #102 and PR #103
