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

Recent shipped work:

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
- optional external long-memory smoke adapter coverage from PR #130.

No active eval implementation slice is currently open.
Issue #115 shipped the first optional external long-memory smoke adapter and closed after PR #130.
The adapter stays outside default CI and requires an explicit local dataset path.
It supports the tiny LongMemEval-compatible smoke shape with `question_id`, `haystack_session_ids`, `haystack_sessions`, `haystack_dates`, `answer_session_ids`, and `_abs` abstention records.
It emits a stable JSON report with test-only benchmark taxonomy metadata, deterministic session-id recall metrics, explicit no-network, no-model, and no-judge flags, and separate abstention handling.
no-mistakes review fixes preserved haystack dates, made temporal smoke records exercise currentness, and sized temporary retrieval `topK` to the requested `k`.
The deterministic retrieval, conflict/update, lifecycle-injection, prompt-routing, long-session synthetic, and external long-memory smoke evals are clean, so retrieval-ranking changes remain paused until dogfood or eval evidence exposes a concrete production recall bug.

Do not add embeddings, LLM judges, production ranking rewrites, auto-downloads, default CI wiring, or auto-consolidation until deterministic local evals remain stable and expose a reason to broaden.

## Other viable future tracks

- **Review-first consolidation proposals:** identify overlapping or superseded memories and suggest manual `update`, `replace`, or `supersede` commands.
  Keep review-first; no auto-consolidation or auto-approval.
- **Hardening backlog:** installer/init wizard improvements, Claude Desktop MCP config path tests, import dry-run secret warnings, and broader read-only taxonomy checks.
- **Outcome-informed learning:** use approval, rejection, delete, rescope, replace, and supersede decisions as reviewable signals for future suggesters, without silent self-training or durable policy mutation.
- **Opt-in memory sharing:** let teams share selected project memories across machines or collaborators.
- **Retrieval/ranking upgrades:** consider RRF, reranking, graph expansion, or embedding-default changes only after eval evidence.
- **Memory-Lane-configured continuity classifier:** future harness-agnostic design only.
  It should be opt-in, deterministic-first, ambiguous-only, and avoid harness-current-model assumptions.
