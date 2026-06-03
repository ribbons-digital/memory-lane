# Memory Lane Roadmap

This roadmap focuses on three upcoming directions:

1. Obsidian mirror/import support
2. MCP server support
3. Experimental Obsidian-backed storage

The ordering is intentional: mirror/import gives users Obsidian value with low risk; MCP is broadly useful and should not depend on Obsidian; true Obsidian-backed storage comes last because it changes Memory Lane's core reliability model.

Each phase lists a focused implementation slice of no more than five todos. If a phase needs more work, add the next slice only after the current slice is complete, keeping the todo order aligned with implementation dependencies.

## Phase 1 — Obsidian Mirror Foundation

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

## Phase 2 — Obsidian Mirror UX Polish

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

## Phase 3 — Controlled Import from Obsidian

**Goal:** Allow users to author or edit memories in Obsidian, but only through explicit import.

Todos:

1. Support importable notes marked with:
   ```yaml
   memory_lane: true
   ```
2. Add CLI commands:
   ```bash
   memory-lane obsidian import --dry-run
   memory-lane obsidian import
   ```
3. Validate imported notes using existing Memory Lane validation.
4. Define conflict policy:
   - same `memory_lane_id` updates existing memory
   - no ID creates a new memory
   - invalid fields are skipped with warnings
5. Add tests for import, duplicate handling, invalid frontmatter, and edited text.

## Phase 4 — MCP Server MVP

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

## Phase 5 — MCP + Hooks Coordination

**Goal:** Make MCP and lifecycle hooks complement each other cleanly.

Todos:

1. Document division of responsibility:
   - hooks = automatic recall/save lifecycle
   - MCP = explicit model/tool access
2. Add MCP resources for memory status/config.
3. Add project-aware MCP behavior matching CLI `--project`.
4. Add optional Obsidian mirror status through MCP.
5. Add diagnostics to detect duplicate or conflicting hook + MCP setups.

## Phase 6 — Obsidian-Backed Storage Prototype

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

## Phase 7 — Obsidian-Backed Storage Hardening

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
