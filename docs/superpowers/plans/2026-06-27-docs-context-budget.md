# Docs Context Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce fresh-thread docs context cost by moving historical roadmap bulk into an archive and keeping current docs/skill guidance continuity-first.

**Architecture:** This is a docs-only refactor. Root `ROADMAP.md` becomes the active planning index; historical completed phases through Phase 20.5 move intact into an archive file. `HANDOFF.md` and `skills/memory-lane/SKILL.md` are tightened only where needed to preserve compact current-state guidance.

**Tech Stack:** Markdown docs, shell verification with `wc`, `rg`, and `git diff --check`.

---

## File map

- Create: `docs/superpowers/archive/roadmap-through-phase-20-5.md` — historical roadmap sections through Phase 20.5, preserved from current `ROADMAP.md` with brief archive framing.
- Modify: `ROADMAP.md` — compact current-first roadmap with archive links, Phase 21 complete status, next recommended eval-first track, and root-vs-archive maintenance guidance.
- Modify: `HANDOFF.md` — compact current status card; remove remaining non-current bulk if necessary.
- Modify: `skills/memory-lane/SKILL.md` — strengthen continuity-first, compact-docs-only guidance for broad project-status/next-work prompts.

## Baseline commands

- [ ] **Step 1: Capture current sizes**

Run:

```bash
wc -l -c HANDOFF.md ROADMAP.md skills/memory-lane/SKILL.md
```

Expected current approximate output:

```text
      84    8022 HANDOFF.md
     704   68203 ROADMAP.md
     191   10204 skills/memory-lane/SKILL.md
```

- [ ] **Step 2: Confirm branch and spec commit**

Run:

```bash
git status --short --branch
git log --oneline -3
```

Expected:

```text
## docs/context-budget
ad7347d docs: specify context budget slice
309021e docs: declare phase 21 complete
57923c6 docs: sync v0.2.37 release status
```

## Task 1: Archive historical roadmap bulk

**Files:**
- Create: `docs/superpowers/archive/roadmap-through-phase-20-5.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Identify the archive cut**

Run:

```bash
rg -n "^## Phase 21|^## Future Track|^## Deferred improvements|^## Product North Star|^## Product Learning|^## Production Installer|^## Phase 1" ROADMAP.md
```

Expected important anchors:

```text
16:## Product North Star — Cross-Agent Continuity Without Silent Autonomy
36:## Product Learning — agentmemory Comparison
42:## Production Installer
56:## Phase 1 — Obsidian Mirror Foundation
650:## Phase 21 — Handoff-Free Sessions
688:## Future Track — Retrieval Quality, Continuity Typing, and Evaluation
698:## Deferred improvements
```

- [ ] **Step 2: Create archive file from historical sections**

Create `docs/superpowers/archive/roadmap-through-phase-20-5.md` with:

```markdown
# Memory Lane Roadmap Archive Through Phase 20.5

This archive preserves completed historical roadmap detail moved out of root `ROADMAP.md` during the docs/context-budget slice. Root `ROADMAP.md` is the active planning index. Read this archive only when historical phase detail is needed.

```

Then append the old `ROADMAP.md` sections from `## Product Learning — agentmemory Comparison` through the end of `## Phase 20.5 — Dogfooding and Exit Validation`, stopping immediately before `## Phase 21 — Handoff-Free Sessions`.

Use a script to avoid manual copy mistakes:

```bash
python - <<'PY'
from pathlib import Path
roadmap = Path('ROADMAP.md').read_text()
start = roadmap.index('## Product Learning — agentmemory Comparison')
end = roadmap.index('## Phase 21 — Handoff-Free Sessions')
archive = Path('docs/superpowers/archive/roadmap-through-phase-20-5.md')
archive.write_text(
    '# Memory Lane Roadmap Archive Through Phase 20.5\n\n'
    'This archive preserves completed historical roadmap detail moved out of root `ROADMAP.md` during the docs/context-budget slice. Root `ROADMAP.md` is the active planning index. Read this archive only when historical phase detail is needed.\n\n'
    + roadmap[start:end].rstrip()
    + '\n'
)
PY
```

- [ ] **Step 3: Replace root roadmap with compact current-first content**

Rewrite `ROADMAP.md` to contain:

```markdown
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
```

- [ ] **Step 4: Verify archive/root anchors**

Run:

```bash
rg -n "Product Learning|Phase 20\.5|Phase 21|Retrieval Quality|roadmap-through-phase-20-5" ROADMAP.md docs/superpowers/archive/roadmap-through-phase-20-5.md
```

Expected:

- `ROADMAP.md` contains `Phase 21`, `Retrieval Quality`, and the archive link.
- Archive contains `Product Learning` and `Phase 20.5`.
- Archive does not contain `## Phase 21`.

## Task 2: Tighten handoff status card

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Rewrite handoff as compact status card**

Replace `HANDOFF.md` with:

```markdown
# Memory Lane Handoff

## Current state

- Branch context: `main` is synced through `309021e docs: declare phase 21 complete`; current docs/context-budget work is on feature branch `docs/context-budget`.
- Latest release: `v0.2.37` at tag/commit `6d234c3`; release workflow `28275316878` passed and published 8 assets.
- Phase 21 `Handoff-Free Sessions` is complete and dogfooded. Fresh-thread prompt `where are we in the project and what should we work on next?` used about 11.8% context, improved from the previous 14.x% range.
- Active docs/context-budget slice goal: make root docs safe to inspect by default by archiving historical roadmap bulk and strengthening continuity-first skill guidance.

## Current decision / next work

After this docs/context-budget slice, the recommended product track is **Retrieval Quality / Continuity Evaluation**:

1. build a small reproducible eval corpus from real dogfooded Memory Lane records;
2. add labeled continuity/recall queries;
3. measure current recall@k, precision@k, and failure cases;
4. write findings before changing retrieval/ranking.

## Load-bearing constraints

- For broad prior-work/project-status/next-work questions, call Memory Lane continuity first and verify against compact repo state when available.
- At phase/slice completion, release, merge, or next-work recommendation, sync status docs before calling work complete.
- Use Opus 4.8 for Memory Lane design/spec and pre-PR implementation reviews with: `claude --model claude-opus-4-8 -p '<review prompt>'`.
- PR-protected workflow applies: feature branch/worktree → PR → wait for user merge → sync main/delete feature branch/recommend next item.
- Avoid retrieval rewrites, auto-consolidation, silent deletion, schema expansion, raw transcript indexing, token retuning, or persisted workstream IDs unless a new approved slice explicitly includes them.

## Current verification evidence

- `v0.2.37` release workflow passed; installed upgrade via `memory-lane upgrade --yes` passed and reconfigured Pi.
- Installed broad next-work continuity returned latest progress, empty workstream candidates, and `no-topic`.
- Installed operating guidance excluded stale release/checkpoint ids `1098781c`, `7eab3ad9`, and `0b56ed5d`.
- Installed topic-specific continuity query still returned workstream candidates.
- Phase 21 completion checkpoint memory: `2e8348f6`.

## Key references

- Active roadmap/current direction: `ROADMAP.md`
- Historical roadmap archive through Phase 20.5: `docs/superpowers/archive/roadmap-through-phase-20-5.md`
- Full old handoff chronology: `docs/superpowers/archive/2026-06-26-pre-docs-hygiene-handoff.md`
- Docs/context-budget design: `docs/superpowers/specs/2026-06-27-docs-context-budget-design.md`
- Memory Lane skill guidance: `skills/memory-lane/SKILL.md`
- User-facing package docs: `README.md`
```

- [ ] **Step 2: Verify handoff size and required facts**

Run:

```bash
wc -l -c HANDOFF.md
rg -n "v0\.2\.37|Phase 21|Retrieval Quality|Opus 4\.8|continuity first|roadmap-through-phase-20-5" HANDOFF.md
```

Expected:

- About 40–60 lines.
- Under about 5 KB.
- All required facts are present.

## Task 3: Tighten Memory Lane skill guidance

**Files:**
- Modify: `skills/memory-lane/SKILL.md`

- [ ] **Step 1: Update fast-path repo-doc guidance**

In `skills/memory-lane/SKILL.md`, replace the fast-path verification bullet block:

```markdown
3. Verify against compact repo state when available:
   - `HANDOFF.md` → `## Current state`, `## Current decision / next work`, `## Load-bearing constraints`
   - `ROADMAP.md` → current phase/status section, not the whole file unless needed
   - `README.md` only for user-facing command/setup changes
   - this skill only for workflow/Memory Lane command guidance
```

with:

```markdown
3. Verify against compact repo state when available, but keep reads bounded:
   - `HANDOFF.md` → safe status card; read current state, next work, and constraints only.
   - `ROADMAP.md` → active planning index; read current status and recommended next track first.
   - `docs/superpowers/archive/*` → historical detail only; do not read archived roadmap/history for broad status prompts unless the user asks for history.
   - `README.md` → only for user-facing command/setup changes.
   - this skill → only for workflow/Memory Lane command guidance.
```

- [ ] **Step 2: Update docs sync rule language**

In `skills/memory-lane/SKILL.md`, replace:

```markdown
For the Memory Lane repository itself, do not call a phase/slice/merge/release complete and do not recommend next work until project status docs are checked and synced. Use compact current-state sections first; do not read whole long reference docs unless needed. At minimum check whether `HANDOFF.md`, `ROADMAP.md`, `README.md`, and this skill need updates when status, commands, workflow guidance, or release state changed. Memory checkpoints are helpful but not sufficient; repository docs must remain authoritative for new sessions.
```

with:

```markdown
For the Memory Lane repository itself, do not call a phase/slice/merge/release complete and do not recommend next work until project status docs are checked and synced. Use continuity first, then compact current docs. Do not read archived roadmap/history or long reference docs unless the task requires history. At minimum check whether `HANDOFF.md`, root `ROADMAP.md`, `README.md`, and this skill need updates when status, commands, workflow guidance, or release state changed. Memory checkpoints are helpful but not sufficient; root docs must remain authoritative for new sessions.
```

- [ ] **Step 3: Verify skill size and guidance**

Run:

```bash
wc -l -c skills/memory-lane/SKILL.md
rg -n "keep reads bounded|archived roadmap|continuity first|root `ROADMAP.md`" skills/memory-lane/SKILL.md
```

Expected:

- File size no larger than the baseline from Step 1.
- New bounded-read guidance is present.

## Task 4: Final verification and docs commit

**Files:**
- Modified: `HANDOFF.md`
- Modified: `ROADMAP.md`
- Modified: `skills/memory-lane/SKILL.md`
- Created: `docs/superpowers/archive/roadmap-through-phase-20-5.md`

- [ ] **Step 1: Run size verification**

Run:

```bash
wc -l -c HANDOFF.md ROADMAP.md skills/memory-lane/SKILL.md docs/superpowers/archive/roadmap-through-phase-20-5.md
```

Expected:

- `HANDOFF.md`: about 40–60 lines, under about 5 KB.
- `ROADMAP.md`: about 150–250 lines.
- `skills/memory-lane/SKILL.md`: no larger than baseline.
- Archive file contains most of the historical roadmap bytes.

- [ ] **Step 2: Run content verification**

Run:

```bash
rg -n "v0\.2\.37|Phase 21|Retrieval Quality|roadmap-through-phase-20-5|docs/context-budget" ROADMAP.md HANDOFF.md skills/memory-lane/SKILL.md docs/superpowers/archive/roadmap-through-phase-20-5.md
```

Expected:

- Current docs include `v0.2.37`, `Phase 21`, `Retrieval Quality`, and `docs/context-budget` where appropriate.
- Root roadmap links to archive.
- Archive includes historical content and no active Phase 21 section.

- [ ] **Step 3: Run whitespace verification**

Run:

```bash
git diff --check
```

Expected: no output and exit status 0.

- [ ] **Step 4: Review diff**

Run:

```bash
git diff --stat
git diff -- ROADMAP.md HANDOFF.md skills/memory-lane/SKILL.md | less
```

Expected:

- `ROADMAP.md` is compact current-first content.
- Archive contains moved historical content.
- `HANDOFF.md` is compact status card.
- Skill guidance is bounded-read and continuity-first.

- [ ] **Step 5: Commit implementation**

Run:

```bash
git add HANDOFF.md ROADMAP.md skills/memory-lane/SKILL.md docs/superpowers/archive/roadmap-through-phase-20-5.md
git commit -m "docs: reduce roadmap context budget"
```

Expected: commit succeeds.

## Task 5: PR preparation

**Files:**
- No file changes unless PR body temp file is created under `/tmp`.

- [ ] **Step 1: Confirm branch status**

Run:

```bash
git status --short --branch
git log --oneline -5
```

Expected:

- On branch `docs/context-budget`.
- Working tree clean.
- Commits include spec commit and docs implementation commit.

- [ ] **Step 2: Push branch**

Run:

```bash
git push -u origin docs/context-budget
```

Expected: branch pushed.

- [ ] **Step 3: Create PR body file**

Create `/tmp/pr-docs-context-budget.md`:

```markdown
## Summary

- compact root `ROADMAP.md` into an active planning index
- move completed historical roadmap detail through Phase 20.5 into `docs/superpowers/archive/roadmap-through-phase-20-5.md`
- shrink `HANDOFF.md` into a current status card
- tighten Memory Lane skill guidance to use continuity first and avoid archived roadmap/history by default

## Verification

- `wc -l -c HANDOFF.md ROADMAP.md skills/memory-lane/SKILL.md docs/superpowers/archive/roadmap-through-phase-20-5.md`
- `rg -n "v0\.2\.37|Phase 21|Retrieval Quality|roadmap-through-phase-20-5|docs/context-budget" ROADMAP.md HANDOFF.md skills/memory-lane/SKILL.md docs/superpowers/archive/roadmap-through-phase-20-5.md`
- `git diff --check`

## Notes

Docs-only change. No code, retrieval, ranking, CLI, MCP, or memory mutation changes.
```

- [ ] **Step 4: Open PR**

Run:

```bash
gh pr create --title "docs: reduce roadmap context budget" --body-file /tmp/pr-docs-context-budget.md
```

Expected: PR URL returned.

## Plan self-review

- Spec coverage: archive extraction, compact root roadmap, handoff verify/tighten, skill bounded-read guidance, numeric verification, and non-goals are all covered.
- Placeholder scan: no TBD/TODO placeholders are present.
- Type consistency: not applicable; docs-only plan.
