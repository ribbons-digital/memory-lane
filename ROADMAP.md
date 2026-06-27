# Memory Lane Roadmap

## Product North Star — Cross-Agent Continuity Without Silent Autonomy

Memory Lane helps coding agents preserve useful continuity across harnesses without silently turning every transcript into durable policy. The system should keep current status, decisions, corrections, procedures, and user preferences available through bounded, review-governed surfaces.

Default posture:

- prefer review-first capture over silent mutation;
- keep lifecycle context bounded and policy-aware;
- preserve explicit user control over durable memories;
- make broad project-status/next-work prompts continuity-first;
- avoid retrieval rewrites, auto-consolidation, raw transcript indexing, and schema expansion unless a future approved slice justifies them.

## Roadmap maintenance and context budget

Root `ROADMAP.md` is the active planning index. Keep it safe to read wholesale in fresh sessions.

- Current/next work belongs in root while it guides immediate decisions.
- Completed historical detail should be summarized in root and moved or linked to archive docs when it stops guiding immediate decisions.
- Do not paste release-by-release chronology into root; link to specs, validation reports, release notes, or archive files instead.
- Historical phases through Phase 20.5 are archived at `docs/superpowers/archive/roadmap-through-phase-20-5.md`.
- Full pre-compaction handoff chronology is archived at `docs/superpowers/archive/2026-06-26-pre-docs-hygiene-handoff.md`.

## Current status — Phase 21 complete

Phase 21 `Handoff-Free Sessions` is complete and released through `v0.2.37` (`6d234c3`). Fresh-thread dogfood for `where are we in the project and what should we work on next?` showed improved context-window usage at about 11.8%, down from the previous 14.x% range.

Recent completion evidence:

- PR #67 (`78ea89e`) compacted `HANDOFF.md`, archived old handoff chronology, compressed Phase 21 roadmap status, and moved long Memory Lane skill reference material to `skills/memory-lane/REFERENCE.md`.
- PR #68 (`5707c6c`) completed continuity selection/ranking hygiene: generic broad next/status queries no longer surface stale workstream candidates, release/checkpoint project facts classify as progress rather than operating guidance, and topic-specific workstream discovery is preserved.
- Release `v0.2.37` (`6d234c3`) passed workflow `28275316878` and published 8 assets.
- Installed-artifact dogfood after `memory-lane upgrade --yes` passed: broad next-work continuity has empty workstream candidates plus `no-topic`, stale release/checkpoint ids are absent from operating guidance, and topic-specific queries still return candidates.
- Phase-completion docs sync landed in `309021e docs: declare phase 21 complete`.

Key Phase 21 references:

- Post-v0.2.35 cleanup/exit validation: `docs/superpowers/validation/2026-06-26-phase-21-post-v0.2.35-memory-cleanup-exit-validation.md`
- Slice 7 summary hygiene design: `docs/superpowers/specs/2026-06-26-phase-21-slice-7-summary-hygiene-design.md`
- Slice 8 context-pollution hardening design: `docs/superpowers/specs/2026-06-26-phase-21-slice-8-context-pollution-hardening-design.md`
- Slice 9 broad continuity injection hygiene design: `docs/superpowers/specs/2026-06-26-phase-21-slice-9-broad-continuity-injection-hygiene-design.md`
- Item 4 continuity selection hygiene design: `docs/superpowers/specs/2026-06-27-phase-21-item-4-continuity-selection-hygiene-design.md`
- Docs/context-budget design: `docs/superpowers/specs/2026-06-27-docs-context-budget-design.md`

## Recommended next track — Retrieval Quality / Continuity Evaluation

Before adding heavier retrieval, consolidation, RRF, reranking, embeddings changes, or viewer work, Memory Lane should establish an eval-first retrieval/continuity quality track.

First slice:

1. Define a small reproducible eval corpus from real dogfooded Memory Lane records.
2. Add labeled continuity/recall queries.
3. Measure current behavior: recall@k, precision@k, and failure cases.
4. Produce a short findings doc.
5. Do not change retrieval/ranking until the eval justifies a specific change.

Why this next: Phase 21 made continuity usable and cleaner. The next product risk is changing retrieval based on vibes rather than evidence.

Prior art for this track: `docs/superpowers/specs/2026-06-25-continuity-typing-ranking-eval-design.md`, `docs/superpowers/plans/2026-06-25-continuity-typing-ranking-eval.md`, and `MEMORY_AS_TOOL_REVIEW.md`.

## Other viable future tracks

- **Review-first consolidation proposals:** identify overlapping/superseded memories and suggest manual `update` / `replace` / `supersede` commands. Keep review-first; no auto-consolidation or auto-approval.
- **Docs/context-budget follow-up:** consider README splitting or generated current-state docs if README becomes the next major context source.
- **Hardening backlog:** installer/init wizard improvements, Claude Desktop MCP config path tests, import dry-run secret warnings, and broader read-only taxonomy checks.
- **Outcome-informed learning:** use approval/rejection/delete/rescope/replace/supersede decisions as reviewable signals for future suggesters, without silent self-training or durable policy mutation.

## Deferred improvements

These items are intentionally not in the active roadmap. Add them only after real-world usage justifies the work.

- **Multi-session narrative compression.** Combine many session summaries into a higher-level project chronicle.
- **Cross-project memory inheritance.** Allow memories to be marked reusable across projects.
- **Automatic preference learning.** Infer implicit preferences from chat history beyond explicit saves and session summaries.
- **Opt-in memory sharing.** Let teams share selected project memories across machines or collaborators.
- **Retrieval/ranking upgrades.** Consider RRF, reranking, graph expansion, or embedding-default changes only after eval evidence.
