# Memory Lane Handoff

## Recent changes (since this handoff was last updated)

- Phase 21 Slice 6 workstream discovery design is drafted on `docs/phase-21-workstream-discovery-design`: `docs/superpowers/specs/2026-06-22-phase-21-workstream-discovery-design.md` proposes a read-only, query-specific `workstreamDiscovery` section on existing continuity surfaces (`memory-lane continuity --query`, MCP `memory_continuity({ query })`). The first implementation slice should use approved project-visible session summaries/checkpoints/project facts/decisions as bounded pointers with provenance, revision pointers, and derived PR/branch/commit/release references. It deliberately defers first-class workstream ids/schema, raw transcript indexing, retrieval rewrites, LLM classifiers, lifecycle injection, new command/tool families, auto-approval/mutation, and broader automation. User approval is still required before implementation begins.

- Phase 21 Slice 5b automatic-mode validation is complete on `docs/phase-21-automatic-mode-validation`: `docs/superpowers/validation/2026-06-22-phase-21-slice-5b-automatic-mode-validation.md` validates Slice 5a automatic SessionStart handoff behavior with isolated temp storage, shared lifecycle handlers, real CLI status/doctor and Codex/Claude `SessionStart` entrypoints, and MCP package `memory_status`. Verdict: **Proceed to workstream discovery design/spec**. Automatic mode stayed approved-only, project-scoped, SessionStart-only, budget-neutral, text-free on diagnostics/policy-only surfaces, and non-mutating. No behavior code changed. Live desktop MCP/Claude/Codex/pi clients were not exercised, so future live-client dogfooding remains useful but not blocking.

- Before Slice 5b validation, Memory Lane-scoped pending continuity was curated: 16 Memory Lane Phase 18–20 merge/release project facts/checkpoints were approved, while 4 Sitewright-scoped pending items were left untouched. `v0.2.21` was released from main commit `b6d323e` after PR #37; release workflow `27954672321` succeeded and published https://github.com/ribbons-digital/memory-lane/releases/tag/v0.2.21. Local pre-release verification passed with `pnpm build`, `pnpm test`, `git diff --check`, and clean `git status --short --branch`.

- Phase 21 Slice 5a automatic handoff layer is implemented on `docs/phase-21-automatic-mode-design`: `memory.handoffMode: "automatic"` is now behavior-active only for approved, budget-neutral `SessionStart` handoff selection when `memory.contextPolicy.mode` is not `off`. In `selective`, the latest approved current-project `session_summary` or `project_checkpoint` handoff pointer is prioritized inside the existing SessionStart item/char budget and rendered under `Latest approved handoff`; expired/superseded handoff pointers are omitted. In `policy-only`, Memory Lane emits text-free guidance that an approved handoff pointer is available, with no memory bodies. Doctor/status/MCP status expose text-free static `automaticHandoffDiagnostics`; lifecycle `contextDecision.automaticHandoff` reports event-specific selected/omitted counts. No pending injection, automatic approval/reject/delete/cleanup, new CLI/MCP tools, raw transcript/tool-output capture, recall/retrieval rewrite, token retuning, or budget expansion was added.

- Phase 21 Slice 4 handoff/continuity validation is complete on `docs/phase-21-validation`: `docs/superpowers/validation/2026-06-22-phase-21-slice-4-handoff-continuity-validation.md` validates review-mode handoff proposals and cross-session continuity baseline behavior with isolated temp storage, real CLI entrypoints, lifecycle handlers, and MCP package handlers. Verdict: **Proceed to automatic-mode design**. No behavior code changed; no real/default memory storage was mutated. Live desktop MCP/Claude/Codex/pi clients were not exercised, so the next step should be automatic-mode design/spec, not direct implementation.

- Phase 21 Slice 3 cross-session freshness baseline marker is implemented via PR #35: SessionStart now reads a text-free per-project advisory marker at `continuity-baselines.json` next to the memory JSONL file before generating existing newer-approved continuity notices, then best-effort writes the current baseline after result construction for `policy-only`/`selective` modes. The marker stores only project scope keys and timestamps, is safe to delete, and is exposed through text-free `continuityBaseline` diagnostics in doctor/status/MCP status. `contextPolicy.mode: "off"` injects nothing and does not write the marker. No memory JSONL writes, approvals/rejections/deletions, cleanup/consolidation/refresh, new CLI/MCP tools, config flags, adapter payloads, transcript/tool-output capture, recall/retrieval/token changes, handoff body injection, or automatic-mode activation were added.

- Phase 21 Slice 2 review-mode handoff proposals are implemented on `feature/phase-21-review-mode-proposals`: `memory.handoffMode: "review"` is behavior-active only for read-only bounded `handoffProposal` blocks on existing continuity surfaces (`memory-lane continuity`, `memory-lane continuity --json`, and MCP `memory_continuity`). Proposals are assembled from existing pending project-scoped continuity candidates, reuse bounded preview/secret filtering, suggest only existing review/approve commands, and do not write, approve, reject, delete, clean up, generate new summaries, alter lifecycle injection, add CLI/MCP surfaces, capture raw transcripts/tool output, retune retrieval/tokens, or activate `automatic` mode.

- Phase 21 Slice 1 handoff-mode contract is implemented on `feature/phase-21-handoff-mode-contract`: `memory.handoffMode` is typed/defaulted/validated with `manual`, `review`, and `automatic`; `manual` remains the inspection-first mode; `review` has since gained read-only proposal behavior in Slice 2; `automatic` remains declared but inactive. `MemoryEngine.doctor()`, CLI doctor/status JSON, human doctor output, and MCP `memory_status` expose text-free handoff-mode diagnostics. No lifecycle behavior, CLI commands, MCP tools, adapter payloads, raw transcript capture, silent writes, refresh/consolidation, recall filtering, or token retuning were added.

- Phase 20.5 dogfooding/exit validation completed in `docs/superpowers/validation/2026-06-22-phase-20-5-dogfooding-exit-validation.md`. Verdict: **Exit Phase 20**. CLI review/status/dashboard/continuity surfaces were useful and bounded enough to proceed to Phase 21 design. Current evidence does not justify `memory-lane refresh`, recall/injection filtering, consolidation, retrieval rewrites, token retuning, or viewer work as the immediate next slice. Recommended next slice: **Phase 21 Slice 1 — Handoff Mode Contract and Review-Mode Design**. MCP/lifecycle live calls were not exercised in this validation session because no live MCP client or harness event was available; CLI diagnostics showed Claude Desktop MCP configured, user-level Codex hooks configured, pi extension detected, and user-level Claude Code hooks not configured in this checkout.
- agentmemory comparison roadmap update: after inspecting `rohitg00/agentmemory` and consulting Opus 4.8, `ROADMAP.md` now captures the practical lessons to adapt without copying agentmemory's sprawl. The new guidance prioritizes explicit token accounting/reporting, eval-first retrieval improvements, review-first consolidation proposals, procedural memories as Memory Lane records before native skill export, adapter backup/verify onboarding hardening, and optional viewer/dashboard UX only after CLI/MCP surfaces prove useful. The roadmap also adds Phase 20.5 as a dogfooding/exit-validation gate before Phase 21 or any refresh/filtering/consolidation work.
- PR #30 was merged and released in `v0.2.20`: Phase 20 Slice 6 human `status --since`, `doctor --since`, and `continuity` output now render bounded `Freshness advisory actions (manual dry-run)` blocks sourced from existing stale/expired freshness advisory metadata. Output remains text-free and read-only, avoids duplicate generic continuity action lines including omitted bounded actions, bounds human actions, and points to JSON for full ids. This slice intentionally adds no `memory-lane refresh` command, no reject/delete suggestions, no mutation behavior, no recall/injection filtering, no JSON contract changes, no cleanup/consolidation, and no lifecycle payload expansion.
- Phase 20 Slice 5 was merged via PR #29 and released in `v0.2.19`: stale/expired freshness advisories now include bounded, text-free per-id dry-run revision suggestions through existing status/doctor/MCP status and continuity surfaces. Stale memories suggest `memory-lane update <id> --text <updated-memory-text> --dry-run`; expired memories suggest dry-run `update`, `replace`, and `supersede`. This slice intentionally adds no `memory-lane refresh` command, no reject/delete suggestions, no mutation behavior, no recall/injection filtering, no cleanup/consolidation, and no lifecycle payload expansion.
- Phase 20 Slice 4 was merged via PR #28 and released in `v0.2.18`: existing `freshness` metadata is classified into read-only advisory status/continuity signals (`current`, `stale`, `expired`, `none`) for approved visible memories. Status/doctor/MCP status and continuity read models now surface text-free expired/stale counts and ids, with a `freshness-advisory` continuity hint/warning. This slice intentionally adds no refresh, consolidation, recall/injection filtering, automatic cleanup/deletion, LLM stale classification, adapter payload expansion, or mutation behavior.
- Phase 20 Slice 3 was merged via PR #27 and released in `v0.2.17`: generated session summaries carry advisory `freshness.capturedAt` from existing canonical message timestamps when available, and CLI/Claude/Codex/pi save paths pass that metadata through. Checkpoint timestamps remain deferred because Stop/PostToolUse inputs expose no timestamp.
- Phase 20 Slice 2 was merged via PR #26 and released in `v0.2.16`: Memory Lane now deterministically debounces repeated pending session summaries/checkpoint candidates before writing, removes obvious Memory Lane review-management instructions from generated summaries while preserving durable review-related outcomes, and passes adapter identity through Claude/Codex/pi session-end paths.
- Phase 20 Slice 1 was merged via PR #25 and released in `v0.2.15`: Memory Lane records and save/suggest surfaces support optional advisory `freshness` metadata (`expiresAt`, `staleAfterDays`, `capturedAt`) with strict validation, CLI/MCP inputs, and compact human list/review labels. This slice intentionally did not add refresh, consolidation, recall/injection filtering, automatic cleanup, LLM stale classification, or lifecycle auto-population.
- Phase 19 completed and was released in `v0.2.14`: Memory Lane supports `correction` and `procedure` memory kinds, detects explicit user workflow/process corrections from bounded Stop context, saves compact pending project-scoped `correction` candidates, and adds recovery-backed pending `procedure` candidates from bounded PostToolUse history when a failed shell action is followed by safe successful recovery evidence. Procedure text uses compact `Procedure`/`When`/`Steps`/`Pitfall`/`Verify` conventions without new schema fields. Candidates deduplicate against existing correction/procedure/workflow-rule memories and surface through existing review and continuity paths.
- Phase 18 preference diagnostics follow-up was merged via PR #22 and released in `v0.2.12`: core `preferenceDiagnostics` metadata reports visible/current-project/global preference counts and baseline SessionStart selected/omitted preference-cap counts; `MemoryEngine.doctor()`, CLI `status`/`doctor`, and MCP `memory_status` expose the diagnostics without preference bodies, ids, previews, new CLI commands, new MCP tools, or lifecycle behavior changes.
- Phase 18 Slice 1 global preference layering was merged via PR #21: shared lifecycle context selection separates current-project preferences/content from bounded global preferences for SessionStart and UserPromptSubmit, `memory.contextPolicy` supports optional `preferenceMaxItems` and `preferenceMaxChars`, and README/CONTEXT/ROADMAP document project-specific narrowing and existing inspection surfaces. Existing Claude Code, Codex, and pi lifecycle-output tests include small grouped-context assertions. No new CLI commands, MCP tools/schema surfaces, automatic approvals, preference learning, rescope/delete/supersede behavior, or rich status/doctor/MCP selected/omitted preference diagnostics were added in Slice 1; diagnostics are covered by the current follow-up branch.
- Branch `feature/phase-17-checkpoint-capture` completed Phase 17 review-first checkpoint capture: shared lifecycle code queues compact pending `project_checkpoint` candidates from strong Stop/PostToolUse evidence such as completed release statements, successful release commands, and merged PR commands; first-slice dedup/debounce skips repeated pending/approved project checkpoints; Claude/Codex hook output emits existing compact pending-review reminders, while pi uses the same shared lifecycle capture policy and its current pi UI lifecycle-save notifications. Existing CLI/MCP review and continuity surfaces expose pending candidates. No new CLI commands, MCP tools, config flags, automatic approvals, recall ranking changes, workstream/thread ids, or transcript capture were added. Verification for the docs/finalization slice passed with `pnpm build`, `pnpm test`, and `git diff --check`. Next recommended roadmap item: Phase 18 global preference layering/context policy.
- Phase 17 Slice 1 checkpoint candidate review labeling is complete: pending memories that look like releases, merges, verification milestones, docs syncs, roadmap decisions, major fixes, or explicit `project_checkpoint` records are labeled in CLI review and MCP `memory_review` with text-free metadata. The later Phase 17 checkpoint-capture slice now adds pending-by-default capture and first dedup/debounce while preserving review approval as the continuity boundary.
- Prompt-time continuity intents complete: natural prompts like “resume building X,” “where was X implemented,” “what were we last working on,” and “what should we work on next” now trigger bounded Memory Lane inspection guidance under existing context policy. Topic-specific prompts can use targeted budgeted recall. No checkpoint capture, memory writes, cleanup, recall ranking changes, workstream/thread ids, new config flags, or LLM classifier were added in that slice; Phase 17 checkpoint capture has since been completed.
- Phase 16 Slice 5 complete: added bounded SessionStart continuity notices governed by existing contextPolicy modes. Notices are plain-language, inspection-first, share the SessionStart budget, and report text-free metadata in contextDecision.continuity. No UserPromptSubmit notices, new config flags, lifecycle writes, recall filtering, cleanup, workstream ids, memory text/ids in notice text, or MCP mutation tools were added in that slice; Phase 17 checkpoint capture has since been completed.
- Phase 16 Slice 4 complete: added read-only continuity hints across core, CLI dashboard/status/doctor, and MCP `memory_status`. Hints are text-free metadata for superseded-visible memories, operating-agreement overlaps, project/global overlaps, and newer approved state. No lifecycle notices, recall filtering, automatic cleanup, workstream ids, or MCP mutation tools were added. Next recommended slice: Phase 16 Slice 5 lifecycle bounded notices.
- Phase 16 Slice 3 memory revision primitives are implemented: CLI `update`, `replace`, and `supersede` provide append-only same-id updates and explicit successor relationships with dry-run/`--yes` safety and revision metadata. Superseded memories remain approved and are not hidden from recall/context/agreements yet. No MCP mutation tools, lifecycle injection changes, history command, compaction changes, or automatic cleanup were added. The continuity/status hint follow-up is now complete in Slice 4.
- Phase 16 Slice 2 operating agreement discovery is implemented: approved workflow-like memories can now be selected as primary/related operating agreements by workflow area, `memory-lane agreements` explicitly returns selected agreement text, and status/doctor/MCP status expose text-free agreement metadata. In that slice, no lifecycle injection, automatic cleanup, revision fields, or MCP full-text agreement tool were added; revision primitives are covered by Slice 3.
- Phase 16 Slice 1 read-only freshness/status detection is implemented: core freshness metadata helper, CLI `status`/`doctor --json --since`, and MCP `memory_status({ since })` now report approved visible-memory changes since a checkpoint timestamp without returning memory text.
- Historical JSONL hardening is implemented and verified: commit `d0c7620` normalizes older memory rows that predate newer `source`/`scope` fields so they no longer disappear from list/review/recall, and commit `06c3cb3` adds `memory-lane doctor` row diagnostics for malformed/schema-invalid memory JSONL without exposing memory text.
- `v0.2.8` was released in a parallel session; the next release from this handoff/doc-sync slice is `v0.2.9`.
- Product north star clarified and saved as approved memories `344a3af2` and `0bb1eaf3`: Memory Lane should become local-first, review-governed cross-agent continuity infrastructure: a shared project memory/index across Claude Code, Codex, Cursor-style clients, pi, MCP clients, and future harnesses. It should make project state, durable preferences, decisions, checkpoints, failures, corrections, and procedures available across sessions/tools without relying on vendor chat-history search, while staying non-autonomous through bounded context, freshness checks, explicit review controls, privacy-conscious storage, good defaults, and optional advanced configuration.
- Phase 14 Token-Aware Context Policy is complete through Slice 3. See `ROADMAP.md#phase-14--token-aware-context-policy` for the detailed slice breakdown.
- Slice 1 commit `537b441` added shared context policy injection modes (`selective`, `policy-only`, `off`) with guarded context rendering across Claude/Codex/pi lifecycle injection.
- Slice 2 commit `1e02a5b` added privacy-safe context decision metadata to lifecycle results and Claude/Codex hook debug logs without logging raw prompts, transcripts, tool output, memory text, or injected context.
- Slice 3 commit `24baa90` exposes active context policy config through `MemoryEngine.doctor()`, CLI `memory-lane doctor`, CLI `memory-lane status --json`, and MCP `memory_status`, with readable CLI human output and memory-text-free tests.
- Full verification for Slice 3 passed with `pnpm test && pnpm build`.
- Phase 15 Review Hygiene Slice 1 is implemented and verified locally: `memory-lane review --suspect-meta` lists likely old delegated-subagent/task-wrapper and acceptance-finalization prompt pollution without auto-deleting anything, `--include-approved` also surfaces approved suspect pollution that may affect recall/context injection, and human output is compact/actionable instead of dumping full memory bodies. It reuses the existing meta-task classifier and keeps cleanup review-first.
- Phase 15 dashboard slice was merged via PR #2: adds `memory-lane dashboard`, `memory-lane dashboard --json`, and `--all`; uses `ansis`, `boxen`, `cli-table3`, and `figures` only for friendly read-only CLI output; keeps long memory bodies out of dashboard output.
- Phase 15 review-filter/UI slice was merged via PR #5: adds `memory-lane review --kind`, `--source`, and `--provenance`, plus prettier human review output for filtered and unfiltered review queues; keeps review non-destructive and JSON structured.
- Phase 15 MCP review-filter slice was merged via PR #6: adds matching `memory_review` filters (`kind`, `source`, `provenance`) so desktop MCP clients can inspect pending session summaries and continuity candidates precisely.
- Production installer shipped: `install.sh` / `install.ps1` download a prebuilt Bun-compiled binary from GitHub Releases, place it on PATH, and prompt the user to run `memory-lane init`.
- `memory-lane init` is an interactive wizard that detects and configures Claude Code CLI, Codex CLI, Claude Desktop, Codex Desktop, and pi.
- `memory-lane init --yes` auto-configures all detected harnesses non-interactively.
- `memory-lane uninstall` removes the binary and integration configs while preserving memory data by default.
- Slash command / skill support: `memory-lane init` installs a personal skill at `~/.claude/skills/memory-lane/SKILL.md` (invoked as `/memory-lane` in Claude Code CLI) and `~/.agents/skills/memory-lane/SKILL.md` (invoked as `$memory-lane` in Codex CLI/Desktop/app).
- `memory-lane upgrade` downloads the latest release binary and re-applies only the harness configs that were previously installed.
- pi lifecycle writes are intentionally lower-noise: `input` only saves explicit memory requests such as “Remember that ...”, while `turn_end` and `tool_result` capture higher-signal stop candidates and successful workflow commands through shared `@memory-lane/lifecycle` handlers, with per-turn duplicate suppression and privacy-safe debug logging.
- Plugin system implemented and released in `v0.2.1`: Phase 9 (Obsidian LLM Wiki / Knowledge Base Integration) ships as the first opt-in plugin via a lightweight plugin API. First-party plugins are bundled into the standalone binary but remain inactive unless added to `~/.memory-lane/config.json`. Phase 12 is planned for binary-friendly plugin installation and management (`memory-lane plugin install/list/enable/disable/uninstall`).
- v0.2.1 includes bundled plugin fixes so first-party plugins actually work in the standalone binary, plus config error handling and cross-platform vault paths for the Obsidian Wiki plugin.
- Strategic review concluded: Memory Lane is practical for short explicit agent preferences and project facts, but not yet for long-running project continuity because it lacks automatic session synthesis, token-aware context policy, review controls, and staleness handling.
- Roadmap extended beyond Phase 13 with a continuity-first order: Phase 14 token-aware context policy, Phase 15 review/dashboard controls, Phase 16 freshness/canonical continuity/memory revision, Phase 17 review-first progress/checkpoint capture, Phase 18 global preference layering, Phase 19 harness-neutral learning enhancements, Phase 20 deeper time-aware memory/consolidation, and Phase 21 handoff-free sessions. New automation remains opt-in/review-first by default.
- pi-hermes-memory research was folded into the roadmap as inspiration, not a feature copy. Relevant ideas: failure/correction learning, procedure memories, background learning, auto-consolidation, and policy-only/token-aware context. Memory Lane's adaptation should stay harness-neutral for future Hermes, Cursor, and other adapters, with JSONL as source of truth and native skill/rule exports as optional later integrations.
- Cross-harness pending-memory review surfaced product issues now reflected in `ROADMAP.md`: MCP review/list is confusing when Claude Desktop has `projectScope: none`; review output needs grouping by project/source/kind/provenance; `memory_status` should explain MCP explicit tools vs hook lifecycle automation more clearly; pending session summaries need duplicate/debounce handling and should avoid self-referential review chatter such as "approve these memory IDs".
- Latest cross-harness review observation: real pending installer/onboarding preferences should be kept/reviewed, but older delegated-subagent task-wrapper and acceptance-finalization pending memories are pollution from before the meta-task filter and should be rejected/deleted manually or addressed by a future cleanup helper. Different harnesses can also show different project queues when their cwd/projectPath differs; use `memory-lane review/list/status --json --project "$PWD"` or MCP `projectPath` for authoritative per-project inspection.
- Installer hardening was added to the roadmap: avoid breaking published entrypoints/config paths, ensure `memory-lane upgrade` preserves/reapplies existing harness configs, fix Claude Desktop MCP config detection/writing to `claude_desktop_config.json`, and replace the limited sequential yes/no init wizard with clearer menu-driven or flag-based integration selection.
- Current hardening slice implemented and committed: MCP server `dist/index.js` direct execution is backward-compatible again; `memory-lane init` detects/writes Claude Desktop MCP at `claude_desktop_config.json`; init now has a numbered selectable wizard plus `--list`, `--only`, `--all`, and `--recommended` flags, while `--yes` keeps recommended/detected behavior.
- Upgrade compatibility hardening added: manifest-driven reapply logic is now covered by tests, deduplicates configured harnesses, migrates old Claude Desktop manifest paths by writing the supported `claude_desktop_config.json`, preserves unrelated MCP config fields, and skips unknown/stale harness IDs without aborting valid reconfiguration.
- Memory review pollution fix added: pending `memory_suggest` saves now skip raw delegated-subagent task wrapper prompts and acceptance-finalization prompts at the core storage boundary, while lifecycle autosave uses the same shared meta-task filter.
- Review/status UX improved: `memory-lane review` now groups pending memories by project scope, source, kind, and provenance; MCP `memory_review` keeps `data.memories` but adds structured `groups` and scope notes; MCP `memory_status` now explains `projectScope: none` and recommends passing `projectPath` from clients such as Claude Desktop.
- Session-end summarization design spec is at `docs/superpowers/specs/2026-06-16-session-end-summarization-design.md`. It requires user confirmation before generating a summary and saves summaries as pending memories for review.
- Phase 13 Session-End Summarization is implemented through the explicit pi session-summary command on branch `docs/pi-session-summary-command`. Implemented and verified: core data model/config, lifecycle LLM provider, `handleSessionEnd`, manual `memory-lane session-end --confirm` CLI command, docs, full build/test, manual mock-provider smoke, supported Codex `Stop` explicit-intent automation, Claude Code `memory-lane claude session-end`, and pi `/memory session-summary`. Correction: current Codex CLI docs do not expose a supported `SessionEnd` hook event; the Codex-shaped session-end adapter path is future-compatible/manual-test only. Follow-up supported-hook design is documented at `docs/superpowers/specs/2026-06-16-supported-session-summary-hooks.md`.
- To upgrade manually, re-run the installer and then `memory-lane init --yes`.

## Current state

Current branch for this handoff update is `docs/phase-21-workstream-discovery-design` in worktree `~/.config/superpowers/worktrees/memory-lane/phase-21-workstream-discovery`. It is based on `main` after PR #38 (`bf3d5d8`) and contains the draft Phase 21 Slice 6 workstream discovery design plus glossary/roadmap/handoff updates. The design awaits user review/approval before implementation begins.

Historical JSONL hardening is complete and committed:
- `d0c7620 fix(core): normalize historical memory records`
- `06c3cb3 feat(core): report skipped memory JSONL rows in doctor`

Verification for the hardening work passed with `pnpm test && pnpm build` before this docs slice.

Phase 14 Slice 3 is implemented, verified, and committed as `24baa90 Expose context policy in doctor status`.

Phase 15 noise-reduction follow-up is complete: suspect-review output is compact/actionable, pi `input` autosave is explicit-memory-request only, historical JSONL rows are more robust, and `doctor` now surfaces skipped-row diagnostics. Phase 15 dashboard slice is merged via PR #2, CLI review filters/prettier review output merged via PR #5, and MCP review-filter parity merged via PR #6.

Future roadmap/design center: cross-agent continuity without silent autonomy. The logical implementation order is now documented in `ROADMAP.md`: review/dashboard controls first, then freshness/canonical continuity/revision, review-first progress/checkpoint capture, global preference layering, harness-neutral learning, time-aware memory/freshness advisories, Phase 20.5 validation, and then Phase 21 handoff-free sessions. Phase 20 Slices 1-6 are merged and released through `v0.2.20`; Phase 21 work through Slice 5a is released in `v0.2.21`. Phase 21 Slice 1 established the handoff-mode contract, Slice 2 gives review mode a read-only proposal surface assembled from existing pending continuity candidates, Slice 3 adds the cross-session continuity baseline marker, Slice 4 validates those behaviors, Slice 5 designs and implements automatic SessionStart handoff selection, Slice 5b validates automatic mode, and Slice 6 is now in design review for read-only workstream discovery. If approved, the next implementation slice is **Phase 21 Slice 6a — read-only workstream discovery on existing continuity surfaces**.

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

The MCP server is explicit tool access, not lifecycle automation. It exposes `memory_save`, `memory_suggest`, `memory_recall`, `memory_status`, `memory_list`, `memory_review`, `memory_approve`, `memory_reject`, and `memory_delete` over local stdio. `memory_review` supports pending-review filters by `kind`, `source`, and `provenance` for targeted inspection of session summaries and continuity candidates. It reuses JSONL storage, `MemoryEngine`, and project scope behavior. It does not add MCP resources, prompts, HTTP transport, dedicated Obsidian MCP status tools, or automatic hook behavior. Stdio reserves stdout for JSON-RPC protocol messages, so diagnostics must avoid stdout.

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
- Historical JSONL compatibility/diagnostics: `packages/core/src/storage.ts`, `packages/core/src/storage-validation.ts`, `packages/core/src/engine.ts`, `packages/core/test/storage.test.ts`, `packages/core/test/engine.test.ts`, `packages/cli/test/cli.test.ts`

External comparison references discussed:

- Basic Memory: https://github.com/basicmachines-co/basic-memory
- obsidian-mind: https://github.com/breferrari/obsidian-mind
- pi-hermes-memory package/docs: https://pi.dev/packages/pi-hermes-memory
- pi-hermes-memory source: https://github.com/chandra447/pi-hermes-memory
- User's Obsidian setup summary: `/Users/shiang/Desktop/obsidian_codex_memory_types.md`

## Suggested next steps

1. Review and approve the Phase 21 Slice 6 workstream discovery design in `docs/superpowers/specs/2026-06-22-phase-21-workstream-discovery-design.md`.
2. After the design PR lands, sync main, clean up the design branch/worktree, and create a compact merge checkpoint.
3. If approved, start Phase 21 Slice 6a implementation: read-only workstream discovery on existing continuity surfaces (`memory-lane continuity --query`, MCP `memory_continuity({ query })`).
4. Keep the first implementation slice bounded: no persisted workstream ids/schema, no raw transcript indexing, no retrieval rewrite, no lifecycle injection, no new MCP tool family, and no auto-approval/mutation behavior.
5. Preserve review gates: draft an implementation plan after spec approval, implement a small vertical slice, verify with focused core/CLI/MCP tests plus build/diff-check, request review, and open a PR.
6. Keep future learning enhancements harness-neutral. Core/lifecycle should own shared continuity semantics, while adapters for pi, Codex, Claude Code, Cursor, Hermes, etc. should only supply bounded lifecycle evidence and render shared outputs.
7. Do not add automatic pi `agent_end`, `session_shutdown`, or compaction summarization without a separate supported-event design and explicit approval.
8. For Codex Desktop MCP setup, continue using absolute paths only. In the custom MCP form, avoid `~`; use `/Users/shiang/Documents/New project` or the exact project repo path. The MCP server command should be `/Users/shiang/.nvm/versions/node/v22.22.3/bin/node` with argument `/Users/shiang/projects/ribbons-digital/memory-lane/packages/mcp-server/dist/index.js`.
9. Use `docs/manual-testing/obsidian-mirror-import.md` for manual end-to-end testing of completed Obsidian mirror/import behavior when needed.
10. Only schedule hardening backlog items or deferred improvements from `ROADMAP.md` after explicit user approval or clear real-world user value.

## Suggested skills for future agents

A fresh agent should consider invoking:

- `using-superpowers` — required at conversation start in this environment.
- `writing-plans` — before implementing any roadmap phase.
- `test-driven-development` — for MCP, mirror polish, or import follow-up implementation.
- `systematic-debugging` — if hook/storage/mirror/import behavior is surprising.
- `requesting-code-review` — before merging new feature work.
- `verification-before-completion` — before claiming implementation is complete.
- `using-git-worktrees` — if starting a new feature branch/worktree.
