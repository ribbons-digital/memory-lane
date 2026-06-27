# Docs Context Budget Design

## Goal

Reduce Memory Lane's fresh-thread context cost for broad project-status and next-work prompts by making repository docs index-first and safe to inspect in bounded sections.

Phase 21 and PR #67 already made substantial progress: automatic continuity is cleaner, `HANDOFF.md` was compacted, old handoff chronology was archived, and the Memory Lane skill gained a continuity-first fast path. The remaining high-value context problem is the root `ROADMAP.md`: it is still about 68 KB / 704 lines because it carries completed phase history inline.

This slice should preserve the docs-sync workflow while moving historical roadmap detail out of the default reading path.

## Scope

This slice is docs + skill guidance only.

1. **Extract historical roadmap bulk**
   - Move completed historical roadmap sections through Phase 20.5 into `docs/superpowers/archive/roadmap-through-phase-20-5.md`.
   - Keep Phase 21, current status, future tracks, deferred tracks, and archive links in root `ROADMAP.md`.
   - Preserve moved historical content intact except for minimal archive heading/context text.

2. **Keep root `ROADMAP.md` compact and current-first**
   - Keep product north star, current declared status, next recommended track, future/deferred tracks, and archive links.
   - Add maintenance guidance: new current work belongs in root while active; completed historical detail should be summarized in root and moved/linked to archive docs when it stops guiding immediate decisions.
   - Target: root `ROADMAP.md` roughly 150–250 lines and small enough to read wholesale when roadmap context is needed.

3. **Verify/tighten `HANDOFF.md`**
   - `HANDOFF.md` is already compact from PR #67; avoid redoing that work.
   - Remove only remaining non-current bulk if clearly unnecessary.
   - Preserve current branch/release/Phase 21-complete status, next recommended track, and load-bearing constraints.
   - Target: roughly 40–60 lines and under about 5 KB.

4. **Tighten `skills/memory-lane/SKILL.md` guidance**
   - Preserve continuity-first guidance for broad project-status/next-work prompts.
   - Explicitly direct agents to compact current sections after continuity.
   - Warn against reading archived roadmap/history unless the user asks for historical detail.
   - Keep the skill roughly the same size or smaller.

## Non-goals

- No code changes.
- No retrieval/ranking changes.
- No new CLI/MCP surface.
- No release unless separately requested.
- No memory mutation or cleanup.
- No generated documentation system.
- No broad README rewrite; README's size is a known separate context cost and is intentionally deferred unless a tiny cross-reference is needed.

## Design

### Root roadmap

`ROADMAP.md` should become the active planning index, not the full historical record. Its top-level structure should be:

1. product north star;
2. active docs maintenance rule for root vs archive;
3. current status: Phase 21 complete;
4. next recommended track: Retrieval Quality / Continuity Evaluation, eval-first;
5. future/deferred tracks;
6. archive links.

The detailed completed phases through Phase 20.5 should move intact to an archive file. Phase 21 should remain in root because it is the newly declared complete status and still anchors the transition to the next track.

### Handoff document

`HANDOFF.md` should remain a thin status card:

- current branch/release/phase status;
- current recommended next slice;
- only the constraints needed to avoid workflow mistakes;
- a compact link list to roadmap, specs, validation, archive, and README.

It should not carry package inventory, integration API semantics, long release chronology, or duplicate roadmap prose.

### Skill guidance

The Memory Lane skill should make the desired reading path explicit:

1. call continuity first;
2. inspect `HANDOFF.md` only as a compact status card;
3. inspect only the current/next sections of `ROADMAP.md` unless a full roadmap read is necessary;
4. avoid archived roadmap/history and long references unless the user asks for them.

This preserves the docs-sync workflow rule while reducing context bloat.

## Acceptance criteria

- Root `ROADMAP.md` is about 150–250 lines after the archive extraction.
- `HANDOFF.md` remains about 40–60 lines and under about 5 KB unless preserving current status requires slightly more.
- `skills/memory-lane/SKILL.md` is no larger than before this slice.
- Phase 21-complete status, `v0.2.37` release status, next recommended eval-first track, and load-bearing workflow constraints remain in current docs.
- Historical phases through Phase 20.5 are preserved in `docs/superpowers/archive/roadmap-through-phase-20-5.md` and linked from root `ROADMAP.md`.
- Root-vs-archive maintenance guidance is present so future docs syncs do not re-bloat root `ROADMAP.md`.
- Archived history is not the default reading path for broad project-status/next-work prompts.
- `git diff --check` passes.

## Verification plan

Run:

```bash
wc -l -c HANDOFF.md ROADMAP.md skills/memory-lane/SKILL.md docs/superpowers/archive/roadmap-through-phase-20-5.md
git diff --check
```

Also inspect:

```bash
rg -n "roadmap-through-phase-20-5|Phase 21|v0\.2\.37|Retrieval Quality|continuity first|archived roadmap" ROADMAP.md HANDOFF.md skills/memory-lane/SKILL.md
```

Before implementation, capture current sizes so the reduction is measurable. During implementation, prefer a move-preserving edit for the roadmap history; do not rewrite historical phase prose unless needed to add archive framing.

Because the slice is docs-only, full package tests are not required unless implementation accidentally touches code or generated files.

## Spec self-review

- No placeholders or TBDs remain.
- Scope is limited to docs and skill guidance.
- Archive cut line is explicit: through Phase 20.5, not Phase 21.
- Numeric acceptance criteria are testable.
- README size is acknowledged and intentionally deferred.
