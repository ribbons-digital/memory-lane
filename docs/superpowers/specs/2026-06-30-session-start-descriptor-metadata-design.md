# SessionStart Descriptor Metadata Design

## Status

Approved and implemented for first vertical slice. This is Slice B of the SessionStart descriptor index track.

## Entry gate

User approved this spec before implementation. First implementation slice intentionally stays within the recommended engine/storage/lifecycle/exact-show scope.

## Background

Slice A shipped in `v0.2.39` and changed selective SessionStart context from full-body baseline injection into a hybrid:

1. continuity notice;
2. tiny `## Always-on Memory` full-body rules/preferences;
3. compact `## Memory Index` descriptor cards with fetch-by-id guidance.

Slice A was intentionally schema-free. Descriptor cards are generated from existing approved memory text. Dogfood passed, but real-project output showed that under the default 1600-char overall SessionStart budget and 1200-char descriptor-index cap, only two descriptor cards fit after the continuity notice and two always-on preferences. This makes descriptor quality more important: each card should carry enough signal for the agent to decide whether to fetch the full body.

## Problem

Generated descriptor previews are useful but shallow:

- They often repeat the opening words of a memory rather than a deliberate summary.
- They cannot express when the agent should fetch the full body.
- They do not expose compact keywords for future ranking or filtering.
- They make Slice D token/budget policy harder to tune because every card has roughly the same low-information shape.

## Goals

- Add optional structured descriptor metadata to memories: `description`, `fetchHint`, and `keywords`.
- Keep the schema additive and non-breaking for existing JSONL records.
- Preserve existing explicit `memory_get` / `memory-lane show <id>` full-body behavior.
- Make SessionStart descriptor cards prefer structured metadata when present and fall back to generated previews otherwise.
- Preserve descriptor metadata across existing non-content mutation paths where appropriate, and define explicit semantics for duplicate upgrades and replacement successors.
- Surface descriptor metadata in JSON output for exact-memory inspection.
- Keep human output compact and avoid adding noisy descriptor text to broad list/review surfaces.

## Non-goals

- No YAML/frontmatter mirror or Obsidian import work in this slice; that remains Slice C.
- No token-aware policy/cap tuning; that remains Slice D.
- No automatic LLM generation of descriptors.
- No schema migration for existing memories.
- No retrieval/ranking rewrite.
- No public eval command.
- No raw transcript indexing.
- No auto-consolidation or silent memory mutation.

## Data model

Add an optional field to `MemoryRecord`:

```ts
export interface MemoryDescriptorMetadata {
  description?: string
  fetchHint?: string
  keywords?: string[]
}

export interface MemoryRecord {
  // existing fields...
  descriptor?: MemoryDescriptorMetadata
}
```

Validation rules:

- `description`, when present, must be a non-empty string after trimming.
- `fetchHint`, when present, must be a non-empty string after trimming.
- `keywords`, when present, must be an array of non-empty trimmed strings.
- Normalize keywords to lowercase for stable JSON output, deduplicating after normalization.
- Apply modest bounds to prevent descriptor metadata from becoming another memory dump:
  - `description`: max 240 chars.
  - `fetchHint`: max 240 chars.
  - `keywords`: max 12 final normalized/deduplicated keywords, each raw trimmed keyword max 40 chars.
- Run secret detection independently on `description`, `fetchHint`, and each keyword. On save/suggest input, invalid or secret-looking descriptor metadata should throw/reject the save rather than silently persisting a partial descriptor. In storage normalization, malformed descriptor metadata should make that stored record invalid/hidden consistently with existing invalid-row handling rather than passing raw descriptor data through. At render time, defensively omit a descriptor card if descriptor metadata or memory text is secret-looking.
- Omit `descriptor` entirely if all fields normalize away.

This is not just a TypeScript type addition. Implementation must explicitly wire `descriptor` through `SaveInput`, save context, storage validation, and new-record creation because `createNewMemory` enumerates fields rather than spreading arbitrary input.

## Mutation semantics

### Save / suggest

Slice B should support descriptors at the engine/API level first: `MemoryEngine.save({ descriptor })` and `suggest(..., descriptor)` or an equivalent typed input path. This requires adding `descriptor` to `SaveInput`, carrying it through `saveContext`/`SaveContext`, validating it in `validateSaveInput`, and adding it to `createNewMemory`.

Do not add CLI authoring flags in the first Slice B implementation unless the user explicitly expands scope. Possible future flags would be explicit and non-magical:

```bash
memory-lane save "..." --descriptor-description "..." --descriptor-fetch-hint "..." --descriptor-keyword installer --descriptor-keyword onboarding
```

The recommended first implementation is engine/storage/lifecycle rendering plus exact `show/get` JSON and compact human exact-show display. CLI authoring can follow once the metadata model is proven.

### Update

Descriptor update/clear is deferred from the first implementation slice unless the user explicitly approves the larger scope. Current update no-op detection compares only `text`, `category`, `status`, and `kind`, so descriptor-only updates require a non-additive change to revision/change detection. Ordinary text/category/status/kind updates preserve any existing descriptor metadata in this slice; this avoids silent descriptor deletion but can leave a stale descriptor until explicit descriptor update support exists.

When implemented later:

- Allow update to replace descriptor metadata explicitly if descriptor inputs are provided.
- Do not infer descriptor changes from text changes.
- Support engine-level `descriptor: null` to clear.
- Extend update no-op detection so descriptor-only changes are real changes.

### Replace / supersede

`replace` creates a new successor memory using a separate replacement input type, not `SaveInput`. Descriptor behavior should be explicit:

- First implementation may defer descriptor input on `replace`; if included, add descriptor to the replace input type separately.
- If replacement input includes descriptor metadata, apply it to the successor.
- If replacement input omits descriptor metadata, do not automatically copy the old descriptor. The new text may represent a refined/superseding memory and stale descriptors could mislead.
- `supersede` links existing memories and should not mutate descriptor metadata.

### Duplicate upgrade / rescope / approve / reject / delete

If `save({ status: "approved", descriptor })` upgrades an existing pending duplicate, the upgraded record should take the explicit new descriptor when provided; otherwise it should preserve the pending duplicate's existing descriptor.

Rescope, approve, reject, and delete should preserve existing descriptor metadata because they do not change memory content.

## SessionStart rendering semantics

Update descriptor rendering so `descriptorLine(memory)` uses structured metadata first:

1. If `memory.descriptor.description` exists, use it as the main card summary.
2. Else use the Slice A generated preview.
3. If `memory.descriptor.fetchHint` exists, append `Fetch when: <fetchHint>` or a similarly compact phrase.
4. Do not render keywords in SessionStart by default unless testing shows they help; they are primarily for future ranking/filtering and JSON inspection.

Example:

```md
- [1098781c] Project fact - Cross-harness installer/onboarding and memory hygiene lessons. Fetch when: working on installer UX, harness setup, or context hygiene.
```

Budget behavior:

- Structured descriptor lines still count toward the existing descriptor char budget.
- The shared `descriptorLine(memory)` helper should include `Fetch when: <fetchHint>` in the same line used for both budget accounting and final rendering, so `line.length + 1` remains the unit of descriptor budget accounting.
- If a structured descriptor line is too long for remaining budget, use the existing omit behavior rather than silently dumping partial metadata.
- Secret-looking descriptor metadata should make the descriptor invalid or omitted; do not fall back to secret-looking metadata.

Diagnostics:

- Slice A already has `descriptorIndex.generatedFallbackCount`; Slice B must modify the existing increment logic so it counts selected descriptor cards that did not use structured `descriptor.description`.
- Change the shared `descriptorLine(memory)` helper rather than only the render site, because Slice A uses it for both budget accounting and final rendering.
- Consider adding `structuredCount` only if it helps tests/debugging. If added, keep it text-free.

## JSON / human output surfaces

### Exact-memory JSON

`memory-lane show <id> --json`, `memory-lane get <id> --json`, MCP exact get, and direct engine list outputs should include `descriptor` as part of the memory record when present.

### Human exact show

Human `memory-lane show <id>` may display a compact descriptor section only when present:

```text
Descriptor:
  Description: ...
  Fetch hint: ...
  Keywords: installer, onboarding
```

Keep it below core metadata and above the full memory body, or whichever existing human show layout makes the least diff.

### List / review / dashboard / continuity

Do not add descriptor text to broad human list/review/dashboard/continuity surfaces in Slice B. These surfaces are intentionally compact and should not grow because descriptors exist.

## Storage and compatibility

- JSONL append-only storage can persist the optional `descriptor` field naturally once `MemoryRecord` and validation accept it.
- Historical records without descriptors remain valid.
- Storage normalization must explicitly validate optional descriptor metadata. Current storage normalization spreads raw records, so Slice B must add a descriptor validator to prevent malformed or secret-looking descriptor data from passing through.
- Semantic embedding content should remain based on memory text for Slice B. Do not include descriptor metadata in embeddings until a retrieval-specific slice justifies it.
- Future descriptor-only update/clear operations should not invalidate embeddings unless a later retrieval slice starts embedding descriptor metadata.

## Tests

Add focused tests before or with implementation:

1. Core types/engine:
   - save persists valid descriptor metadata;
   - invalid descriptor strings/keywords are rejected;
   - duplicate approved-upgrade applies explicit new descriptor or preserves existing descriptor when omitted;
   - approve/rescope preserve descriptor metadata;
   - replace does not auto-copy old descriptor metadata.
2. Storage validation:
   - historical records without descriptor remain valid;
   - invalid descriptor shapes are rejected or normalized according to existing storage-validation conventions.
3. Lifecycle descriptor rendering:
   - SessionStart uses `descriptor.description` before generated preview;
   - `fetchHint` appears compactly when present;
   - `generatedFallbackCount` only counts fallback descriptors;
   - descriptor metadata remains bounded and secret-safe.
4. CLI / exact inspection:
   - `show --json` includes descriptor metadata;
   - human `show` includes descriptor metadata only when present.

## Validation

Run at minimum:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/cli test
pnpm build
pnpm test
git diff --check
```

## Risks and mitigations

- **Schema expansion too early:** Keep fields optional, bounded, and non-breaking; no migration.
- **Descriptors become another dumping channel:** Enforce strict char/item bounds and secret checks.
- **CLI scope creep:** Keep descriptor authoring out of CLI unless the implementation stays small; exact JSON/human show is enough for Slice B's first vertical slice.
- **Stale descriptors after updates/replacements:** Require explicit descriptor updates; do not auto-copy descriptors to replacement successors.
- **Broad surfaces become noisy:** Do not add descriptor text to list/review/dashboard/continuity in Slice B.

## Open decisions

1. Should Slice B include CLI authoring flags, or only engine/storage/lifecycle/show support? Recommendation: defer CLI authoring.
2. Should descriptor update/clear be included now? Recommendation: defer to keep the first implementation additive and avoid changing revision/no-op detection in this slice.
3. Should exact human `show` display descriptor metadata by default? Recommendation: yes, because exact show is already an intentional full-inspection surface.

## Recommended first implementation slice

Keep Slice B small and vertical:

- add optional bounded `descriptor` metadata to core types and validation;
- wire descriptor through save/suggest, duplicate approved-upgrade, and new-record creation;
- preserve descriptor through rescope/approve/reject/delete;
- ensure replacement successors do not auto-copy stale descriptors;
- update SessionStart descriptor rendering to prefer `descriptor.description` and `fetchHint`;
- expose descriptor metadata in exact `show/get` JSON and compact human exact show;
- do not add update/clear, CLI authoring flags, Obsidian/YAML, token policy changes, broad-surface rendering, embeddings, or LLM generation.
