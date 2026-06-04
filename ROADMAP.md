# Memory Lane Roadmap

This roadmap focuses on three upcoming directions:

1. Obsidian mirror/import support
2. MCP server support
3. Experimental Obsidian-backed storage

The ordering is intentional: mirror/import gives users Obsidian value with low risk; MCP is broadly useful and should not depend on Obsidian; true Obsidian-backed storage comes last because it changes Memory Lane's core reliability model.

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

2. **Windows absolute-path folder validation**
   - Mirror sync already guards against POSIX and Windows absolute folder paths.
   - Align config validation by rejecting `path.win32.isAbsolute(folder)` as well.

3. **Import snapshot type cleanup**
   - `ExistingImportMemory` includes optional fields that the planner currently does not read and the CLI snapshot mapper does not populate.
   - Either trim the type to fields actually used by the planner or populate the fields consistently for future maintainability.

## Phase 4 — Obsidian Mirror UX Polish

**Goal:** Make the generated mirror easier to browse in Obsidian without changing the canonical one-file-per-memory layout from Phase 1.

Todos:

1. Add Obsidian-friendly index pages:
   - pending memories
   - approved memories
   - project memories
   - recent memories
2. Add optional tags/properties for Obsidian Bases or Dataview:
   ```yaml
   tags: [memory-lane, project, approved]
   ```
3. Add `memory-lane doctor` warnings for broken, missing, or stale mirror config.
4. Add docs explaining mirror semantics, generated files, status/category filtering, and why hooks never prompt for Obsidian setup.
5. Evaluate optional user-facing niceties such as custom index titles or folder names without changing canonical `memories/<id>.md` paths.

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

## Phase 7 — Obsidian-Backed Storage Prototype

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

## Phase 8 — Obsidian-Backed Storage Hardening

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
