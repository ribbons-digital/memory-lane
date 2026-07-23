# CLI reference

Full command list and command-behavior reference for the `memory-lane` CLI.

```
memory-lane save <text> [--kind <kind>]
                                  Save an approved memory with optional explicit kind
memory-lane suggest <text>        Queue a pending suggestion for review
memory-lane recall [query] [--top-k <n>] Recall memories (semantic or lexical) with an optional positive per-command result limit
memory-lane show|get <id> [--all] Show one memory by exact id, including descriptor metadata when present
memory-lane list [--status ...]   List memories
memory-lane search <query>        Lexical text search
memory-lane approve <id> [--all]  Approve pending or reactivate rejected memory
memory-lane reject <id> [--all]   Reject a memory
memory-lane delete <id> [--all]   Soft-delete a memory
memory-lane review [--all]        Show pending memories
memory-lane review --kind session_summary Filter pending review by memory kind
memory-lane review --source session-summary Filter pending review by source
memory-lane review --provenance pi/session_end Filter pending review by adapter/event provenance, e.g. pi/session_end or codex/pre_compact
memory-lane review --signal contains-question Filter by one quality signal
memory-lane review --signal contains-question,contains-code-fence Filter by any listed quality signal
memory-lane review [filters] --action approve|reject Preview the exact IDs selected for grouped mutation
memory-lane review [filters] --action approve|reject --confirm-ids <id[,id...]> --yes [--confirm-global]
                                  Apply the previewed IDs; global or cross-project records also require --confirm-global
memory-lane review --suspect-meta Show likely old pending operational prompt pollution only
memory-lane review --suspect-meta --include-approved [--all] Show pending+approved suspect pollution; --all includes other projects
memory-lane dashboard [--all]     Compact continuity/review overview without long memory bodies
memory-lane continuity [--json] [--query <text>]
                                  Canonical continuity read model, with optional workstream discovery
memory-lane route --prompt <text> Internal prompt routing decision for harness adapters
memory-lane agreements [--area <area>] [--json]
                                  Show approved operating agreements for the current project/global scope
memory-lane update <id> [--all]   Revise an active memory with the same id
memory-lane rescope|move <id> --scope global|project [--dry-run|--yes] [--all]
                                  Correct memory scope with the same id
memory-lane supersede <new-id> <old-id...> [--reason <reason>] [--dry-run] [--yes] [--all]
                                  Link approved old memories to an approved successor
memory-lane replace <old-id...> --text <text>|--stdin [--category <category>] [--kind <kind>] [--status pending|approved] [--reason <reason>] [--dry-run] [--yes] [--all]
                                  Create a successor memory for approved old memories
memory-lane compact               Remove deleted/rejected tombstones while preserving invalid rows
memory-lane doctor                Diagnostic report
memory-lane status                Quick stats
memory-lane migrate project-local --dry-run [--write-plan <path>]
                                  Preview legacy home-stored project memories and optionally write a review plan
memory-lane migrate project-local --apply-plan <path> --yes
                                  Apply a reviewed project-local migration plan
memory-lane config [show|enable-semantic|disable-semantic|set <key> <value>]
                                  Show or update ~/.memory-lane/config.json values
memory-lane reindex [--force]     Embed approved memories missing current vectors; --force recomputes
memory-lane init [--yes|--recommended|--all|--list|--only <integrations>]
                                  Configure detected harnesses or selected integrations, including OMP
memory-lane init --project-local  Initialize sandbox-friendly project-local storage
memory-lane upgrade [--yes]       Download the latest binary and re-apply manifest-recorded configs
memory-lane uninstall [--yes] [--only omp]
                                  Remove every integration, or remove only OMP while preserving Pi and data
memory-lane tuneup [purge]        Inspect or purge local learning capture data
memory-lane session-end --confirm Generate a pending session summary from stdin JSON
memory-lane claude user-prompt-submit|stop|post-tool-use|session-start|session-end|pre-compact
                                  Claude Code lifecycle hook commands from stdin JSON
memory-lane codex user-prompt-submit|stop|post-tool-use|session-start|session-end|pre-compact
                                  Codex lifecycle hook commands from stdin JSON (Codex itself has no SessionEnd hook event)
memory-lane pi input|turn-end|post-tool-use|pre-compact
                                  Generated Pi bridge lifecycle commands from stdin JSON
memory-lane obsidian ...          Manage optional Obsidian mirror/import workflows
memory-lane mcp                   Run the bundled stdio MCP server (used by installed desktop-client configs)
```

All commands support `--json` for machine-readable output and `--project <path>` to set the project scope.
`memory-lane save` accepts `--kind` to override text-based kind inference; valid values are `preference`, `personal_context`, `project_fact`, `project_checkpoint`, `workflow_rule`, `decision`, `correction`, `procedure`, `session_summary`, and `misc`.

## Output streams

Successful command output is written to stdout, including successful `--json` payloads.
Failure output is written to stderr so stdout remains safe for scripts and pipelines.
With `--json`, a failure writes its machine-readable `{ "ok": false, ... }` payload to stderr and leaves stdout empty.
Callers should use the process exit status to distinguish success from failure, then parse JSON from stdout on success or stderr on failure.

## Upgrade and uninstall behavior

`memory-lane upgrade` preserves memory data and reapplies manifest-recorded integrations with the newly installed binary.
On Windows, executable replacement and install-manifest updates are transactional: the running executable is renamed, the replacement is smoke-tested, and any installer or required reconfiguration failure restores the previous executable and manifest.
Successful Windows upgrades defer backup and transaction cleanup until the original process exits, and concurrent maintenance is serialized per installation.

Full `memory-lane uninstall` preserves memory data unless an interactive user explicitly chooses to remove it; `--yes` removes integrations and the binary while preserving data.
On Windows, the running executable is renamed and deleted by a detached helper after exit.
If deferred deletion remains pending, a later upgrade or full uninstall retries cleanup only after confirming the original process identity is inactive.
Selective `uninstall --only omp` does not remove the binary, Pi, other integrations, or memory data.

## Recall ordering

When `memory-lane recall` receives no query, or a query that trims to an empty string, it returns approved memories visible to the current project scope in newest-`updatedAt`-first order.
Results are bounded by the positive per-command `--top-k <n>` override when provided; otherwise they use `semantic.retrieval.topK`.
The override is per invocation only and does not mutate config.
`--top-k` requires a positive integer value; missing, empty, zero, negative, fractional, and nonnumeric values are rejected before recall runs.
For equal `updatedAt` values, results are ordered by newest `createdAt` and then by memory ID.
This empty-query path does not invoke semantic search and reports `semantic.used: false`.
Non-empty queries continue to use semantic or lexical relevance ranking, with the same optional `--top-k <n>` result bound.
Use `memory-lane continuity` instead when answering broad prior-work, next-action, project-status, resume, or handoff questions.

## Freshness metadata

`memory-lane save` and `memory-lane suggest` accept optional time-awareness metadata:

```bash
memory-lane save "Temporary project status" --expires-at 2026-07-01T00:00:00.000Z
memory-lane suggest "Recheck this after launch" --stale-after-days 30
memory-lane save "Release note" --captured-at 2026-06-21T00:00:00.000Z
```

Freshness metadata is advisory.
Memory Lane stores, validates, displays, and classifies it for status/continuity inspection, but does not automatically delete, hide, refresh, consolidate, deprioritize, or filter memories.
Stale and expired advisory metadata may include existing dry-run revision commands so users can inspect a safe next action per memory id.
Generated session summaries can also carry `freshness.capturedAt` when the source messages include canonical ISO timestamps; this captured time is the session as-of/source timestamp and may differ from the summary heading/write date.

## Candidate quality signals

`memory-lane review` annotates candidates with deterministic quality signals for bare checkpoints, previously rejected exact equivalents, questions, code fences, ambiguous references, cross-project global candidates, and summaries that mix durable and transient content.
JSON output includes stable `qualitySignals` arrays with a code, concise label, reason, and non-binding suggested action.
Human output shows concise signal codes beside the existing candidate preview and provenance, followed by the original full text for signaled candidates.
Use `--signal <code[,code...]>` to filter for candidates matching any listed signal.

Quality signals are advisory.
They never approve, reject, rescope, hide, or otherwise mutate a memory automatically.
A signal is a prompt for user inspection, not a model-generated score or an automatic rejection decision.

Grouped review mutation is an explicit preview-and-confirm flow.
For example, `memory-lane review --signal contains-question --action reject` prints the exact selected memory IDs without changing them.
To apply that exact set, repeat the filters with the printed `--confirm-ids <id[,id...]> --yes` arguments.
The command revalidates every confirmed candidate and its pending status before the first write, and rejects stale or mismatched candidates without mutating any selected memory.
If a later storage operation fails, output identifies definitely applied, uncertain, and unattempted IDs so review can recover safely.
If any selected record is global or belongs to a project other than the active review project, `--confirm-global` is also required.

## Checkpoint candidates and review-first capture

`memory-lane review`, `memory-lane review --json`, and MCP `memory_review` label pending memories that look like high-value project progress, such as merged PRs, releases, verification milestones, docs syncs, major fixes, or roadmap decisions.
These labels are review-first: approve a checkpoint candidate only if it should become durable project continuity.

Memory Lane can also suggest pending checkpoint candidates from context-rich lifecycle evidence that explains a durable completed outcome.
Bare release and merge events and previously rejected equivalents are suppressed before persistence by the same deterministic quality definitions used during review.
These inferred checkpoints are pending, deduplicated against nearby pending or approved project checkpoints, and do not affect approved continuity until reviewed.
Repeated recognized checkpoint events, such as the same release, pull request merge, or verification checkpoint, are skipped before another pending write.
The `memory.lifecycleCapture` configuration controls automatic admission with `off`, default `conservative`, and opt-in `aggressive` modes.
Default conservative limits are 2 automatic candidates per turn, 8 per session, and 20 automatic pending candidates per project.
Status, doctor, and dashboard JSON add the effective mode, automatic pending-write capability, and current automatic pending backlog.
When a hook queues one or more pending candidates, supported transports emit one batched count-only review notice without candidate or source content.
MCP clients do not run lifecycle hooks, but they see the same pending state through `memory_review`, `memory_status`, and `memory_continuity`.

No new command or MCP tool is required for checkpoint capture.
Review with `memory-lane review` or MCP `memory_review`, approve/reject through the existing review flow, and inspect continuity with `memory-lane continuity` or MCP `memory_continuity`.
Checkpoint capture does not automatically approve memories, dump transcripts, change recall ranking, or perform exact thread/workstream lookup.

## Workflow correction candidates

Memory Lane can also suggest pending `correction` candidates when a user explicitly points out that an agent violated, forgot, skipped, or ignored an expected workflow or operating agreement, such as “you forgot our PR-protected workflow” or “you skipped the review gate.”
Correction capture runs only from bounded Stop context, saves compact normalized project-scoped text, and remains pending by default.

Correction capture is review-first learning, not automatic rule rewriting.
It does not add commands or MCP tools, does not run an LLM classifier, does not capture raw transcripts or tool output, and does not auto-approve or change recall ranking.
Inspect candidates with `memory-lane review`, MCP `memory_review`, `memory-lane continuity`, or MCP `memory_continuity`; approve only corrections that should become durable project workflow guidance.

## Recovery-backed procedure candidates

Memory Lane can suggest pending `procedure` candidates from bounded tool evidence when a failed shell action is followed by a safe successful recovery, such as `npm test` failing before `pnpm test` succeeds, or `npm install` failing before pnpm evidence succeeds.
These candidates use compact templates such as `Procedure: ...
When: ...
Steps: ...
Pitfall: ...
Verify: ...` and never include raw stdout, stderr, transcripts, or secrets.

Procedure learning is conservative and review-first.
It requires optional bounded recent tool context from a harness, stores candidates as normal project-scoped Memory Lane records with `kind: "procedure"`, deduplicates against existing procedure/workflow/correction memories, and does not export native harness skills or rules.
Review and approve through the existing CLI/MCP review flow before relying on a procedure for durable continuity.

## Memory revision commands

Use explicit revision commands when an approved memory needs correction or replacement.
These commands are append-only: they write newer rows instead of silently deleting history.

```bash
memory-lane update <id> --text "refined memory" --reason "clarified wording"
cat refined.md | memory-lane update <id> --stdin --kind workflow_rule --dry-run

memory-lane supersede <new-id> <old-id> --reason "newer workflow agreement"
memory-lane supersede <new-id> <old1> <old2> --reason "merged duplicates" --yes
memory-lane supersede <new-id> <old-id> --all --dry-run

memory-lane replace <old-id> --text "new successor memory" --kind workflow_rule
cat replacement.md | memory-lane replace <old1> <old2> --stdin --yes
memory-lane replace <old-id> --text "cross-project successor" --all --dry-run
```

`update` keeps the same memory id and can change text, category, kind, or approved/pending status.
`replace` creates a new successor memory.
`supersede` links an existing approved successor to approved older memories.
Superseded memories remain approved historical records; Memory Lane does not delete them automatically.
Active continuity slots, workstream discovery, and recall omit superseded records, while list/show and continuity hints can still expose them for explicit inspection.

Use `--dry-run` to preview any revision command.
Multi-old `replace` and `supersede` require `--yes` unless `--dry-run` is used.
Revision commands use global plus current-project visibility by default, use global-only visibility when no project scope is active, and require `--all` for cross-project maintenance.
MCP mutation tools are not added for these operations yet.

## Freshness status

`memory-lane status --json --since <ISO timestamp>` and `memory-lane doctor --json --since <ISO timestamp>` include a read-only `freshness` object.
It reports counts and metadata for approved memories visible to the current project scope plus global memories that were updated after the timestamp.
The same object includes advisory freshness classifications for visible approved memories with explicit freshness metadata: `expired`, `stale`, `current`, or `none`.
Stale advisory records suggest `memory-lane update <id> --text <updated-memory-text> --dry-run`; expired advisory records suggest dry-run `update`, `replace`, and `supersede` commands.
Human `status --since`, `doctor --since`, and `continuity` output show a bounded `Freshness advisory actions (manual dry-run)` block when stale/expired advisory actions exist; JSON remains the authoritative full metadata surface.
These are text-free suggestions using existing revision commands, not a refresh workflow.
Expired/stale classifications are inspection signals only; Memory Lane does not hide, delete, reject, down-rank, or skip those memories.
Freshness output intentionally excludes memory text; use `memory-lane list --json` or targeted recall when you need the actual memory bodies.

## Operating agreements

Use `memory-lane agreements` to explicitly inspect approved workflow/process memories that should guide the current project.
By default it considers the current project plus global scope, returns selected agreement text, and reports related overlap without changing memories.

```bash
memory-lane agreements
memory-lane agreements --json
memory-lane agreements --area project-loop --json
memory-lane agreements --all
```

`memory-lane status --json`, `memory-lane doctor --json`, and MCP `memory_status` include text-free operating agreement metadata so clients can notice that agreements exist without injecting the agreement bodies.

## Continuity read model

Use `memory-lane continuity --json` as the canonical CLI surface for continuity questions such as “what were we last working on?”, “what changed?”, “what did we accomplish?”, “what should we do next?”, and project status/resumption checks.
The read model combines latest progress (`latestProgress`), legacy latest approved project/global continuity (`latestApproved`), bounded operating guidance (`operatingGuidance`), pending continuity review candidates, freshness, operating-agreement metadata, continuity hints, warnings, suggested actions, and harness guidance in one bounded response.
Active selected slots use non-superseded approved memories, collapse operating guidance to one preview per workflow area, de-duplicate the same memory id across the major human-rendered continuity sections, and prefer safe descriptor metadata for previews when available.
Human CLI output promotes warnings that require inspection into an `Action required before applying continuity guidance` block before operating guidance.
For operating-agreement overlap warnings, inspect the per-area `memory-lane agreements --area <area> --json` actions before treating overlapping workflow guidance as authoritative.

For topic-specific workstream questions such as “resume building X” or “where was X implemented?”, pass a query: `memory-lane continuity --query "resume building X" --json`.
This adds a bounded `workstreamDiscovery` block derived from non-superseded approved current-project continuity memories, with compact previews, match reasons, provenance/revision metadata, and derived PR/branch/commit/release references when present.
Human output includes the same section compactly.

For MCP clients, call `memory_continuity({ projectPath })` first for general continuity questions, or `memory_continuity({ projectPath, query: "resume building X" })` for the workstream discovery variant.
Pass `projectPath` when the desktop/client process is not already scoped to the project.
Do not answer continuity questions from `memory_recall` alone.
Use recall only as a topic-specific follow-up after continuity inspection, for example when the continuity read model points to an area that needs more detail.
Lexical fallback recall keeps lexical score primary; for currentness-like release/status/checkpoint queries, exact lexical-score ties between project checkpoints prefer newer `updatedAt` so older status checkpoints do not outrank equally relevant current checkpoints.

The continuity read model is read-only.
It may include bounded previews of selected memory records, including pending checkpoint candidates and approved workstream discovery pointers, but it does not inject additional memory bodies into lifecycle prompts, approve pending memories, mutate records, clean up scopes, rewrite retrieval, index raw transcripts, create workstream ids, or replace the review queue.
Pending checkpoint captures become approved continuity only after review approval.

SessionStart cross-session freshness uses an advisory per-project baseline marker at `~/.memory-lane/continuity-baselines.json` by default, or `continuity-baselines.json` next to the configured memory JSONL file.
The marker stores only project scope keys and timestamps so a new session can notice approved Memory Lane state newer than the prior baseline.
It is not a memory source of truth, is safe to delete, and is ignored when lifecycle context policy is `off`.
Marker handling does not write memory records, inject handoff bodies, approve/reject/cleanup memories, capture transcripts/tool output, or activate automatic handoff mode.
`memory-lane status --json`, `memory-lane doctor --json`, and MCP `memory_status` expose text-free `continuityBaseline` diagnostics.

## Continuity hints

`memory-lane dashboard`, `memory-lane status --json`, `memory-lane doctor --json`, and MCP `memory_status` include read-only continuity hints.
Hints are metadata-only: they may include memory ids, scope, category, kind, source, provenance, timestamps, and revision relationships, but they do not include memory text in status/MCP surfaces.
Query-specific natural-language workstream discovery is available on existing continuity surfaces via `memory-lane continuity --query` and MCP `memory_continuity({ query })`; broader transcript/thread search remains out of scope.
The human dashboard shows compact hint counts and inspection actions without adding memory text from the hints.

Current hints report:

- approved memories that are marked superseded but remain visible as historical records;
- multiple operating-agreement candidates for the same workflow area;
- project/global preference overlap in the same workflow area;
- scope hygiene candidates: approved global memories that look project-specific because of their category, kind, or path-like content;
- freshness advisories: approved visible memories with explicit freshness metadata that are expired or stale;
- newer approved memories when `--since <ISO timestamp>` is provided.

Scope hygiene hints are text-free inspection signals only.
Memory Lane does not automatically rescope or clean up those memories; use `memory-lane show <id>` or `memory-lane list --json` to inspect them before deciding whether to rescope, update, supersede, or leave them alone.
Use `memory-lane rescope <id> --scope project --project <path> --dry-run` to preview a same-id scope correction, adding `--all` only for deliberate cross-project maintenance, then rerun with `--yes` only after review.

Hints invite inspection with commands such as `memory-lane dashboard`, `memory-lane show <id>`, `memory-lane agreements --area <area> --json`, `memory-lane agreements --all`, and `memory-lane list --json`.
Freshness advisory hints may also include per-id dry-run revision commands already available in the CLI; human `continuity` groups those commands separately as manual dry-run freshness actions.
They do not perform cleanup, remove superseded memories from explicit inspection surfaces, change recall ranking, or suggest destructive reject/delete commands.

## Session-end summarization

Session-end summarization is opt-in and disabled by default.
It sends a compact session transcript to an explicitly configured OpenAI-compatible chat model, then saves the generated summary as a **pending** memory with `source: "session-summary"` and `kind: "session_summary"`.
Manual and session-end hook summaries use `provenance.lifecycleEvent: "session_end"`.
Pre-compact summaries use `provenance.lifecycleEvent: "pre_compact"`.
The transcript itself is not stored in Memory Lane.

Configure it in `~/.memory-lane/config.json`:

```json
{
  "memory": {
    "sessionEndSummary": {
      "enabled": true,
      "provider": "openai-compatible",
      "baseUrl": "http://localhost:11434/v1",
      "apiKeyEnv": "MEMORY_LANE_SUMMARY_API_KEY",
      "model": "gpt-4.1-mini",
      "maxTokens": 800,
      "timeoutMs": 30000,
      "requireConfirmation": true,
      "includeToolOutputs": false
    }
  }
}
```

Pre-compact summarization reuses `memory.sessionEndSummary`, but hook events cannot ask for confirmation.
To let Claude `PreCompact`, Codex `PreCompact`, or the native pi adapter or release-style generated pi bridge `session_before_compact` save pending summaries, set `memory.sessionEndSummary.requireConfirmation` to `false`; keep `memory.preCompactSummary.enabled` omitted or not `false`.
Set `memory.preCompactSummary.enabled` to `false` to opt out of pre-compact summaries while leaving manual/session-end summaries enabled.

Run it manually with explicit confirmation:

```bash
echo '{"messages":[{"role":"user","content":"Switch to pnpm"},{"role":"assistant","content":"Done."}]}' \
  | memory-lane session-end --confirm
memory-lane review
memory-lane review --kind session_summary --source session-summary  # inspect pending session summaries only
memory-lane review --provenance pi/session_end  # inspect candidates from a specific adapter/event
memory-lane review --provenance codex/pre_compact  # inspect pre-compact session summaries
memory-lane review --suspect-meta  # optional: find old pending delegated-task/finalization prompt pollution
memory-lane review --suspect-meta --include-approved  # include approved suspects that may affect recall
memory-lane approve <id>
memory-lane reject <id>            # reject obsolete/suspect pending entries
```

Codex CLI does not currently expose a supported `SessionEnd` hook event.
Do not add `SessionEnd` to `.codex/hooks.json`; Codex will ignore it.
For Codex today, use the manual `memory-lane session-end --confirm` command, the supported `Stop` hook explicit-intent path, or the supported `PreCompact` hook when confirmation is disabled in config.
When the latest user message says something like "remember this session", "save a session summary", or "summarize this session to memory", `memory-lane codex stop` treats that request as confirmation, summarizes a bounded transcript through the configured provider, and saves the result as a pending session-summary memory.
Ordinary `Stop` turns keep the existing silent autosave behavior and do not run the summarizer.

Tool messages are excluded unless `includeToolOutputs` is true.
`timeoutMs` is optional and defaults to 30000 ms for OpenAI-compatible session-summary calls.
Lines that look like secrets are redacted before the transcript is sent to the configured model.
Generated summaries are also cleaned of obvious Memory Lane review-management chatter such as “run memory-lane review” or “approve these memory IDs,” unless review decisions are themselves the durable outcome.
A repeated manual/session-end summary for the same adapter and session id, a repeated pre-compact summary for the same adapter, session id, and turn id or fallback message digest, or a summary with the same normalized durable content as an existing visible pending/approved session summary, is skipped before writing another pending memory.
Generated summaries dominated by operational subagent/orchestrator chatter are skipped when they contain no durable project outcome.
Existing pending suspect summaries may show a read-only `review hint` in CLI review output and `reviewHygiene` metadata in JSON/MCP review output.
Summary hygiene removes obvious review-management chatter from generated summaries before they enter the pending review queue.
When transcript/session messages include canonical ISO timestamps, the saved pending summary stores the latest message timestamp as `freshness.capturedAt`.
No current-time fallback is used.
Claude Code supports `memory-lane claude session-end` through its documented `SessionEnd` hook.
By default it still requires confirmation and will not save from a bare hook unless `memory.sessionEndSummary.requireConfirmation` is set to `false` or the payload includes `confirmed: true` for manual testing.
Claude Code, Codex CLI, the native pi adapter, and the release-style generated pi bridge support pre-compact summaries through `PreCompact` / `session_before_compact` when `memory.sessionEndSummary.enabled` is configured, `memory.sessionEndSummary.requireConfirmation` is `false`, and `memory.preCompactSummary.enabled` is omitted or not `false`.
These summaries save pending `session_summary` memories with `pre_compact` provenance and never block or override host compaction.
Set `memory.preCompactSummary.enabled` to `false` to opt out.
pi also supports explicit session summaries through `/memory session-summary`, using pi's session manager plus interactive confirmation.
Automatic pi `agent_end` and `session_shutdown` summarization remain out of scope.

## Obsidian mirror

Obsidian support is opt-in and disabled by default.
JSONL remains the source of truth; Memory Lane can mirror active `approved` and `pending` memories into generated Markdown files in an Obsidian-compatible vault.
Hooks do not configure or prompt for Obsidian setup.

```bash
memory-lane obsidian init --vault ~/Obsidian/MyVault
memory-lane obsidian status
memory-lane obsidian sync --dry-run
memory-lane obsidian sync
```

Generated mirror files include:

```text
Memory Lane/index.md
Memory Lane/indexes/pending.md
Memory Lane/indexes/approved.md
Memory Lane/indexes/project.md
Memory Lane/indexes/recent.md
Memory Lane/memories/<id>.md
```

Index files are generated, read-only mirror artifacts.
They are safe to browse in Obsidian, but they are not user-authored import notes and may be overwritten by `memory-lane obsidian sync`.
The index pages use standard Markdown links to `memories/<id>.md` files.
Do not edit generated files directly; changes may be overwritten on the next sync or memory mutation.
Rejected/deleted memories are removed from the mirror.
Stale deletion is constrained to generated files marked with `memory_lane_mirror: true`; generated indexes are additionally marked with `memory_lane_index: true`.

Generated files include lightweight tags for Obsidian browsing, Bases, or Dataview filtering.
Memory files include `memory-lane`, `memory-lane/memory`, and status/category/kind tags such as `memory-lane/status/approved`, `memory-lane/category/project`, and `memory-lane/kind/project_fact`.
Index files include `memory-lane` and `memory-lane/index`.

`memory-lane doctor` includes cheap Obsidian diagnostics such as configured vault/folder paths, mirror/import folder existence, and warnings.
Doctor does not repair, sync, or write Obsidian files.

`obsidian init` and non-dry-run `obsidian sync` also create an `imports/` folder for user-authored import notes; `obsidian sync --dry-run` does not write files.

## Import from Obsidian

Memory Lane can explicitly import user-authored Markdown notes from the configured Obsidian folder.
Import is **not** automatic sync, not bidirectional sync, and not Obsidian-backed storage: JSONL remains the source of truth, generated mirror memory files and generated indexes are never imported, and source notes are not rewritten, moved, archived, deleted, or annotated with generated ids.

Only this folder is scanned, recursively:

```text
<vault>/<folder>/imports/
```

The first implementation intentionally does **not** support `--vault`, `--folder`, or `--path` overrides for import.
Configure the mirror once with `memory-lane obsidian init --vault <path> [--folder "Memory Lane"]`, then run import against that configured location.

Each importable note must opt in with top-of-file frontmatter:

```md
---
memory_lane: true
category: project
scope: project
status: pending
---
Use pnpm for package installs.
```

The Markdown body after frontmatter, trimmed, becomes the memory text.
Frontmatter is metadata only.
Unknown frontmatter fields are ignored.
Descriptor metadata is not imported from frontmatter yet.
Defaults are:

```yaml
category: personal
scope: global
status: pending
```

Preview first; dry-run performs no JSONL writes and no mirror writes:

```bash
memory-lane obsidian import --dry-run
memory-lane obsidian import --json --dry-run
```

Apply imports:

```bash
memory-lane obsidian import
memory-lane obsidian import --json
```

Rules and gotchas:

- Notes without `memory_lane: true` are ignored.
- Notes with `memory_lane_mirror: true` are skipped because they are generated mirror files; generated indexes also have `memory_lane_index: true` and are not user-authored import notes.
- Dotfiles, dotfolders, symlinks, and non-`.md` files are skipped during discovery.
- Discovery order is deterministic by normalized relative path.
- `status` may be `pending` or explicit `approved`; `rejected` and `deleted` are invalid for import.
- `scope: project` requires a project identity from the running command context; otherwise the note is skipped with a warning.
- Add `memory_lane_id: <id>` to update an existing active (`approved` or `pending`) memory.
  Missing, rejected, or deleted ids are skipped with warnings.
- Updates do not allow status demotion from `approved` to `pending`, scope changes, or project identity changes.
- Duplicate `memory_lane_id` values in the same run skip all conflicting notes.
  Duplicate create body text in the same run also skips all conflicting notes.
- Import is partial-success: valid notes are applied; invalid notes are skipped with warnings; there is no transaction or rollback.
- Apply writes through normal Memory Lane APIs, so validation, append-only JSONL, embedding invalidation, and best-effort mirror warnings still apply.
