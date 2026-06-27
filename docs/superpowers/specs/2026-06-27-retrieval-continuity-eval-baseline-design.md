# Retrieval and Continuity Evaluation Baseline Design

## Status

Approved and implemented on `feat/retrieval-continuity-eval-baseline`. This is the first retrieval quality / continuity evaluation slice after Phase 21 `Handoff-Free Sessions` and the `v0.2.38` docs/context-budget release.

This slice is deliberately **eval-first**. It establishes the baseline before any retrieval/ranking changes are proposed.

## Context

Phase 21 made broad Memory Lane continuity usable across harnesses with lower context cost. The current root roadmap recommends the next track as **Retrieval Quality / Continuity Evaluation**:

1. build a small reproducible eval corpus from real dogfooded Memory Lane records;
2. add labeled continuity/recall queries;
3. measure current recall@k, precision@k, and failure cases;
4. write findings before changing retrieval/ranking.

The project already completed an earlier continuity typing/ranking eval slice in `docs/superpowers/specs/2026-06-25-continuity-typing-ranking-eval-design.md`. That prior slice addressed a specific continuity read-model failure: broad status prompts could over-emphasize newer workflow corrections instead of latest project progress. It added the `latestProgress` and `operatingGuidance` read-model concepts while preserving compatibility with `latestApproved.project`.

This new slice is broader and should not redo that work. It should establish a reproducible baseline for both:

- the **continuity lane**: `memory-lane continuity` / `memory_continuity` surfaces used for broad prior-work, project-status, next-work, and topic-specific workstream prompts;
- the **recall lane**: explicit `memory-lane recall <query>` / `memory_recall` retrieval over approved memories.

## Problem

Memory Lane retrieval and continuity behavior is currently assessed mostly through dogfood anecdotes, focused regression tests, and manual repository verification. That was enough to harden Phase 21 continuity routing, but it is not enough to justify heavier retrieval changes such as RRF, reranking, embedding-default changes, lifecycle budget tuning, or new viewer surfaces.

Without a reproducible eval baseline, the project risks optimizing retrieval based on vibes:

- improving one broad continuity prompt while hurting topic-specific recall;
- surfacing workflow corrections as if they were current project state;
- confusing stale checkpoints with current release status;
- changing lexical/semantic scoring without measuring whether user-facing answers improve.

## Goals

1. Define a small deterministic eval corpus with sanitized records modeled after real dogfooded Memory Lane cases.
2. Cover both continuity surfaces and explicit recall surfaces.
3. Add labeled queries with graded relevance labels: `required`, `acceptable`, `distractor`, and `forbidden`.
4. Measure baseline behavior with per-query and aggregate results.
5. Make the first slice baseline/report-only: structural failures should fail tests, but quality metrics should not become CI gates yet.
6. Keep eval machinery internal/test-only until the shape proves useful.
7. Produce a short findings doc before any retrieval/ranking changes are proposed.

## Non-goals

- No retrieval/ranking changes.
- No semantic embeddings, RRF, reranking, or embedding-provider work.
- No LLM evaluator or LLM classifier.
- No raw transcript indexing or live memory JSONL export into the repo.
- No new public CLI, MCP, pi, or programmatic API surface such as `memory-lane eval`.
- No production eval module/export from `@memory-lane/core`.
- No quality-threshold CI gates in the first slice.
- No durable memory schema migration or persisted eval metadata.
- No memory mutation, auto-consolidation, cleanup, approval, rejection, rescope, or deletion.
- No lifecycle injection budget changes.
- No harness-specific behavior changes.
- No `CONTEXT.md` rewrite.
- No ADR for this slice.

## Eval terms

**Eval corpus**: A deterministic set of sanitized `MemoryRecord`-shaped fixtures and labeled queries checked into the repository for tests. The corpus is modeled after real dogfood cases but must not copy raw private memory JSONL wholesale.

**Continuity lane**: Evaluation of `buildContinuityReadModel()` / `memory-lane continuity` behavior. This lane scores section/slot correctness first, with ranked-list metrics only for ranked sublists such as `workstreamDiscovery.candidates`.

**Recall lane**: Evaluation of explicit recall behavior through `MemoryEngine.recall()` using the default no-embedding configuration. In this mode, recall uses the no-provider lexical fallback path: lexical score only, with stable-sort tie behavior determined by the folded store order, which is created-at order for the JSONL store. Semantic-branch recency scoring and checkpoint-recall boost are inactive because no semantic provider is used.

**Required record**: A record that must appear in the target slot or top-k result for the query to count as successful.

**Acceptable record**: Relevant supporting context. Its presence is useful but not required.

**Distractor record**: Irrelevant context that should not count as relevant for precision.

**Forbidden record**: Actively harmful in a target slot or ranking position, such as stale release status beating current release status or workflow guidance occupying `latestProgress` for a broad status prompt.

**recall@k**: For recall lane and ranked continuity sublists, the fraction of required record ids present in the top-k scored results.

**precision@k**: For recall lane and ranked continuity sublists, the fraction of scored top-k result ids labeled `required` or `acceptable` for the query. In the default no-embedding recall path, lexical fallback can pad results with zero-score visible memories. The eval helper should exclude zero-score padding from the precision denominator so precision is not mechanically depressed by unrelated filler records.

**Failure tag**: A deterministic label attached to an eval result to explain observed baseline failures, for example `missing-required`, `forbidden-returned`, `wrong-slot`, `stale-over-current`, or `topic-mismatch`.

## Agreed design decisions

1. Evaluate both continuity and explicit recall lanes.
2. Use sanitized real-shaped fixtures, not raw exported live memories.
3. Keep the first slice baseline/report-only: fail only on malformed fixtures, crashes, or missing report fields, not metric quality.
4. Use graded labels: `required`, `acceptable`, `distractor`, `forbidden`.
5. Keep eval machinery internal/test-only; do not add a public `memory-lane eval` command.
6. Baseline default/no-embedding behavior only.
7. Emit per-query results plus aggregate summary metrics.
8. Score continuity primarily by slot correctness; use top-k metrics only for ranked sublists such as `workstreamDiscovery.candidates`.
9. Keep eval helpers in tests; do not add a production core eval module/export yet.
10. Start with six fixture scenarios.
11. Define terms locally in the spec; do not update the existing nonconforming `CONTEXT.md` in this slice.
12. Do not create an ADR.

## Minimum fixture corpus

The first corpus should be intentionally small: enough to expose current behavior and guide next decisions, but not large enough to become a benchmark maintenance burden.

Use stable fake ids and realistic sanitized text. Suggested id style: `eval-progress-v038`, `eval-pr-body-rule`, `eval-stale-v037`, etc. Use one fixed synthetic project scope key, such as `eval/project`, for all project-scoped fixtures. Continuity helpers must pass this key explicitly to `buildContinuityReadModel(records, { projectScopeKey: "eval/project", query, generatedAt })`. Recall helpers must ensure the same project-scoped fixtures are visible by passing `MemoryEngine.recall(query, { projectScope: { key: "eval/project", root: fixtureRoot, cwd: fixtureRoot } })` or an equivalent test-only scope object. The implementation plan should document the chosen recall visibility approach in the test helper.

### 1. Broad project status continuity

- Query: `where are we in the project?`
- Lane: continuity.
- Required: latest release/checkpoint appears in `latestProgress`.
- Acceptable: related current status docs/checkpoint context appears elsewhere.
- Forbidden: stale checkpoint or workflow correction appears in `latestProgress`.
- Failure tags to detect: `wrong-slot`, `stale-over-current`, `forbidden-returned`.

### 2. Next-work continuity

- Query: `what should we work on next?`
- Lane: continuity.
- Required: roadmap/next-track memory or session summary identifying the retrieval-quality eval track.
- Acceptable: operating guidance that constrains how to do the next work.
- Forbidden: unrelated old slice treated as primary current progress or next work.
- Failure tags to detect: `missing-required`, `topic-mismatch`, `stale-over-current`.

### 3. Topic-specific continuity/workstream

- Query: `where did we fix PR body formatting?`
- Lane: continuity.
- Required: PR-body correction/procedure appears in `workstreamDiscovery.candidates` top-k.
- Acceptable: related workflow guidance appears in `operatingGuidance`.
- Forbidden: unrelated release/status checkpoint dominates the workstream candidate list.
- Failure tags to detect: `missing-required`, `topic-mismatch`.

### 4. Explicit recall: workflow rule

- Query: `how should I create GitHub PR descriptions?`
- Lane: recall.
- Required: body-file workflow correction/procedure.
- Acceptable: broader PR-process agreement.
- Distractor: unrelated release status.
- Failure tags to detect: `missing-required`, `topic-mismatch`.

### 5. Explicit recall: project checkpoint

- Query: `what release shipped docs context-budget?`
- Lane: recall.
- Required: `v0.2.38` release/status checkpoint.
- Acceptable: PR #69 docs/context-budget memory or docs-sync checkpoint.
- Distractor: unrelated workflow correction.
- Failure tags to detect: `missing-required`, `topic-mismatch`.

### 6. Explicit recall: stale-vs-current release status

- Query: `what is the current Memory Lane release status?`
- Lane: recall.
- Required: newest release checkpoint.
- Acceptable: immediate post-release docs sync status.
- Forbidden: older release checkpoint when it ranks at or above the newest required checkpoint within the evaluated top-k scored results.
- Expected interpretation: under the default lexical-only no-embedding fallback, recall does not know recency. If older and newer release checkpoints have equal lexical score, deterministic fixture/store order can decide which appears first. This scenario is intentionally allowed to expose `stale-over-current` as a baseline failure rather than assuming recall can solve currentness today.
- Failure tags to detect: `stale-over-current`, `forbidden-returned`.

## Fixture shape

Implementation can choose JSON or TypeScript fixtures, but the fixture shape should make labels readable in review. A JSON-ish shape might look like:

```ts
interface EvalCorpus {
  records: MemoryRecord[]
  queries: EvalQuery[]
}

interface EvalQuery {
  id: string
  lane: "continuity" | "recall"
  query: string
  k?: number
  labels: Record<string, "required" | "acceptable" | "distractor" | "forbidden">
  continuityExpectations?: ContinuityExpectation[]
}

interface ContinuityExpectation {
  slot: "latestProgress" | "operatingGuidance" | "workstreamDiscovery.candidates" | "pendingContinuity"
  required?: string[]
  acceptable?: string[]
  forbidden?: string[]
}
```

The exact implementation does not need to export these types from production core. They can live in test files or test helpers.

## Scoring rules

### Recall lane

For each recall query:

1. Run `MemoryEngine.recall(query)` against an isolated test store loaded with fixture records.
2. Capture `RecallResult.memories.map((memory) => memory.id)`; recall returns `MemoryRecord[]`, not bare ids.
3. Let the test helper own the evaluated k by slicing the returned memories to a small stable k such as 3 or 5. `RecallOptions` defines `topK`, but `MemoryEngine.recall()` does not currently forward `options.topK` to retrieval, so an eval helper must not rely on passing a recall argument for k. The evaluated k is the helper's slice over returned memories.
4. Treat the baseline as default no-provider lexical fallback retrieval with no semantic vectors. This is lexical-only ranking; recency score and checkpoint-recall boost belong to the semantic branch and are inactive in this baseline.
5. Compute:
   - `recall@k = required ids found in the helper's top-k scored results / required ids total`;
   - `precision@k = scored top-k ids labeled required or acceptable / scored top-k ids returned`, excluding zero-score fallback padding from the denominator. Because `MemoryEngine.recall()` returns records without scores, the test helper may recompute lexical scores for returned records using the exported scoring/search helpers solely to identify zero-score padding for precision accounting. Fixture authors should account for the current lexical tokenizer's stop-word behavior: broad phrasing such as `where are we in the project?` may reduce to only a few content tokens, so scenario text must be deliberate and findings should interpret tokenizer effects as part of the baseline rather than as hidden test noise.
6. Add failure tags when:
   - a required id is missing from top-k (`missing-required`);
   - a forbidden id appears in top-k (`forbidden-returned`);
   - a forbidden stale record ranks above a required current record (`stale-over-current`);
   - most returned ids are distractors (`topic-mismatch`).

The first slice records these metrics but does not fail CI based on their values.

### Continuity lane

For each continuity query:

1. Run pure `buildContinuityReadModel(records, { projectScopeKey, query, generatedAt })` against fixture records. Do not use `MemoryEngine.continuity({ query })` for this eval, because the engine path can introduce config and store behavior that obscures fixture intent.
2. Score explicit slot expectations:
   - `latestProgress` for broad project state / next-work prompts;
   - `operatingGuidance` for workflow rules and corrections that constrain agent behavior;
   - `workstreamDiscovery.candidates` for topic-specific continuity prompts;
   - `pendingContinuity` only when a scenario explicitly tests review visibility.
3. Treat broad continuity success as slot correctness, not a single top-k ranking problem.
4. Compute recall@k and precision@k only for ranked sublists such as `workstreamDiscovery.candidates`.
5. Never emit recall@k or precision@k for set-shaped continuity slots such as `latestProgress`, `operatingGuidance`, or `pendingContinuity`; those slots should report only membership checks such as missing required or forbidden present.
6. Add failure tags for missing slot records, forbidden slot records, stale-over-current ordering, or topic mismatch.

## Output shape

The first slice should produce a test/dev report shape with both per-query and aggregate data. It does not need to be public API.

```ts
interface EvalReport {
  generatedAt: string
  corpusId: string
  mode: "default-no-embedding"
  queryResults: EvalQueryResult[]
  summary: EvalSummary
}

interface EvalQueryResult {
  id: string
  lane: "continuity" | "recall"
  query: string
  k: number
  actualIds: string[]
  recallAtK?: number
  precisionAtK?: number
  slotResults?: Array<{
    slot: string
    actualIds: string[]
    missingRequired: string[]
    forbiddenPresent: string[]
  }>
  failureTags: string[]
}

interface EvalSummary {
  queryCount: number
  meanRecallAtK?: number
  meanPrecisionAtK?: number
  failureTagCounts: Record<string, number>
}
```

Tests should assert structural integrity of this report: every query has a result, every result has deterministic ids, aggregate counts line up, and failure tags are drawn from a known set.

## Implementation plan for the next slice

### Task 1 — Add sanitized fixture corpus

- Add fixture records under `packages/core/test/fixtures/retrieval-eval/` or inline in a focused test file.
- Use stable fake ids and deterministic timestamps.
- Model records after real dogfood classes without copying raw private JSONL wholesale.
- Include enough kind/scope/category/source metadata to exercise current continuity and recall behavior.
- For continuity `latestProgress` expectations, ensure fixture `kind` and text satisfy the current `classifyContinuityRole` / progress-evidence gates, such as `project_checkpoint`, `session_summary`, or clear release/commit/checkpoint/completed-work evidence. For `operatingGuidance`, use kinds/text that classify as workflow/correction/procedure guidance.

### Task 2 — Add test-only eval helpers

- Add a focused test such as `packages/core/test/retrieval-continuity-eval.test.ts`.
- Implement small helper functions for:
  - loading fixture records;
  - running recall queries with the fixed synthetic project scope visible;
  - running continuity queries through pure `buildContinuityReadModel(records, { projectScopeKey, query, generatedAt })` rather than `MemoryEngine.continuity()` to avoid config bleed;
  - computing recall@k / precision@k;
  - generating failure tags;
  - aggregating report summaries.
- Pin `generatedAt` in continuity runs and use deterministic fixture timestamps far enough apart that recency ordering is stable regardless of wall-clock run date.
- Validate that fixture records land in expected continuity slots under the current `classifyContinuityRole`-driven gates; a bad fixture should fail structurally instead of masquerading as a product failure.
- Keep helpers test-only; do not export a production eval module.

### Task 3 — Add baseline structural tests

- Assert all six scenarios run without crashing.
- Assert all labels reference known fixture ids.
- Assert all fixture records are sanitized and deterministic enough for repo tests, including that no fixture trips likely-secret filtering.
- Assert the report includes required fields and aggregate counts.
- Do not assert quality thresholds for recall@k or precision@k in this first slice.

### Task 4 — Produce findings doc

- Add `docs/superpowers/validation/2026-06-27-retrieval-continuity-eval-baseline.md`.
- Record:
  - corpus scenarios;
  - baseline metrics;
  - observed failure tags;
  - short interpretation;
  - whether evidence justifies a follow-up retrieval/ranking change.
- If the baseline reveals no clear user-value improvement target, say so rather than inventing optimization work.

### Task 5 — Sync status docs

- Update `ROADMAP.md` with the slice status.
- Update `HANDOFF.md` with current branch/status, validation evidence, and next step.
- Update `README.md` only if user-facing commands or behavior changed; this design expects no README change for implementation unless the findings doc identifies a docs need.

## Validation plan

For the design/spec-only PR:

```bash
git diff --check
```

For the implementation slice:

```bash
pnpm --filter @memory-lane/core test
pnpm test
git diff --check
```

`pnpm --filter @memory-lane/cli test` is not required unless the implementation touches CLI formatting, command behavior, installer bridge rendering, or user-facing docs tied to CLI behavior.

## Acceptance criteria

The implementation slice is complete when:

- a sanitized six-scenario corpus exists;
- continuity and recall lanes both run in deterministic tests;
- graded labels are represented and validated;
- per-query and aggregate report data are generated in tests;
- structural test failures fail CI;
- metric quality does not gate CI yet;
- a findings doc records baseline metrics and failure cases;
- no retrieval/ranking behavior changes were made;
- no public eval command/API was added;
- status docs are synced before the work is called complete.

## Open questions

None from the grill session. The remaining decisions should be implementation details unless Opus 4.8 review identifies a design gap.
