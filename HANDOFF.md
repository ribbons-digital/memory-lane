# Memory Lane Handoff

## Recent changes (since this handoff was last updated)

- Production installer shipped: `install.sh` / `install.ps1` download a prebuilt Bun-compiled binary from GitHub Releases, place it on PATH, and prompt the user to run `memory-lane init`.
- `memory-lane init` is an interactive wizard that detects and configures Claude Code CLI, Codex CLI, Claude Desktop, Codex Desktop, and pi.
- `memory-lane init --yes` auto-configures all detected harnesses non-interactively.
- `memory-lane uninstall` removes the binary and integration configs while preserving memory data by default.
- Slash command / skill support: `memory-lane init` installs a personal skill at `~/.claude/skills/memory-lane/SKILL.md` (invoked as `/memory-lane` in Claude Code CLI) and `~/.agents/skills/memory-lane/SKILL.md` (invoked as `$memory-lane` in Codex CLI/Desktop/app).
- `memory-lane upgrade` downloads the latest release binary and re-applies only the harness configs that were previously installed.
- pi lifecycle autosave and tool capture: `input`, `turn_end`, and `tool_result` events now write memories through shared `@memory-lane/lifecycle` handlers, with per-turn duplicate suppression and privacy-safe debug logging.
- Plugin system implemented and released in `v0.2.1`: Phase 9 (Obsidian LLM Wiki / Knowledge Base Integration) ships as the first opt-in plugin via a lightweight plugin API. First-party plugins are bundled into the standalone binary but remain inactive unless added to `~/.memory-lane/config.json`. Phase 12 is planned for binary-friendly plugin installation and management (`memory-lane plugin install/list/enable/disable/uninstall`).
- v0.2.1 includes bundled plugin fixes so first-party plugins actually work in the standalone binary, plus config error handling and cross-platform vault paths for the Obsidian Wiki plugin.
- Strategic review concluded: Memory Lane is practical for short explicit agent preferences and project facts, but not yet for long-running project continuity because it lacks automatic session synthesis, token-aware context policy, review controls, and staleness handling.
- Roadmap extended beyond Phase 13 with a revised order: Phase 14 token-aware context policy, Phase 15 review/dashboard, Phase 16 harness-neutral learning enhancements, Phase 17 time-aware memory/consolidation, and Phase 18 handoff-free sessions. New automation remains opt-in/review-first by default.
- pi-hermes-memory research was folded into the roadmap as inspiration, not a feature copy. Relevant ideas: failure/correction learning, procedure memories, background learning, auto-consolidation, and policy-only/token-aware context. Memory Lane's adaptation should stay harness-neutral for future Hermes, Cursor, and other adapters, with JSONL as source of truth and native skill/rule exports as optional later integrations.
- Cross-harness pending-memory review surfaced product issues now reflected in `ROADMAP.md`: MCP review/list is confusing when Claude Desktop has `projectScope: none`; review output needs grouping by project/source/kind/provenance; `memory_status` should explain MCP explicit tools vs hook lifecycle automation more clearly; pending session summaries need duplicate/debounce handling and should avoid self-referential review chatter such as "approve these memory IDs".
- Installer hardening was added to the roadmap: avoid breaking published entrypoints/config paths, ensure `memory-lane upgrade` preserves/reapplies existing harness configs, fix Claude Desktop MCP config detection/writing to `claude_desktop_config.json`, and replace the limited sequential yes/no init wizard with clearer menu-driven or flag-based integration selection.
- Current hardening slice implemented and committed: MCP server `dist/index.js` direct execution is backward-compatible again; `memory-lane init` detects/writes Claude Desktop MCP at `claude_desktop_config.json`; init now has a numbered selectable wizard plus `--list`, `--only`, `--all`, and `--recommended` flags, while `--yes` keeps recommended/detected behavior.
- Upgrade compatibility hardening added: manifest-driven reapply logic is now covered by tests, deduplicates configured harnesses, migrates old Claude Desktop manifest paths by writing the supported `claude_desktop_config.json`, preserves unrelated MCP config fields, and skips unknown/stale harness IDs without aborting valid reconfiguration.
- Memory review pollution fix added: pending `memory_suggest` saves now skip raw delegated-subagent task wrapper prompts and acceptance-finalization prompts at the core storage boundary, while lifecycle autosave uses the same shared meta-task filter.
- Review/status UX improved: `memory-lane review` now groups pending memories by project scope, source, kind, and provenance; MCP `memory_review` keeps `data.memories` but adds structured `groups` and scope notes; MCP `memory_status` now explains `projectScope: none` and recommends passing `projectPath` from clients such as Claude Desktop.
- Session-end summarization design spec is at `docs/superpowers/specs/2026-06-16-session-end-summarization-design.md`. It requires user confirmation before generating a summary and saves summaries as pending memories for review.
- Phase 13 Session-End Summarization is implemented through the explicit pi session-summary command on branch `docs/pi-session-summary-command`. Implemented and verified: core data model/config, lifecycle LLM provider, `handleSessionEnd`, manual `memory-lane session-end --confirm` CLI command, docs, full build/test, manual mock-provider smoke, supported Codex `Stop` explicit-intent automation, Claude Code `memory-lane claude session-end`, and pi `/memory session-summary`. Correction: current Codex CLI docs do not expose a supported `SessionEnd` hook event; the Codex-shaped session-end adapter path is future-compatible/manual-test only. Follow-up supported-hook design is documented at `docs/superpowers/specs/2026-06-16-supported-session-summary-hooks.md`.
- To upgrade manually, re-run the installer and then `memory-lane init --yes`.

## Current state

Phase 13 Session-End Summarization manual flow is merged to `main`. The former feature worktree `~/.config/superpowers/worktrees/memory-lane/session-end-summarization` has been removed after merge.

Codex Phase 2 SessionStart baseline injection has been merged to `main`, verified in Codex Desktop, and pushed. The Phase 7 MCP Server MVP and Phase 8 Slice 1/2 follow-ups were already merged, verified, pushed, and their feature worktrees/branches removed. The older autosave meta-prompt filter worktree still exists under `~/.config/superpowers/worktrees/memory-lane/autosave-meta-prompt-filter`.

Recent completed work:

- Phase 1 Codex hook integration is implemented and merged.
- Codex hook adapter Phase 2 SessionStart baseline injection is implemented, reviewed, verified, merged, and pushed:
  - added `memory-lane codex session-start` and `memory-lane claude session-start`;
  - added `SessionStart` payload parsing and Codex/Claude-compatible `hookSpecificOutput` with `hookEventName: "SessionStart"`;
  - added `handleSessionStart` and strict baseline memory selection in `@memory-lane/lifecycle`;
  - baseline injection selects a small recent approved/project-visible memory set and skips secrets/duplicates;
  - docs now include the Codex and Claude Code `SessionStart` hook configuration;
  - Codex Desktop verification confirmed `event: "session-start"`, `status: "ok"`, and `additionalContext: true`.
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
- Phase 13 Session-End Summarization manual flow is implemented and merged:
  - added `session_summary` memory kind, `session-summary` source, and `session_end` provenance event;
  - added `memory.sessionEndSummary` config defaults/validation;
  - added an OpenAI-compatible chat provider and `handleSessionEnd` lifecycle handler;
  - summaries are pending memories, tool messages are excluded by default, and likely secret lines are redacted before LLM input;
  - added manual `memory-lane session-end --confirm` CLI command and docs;
  - added a future-compatible Codex-shaped `SessionEnd` payload parser/runner path with disabled/missing-provider no-op handling, confirmation gating, confirmed save path, and raw-transcript non-persistence tests.
  - added supported Codex `Stop` explicit-intent automation: prompts like "remember this session" or "summarize this session to memory" trigger a bounded-transcript summary when `memory.sessionEndSummary` is enabled and provider-configured, while ordinary `Stop` autosave remains unchanged.
  - added Claude Code `SessionEnd` adapter support through `memory-lane claude session-end`; it remains opt-in and confirmation-gated unless `memory.sessionEndSummary.requireConfirmation` is explicitly set to `false`, and confirmed summaries save as pending `session_summary` memories with Claude provenance.
  - real-world smoked Claude Code `SessionEnd` in Sitewright using isolated temp storage; debug logs showed `adapter: "claude"`, `event: "session-end"`, `cwd: "/Users/shiang/projects/ribbons-digital/sitewright"`, `status: "ok"`, and `saved: 1`; the saved memory was pending with `source: "session-summary"`, `kind: "session_summary"`, and Claude `session_end` provenance.
  - added pi explicit session-summary command `/memory session-summary`; it uses `ctx.sessionManager.getBranch()` plus `ctx.ui.confirm`, saves pending `session_summary` memories with pi `session_end` provenance, and deliberately does not add automatic `agent_end`, `session_shutdown`, or compaction summarization.
  - Important correction: current Codex CLI hooks do not expose a supported `SessionEnd` event, so `.codex/hooks.json` must not include `SessionEnd`; any future pi automation beyond the explicit command needs a separate supported-event design.

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

Codex SessionStart verification on the feature branch passed:

```bash
pnpm build
pnpm test
```

Manual SessionStart smoke with a temp memory store returned a JSON hook output whose `hookSpecificOutput.hookEventName` was `"SessionStart"` and whose `additionalContext` contained `## Relevant Memory`.

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
- `@memory-lane/plugin-api` — lightweight plugin API for MCP tools/resources and CLI commands.
- `@memory-lane/plugin-obsidian-wiki` — first-party plugin for Obsidian/Garden knowledge-base access.

## MCP server semantics

The MCP server is explicit tool access, not lifecycle automation. It exposes `memory_save`, `memory_suggest`, `memory_recall`, `memory_status`, `memory_list`, `memory_review`, `memory_approve`, `memory_reject`, and `memory_delete` over local stdio. It reuses JSONL storage, `MemoryEngine`, and project scope behavior. It does not add MCP resources, prompts, HTTP transport, dedicated Obsidian MCP status tools, or automatic hook behavior. Stdio reserves stdout for JSON-RPC protocol messages, so diagnostics must avoid stdout.

`memory_status` is a read-only MCP status surface backed by `MemoryEngine.doctor()`. It is intended for Claude Desktop, Codex Desktop, and other MCP clients to answer setup/status questions without terminal access. It reports counts/metadata/diagnostics, not raw memory text.

## Codex and Claude Code hook semantics

Codex and Claude Code CLI hook support now includes:

```bash
memory-lane codex session-start
memory-lane codex user-prompt-submit
memory-lane codex stop
memory-lane codex post-tool-use

memory-lane claude session-start
memory-lane claude user-prompt-submit
memory-lane claude stop
memory-lane claude post-tool-use
memory-lane claude session-end
```

`SessionStart` is read-only baseline injection for new sessions. It uses `handleSessionStart` in `@memory-lane/lifecycle`, selects a small set of recent approved memories visible to the current project scope, and enforces a stricter budget than prompt-specific `UserPromptSubmit` recall. It skips likely secrets, deduplicates normalized memory text, and emits `hookSpecificOutput.additionalContext` with `hookEventName: "SessionStart"`.

Claude Code's documented `SessionEnd` hook can run `memory-lane claude session-end` to generate pending session summaries when `memory.sessionEndSummary.enabled` and provider settings are configured. By default, the Claude adapter still requires confirmation and will not save from a bare hook unless `memory.sessionEndSummary.requireConfirmation` is set to `false` or a manual/test payload includes `confirmed: true`.

`SessionStart` does not save memories, create session scope, dump full project history, replace prompt-specific `UserPromptSubmit` recall, or change `Stop`/`PostToolUse` autosave behavior.

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
- MCP/Codex hook soak/testing has concluded enough to proceed with Codex Phase 2.
- Codex SessionStart baseline injection is implemented as a small read-only session-opening context block, not lifecycle automation for writes.
- pi autosave/tool-outcome capture remains the next automatic-write candidate if the user wants Phase 6 next.

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
- Codex SessionStart plan: `docs/superpowers/plans/2026-06-15-codex-session-start-baseline.md`
- Codex SessionStart lifecycle code: `packages/lifecycle/src/handlers.ts`, `packages/lifecycle/src/injection.ts`
- Codex SessionStart adapter/CLI code: `packages/codex-adapter/src/payloads.ts`, `packages/codex-adapter/src/runner.ts`, `packages/codex-adapter/src/outputs.ts`, `packages/cli/src/index.ts`
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
- Plugin system design spec: `docs/superpowers/specs/2026-06-15-plugin-system-design.md`
- Plugin system implementation plan: `docs/superpowers/plans/2026-06-15-plugin-system.md`
- Plugin installation/development docs: `docs/plugins/README.md`
- Session-end summarization design spec: `docs/superpowers/specs/2026-06-16-session-end-summarization-design.md`
- Obsidian mirror package: `packages/obsidian-mirror/`
- Obsidian import package: `packages/obsidian-import/`
- Plugin API package: `packages/plugin-api/`
- Obsidian Wiki plugin package: `packages/plugin-obsidian-wiki/`
- Core engine/config: `packages/core/src/engine.ts`, `packages/core/src/config.ts`
- CLI entrypoint/formatters: `packages/cli/src/index.ts`, `packages/cli/src/formatters.ts`

External comparison references discussed:

- Basic Memory: https://github.com/basicmachines-co/basic-memory
- obsidian-mind: https://github.com/breferrari/obsidian-mind
- pi-hermes-memory package/docs: https://pi.dev/packages/pi-hermes-memory
- pi-hermes-memory source: https://github.com/chandra447/pi-hermes-memory
- User's Obsidian setup summary: `/Users/shiang/Desktop/obsidian_codex_memory_types.md`

## Suggested next steps

1. Finish/review the current installer/MCP hardening slice: check the working-tree diff, verify `memory-lane upgrade` behavior against an install manifest, then commit/release so v0.2.2 users get the Claude Desktop/MCP/init fixes.
2. Then improve review/status UX before broader automation: group pending memories by project/source/kind/provenance, make MCP `projectScope: none` behavior obvious, clarify MCP-vs-hooks boundaries in `memory_status`, and add guidance for passing `projectPath` from MCP clients.
3. Continue evaluating Codex `Stop` explicit-intent summaries, pi `/memory session-summary`, and `memory-lane session-end --confirm` with the user's preferred local/remote OpenAI-compatible model, then approve only useful pending summaries.
4. Treat Phase 14 token-aware context policy as the next prerequisite before broader automatic learning. The user's priority is avoiding context pollution/explosion across all harnesses, not copying pi-hermes-memory exactly.
5. Keep future learning enhancements harness-neutral. Core/lifecycle should own selection, token budgeting, correction/failure/procedure candidate extraction, and consolidation proposals; adapters for pi, Codex, Claude Code, Cursor, Hermes, etc. should only supply bounded lifecycle evidence and render shared outputs.
6. Do not add automatic pi `agent_end`, `session_shutdown`, or compaction summarization without a separate supported-event design and explicit approval.
7. For Codex Desktop MCP setup, continue using absolute paths only. In the custom MCP form, avoid `~`; use `/Users/shiang/Documents/New project` or the exact project repo path. The MCP server command should be `/Users/shiang/.nvm/versions/node/v22.22.3/bin/node` with argument `/Users/shiang/projects/ribbons-digital/memory-lane/packages/mcp-server/dist/index.js`.
8. Use `docs/manual-testing/obsidian-mirror-import.md` for manual end-to-end testing of completed Obsidian mirror/import behavior when needed.
9. Only schedule hardening backlog items or deferred improvements from `ROADMAP.md` after explicit user approval or clear real-world user value.

## Suggested skills for future agents

A fresh agent should consider invoking:

- `using-superpowers` — required at conversation start in this environment.
- `writing-plans` — before implementing any roadmap phase.
- `test-driven-development` — for MCP, mirror polish, or import follow-up implementation.
- `systematic-debugging` — if hook/storage/mirror/import behavior is surprising.
- `requesting-code-review` — before merging new feature work.
- `verification-before-completion` — before claiming implementation is complete.
- `using-git-worktrees` — if starting a new feature branch/worktree.
