# Memory Lane Roadmap

## Product North Star - Cross-Agent Continuity Without Silent Autonomy

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

## Current status - Phase 21 complete

Phase 21 `Handoff-Free Sessions` is complete and released through `v0.2.37` (`6d234c3`). Fresh-thread dogfood for `where are we in the project and what should we work on next?` showed improved context-window usage at about 11.8%, down from the previous 14.x% range.

Recent completion evidence:

- PR #67 (`78ea89e`) compacted `HANDOFF.md`, archived old handoff chronology, compressed Phase 21 roadmap status, and moved long Memory Lane skill reference material to `skills/memory-lane/REFERENCE.md`.
- PR #68 (`5707c6c`) completed continuity selection/ranking hygiene: generic broad next/status queries no longer surface stale workstream candidates, release/checkpoint project facts classify as progress rather than operating guidance, and topic-specific workstream discovery is preserved.
- Release `v0.2.38` (`3576417`) passed workflow `28276304985` and published 8 assets, shipping the docs/context-budget slice.
- Release `v0.2.39` (`9021435`) passed workflow `28410566489` and published 8 assets, shipping the SessionStart descriptor index Slice A.
- Release `v0.2.40` (`7578bb5`) passed workflow `28419273491` and published 8 assets, shipping SessionStart descriptor metadata Slice B.
- Release `v0.2.41` (`9f9cdde`) passed workflow `28423317038` and published 8 assets, shipping the retrieval currentness tie-break from PR #75.
- Release `v0.2.42` (`cd1a839`) passed workflow `28484161404` and published 8 assets, shipping the project-local storage Slice 0 facade proof from PR #78.
- Installed-artifact `v0.2.42` dogfood after `memory-lane upgrade --yes` passed `memory-lane --smoke-test`; validation: `docs/superpowers/validation/2026-07-01-v0.2.42-release-dogfood.md`.
- Release `v0.2.43` (`287bb1a`) passed workflow `28560737645`, shipping PR #80 project-local storage Slice 1 and PR #82 continuity routing/context hygiene.
- Installed-artifact `v0.2.43` dogfood passed in order: pre-upgrade baseline `memory-lane --smoke-test`, `memory-lane upgrade --yes`, post-upgrade `memory-lane --smoke-test`, route classification, and generated Pi bridge continuity checks; validation: `docs/superpowers/validation/2026-07-02-v0.2.43-release-dogfood.md`.
- Release `v0.2.44` (`2788c4e`) passed workflow `28628495514`, shipping project-local storage Slice 2a legacy diagnostics from PR #89.
- Installed-artifact `v0.2.44` dogfood passed in order: pre-upgrade baseline `memory-lane --smoke-test`, `memory-lane upgrade --yes`, post-upgrade `memory-lane --smoke-test`, CLI and MCP legacy diagnostics, dry-run migration preview, and non-dry-run migration refusal; validation: `docs/superpowers/validation/2026-07-02-v0.2.44-release-dogfood.md`.
- Release `v0.2.45` (`83b9b3d`) passed workflow `28647421095`, shipping project-local storage Slice 2b review-first migration from PR #94 and pre-compact session summaries from PR #95.
- Installed-artifact `v0.2.45` validation passed in order: pre-upgrade baseline `memory-lane --smoke-test`, `memory-lane upgrade --yes`, post-upgrade `memory-lane --smoke-test`, Slice 2b dry-run plan generation, apply refusal without `--yes`, explicit apply, idempotent re-apply, and final legacy-candidate count of 0; validation: `docs/superpowers/validation/2026-07-03-v0.2.45-release-dogfood.md`.
- Installed-artifact `v0.2.41` continuity dogfood after `memory-lane upgrade --yes` passed: broad next-work continuity has empty workstream candidates plus `no-topic`, stale release/checkpoint ids are absent from operating guidance, and topic-specific queries still return candidates.
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

## Recent context-budget follow-up - SessionStart Descriptor Index

Slice A merged in PR #71 as `e0deba1` and released in `v0.2.39` (`9021435`). It is schema-free: descriptor cards are generated from existing approved memories, pending/secret-looking memories are filtered before both ordinary and priority descriptor selection, and full memory bodies remain available through explicit `memory_get` / `memory-lane show <id>`.

Dogfood passed: real-project installed SessionStart output used `## Always-on Memory` plus `## Memory Index` within the 1600-char budget, an isolated fixture proved descriptor breadth beyond the old body-oriented cap, policy-only/off smokes passed, and fetch-by-id worked. Validation: `docs/superpowers/validation/2026-06-30-session-start-descriptor-index-dogfood.md`.

Slice B merged in PR #72 as `bc02d04` and released in `v0.2.40` (`7578bb5`). The first vertical slice adds optional bounded descriptor metadata to core records, uses it in SessionStart descriptor cards, and surfaces it on exact show/get inspection. It defers CLI authoring flags, descriptor update/clear, Obsidian/YAML frontmatter, token policy changes, and embeddings/retrieval changes. Spec: `docs/superpowers/specs/2026-06-30-session-start-descriptor-metadata-design.md`.

Dogfood passed after installed `memory-lane upgrade --yes`: exact human and JSON `show` exposed descriptor metadata, released `codex session-start` rendered structured descriptor summaries plus fetch hints, full descriptor-card bodies stayed out of SessionStart, and generated fallback descriptors still worked. Validation: `docs/superpowers/validation/2026-06-30-session-start-descriptor-metadata-dogfood.md`.

Next decision for this track: decide whether to proceed to Slice C Obsidian/YAML frontmatter, proceed to Slice D token-aware policy refinement, or pause this track.

## Active track - Project-local Storage Defaults

The user raised that project-scoped memories stored in the home JSONL can still feel risky even with scope filtering. Directionally, project-scoped memories should live under the project `.memory-lane/` by default, while global-scope preferences/personal memories remain home-scoped.

Approved design: `docs/superpowers/specs/2026-06-30-project-local-storage-default-design.md`.

Slice plan:

1. **Slice 0 - storage facade proof, no default-location flip.** Shipped in `v0.2.42` / PR #78.
   Current storage behavior is preserved while `MemoryEngine` routes through an injectable storage facade with memory append/list/diagnostics, batch append, embedding append/read/invalidation, compaction, path metadata, and continuity-baseline seams.
2. **Slice 1 - project-local default for new project-scoped writes.**
   Shipped in `v0.2.43` / PR #80.
   New project-scoped writes route project-side by default, global-scope preference/personal writes stay home-side, project/home reads merge with deterministic folding, existing ids mutate in their origin store, embeddings/compaction follow owning stores, and read-only CLI/MCP/plugin paths avoid fallback creation while respecting per-request project context.
3. **Slice 2a - legacy project-memory diagnostics.** Shipped in `v0.2.44` / PR #89.
   Legacy home-stored project memories for the active project are detected through bounded `status` / `doctor` diagnostics, and `memory-lane migrate project-local --dry-run` provides a mutation-free preview; silent move/delete/approve/consolidate remains out of scope.
4. **Slice 2b - review-first legacy migration protocol.** Shipped in `v0.2.45` / PR #94.
   Approved spec: `docs/superpowers/specs/2026-07-03-project-local-storage-slice-2b-migration-protocol-design.md`.
   The implementation adds a reviewable `--dry-run --write-plan` flow and an explicit `--apply-plan <path> --yes` apply path.

Current release state: Slice 0 is merged and released in `v0.2.42`; Slice 1 is merged and released in `v0.2.43` alongside continuity routing/context hygiene PR #82 (`a808231`); Slice 2a is merged and released in `v0.2.44` from PR #89 (`96516ef`); Slice 2b is merged in PR #94 (`036fcde`) and released in `v0.2.45` alongside pre-compact session summaries from PR #95 (`83b9b3d`).
Installed-artifact `v0.2.45` validation passed in order: pre-upgrade baseline `memory-lane --smoke-test`, `memory-lane upgrade --yes`, post-upgrade `memory-lane --smoke-test`, Slice 2b dry-run plan generation, apply refusal without `--yes`, explicit apply, idempotent re-apply, and final legacy-candidate count of 0.
Validation: `docs/superpowers/validation/2026-07-03-v0.2.45-release-dogfood.md`.
Fable 5 Waves 1-3 hardening merged in PR #85 as `6da6105`: config merge/backups, hook fail-safe initialization, bounded background embedding shutdown, invalid-row preserving compaction, stale embedding invalidation checks, provider timeout validation, MCP shutdown settling, and docs/status sync.
Fable 5 Wave 4 maintainability/UX follow-through merged in PR #86 as `e2d4aec`: stale status docs were trued up, `.memory-lane-scope` is ignored by default, project-local docs clarify scope identity handling, and the Obsidian CLI command cluster was extracted without intended behavior changes.

Slice 2a legacy project-memory diagnostics is complete, released in `v0.2.44`, and dogfooded from the installed artifact.
Slice 2b review-first legacy migration protocol is complete, released in `v0.2.45`, and dogfooded from the installed artifact.
Fable 5 reviewed the planning direction, full spec, and implementation.
Approved Slice 2b spec: `docs/superpowers/specs/2026-07-03-project-local-storage-slice-2b-migration-protocol-design.md`.
Approved Slice 2a spec: `docs/superpowers/specs/2026-07-02-project-local-storage-slice-2a-legacy-diagnostics-design.md`.
Approved Slice 1 spec: `docs/superpowers/specs/2026-07-01-project-local-storage-slice-1-default-writes-design.md`.
Release validation: `docs/superpowers/validation/2026-07-03-v0.2.45-release-dogfood.md`.
General cross-store rescope moves remain deferred unless a future approved slice explicitly includes them.
Continuity rendering hygiene merged in PR #97 as `9c0040b`; CodeRabbit configuration merged in PR #98 as `4e0b2fb`.
Current implementation slice: generated Pi pre-compact bridge parity.
The slice adds `memory-lane pi pre-compact`, wires release-style generated Pi bridges to `session_before_compact`, saves pending `session_summary` memories with pi `pre_compact` provenance, reuses the lifecycle pre-compact turn digest for dedupe, and keeps Pi host compaction untouched.
After this slice merges, the likely next action is release prep and installed-artifact dogfood for generated Pi pre-compact bridge behavior.

Retrieval-quality status: currentness tie-break merged in PR #75 and shipped in `v0.2.41`; pause retrieval-ranking work unless new dogfood/eval evidence justifies another proposal.

## Other viable future tracks

- **Continuity routing/context hygiene follow-ups:** PR #82 shipped in `v0.2.43`, and duplicate continuity rendering hygiene merged in PR #97.
  Current follow-up work is generated Pi pre-compact bridge parity so release-style generated Pi bridges match native Pi pre-compact session-summary support.
  Scope stays review-first and avoids LLM classifier behavior, automatic supersession, or silent memory mutation.
- **Review-first consolidation proposals:** identify overlapping/superseded memories and suggest manual `update` / `replace` / `supersede` commands. Keep review-first; no auto-consolidation or auto-approval.
- **Docs/context-budget follow-up:** consider README splitting or generated current-state docs if README becomes the next major context source.
- **Hardening backlog:** installer/init wizard improvements, Claude Desktop MCP config path tests, import dry-run secret warnings, and broader read-only taxonomy checks.
  PR #85 covered the storage/config reliability subset; leave import warnings and broader read-only taxonomy as future work unless separately approved.
- **Outcome-informed learning:** use approval/rejection/delete/rescope/replace/supersede decisions as reviewable signals for future suggesters, without silent self-training or durable policy mutation.

## Deferred improvements

These items are intentionally not in the active roadmap. Add them only after real-world usage justifies the work.

- **Multi-session narrative compression.** Combine many session summaries into a higher-level project chronicle.
- **Cross-project memory inheritance.** Allow memories to be marked reusable across projects.
- **Automatic preference learning.** Infer implicit preferences from chat history beyond explicit saves and session summaries.
- **Opt-in memory sharing.** Let teams share selected project memories across machines or collaborators.
- **Retrieval/ranking upgrades.** Consider RRF, reranking, graph expansion, or embedding-default changes only after eval evidence.
- **Memory-Lane-configured continuity classifier.** Future harness-agnostic design only: opt-in configured provider, deterministic-first, ambiguous-only, no harness-current-model assumption, with MCP handled through tool-description steering because MCP has no pre-turn lifecycle.
