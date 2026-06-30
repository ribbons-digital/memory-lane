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
- Release `v0.2.38` (`3576417`) passed workflow `28276304985` and published 8 assets, shipping the docs/context-budget slice.
- Release `v0.2.39` (`9021435`) passed workflow `28410566489` and published 8 assets, shipping the SessionStart descriptor index Slice A.
- Release `v0.2.40` (`7578bb5`) passed workflow `28419273491` and published 8 assets, shipping SessionStart descriptor metadata Slice B.
- Release `v0.2.41` (`9f9cdde`) passed workflow `28423317038` and published 8 assets, shipping the retrieval currentness tie-break from PR #75.
- Installed-artifact dogfood after `memory-lane upgrade --yes` passed: broad next-work continuity has empty workstream candidates plus `no-topic`, stale release/checkpoint ids are absent from operating guidance, and topic-specific queries still return candidates.
- Phase-completion docs sync landed in `309021e docs: declare phase 21 complete`.
- PR #69 (`4ebf447`) completed the docs/context-budget slice: root `ROADMAP.md` is compact, historical roadmap detail through Phase 20.5 is archived, and skill guidance uses bounded reads.
- PR #71 (`e0deba1`) completed SessionStart descriptor index Slice A: selective SessionStart context now uses tiny always-on memories plus compact descriptor cards with fetch-by-id guidance, without adding memory schema or YAML/frontmatter persistence.

Key Phase 21 references:

- Post-v0.2.35 cleanup/exit validation: `docs/superpowers/validation/2026-06-26-phase-21-post-v0.2.35-memory-cleanup-exit-validation.md`
- Slice 7 summary hygiene design: `docs/superpowers/specs/2026-06-26-phase-21-slice-7-summary-hygiene-design.md`
- Slice 8 context-pollution hardening design: `docs/superpowers/specs/2026-06-26-phase-21-slice-8-context-pollution-hardening-design.md`
- Slice 9 broad continuity injection hygiene design: `docs/superpowers/specs/2026-06-26-phase-21-slice-9-broad-continuity-injection-hygiene-design.md`
- Item 4 continuity selection hygiene design: `docs/superpowers/specs/2026-06-27-phase-21-item-4-continuity-selection-hygiene-design.md`
- Docs/context-budget design: `docs/superpowers/specs/2026-06-27-docs-context-budget-design.md`

## Recent context-budget follow-up — SessionStart Descriptor Index

Slice A merged in PR #71 as `e0deba1` and released in `v0.2.39` (`9021435`). It is schema-free: descriptor cards are generated from existing approved memories, pending/secret-looking memories are filtered before both ordinary and priority descriptor selection, and full memory bodies remain available through explicit `memory_get` / `memory-lane show <id>`.

Dogfood passed: real-project installed SessionStart output used `## Always-on Memory` plus `## Memory Index` within the 1600-char budget, an isolated fixture proved descriptor breadth beyond the old body-oriented cap, policy-only/off smokes passed, and fetch-by-id worked. Validation: `docs/superpowers/validation/2026-06-30-session-start-descriptor-index-dogfood.md`.

Slice B merged in PR #72 as `bc02d04` and released in `v0.2.40` (`7578bb5`). The first vertical slice adds optional bounded descriptor metadata to core records, uses it in SessionStart descriptor cards, and surfaces it on exact show/get inspection. It defers CLI authoring flags, descriptor update/clear, Obsidian/YAML frontmatter, token policy changes, and embeddings/retrieval changes. Spec: `docs/superpowers/specs/2026-06-30-session-start-descriptor-metadata-design.md`.

Dogfood passed after installed `memory-lane upgrade --yes`: exact human and JSON `show` exposed descriptor metadata, released `codex session-start` rendered structured descriptor summaries plus fetch hints, full descriptor-card bodies stayed out of SessionStart, and generated fallback descriptors still worked. Validation: `docs/superpowers/validation/2026-06-30-session-start-descriptor-metadata-dogfood.md`.

Next decision for this track: decide whether to proceed to Slice C Obsidian/YAML frontmatter, proceed to Slice D token-aware policy refinement, or pause this track.

## Active track — Project-local Storage Defaults

The user raised that project-scoped memories stored in the home JSONL can still feel risky even with scope filtering. Directionally, project-scoped memories should live under the project `.memory-lane/` by default, while global preferences/personal memories remain home-scoped.

Approved design: `docs/superpowers/specs/2026-06-30-project-local-storage-default-design.md`.

Slice plan:

1. **Slice 0 — storage facade proof, no default-location flip.** Preserve current storage behavior while routing `MemoryEngine` through an injectable storage facade with memory append/list/diagnostics, batch append, embedding append/read/invalidation, compaction, path metadata, and continuity-baseline seams.
2. **Slice 1 — project-local default for new project-scoped writes.** Requires a fresh approval gate. Derive the project-local root from existing project scope resolution, keep explicit `MEMORY_LANE_*` paths authoritative and single-store, and keep global preferences/personal memories home-side.
3. **Slice 2 — migration/compatibility diagnostics.** Requires a fresh approval gate. Detect legacy home-stored project memories and provide bounded warnings plus explicit dry-run migration; do not silently move/delete/approve/consolidate.

Current implementation branch: Slice 0 is in progress on `feat/storage-facade-proof`. It adds the single-store facade and preserves existing default write locations. Before PR, run full validation and Opus 4.8 implementation review.

Retrieval-quality status: currentness tie-break merged in PR #75 and shipped in `v0.2.41`; pause retrieval-ranking work unless new dogfood/eval evidence justifies another proposal.

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
