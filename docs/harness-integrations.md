# Harness integrations

Run `memory-lane init` to auto-detect and configure supported harnesses, or see [`examples/harness-integrations/`](../examples/harness-integrations/) for manual snippets for:
- [MCP Server](../examples/harness-integrations/mcp.md)
- [Claude Code CLI](../examples/harness-integrations/claude-code.md)
- [OpenAI Codex CLI](../examples/harness-integrations/codex-cli.md)
- [Cursor](../examples/harness-integrations/cursor.md)
- [Windsurf](../examples/harness-integrations/windsurf.md)
- [pi](../examples/harness-integrations/pi.md)
- [OMP (Oh My Pi)](../examples/harness-integrations/omp.md)

Lifecycle autosave intentionally filters transient reviewer, subagent, and task prompts such as commit review requests, “do not modify files” review tasks, and delegated status-report instructions.
Those operational prompts are not durable memory.
Explicit memory requests remain supported and authoritative: use `memory-lane save ...` or phrases like “Remember that ...” for durable workflow rules, preferences, or project facts.

Shared lifecycle handlers can queue compact `project_checkpoint` candidates from context-rich Stop evidence about completed releases, merged pull requests, and other durable outcomes.
Bare successful release and merge commands are suppressed before persistence because an artifact identifier alone does not explain a durable outcome.
Eligible inferred captures remain pending, are deduplicated before saving, and never change approved continuity until the existing review flow approves them.
PostToolUse handlers may also queue pending `procedure` candidates when bounded recent tool evidence shows a failed action followed by a successful safe recovery; the saved text is template-derived and omits raw tool output.

## OMP installation and maintenance

OMP uses the same native adapter-import or generated CLI-bridge source selected for pi, but installs it under the independently resolved OMP agent root.
`memory-lane doctor` reports Pi and OMP separately.
OMP diagnostics also report the pinned lifecycle contract's tested version, test date, and aggregate pass status without changing extension detection or warning semantics.
When the install manifest records OMP, doctor, upgrade, and uninstall inspect that exact recorded extension path even if the environment override is later removed.
Without a recorded OMP integration, doctor checks the shared resolver's default or `PI_CODING_AGENT_DIR` path without creating files.
Named-profile auto-discovery remains unsupported; use an absolute `PI_CODING_AGENT_DIR` during init or configure the profile's `extensions:` list manually.

## pi adapter

The handwritten pi adapter supports manual Memory Lane tools and commands (`memory_save`, `memory_suggest`, `memory_revise`, `memory_continuity`, `memory_recall`, and `/memory ...`).
It performs read-only lifecycle context injection through pi's documented `before_agent_start` event: broad continuity prompts route to canonical Memory Lane continuity, memory-management prompts route to list/status/review guidance, and other relevant approved memories may be injected as hidden `memory-lane` context before the agent starts.

### Targeted suggestion review in pi and OMP

In the handwritten adapter, a pending `memory_suggest` creates one candidate and immediately analyzes only that exact ID, not the broader pending backlog.
Its receipt reports `id`, `currentText`, `scope`, `kind`, `qualitySignals`, `reasons`, `suggestedAction`, `attemptState`, and `outcome`.
On `revise`, the host calls the canonical `memory_revise` tool with revised text and the same ID, then follows the rerun receipt.
The loop permits at most two explicit automatic revisions after the initial suggestion.
On `clean`, the candidate remains pending and is ready for explicit human approval or rejection.
On `needs-human-review`, automatic rewriting stops, the pending candidate remains stable for a human decision, and further automatic revision attempts are refused.
Soft or ambiguous signals never auto-reject a candidate.
A non-text-fixable finding such as a cross-project global scope concern goes directly to `needs-human-review` without consuming a rewrite attempt.
An explicit `status: "approved"` keeps direct-approved behavior and does not start the pending review loop.

Release-style generated Pi and OMP bridges invoke the CLI for their Memory Lane tools and commands.
Their `memory_suggest` tool therefore creates and analyzes the exact pending candidate through `memory-lane suggest`, but its compact tool result exposes only the queued ID rather than the targeted receipt, and the generated bridge does not register `memory_revise` as a host tool.
Use `/memory suggest <text>` to see the CLI receipt and `/memory revise-suggestion <id> --text <revised-text>` to follow its same-ID loop, or run those CLI commands directly.
Generated bridge suggestions with explicit approved status keep the CLI's direct-approved behavior and do not start targeted review.
The handwritten adapter provides the full host-tool loop directly through `memory_suggest` and `memory_revise`.
Neither surface automatically approves or rejects a candidate.

Both the repo-local pi adapter and release-style generated pi bridge write memories through low-noise lifecycle events:

- `input` - explicit memory requests only ("Remember that..."); ordinary prompt submissions are ignored to avoid noisy memory queues.
- `turn_end` - the last user and assistant messages are evaluated for memory-worthy candidates and strong completed-progress checkpoint evidence after a turn completes.
- `tool_result` - successful shell workflow commands such as `pnpm test`, `pnpm build`, and `pnpm install` may become pending project workflow suggestions; bare successful release and merge commands stay suppressed.

Automatic writes route through the shared lifecycle capture policy, skip secrets, run shared deterministic quality analysis, deduplicate within a turn, and keep every inferred candidate pending for review.
The default conservative policy admits at most 2 candidates per turn, 8 per session, and 20 automatic pending candidates per project.
The explicit aggressive policy admits at most 5 per turn, 30 per session, and 100 pending per project, while `off` disables automatic capture.
Explicit memory requests and `memory_suggest` are exempt from these limits.
When the project ceiling is reached, the adapter emits one review advisory rather than growing the queue.
On OMP, automatic lifecycle capture is suppressed only when both nested session-file ownership and the delegated-worker system role identify a task session.
Inferred candidates stay pending until review; use `/memory review` in pi or the normal CLI/MCP review surfaces to approve or reject them.
Pi and OMP batch successful lifecycle writes into at most one count-only notice per turn window, such as `Memory Lane queued 2 pending memory suggestions for review. Run /memory review to inspect.`
No notice includes candidate text, prompts, transcripts, or tool output, and events with no writes stay quiet.
Repo-local pi `/memory review` and `/memory delete <id>` respect current-project visibility by default, return not-found behavior without memory text for out-of-scope ids, and require `--all` for deliberate cross-project review or delete.
Set `MEMORY_LANE_DEBUG=1` to append privacy-safe debug records to `~/.memory-lane/pi-debug.jsonl` (no prompts or tool outputs are logged).

For session summaries, use `/memory session-summary` in pi.
The command reads the current conversation branch through pi's session manager, asks for interactive confirmation, sends the compact transcript to the configured `memory.sessionEndSummary` provider, and saves any result as a pending `session_summary` memory with pi `session_end` provenance.
The native pi adapter and release-style generated pi bridge can also save pending pre-compact `session_summary` memories with pi `pre_compact` provenance from `session_before_compact` when `memory.sessionEndSummary.enabled` is configured, `memory.sessionEndSummary.requireConfirmation` is `false`, and `memory.preCompactSummary.enabled` is omitted or not `false`; they do not override pi's own compaction summary.
Memory Lane does not automatically summarize pi sessions on `agent_end` or `session_shutdown`.

## Context policy

Lifecycle hooks use `memory.contextPolicy` to decide how much context to inject.
This is orthogonal to `memory.handoffMode`: handoff mode declares continuity posture, while context policy controls body selection and budgets.
Defaults preserve existing behavior with bounded selected memory blocks:

```json
{
  "memory": {
    "contextPolicy": {
      "mode": "selective",
      "maxItems": { "sessionStart": 4, "prompt": 6 },
      "maxChars": { "sessionStart": 1600, "prompt": 3000 },
      "preferenceMaxItems": { "sessionStart": 2, "prompt": 2 },
      "preferenceMaxChars": { "sessionStart": 600, "prompt": 900 },
      "includePending": false,
      "fallbackToSearch": true
    }
  }
}
```

Modes:

- `selective` injects selected approved memories inside a guarded `<memory-context>` block.
- `policy-only` injects compact guidance telling the agent to use the appropriate Memory Lane continuity, recall, list, status, or review surface when needed, without including memory bodies.
- `off` disables automatic context injection while leaving explicit CLI/MCP tools and automatic save hooks unchanged.

When `selective` mode injects memory bodies, the `Relevant Memory` block is grouped for readability.
Current-project memories are separated from global preferences/workflow rules and other visible project memories, and each memory shows a plain-language type label such as `Project checkpoint`, `Workflow rule`, `Preference`, or `Project fact`.
Each memory body is XML-escaped and rendered as nested Markdown blockquote lines, including blank lines, so memory text cannot close the guarded `<memory-context>` wrapper or create top-level Markdown headings, lists, or code fences.
These labels and quoting rules affect only rendered lifecycle context; they do not change recall ranking, memory status, stored memory text, or explicit CLI/MCP inspection output.

Prompt-time automatic injection skips low-signal greetings and acknowledgements such as `hi`, `hello`, `ok`, and `thanks`, while preserving meaningful technical prompts such as `pnpm`, `docker`, `wrangler`, `how do I run tests`, and continuity prompts.
Broad project-position/next-work continuity prompts receive inspection-first continuity guidance without ordinary recall bodies; topic-specific continuity prompts can still use bounded recall.
The internal `memory-lane route --prompt <text> --json` command exposes the shared deterministic routing decision used by generated bridge adapters.
Release-style generated pi bridges also cap automatic prompt recall context using `contextPolicyPromptMaxItems` as a `memory-lane recall --top-k <n>` bound and `contextPolicyPromptMaxChars` against the escaped blockquote rendering with safe fallbacks, while explicit recall/get tools remain full-fidelity for deliberate inspection.

Global preferences (`category: "preference"`, `kind: "preference"`, or `kind: "workflow_rule"` with `scope: "global"`) are selected in a bounded preference layer so user-wide guidance can travel across projects without crowding out current-project facts, checkpoints, or decisions.
Project-scoped preferences render before global preferences for the same project, which lets narrower project guidance take precedence in context without creating an automatic supersede, cleanup, or override relationship.

For `SessionStart`, baseline memory selection is layered when a project scope is available: current-project preferences, then current-project content, then bounded global preferences, then other global memory and other visible project memory if budget remains.
In `selective` mode, SessionStart renders tiny always-on preference/workflow-rule bodies first, then fills remaining budget with `Memory Index` descriptor cards that point to exact `memory-lane show|get <id>` inspection.
Those tiny full bodies use the same escaped nested-blockquote rendering as prompt-time memory bodies, and their budget is counted after escaping and quoting.
Descriptor cards prefer structured `description` and `fetchHint` metadata when present, otherwise they use generated text previews.
Descriptor ids, type labels, descriptions, fetch hints, and generated previews are compacted to one line and XML-escaped before rendering.
If `memory.handoffMode` is `automatic`, one latest approved current-project handoff pointer can be prioritized before generic baseline layers while still consuming the same `sessionStart` character budget; expired or superseded handoff pointers are omitted.
Prompt-time `UserPromptSubmit` recall remains relevance-based; global preferences are not injected merely because they are global, but relevant global preferences can appear within the `preferenceMaxItems` and `preferenceMaxChars` caps.

To save a user-wide preference from the CLI:

```bash
memory-lane save "Prefer concise final answers" --category preference --scope global
```

To narrow that preference for one project, save a project-scoped preference from that project or pass `--project` explicitly:

```bash
memory-lane save "In this repo, include full verification output" --category preference --scope project --project /path/to/project
```

For MCP clients, use the existing save tool with the same category/scope idea:

```json
memory_save({ "text": "Prefer concise final answers", "category": "preference", "scope": "global" })
memory_save({ "text": "In this repo, include full verification output", "category": "preference", "scope": "project", "projectPath": "/path/to/project" })
```

Use existing inspection surfaces before changing or relying on preference state:

- CLI: `memory-lane list --json`, `memory-lane review --json`, `memory-lane status --json`, and `memory-lane continuity --json`
- MCP: `memory_list`, `memory_review`, `memory_status`, and `memory_continuity({ projectPath })`

`memory-lane status --json`, `memory-lane doctor --json`, and MCP `memory_status` include text-free `preferenceDiagnostics` counts.
These diagnostics show the visible preference pool and SessionStart preference-cap selection counts without returning preference bodies, ids, or previews.
Use `memory-lane list --json`, `memory-lane review --json`, targeted recall, or MCP `memory_list`/`memory_recall` when you need the actual preference text.

The optional `preferenceMaxItems` and `preferenceMaxChars` fields are caps, not guarantees.
Overall `maxItems` and `maxChars` still cap the full rendered memory block.

## Prompt-time continuity guidance

When lifecycle prompt hooks receive natural continuity questions such as “resume building X,” “where was X implemented,” “where are we in the project,” “what is the next item's scope,” “what were we last working on,” or “what should we work on next,” Memory Lane may add a compact inspection-first guidance block.
The guidance leads CLI-capable harnesses to `memory-lane continuity --json` and MCP clients to `memory_continuity({ projectPath })`, then keeps existing status/dashboard and targeted `memory-lane recall "X"` follow-up when a topic is detected.
The routing is deterministic and shared by Claude/Codex lifecycle hooks, repo-local Pi, and generated Pi bridges through the CLI route decision.

Do not answer continuity questions from `memory_recall` alone.
Recall is useful for topic-specific follow-up after continuity inspection, but canonical continuity state comes from `memory-lane continuity --json` or MCP `memory_continuity({ projectPath })`.

This prompt-time guidance is governed by `memory.contextPolicy.mode`: `off` suppresses it, `policy-only` emits guidance without memory bodies, and `selective` renders guidance without ordinary recall bodies for broad project-position/next-work prompts so stale relevant-memory matches do not compete with canonical continuity.
Topic-specific prompts such as “resume building X” or “where was X implemented” can still render guidance before a normal budgeted relevant-memory block.
It does not write memories, run cleanup, change recall ranking, inject additional memory bodies beyond the selected prompt context, or require users to know Memory Lane internal terms such as operating agreements or continuity hints.

## Lifecycle continuity notices

SessionStart lifecycle context may include a compact `Continuity notice` section when `memory.contextPolicy.mode` is `policy-only` or `selective`.
The notice is plain-language and inspection-first: it may say that newer approved state exists, current workflow agreements are available, or continuity hints should be inspected.

Continuity notices share the existing SessionStart context budget.
They do not include memory ids, memory text, transcripts, or tool outputs.
They do not mutate memory, clean up superseded records, change recall ranking, or run on every UserPromptSubmit turn.
Set `memory.contextPolicy.mode` to `off` to disable all lifecycle context, including continuity notices.

## Claude Code hooks

Claude Code CLI users can wire Memory Lane into lifecycle hooks:

```bash
memory-lane claude session-start
memory-lane claude user-prompt-submit
memory-lane claude stop
memory-lane claude post-tool-use
memory-lane claude session-end
memory-lane claude pre-compact
```

`SessionStart` injects a compact session-opening context when allowed by `memory.contextPolicy.mode`: tiny always-on bodies plus `Memory Index` descriptor cards in `selective` mode, and guidance without memory bodies in `policy-only` mode.
The installed Claude Code matcher runs this baseline injection for new, resumed, cleared, post-compaction, and forked sessions.
`UserPromptSubmit` follows the same context policy: `off` suppresses injection, `policy-only` emits guidance without memory bodies, and `selective` injects a small relevant-memory block for ordinary or topic-specific prompts while suppressing ordinary recall bodies for broad `project-position` and `next-work` continuity prompts.
When memory bodies are injected, they use the escaped nested-blockquote renderer described above.
`Stop`, `PreCompact`, and `PostToolUse` save useful memories externally and remain quiet when nothing pending was suggested.
When a write hook saves pending memories, Memory Lane may emit a compact count-only system message such as `Memory Lane: suggested 1 pending memory for review.
Run memory-lane review to approve or reject it.` The notice does not include memory text, prompts, transcripts, or tool output.
Hook commands fail safe: if storage/config/plugin initialization fails, Claude/Codex hook invocations return `{}` and exit successfully so the host session is not blocked; set `MEMORY_LANE_HOOK_DEBUG=1` to also print the initialization failure on stderr.
Hook shutdown waits briefly for background embedding writes and cancels outstanding embedding work after a bounded timeout.
Claude Code's documented `SessionEnd` hook can run `memory-lane claude session-end` to generate pending `session_summary` memories when `memory.sessionEndSummary.enabled` is configured.
By default, Memory Lane still requires confirmation; a bare hook will not save unless `memory.sessionEndSummary.requireConfirmation` is set to `false` or the payload is invoked with `confirmed: true` for manual testing.
Claude Code's `PreCompact` hook can run `memory-lane claude pre-compact` to save pending `session_summary` memories with `pre_compact` provenance before context compaction when `memory.sessionEndSummary.requireConfirmation` is `false` and `memory.preCompactSummary.enabled` is omitted or not `false`; set `memory.preCompactSummary.enabled` to `false` to opt out.
A real Claude Code CLI smoke test in Sitewright confirmed `SessionEnd` fires with the project cwd and saves a pending `session_summary` with Claude `session_end` provenance when enabled and configured.
Set `MEMORY_LANE_HOOK_DEBUG=1` for concise hook diagnostics and persistent metadata/count logs at `~/.memory-lane/hooks-log.jsonl`.
The hook debug log does not include prompts, transcripts, or tool output.

These commands are for Claude Code CLI hooks, not the Claude Desktop app.
Use the MCP Server setup above for Claude Desktop.

## Codex hooks

Codex CLI users can wire Memory Lane into lifecycle hooks:

```bash
memory-lane codex session-start
memory-lane codex user-prompt-submit
memory-lane codex stop
memory-lane codex post-tool-use
memory-lane codex pre-compact
```

`SessionStart` baseline injection is available for compact session-opening context when allowed by `memory.contextPolicy.mode`: tiny always-on bodies plus `Memory Index` descriptor cards in `selective` mode, and guidance without memory bodies in `policy-only` mode.
`UserPromptSubmit` follows the same context policy: `off` suppresses injection, `policy-only` emits guidance without memory bodies, and `selective` injects a small relevant-memory block for ordinary or topic-specific prompts while suppressing ordinary recall bodies for broad `project-position` and `next-work` continuity prompts.
When memory bodies are injected, they use the escaped nested-blockquote renderer described above.
`Stop`, `PreCompact`, and `PostToolUse` save useful memories externally and remain quiet when nothing pending was suggested.
When a write hook saves pending memories, Memory Lane may emit a compact count-only system message such as `Memory Lane: suggested 1 pending memory for review.
Run memory-lane review to approve or reject it.` The notice does not include memory text, prompts, transcripts, or tool output.
Hook commands fail safe: if storage/config/plugin initialization fails, Claude/Codex hook invocations return `{}` and exit successfully so the host session is not blocked; set `MEMORY_LANE_HOOK_DEBUG=1` to also print the initialization failure on stderr.
Hook shutdown waits briefly for background embedding writes and cancels outstanding embedding work after a bounded timeout.
Codex `PreCompact` can run `memory-lane codex pre-compact` to save pending `session_summary` memories with `pre_compact` provenance before context compaction when `memory.sessionEndSummary.requireConfirmation` is `false` and `memory.preCompactSummary.enabled` is omitted or not `false`; set `memory.preCompactSummary.enabled` to `false` to opt out.
If the latest user message explicitly asks to summarize the session (for example, "remember this session"), the supported `Stop` hook path uses `memory.sessionEndSummary` to save a pending session summary for review with `memory-lane review`; do not configure an unsupported Codex `SessionEnd` hook.
Set `MEMORY_LANE_HOOK_DEBUG=1` for concise hook diagnostics and persistent metadata/count logs at `~/.memory-lane/hooks-log.jsonl`.
The hook debug log does not include prompts, transcripts, or tool output.

See `examples/harness-integrations/codex-cli.md` for setup details.
