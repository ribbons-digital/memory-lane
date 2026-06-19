# Checkpoint Candidate Review Labeling Design

## Status

Draft for review. This spec covers **Phase 17 Slice 1 — checkpoint candidate conventions and review labeling**.

## Goal

Make high-value project progress memories recognizable during review before Memory Lane starts automatically suggesting them. This slice introduces conservative checkpoint candidate conventions and labels candidates in review surfaces without adding automatic capture, writes, deduplication, or recall behavior changes.

## Background

Phase 16 and the prompt-continuity bridge made Memory Lane better at surfacing existing continuity signals. Phase 17 starts the next step: review-first progress/checkpoint capture.

Before adding lifecycle/tool-outcome automation that suggests progress checkpoints, users need a clear review experience. When a pending memory represents a merge, release, verification milestone, docs sync, major fix, or roadmap decision, the review UI should make that visible and explain why the candidate is worth approving.

This slice is intentionally review-labeling only. It prepares the review surface and conventions that later automatic capture will reuse.

## Domain terminology

`CONTEXT.md` defines this term:

**Checkpoint candidate**:
A pending Memory Lane memory that represents high-value project progress, such as a merge, release, verification milestone, docs sync, major fix, or roadmap decision. It is review-first: Memory Lane may suggest it from strong evidence, but it does not affect future continuity until approved.

Avoid: approved checkpoint, session summary, automatic handoff, lifecycle notice.

## User-facing behavior

When a pending memory looks like durable project progress, review surfaces should label it as a checkpoint candidate.

Human review output should stay compact. It should keep existing previews and suggested approve/reject/delete actions, but add a clear label such as:

```text
Checkpoint candidate: merge
Reason: merged pull request progress
Review: approve if this should become durable project continuity
```

Candidate examples:

- "Merged PR #13 adding prompt continuity intents."
- "Released v0.2.9."
- "Verified lifecycle tests and build after prompt continuity slice."
- "Roadmap decision: Phase 17 starts with checkpoint candidate review labeling."
- "Updated ROADMAP.md and HANDOFF.md after release docs sync."

The user should not have to infer from raw text alone why a pending memory matters.

## Detection and conventions

Use existing memory records and conservative deterministic classification. Do not add new storage fields in this slice.

A pending memory is a checkpoint candidate if either:

1. Its `kind` is checkpoint-oriented.
2. Its text/source/provenance strongly suggests checkpoint-like progress.

### Memory kind convention

Existing `project_checkpoint` should be treated as a checkpoint candidate kind.

If adding narrower kinds is low-risk and fits existing validation patterns, the implementation may add non-breaking `MemoryKind` values:

- `release_checkpoint`
- `merge_checkpoint`
- `verification_checkpoint`
- `docs_checkpoint`
- `roadmap_checkpoint`

If adding these kinds would spread changes across too many surfaces for this slice, keep `project_checkpoint` as the only storage-level checkpoint kind and infer a subtype for review metadata from text. The implementation plan should choose the smaller safe path after inspecting current kind validation.

### Text/provenance convention

Use conservative phrase matching. Examples:

- Release: `released vX.Y.Z`, `tagged vX.Y.Z`, `published vX.Y.Z`
- Merge: `merged PR #13`, `PR #13 merged`, `merged pull request`
- Verification: `tests passed`, `build passed`, `verified release`, `verification passed`
- Docs sync: `updated ROADMAP`, `updated HANDOFF`, `docs synced`, `documentation synced`
- Roadmap decision: `roadmap decision`, `decided next phase`, `phase N starts with`
- Major fix: `fixed critical`, `fixed blocker`, `major fix`

Avoid loose patterns such as a bare word `release`, `merge`, or `test` without progress context.

## Structured metadata

Review JSON and MCP review should expose text-free checkpoint metadata. Proposed shape:

```ts
checkpointCandidate?: {
  detected: boolean
  kind: "release" | "merge" | "verification" | "docs-sync" | "roadmap-decision" | "major-fix" | "project"
  reason: string
}
```

Guidelines:

- Include this property only when a candidate is detected, or include `detected: false` only if that matches existing formatter style better.
- `reason` should be a short classifier reason such as `matched release version phrase` or `kind is project_checkpoint`.
- Do not include transcript text, raw tool output, prompt text, memory body copies beyond existing review fields, or large evidence blobs.
- Memory IDs may remain where review surfaces already expose them; the new metadata should not add additional IDs.

## Review surface behavior

In scope:

1. CLI `memory-lane review`
2. CLI `memory-lane review --json`
3. MCP `memory_review`

### CLI human review

Human review should add a compact checkpoint label near each candidate preview. It should not create a new interactive workflow.

Example shape:

```text
[abc12345] (project/project) [pending] Merged PR #13 adding prompt continuity intents.
  Checkpoint candidate: merge — matched merged PR phrase
  Review: approve if this should become durable project continuity.
```

The exact formatting can follow existing grouped/prettified review style.

### CLI JSON review

Each memory object should include checkpoint metadata when detected.

Example:

```json
{
  "id": "abc12345",
  "status": "pending",
  "kind": "project_checkpoint",
  "checkpointCandidate": {
    "detected": true,
    "kind": "merge",
    "reason": "matched merged PR phrase"
  }
}
```

### MCP `memory_review`

MCP review should expose the same structured checkpoint metadata in its memory objects, preserving existing `data.memories` and `data.groups` compatibility.

Do not add MCP mutation tools.

## Out of scope

- Automatic checkpoint capture from lifecycle or tool outcomes.
- Dedup/debounce for checkpoint candidates.
- Background writes.
- New config flags.
- Exact workstream/thread IDs.
- Recall ranking changes.
- Lifecycle context changes.
- MCP mutation tools.
- Bulk approval or automatic approval.
- Treating approved checkpoints differently in recall/injection.

## Testing requirements

Add tests for:

1. Release checkpoint candidate detection.
2. Merge checkpoint candidate detection.
3. Verification checkpoint candidate detection.
4. Docs-sync checkpoint candidate detection.
5. Roadmap-decision checkpoint candidate detection.
6. Ambiguous memories are not labeled.
7. `project_checkpoint` kind is labeled even when text is simple.
8. CLI human review includes compact checkpoint labels for candidates.
9. CLI `review --json` includes structured checkpoint metadata.
10. MCP `memory_review` includes matching structured checkpoint metadata.
11. Status/recall/lifecycle behavior is unchanged, or no files in those paths change.

## Manual test examples

After implementation, save or suggest pending memories such as:

```bash
memory-lane suggest "Merged PR #13 adding prompt continuity intents." --category project
memory-lane suggest "Released v0.2.9." --category project
memory-lane suggest "Roadmap decision: Phase 17 starts with checkpoint candidate review labeling." --category project
memory-lane review
memory-lane review --json
```

Expected:

- Review output labels the first three as checkpoint candidates.
- JSON output exposes `checkpointCandidate` metadata.
- Ambiguous pending memories are not labeled.
- Approve/reject flow remains unchanged.

## Success criteria

The slice is successful when a user reviewing pending memories can quickly identify high-value progress checkpoint candidates, understand why each was labeled, and approve or reject them using existing review controls. It should prepare later automatic capture while remaining purely review-first and non-autonomous.
