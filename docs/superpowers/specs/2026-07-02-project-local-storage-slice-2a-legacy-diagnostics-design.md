# Project-local Storage Slice 2a Legacy Diagnostics Design

## Status

Merged in PR #89 as `96516ef feat(cli): add legacy project diagnostics dry run (#89)` and shipped in `v0.2.44`.
Fable 5 second-opinion review completed before drafting this spec, again before approval, and again before PR.
Implementation remained inside the approved read-only Slice 2a scope.
Installed-artifact dogfood passed and is documented in `docs/superpowers/validation/2026-07-02-v0.2.44-release-dogfood.md`.

## Entry gate

This design and implementation gate is complete.
Future mutating migration remains deferred to a later explicit design gate.

## Context

Slice 0 shipped in `v0.2.42` as the storage facade proof.
Slice 1 shipped in `v0.2.43` as the project-local default for new project-scoped writes.
New project-scoped memories now route to `<project-root>/.memory-lane/memory.jsonl` when project scope is known and no explicit storage environment override is active.
Global-scope preferences and personal memories still route to the home store.
Reads merge the home store and the active project store, and existing memory ids continue to mutate in their origin store.

Before Slice 2a, the remaining compatibility gap was legacy project-scoped memories that were written to the home store before Slice 1.
Those records are still visible through the merged read model, and Slice 2a now gives users a bounded way to understand how many active current-project rows still live home-side and what a future migration would need to handle.

## Problem

A real migration is risky because Memory Lane uses append-only revisions and last-wins folding by memory id.
A naive cross-store copy could create duplicate active ids, change the folded winner, orphan embeddings, or hide pending review records.

Before implementing any mutating migration command, Memory Lane needed a read-only diagnostics slice that measures the compatibility population and classifies migration hazards.
Slice 2a provides that diagnostics layer.
The diagnostics must stay low-noise and must not create project-local storage during read-only commands.

## Goals

- Detect active legacy current-project memories that still live in the home store.
- Report bounded counts and samples through low-noise CLI diagnostics.
- Provide a dry-run migration preview command that makes no file changes.
- Classify migration hazards so a later mutating migration design can be precise.
- Preserve existing JSON output compatibility by adding namespaced fields only.
- Preserve the Slice 1 invariant that read-only commands do not auto-create project-local stores.

## Non-goals

- No confirmed migration.
- No cross-store move protocol.
- No source-store tombstones.
- No embedding relocation or rebuild.
- No automatic approval, rejection, deletion, supersedence, consolidation, or rescoping.
- No retrieval or ranking changes.
- No memory schema expansion.
- No lifecycle, SessionStart, prompt-injection, recall, or MCP warning surfaces.
- No broad global scan across every project.
- No Obsidian storage model changes.
- No cloud sync.

## Definitions

### Legacy current-project memory

A legacy current-project memory is an active folded winner that satisfies all of these conditions:

1. the winning revision is stored in the home store;
2. `record.scope.type === "project"`;
3. `record.scope.key` equals the active resolved project scope key;
4. `record.status` is not `deleted` or `rejected`;
5. the record is visible to the current merged read model after ordinary folding.

Approved and pending records are both included.
They must be counted separately.

Loser revisions are not counted as legacy memories.
Deleted and rejected active winners are not counted.
Superseded records should not be counted as active migration candidates when the current model treats them as inactive.

### Explicit single-store mode

If any of `MEMORY_LANE_FILE`, `MEMORY_LANE_EMBEDDINGS_FILE`, or `MEMORY_LANE_CONFIG` is set, Slice 2a diagnostics are not applicable.
The command should report an inert or not-applicable state rather than trying to infer home/project split behavior.

## Proposed behavior

### Detection helper

Add a bounded internal helper that inspects the active two-tier storage view and returns a legacy diagnostics report.
The helper should avoid changing persisted memory schema.
It may use facade origin metadata, a targeted home/project store read, or a small new core diagnostic seam.

The report should include:

- active project scope key;
- home memory path;
- project memory path if an active project store path is known;
- total legacy candidate count;
- approved legacy count;
- pending legacy count;
- at most 10 sample records with id, status, kind, updatedAt, and a preview capped at 160 characters;
- hazard tallies;
- not-applicable reason when explicit storage overrides disable two-tier behavior.

The report must be deterministic and bounded.
Candidate samples should sort by newest `updatedAt` first, then by id.
Large populations should not produce unbounded output.

### Hazard classification

The dry-run report should classify migration hazards without mutating files.
At minimum, classify:

- duplicate id also present in the project store;
- home-side embeddings exist for the memory id;
- pending status;
- mixed-origin revision chain if the existing storage seam can detect it safely.

A duplicate id is counted at most once in the main candidate count when the active folded winner is home-side.
If the active folded winner is project-side, the home-side row should not increase the main candidate count, but it may contribute to duplicate-id hazard tallies when inspected.

If mixed-origin revision chains are expensive or not available without broader refactoring, the spec may allow deferring that classifier while keeping a `notInspected` or equivalent field.
The implementation must not pretend a hazard was checked when it was not checked.

### `memory-lane status`

Human `status` output should include at most one concise warning line when legacy current-project memories exist.
The line should tell the user to run the dry-run preview for details.

JSON `status --json` should add one namespaced block, for example `legacyProjectMemories`.
Existing scalar fields such as `memoryFile`, `embeddingFile`, counts, and project scope fields must remain compatible.

The additive block should be explicitly not-applicable when there is no active two-tier project context.
The exact shape should be locked by tests.

### `memory-lane doctor`

`doctor` should be the richest diagnostic surface for this slice.
Human output may include bounded detail and hazard tallies.
JSON output should include the same namespaced report shape as status or a superset under the same conceptual key.

Doctor must remain read-only.
Doctor must not create `<project-root>/.memory-lane/`, `.memory-lane-scope`, `.gitignore`, memory JSONL files, embedding JSONL files, or config files.

### `memory-lane migrate project-local --dry-run`

Add a report-only migration preview command.
The command should require `--dry-run` in Slice 2a.
If the user runs `memory-lane migrate project-local` without `--dry-run`, it should fail with a clear message that mutating migration is not implemented in this release.

The dry-run command should:

- exit successfully when diagnostics can run;
- exit successfully with an informational not-applicable report when explicit storage overrides disable two-tier behavior;
- make no file changes;
- report the same bounded candidate set and hazard tallies;
- support `--json` with the namespaced report;
- be deterministic across repeated runs over unchanged files;
- respect `--project <path>`;
- report not-applicable under explicit storage overrides.

This command name leaves room for a future `--yes` execution path, but Slice 2a must not implement it.

## Output and noise policy

Slice 2a adds no dedicated MCP tool or lifecycle prompt surface.
Because MCP `memory_status` wraps `MemoryEngine.doctor()`, it inherits the same read-only `legacyProjectMemories` diagnostics exposed by `doctor --json`.
Do not add lifecycle reminders, SessionStart text, recall warnings, continuity warnings, or separate MCP responses in this slice.

Rationale: users who run `status`, `doctor`, `migrate project-local --dry-run`, or explicit MCP status are explicitly asking for Memory Lane state.
Prompt-time warnings could add noise and should be considered only after dogfood shows users miss the CLI diagnostics.

## Read-only invariants

The following commands must not create or rewrite files as part of Slice 2a diagnostics:

- `memory-lane status`;
- `memory-lane status --json`;
- `memory-lane doctor`;
- `memory-lane doctor --json`;
- `memory-lane migrate project-local --dry-run`;
- `memory-lane migrate project-local --dry-run --json`.

This includes avoiding startup auto-compaction side effects in read-only diagnostics.
If current command construction would auto-compact or auto-create stores, the implementation must use the read-only resolver path.

## Future mutating migration protocol

Confirmed migration is deferred to a later design gate.
That later gate should specify:

- destination project-store revision creation;
- source home-store tombstone or migrated-marker semantics;
- duplicate id conflict handling;
- pending-review preservation;
- embedding relocation or rebuild behavior;
- idempotency after partial failure;
- rollback or recovery story;
- exact interaction with `updatedAt` winner semantics;
- manual confirmation and dry-run-first UX.

Slice 2a should gather enough hazard information to make this later protocol safer.

## Files likely to modify in implementation

- `packages/core/src/storage-facade.ts`
- `packages/core/src/storage-locations.ts`
- `packages/core/src/engine.ts`
- `packages/cli/src/index.ts`
- `packages/cli/test/cli.test.ts`
- `packages/core/test/storage-facade.test.ts`
- `packages/core/test/storage-locations.test.ts`
- `README.md`
- `skills/memory-lane/SKILL.md`
- `skills/memory-lane/REFERENCE.md`
- `ROADMAP.md`
- `HANDOFF.md`

The exact implementation may use a narrower set if the existing facade already exposes enough origin information.

## Required tests

1. Detection only counts home-store active winners whose project scope key matches the active project.
2. A second project's home-store project rows are excluded.
3. Global, personal, and global-scope preference rows are excluded.
4. Approved and pending legacy rows are counted separately.
5. Deleted and rejected winners are excluded.
6. Superseded inactive records are excluded according to the existing active-record model.
7. A duplicate id present in both home and project stores is classified as a conflict instead of being double-counted.
8. Home-side embeddings for candidate memory ids are counted as a hazard.
9. Explicit `MEMORY_LANE_*` mode reports inert or not-applicable diagnostics.
10. `status`, `doctor`, and dry-run preview do not create `.memory-lane/`, `.memory-lane-scope`, `.gitignore`, memory files, embedding files, or config files.
11. Read-only diagnostics do not rewrite existing home or project files.
12. JSON output keeps existing scalar fields compatible and adds only the namespaced diagnostics block.
13. Human output is bounded and deterministic for a large legacy population.
14. Dry-run preview exits zero, supports `--json`, and is deterministic.
15. Running `migrate project-local` without `--dry-run` fails with a clear non-mutating message.
16. `--project <path>` selects the intended project scope.
17. Worktrees that share the same project scope key report the same legacy candidates.

## Verification plan

Minimum automated checks after implementation:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm test
pnpm build
git diff --check
```

Manual dogfood checks after implementation:

1. Create an isolated fixture with a home-store project-scoped legacy row for the active project and no project-local store.
2. Run `memory-lane status --json --project <fixture>` and confirm the row is reported without creating project-local files.
3. Run `memory-lane doctor --json --project <fixture>` and confirm bounded hazard reporting.
4. Run `memory-lane migrate project-local --dry-run --json --project <fixture>` and confirm it reports candidates without mutating files.
5. Run `memory-lane migrate project-local --project <fixture>` without `--dry-run` and confirm it refuses to mutate.
6. Run against a project with no legacy rows and confirm the outputs stay quiet.
7. Run against explicit `MEMORY_LANE_*` paths and confirm not-applicable behavior.

## Fable 5 review decisions folded into this draft

- Slice 2a should be detection, warnings, and dry-run preview only.
- Confirmed migration should be deferred because cross-store mutation needs a source tombstone, destination revision, embedding, conflict, and idempotency protocol.
- `doctor`, `status`, and `migrate project-local --dry-run` are the right low-noise CLI surfaces.
- Lifecycle, continuity, recall, SessionStart, and MCP warning surfaces should stay out of this slice.
- Legacy-note detection should operate on folded active winners, not raw revisions.
- Explicit storage override mode should be inert or not applicable.
- Dry-run output should classify hazards rather than only showing counts.

## Approval record

The user approved the Fable-reviewed Slice 2a scope on 2026-07-02.
PR #88 merged the full spec as `4f64367 docs: draft project-local slice 2a diagnostics spec (#88)`.
The user then approved implementation from this spec.
PR #89 merged the implementation as `96516ef feat(cli): add legacy project diagnostics dry run (#89)`.
The implementation shipped in `v0.2.44` with installed-artifact dogfood documented in `docs/superpowers/validation/2026-07-02-v0.2.44-release-dogfood.md`.
