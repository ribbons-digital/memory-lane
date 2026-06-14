# Memory Lane Handoff

## Current state

Memory Lane is on `main` at merge commit:

```text
021c2a3 merge: mcp memory status tool
```

`main` is clean and aligned with `origin/main`. The Phase 7 MCP Server MVP and Phase 8 Slice 1/2 follow-ups have been merged, verified, pushed, and their feature worktrees/branches removed. The older autosave meta-prompt filter worktree still exists under `~/.config/superpowers/worktrees/memory-lane/autosave-meta-prompt-filter`.

Recent completed work:

- Phase 1 Codex hook integration is implemented and merged.
- Thin Claude Code CLI hook adapter is implemented and merged.
- Claude adapter is for **Claude Code CLI hooks only**, not Claude Desktop.
- Root roadmap/context/ADR docs were added for Obsidian mirror/import, MCP server, and future experimental Obsidian-backed storage.
- Optional one-way Obsidian mirror is implemented and merged.
- Obsidian mirror UX polish is implemented, reviewed, merged, and pushed: generated indexes, tags, cheap doctor diagnostics, and docs/help/manual testing updates.
- Mirror warnings from save/approve/reject/delete are surfaced in human and JSON CLI output.
- Semantic under-indexing diagnostics and hook debug log/doctor diagnostics are implemented and merged.
- Autosave meta-prompt filtering is implemented and merged, including reviewer/task/subagent prompt suppression while preserving explicit memory requests.
- pi read-only lifecycle recall injection is implemented and merged via `before_agent_start`; pi autosave/tool capture remains deferred.
- Worktree-aware project scope is implemented, reviewed, merged, and pushed: linked Git worktrees share the same project key by default via Git common-dir identity, while `.memory-lane-scope` remains the explicit override.
- Explicit, non-destructive Obsidian Markdown import is implemented and merged:
  - new standalone `@memory-lane/obsidian-import` parser/planner package;
  - core `MemoryEngine.update(id, patch)` for active-memory updates;
  - CLI `memory-lane obsidian import [--dry-run]` dry-run/apply flow;
  - import discovery under `<vault>/<folder>/imports/` only;
  - `memory_lane: true` opt-in;
  - generated mirror notes marked `memory_lane_mirror: true` are skipped;
  - source import notes are never rewritten.
- Phase 7 MCP Server MVP is implemented, reviewed, verified, merged, and pushed:
  - new `@memory-lane/mcp-server` package with `memory-lane-mcp` bin;
  - local stdio server for explicit MCP tools;
  - base tools: `memory_save`, `memory_suggest`, `memory_recall`, `memory_list`, and `memory_review`;
  - reuses `MemoryEngine`, JSONL storage, and project scope behavior;
  - docs cover Claude Desktop, Cursor, Claude Code, and Codex boundaries.
- MCP review mutation follow-up is implemented, reviewed, verified, merged, pushed, and manually tested in Claude Desktop:
  - added `memory_approve`, `memory_reject`, and `memory_delete`;
  - deleting a pending memory from Claude Desktop worked in manual testing.
- Phase 8 Slice 1 integration diagnostics is implemented, reviewed, verified, merged, and pushed:
  - `memory-lane doctor` now reports read-only integration diagnostics for Claude Desktop MCP, Codex hooks, Claude Code hooks, and pi extension;
  - diagnostics are config/entrypoint based and do not read prompts, transcripts, tool outputs, memory text, MCP traffic, or hook debug log contents.
- Phase 8 Slice 2 MCP status tool is implemented, reviewed, verified, merged, and pushed:
  - added read-only `memory_status` MCP tool;
  - returns doctor/status data through MCP, including counts, config paths, semantic status, project scope, and integration diagnostics;
  - does not return raw memory text or add lifecycle automation.

Final reviews for recent feature work returned approved outcomes. Verification on merged `main` passed after the MCP status merge:

```bash
pnpm build
pnpm test
pnpm --filter @memory-lane/mcp-server build
```

MCP tool smoke after the latest merge returned:

```text
memory_save,memory_suggest,memory_recall,memory_status,memory_list,memory_review,memory_approve,memory_reject,memory_delete
```

Manual smoke for worktree-aware scope confirmed the main checkout and linked feature worktree had the same `key`, with the linked worktree's `root` remaining the linked worktree path.

## Package overview

Current workspace packages:

- `@memory-lane/core` — storage, validation, lifecycle operations, recall/search, embeddings, mirror integration hooks.
- `@memory-lane/lifecycle` — harness-neutral memory automation policy.
- `@memory-lane/cli` — command-line interface.
- `@memory-lane/mcp-server` — local stdio MCP server exposing explicit Memory Lane tools.
- `@memory-lane/obsidian-mirror` — optional JSONL → generated Markdown mirror.
- `@memory-lane/obsidian-import` — standalone Markdown import parser/planner with no core dependency.
- `@memory-lane/claude-adapter` — Claude Code CLI hook adapter.
- `@memory-lane/codex-adapter` — OpenAI Codex CLI hook adapter.
- `@memory-lane/pi-adapter` — pi extension adapter.

## MCP server semantics

The MCP server is explicit tool access, not lifecycle automation. It exposes `memory_save`, `memory_suggest`, `memory_recall`, `memory_status`, `memory_list`, `memory_review`, `memory_approve`, `memory_reject`, and `memory_delete` over local stdio. It reuses JSONL storage, `MemoryEngine`, and project scope behavior. It does not add MCP resources, prompts, HTTP transport, dedicated Obsidian MCP status tools, or automatic hook behavior. Stdio reserves stdout for JSON-RPC protocol messages, so diagnostics must avoid stdout.

`memory_status` is a read-only MCP status surface backed by `MemoryEngine.doctor()`. It is intended for Claude Desktop, Codex Desktop, and other MCP clients to answer setup/status questions without terminal access. It reports counts/metadata/diagnostics, not raw memory text.

## Project identity semantics

Project identity is resolved in this order:

1. `.memory-lane-scope` walking up from the current directory; its `id` is authoritative.
2. Git identity; normal repos use the repo root, while linked Git worktrees use the common Git directory's main checkout path as the project key.
3. No project scope; saves fall back to global scope with the existing notice behavior.

Important constraints:

- Scope files are never auto-created.
- Existing memories saved under old worktree path keys are not migrated automatically.
- Storage paths, Obsidian behavior, hooks, aliases, glob config, and migration commands were not changed by the worktree-aware scope slice.

## Obsidian mirror semantics

Implemented scope:

- Optional config under `obsidian`, disabled by default.
- CLI commands:
  - `memory-lane obsidian status`
  - `memory-lane obsidian init --vault <path> [--folder "Memory Lane"]`
  - `memory-lane obsidian sync [--dry-run]`
- Mirror files are generated at:

```text
<vault>/<folder>/index.md
<vault>/<folder>/indexes/pending.md
<vault>/<folder>/indexes/approved.md
<vault>/<folder>/indexes/project.md
<vault>/<folder>/indexes/recent.md
<vault>/<folder>/memories/<id>.md
```

- Index files are generated/read-only mirror artifacts, may be overwritten by sync, and are not import notes.
- Index files use standard Markdown links to `memories/<id>.md`.
- Generated memory files include lightweight tags: `memory-lane`, `memory-lane/memory`, and status/category/kind tags.
- Generated index files include lightweight tags: `memory-lane` and `memory-lane/index`.

- JSONL remains the source of truth.
- Mirror includes only active records: `approved` and `pending`.
- Rejected/deleted records remove stale generated files.
- Stale memory deletion is constrained to configured `memories/` and only deletes files with frontmatter:

```yaml
memory_lane_mirror: true
```

- Stale generated-index deletion is constrained to files with both markers:

```yaml
memory_lane_mirror: true
memory_lane_index: true
```

- `MemoryEngine` performs best-effort mirror sync after successful writes/status transitions.
- Mirror failures do not break JSONL writes; warnings are returned/surfaced.
- `obsidian init` and non-dry-run `obsidian sync` create `<vault>/<folder>/imports/` for user-authored import notes.
- `obsidian sync --dry-run` does not create the import folder or write mirror files.
- Hooks do not prompt for or own Obsidian setup.
- `memory-lane doctor` includes cheap Obsidian diagnostics and warnings; it does not repair, sync, or write Obsidian files.

Known accepted mirror limitations:

- Mirror sync currently scans/syncs the full store after mutations; targeted per-record mirroring can be optimized later.
- No per-project index pages beyond the first-slice `indexes/project.md` grouping.
- No Obsidian-backed storage.

## Obsidian import semantics

Import is explicit user-authored Markdown → JSONL. It is not automatic sync, bidirectional sync, or Obsidian-backed storage.

Commands:

```bash
memory-lane obsidian import --dry-run
memory-lane obsidian import --json --dry-run
memory-lane obsidian import
memory-lane obsidian import --json
```

Rules and gotchas:

- Import uses the configured Obsidian mirror location only; first implementation has no `--vault`, `--folder`, or `--path` import overrides.
- Discovery scans only:

```text
<vault>/<folder>/imports/
```

- Discovery is recursive but skips dotfiles, dotfolders, symlinks, and non-`.md` files.
- Import notes must have top-of-file frontmatter with:

```yaml
memory_lane: true
```

- Notes without `memory_lane: true` are ignored.
- Generated mirror files with `memory_lane_mirror: true` are skipped, including generated indexes with `memory_lane_index: true`.
- Markdown body after frontmatter, trimmed, becomes memory text; frontmatter is metadata only.
- Unknown frontmatter fields are ignored.
- Defaults are:

```yaml
category: personal
scope: global
status: pending
```

- `status` may be `pending` or explicit `approved`; `rejected` and `deleted` are invalid for import.
- `scope: project` requires project identity from the command context; otherwise the note is skipped with a warning.
- `memory_lane_id` updates only active (`approved`/`pending`) memories.
- Deleted, rejected, or missing ids are skipped with warnings.
- Updates do not allow approved → pending demotion, scope changes, or project identity changes.
- Duplicate `memory_lane_id` values in the same run skip all conflicting notes.
- Duplicate create body text in the same run skips all conflicting notes.
- Dry-run performs no JSONL writes and no mirror writes.
- Apply is partial-success and non-transactional: valid notes may be written while invalid notes are skipped with warnings.
- Source import notes are read-only inputs: Memory Lane does not rewrite, move, archive, delete, or add generated ids to them.
- Apply uses normal `MemoryEngine.save`/`MemoryEngine.update`, so validation, append-only JSONL, embedding invalidation, and best-effort mirror warnings still apply.

## Key decisions

- Obsidian support is optional and disabled by default.
- Obsidian mirror = JSONL → generated Markdown.
- Obsidian import = explicit user-marked Markdown → JSONL.
- Obsidian-backed storage = future experimental primary Markdown backend.
- JSONL remains the operational source of truth for current Obsidian support.
- Hooks should remain silent and deterministic; do **not** prompt users from hooks to enable Obsidian.
- Preferred onboarding is explicit CLI setup:
  - `memory-lane obsidian init --vault <path>`
- MCP Server MVP and Phase 8 Slice 1/2 follow-ups are implemented, merged, verified, and pushed.
- Claude Desktop support is via the MCP server, not the Claude hook adapter.
- Codex SessionStart baseline injection should wait until after the current Codex Desktop hook soak/testing period.
- pi autosave/tool-outcome capture should wait until after pi read-only recall injection has soaked.

## Important references

- Roadmap: `ROADMAP.md`
- Project vocabulary/context: `CONTEXT.md`
- Obsidian mirror ADR: `docs/adr/0002-obsidian-mirror-before-import-and-backed-storage.md`
- Obsidian import ADR: `docs/adr/0003-controlled-obsidian-import-contract.md`
- Obsidian import contract spec: `docs/superpowers/specs/2026-06-03-obsidian-import-contract.md`
- Obsidian import implementation plan: `docs/superpowers/plans/2026-06-03-obsidian-import-implementation.md`
- Manual testing guide: `docs/manual-testing/obsidian-mirror-import.md`
- Claude Code integration docs: `examples/harness-integrations/claude-code.md`
- Codex integration docs: `examples/harness-integrations/codex-cli.md`
- pi adapter package: `packages/pi-adapter/`
- Memory Lane skill docs: `skills/memory-lane/SKILL.md`
- Worktree-aware scope spec: `docs/superpowers/specs/2026-06-08-worktree-aware-project-scope.md`
- Worktree-aware scope plan: `docs/superpowers/plans/2026-06-08-worktree-aware-project-scope.md`
- MCP Server MVP spec: `docs/superpowers/specs/2026-06-08-mcp-server-mvp.md`
- MCP Server MVP plan: `docs/superpowers/plans/2026-06-08-mcp-server-mvp.md`
- Integration doctor diagnostics spec: `docs/superpowers/specs/2026-06-08-integration-doctor-diagnostics.md`
- Integration doctor diagnostics plan: `docs/superpowers/plans/2026-06-08-integration-doctor-diagnostics.md`
- MCP status tool spec: `docs/superpowers/specs/2026-06-08-mcp-status-tool.md`
- MCP status tool plan: `docs/superpowers/plans/2026-06-08-mcp-status-tool.md`
- MCP client setup docs: `examples/harness-integrations/mcp.md`
- Obsidian mirror package: `packages/obsidian-mirror/`
- Obsidian import package: `packages/obsidian-import/`
- Core engine/config: `packages/core/src/engine.ts`, `packages/core/src/config.ts`
- CLI entrypoint/formatters: `packages/cli/src/index.ts`, `packages/cli/src/formatters.ts`

External comparison references discussed:

- Basic Memory: https://github.com/basicmachines-co/basic-memory
- obsidian-mind: https://github.com/breferrari/obsidian-mind
- User's Obsidian setup summary: `/Users/shiang/Desktop/obsidian_codex_memory_types.md`

## Suggested next steps

1. Continue real-world MCP testing in Claude Desktop Chat and Codex Desktop. This is the next step because the current MCP tool loop is now complete enough to evaluate UX before adding more surfaces.
2. For Codex Desktop MCP setup, use absolute paths only. In the custom MCP form, avoid `~` in Working directory; use `/Users/shiang/Documents/New project` or the exact project repo path. The MCP server command should be `/Users/shiang/.nvm/versions/node/v22.22.3/bin/node` with argument `/Users/shiang/projects/ribbons-digital/memory-lane/packages/mcp-server/dist/index.js`.
3. Watch whether project scope is confusing in MCP clients. Claude Desktop normal Chat has no project cwd, so `projectScope: none` is expected unless the model passes `projectPath`. Codex Desktop working directory may provide a better default project scope if configured with an absolute path.
4. Continue real-world soak/testing of Codex Desktop hook integration before implementing `SessionStart` baseline injection.
5. Continue pi read-only lifecycle recall soak before implementing pi autosave/tool-outcome capture.
6. Use `docs/manual-testing/obsidian-mirror-import.md` for manual end-to-end testing of completed Obsidian mirror/import behavior when needed.
7. Only schedule hardening backlog items from `ROADMAP.md` after explicit user approval or clear real-world user value.

## Suggested skills for future agents

A fresh agent should consider invoking:

- `using-superpowers` — required at conversation start in this environment.
- `writing-plans` — before implementing any roadmap phase.
- `test-driven-development` — for MCP, mirror polish, or import follow-up implementation.
- `systematic-debugging` — if hook/storage/mirror/import behavior is surprising.
- `requesting-code-review` — before merging new feature work.
- `verification-before-completion` — before claiming implementation is complete.
- `using-git-worktrees` — if starting a new feature branch/worktree.
