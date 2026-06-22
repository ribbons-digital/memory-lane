# Phase 21 Slice 6 — Workstream Discovery Design

## Status

Draft design for review. This spec follows Phase 21 Slice 5b validation, which found automatic handoff mode safe enough to proceed to workstream discovery design.

This is a design/spec slice first. Implementation should begin only after user approval.

## Context

Phase 21 has made Memory Lane safer and more useful for cross-session handoff:

- `manual` mode keeps inspection-first continuity behavior.
- `review` mode assembles pending continuity candidates into read-only handoff proposals on continuity surfaces.
- `automatic` mode can prioritize one latest approved current-project handoff pointer in `SessionStart` without expanding budgets or using pending records.
- Prompt-time continuity intents already recognize natural prompts such as “resume building X,” “where was X implemented,” and “what should we work on next,” but today they mostly inject inspection guidance plus optional targeted recall.

The remaining gap is not raw recall. The user wants Memory Lane to help locate the relevant prior workstream by natural language, using approved project continuity records as pointers:

- “resume building X”
- “find where we implemented X”
- “what happened with PR #37?”
- “where did the automatic handoff validation land?”

Roadmap Todo #6 says workstream discovery should use approved session summaries, checkpoint memories, provenance, PR/branch references when available, and revision relationships as pointers rather than raw transcript search.

## Goals

1. Add a small, read-only workstream discovery layer that answers topic-specific continuity questions with bounded candidates.
2. Use existing approved project-visible memories and metadata; do not add new persisted workstream IDs or thread records in the first slice.
3. Reuse existing continuity surfaces so agents know one canonical place to inspect project state.
4. Return pointers and evidence, not authoritative final answers. Repository inspection still matters when available.
5. Keep behavior deterministic, local-first, review-governed, and low-noise.
6. Avoid retrieval rewrites, lifecycle injection changes, token retuning, raw transcript capture, auto-approval, or mutation behavior.

## Non-goals

- No first-class `workstreamId` schema.
- No raw transcript indexing or transcript search.
- No GitHub API, git history crawling, or live branch/PR lookup.
- No LLM classifier or summarizer.
- No retrieval/embedding/RRF/reranking rewrite.
- No change to `memory_recall` behavior.
- No lifecycle context injection of workstream discovery results.
- No new MCP tool in the first slice.
- No auto-approval, auto-consolidation, refresh, cleanup, delete/reject suggestions, or mutations.
- No subagent/orchestrator consolidation in this slice.
- No token-budget retuning; if token reporting becomes necessary, handle it as a future diagnostics slice.

## Domain Terms

Update `CONTEXT.md` when this spec lands:

**Workstream discovery**:
A read-only continuity operation that takes a natural-language query and returns bounded candidate pointers to approved project-visible continuity records that may represent the user-meaningful workstream. It is not recall, raw transcript search, lifecycle injection, or a persisted workstream index.

**Workstream candidate**:
A bounded pointer to an approved memory record selected by workstream discovery. It includes memory metadata, a safe preview, match reasons, and derived references such as PR numbers, branch-like names, or commit SHAs when those appear in the approved memory text. It is not an approved answer by itself.

## Recommended Approach

Implement **Phase 21 Slice 6a — Read-only Workstream Discovery on Continuity**.

Use the existing continuity read model as the host surface and add an optional query-specific `workstreamDiscovery` section. This gives agents one canonical inspection path:

```bash
memory-lane continuity --query "resume building automatic handoff"
memory-lane continuity --query "where did we implement checkpoint capture" --json
```

MCP clients use the existing continuity tool with an optional query:

```ts
memory_continuity({ projectPath, query: "resume building automatic handoff" })
```

Do not add a new `memory_workstream` or `memory_search_threads` tool in the first slice. The product concept is still maturing, and continuity is already the canonical surface for project resumption.

## Alternatives Considered

### Option A — Extend `memory_recall`

Pros:
- Minimal new surface.
- Uses existing search behavior.

Cons:
- Recall returns memory matches, not continuity-oriented workstream pointers.
- Harder to add project-state warnings, pending-continuity context, and suggested inspection actions.
- Risks turning workstream discovery into a retrieval rewrite.

Rejected for the first slice.

### Option B — New `memory_workstreams` CLI/MCP surface

Pros:
- Clean separation.
- Future-proof if workstreams become first-class entities.

Cons:
- Premature surface area before the data model is proven.
- Adds another command/tool agents need to learn.
- Pushes toward first-class workstream IDs before there is evidence they are needed.

Deferred.

### Option C — Extend continuity with optional query

Pros:
- Keeps continuity canonical for resumption/status questions.
- Lets discovery reuse approved/pending/freshness/handoff warnings already present in continuity.
- Adds no new command family or MCP tool.
- Easy to keep read-only and bounded.

Chosen.

## API and Surface Contract

### Core

Add a deterministic helper in core, likely:

```ts
export interface WorkstreamDiscoveryOptions {
  query: string
  projectScopeKey?: string
  maxCandidates?: number
  previewMaxChars?: number
}

export interface WorkstreamDiscoveryResult {
  query: string
  intent: "resume" | "lookup" | "status" | "unknown"
  topic?: string
  candidates: WorkstreamCandidate[]
  omittedCount: number
  warnings: Array<{ code: string; message: string }>
  suggestedActions: string[]
  notes: string[]
}

export interface WorkstreamCandidate {
  memoryId: string
  kind?: MemoryKind
  source: MemorySource
  status: "approved"
  category: MemoryCategory
  scope: MemoryScope
  createdAt: string
  updatedAt: string
  provenance?: MemoryProvenance
  preview: string
  score: number
  scoreReasons: string[]
  references: {
    prs: string[]
    branches: string[]
    commits: string[]
    releases: string[]
  }
  revision?: {
    supersedes?: string[]
    supersededBy?: string
  }
}
```

Function naming can be refined during implementation. The important contract is that the helper is deterministic, read-only, and accepts already-loaded memories.

### Continuity read model

Extend `ContinuityReadModel` with optional:

```ts
workstreamDiscovery?: WorkstreamDiscoveryResult
```

Only include it when a non-empty query is passed and the query is classified as workstream/continuity-like enough to be useful. If the query is non-empty but not recognized, return a bounded no-match/unknown-intent result rather than silently falling back to broad recall.

### MemoryEngine

Extend `MemoryEngine.continuity()` options with optional `query`:

```ts
engine.continuity({ query?: string, ...existingOptions })
```

No existing caller changes behavior unless it passes `query`.

### CLI

Extend existing command:

```bash
memory-lane continuity --query "resume building X"
memory-lane continuity --query "where was X implemented" --json
```

Human output should show a compact section such as:

```text
Workstream discovery
  Query: resume building automatic handoff
  Topic: automatic handoff
  Candidates:
    [abc12345] project_checkpoint · PR #38 · branch docs/phase-21-automatic-mode-validation
      Memory Lane PR #38 merged Phase 21 Slice 5b automatic-mode validation...
      Reasons: topic match, checkpoint kind, PR reference, recent update
  Suggested actions:
    → memory-lane list --json
    → git show <commit>   # only if a commit reference was derived
```

Do not dump long memory bodies.

### MCP

Extend existing `memory_continuity` schema with optional `query`.

Do not add a new MCP tool in Slice 6a.

### Lifecycle

No lifecycle output changes in Slice 6a.

Prompt-time continuity guidance may mention the new command in docs/tests later, but the first implementation should not automatically run discovery or inject discovery candidates into prompts. Harnesses can inspect via CLI/MCP when the agent chooses to answer a continuity question.

## Candidate Eligibility

A memory is eligible when all are true:

- `status === "approved"`.
- Visible to the active project scope.
- Current-project scoped memories only for the first slice; global memories are excluded even if they are visible. If project scope is unavailable, discovery should warn instead of broadening automatically.
- Not likely secret-bearing according to existing secret filtering.
- Not explicitly expired by freshness metadata.
- Kind is one of:
  - `project_checkpoint`
  - `session_summary`
  - `project_fact`
  - `decision`
  - optionally `correction` / `procedure` when the topic strongly matches workflow/process terms.
- Superseded records are not hidden automatically, but should be demoted and expose revision pointers. If a superseded record and its successor both match, prefer the successor.

Pending memories remain visible through existing review/continuity pending sections, not through workstream discovery candidates.

## Intent and Topic Extraction

Add deterministic query parsing. It should be intentionally simple and testable:

- Resume intent:
  - `resume X`
  - `continue X`
  - `pick up X`
  - `go back to X`
  - `where did we leave off on X`
- Lookup intent:
  - `where was X implemented`
  - `where did we implement X`
  - `find where X landed`
  - `what happened with X`
- Status intent:
  - `what happened with PR #N`
  - `status of X`
  - `where are we on X`

Topic extraction removes stop phrases and keeps meaningful terms. It should preserve useful identifiers:

- PR numbers: `PR #38`, `#38`
- release tags: `v0.2.21`
- branch-like strings: `docs/phase-21-automatic-mode-validation`
- short/full SHAs when explicitly present

If no meaningful topic remains, discovery should return an empty/ambiguous result with suggested inspection actions, not broad candidates.

## Scoring

Use deterministic scoring with reason labels. Suggested first-slice weights:

1. Token overlap between normalized topic tokens and memory text/metadata.
2. Exact identifier matches:
   - PR number
   - release tag
   - commit SHA
   - branch-like token
3. Kind bonuses:
   - `project_checkpoint` highest for resume/status
   - `session_summary` high for resume
   - `project_fact` / `decision` moderate for lookup/status
4. Recency as a tie-breaker, not a dominant signal.
5. Provenance bonus for `session_summary` when query looks like session resumption.
6. Demotion for stale/superseded records.

Return `scoreReasons` such as:

- `topic-match`
- `exact-pr-reference`
- `release-reference`
- `branch-reference`
- `checkpoint-kind`
- `session-summary-kind`
- `recent-update`
- `superseded-record`

Do not expose internal token lists unless needed for tests.

## Reference Extraction

Extract conservative references from approved memory text and metadata:

- PRs: `PR #38`, `#38` only when near `PR`, `pull request`, `merged`, or GitHub PR URL.
- Branches: strings with prefixes commonly used in this repo such as `feature/`, `docs/`, `codex/`, `phase-`, or explicit `branch <name>` phrases. Avoid treating arbitrary slash paths as branches unless context says branch/worktree.
- Commits: 7–40 character hex strings near words like `commit`, `HEAD`, `merge`, `main at`, or `SHA`.
- Releases: `v0.2.21`-style tags and GitHub release URLs.

References are output metadata only. Do not verify them against git/GitHub in Slice 6a.

## Output Behavior

### Good match

Return top 3–5 candidates, sorted by score then updatedAt.

### Ambiguous match

Return candidates but include warning:

```json
{ "code": "ambiguous-workstream", "message": "Multiple plausible workstream candidates matched this query; inspect candidates before proceeding." }
```

### No match

Return empty candidates and suggested actions:

- `memory-lane continuity --json`
- `memory-lane recall '<topic>'`
- `memory-lane review --json` if pending continuity exists

### No project scope

Return a warning that project-scoped workstream discovery needs a project path/scope. Do not broaden automatically to all global/project memories in Slice 6a.

## Safety and Privacy

- Use bounded previews with existing preview/secret filtering rules.
- Do not include raw transcripts, tool outputs, hook payloads, or full session summaries.
- Do not include pending records in discovery candidates.
- Do not mutate memories, revision metadata, baseline markers, or embeddings.
- Do not call network APIs.
- Do not make claims like “this is the current state” without telling agents to inspect the repo/status when available.

## Testing Plan

Core tests:

1. Parses resume/lookup/status intents and extracts topics.
2. Returns approved current-project candidates only.
3. Excludes pending records and secret-like records.
4. Omits expired records and demotes stale/superseded records.
5. Extracts PR, branch, commit, and release references conservatively.
6. Produces score reasons.
7. Returns ambiguity/no-match warnings.
8. Leaves existing continuity output unchanged when no query is passed.

CLI tests:

1. `memory-lane continuity --query "resume building X" --json` includes `workstreamDiscovery`.
2. Human output is compact and does not dump full memory bodies.
3. Existing `memory-lane continuity` output is unchanged without `--query`.

MCP tests:

1. `memory_continuity({ projectPath, query })` returns `workstreamDiscovery`.
2. Existing `memory_continuity({ projectPath })` is unchanged.
3. Schema rejects invalid non-string query if applicable.

Regression tests:

1. `memory_recall` behavior unchanged.
2. SessionStart automatic handoff behavior unchanged.
3. No writes occur when discovery runs.

## Documentation Updates

Update:

- `CONTEXT.md` with `Workstream discovery` and `Workstream candidate` terms.
- `README.md` continuity section with `memory-lane continuity --query` examples and MCP `query` argument.
- `ROADMAP.md` Phase 21 status after implementation.
- `HANDOFF.md` with branch/status and next step.
- `skills/memory-lane/SKILL.md` if needed so future agents know to use continuity query for resume/find-work prompts.

## Implementation Slice Boundary

### Slice 6a — Read-only discovery on continuity

Implement only:

- core discovery helper;
- continuity read model optional `workstreamDiscovery`;
- CLI `continuity --query`;
- MCP `memory_continuity` optional `query`;
- docs/tests.

Do not implement:

- workstream IDs/schema;
- raw transcript or git/GitHub lookup;
- lifecycle injection;
- new MCP/CLI command family;
- retrieval rewrite;
- automatic approval/mutation;
- subagent/orchestrator consolidation.

### Later slices

Consider only after Slice 6a dogfooding:

- first-class workstream IDs;
- orchestrator/session-level vs subagent task chatter distinction;
- confidence/noise thresholds;
- per-project/global safeguards;
- eval-first retrieval quality track;
- live GitHub/git reference verification;
- token accounting if character budgets prove insufficient.

## Acceptance Criteria for Spec Slice

This design/spec slice is complete when:

1. The spec documents the first implementation slice and defers larger automation.
2. `CONTEXT.md` term updates are consistent with existing glossary language.
3. ROADMAP/HANDOFF point to the spec and preserve the review gate before implementation.
4. The user reviews and approves the spec before implementation begins.

## Acceptance Criteria for Future Implementation Slice

Future Slice 6a implementation is complete when:

1. Core workstream discovery returns bounded approved project-visible candidates for topic-specific continuity queries.
2. CLI `memory-lane continuity --query` works in human and JSON modes.
3. MCP `memory_continuity` accepts optional `query` and returns equivalent structured data.
4. No-query continuity behavior remains unchanged.
5. Tests cover eligibility, scoring, references, no-match/ambiguous output, CLI, MCP, and no-write behavior.
6. Documentation describes the feature as read-only pointer discovery, not raw transcript search or authoritative state.
7. Verification passes with at least:

```bash
pnpm build
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
git diff --check
```

## Risks and Mitigations

- **Risk: Users treat candidates as current truth.** Mitigation: label candidates as pointers and keep suggested actions inspection-first.
- **Risk: Discovery becomes a retrieval rewrite.** Mitigation: deterministic first-slice scoring over existing approved records only.
- **Risk: False branch/path extraction.** Mitigation: conservative regexes and references as metadata only.
- **Risk: Surface sprawl.** Mitigation: extend continuity rather than adding new commands/tools.
- **Risk: Privacy leak via previews.** Mitigation: reuse bounded preview and secret filtering.
- **Risk: Premature schema.** Mitigation: no persisted workstream IDs in Slice 6a.
