# MCP server

Memory Lane includes a local stdio MCP server for clients that support explicit MCP tools, such as Claude Desktop and Cursor.
The workspace package is `@memory-lane/mcp-server`, and its built bin is `memory-lane-mcp`.
`memory-lane init` configures Claude Desktop and Codex Desktop to launch the installed Memory Lane binary with `memory-lane mcp`; run the same command manually when a client needs an explicit stdio server command.
The command loads `MEMORY_LANE_CONFIG` when explicitly set; otherwise it resolves `.memory-lane/config.json` from `HOME`, falling back to the operating system home directory when MCP clients omit `HOME` on Windows.

The MCP server exposes explicit tools only.
When local learning capture is enabled, `memory_review` records content-free suggestion exposure events and mutation tools record their review outcome events.

- `memory_save` - save an approved memory
- `memory_suggest` - queue a pending suggestion and return its candidate-specific targeted review receipt, or save approved when `status: "approved"`
- `memory_revise` - revise the same pending suggestion ID and return its rerun targeted review receipt
- `memory_recall` - recall relevant memories for a specific topic or fact query
- `memory_continuity` - canonical continuity read model for broad prior-work, project resumption, last-worked-on, accomplished, next-action, project-status, resume, and handoff-style questions; accepts optional `query` for read-only workstream discovery
- `memory_status` - read Memory Lane counts, config paths, project scope, legacy project-memory diagnostics, and integration diagnostics
- `memory_list` - list memories visible to the current project scope by default
- `memory_review` - list pending memories with advisory deterministic `qualitySignals`, visible to the current project scope by default; supports `kind`, `source`, `provenance`, and signal-code array filters such as `signal: ["contains-question", "contains-code-fence"]`; pass `all: true` only for cross-project maintenance
- `memory_approve` - approve a memory by id within the current project scope; pass `all: true` only for cross-project maintenance
- `memory_reject` - reject a memory by id within the current project scope; pass `all: true` only for cross-project maintenance
- `memory_delete` - soft-delete a memory by id within the current project scope; pass `all: true` only for cross-project maintenance

MCP tools use global plus the requested `projectPath` by default.
When `projectPath` is omitted, they use the project scope captured when the MCP server started; if the server started without an active project scope, omitted-path calls are global-only.
An explicit `projectPath` is scoped to that one tool call and does not change the scope used by later omitted-path reads or mutations.
Explicit `all: true` bypasses this boundary for administrative workflows; a refused cross-project id returns `not_found` without returning the target memory text.

Use `memory_continuity({ projectPath })` from MCP clients before answering continuity questions such as project resumption, last-worked-on, accomplished, next-action, or project-status prompts.
Use `memory_continuity({ projectPath, query: "resume building X" })` when the user asks for a specific workstream.
Prefer it over `memory_recall` for continuity; `memory_recall` is a topic-specific follow-up after continuity inspection, not an authority by itself.
When `memory_recall` omits `query`, or provides a query that trims to an empty string, it returns approved memories visible to that call's scope in newest-`updatedAt`-first order.
Results are bounded by `semantic.retrieval.topK`, with equal `updatedAt` values ordered by newest `createdAt` and then by memory ID.
This empty-query path does not invoke semantic search and reports `semantic.used: false`.

Use `memory_status` from MCP clients when you want the same kind of read-only setup/status overview that `memory-lane doctor` provides in a terminal.
It reports counts and diagnostics only; it does not return raw memory text or run lifecycle hooks, except that legacy project-memory diagnostics may include bounded sample previews when legacy candidates exist.
Use filtered `memory_review` calls when you want an MCP client to inspect only pending session summaries or continuity candidates from a specific adapter/event before approving or rejecting them.

## Candidate-specific suggestion review

A pending `memory_suggest` call creates one candidate and immediately runs deterministic quality analysis on that exact ID.
It does not analyze or mutate the broader pending backlog returned by `memory_review`.
The tool returns the normal save result plus `targetedReviewReceipt`, both in the JSON text content and structured result, followed by host guidance for the receipt outcome.
If `status: "approved"` is explicit, `memory_suggest` keeps direct-approved semantics and returns no targeted receipt.

The receipt includes `id`, `currentText`, `scope`, `kind`, `qualitySignals`, `reasons`, `suggestedAction`, `attemptState`, and `outcome`.
`attemptState` reports revisions used, the maximum of two, and revisions remaining.
A `clean` outcome means no quality signals remain, so the pending candidate is ready for explicit human approval or rejection.
It never means automatic approval.
A `revise` outcome asks the host LLM to call the canonical `memory_revise` tool with revised text and the same ID, then follow the rerun receipt.
A `needs-human-review` outcome stops the automatic rewrite loop and leaves the candidate pending for a human decision.

`memory_revise` preserves the same pending ID and scope, increments the automatic review attempt count, and analyzes only that revised candidate.
The host may make at most two explicit automatic revisions after the initial suggestion.
If fixable signals remain after the second revision, the receipt settles on `needs-human-review`, and further automatic revision calls are refused.
Findings that text rewriting cannot fix, such as a cross-project global scope concern, go directly to `needs-human-review` without consuming a revision attempt.
Soft or ambiguous signals may recommend a rewrite, but they never approve or reject a candidate automatically.
Only an explicit human decision through `memory_approve` or `memory_reject` changes the pending review status.

**Tip for Claude Desktop and Codex Desktop:** if you ask the model to save or recall a memory without mentioning the MCP, it may first try the `memory-lane` CLI, fail because the sandbox cannot write to `~/.memory-lane`, and then fall back to MCP.
To skip that error turn, explicitly say "use the Memory Lane MCP" in your request.

MCP does not replace lifecycle hooks.
Hooks provide automatic recall/save behavior for supported harnesses; MCP gives the model explicit tool access when the client asks for it.
JSONL remains the source of truth, and Obsidian support remains optional.

Manual client configuration always uses the same shape `memory-lane init` writes: the absolute installed `memory-lane` binary path as the command with `args: ["mcp"]`.
See `examples/harness-integrations/mcp.md` for per-client examples.

To run the built server source directly in a terminal for testing (not as a client setting):

```bash
pnpm --filter @memory-lane/mcp-server build
node packages/mcp-server/dist/index.js
```

Do not wrap the server with commands that print banners to stdout.
MCP stdio reserves stdout for JSON-RPC protocol messages.

When stdin closes, the server waits briefly for background embedding writes from all project-scoped engines, then cancels outstanding embedding work after a bounded timeout so shutdown does not hang.

