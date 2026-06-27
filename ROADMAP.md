# Memory Lane Roadmap

This roadmap now centers on a continuity-first sequence:

1. Keep review/status controls strong enough that generated memory stays user-governed.
2. Add read-only freshness detection plus canonical continuity primitives so sessions can notice newer approved state, prefer current workflow/operating-agreement memories, and avoid duplicated stale guidance.
3. Add review-first progress/checkpoint capture for releases, merges, fixes, and decisions.
4. Make global personal preferences consistently available through a bounded preference layer.
5. Add harness-neutral learning features only after review, freshness, checkpoint, and preference foundations are in place.
6. Add deeper time-aware staleness/consolidation so continuity does not become misleading.
7. Validate the completed read-only/review-first stack through real multi-harness dogfooding before adding heavier automation.
8. Graduate to handoff-free sessions only after those safeguards are proven.

Earlier Obsidian, pi, MCP, installer, and plugin phases remain part of the roadmap history below, but new implementation should prioritize this continuity order unless the user explicitly chooses a different maintenance slice.

## Product North Star — Cross-Agent Continuity Without Silent Autonomy

Memory Lane's future roadmap and implementation design should center on becoming local-first, review-governed continuity infrastructure for AI coding agents: a shared project memory/index across Claude Code, Codex, Cursor-style clients, pi, MCP clients, and future harnesses.

The product goal is not another isolated chat-history search box. Memory Lane should make project state, durable preferences, decisions, checkpoints, failures, corrections, and procedures available across sessions and tools without relying on any single vendor's built-in thread memory.

Design implications:

- If the same project is open in multiple sessions or harnesses, important progress from one session should be available to the others without the user manually restating it.
- Users should be able to ask natural-language continuity questions such as “resume building X,” “where was X implemented,” or “what should we work on next,” and Memory Lane should guide inspection of available project memories, session summaries, PRs, and successor/superseded guidance without requiring the user to remember internal terms, branch names, or dates.
- Durable personal preferences should be consistently available across projects and harnesses so workflows stay streamlined and predictable.
- Project continuity should be an intentional index, not a transcript dump: store and surface compact, useful state rather than raw conversations by default.
- The system should remain non-autonomous and low-noise: prefer bounded context injection, freshness checks, and implicit reminders to add/update memories over silent broad autosave.
- New learning features should be review-first by default. They may suggest memories, flag stale continuity, or ask whether to save release/progress/failure/correction/procedure events, but should not silently rewrite the user's memory base.
- Good defaults and minimal setup matter for first-time users; optional configuration should exist for teams and advanced workflows without making the default path heavy.
- Token-aware context policy and review hygiene are prerequisites for broader continuity features because seamlessness must not become context pollution.
- Useful product work should be evidence-led: prefer dogfooding, retrieval metrics, explicit token accounting, and reviewable proposals over adding large invisible automation surfaces.

Each phase lists a focused implementation slice of no more than five todos. If a phase needs more work, add the next slice only after the current slice is complete, keeping the todo order aligned with implementation dependencies.

## Product Learning — agentmemory Comparison

A deep review of `rohitg00/agentmemory` showed useful ideas to adapt without copying its larger surface area. agentmemory's strongest practical lessons are: real retrieval quality work (BM25/vector/graph fusion with metrics), explicit token-budget reporting, robust ingest hygiene at a single boundary, backup/verify integration config writers, and a visible local viewer for debugging memory state. Its risks are also instructive: a very large MCP/tool surface, heavy daemon/runtime dependencies, silent capture tendencies, and many advanced features that are off by default because unrestricted injection and compression can burn context or tokens.

Memory Lane's roadmap should therefore keep its differentiators: JSONL as source of truth, small explicit MCP surface, review-first candidate memories, harness-neutral lifecycle policy, and text-free status/continuity diagnostics. New capabilities inspired by agentmemory should enter as bounded, measurable, reviewable slices: token accounting before token retuning, retrieval evals before retrieval rewrites, consolidation proposals before consolidation apply, and optional viewer/dashboard UX after CLI/MCP surfaces prove useful. Silent auto-consolidation and broad raw transcript/tool-output capture remain out of scope for the default product path.

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
2. Add read-only token-estimation/reporting for recall, continuity, and lifecycle context decisions once dogfooding shows where character budgets lack visibility. Report estimated tokens used, token budget, truncation, and omission reasons without changing injection behavior.
3. Consider token-based budget enforcement or retuning only after token reporting plus dogfooding evidence shows character budgets are insufficient across target harnesses.
4. Update MCP/future-adapter guidance as new harnesses consume the shared context policy.

## Phase 15 — Auto-Memory Review and Memory Dashboard

**Goal:** Give users visibility and control over generated memories before broader continuity automation depends on them.

Session-end summarization (Phase 13), cross-session continuity checks, and future learning features will produce candidate memories. This phase builds the review surface so users can trust the system before Memory Lane becomes more proactive.

Completed Slice 1 scope:

1. Added `memory-lane review --suspect-meta` to list pending memories that match the existing delegated-subagent/task/acceptance-finalization meta-task classifier.
2. Added opt-in `--include-approved` so users can also find approved suspect pollution that may affect recall/context injection.
3. Made suspect-review human output compact and actionable: IDs, status, short previews, and suggested reject/delete commands instead of dumping full memory bodies.
4. Kept cleanup review-first and non-destructive: the command only lists likely operational prompt pollution and tells users to reject/delete after review.
5. Added JSON metadata (`suspectMeta`, `includeApproved`, `projectScope`, count) for authoritative scoped inspection.

Completed review/status UX scope:

1. `memory-lane review` groups pending memories by source, project key, scope, kind, and harness/provenance where available.
2. MCP `memory_review` and `memory_status` include project-scope guidance for clients such as Claude Desktop that do not provide a cwd unless `projectPath` is passed.
3. MCP status clarifies explicit MCP tools vs lifecycle hook automation.

Dashboard and Review Controls:

Completed first dashboard slice:

1. Added `memory-lane dashboard` and `memory-lane dashboard --json` for a compact continuity/review overview scoped to the current project plus global memories by default.
2. Added `memory-lane dashboard --all` for admin-style inspection across all stored scopes.
3. Kept dashboard output privacy-conscious: counts, review queue signals, suggested review commands, and short session-summary previews only; no long memory-body dumps.
4. Added friendly CLI presentation primitives for this dashboard only, without refactoring command parsing or adding interactive prompts.

Completed review-filter slice:

1. Added CLI filters for pending review queues by kind, source, and provenance, e.g. `memory-lane review --kind session_summary --source session-summary --provenance pi/session_end`.
2. Prettified human `memory-lane review` output with the same CLI presentation primitives used by dashboard, while keeping `--json` authoritative and structured.
3. Added matching MCP `memory_review` filters (`kind`, `source`, `provenance`) so desktop MCP clients can inspect pending session summaries and future continuity candidates precisely.
4. Kept review non-destructive: filtered review only narrows inspection and suggests existing approve/reject/delete commands.

Remaining dashboard/review-controls scope:

1. Add safe bulk actions for clearly grouped pending candidates, with dry-run/confirmation semantics and no silent deletes.
2. Add docs for maintaining a healthy review queue and for deciding when to approve, reject, delete, or leave pending candidate memories.
3. Keep this phase focused on visibility/control; do not add new automatic learning behaviors here.

## Phase 16 — Freshness, Canonical Continuity, and Memory Revision

**Status:** Slice 1 complete: read-only freshness/status detection is implemented. Slice 2 complete: read-only canonical workflow/operating-agreement discovery is implemented. Slice 3 complete: CLI-first update/replace/supersede revision primitives are implemented. Slice 4 complete: read-only continuity/status hints for superseded-visible memories, operating-agreement overlaps, project/global overlaps, and newer approved state are implemented. Slice 5 complete: SessionStart lifecycle bounded continuity notices are implemented. Phase 17 review-first progress/checkpoint capture is the next recommended continuity item.

**Goal:** Let any session/harness cheaply notice newer approved project progress, relevant global preferences, and current canonical workflow/operating-agreement memories without injecting large memory bodies or silently saving new state.

This is the first direct implementation step toward seamless continuity. It should answer: “What changed in Memory Lane since this session started?”, “Is there approved state from another session/harness that I should surface?”, and “Which memory should be treated as the current version of a workflow, preference, or project operating agreement?”

The loop-memory refinement failure is the concrete product driver for the extension: when a user asks to refine an existing durable workflow, Memory Lane should make update/supersede the obvious path instead of encouraging another near-duplicate memory.

First-slice decisions:

- Freshness is read-only. It never writes or rewrites memories.
- Canonical/revision features are explicit and append-only: updates or replacements preserve audit history and do not silently delete old memories.
- The first signal is approved memory metadata: `updatedAt`, project scope, source, kind, provenance, and lightweight revision/canonical markers where available.
- The first UX is a bounded notice, not full context injection.
- Global/personal preferences are eligible for a separate preference layer, but this phase should only report that relevant preferences exist unless the context policy selects them.
- Adapters should call shared lifecycle/core helpers; harness-specific code should not implement its own freshness or canonical-selection rules.

Completed Slice 1 scope:

1. Added read-only freshness helper for approved memories visible to the current project plus global scope.
2. Exposed freshness metadata through `memory-lane status --json --since`, `memory-lane doctor --json --since`, and MCP `memory_status({ since })`.
3. Kept freshness output memory-text-free: only counts and metadata such as ids, timestamps, scope, source, kind, and provenance are returned.
4. Kept lifecycle notices, canonical selection, revision/supersede operations, duplicate hints, and memory writes out of this slice.

Extension slices:

1. **Complete — read-only freshness/status detection:** shared helper(s) compare a session start time or checkpoint timestamp against approved visible memories for the current project and global scope; metadata is exposed through `memory-lane status --json --since`, `memory-lane doctor --json --since`, and MCP `memory_status({ since })` without returning memory text by default.
2. **Complete — canonical workflow / operating-agreement memories:** added a read-only operating agreement convention, selector, CLI `memory-lane agreements`, and text-free status/doctor/MCP status metadata for current project/global workflow contracts. Revision/supersede operations are covered by Slice 3.
3. **Complete — update / replace / supersede primitives:** added explicit CLI-first append-only revision operations for same-id updates, new successor replacements, and approved successor supersede relationships, with dry-run/confirmation safety and revision metadata. MCP mutation parity and retrieval filtering remain later work; continuity hints are covered by Slice 4.
4. **Complete — continuity/status hints for stale and overlapping guidance:** dashboard/status/doctor/MCP status flag superseded-visible memories, multiple operating-agreement candidates, project/global preference overlap, and newer approved state without performing silent cleanup.
5. **Complete — lifecycle bounded notices:** SessionStart lifecycle context routes through freshness/operating-agreement/continuity hint helpers to surface compact plain-language notices when newer approved progress, current operating agreements, or continuity hints exist, with project/global scope, context budget, and privacy boundaries tested.

Completed prompt-continuity bridge:

1. Added deterministic prompt-time continuity intents for natural prompts such as “resume building X,” “where was X implemented,” “what were we last working on,” and “what should we work on next.”
2. Kept behavior inspection-first and policy-governed: `off` suppresses guidance, `policy-only` emits guidance without memory bodies, and `selective` can render guidance before normal budgeted recall.
3. Did not add checkpoint capture, writes, cleanup, recall ranking changes, workstream/thread ids, new config flags, or LLM intent classification.

Out of scope for Phase 16:

- Automatic consolidation, background rewriting, or silent deletion.
- Broad learning from chat history.
- Handoff-free automatic injection of large session summaries. Phase 16 should surface signals and canonical operating contracts, not replace review gates.

## Phase 17 — Review-First Progress and Checkpoint Capture

**Status:** Complete for the current continuity sequence. Checkpoint candidate review labels are implemented for CLI review and MCP `memory_review`; the unified continuity contract is implemented across core, `memory-lane continuity`, MCP `memory_continuity`, and lifecycle/docs guidance; and review-first checkpoint capture now queues deduplicated pending `project_checkpoint` candidates from strong lifecycle evidence without adding new commands, tools, config flags, or automatic approval.

**Goal:** Capture high-value continuity events such as releases, merges, major fixes, and roadmap decisions as reviewable checkpoint candidates, so another session can pick up the project state without the user restating it.

This phase makes Memory Lane more proactive while keeping review as the safety boundary. It suggests durable project progress when evidence is strong and lets the user approve before it affects future sessions.

Completed scope:

1. Added conservative checkpoint candidate classification for pending memories that look like releases, merges, verification milestones, docs syncs, roadmap decisions, major fixes, or explicit `project_checkpoint` records.
2. Labeled checkpoint candidates in CLI `memory-lane review`, CLI `review --json`, and MCP `memory_review` with text-free structured metadata.
3. Added the unified continuity contract: core continuity read model, `memory-lane continuity`, MCP `memory_continuity`, and prompt-time/docs guidance that treats continuity as canonical before topic-specific recall.
4. Added review-first checkpoint capture from high-confidence lifecycle evidence, including explicit completed release/merge statements on Stop and successful release/merge shell command evidence on PostToolUse.
5. Added first-slice dedup/debounce for inferred checkpoint candidates against visible pending and approved project checkpoints, so repeated harness events do not queue the same release/PR checkpoint repeatedly.
6. Kept Phase 17 review-first and API-stable: inferred captures are pending by default; approval still determines durable continuity; compact pending-review reminders use existing hook/review surfaces; no new CLI commands, MCP tools, config flags, automatic approval, recall ranking changes, workstream/thread ids, or transcript capture were added.

Future follow-up boundaries:

- Broader evidence classes such as richer verification milestones, docs-sync decisions, or major-fix detection should be designed as deliberate later slices, not broad LLM inference.
- Deeper duplicate consolidation, temporal metadata, and stale/overlap repair belong to Phase 20's time-aware memory/consolidation work.
- Phase 18 should proceed next for global preference layering and context policy before adding wider harness-neutral learning enhancements.

## Phase 18 — Global Preference Layering and Context Policy

**Status:** Slice 1 merged via PR #21: automatic context selection treats preference-like memories as a bounded layer for SessionStart and UserPromptSubmit, adds optional preference budget fields to `memory.contextPolicy`, and documents existing inspection surfaces. The preference diagnostics follow-up is implemented locally on `feature/phase-18-preference-diagnostics`: status/doctor/MCP status expose text-free preference pool and SessionStart cap counts without adding new commands/tools or returning preference bodies.

**Goal:** Make durable personal preferences consistently available across projects and harnesses while preventing preferences from overpowering project-specific state.

This phase addresses the “workflow feels different in each session” problem. Global preferences should be stable and portable, but still bounded by context policy and easy to inspect.

Slice 1 completed scope:

1. Added shared preference-layer selection that separates current-project preferences, current-project content, bounded global preferences, other global memory, and other visible project memory before context rendering.
2. Extended `memory.contextPolicy` with optional `preferenceMaxItems` and `preferenceMaxChars` budgets without breaking existing defaults.
3. Kept prompt-time selection relevance-driven while allowing relevant global preferences within the preference caps.
4. Added cross-harness regression coverage through shared lifecycle tests plus existing Claude Code, Codex, and pi lifecycle-output tests.
5. Documented how to save, inspect, and narrow global preferences safely through existing CLI/MCP surfaces.

Preference diagnostics follow-up scope:

1. Added text-free `preferenceDiagnostics` metadata to existing status/doctor/MCP status surfaces.
2. Reported visible/current-project/global preference counts plus baseline SessionStart selected/omitted preference-cap counts.
3. Kept diagnostics bounded and inspection-only: no new CLI commands, MCP tools, lifecycle behavior changes, prompt-time selected-count claims, automatic preference learning, cleanup, or preference text in status surfaces.

Deferred Phase 18 follow-ups:

1. Improve preference conflict/override inspection beyond conservative project-first ordering and exact normalized duplicate omission.
2. Expand dashboard/review guidance if users need a richer preference influence view after diagnostics lands.

## Phase 19 — Harness-Neutral Learning Enhancements

**Goal:** Adapt useful learning-system ideas from pi-hermes-memory into the continuity north star without making Memory Lane pi-specific or breaking existing memory categories, APIs, review semantics, or storage behavior.

Memory Lane should keep JSONL as the source of truth and keep harness-native artifacts optional exports. Pi, Hermes, Cursor, Codex, Claude Code, and future adapters should feed bounded lifecycle evidence into shared lifecycle handlers rather than owning learning behavior themselves. The first learning slices should help the system notice likely durable failures, corrections, procedures, or preferences and prompt/suggest reviewable memories, not silently auto-approve broad background learning.

**Status:** Phase 19 completion implemented locally on `feature/phase-19-learning-completion`: Memory Lane adds `correction` and `procedure` kinds, detects explicit user workflow/process corrections from bounded Stop context, saves compact pending project-scoped `correction` candidates, and adds conservative recovery-backed pending `procedure` candidates from PostToolUse when a failed shell action and safe successful recovery evidence are both available. Procedure memories use compact text conventions for `When`, `Steps`, `Pitfall`, and `Verify` rather than new schema fields. Candidates deduplicate against existing correction/procedure/workflow-rule memories and surface through existing review and continuity paths. Approved workflow-like corrections/procedures can participate in operating-agreement discovery while explicit `workflow_rule` memories remain preferred. No new CLI commands, MCP tools, LLM classifier, automatic approvals, prompt-time writes, transcript capture, raw tool-output capture, recall-ranking changes, or native skill/rule exports were added.

First-slice decisions:

- Do not expand `MemoryCategory` for learning taxonomy in the first slice; keep existing `preference`, `personal`, and `project` categories stable.
- Add learning semantics primarily through additional `MemoryKind` values. Slice 1 adds only `correction` and `procedure`; broader kinds such as `failure`, `insight`, `tool_quirk`, and `convention` remain deferred.
- Default new automatic learning outputs to `pending` unless the user explicitly asks Memory Lane to remember something.
- Workflow-violation corrections are first-class learning candidates: when a user points out that an agent violated an established project workflow or operating agreement, Memory Lane should suggest a pending correction/procedure memory so future continuity surfaces can reinforce the guardrail.
- Store procedural memory as Memory Lane records first; exporting approved procedures into Pi/Claude/Codex/Cursor/Hermes-native skill/rule formats is a later optional integration layer.
- Keep raw transcripts, raw tool outputs, secrets, and harness-internal markers out of saved memory text.

Todos:

1. Added non-breaking `MemoryKind` values `correction` and `procedure` and updated validation, formatting, Obsidian import handling, MCP schemas, and tests.
2. Added shared correction detection in `@memory-lane/lifecycle` using high-confidence heuristics plus negative patterns; adapters provide recent bounded Stop context, and detected corrections save as pending candidates by default.
3. Added review-first workflow-violation capture for moments like “you forgot our PR-protected workflow”: detected corrections suggest pending `correction` memories and surface through continuity/operating-agreement inspection before future high-risk actions such as merge, release, cleanup, or branch deletion.
4. Added post-tool-use learning beyond current package-manager/test-command heuristics: optional bounded recent tool context can produce pending `procedure` candidates only when a failed action and safe successful recovery evidence are both available.
5. Added structured procedure-memory text conventions (`Procedure`, `When`, `Steps`, `Pitfall`, `Verify`) for `kind: "procedure"` while keeping native skill export out of this phase.
6. Deferred opt-in background learning config and broader lifecycle review plumbing until later token-aware policy and dashboard/review controls justify it; reviews must remain bounded, best-effort, privacy-safe, and harness-neutral.

## Phase 20 — Time-Aware Memory and Consolidation

**Goal:** Prevent memories from going stale, noisy, duplicated, or misleading future sessions.

Time-sensitive statements like “I'm traveling next week” or “the build is broken” become wrong as time passes. Separately, automatic summaries, checkpoint candidates, and learning candidates can create overlap. This phase handles both through reviewable revisions and consolidation proposals rather than silent destructive rewrites.

**Status:** Slice 1 released in `v0.2.15`: optional `freshness` metadata adds `expiresAt`, `staleAfterDays`, and `capturedAt` to memory records/save surfaces with validation and compact rendering. No refresh, consolidation, recall/injection filtering, or cleanup behavior was added in Slice 1. Slice 2 released in `v0.2.16`: repeated session-summary/checkpoint continuity candidates are debounced before writing, and generated session summaries drop obvious Memory Lane review-management chatter without adding destructive consolidation. Slice 3 released in `v0.2.17`: generated session summaries carry advisory `freshness.capturedAt` from existing canonical message timestamps when available; checkpoint timestamps remain deferred because Stop/PostToolUse inputs expose no timestamp. Slice 4 released in `v0.2.18`: existing freshness metadata is classified into read-only advisory status/continuity signals for expired/stale approved visible memories without recall/injection, refresh, consolidation, cleanup, or mutation behavior changes. Slice 5 released in `v0.2.19`: stale/expired freshness advisories include bounded text-free dry-run revision command suggestions through existing status/doctor/MCP status and continuity surfaces, without adding a refresh command or mutation behavior. Slice 6 released in `v0.2.20`: human status/doctor/continuity output renders bounded manual dry-run freshness advisory actions without JSON contract changes or behavior changes.

Todos:

1. Added optional memory freshness metadata with `expiresAt`, `staleAfterDays`, and `capturedAt` fields to memory records and save/suggest APIs.
2. Added duplicate/debounce handling for pending session summaries and checkpoint candidates, especially back-to-back summaries generated from the same session/review flow.
3. Improved session-summary prompt/filtering so summaries avoid self-referential review chatter like “approve memory IDs” unless the user explicitly asks to preserve review decisions.
4. Added time metadata to generated session summaries using trustworthy existing message timestamps; checkpoint timestamps remain deferred until Stop/PostToolUse exposes reliable timestamps.
5. Added read-only freshness advisories that classify explicit freshness metadata as current/stale/expired in status/doctor/MCP status and continuity warnings without behavior changes.
6. Added bounded per-id dry-run revision command suggestions for stale/expired freshness advisories using existing `update`, `replace`, and `supersede` commands; no reject/delete suggestions and no mutation behavior changes.
7. Added bounded human-output polish for freshness advisory actions in `status --since`, `doctor --since`, and `continuity`, keeping output manual/dry-run, text-free, and read-only.
8. Future: add a deliberately scoped `memory-lane refresh` workflow that presents stale entries as pending revisions or deletions only after read-only advisory signals are proven useful.
9. Future: update recall/injection to deprioritize or skip memories that are past their expiration only after explicit user approval and token/reporting evidence shows this reduces context noise.
10. Future: add `memory-lane consolidate --dry-run` and, only later, a confirmation-gated apply path to propose duplicate/overlap merges and replacement memories, preserving append-only auditability. Silent auto-consolidation is out of scope.

## Phase 20.5 — Dogfooding and Exit Validation

**Goal:** Validate that the completed Phase 13-20 stack is useful, low-noise, and safe across real Memory Lane usage before adding refresh workflows, recall/injection filtering, retrieval rewrites, consolidation apply paths, or Phase 21 handoff-free automation.

**Status:** Validation completed in `docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md`. Verdict: **Exit Phase 20**. Existing CLI review/status/dashboard/continuity surfaces were useful and bounded enough to proceed to Phase 21 design. Current evidence does not justify `memory-lane refresh`, recall/injection filtering, consolidation, retrieval rewrites, token retuning, or viewer work as the immediate next slice. Recommended next slice: **Phase 21 Slice 1 — Handoff Mode Contract and Review-Mode Design**.

This phase is a product validation gate, not a feature-expansion phase. It converts the principle "prove safeguards before automation" into explicit evidence: review queue health, continuity usefulness, freshness-advisory usefulness, and context-policy behavior across Claude Code, Codex, pi, and MCP clients where practical.

First validation slice scope:

1. Dogfood existing surfaces only: `memory-lane review`, `memory-lane dashboard`, `memory-lane continuity`, `memory-lane status --since`, `memory-lane doctor --since`, MCP `memory_review`, MCP `memory_status`, MCP `memory_continuity`, and existing session-summary/correction/procedure/checkpoint capture paths.
2. Record evidence without adding new schema or behavior: candidate counts by kind/source/provenance, false positives, duplicate/noisy candidates, freshness-advisory usefulness, continuity answer quality, and context-policy selected/omitted counts.
3. Decide whether Phase 20 exits, or whether exactly one evidence-backed follow-up is needed before Phase 21.
4. Use findings to prioritize later code slices: token-accounting reporting, retrieval-eval foundation, refresh dry-run, consolidation proposals, onboarding hardening, or viewer/dashboard improvements.
5. Keep validation text-free where it reports memory content: record ids, counts, categories, commands run, and qualitative findings without dumping private memory bodies.

Out of scope for Phase 20.5:

- New commands, MCP tools, config flags, schema fields, or lifecycle behavior.
- `memory-lane refresh`, recall/injection filtering, token-budget retuning, retrieval rewrites, embeddings/RRF changes, consolidation apply paths, or Phase 21 automatic mode.
- Raw transcript/tool-output capture or any silent approval/cleanup.

## Phase 21 — Handoff-Free Sessions

**Status:** Complete. Phase 21 is released through `v0.2.37` (`6d234c3`) and declared complete after fresh-thread dogfood showed improved context-window usage for broad project-status/next-work prompts. Slice 7/8/9 context-hygiene validation and installed-artifact dogfood passed. PR #67 (`78ea89e`) completed the docs/skill context-hygiene follow-up: `HANDOFF.md` is compact, old chronology is archived, Phase 21 roadmap status is compressed, and the Memory Lane skill now points broad project-status/next-work prompts to bounded continuity-first inspection. PR #68 (`5707c6c`) completed deferred item 4 continuity selection/ranking hygiene; design spec: `docs/superpowers/specs/2026-06-27-phase-21-item-4-continuity-selection-hygiene-design.md`. It keeps generic broad next/status queries from producing stale workstream candidates, classifies release/checkpoint project facts as progress instead of operating guidance, and preserves topic-specific workstream discovery. Release workflow `28275316878` passed for `v0.2.37`, and installed-artifact dogfood after `memory-lane upgrade --yes` passed.

**Evidence and references:**

- Full pre-compaction handoff chronology: `docs/superpowers/archive/2026-06-26-pre-docs-hygiene-handoff.md`
- Post-v0.2.35 memory cleanup / exit validation: `docs/superpowers/validation/2026-06-26-phase-21-post-v0.2.35-memory-cleanup-exit-validation.md`
- Slice 7 summary hygiene design: `docs/superpowers/specs/2026-06-26-phase-21-slice-7-summary-hygiene-design.md`
- Slice 8 context-pollution hardening design: `docs/superpowers/specs/2026-06-26-phase-21-slice-8-context-pollution-hardening-design.md`
- Slice 9 broad continuity injection hygiene design: `docs/superpowers/specs/2026-06-26-phase-21-slice-9-broad-continuity-injection-hygiene-design.md`

**Completed slices, compressed:**

1. `memory.handoffMode` contract and diagnostics are implemented with `manual`, `review`, and `automatic`; `manual` remains the default inspection-first mode.
2. Review-mode handoff proposals are read-only and assembled from existing pending continuity candidates; they do not generate, approve, or inject new records.
3. Cross-session freshness baseline markers allow SessionStart to notice newer approved state without writing memories or injecting handoff bodies.
4. Automatic-mode SessionStart handoff selection is approved-only, project-scoped, budget-neutral, text-free in policy-only mode, and subordinate to `memory.contextPolicy`.
5. Natural-language workstream discovery is available on existing continuity surfaces (`memory-lane continuity --query`, MCP `memory_continuity({ query })`) without persisted workstream IDs, raw transcript search, retrieval rewrites, lifecycle injection, or mutation behavior.
6. Pi continuity parity and generated bridge hardening shipped through `v0.2.30`; installed Pi dogfood confirmed broad continuity routing and explicit continuity access.
7. Summary hygiene suppresses operational-only generated session summaries and exposes read-only review hints without schema expansion, cleanup mutation, recall ranking changes, lifecycle injection, or workstream IDs.
8. Context-pollution hardening suppresses low-signal greetings, caps generated Pi bridge automatic recall context, and preserves meaningful technical recall plus explicit recall/get fidelity.
9. Broad continuity injection hygiene makes Claude/Codex project-position/next-work prompts inject continuity guidance without ordinary recall bodies while preserving topic-specific recall.

**Completed docs/skill hygiene follow-up (PR #67):**

- `HANDOFF.md` is a current-state document; old chronology is archived at `docs/superpowers/archive/2026-06-26-pre-docs-hygiene-handoff.md`.
- This Phase 21 roadmap section stays compact and links to specs/validation/archive instead of carrying release-by-release prose inline.
- `skills/memory-lane/SKILL.md` directs broad project-status/next-work prompts to continuity-first compact inspection, keeps text-free status guidance on JSON/status surfaces, and uses the canonical Opus 4.8 Claude CLI form rather than subagents.

**Item 4 non-goals:** no retrieval rewrite, embeddings/RRF, schema changes, memory mutation/cleanup, lifecycle injection changes, generated adapter changes, token budget retuning, or persisted workstream IDs.

**Goal:** Enable seamless cross-session and cross-harness continuity for users who have validated their memory pipeline.

This phase turns Phase 13–20 into a cohesive experience: the agent starts a new session aware of where things left off, can surface newer progress recorded by another session/harness, can help the user find or resume relevant prior work by natural language, and can consistently apply global personal preferences without a manual `HANDOFF.md`, while still respecting token-aware context budgets and review controls.

For this roadmap, a workstream is the user-meaningful unit of ongoing work across one or more manual threads, harness sessions, orchestrator threads, subagent runs, branches, PRs, and session summaries. Memory Lane should index durable outcomes and pointers for the workstream, not preserve every operational message inside it.

## Future Track — Retrieval Quality, Continuity Typing, and Evaluation

Before adding retrieval features inspired by larger memory systems, Memory Lane should establish an eval-first track. The first slice should define a small reproducible corpus from real dogfooded Memory Lane records and labeled continuity/recall queries, then report recall@k, precision@k, and failure cases for current lexical/semantic search. Only after that should Memory Lane consider RRF-style fusion, session diversification, reranking, graph expansion, or new embedding defaults. JSONL remains the source of truth; any embeddings or retrieval indexes remain rebuildable optional indexes.

Dogfooding evidence from the v0.2.30 Pi Slice D run adds a concrete continuity-ranking/typing case: the installed Pi bridge correctly routed “What were we last working on?” to `memory_continuity` and recovered by checking git, but the read model's `latestApproved.project` selected a newly approved workflow correction about GitHub PR body formatting (`c78cdc00`) ahead of more useful release/checkpoint memories. The eval-first slice is specified in `docs/superpowers/specs/2026-06-25-continuity-typing-ranking-eval-design.md`, with implementation plan `docs/superpowers/plans/2026-06-25-continuity-typing-ranking-eval.md`. The implementation now adds deterministic core continuity role classification and separates the public read model additively: `latestProgress` carries progress/checkpoint/session-summary-style continuity, bounded `operatingGuidance` carries corrections/procedures/workflow guidance, and legacy `latestApproved.project` remains unchanged for compatibility. The slice stays read-only and avoids recall ranking, lifecycle injection, auto-approval, raw transcript capture, and harness-specific ranking rules; fixtures cover the `c78cdc00` vs release/checkpoint case and topic-specific workstream discovery still returning corrections.

The parked analysis in `MEMORY_AS_TOOL_REVIEW.md` compares Memory Lane with the paper “Distilling Feedback into Memory-as-a-Tool” and the Write → Consolidate → Recall → Apply loop. It should inform future work, but not interrupt the current continuity/release path. The most plausible later slice is review-first consolidation proposals: deterministic, text-bounded hints that identify overlapping or superseded correction/procedure/workflow memories and suggest manual dry-run `update`/`replace`/`supersede` actions. Keep this future work review-first and harness-neutral: no auto-consolidation, no auto-approval, no raw transcript indexing, no LLM classifier in the first slice, and no recall-ranking changes.

Future learning should also become outcome-informed without becoming silent self-training. Approval, rejection, deletion, rescope, replace, and supersede decisions should leave reviewable signals that help future suggesters make better scope/category/kind decisions — for example, learning that one-off command instructions should not become global preferences, or that prompt dumps should be compacted into outcomes. Those signals should steer LLM judgment and bounded heuristics, not silently mutate durable policy or auto-approve future memories.

## Deferred improvements

These items are intentionally not in the numbered phases above. Add them only after the corresponding phase is complete and real-world usage justifies the work.

- **Multi-session narrative compression.** Combine many session summaries into a higher-level project chronicle.
- **Cross-project memory inheritance.** Allow memories to be marked reusable across projects (e.g., coding style preferences).
- **Automatic preference learning.** Infer implicit preferences from chat history beyond explicit saves and session summaries.
