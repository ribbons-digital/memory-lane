# Memory Lane Roadmap

This roadmap focuses on five upcoming directions:

1. Obsidian mirror/import support
2. pi adapter lifecycle support
3. MCP server support
4. Obsidian LLM Wiki / knowledge-base access
5. Experimental Obsidian-backed storage

The ordering is intentional: mirror/import gives users Obsidian value with low risk; pi lifecycle recall improves the current harness without adding automatic writes; MCP is broadly useful and should not depend on Obsidian; Obsidian LLM Wiki features should build on MCP/resource access while staying distinct from Memory Lane memories; true Obsidian-backed storage comes last because it changes Memory Lane's core reliability model.

Each phase lists a focused implementation slice of no more than five todos. If a phase needs more work, add the next slice only after the current slice is complete, keeping the todo order aligned with implementation dependencies.

## Production Installer

**Status:** Complete and merged.

**Goal:** Make Memory Lane installable and configurable by first-time users without building from source.

Completed scope:
1. Bun `--compile` produces standalone binaries for macOS (arm64/x64), Linux (arm64/x64), and Windows (x64).
2. `install.sh` and `install.ps1` download binaries from GitHub Releases, verify checksums, place them on PATH, and prompt the user to run `memory-lane init`.
3. `memory-lane init` is an interactive first-run wizard; `memory-lane init --yes` auto-configures detected harnesses.
4. `memory-lane uninstall` removes configs and the binary while preserving memory data by default.
5. `memory-lane upgrade` downloads the latest binary and re-applies only the harness configs that were previously installed.
6. Skills for slash command access: `~/.claude/skills/memory-lane/SKILL.md` (Claude Code CLI `/memory-lane`) and `~/.agents/skills/memory-lane/SKILL.md` (Codex `$memory-lane`).

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

These items do **not** reopen completed phases and should not start the next roadmap phase by themselves. Treat them as small hardening tasks to schedule only after explicit user approval.

1. **Installer and upgrade compatibility hardening**
   - Preserve backward compatibility for any published integration entrypoints/config paths; do not move MCP/hook entrypoints without keeping old paths working or migrating configs.
   - Ensure `memory-lane upgrade` reapplies previously configured harnesses successfully and does not break existing Claude Desktop MCP, Codex Desktop MCP, Claude Code hooks, Codex hooks, or pi extension setups.
   - Fix/replace the current sequential yes/no init wizard with a clearer menu-driven flow: show all supported integrations, distinguish detected vs not detected, allow explicit selection, and provide non-interactive flags for specific integrations such as Claude Desktop MCP.
   - Detect/write Claude Desktop MCP config at the correct `claude_desktop_config.json` path and keep tests covering that path.

2. **Obsidian import dry-run secret warnings**
   - Current apply path uses normal `MemoryEngine.save`/`MemoryEngine.update` validation, so likely secrets are skipped at apply time.
   - Improve dry-run so secret-containing import notes are warned/skipped before apply, either by passing a secret-detection callback into the import planner or extracting secret detection into a small shared utility.

3. **Import snapshot type cleanup**
   - `ExistingImportMemory` includes optional fields that the planner currently does not read and the CLI snapshot mapper does not populate.
   - Either trim the type to fields actually used by the planner or populate the fields consistently for future maintainability.

Completed hardening follow-ups:

1. **Historical JSONL compatibility and diagnostics**
   - Historical memory rows that predate newer `source` and `scope` fields now load with safe defaults instead of disappearing from list/review/recall output.
   - `memory-lane doctor` now reports memory JSONL row counts and warns when malformed or schema-invalid rows were skipped, without exposing memory text.
   - Release target: `v0.2.9`.

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

## Phase 5 — pi Lifecycle Recall Injection

**Status:** Complete and merged.

**Goal:** Give pi/pi-mono sessions read-only lifecycle recall using pi's documented extension events and the shared `@memory-lane/lifecycle` policy, without adding automatic memory writes yet.

Completed scope:

1. Added focused spec and plan for pi read-only lifecycle recall based on pi's `before_agent_start` event.
2. Added `@memory-lane/lifecycle` to `@memory-lane/pi-adapter` and calls `handleUserPromptSubmit` for user prompts.
3. Injects recalled context through pi hidden custom messages, keeping output low-noise and deterministic.
4. Preserved existing pi commands/tools (`memory_save`, `memory_suggest`, `memory_recall`, `/memory ...`) without behavior regressions.
5. Documented pi support boundaries: read-only lifecycle recall is supported; pi autosave and tool-outcome capture are deferred.

## Project Scope Hardening — Worktree-Aware Project Identity

**Status:** Complete and merged.

**Goal:** Prevent project-memory fragmentation when users work in linked Git worktrees for the same repository, while preserving `.memory-lane-scope` as the explicit override.

Completed scope:

1. Added tests proving linked Git worktrees resolve to the same Memory Lane project key as the main/common checkout.
2. Updated `resolveProjectScope` to derive Git identity from `git rev-parse --git-common-dir` after checking `.memory-lane-scope`.
3. Preserved normal Git repo behavior, non-Git `null` behavior, and the existing `ProjectScope` shape.
4. Documented worktree-aware scoping, scope-file override behavior, and the fact that old fragmented worktree-path memories are not migrated automatically.
5. Kept storage paths, Obsidian behavior, hook behavior, migration, alias, and glob config out of scope.

## Codex / Claude Code Hook Adapter — Phase 2 SessionStart Baseline Injection

**Status:** Complete and merged.

**Goal:** Add strict budgeted `SessionStart` baseline injection for Codex and Claude Code CLI so a new session starts with a small set of recent, approved, project-visible memories without dumping project history.

Completed scope:

1. Added `handleSessionStart` in `@memory-lane/lifecycle`, backed by a smaller baseline budget than prompt-specific recall.
2. Added deterministic baseline selection over approved visible memories with recency ordering, project-scope tie-breaking, duplicate removal, secret filtering, and truncation within budget.
3. Added Codex and Claude `SessionStart` payload parsing, `memory-lane codex session-start`, `memory-lane claude session-start`, and Codex/Claude-compatible `hookSpecificOutput` with `hookEventName: "SessionStart"`.
4. Added lifecycle, Codex adapter, Claude adapter, and CLI tests plus a SessionStart fixture.
5. Updated Codex and Claude Code integration docs and README with the `SessionStart` hook configuration.
6. Verified end-to-end in Codex Desktop; debug logs confirm `event: "session-start"`, `status: "ok"`, and `additionalContext: true`.

The next high-value implementation phase is **Phase 13 Session-End Summarization**. Phase 6 pi lifecycle autosave/tool capture remains a candidate if the user wants automatic pi writes next, but Phase 13 has higher strategic value for cross-session continuity.

## Phase 6 — pi Lifecycle Autosave and Tool Capture

**Status:** Complete and merged.

**Goal:** After pi recall injection has soaked, add automatic pi memory writes through the same shared lifecycle policy used by Codex and Claude Code.

Completed scope:

1. Reassessed pi event semantics: `input` is now explicit-memory-request only to avoid noisy prompt-submit autosaves, while `turn_end` handles stop-candidate extraction over the last user/assistant messages and `tool_result` handles shell workflow capture.
2. Refactored pi autosave to use shared `handleStop` / `extractStopCandidates`, including reviewer/subagent/task meta-prompt filtering and checkpoint-save handling.
3. Added pi tool-outcome capture from `tool_result` using shared `handlePostToolUse`, with per-turn duplicate suppression.
4. Added privacy-safe pi debug logging to `~/.memory-lane/pi-debug.jsonl` when `MEMORY_LANE_DEBUG=1`; never logs raw prompts or tool outputs.
5. Updated README and `skills/memory-lane/SKILL.md` to document automatic pi lifecycle writes and debug inspection.

## Phase 7 — MCP Server MVP

**Status:** Complete and merged.

**Goal:** Expose Memory Lane through MCP without changing the storage model.

Completed scope:

1. Added `@memory-lane/mcp-server` package with the `memory-lane-mcp` bin.
2. Exposed stdio MCP tools: `memory_save`, `memory_suggest`, `memory_recall`, `memory_list`, and `memory_review`.
3. Reused existing `MemoryEngine`, project scope, validation, and retrieval logic.
4. Added local stdio setup docs for Claude Desktop, Cursor, Claude Code, and Codex boundaries.
5. Kept MCP resources, prompts, HTTP transport, hook/MCP coordination diagnostics, and Obsidian status out of scope for Phase 8 or later.

## Phase 8 — MCP + Hooks Coordination

**Status:** Slice 1 and Slice 2 complete: read-only integration diagnostics in `memory-lane doctor`, and read-only MCP `memory_status` tool.

**Goal:** Make MCP and lifecycle hooks complement each other cleanly.

Completed scope:

1. Documented the division of responsibility in doctor/docs:
   - hooks = automatic recall/save lifecycle
   - MCP = explicit model/tool access
2. Added read-only doctor diagnostics for common local Memory Lane integration config files, including Claude Desktop MCP, Codex hooks, Claude Code hooks, and the pi extension.
3. Added read-only MCP `memory_status` tool for counts, config paths, project scope, semantic status, and integration diagnostics through MCP clients.

Todos:

1. Add MCP resources for memory status/config if real MCP client usage shows resources are useful beyond the `memory_status` tool.
2. Expand project-aware MCP behavior beyond existing per-tool `projectPath` overrides if needed.
3. Add optional Obsidian mirror status through MCP beyond existing doctor/status fields if users need a dedicated MCP surface.
4. Add deeper diagnostics for duplicate or conflicting hook + MCP setups if real-world testing shows confusion beyond basic setup detection.


## Phase 9 — Obsidian LLM Wiki / Knowledge Base Integration

**Status:** Complete and merged. Shipped as the first Memory Lane plugin in `v0.2.1`: `@memory-lane/plugin-obsidian-wiki`.

**Goal:** Let LLM clients search and read selected Obsidian/Garden notes as source-backed knowledge without turning those notes into Memory Lane memories automatically.

This is separate from Obsidian mirror/import:

- Memory Lane memories remain compact JSONL records for durable agent preferences, facts, and checkpoints.
- Obsidian LLM Wiki notes remain user-authored source documents in the vault/Garden.
- Answers should be grounded in source notes with citations or file references.
- Promotion from a wiki note/fact into Memory Lane should be explicit, not automatic.

The feature ships as an opt-in plugin rather than a built-in capability:

- Core Memory Lane stays lean for users who do not need Obsidian knowledge-base access.
- The plugin exercises the new lightweight plugin system before it is used for other optional features.

Completed scope:

1. Defined the lightweight plugin API (`@memory-lane/plugin-api`) with MCP tool/resource and CLI command registration.
2. Added `plugins` and `pluginConfig` to `MemoryLaneConfig` in `@memory-lane/core`.
3. Loaded plugins in the CLI and MCP server and registered their contributions alongside built-in features.
4. Implemented `@memory-lane/plugin-obsidian-wiki` with MCP tools (`obsidian_wiki_search`, `obsidian_wiki_read`), an MCP resource (`memory-lane://obsidian-wiki/notes`), and a CLI status command.
5. Bundled first-party plugins into the standalone binary via a static registry in `packages/cli/src/plugins.ts`; bundled plugins remain inactive unless enabled in config.
6. Documented plugin installation, configuration, privacy boundaries, ignored folders, and how this differs from mirror/import and Obsidian-backed storage.

Phase 12 will add explicit `memory-lane plugin install/list/enable/disable/uninstall` commands for users of the standalone binary.

## Phase 10 — Obsidian-Backed Storage Prototype

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

## Phase 11 — Obsidian-Backed Storage Hardening

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

## Phase 12 — Plugin Installation and Management

**Goal:** Make plugins installable and manageable for users of the standalone binary, not just source builds.

The Phase 9 plugin system lets users activate plugins by name in `~/.memory-lane/config.json`, but the standalone Bun-compiled binary cannot resolve npm packages at runtime. Phase 12 closes that gap with explicit, user-initiated plugin management while keeping security boundaries clear.

Todos:

1. **Default plugin directory.** Support `~/.memory-lane/plugins/` as a convention and resolve plugin names like `"my-plugin.js"` against that directory before falling back to dynamic import.
2. **`memory-lane plugin install`.** Add a CLI command that downloads a plugin `.js` file or npm tarball into `~/.memory-lane/plugins/` and validates that it exports the required default function.
3. **`memory-lane plugin` subcommands.** Add `list`, `enable`, `disable`, and `uninstall` commands so users can manage plugins without hand-editing `config.json`.
4. **Bundled first-party plugins.** Continue expanding the static registry in `packages/cli/src/plugins.ts` for official plugins that ship with the binary, so common features work out of the box after being enabled in config.

## Phase 13 — Session-End Summarization

**Status:** In progress. Slice 1 implements the shared data model, opt-in config, LLM summarization handler, and manual `memory-lane session-end --confirm` command. Slice 2 adds supported Codex automation through `Stop` only when the latest user message explicitly requests a session summary. Slice 3 adds Claude Code automation through Claude's documented `SessionEnd` hook and has been real-world smoked in Claude Code CLI. Slice 4 adds an explicit pi `/memory session-summary` command using pi's documented command, session manager, and UI APIs. A Codex-shaped `session-end` adapter path exists for tests/future compatibility, but current Codex CLI hooks do not expose a supported `SessionEnd` event. Automatic pi `agent_end`, `session_shutdown`, and compaction summarization remain out of scope.

**Goal:** Let Memory Lane optionally capture a structured summary at the end of an agent session so the next session can start with project state instead of from scratch.

This phase is the foundation for replacing manual `HANDOFF.md` notes. It is **opt-in and disabled by default** because it sends session content to an LLM for summarization and may produce imperfect memories.

Completed Slice 1 scope:

1. Added `memory.sessionEndSummary` config section with `enabled: false`, OpenAI-compatible provider settings, `promptTemplate`, `maxTokens`, `requireConfirmation`, and `includeToolOutputs`.
2. Added `session_summary` memory kind, `session-summary` source, and `session_end` lifecycle provenance event.
3. Added an OpenAI-compatible chat provider and `handleSessionEnd` lifecycle handler in `@memory-lane/lifecycle`.
4. Added secret-line redaction, default tool-output exclusion, `NO_DURABLE_MEMORY` handling, and pending session-summary candidate creation.
5. Added manual `memory-lane session-end --confirm` CLI support for stdin transcript JSON.
6. Added a future-compatible Codex-shaped `SessionEnd` payload parser/runner path with disabled/missing-provider no-op behavior, confirmation gating, confirmed save path, and tests that raw transcript content is not persisted. Current Codex releases do not expose a real `SessionEnd` hook, so this is not user-facing hook support yet.
7. Added tests for config validation, LLM provider behavior, session-end handler behavior, CLI gating, and the future-compatible Codex-shaped path.
8. Documented the feature, the opt-in requirement, privacy boundaries, review/approval workflow, and current Codex `SessionEnd` hook limitation.

Completed Slice 2 scope:

1. Added Codex `Stop` explicit session-summary intent detection for the latest user message only.
2. Kept ordinary `Stop` autosave behavior unchanged when no explicit summary intent is present.
3. Reused bounded transcript reading to build session-summary input without storing raw transcripts.
4. Treated the explicit user request as confirmation for this supported-hook path, saved provider summaries as pending `session_summary` memories with Codex provenance, and added disabled/missing-provider no-save feedback.
5. Added Codex adapter tests for no-intent preservation, assistant-text non-triggering, disabled and missing-provider no-save paths, provider save, and raw transcript marker non-persistence.

Completed Slice 3 scope:

1. Added Claude Code `SessionEnd` adapter support through `memory-lane claude session-end`.
2. Kept summarization opt-in and confirmation-gated unless `requireConfirmation: false` is explicitly configured.
3. Saved confirmed summaries as pending `session_summary` memories with Claude provenance.
4. Added parser, runner, CLI, privacy, and docs tests for the Claude path.
5. Real-world smoked Claude Code `SessionEnd` in Sitewright with isolated temp storage: debug logs showed `adapter: "claude"`, `event: "session-end"`, `cwd: "/Users/shiang/projects/ribbons-digital/sitewright"`, `status: "ok"`, and `saved: 1`; the generated memory was pending with `source: "session-summary"`, `kind: "session_summary"`, and Claude `session_end` provenance.

Completed Slice 4 scope:

1. Added explicit pi `/memory session-summary` command using pi's documented command, session manager, and UI APIs.
2. Kept pi summarization interactive and confirmation-gated; no automatic `agent_end`, `session_shutdown`, or compaction summarization was added.
3. Reused `handleSessionEnd` and existing `memory.sessionEndSummary` config/provider behavior.
4. Saved generated summaries as pending `session_summary` memories with pi `session_end` provenance.
5. Added tests for disabled config, missing provider, empty branch, cancellation, confirmed save, and raw branch sentinel non-persistence.

Remaining follow-up scope:

1. Manually smoke Codex `Stop` explicit-intent summaries, pi `/memory session-summary`, and `memory-lane session-end --confirm` with the user's preferred provider, then evaluate summary quality before adding broader automation.
2. Consider a stricter structured `SessionSummary` schema if real summaries need machine-readable subsections beyond the Markdown pending-memory format.

## Phase 14 — Token-Aware Context Policy

**Status:** Slice 1 complete: shared context policy config, guarded context rendering, and policy-only/off/selective lifecycle routing are implemented. Slice 2 complete: lifecycle results and Claude/Codex hook debug logs include privacy-safe context decision metadata. Slice 3 complete: doctor/status surfaces report active context policy config. Richer kind prioritization remains follow-up work.

**Goal:** Prevent Memory Lane from polluting or exploding context windows across all harnesses before adding broader automatic learning.

This phase is inspired by pi-hermes-memory's policy-only mode, but Memory Lane's implementation must remain harness-neutral. Core should decide what to inject, how much to inject, and when to fall back to "search memory if needed" guidance; adapters should only translate that shared policy into Codex, Claude Code, pi, Cursor, Hermes, or future harness surfaces.

Completed Slice 1 scope:

1. Added shared `memory.contextPolicy` config with non-breaking defaults: `mode: "selective"`, per-event `maxItems`, per-event `maxChars`, `includePending: false`, and `fallbackToSearch: true`.
2. Added shared lifecycle context rendering that emits guarded `<memory-context>` blocks for selected memory bodies instead of loose `## Relevant Memory` injection.
3. Added `policy-only` mode, which injects compact guidance to use Memory Lane recall/list tools without including memory bodies.
4. Added `off` mode, which disables automatic context injection while preserving explicit CLI/MCP tools and save hooks.
5. Routed Codex, Claude Code, and pi lifecycle prompt/session-start injection through the shared policy layer and updated tests/docs.

Completed Slice 2 scope:

1. Added `contextDecision` metadata to lifecycle results for prompt and session-start injection decisions.
2. Captured policy mode, event, max item/character budget, selected count, omitted count, and omitted reason categories without including memory text.
3. Added safe context decision fields to hook debug JSONL records for Claude and Codex when `MEMORY_LANE_HOOK_DEBUG=1`.
4. Kept hook debug logs privacy-safe: no raw prompts, transcripts, tool outputs, memory text, or injected context text.

Completed Slice 3 scope:

1. Added active context policy config fields to `MemoryEngine.doctor()` and therefore CLI `memory-lane doctor`, `memory-lane status --json`, and MCP `memory_status`.
2. Reported policy mode, prompt/session-start item budgets, prompt/session-start character budgets, pending-memory inclusion, and fallback-to-search behavior.
3. Kept doctor/status read-only and memory-text-free.

Remaining follow-up scope:

1. Add kind preference/deprioritization once real usage shows which memory kinds should be favored or suppressed per lifecycle event.
2. Consider token-estimation rather than character budgets only if character budgets prove insufficient across target harnesses.
3. Update MCP/future-adapter guidance as new harnesses consume the shared context policy.

## Phase 15 — Auto-Memory Review and Memory Dashboard

**Goal:** Give users visibility and control over automatically generated memories before they affect future sessions.

Session-end summarization (Phase 13) and future learning features will produce candidate memories. This phase builds the review surface so users can trust the system before broader automation is enabled.

Completed Slice 1 scope:

1. Added `memory-lane review --suspect-meta` to list pending memories that match the existing delegated-subagent/task/acceptance-finalization meta-task classifier.
2. Added opt-in `--include-approved` so users can also find approved suspect pollution that may affect recall/context injection.
3. Made suspect-review human output compact and actionable: IDs, status, short previews, and suggested reject/delete commands instead of dumping full memory bodies.
4. Kept cleanup review-first and non-destructive: the command only lists likely operational prompt pollution and tells users to reject/delete after review.
5. Added JSON metadata (`suspectMeta`, `includeApproved`, `projectScope`, count) for authoritative scoped inspection.

Todos:

1. Extend `memory-lane review` to group pending memories by source, project key, scope, kind, and harness/provenance where available (e.g., `session-summary`, `agent-suggested`, `user-suggested`, future `background-learning`). Initial grouped review is implemented; continue refining as new memory kinds/sources arrive.
2. Make MCP review/list output less confusing when `projectScope: none`: show project ownership inline, explain that Claude Desktop MCP has no cwd unless `projectPath` is passed, and offer/projectPath guidance instead of implying the current chat's project was used.
3. Add a memory dashboard command: `memory-lane memory dashboard` (or `memory-lane dashboard`) that prints a human-readable summary of what Memory Lane knows per project and globally without dumping long memory bodies by default.
4. Add MCP/CLI tools to list, inspect, and bulk-approve/reject pending session summaries and future learning candidates.
5. Add a "dismiss stale" helper that flags or removes session summaries that no longer match current project state.
6. Document how to use the review queue and dashboard to keep memory accurate, including the boundary that MCP provides explicit tools while hooks provide lifecycle automation.

## Phase 16 — Harness-Neutral Learning Enhancements

**Goal:** Adapt useful learning-system ideas from pi-hermes-memory without making Memory Lane pi-specific or breaking existing memory categories, APIs, review semantics, or storage behavior.

Memory Lane should keep JSONL as the source of truth and keep harness-native artifacts optional exports. Pi, Hermes, Cursor, Codex, Claude Code, and future adapters should feed bounded lifecycle evidence into shared lifecycle handlers rather than owning learning behavior themselves.

First-slice decisions:

- Do not expand `MemoryCategory` for learning taxonomy in the first slice; keep existing `preference`, `personal`, and `project` categories stable.
- Add learning semantics primarily through additional `MemoryKind` values such as `failure`, `correction`, `insight`, `tool_quirk`, `convention`, and `procedure`.
- Default new automatic learning outputs to `pending` unless the user explicitly asks Memory Lane to remember something.
- Store procedural memory as Memory Lane records first; exporting approved procedures into Pi/Claude/Codex/Cursor/Hermes-native skill/rule formats is a later optional integration layer.
- Keep raw transcripts, raw tool outputs, secrets, and harness-internal markers out of saved memory text.

Todos:

1. Add non-breaking `MemoryKind` values for learning taxonomy and update validation, formatting, docs, Obsidian mirror/import handling, MCP schemas, and tests.
2. Add shared correction detection in `@memory-lane/lifecycle` using high-confidence heuristics plus negative patterns; adapters provide recent bounded turn context, and detected corrections save as pending candidates by default.
3. Expand post-tool-use learning beyond current package-manager/test-command heuristics to capture conservative failure/tool-quirk candidates when a failed action and safe recovery evidence are both available.
4. Add structured procedure-memory support (`kind: "procedure"`) with fields or conventions for when-to-use, steps, pitfalls, and verification, while keeping native skill export out of the first slice.
5. Add opt-in background learning config and lifecycle review plumbing only after token-aware policy and dashboard/review controls are in place; reviews must be bounded, best-effort, privacy-safe, and harness-neutral.

## Phase 17 — Time-Aware Memory and Consolidation

**Goal:** Prevent memories from going stale, noisy, duplicated, or misleading future sessions.

Time-sensitive statements like "I'm traveling next week" or "the build is broken" become wrong as time passes. Separately, automatic summaries and learning candidates can create overlap. This phase handles both through reviewable revisions and consolidation proposals rather than silent destructive rewrites.

Todos:

1. Add optional `expiresAt` and `staleAfterDays` fields to memory records and the save/suggest APIs.
2. Add a `memory-lane refresh` command that scans approved memories, uses an LLM or heuristics to identify stale entries, and presents them as pending revisions or deletions.
3. Update recall/injection to deprioritize or skip memories that are past their expiration.
4. Add time metadata to session summaries so later refreshes can reason about temporal context.
5. Add `memory-lane consolidate --dry-run` and `memory-lane consolidate --apply` to propose duplicate/overlap merges and replacement memories, preserving append-only auditability.
6. Add duplicate/debounce handling for pending session summaries, especially back-to-back summaries generated from the same session/review flow.
7. Improve session-summary prompt/filtering so summaries avoid self-referential review chatter like "approve memory IDs" unless the user explicitly asks to preserve review decisions.

## Phase 18 — Handoff-Free Sessions

**Goal:** Enable fully automatic cross-session continuity for users who have validated their memory pipeline.

This phase turns Phase 13–17 into a cohesive experience: the agent starts a new session already aware of where things left off, without a manual `HANDOFF.md`, while still respecting token-aware context budgets.

Todos:

1. Add a `memory.handoffMode` config flag with values `manual`, `review`, and `automatic`. Default to `manual` so users opt in explicitly.
2. In `manual` mode, do nothing new; users keep writing handoffs.
3. In `review` mode, session summaries are generated and saved as pending; users must approve them before the next session uses them.
4. In `automatic` mode, approved session summaries are eligible for budgeted injection at the next `SessionStart` alongside baseline memories.
5. Add a confidence threshold: low-confidence summaries stay pending even in automatic mode.
6. Add safeguards so users can disable handoff-free mode per project or globally.
7. Update docs to explain the three modes, risks of automatic mode, token-budget behavior, and how to switch back to manual.

## Deferred improvements

These items are intentionally not in the numbered phases above. Add them only after the corresponding phase is complete and real-world usage justifies the work.

- **Multi-session narrative compression.** Combine many session summaries into a higher-level project chronicle.
- **Cross-project memory inheritance.** Allow memories to be marked reusable across projects (e.g., coding style preferences).
- **Automatic preference learning.** Infer implicit preferences from chat history beyond explicit saves and session summaries.
