# Continuity Typing and Ranking Evaluation Design

## Status

Draft design for review. This is the next slice after Pi continuity parity (`v0.2.30`) and PR #55's roadmap update.

This slice is deliberately eval-first. Implementation should begin only after this spec is approved.

## Context

The `ContinuityReadModel` is now the canonical Memory Lane surface for broad project resumption questions. Pi Slice D dogfood verified that the installed `v0.2.30` Pi bridge routes “What were we last working on?” to `memory_continuity` and that the agent can recover by checking repository state.

The same dogfood exposed a continuity quality issue:

- `latestApproved.project` selected newly approved memory `c78cdc00`, a workflow correction about GitHub PR body formatting.
- More useful release/checkpoint memories for the project appeared under `workstreamDiscovery.candidates`.
- The final answer was still correct because Pi inspected git, but the read model mixed “latest project progress” and “latest operational correction” in a way that can mislead harnesses without repo access.

The current implementation explains why this happened:

- `packages/core/src/continuity-read-model.ts` allows `correction` and `procedure` in `CONTINUITY_KINDS`.
- `compareApprovedProject()` sorts by newest timestamp before kind priority, so a newer correction can beat an older checkpoint/session summary.
- `workstream-discovery.ts` treats `correction` and `procedure` as eligible strong matches only when topic-matched, which is better for query-specific candidates but does not protect the broad `latestApproved.project` slot.

## Problem

Continuity records serve different roles:

1. Latest project progress/checkpoint: what changed, shipped, merged, released, or was last actively worked on.
2. Operating agreement/procedure/correction: how the agent should work, including durable workflow mistakes to avoid.
3. Global workflow context: user/project-independent operating preferences.
4. Query-specific workstream candidates: topic-matched pointers for “resume X” or “where was X implemented”.

A single “latest approved project continuity” slot cannot safely represent all of these roles. If the newest approved project memory is a correction, a broad “what were we last working on?” answer may over-emphasize workflow hygiene instead of project progress.

## Goals

1. Define a small deterministic eval corpus for broad continuity prompts and query-specific workstream prompts.
2. Label expected continuity roles before changing ranking behavior.
3. Protect the broad `latestApproved.project` / future “latest progress” slot from ordinary corrections and procedures unless they are explicitly checkpoint-like.
4. Preserve corrections/procedures as first-class operating guidance instead of hiding them.
5. Keep behavior harness-neutral: core owns role classification and read-model semantics; adapters render the same shape.
6. Keep the first implementation read-only and deterministic.
7. Avoid recall ranking changes, embeddings/RRF/reranking, LLM classifiers, raw transcript capture, lifecycle budget expansion, or automatic memory mutation.

## Non-goals

- No change to `memory_recall` ranking.
- No semantic embedding or reranker work.
- No LLM classifier for role detection.
- No new durable memory schema migration in the first slice.
- No auto-approval, consolidation, cleanup, rescope, or deletion behavior.
- No harness-specific Pi-only fix.
- No git/GitHub inspection from core.
- No change to lifecycle injection budgets until eval results justify an implementation.

## Domain Terms

**Continuity role**: A derived read-model role for an approved or pending memory on continuity surfaces. It is not initially persisted to the JSONL record.

Initial roles:

- `progress`: project progress, checkpoint, release, merge, completed validation, next implementation state.
- `operating_agreement`: durable workflow guidance such as PR process, branch policy, package manager preference, or review gates.
- `correction`: a mistake-prevention or “do not repeat this” record.
- `procedure`: a step-by-step operational guardrail.
- `global_workflow`: global preference/procedure relevant to how agents should operate.
- `workstream_candidate`: a query-specific pointer selected because it matches a continuity query.
- `other`: visible memory that does not belong on continuity surfaces except through ordinary recall.

**Latest progress slot**: The project-scoped read-model field intended to answer broad prior-work/status prompts. It should prefer `project_checkpoint`, `session_summary`, and checkpoint-like `decision`/`project_fact` records over ordinary corrections/procedures.

**Operating guidance slot**: A bounded read-model section for project/global workflow rules, corrections, and procedures that help agents work correctly but are not the latest project progress.

## Recommended Approach

Implement **Continuity Typing and Ranking Eval Slice 1** in two stages:

### Stage 1 — Eval fixtures and report-only classifier

Add deterministic tests/fixtures that exercise current and desired behavior without changing public output yet, or with output guarded to a diagnostic/report-only field.

The eval should run in normal test commands and should not require live Memory Lane data.

Recommended fixtures:

1. **Pi Slice D regression fixture**
   - Records:
     - older `project_checkpoint` or `session_summary`: `v0.2.30` release / Pi Slice D dogfood passed.
     - newer `correction`: GitHub PR body formatting requires `--body-file`.
   - Query: `What were we last working on?`
   - Expected:
     - latest progress selects the release/dogfood checkpoint.
     - correction remains visible as operating guidance/correction, not latest progress.

2. **Checkpoint-like correction fixture**
   - A correction whose text also documents a completed project fix and release.
   - Expected:
     - If it matches checkpoint-candidate evidence (`merged PR`, `released vX`, `verification passed`), it can appear as progress with explicit reason.

3. **Procedure-only fixture**
   - Newer procedure: “When editing PR bodies, use `gh pr edit --body-file`.”
   - Older checkpoint: completed implementation.
   - Expected:
     - checkpoint wins latest progress.
     - procedure appears in operating guidance.

4. **Session summary fixture**
   - Newer session summary with next steps vs older project fact.
   - Expected:
     - session summary wins latest progress.

5. **Global workflow fixture**
   - Global preference about PR workflow and project checkpoint.
   - Expected:
     - global item appears only in global/operating guidance, never as project progress.

6. **Topic-specific workstream fixture**
   - Query: `where did we fix PR body formatting?`
   - Expected:
     - relevant correction/procedure can rank in `workstreamDiscovery.candidates` because the query is topic-specific.

### Stage 2 — Minimal read-model implementation, if eval confirms value

After the eval fixtures are accepted, adjust `buildContinuityReadModel()` to derive roles and expose them in a bounded way.

The public schema change should be additive to the existing upstream `ContinuityReadModel`; the snippet below is a delta-oriented sketch, not a replacement for required fields such as `projectScope`, `generatedAt`, `status`, `pendingContinuity`, `freshness`, `continuityHints`, `operatingAgreements`, `warnings`, `suggestedActions`, `answerGuidance`, `harnessGuidance`, and `notes`.

Possible additive shape:

```ts
interface ContinuityReadModel {
  // Existing required fields remain unchanged.
  projectScope: string | "none"
  generatedAt: string
  status: ContinuityStatus
  latestApproved: {
    // Existing public compatibility slot. Keep this property in the schema and populate it with
    // legacy selection whenever project continuity exists; `?` only preserves the current no-match JSON shape.
    project?: ContinuityMemoryPreview
    global?: ContinuityMemoryPreview
  }
  pendingContinuity: ContinuityMemoryPreview[]
  freshness: FreshnessStatus
  continuityHints: ContinuityHintSummary
  operatingAgreements: OperatingAgreementSummary

  // Additive continuity typing fields.
  latestProgress?: ContinuityMemoryPreview
  operatingGuidance?: ContinuityMemoryPreview[]
}
```

First-slice public JSON should expose typed continuity only through bounded, secret-filtered read-model previews such as `latestProgress` and `operatingGuidance`. Derived role labels, per-record reasons, excluded memory IDs, and aggregate `roleSummary` diagnostics are internal/report-only for the first slice and are not part of the public continuity read model. Do not expose free-form role reasons from memory text on the public read model.

Transition decision: keep `latestApproved.project` as the legacy compatibility slot in the first implementation, and add `latestProgress` alongside it as the progress-only field. Do not remove, rename, redefine, or stop populating `latestApproved.project` when legacy project continuity exists; the optional marker in the sketch mirrors the current no-match JSON shape, not permission to omit the slot from the public contract. Adapters and human formatters may prefer `latestProgress` for broad prior-work/status wording when present, but tests must continue to assert that the existing `latestApproved.project` field remains available for current consumers.

## Role Classification Rules

Classification should be deterministic and conservative.

### Progress

Classify as `progress` when any of these are true:

- `kind` is `project_checkpoint`.
- `kind` is `session_summary`.
- `classifyCheckpointCandidate(memory)` returns a candidate such as release, merge, verification, docs-sync, roadmap-decision, or major-fix.
- `kind` is `decision` or `project_fact` and text includes clear completed-work evidence: merged PR, released version, validated tests, implementation completed, dogfood passed, current branch/tag/commit checkpoint.

### Correction

Classify as `correction` when `kind` is `correction` or text primarily records a mistake/prevention rule. A correction should not win latest progress unless it also satisfies progress evidence above.

### Procedure

Classify as `procedure` when `kind` is `procedure` or text primarily records steps/guardrails. A procedure should not win latest progress unless it also satisfies progress evidence above.

### Operating Agreement

Classify as `operating_agreement` directly from the memory's own fields, not by asking downstream selection whether it would choose the record. At minimum, `kind === "workflow_rule"` should assign this role. Additional deterministic field/text heuristics may mirror the existing workflow-area patterns, but role typing should run before selection so `selectOperatingAgreements()` can consume the precomputed role instead of deciding the role itself.

### Global Workflow

Classify as `global_workflow` for workflow-relevant global records already selected by the current global logic.

### Other

Everything else is `other` for continuity typing.

## Acceptance Criteria

- Adds a reproducible eval/test fixture set for continuity role/ranking behavior.
- Includes the Pi Slice D `c78cdc00` vs `v0.2.30` release/checkpoint scenario.
- Demonstrates that broad prior-work prompts prefer progress/checkpoint/session-summary records over ordinary corrections/procedures.
- Demonstrates that topic-specific workstream queries can still return matching corrections/procedures as candidates.
- Does not change `memory_recall` behavior.
- Does not use an LLM classifier or external service.
- Does not read raw transcripts.
- Does not mutate memories or add approval/rejection automation.
- Keeps output bounded and secret-filtered like existing continuity previews.
- Preserves existing public fields or documents any compatibility alias clearly.

## Validation Plan

For the implementation slice:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm test
git diff --check
```

If the first PR is docs/spec only, validate with:

```bash
git diff --check
```

## Resolved Transition Decisions

1. `latestApproved.project` remains the legacy compatibility slot for the first implementation; `latestProgress` is added as the progress-only field rather than replacing or redefining the existing slot.
2. Derived role labels and raw role diagnostics remain internal/report-only for the first slice. Public continuity JSON exposes bounded, secret-filtered previews (`latestProgress`, `operatingGuidance`) and may expose aggregate diagnostics only in a separate diagnostic/report surface after review.
3. `operatingGuidance` should include bounded project-scoped corrections/procedures and workflow rules that role classification marks as operating guidance, even when they are not selected by `operatingAgreements`.
4. Default caps for operating guidance should be conservative and tested; the implementation plan should choose a small bound before coding.

## Recommendation

Use a compatibility-first approach:

1. Add a pure helper such as `classifyContinuityRole(memory)` plus focused tests.
2. Add `latestProgress` as the progress-only field and `operatingGuidance` as bounded operating guidance, while keeping existing fields.
3. Keep `latestApproved.project` populated with the existing legacy selection semantics for the first implementation; adapters/tests may add `latestProgress` expectations, but must not require consumers to migrate off `latestApproved.project` yet.

This gives harnesses a better path without breaking current consumers or hiding important corrections.
