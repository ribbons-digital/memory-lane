# MCP Server MVP Design

## Goal

Expose Memory Lane through a local stdio MCP server so MCP-capable clients can explicitly save, suggest, recall, list, and review memories without changing Memory Lane's JSONL storage model or lifecycle hook behavior.

This first slice is tools-only and local-only. It is intended to unlock Claude Desktop, Cursor, and other local MCP clients while keeping hooks as the separate automatic lifecycle integration path.

## Background

Memory Lane already exposes memory operations through:

- CLI commands in `@memory-lane/cli`.
- Harness lifecycle adapters for Codex and Claude Code hooks.
- pi extension commands/tools.
- Core APIs in `@memory-lane/core`, especially `MemoryEngine`.

Claude Desktop should not use the Claude Code hook adapter. MCP is the correct integration path for Claude Desktop and other clients that can call tools but do not run Memory Lane lifecycle hooks.

The MCP TypeScript SDK supports local stdio servers with `McpServer` and `StdioServerTransport`. A stdio server must reserve stdout for JSON-RPC protocol messages; any diagnostics must go to stderr.

## Design Principles

1. **MVP first:** implement only the Phase 7 roadmap tools over stdio.
2. **Explicit tool access:** MCP tools are called deliberately by the model/client; they do not add automatic saves or recall injection.
3. **Reuse core behavior:** use `MemoryEngine` for validation, project scope, duplicate detection, secret detection, semantic recall, review, and mirror side effects.
4. **JSONL remains source of truth:** no storage backend changes.
5. **Easy local setup:** provide a bin command that MCP clients can spawn.
6. **Safe stdio behavior:** do not write non-protocol output to stdout.
7. **Phase boundary discipline:** resources, prompts, HTTP transport, hook/MCP conflict diagnostics, and Obsidian status are Phase 8 or later.

## Package

Add a workspace package:

```text
packages/mcp-server/
```

Package name:

```text
@memory-lane/mcp-server
```

Binary:

```text
memory-lane-mcp
```

The binary starts a stdio MCP server and connects it to stdin/stdout.

The package depends on:

- `@memory-lane/core`
- `@modelcontextprotocol/sdk`
- `zod` if required by the selected MCP SDK API
- TypeScript test/build dependencies matching existing packages

Expected SDK imports for the first implementation are:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
```

The package should expose testable handler helpers separately from the server startup path so tests can validate tool behavior without needing a full MCP client process.

## Startup Contract

`memory-lane-mcp` starts with:

1. Resolve writable storage paths with `resolveWritableMemoryPaths({ cwd: process.cwd(), env: process.env, autoInitProjectLocalOnHomeFailure: true })`, matching the CLI's default startup behavior.
2. Create a `MemoryEngine` with the resolved memory path, embeddings path, config path, and optional embedding provider when semantic search is configured.
3. Register the five MVP tools.
4. Connect an MCP stdio transport.

If startup fails, write a concise diagnostic to stderr and exit nonzero. Do not print startup banners to stdout.

## Project Scoping

Each tool may accept an optional `projectPath` string.

Resolution rules:

1. If `projectPath` is provided, refresh the engine scope with that path before executing the operation.
2. If omitted, use the server process current working directory scope.
3. The resulting scope behavior is whatever `MemoryEngine` and `resolveProjectScope` provide, including `.memory-lane-scope` priority and Git worktree-aware identity.

This mirrors the CLI's `--project <path>` behavior without introducing a new project alias system.

## Tool Output Contract

All tools return a compact JSON payload in MCP text content. When supported by the SDK without extra complexity, also return the same object as `structuredContent`.

Successful tool responses use this envelope:

```ts
{
  ok: true,
  data: unknown,
  meta?: {
    count?: number
    projectScope?: string | "none"
  }
}
```

Expected validation or operation errors use:

```ts
{
  ok: false,
  error: string
}
```

`MemoryEngine.save` skipped results are not transport errors. They return `ok: true` with the skipped status and reason, matching CLI JSON semantics.

Unexpected exceptions should be converted into `{ ok: false, error }` tool payloads unless the MCP SDK requires thrown errors for schema/transport failures. The implementation plan may narrow this further if SDK behavior requires it, but ordinary Memory Lane operation failures should stay visible in the JSON envelope.

## Tools

### `memory_save`

Purpose: explicitly save an approved memory.

Inputs:

```ts
{
  text: string
  category?: "preference" | "personal" | "project"
  scope?: "global" | "project"
  kind?: "preference" | "personal_context" | "project_fact" | "project_checkpoint" | "workflow_rule" | "decision" | "misc"
  projectPath?: string
}
```

Behavior:

- Calls `MemoryEngine.save` with `status: "approved"`.
- Uses Memory Lane validation and secret detection.
- Returns saved memory or skipped reason.

### `memory_suggest`

Purpose: queue or optionally approve a memory suggestion.

Inputs:

```ts
{
  text: string
  category?: "preference" | "personal" | "project"
  scope?: "global" | "project"
  kind?: "preference" | "personal_context" | "project_fact" | "project_checkpoint" | "workflow_rule" | "decision" | "misc"
  status?: "pending" | "approved"
  projectPath?: string
}
```

Behavior:

- Defaults `status` to `pending`.
- Calls `MemoryEngine.suggest`.
- Supports `status: "approved"` so clients can model the existing pi `memory_suggest` auto-approve escape hatch without needing a separate tool.
- Does not allow `rejected` or `deleted` as inputs.

### `memory_recall`

Purpose: retrieve relevant memories for an explicit query.

Inputs:

```ts
{
  query?: string
  projectPath?: string
}
```

Behavior:

- Calls `MemoryEngine.recall(query ?? "")`.
- Returns memories, semantic metadata, and notice when present.
- Does not inject recalled memory into the conversation automatically; the MCP client/model decides how to use the tool result.

### `memory_list`

Purpose: list memories visible to the current/project scope by default.

Inputs:

```ts
{
  status?: "pending" | "approved" | "rejected" | "deleted"
  all?: boolean
  projectPath?: string
}
```

Behavior:

- Calls `MemoryEngine.list({ status, all })`.
- `all` defaults to false, preserving scoped visibility.
- Returns memory array and count.

### `memory_review`

Purpose: list pending memories for review.

Inputs:

```ts
{
  projectPath?: string
}
```

Behavior:

- Calls `MemoryEngine.reviewPending()`.
- Returns pending memories and count.
- First slice is list-only. Approve/reject MCP tools are deliberately not part of Phase 7 unless added to a later approved slice.

## Non-Goals

1. No MCP resources.
2. No MCP prompts.
3. No HTTP, SSE, or remote transport.
4. No lifecycle recall injection or automatic memory writes.
5. No hook/MCP duplicate setup diagnostics.
6. No Obsidian mirror/import/status tools.
7. No Claude Desktop-specific behavior beyond setup docs.
8. No new storage backend or migration behavior.
9. No project alias/glob configuration.
10. No approve/reject/delete/update MCP tools in this first slice.

## Testing Strategy

Tests should prioritize deterministic unit coverage over full client-process integration in the first slice.

Required tests:

1. Handler tests for `memory_save` approved saves and skipped secret/duplicate behavior.
2. Handler tests for `memory_suggest` pending default and approved status override.
3. Handler tests for `memory_recall` output envelope and semantic metadata shape.
4. Handler tests for `memory_list` scoped/default and `all` behavior using temporary storage plus distinct project scopes.
5. Handler tests for `memory_review` pending memory output.
6. Project path test proving `projectPath` refreshes scope before operation.
7. Server package build test through the workspace build command.

If direct MCP registration tests are lightweight, add a smoke test that asserts the server registers the expected tool names. Do not require Claude Desktop, Cursor, or a live MCP client for automated tests.

## Documentation

Update documentation for:

1. Installing/building the MCP server package in the workspace.
2. Claude Desktop local stdio configuration.
3. Cursor local MCP configuration.
4. Claude Code and Codex notes: MCP provides explicit tool access; existing hooks remain the automatic lifecycle path.
5. Tool descriptions and key inputs.
6. Privacy/source-of-truth notes: JSONL remains canonical; MCP does not enable Obsidian-backed storage or automatic saves.

Docs should avoid overpromising exact client UI behavior where client versions differ. Prefer generic JSON snippets and troubleshooting notes about stdio stdout.

## Acceptance Criteria

1. `@memory-lane/mcp-server` exists as a workspace package with a `memory-lane-mcp` bin.
2. The stdio server registers the five Phase 7 tools: `memory_save`, `memory_suggest`, `memory_recall`, `memory_list`, and `memory_review`.
3. Tools reuse `MemoryEngine` and existing project scope/storage/config behavior.
4. `projectPath` provides CLI-like project scope override for each tool.
5. Tool outputs use a consistent JSON envelope and expose skipped save reasons without throwing.
6. The server does not write non-protocol output to stdout.
7. Automated tests cover tool handlers and project-path scoping.
8. `pnpm build` and `pnpm test` pass.
9. README and integration docs explain local MCP setup and the boundary between MCP explicit tools and hook lifecycle automation.
