# Memory Lane Handoff

## Current state

- PR #200 merged issue #185 Slice 3 as main commit `17f2893`, documenting the real OMP `16.4.5` rebuild-and-restart development loop and intentionally unused OMP-only APIs while adding fixture-locked doctor contract metadata.
- PR #198 merged issue #185 Slice 2 as main commit `a880293`, adding first-class OMP detection, init, manifest, doctor, upgrade, selective uninstall, strict recorded-path maintenance, issue #147 custom binary-path handling, and real installed-path discovery without `--extension`.
- PR #192 merged issue #175 Slice C as main commit `415af0b`, adding durable local outcome events, bounded retention, and a deterministic maintainer capture-outcome dataset exporter.
- PR #196 merged issue #185 Slice 1B as main commit `cccd858`, closing the pinned OMP `16.4.5` lifecycle contract with native interactive `input`, deterministic native `tool_result`, generated-bridge `input`/`turn_end`/`tool_result` handlers, task-session capture suppression, and an `overallPass: true` fixture.
- PR #194 merged issue #185 Slice 1A as main commit `04dc166`, adding the pinned real-OMP `16.4.5` contract runner, production source-form equivalence checks, lifecycle boundary normalization evidence, and an aggregate gate that remained intentionally false until Slice 1B closed native event verification and generated-bridge handler gaps.
- PR #190 merged issue #181 as main commit `14240fb`, making `memory-lane save --kind` persist explicit valid kinds, preserve omitted-kind inference, reject invalid kinds before writes, and list accepted kinds in CLI help.
- PR #188 merged issue #178 as main commits `b2093df`, `4870a2f`, and `9d5422a`, isolating fallback MCP request scopes while preserving bundled per-path engine behavior.
- PR #186 merged issue #177 as main commit `a7745af`, adding explicit `--all` maintenance mode to Pi review and delete while preserving scoped defaults.
- PR #183 merged issue #145 as main commit `9b16939`, increasing new memory IDs to 128 random bits while preserving legacy short IDs and duplicate-ID folding semantics.
- Current repo status: main is synced through PR #200, and issue #185 is closed after all three OMP integration slices shipped.
- The strict OMP `16.4.5` lifecycle fixture remains at `overallPass: true`; doctor reports its tested version, `2026-07-12` test date, and aggregate pass status.
- PR #182 scoped revision maintenance mutations to the current project and documented the revision command options.
- PR #180 documented scoped review maintenance after PR #179 scoped review mutations to the current project.
- PR #174 shipped issue #169 Slice B trace dataset conversion as a maintainer-only local runner for opt-in Slice A trace files.
- Issue #169 captured the review-governed learning flywheel design (outcome-informed learning track) with a UX north star and all six design decisions recorded as issue comments on 2026-07-09.
- Memory store hygiene on 2026-07-09: rejected pending `484111e8`, consolidated duplicate no-mistakes gate rules into approved workflow_rule `1bc145df` (supersedes `29023aba` and `e0e48ba4`), and ran `memory-lane compact` to purge deleted/rejected records.
- PR #168 synced status docs after PR #167.
- PR #167 fixed interactive Codex Desktop init with normal TOML config, partial-error reporting for failed selected integrations, and non-zero init exit status on selected integration failure.
- PR #167 used Blaze quickfix mode with Fable 5 implementation review.
- no-mistakes was not run for PR #167 because quickfix mode skips it by default.
- PR #164 synced status docs after PR #163.
- PR #132 merged release version metadata fixes and docs for Windows upgrade behavior.
- PR #131 synced long-memory smoke adapter status docs after PR #130.
- PR #130 merged optional external long-memory smoke adapter coverage as main commit `950a71e`.
- PR #129 merged issue #114 external benchmark adapter design as main commit `bef9230`.
- PR #127 merged deterministic local long-session synthetic benchmark coverage as main commit `c8c65ea`.
- PR #127 added `pnpm --filter @memory-lane/lifecycle eval:long-session-synthetic`.
- PR #125 merged benchmark taxonomy and fixture manifest metadata as main commit `f08ba13`.
- PR #104 removed internal `docs/` files from repository tracking, kept `docs/plugins/README.md` tracked as user-facing documentation, ignored the rest of on-disk `docs/`, and synced status docs.
- Project-local storage defaults are implemented through Slice 2b: PR #80, PR #89, and PR #94 shipped the write default, legacy diagnostics, and review-first migration protocol.
- Continuity routing/context hygiene shipped in PR #82; duplicate continuity rendering hygiene shipped in PR #97.
- Internal feature specs, validation notes, and archived handoffs under `docs/` are intentionally removed from repository tracking.

## Current decision / next work

Main is synced through PR #200 at commit `17f2893`, which completed issue #185 Slice 3 and closed the issue.
Slice 3 documents the verified OMP `16.4.5` local workflow as rebuild, exit, and restart or `omp --continue`; real-runtime evidence showed that `ctx.reload()` and `/reload-plugins` do not load rebuilt adapter source behind the active extension entrypoint.
The documentation records why `session_stop`, `before_provider_request`, message-stream events, tool execution/approval/control events, and `ctx.memory` remain intentionally unused while the five verified shared lifecycle events continue through one policy implementation.
Doctor now exposes fixture-locked OMP contract metadata for tested version `16.4.5`, test date `2026-07-12`, and `overallPass: true` without changing extension detection or warning semantics.
Issue #185 is closed; no further OMP integration slice is active.
Issue #175 Slice C records versioned, content-free local learning events for suggestion creation, review exposure, approval, rejection, deletion, replacement, supersession, reactivation, agreement recommendation exposure, and agreement recommendation acceptance when `learning.capture` is enabled.
It routes event files by the owning memory scope, suppresses capture when either owner or acting project is excluded, and adds the maintainer-only capture-outcome dataset exporter at `pnpm --filter @memory-lane/lifecycle eval:capture-outcome-dataset -- --events <dir> --as-of <ISO> --out <file>`.
PR #190 fixed issue #181 by forwarding explicit save kinds through the CLI, preserving inference when omitted, rejecting invalid kinds before persistence, and documenting every accepted kind in CLI help.
PR #183 fixed issue #145 by increasing new memory IDs to 128 random bits while preserving legacy short IDs and duplicate-ID folding semantics.
PR #182 and PR #179 scoped revision and review maintenance mutations to the current project, with PR #180 documenting scoped review maintenance.
PR #174 shipped issue #169 Slice B: `pnpm --filter @memory-lane/lifecycle eval:trace-dataset-converter -- --traces <dir> --out <file>` converts opt-in Slice A trace files into a deterministic smoke dataset for explicit core adapter use.
Issue #169 holds the completed review-governed learning flywheel design: home-scoped traces under `~/.memory-lane/traces/<project-key>/`, single global opt-in consent with per-project opt-out, 60-day/512MB retention with `memory-lane tuneup purge`, deferred-and-instrumented Codex transcript fidelity, a new minimal versioned capture-outcome schema, and proposals applied inside `memory-lane tuneup` with an undo journal.
The UX north star keeps traces/datasets/evals/sweeps vocabulary out of the user surface; Slice E (`memory-lane tuneup`) is the product.
The next issue #169 follow-up slice requires separate user approval.
PR #167 fixed issue #141 so interactive Codex Desktop init no longer parses normal `~/.codex/config.toml` as JSON.
Failed selected init integrations now print a partial-error banner and exit non-zero, while user-declined overwrite skips remain non-fatal through a structured skip flag.
PR #167 used Fable 5 for implementation review and Blaze quickfix mode.
no-mistakes was not run for PR #167 because quickfix mode skips it by default.
The latest release remains `v0.2.47`.
The release workflow for tag `v0.2.47` passed as GitHub Actions run `28768281598`.
Released asset `memory-lane-darwin-arm64.tar.gz` was downloaded from GitHub Releases, extracted, and verified with `status --json` reporting `meta.version: "0.2.47"`.

Issue #115 is closed with comment `Closed by PR #130, main commit 950a71e.`
The issue #115 adapter added `pnpm --filter @memory-lane/core eval:long-memory-smoke -- --dataset <path>`.
It requires a local dataset path by `--dataset` or `MEMORY_LANE_LONG_MEMORY_SMOKE_DATASET`, does not auto-download data, and reports `networkRequired: false`, `modelRequired: false`, and `judgeRequired: false`.
It supports a tiny LongMemEval-compatible smoke subset using `question_id`, `haystack_session_ids`, `haystack_sessions`, `haystack_dates`, `answer_session_ids`, and `_abs` abstention records.
It evaluates deterministic retrieval session-id recall only, maps categories back to the test-only benchmark taxonomy, skips abstention records into `abstentionResults`, writes only temp MemoryEngine stores, and leaves production retrieval and lifecycle code unchanged.
no-mistakes fixed three review findings before PR #130 merged: preserve haystack dates, make temporal smoke records exercise currentness, and size temporary retrieval `topK` to requested `k`.
The project goal for evals is to improve Memory Lane behavior, not to add decorative scaffolding.
Each eval slice should state whether it ran deterministic fixtures, live Memory Lane store data, embeddings, synthetic long-session benchmarks, or external benchmarks.

## Load-bearing constraints

- For broad prior-work, project-status, or next-work questions, call Memory Lane continuity first and verify against compact repo state when available.
- At phase, slice, release, merge, or next-work boundaries, sync `ROADMAP.md` and `HANDOFF.md` before calling work complete.
- Keep `docs/plugins/README.md` tracked because it is user-facing and linked from `README.md`.
- Keep internal feature notes out of tracked `docs/` unless a future user decision explicitly reintroduces them.
- Use Fable 5 for explicit Fable 5 follow-up planning and code review with `claude --model claude-fable-5 -p '<review prompt>'`.
- Use Opus 4.8 with `claude --model claude-opus-4-8 -p '<review prompt>'` for ordinary Memory Lane design/spec and pre-PR implementation reviews unless Fable 5 is mentioned or specified.
- PR-protected workflow applies: feature branch or worktree, PR, wait for user merge, sync main, delete feature branch, recommend next item.
- Avoid retrieval rewrites, auto-consolidation, silent deletion, schema expansion, raw transcript indexing, token retuning, public eval commands, production eval APIs, or persisted workstream IDs unless a new approved slice explicitly includes them.
- Treat Slice B output as local self-retrieval transport smoke data only, not ranking-quality evidence.

## Current verification evidence

- PR #200 verification passed focused diagnostics and fixture-agreement tests, workspace build and tests, real OMP `16.4.5` isolated startup and source-change smoke evidence, two Fable 5 implementation reviews, and completed no-mistakes run `01KXC9BX940Q2TR47EYG40EAE3` with no findings and green CI.
- PR #198 verification passed workspace build and tests, focused installer and maintenance regressions, strict OMP manifest-path safety coverage, Pi/OMP production-source byte equivalence, real installed-path discovery on OMP `16.4.5` with `overallPass: true`, Fable 5 pre-PR review, and completed no-mistakes run `01KXB7W0PQKDKADBQ16QQZHEAC`.
- PR #196 verification passed the committed OMP `16.4.5` report at `packages/cli/test/fixtures/omp-contract-16.4.5.json`, focused OMP contract runner regressions, production source-form equivalence tests, genuine real-TTY `input` evidence, deterministic success/error host-tool evidence, generated-bridge lifecycle coverage, task-session suppression evidence, and no-mistakes run `01KXAQF6TQD55CRMDVF30XCG0F` with `checks-passed`; the real-runtime gate reported `overallPass: true`.
- PR #192 verification passed the Obsidian mirror, core, and lifecycle builds; focused core and lifecycle learning-event tests; the full lifecycle suite; a long-lived sink retention demo covering interval, boundary, clock-rollback, and privacy behavior; and no-mistakes run `01KX9VG9PTMM94FDTXY0KS2YJF` with outcome `passed` and no findings.
- PR #190 verification passed the explicit-kind end-to-end reproduction, focused and full CLI tests, workspace build and tests, Fable 5 completed-diff review with no blockers, and no-mistakes run `01KX85C9R19E0KKDT2M4BTGJ78` with `checks-passed` and no findings after the CodeRabbit help-value fix.
- PR #188 verification passed the original registered-tool reproduction, focused fallback scope regressions, the full 60-test MCP suite, the full 430-test core suite, workspace build and tests, `git diff --check`, Fable 5 diff review with no blockers, and no-mistakes run `01KX7QS7515YEH2Q4CZK7EHP40` with outcome `passed` and no findings after restoring startup scope in a `finally` path.
- PR #186 verification passed focused Pi scope regressions, the full 32-test Pi adapter suite, the Pi adapter build, `git diff --check`, Fable 5 diff review with no blockers, and no-mistakes run `01KX79Y2WT7H2VTRNGP3JHT2WE` with `checks-passed` and no findings.
- PR #183 verification passed focused core storage tests, core and workspace builds, the full workspace test suite, `git diff --check`, Fable 5 diff review with no blockers, and no-mistakes run `01KX70XJNHAPD2X06C29RNPEVG` with `checks-passed` and no findings.
- PR #161 verification passed `pnpm --filter @memory-lane/core build && pnpm --filter @memory-lane/cli build`, `pnpm --filter @memory-lane/core exec node --test --import tsx test/config.test.ts`, `pnpm --filter @memory-lane/cli exec node --test --import tsx test/cli.test.ts`, isolated original issue reproduction with temp storage, `pnpm build`, `pnpm test`, and `git diff --check`.
- PR #161 used Fable 5 for diagnosis and implementation review.
- PR #161 used the Blaze fallback PR path because no-mistakes could not start for the branch with `error: "no run started for \"fix/config-set-validation-137\": no previous run for branch fix/config-set-validation-137"`.
- PR #163 verification passed focused detector, engine, Claude runner, Codex runner, and CLI tests; post-fix CLI reproduction saved `Deploy from branch release/JIRA-2024-blueGreenRollout-phase3`; `pnpm build`, `pnpm test`, and `git diff --check` passed.
- PR #163 used Fable 5 for diagnosis and implementation review because the user explicitly requested Fable 5 review.
- PR #163 used the Blaze fallback PR path because no-mistakes could not start for `fix/secret-detector-138` after gate-remote push and quick-start consultation.
- PR #167 verification passed `pnpm --filter @memory-lane/cli build`, `node --test --import tsx packages/cli/test/init.test.ts` with 32 tests and 0 failures, `HOME=<temp-home> pnpm --filter @memory-lane/cli test` with 191 tests and 0 failures, and `git diff --check`.
- PR #167 used Fable 5 for implementation review and returned approve with no blockers.
- PR #167 ran in Blaze quickfix mode and skipped no-mistakes by quickfix mode.
- PR #165 verification passed `pnpm --filter @memory-lane/cli build`, `pnpm --filter @memory-lane/cli test` with 187 tests and 0 failures, manual `--version`, `-v`, and `version` smoke checks with `MEMORY_LANE_VERSION=v1.2.3`, and `git diff --check`.
- PR #165 used Opus 4.8 for implementation review and returned PASS.
- Release `v0.2.47` pre-release verification passed `pnpm build`, `pnpm test`, `git diff --check`, `MEMORY_LANE_VERSION=v0.2.47 pnpm build:binary`, and `pnpm smoke:binary`.
- GitHub Actions release run `28768281598` passed for tag `v0.2.47`, including build, tests, binary build, current-platform binary smoke, release notes, and release creation.
- Released `memory-lane-darwin-arm64.tar.gz` asset was downloaded and extracted; `status --json` reported `meta.version: "0.2.47"`.
- PR #132 no-mistakes gate reached `outcome: checks-passed` with no findings after review-comment fixes.
- PR #130 no-mistakes gate reached `outcome: checks-passed`, opened PR #130, and CI passed before merge.
- PR #130 no-mistakes review fixed three findings: preserve LongMemEval haystack dates, exercise temporal smoke currentness dates, and fix smoke recall `topK` sizing.
- PR #130 test evidence included `pnpm --filter @memory-lane/core exec node --test --import tsx test/external-long-memory-smoke.test.ts`, a manual `eval:long-memory-smoke` run against a LongMemEval-compatible fixture, an explicit missing-dataset failure check, and `pnpm --filter @memory-lane/core test`.
- Issue #115 closed with comment `Closed by PR #130, main commit 950a71e.`
- Issue #114 design capture posted to GitHub issue comment `https://github.com/ribbons-digital/memory-lane/issues/114#issuecomment-4888147243`.
  The design selects a retrieval/read-model-first external benchmark adapter, optional manual runner mode, local dataset path only, deterministic retrieval/session-id metrics, no default CI, no model judge, no auto-download, no committed dataset, and no production behavior changes.
- PR #123 lifecycle-injection adversarial coverage verification passed `pnpm --filter @memory-lane/lifecycle exec node --test --import tsx test/lifecycle-injection-eval.test.ts` with 11 tests.
- PR #123 lifecycle-injection adversarial coverage verification passed `pnpm --filter @memory-lane/lifecycle eval:lifecycle-injection` with 12 scenarios, 12 passes, 0 failures, and `satisfactory: true`.
- PR #123 lifecycle-injection adversarial coverage verification passed `pnpm --filter @memory-lane/lifecycle build`, `git diff --check`, and CodeRabbit uncommitted review after one fixture nit was fixed.
- PR #123 merged as `1e28794`; post-merge cleanup synced local `main` and deleted local and remote `eval/lifecycle-injection-adversarial`.
- PR #116 adversarial retrieval benchmark hardening verification passed `pnpm --filter @memory-lane/core eval:retrieval`, `pnpm --filter @memory-lane/core eval:conflict-update`, targeted core eval tests, `pnpm --filter @memory-lane/core build`, and `git diff --check`.
- PR #116 merged as `5a291b8`; post-merge cleanup synced local `main`, deleted local and remote `eval/retrieval-adversarial-hardening`, and confirmed clean `main...origin/main`.
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
- Latest release reference: `v0.2.47` / commit `28e5961`.
- Current main status: PR #200 merged issue #185 Slice 3 as commit `17f2893`, completing and closing the first-class OMP integration issue while preserving the strict pinned lifecycle contract.
- Latest deterministic eval baselines: PR #102, PR #103, PR #105, PR #116, PR #118, PR #120, PR #123, PR #125, PR #127, PR #130, PR #174, PR #192, PR #196, PR #198, and PR #200.
