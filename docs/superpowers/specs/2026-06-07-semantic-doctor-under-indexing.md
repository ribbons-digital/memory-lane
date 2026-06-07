# Semantic Doctor Under-Indexing Diagnostics

## Status

Approved for implementation.

## Context

Memory Lane can enable semantic search while the embedding sidecar contains embeddings for only a small fraction of approved memories. In that state, `memory-lane doctor` currently reports `semanticEnabled`, `approvedMemories`, and `embeddingCount`, but users must infer whether semantic recall is actually healthy.

A live user state showed:

```text
semanticEnabled: true
approvedMemories: 28
embeddingCount: 2
```

This is confusing because semantic search appears enabled, but recall may silently fall back to lexical/all-visible results for most memories.

## Goal

Make `memory-lane doctor` explicitly diagnose semantic under-indexing and tell users the safe manual repair command.

## Non-Goals

- Do not make plain `doctor` write files.
- Do not run `reindex` automatically.
- Do not add `doctor --fix` in this slice.
- Do not add hook debug logging in this slice.
- Do not change recall ranking behavior.

## User Experience

When semantic search is enabled and current embedding coverage for approved memories is low, `memory-lane doctor` should expose structured fields and a human-readable warning.

Example JSON-like report fields:

```json
{
  "semanticEnabled": true,
  "approvedMemories": 28,
  "embeddingCount": 2,
  "semanticApprovedMemories": 28,
  "semanticEmbeddedApprovedMemories": 2,
  "semanticEmbeddingCoverage": 0.071,
  "semanticWarnings": [
    "Semantic search is enabled, but only 2/28 approved memories have current embeddings. Run `memory-lane reindex`."
  ]
}
```

The warning is advisory only. An agent may offer to run `memory-lane reindex`, but only after user approval.

## Current Embedding Definition

An approved memory counts as currently embedded only when there is a folded embedding record that matches all of:

- `memoryId` equals the memory id.
- `profileName` equals the active embedding profile.
- `model` equals the active profile model.
- `contentHash` equals the current hash of the memory text.

This avoids counting stale embeddings from old text, old models, or inactive profiles.

## Warning Rule

`semanticWarnings` should include an under-indexing warning when all are true:

- semantic search is enabled;
- there is at least one approved memory;
- current embedding coverage is below `0.8`.

Coverage is:

```text
semanticEmbeddedApprovedMemories / semanticApprovedMemories
```

If semantic search is disabled or there are zero approved memories, coverage should be `1` and no under-indexing warning should be emitted.

## Report Fields

Add these stable fields to `MemoryEngine.doctor()`:

- `semanticApprovedMemories`: number of approved memories considered for semantic indexing.
- `semanticEmbeddedApprovedMemories`: number of approved memories with current embeddings for the active profile/model.
- `semanticEmbeddingCoverage`: number from `0` to `1`, rounded to three decimal places.
- `semanticWarnings`: string array.

Keep existing fields unchanged:

- `semanticEnabled`
- `approvedMemories`
- `embeddingCount`
- `activeProfileName`

## Architecture

The implementation belongs in `packages/core/src/engine.ts` near the existing `doctor()` method. It can reuse the existing embedding store and the same `contentHash` helper used by reindexing/embedding writes.

No CLI-specific logic is required if the existing CLI prints the doctor report generically. If the CLI has specialized doctor formatting, it should include `semanticWarnings` without hiding existing fields.

## Testing

Add core tests for:

1. Semantic disabled: no warning; coverage is `1`.
2. Semantic enabled with approved memories and no current embeddings: warning; coverage is `0`.
3. Semantic enabled with current embeddings for all approved memories: no warning; coverage is `1`.
4. Stale embedding records do not count when content hash, model, or active profile does not match.

Tests should use temporary files and append embedding records directly where needed. No network embedding provider is required.

## Documentation

Update user-facing docs to explain:

- `doctor` can warn about semantic under-indexing.
- The explicit repair command is `memory-lane reindex`.
- `doctor` itself remains read-only.

## Open Questions

None for this slice.
