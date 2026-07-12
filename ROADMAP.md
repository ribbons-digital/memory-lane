# Memory Lane Roadmap

## Product North Star - Cross-Agent Continuity Without Silent Autonomy

Memory Lane helps coding agents preserve useful continuity across harnesses without silently turning every transcript into durable policy.
The system should keep current status, decisions, corrections, procedures, and user preferences available through bounded, review-governed surfaces.

Default posture:

- prefer review-first capture over silent mutation;
- keep lifecycle context bounded and policy-aware;
- preserve explicit user control over durable memories;
- make broad project-status and next-work prompts continuity-first;
- avoid retrieval rewrites, auto-consolidation, raw transcript indexing, and schema expansion unless a future approved slice justifies them.

## Roadmap maintenance and context budget

Root `ROADMAP.md` is the active planning index.
Keep it safe to read wholesale in fresh sessions.

- Current and next work belongs in root while it guides immediate decisions.
- Completed historical detail should be summarized in root once, then represented by PR, commit, release, or memory references.
- Internal feature specs, validation notes, and handoff archives under `docs/` were removed from repository tracking in PR #104 because they only described implemented work.
- The only tracked `docs/` content going forward is user-facing plugin documentation under `docs/plugins/README.md`.
- Do not reintroduce internal planning or validation docs under `docs/` without an explicit new decision.

## Current status

Latest known release: `v0.2.47` from main commit `28e5961`, after PR #132 fixed compiled binary and install-manifest version metadata.
Release verification passed `pnpm build`, `pnpm test`, `git diff --check`, `MEMORY_LANE_VERSION=v0.2.47 pnpm build:binary`, `pnpm smoke:binary`, GitHub Actions release run `28768281598`, and a downloaded release-asset `status --json` version check.

PR #192 shipped issue #175 Slice C on main commit `415af0b`, adding durable local outcome events and the deterministic capture-outcome dataset exporter.
Slice C records opt-in, content-free local learning events for suggestion and operating-agreement outcomes, keeps them under existing consent, exclusion, retention, status, and purge surfaces, and adds a maintainer-only capture-outcome dataset exporter.
PR #174 shipped issue #169 Slice B as a maintainer-only lifecycle runner that converts opt-in Slice A trace files into a deterministic `schemaVersion: 1` LongMemEval-compatible smoke dataset for explicit core adapter use.
PR #179 and PR #182 scoped review and revision maintenance mutations to the current project, with PR #180 documenting scoped review maintenance.
The next issue #169 follow-up slice still requires separate user approval.
Issue #185 Slice 1 now has a pinned OMP `16.4.5` real-runtime contract smoke covering both production extension forms through `omp --extension` in scratch profiles.
The native adapter passes `before_agent_start`, normalized `turn_end`, and `session_before_compact`; automated TUI did not expose `input`, and the configured model did not execute the forced tool, so live `tool_result` remains unverified.
The release bridge passes its registered `before_agent_start` and `session_before_compact` paths but does not register `input`, `turn_end`, or `tool_result`; first-class OMP installer work remains gated while the committed report has `overallPass: false`.

Recent shipped work:

- PR #192 shipped issue #175 Slice C with opt-in versioned outcome events, review exposure events, agreement recommendation events, exclusion-aware scope routing, bounded retention, and a deterministic local capture-outcome exporter.
- PR #190 fixed issue #181 by passing explicit save kinds to core validation and persistence, preserving omitted-kind inference, and adding JSON, human-output, invalid-kind no-write, and CLI-help regressions.
- PR #188 fixed issue #178 by serializing fallback MCP tool calls, restoring startup scope before and after each request, and adding registered read, mutation, interleaving, and null-scope regressions.
- PR #186 fixed issue #177 by adding explicit cross-project Pi review and delete maintenance through `--all`.
- PR #183 fixed issue #145 by increasing new memory IDs from 32 to 128 random bits while preserving legacy IDs and duplicate-ID folding semantics.
- PR #182 scoped revision maintenance mutations to the current project.
- PR #180 documented scoped review maintenance.
- PR #179 scoped review mutations to the current project.
- PR #174 shipped issue #169 Slice B trace dataset conversion for opt-in local trace captures.
- PR #80 shipped project-local default writes in `v0.2.43`.
- PR #82 shipped continuity routing and context hygiene in `v0.2.43`.
- PR #89 shipped project-local legacy diagnostics in `v0.2.44`.
- PR #94 shipped the review-first project-local migration protocol in `v0.2.45`.
- PR #95 shipped native pre-compact session summaries in `v0.2.45`.
- PR #97 shipped duplicate continuity rendering hygiene.
- PR #98 added CodeRabbit configuration.
- PR #99 shipped generated Pi pre-compact bridge parity and released it in `v0.2.46`.
- PR #102 added the deterministic prompt-routing eval baseline.
- PR #103 added the deterministic conflict/update recall eval baseline.
- PR #104 removed internal `docs/` files from repository tracking, kept `docs/plugins/README.md` tracked, ignored the rest of `docs/`, and synced status docs.
- PR #105 expanded the deterministic conflict/update microbench with same-id updates, correction records, supersession chains, cross-scope false premises, folded-text assertions, and stale/superseded leak-rate reporting.
- PR #116 hardened the retrieval benchmark against adversarial fixtures.
- PR #118 unified eval report contracts and gates.
- PR #120 added prompt-routing adversarial coverage.
- PR #123 added lifecycle-injection adversarial coverage.
- PR #125 added benchmark taxonomy and fixture manifest metadata.
- PR #127 added deterministic local long-session synthetic benchmark coverage.
- PR #130 added the optional external long-memory smoke adapter.
- PR #131 synced long-memory smoke adapter status docs.
- PR #132 fixed release binary version metadata and Windows upgrade documentation.
- PR #161 fixed config-set validation so invalid config writes are rejected before saving and parseable invalid configs can be repaired before engine initialization.
- PR #163 shipped issue #138 secret-detector false-positive fixes for long branch names, feature flags, and bare high-entropy identifiers without secret context.
  The slice keeps explicit secret patterns and adds metadata-only lifecycle debug `skippedSecret` counts; fallback PR flow was used because no-mistakes could not start after the gate-remote push.
- PR #165 fixed issue #140 by adding script-friendly CLI version handling for `--version`, `-v`, and `version` before config or storage initialization.
- PR #167 fixed issue #141 by making Codex Desktop init existing-config detection TOML-aware, preserving overwrite prompts for padded or commented TOML headers, and making failed selected init integrations report partial errors with non-zero exit status.
  The slice keeps user-declined overwrite skips non-fatal through a structured skip flag; quickfix mode skipped no-mistakes.

## Active track - Project-local Storage Defaults

Project-scoped memories should live under the project `.memory-lane/` by default, while global-scope preferences and personal memories remain home-scoped.
That track is implemented through Slice 2b.

Slice status:

1. **Slice 0 - storage facade proof, no default-location flip.**
   Shipped in `v0.2.42` through PR #78.
   Current storage behavior was preserved while `MemoryEngine` gained an injectable storage facade.
2. **Slice 1 - project-local default for new project-scoped writes.**
   Shipped in `v0.2.43` through PR #80.
   New project-scoped writes route project-side by default, global-scope writes stay home-side, reads merge home plus project stores, and read-only paths avoid fallback creation.
3. **Slice 2a - legacy project-memory diagnostics.**
   Shipped in `v0.2.44` through PR #89.
   Legacy home-stored project memories for the active project surface through bounded `status`, `doctor`, and dry-run migration preview paths.
4. **Slice 2b - review-first legacy migration protocol.**
   Shipped in `v0.2.45` through PR #94.
   Migration uses a reviewable plan generation flow and an explicit `--apply-plan <path> --yes` apply path.

General cross-store rescope moves remain deferred unless a future approved slice explicitly includes them.

## Current eval and retrieval status

Retrieval currentness tie-break shipped in `v0.2.41` through PR #75.
Pause retrieval-ranking changes unless dogfood or eval evidence justifies another proposal.

Deterministic eval coverage now includes:

- retrieval and continuity baseline coverage from PR #70;
- retrieval currentness tie-break coverage from PR #75;
- prompt-routing baseline coverage from PR #102;
- conflict/update recall baseline coverage from PR #103;
- conflict/update microbench expansion coverage from PR #105;
- adversarial retrieval benchmark hardening from PR #116;
- eval report contract unification from PR #118;
- prompt-routing adversarial coverage from PR #120;
- lifecycle-injection adversarial coverage from PR #123;
- benchmark taxonomy and fixture manifest metadata from PR #125;
- deterministic local long-session synthetic benchmark coverage from PR #127;
- optional external long-memory smoke adapter coverage from PR #130;
- trace dataset converter coverage from PR #174;
- capture-outcome dataset coverage from PR #192.

PR #192 shipped issue #175 Slice C with `pnpm --filter @memory-lane/lifecycle eval:capture-outcome-dataset -- --events <dir> --as-of <ISO> --out <file>` for maintainers using opt-in local learning events.
The exporter requires explicit hardened input and output paths, writes atomically, emits no raw content, distinguishes unresolved and 30-day expired-unacted agreement recommendations, and reports right-censored suggestion survival without inferring inactivity as intent.
No default CI or public user command is added.
PR #174 shipped Slice B, which converts local opt-in trace files into a deterministic smoke dataset without public CLI exposure or default CI wiring.
Issue #115 shipped the first optional external long-memory smoke adapter and closed after PR #130.
The adapter stays outside default CI and requires an explicit local dataset path.
It supports the tiny LongMemEval-compatible smoke shape with `question_id`, `haystack_session_ids`, `haystack_sessions`, `haystack_dates`, `answer_session_ids`, and `_abs` abstention records.
It emits a stable JSON report with test-only benchmark taxonomy metadata, deterministic session-id recall metrics, explicit no-network, no-model, and no-judge flags, and separate abstention handling.
no-mistakes review fixes preserved haystack dates, made temporal smoke records exercise currentness, and sized temporary retrieval `topK` to the requested `k`.
PR #174 added `pnpm --filter @memory-lane/lifecycle eval:trace-dataset-converter -- --traces <dir> --out <file>` for maintainers who have opted into local trace capture.
The converter reads one hashed per-project trace directory, deduplicates trace content, skips traces without a user question unless all traces are unusable, records date range, fidelity mix, duplicate/unusable counts, and thin-data status, and rejects output paths that physically resolve inside the trace directory.
Its output is meant to be passed explicitly to the existing core smoke adapter and remains a local self-retrieval transport smoke, not ranking-quality evidence.
The deterministic retrieval, conflict/update, lifecycle-injection, prompt-routing, long-session synthetic, external long-memory smoke, trace dataset converter, and capture-outcome dataset evals are clean or locally scoped, so retrieval-ranking changes remain paused until dogfood or eval evidence exposes a concrete production recall bug.

Do not add embeddings, LLM judges, production ranking rewrites, auto-downloads, default CI wiring, or auto-consolidation until deterministic local evals remain stable and expose a reason to broaden.

## Other viable future tracks

- **Review-first consolidation proposals:** identify overlapping or superseded memories and suggest manual `update`, `replace`, or `supersede` commands.
  Keep review-first; no auto-consolidation or auto-approval.
- **Hardening backlog:** installer/init wizard improvements, Claude Desktop MCP config path tests, import dry-run secret warnings, and broader read-only taxonomy checks.
- **Outcome-informed learning:** use approval, rejection, delete, replace, supersede, reactivation, review exposure, and agreement recommendation decisions as reviewable signals for future suggesters, without silent self-training or durable policy mutation.
  PR #192 shipped Slice C content-free events and the maintainer capture-outcome exporter; later proposal/application slices still require separate approval.
- **Opt-in memory sharing:** let teams share selected project memories across machines or collaborators.
- **Retrieval/ranking upgrades:** consider RRF, reranking, graph expansion, or embedding-default changes only after eval evidence.
- **Memory-Lane-configured continuity classifier:** future harness-agnostic design only.
  It should be opt-in, deterministic-first, ambiguous-only, and avoid harness-current-model assumptions.
