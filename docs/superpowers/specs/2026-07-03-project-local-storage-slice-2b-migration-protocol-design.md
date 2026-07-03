# Project-local Storage Slice 2b Migration Protocol Design

## Status

Approved and implemented in this slice.
Fable 5 reviewed the draft, blockers were resolved, and the user approved implementation.

Slice 0 shipped in `v0.2.42` as the storage facade proof.
Slice 1 shipped in `v0.2.43` as project-local default writes for new project-scoped memories.
Slice 2a shipped in `v0.2.44` as read-only legacy diagnostics and dry-run preview.

Slice 2b defines the mutating migration protocol required before Memory Lane may move legacy home-stored project memories into project-local storage.
The implementation is limited to this reviewed plan/apply protocol.

## Entry gate

The entry gate is open because Slice 2a is released and dogfooded.
The installed artifact can already enumerate active legacy current-project memories through CLI `status`, CLI `doctor`, MCP `memory_status`, and `memory-lane migrate project-local --dry-run`.

The implementation gate is open after Fable 5 review and explicit user approval.
No command may silently move, delete, approve, reject, consolidate, or rescope memories outside the approved plan/apply protocol.

## Problem

Legacy project memories can still live in the home store because earlier Memory Lane versions wrote project-scoped records to `~/.memory-lane/memory.jsonl`.
Slice 1 fixed new project-scoped writes, but it intentionally left old records in place.
Slice 2a made that population visible, but visibility alone does not complete the project-local storage track.

A safe migration must handle Memory Lane's append-only record model, merged home/project reads, last-wins folding, existing ids, embeddings, pending review records, partial failure, and repeated runs.
A naive copy can leave duplicate active ids, hide records behind a newer tombstone, orphan embeddings, or mutate review state without user approval.

## Goals

- Define a review-first migration protocol for active legacy current-project memories.
- Preserve user control through an explicit plan file and an explicit apply command.
- Keep the default behavior read-only.
- Make apply idempotent when a previous run partially succeeded.
- Preserve approved and pending statuses without auto-approval or auto-rejection.
- Preserve memory ids so existing references and `memory-lane show <id>` keep working.
- Preserve retrieval as well as practical by copying compatible embeddings when safe and falling back to rebuild guidance when not safe.
- Block unsafe migrations with clear diagnostics instead of guessing.
- Keep the protocol local and per active project.

## Non-goals

- No silent migration.
- No broad global migration across every project.
- No automatic approval, rejection, deletion, supersedence, consolidation, or rescoping.
- No retrieval or ranking rewrite.
- No memory schema expansion required for the first implementation.
- No cloud sync.
- No Obsidian storage model change.
- No lifecycle, SessionStart, recall, or continuity warning surface.
- No automatic git tracking of `.memory-lane/` or `.memory-lane-scope`.

## Definitions

### Candidate

A candidate is a legacy current-project memory as defined by Slice 2a:

1. the active folded winning revision is stored in the home store;
2. `record.scope.type === "project"`;
3. `record.scope.key` equals the active resolved project scope key;
4. `record.status` is not `deleted` or `rejected`;
5. the record is visible in the current merged read model;
6. the record is not marked with `revision.supersededBy` under the existing active-record model.

Approved and pending candidates are both eligible for planning.
Pending candidates must remain pending after migration.

Superseded inactive home-side records are accepted residue for this first mutating slice.
They are not active operational memory, they are already excluded from Slice 2a diagnostics, and migrating or compacting historical superseded text needs a separate cleanup design.

### Migration plan

A migration plan is a JSON document emitted by a dry-run command.
It records the project scope, source and destination paths, candidate ids, source fingerprints, planned destination records, planned source tombstones, planned embedding actions, hazards, blockers, and the Memory Lane producer version that produced the plan.
Compatibility is gated by `planVersion`; `producerVersion` is required provenance for review and diagnostics.

A plan is reviewable and stable enough for a user to inspect before applying.
It is not a durable database format.

### Source fingerprint

A source fingerprint is a deterministic hash over the source active record plus the source file path and relevant revision metadata.
Apply must classify each candidate state before applying the fingerprint check.
The fingerprint check applies only to `not-started` candidates whose source home active record is still the planned legacy winner.
If that source record changed before any migration writes happened, apply must refuse and ask the user to regenerate the plan.
If destination or tombstone writes from an earlier apply already happened, rerun uses the idempotency state machine instead of treating the fingerprint mismatch as an automatic conflict.

## User-facing flow

### Plan generation

Extend the existing preview command:

```sh
memory-lane migrate project-local --dry-run --write-plan <path> --project <project>
```

The command should also continue to support JSON output:

```sh
memory-lane migrate project-local --dry-run --json --project <project>
```

When `--write-plan` is present, the command writes a plan file and prints a concise summary.
The `--project <project>` flag has the same path semantics as Slice 2a: it selects the project directory used to resolve the active project scope key and project-local destination path.
It must not mutate memory stores, embedding stores, config files, or gitignore files beyond writing the explicitly requested plan path.

The plan summary should include:

- candidate count;
- approved and pending counts;
- copyable embedding count;
- blocker count;
- destination project memory path;
- exact apply command to run after review.

### Apply

Add a separate apply path:

```sh
memory-lane migrate project-local --apply-plan <path> --yes
```

`--yes` is required.
Without `--yes`, the command should refuse and print the summary plus the confirmation flag required.

Apply must not accept an implicit live plan for the first mutating implementation.
The user must generate and review a plan file first.
The plan carries the resolved project path and project scope key, so apply does not need a separate `--project` flag unless a future implementation adds one for an explicit consistency check.
This keeps the protocol review-first and avoids accidental movement from a casual command invocation.

### Existing no-flag behavior

`memory-lane migrate project-local` without `--dry-run` or `--apply-plan` should continue to refuse.
The refusal should explain the two-step flow:

1. generate a plan with `--dry-run --write-plan <path>`;
2. review it;
3. apply with `--apply-plan <path> --yes`.

## Mutation protocol

For each candidate, apply should append records rather than rewrite old history.
The protocol should use one migration timestamp base for the whole plan and deterministic per-record offsets.
The migration timestamp base is fixed during plan generation and carried in the plan file.

Apply must use an explicit migration storage operation with per-store addressing.
The existing ordinary facade append routing is not sufficient because existing legacy ids are owned by the home store and would route destination revisions back home.
The migration operation must be able to append memory revisions and embedding rows directly to the planned home or project store, and tests must lock that destination revisions physically land in the project file.

For a candidate `id`, apply appends:

1. a destination active revision to the project store with the same `id`, all semantic fields preserved verbatim except the new `updatedAt`, and the same `status` as the source candidate;
2. a source tombstone revision to the home store with the same `id`, `status: "deleted"`, exact non-secret placeholder text `Migrated to project-local storage.`, and an `updatedAt` lower than the destination active revision.

The destination active revision must win the merged read model after both appends.
The source tombstone must keep the home-side active winner inactive when the project store is not read, without hiding the destination in the normal merged view.
Because the destination revision receives a fresh `updatedAt`, migration can make old memories look recently updated to recency-sensitive surfaces.
The implementation slice must include continuity or SessionStart dogfood that checks this side effect remains acceptable.

Recommended timestamp order:

- source tombstone `updatedAt = migrationBase + offset`;
- destination active revision `updatedAt = migrationBase + offset + 1ms`.

Plan generation must block candidates whose source `updatedAt` is greater than or equal to the planned tombstone `updatedAt`.
This avoids clock-skew or imported future-dated records that would keep the old home revision active in a home-only fold.

Recommended write order:

1. append destination project revisions and compatible project embeddings;
2. append source home tombstones;
3. flush and reread the merged model;
4. verify each migrated id folds to the project-side active revision.

This order favors recoverability.
If the process fails after destination writes but before source tombstones, rerun can detect that the destination already exists and finish the source tombstone step.
If the process fails after all writes, rerun should report the ids as already migrated.

## Embedding behavior

For each candidate, inspect the latest valid home-side embedding rows for the candidate id.
If an embedding row matches the candidate text content hash, model, profile, and dimensions, apply may copy that vector to the project embedding store with `memoryUpdatedAt` set to the destination revision `updatedAt` and `createdAt` set to the migration copy time.
The fresh `createdAt` is required so older invalidation tombstones do not make the copied row immediately stale.

Home-side embeddings can still participate in the current merged embedding view by memory id and content hash.
Copying compatible embeddings is therefore not required for immediate recall correctness, but it is useful for project-store self-containment and for later compaction behavior.

If no compatible embedding exists, or the embedding is stale, apply should not call a remote provider as part of migration.
Instead, it should record `embeddingAction: "rebuild-needed"` in the plan and include a post-apply hint to run `memory-lane reindex` if the user wants semantic embeddings rebuilt immediately.

Home-side embeddings for tombstoned source records may remain in the home embedding log until ordinary compaction or future cleanup removes them.

## Blockers and hazards

Apply must refuse the whole plan when any blocker exists.
The first implementation should prefer all-or-nothing project migration over partial migration.

Blockers:

- explicit `MEMORY_LANE_*` single-store mode;
- missing or changed project scope key;
- missing source home memory file for a `not-started` candidate;
- source fingerprint mismatch for a `not-started` candidate;
- source `updatedAt` greater than or equal to the planned tombstone `updatedAt`;
- active project-side record for the same id with different text or status;
- mixed-origin revision chain that cannot be proven safe;
- destination project store path cannot be created or written;
- home store cannot be appended;
- invalid plan version;
- missing or invalid producer version.

Hazards that can remain non-blocking when represented in the plan:

- pending status, preserved as pending;
- compatible home-side embedding available for project-side copy;
- stale or missing embedding requiring `reindex`;
- project-local store creation required.

If project-local store creation is required, apply may create `<project>/.memory-lane/`, write or preserve `.memory-lane-scope`, and append `.memory-lane/` to `.gitignore` because the user explicitly approved a mutating migration plan.
The implementation should reuse the existing writable project-local initialization path rather than inventing new setup logic.
It must not add `.memory-lane-scope` to git.

## Idempotency and recovery

Apply should be repeatable with the same plan.
For each candidate, apply should classify the current state before appending or checking the source fingerprint.
State classification must use the planned destination revision from the plan, not any same-id project-side record.
A same-id project-side record that does not match the planned destination is a conflict or blocker, not a completed migration.

States:

- `not-started`: neither the planned destination active revision nor the planned source tombstone exists, and the source home active record still matches the plan fingerprint;
- `destination-written`: the planned destination revision exists and wins merged reads, but the planned source tombstone is missing while a home-side active record still exists;
- `complete`: the planned destination revision exists and either the planned source tombstone exists or no home-side record for the id exists after compaction;
- `conflict`: current files differ from the reviewed plan in any other way.

Rerun behavior:

- `not-started` records are migrated;
- `destination-written` records get the missing source tombstone appended;
- `complete` records are skipped;
- any `conflict` blocks the whole apply.

If `destination-written` repair finds the planned compatible embedding copy is missing, it may retry the embedding copy.
If it cannot retry safely, it should keep the migrated memory active and report a `reindex` hint rather than blocking repair.

If a later home-side write makes an already complete id reappear as a fresh legacy candidate, the expected recovery is to generate and review a new plan for that new active state.

If post-write fold verification fails, apply should exit nonzero and report the failed ids.
It should not attempt rollback because the storage model is append-only.
A later rerun with the same plan should repair recoverable partial states.

Concurrent Memory Lane processes can still write between classification and append because there is no cross-store transaction.
The implementation should rely on per-store append safety plus post-write verification, and should document this accepted race.

After apply, the command should print a summary with migrated, completed-before-run, repaired, skipped, and blocked counts.

## Output shape

The dry-run JSON output should add fields under the existing `legacyProjectMemories` report rather than replacing it.
A possible shape:

```json
{
  "data": {
    "legacyProjectMemories": {
      "status": "ok",
      "totalLegacyCandidateCount": 2,
      "migrationPlan": {
        "version": 1,
        "projectScopeKey": "example",
        "planPath": "./memory-lane-migration-plan.json",
        "candidateCount": 2,
        "blockerCount": 0,
        "embeddingActions": {
          "copyCompatible": 1,
          "rebuildNeeded": 1
        },
        "applyCommand": "memory-lane migrate project-local --apply-plan ./memory-lane-migration-plan.json --yes"
      }
    }
  }
}
```

The plan file itself may include full candidate text because it is an explicit user-requested local artifact.
Because users may accidentally write the plan inside a git repository, the CLI should warn that the plan can contain memory text and should not be committed.
A future implementation may choose a non-repo default plan path if it offers one.
The CLI summary should remain bounded.
MCP `memory_status` should not emit plan-file contents or full memory bodies.

## Interaction with rescope and move

This slice only migrates current-project records whose scope is already correct.
It does not implement general cross-store `rescope` / `move` semantics.

A future rescope slice can reuse the plan/apply pattern, but it must make separate decisions because rescope changes the memory scope as well as the storage side.

## Implementation files

The implementation touched:

- `packages/core/src/storage-facade.ts`;
- `packages/core/src/engine.ts`;
- `packages/core/src/types.ts`;
- `packages/cli/src/index.ts`;
- `packages/cli/src/formatters.ts`;
- `packages/core/test/storage-facade.test.ts`;
- `packages/cli/test/cli.test.ts`;
- `README.md`;
- `docs/2026-05-20-memory-lane-design.md`;
- `skills/memory-lane/SKILL.md`;
- `skills/memory-lane/REFERENCE.md`;
- `ROADMAP.md`;
- `HANDOFF.md`.

## Required implementation tests

The implementation should cover:

1. plan generation for one approved legacy candidate;
2. plan generation preserving pending status;
3. apply requires `--apply-plan` and `--yes`;
4. apply refuses when source fingerprint changed;
5. apply appends destination project revision and source home tombstone;
6. merged reads fold to the destination project revision after apply;
7. destination revisions physically land in the project memory file through explicit migration storage targeting;
8. rerun with the same plan is idempotent;
9. rerun repairs destination-written partial state by appending the source tombstone;
10. rerun treats destination plus no home-side record after compaction as complete;
11. duplicate active project-side record with different text blocks apply;
12. compatible embeddings are copied to the project embedding log with the destination `updatedAt` and a fresh `createdAt`;
13. stale or missing embeddings do not block apply and produce a rebuild hint;
14. explicit `MEMORY_LANE_*` mode blocks apply;
15. apply can create project-local storage only when using an approved plan;
16. `status`, `doctor`, and MCP `memory_status` remain bounded and do not emit full plan contents;
17. `memory-lane migrate project-local` without flags still refuses;
18. worktree/shared-scope projects use the expected project scope key and project store path;
19. continuity or SessionStart dogfood checks whether migrated records with fresh `updatedAt` create unacceptable recency noise.

## Verification plan for implementation

Minimum automated checks after implementation:

```sh
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
pnpm test
pnpm build
git diff --check
```

Manual dogfood after implementation:

1. Create an isolated fixture with a home-store approved project memory and no project-local store.
2. Generate a plan with `memory-lane migrate project-local --dry-run --write-plan <plan> --project <fixture>`.
3. Inspect the plan and confirm the candidate, destination, source tombstone, and embedding action are understandable.
4. Apply with `memory-lane migrate project-local --apply-plan <plan> --yes`.
5. Confirm `memory-lane show <id> --project <fixture>` returns the project-side active revision.
6. Confirm `memory-lane status --json --project <fixture>` no longer reports the id as a legacy candidate.
7. Re-run the same apply command and confirm idempotent no-op or completed-before-run behavior.
8. Repeat with a pending candidate and confirm it remains pending.
9. Repeat with an incompatible duplicate project-side id and confirm apply refuses.

## Approval record

Fable 5 review completed and the user approved implementation.
Implementation must remain within this spec unless a follow-up review gate approves changes.
