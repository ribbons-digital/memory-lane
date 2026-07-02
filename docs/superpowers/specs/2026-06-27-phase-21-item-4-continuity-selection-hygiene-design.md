# Phase 21 Item 4 — Continuity Selection Hygiene Design

## Goal

Reduce context pollution in Memory Lane continuity output by preventing generic broad “next work” queries from surfacing stale workstream candidates, and preventing release/checkpoint-style project facts from appearing as operating guidance.

## Evidence

After PR #67, `memory-lane continuity --query "what should we work on next?" --json` correctly reports latest progress, but still shows:

- `operatingGuidance` entries that are release/checkpoint or review-checkpoint project facts rather than durable workflow guidance, including live body shapes like:
  - `1098781c`: “Cross-harness Memory Lane review checkpoint ...”
  - `7eab3ad9`: “Released Memory Lane `v0.2.34` from main commit `f84ee46` after PR #63 ...”
  - `0b56ed5d`: “Released Memory Lane v0.2.33 from `main` at `5046d8d` after PR #61 ...”
- `workstreamDiscovery.candidates` for stale old next-slice decisions because generic words like `should` and `next` are treated as topic terms.

The live noisy operating-guidance records miss progress classification because existing progress evidence is too narrow:

- release evidence requires the release verb immediately before the version;
- commit evidence does not allow optional backticks;
- project/checkpoint labels like “review checkpoint” are not recognized as progress evidence.

They then fall through to broad operating-agreement classification through incidental terms such as `installer` or `PR`.

## Design

### 1. Generic broad next/status queries should not create workstream candidates

In `packages/core/src/workstream-discovery.ts`:

- Add missing generic stopwords: `should`, `next`, `current`, `project`, `latest`, `progress`, `slice`, `item`.
- Do not add `status`; it already exists.
- Keep the existing token length rule, so two-letter `pr` remains filtered. Topic-specific PR queries should still match via longer terms such as `body` and `formatting`.
- Add an empty-topic gate at the candidate construction site: when `topicTerms.length === 0`, return no candidate even if `references`, `resume-cue`, or `status-cue` would otherwise make `matched` true.
- Preserve the existing result object, intent, suggested actions, and `no-topic` warning. Do not add a new warning code.

### 2. Release/checkpoint project facts should classify as progress before operating guidance

In `packages/core/src/continuity-roles.ts`, add progress evidence for approved project continuity kinds:

- release verb (`released`, `tagged`, `published`) followed by a version within a bounded same-sentence/same-clause window: up to 120 chars that are not newline or sentence terminators before `v?X.Y.Z`;
- `commit`, `sha`, or `revision` followed by optional backticks around 7–40 hex chars;
- checkpoint labels such as `review checkpoint` or `project checkpoint` / word-boundary checkpoint phrase.

Because `classifyContinuityRole` checks progress before operating agreement, live release/checkpoint bodies become `progress` and are excluded from `operatingGuidance`.

### 3. Project facts/preferences need explicit durable-rule language to become operating guidance

In `isFieldDerivedOperatingAgreement`, add an explicit project-scoped guard:

- Apply only when `memory.scope.type === "project"` and kind is `project_fact` or `preference`.
- Require durable-rule/procedure language such as:
  - `workflow rule:`
  - `project workflow rule:`
  - `procedure:`
  - `operating agreement`
  - `always`
  - `must`
  - `do not`
  - `when ... use ...`

Preserve:

- `correction` and `procedure` roles;
- global `workflow_rule` records;
- global manual workflow preferences;
- `continuity-read-model.ts` `GLOBAL_WORKFLOW_TEXT_PATTERN`.

## Tests / acceptance

Add focused tests before implementation:

1. A core read-model fixture with full live body shapes plus explicit workflow rule `1f373bd2` and newer genuine checkpoint `d0dd92ee`:
   - `operatingGuidance` excludes `1098781c`, `7eab3ad9`, and `0b56ed5d`;
   - `operatingGuidance` includes `1f373bd2`;
   - `latestProgress.id` is `d0dd92ee` by using a strictly newer `updatedAt` for that checkpoint.
2. Generic `what should we work on next?` workstream discovery returns `candidates: []` and includes `no-topic`.
3. Topic-specific queries still work:
   - `where did we fix PR body formatting?` returns the correction/procedure candidate;
   - `current PR formatting` returns the same candidate through the `formatting` term.

Run targeted core tests first, then broader verification.

## Non-goals

- No retrieval rewrite, embeddings/RRF, or query reranking overhaul.
- No schema changes.
- No memory mutation, deletion, cleanup, approval, or auto-consolidation.
- No lifecycle injection changes for Item 4's core continuity-selection fix. A later continuity-routing hygiene slice intentionally changed lifecycle prompt routing and generated Pi bridge routing to share `memory-lane route --prompt <text> --json` decisions.
- No generated adapter changes for Item 4's core continuity-selection fix.
- No token budget retuning.
- No persisted workstream IDs.
