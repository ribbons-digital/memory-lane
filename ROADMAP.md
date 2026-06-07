# Memory Lane Roadmap

This roadmap focuses on four upcoming directions:

1. Obsidian mirror/import support
2. MCP server support
3. Obsidian LLM Wiki / knowledge-base access
4. Experimental Obsidian-backed storage

The ordering is intentional: mirror/import gives users Obsidian value with low risk; MCP is broadly useful and should not depend on Obsidian; Obsidian LLM Wiki features should build on MCP/resource access while staying distinct from Memory Lane memories; true Obsidian-backed storage comes last because it changes Memory Lane's core reliability model.

Each phase lists a focused implementation slice of no more than five todos. If a phase needs more work, add the next slice only after the current slice is complete, keeping the todo order aligned with implementation dependencies.

## Phase 1 — Obsidian Mirror Foundation

**Status:** Complete and merged.

**Goal:** Add opt-in one-way Obsidian mirror support while JSONL remains the source of truth. Phase 1 does not include import, bidirectional sync, Obsidian-backed storage, index pages, or hook setup prompts.

### Slice 1 — Contract and First Working Mirror

Todos:

1. Define Obsidian mirror config type/validation and path safety rules on the existing resolved Memory Lane config path.
2. Define mirrored Markdown format and generated-file deletion rules, including stable `memories/<id>.md` paths, generated-file warnings, flat frontmatter, and active-only `approved|pending` semantics.
3. Add `@memory-lane/obsidian-mirror` package skeleton with renderer and sync tests first.
4. Add CLI commands and docs/help around the mirror package:
   ```bash
   memory-lane obsidian init --vault <path> [--folder "Memory Lane"]
   memory-lane obsidian status
   memory-lane obsidian sync [--dry-run]
   ```
   Include CLI help, README usage, and `skills/memory-lane/SKILL.md` updates.
5. Wire best-effort `MemoryEngine` mirror updates after successful write/status-transition operations only after the standalone sync path is tested.

Add the next Phase 1 slice only after these todos are complete.

Later phases below are intentionally higher-level. Before implementing any later phase, rewrite that phase into a focused slice of no more than five active todos.

## Phase 2 — Controlled Obsidian Import Contract

**Status:** Complete and merged.

**Goal:** Define the explicit Obsidian import workflow before implementation. Import remains separate from the mirror: JSONL stays the source of truth, import only reads user-marked Markdown, and no bidirectional sync or Obsidian-backed storage is introduced.

Todos:

1. Define importable note discovery and marker contract, including which folders are scanned and how generated mirror files are excluded.
2. Define Markdown/frontmatter import schema, including required and optional fields, body text handling, category/scope/status defaults, and provenance/import metadata.
3. Define create/update/conflict semantics, including behavior for `memory_lane_id`, duplicate text, deleted/rejected records, and invalid fields.
4. Define dry-run output and warning model for human and JSON CLI output.
5. Write a detailed implementation plan/spec before coding the import package or CLI commands.

Add the next Phase 2 slice only after these todos are complete.

## Phase 3 — Controlled Import from Obsidian

**Status:** Complete and merged.

**Goal:** Implement explicit Markdown-to-JSONL import based on the Phase 2 contract.

Completed scope:

1. Added parser, discovery, and planner tests for importable notes in `@memory-lane/obsidian-import`.
2. Added CLI commands:
   ```bash
   memory-lane obsidian import --dry-run
   memory-lane obsidian import --json --dry-run
   memory-lane obsidian import
   memory-lane obsidian import --json
   ```
3. Applied imported notes through normal `MemoryEngine.save` and `MemoryEngine.update` append-only JSONL writes.
4. Added conflict and duplicate handling from the approved import contract.
5. Added docs for authoring importable notes, dry-run review, JSONL source-of-truth semantics, generated-file skip behavior, and why import is not automatic sync.


## Hardening Backlog — Completed Phase Follow-ups

These items do **not** reopen Phases 1–3 and should not start the next roadmap phase by themselves. Treat them as small hardening tasks to schedule only after explicit user approval.

1. **Obsidian import dry-run secret warnings**
   - Current apply path uses normal `MemoryEngine.save`/`MemoryEngine.update` validation, so likely secrets are skipped at apply time.
   - Improve dry-run so secret-containing import notes are warned/skipped before apply, either by passing a secret-detection callback into the import planner or extracting secret detection into a small shared utility.

2. **Import snapshot type cleanup**
   - `ExistingImportMemory` includes optional fields that the planner currently does not read and the CLI snapshot mapper does not populate.
   - Either trim the type to fields actually used by the planner or populate the fields consistently for future maintainability.

## Phase 4 — Obsidian Mirror UX Polish

**Status:** Complete and merged.

**Goal:** Make the generated mirror easier to browse in Obsidian without changing the canonical one-file-per-memory layout from Phase 1.

Planned first slice decisions:

- Mirror index files are generated/read-only mirror artifacts, not user-authored notes.
- First index set:
  - `<vault>/<folder>/index.md` landing page
  - `<vault>/<folder>/indexes/pending.md`
  - `<vault>/<folder>/indexes/approved.md`
  - `<vault>/<folder>/indexes/project.md` grouped by project key
  - `<vault>/<folder>/indexes/recent.md` sorted by `updatedAt` descending
- Generated indexes use standard Markdown links to `memories/<id>.md` for portability and deterministic tests.
- Lightweight Obsidian tags are added to both mirrored memory files and mirror index files while preserving generated-file markers:
  - memory files include `memory-lane`, `memory-lane/memory`, status, category, and kind tags
  - index files include `memory-lane` and `memory-lane/index` tags plus `memory_lane_index: true`
  - no Dataview-specific custom fields are added in the first slice beyond existing useful frontmatter
- `memory-lane doctor` adds cheap, non-mutating Obsidian checks only: enabled/config presence, vault path existence, folder safety, mirror folder existence, `memories/` existence, and `imports/` existence.
- Mirror sync owns generated index files at `<vault>/<folder>/index.md` and `<vault>/<folder>/indexes/*.md`; stale generated index cleanup is allowed only inside the configured index area and only for `.md` files marked with both `memory_lane_mirror: true` and `memory_lane_index: true`.
- All first-slice index files are generated even when empty, with explicit empty-state text.
- Index entries stay compact: Markdown link text/title plus status, category, kind, scope label, and updated date; source/provenance/full metadata stay in the mirrored memory file.
- Future improvement: one-file-per-project indexes after filename/slug rules are deliberately designed.
- Future improvement: optional Obsidian wikilinks if users prefer native Obsidian link syntax.
- Future improvement: full mirror reconciliation diagnostics in doctor after stale-file/active-record comparison rules are deliberately designed.
- Future improvement: import dry-run secret warnings as a separate import-hardening task.
- Future improvement: import snapshot type cleanup as a separate maintainability task.

Todos:

1. Add generated mirror index rendering/sync support for the first index set, including stable empty index files, compact standard-Markdown link entries, and safe stale index deletion gated by `memory_lane_mirror: true` plus `memory_lane_index: true`.
2. Add lightweight Obsidian tags/properties to generated mirrored memory files and mirror index files without adding Dataview-specific custom fields.
3. Add cheap, non-mutating Obsidian checks to `memory-lane doctor`.
4. Update README, CLI help, generated mirror README, skill docs, and manual testing docs to explain generated index files, tags, status/category/project/recent browsing, and why hooks/import do not treat index files as user-authored notes.
5. Write a focused implementation plan/spec for this Phase 4 slice before coding, keeping deferred improvements out of scope: one-file-per-project indexes, optional wikilinks, full reconciliation diagnostics, import dry-run secret warnings, and import snapshot cleanup.

## Phase 5 — MCP Server MVP

**Goal:** Expose Memory Lane through MCP without changing the storage model.

Todos:

1. Add package:
   ```text
   @memory-lane/mcp-server
   ```
2. Expose core tools:
   - `memory_save`
   - `memory_suggest`
   - `memory_recall`
   - `memory_list`
   - `memory_review`
3. Support stdio transport first.
4. Reuse existing `MemoryEngine`, project scope, validation, and retrieval logic.
5. Add setup docs for Claude Desktop, Claude Code, Codex, and Cursor.

## Phase 6 — MCP + Hooks Coordination

**Goal:** Make MCP and lifecycle hooks complement each other cleanly.

Todos:

1. Document division of responsibility:
   - hooks = automatic recall/save lifecycle
   - MCP = explicit model/tool access
2. Add MCP resources for memory status/config.
3. Add project-aware MCP behavior matching CLI `--project`.
4. Add optional Obsidian mirror status through MCP.
5. Add diagnostics to detect duplicate or conflicting hook + MCP setups.


## Phase 7 — Obsidian LLM Wiki / Knowledge Base Integration

**Goal:** Let LLM clients search and read selected Obsidian/Garden notes as source-backed knowledge without turning those notes into Memory Lane memories automatically.

This is separate from Obsidian mirror/import:

- Memory Lane memories remain compact JSONL records for durable agent preferences, facts, and checkpoints.
- Obsidian LLM Wiki notes remain user-authored source documents in the vault/Garden.
- Answers should be grounded in source notes with citations or file references.
- Promotion from a wiki note/fact into Memory Lane should be explicit, not automatic.

Todos:

1. Define the boundary between Memory Lane memories and Obsidian/Garden knowledge-base notes, including naming, source-of-truth rules, and citation expectations.
2. Add MCP resources/tools for listing, searching, and reading selected Obsidian/Garden notes without scanning private or generated folders by default.
3. Add source-backed answer support with citations to note paths/headings/blocks where practical.
4. Add an explicit "promote to Memory Lane" workflow that saves selected wiki-derived facts only after user/model action, preserving normal validation and review semantics.
5. Document setup, privacy boundaries, ignored folders, and how this differs from mirror/import and Obsidian-backed storage.

## Phase 8 — Obsidian-Backed Storage Prototype

**Goal:** Experiment with Markdown as a primary backend without replacing JSONL globally.

Todos:

1. Add storage interface abstraction:
   ```ts
   interface MemoryStoreBackend {
     // experimental backend contract
   }
   ```
2. Implement experimental Markdown backend:
   ```json
   {
     "storage": {
       "backend": "obsidian"
     }
   }
   ```
3. Support read/write/list/search over Markdown memory notes.
4. Define deletion/tombstone and rename behavior.
5. Gate behind an explicit experimental flag.

## Phase 9 — Obsidian-Backed Storage Hardening

**Goal:** Decide whether Obsidian-backed storage is production-worthy.

Todos:

1. Add migration tools:
   ```bash
   memory-lane migrate jsonl-to-obsidian
   memory-lane migrate obsidian-to-jsonl
   ```
2. Add conflict detection and repair commands.
3. Add index/cache for fast recall over Markdown.
4. Add comprehensive docs comparing `jsonl`, `mirror`, and `obsidian` backend modes.
5. Decide whether Obsidian-backed storage graduates from experimental or remains advanced-only.
