# Memory Lane MCP Server

Memory Lane's MCP server is a local stdio server for explicit memory tool access.

## Build

From the Memory Lane repo:

```bash
pnpm --filter @memory-lane/mcp-server build
```

The package exposes the `memory-lane-mcp` bin, and the direct stdio entrypoint is:

```bash
node /absolute/path/to/memory-lane/packages/mcp-server/dist/index.js
```

Do not use a wrapper that prints to stdout. Stdio MCP servers use stdout for JSON-RPC messages.
When stdin closes, the server waits briefly for background embedding writes and then cancels outstanding embedding work after a bounded shutdown timeout.

## Claude Desktop

Add a local stdio server entry in Claude Desktop's MCP configuration. Use absolute paths:

```json
{
  "mcpServers": {
    "memory-lane": {
      "command": "node",
      "args": ["/absolute/path/to/memory-lane/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop after editing the configuration.

## Cursor

Use Cursor's MCP server configuration with the same local stdio command:

```json
{
  "mcpServers": {
    "memory-lane": {
      "command": "node",
      "args": ["/absolute/path/to/memory-lane/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Client configuration UI and file locations may vary by Cursor version; keep the command and args shape the same.

## Claude Code and Codex

Claude Code and Codex can continue using Memory Lane lifecycle hooks for automatic recall/save behavior. MCP is separate: it gives explicit tool access when the client supports MCP tools. Do not configure MCP expecting it to run lifecycle hook events.

## Prompting tip

In clients such as Claude Desktop and Codex Desktop, the model may try the `memory-lane` CLI first. If the CLI runs inside a sandboxed environment without write access to `~/.memory-lane`, the model will usually fall back to the MCP tools automatically, but only after a visible error turn. To avoid that detour, explicitly ask the model to use the Memory Lane MCP, e.g.:

> "Use the Memory Lane MCP to save that I prefer pnpm."
> "Using the Memory Lane MCP, check continuity for what we were working on."

## Tools

- `memory_save`
- `memory_suggest`
- `memory_recall` for specific topic or fact queries
- `memory_continuity` for broad prior-work, next-action, project-status, resume, and handoff-style prompts
- `memory_status`
- `memory_list`
- `memory_review`
- `memory_approve`
- `memory_reject`
- `memory_delete`

Ask your MCP client: "Use Memory Lane to check my status."
The client should call `memory_continuity` before `memory_recall` for broad prior-work, next-action, project-status, resume, and handoff-style prompts.
It can call `memory_status` to inspect counts, project scope, semantic status, storage/config paths, legacy project-memory diagnostics, and integration diagnostics without modifying memory.
Legacy project-memory diagnostics are read-only and may include bounded sample previews when legacy home-stored project memories exist.

Use `memory_review` to list pending memories, then `memory_approve` or `memory_reject` with a memory `id` to finish the review loop.
Use `memory_delete` with a memory `id` to soft-delete an existing memory.
When opt-in local learning capture is enabled, these review and mutation tools emit content-free exposure or outcome events with hashed ids, digests, event enums, and actor metadata, never memory text.

Each tool accepts optional `projectPath` where project-scoped behavior should be resolved from a specific directory.
If omitted, Memory Lane uses the project scope captured when the MCP server started, usually from the server process current working directory.
Explicit `projectPath` calls are isolated to that request and do not change the startup scope used by later omitted-path calls.
With default storage, write tools use `projectPath` to route new project-scoped memories to that project's `.memory-lane/`, while read tools use it to merge that project store with the home store without creating fallback storage.
