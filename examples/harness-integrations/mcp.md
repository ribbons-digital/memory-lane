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

## Tools

- `memory_save`
- `memory_suggest`
- `memory_recall`
- `memory_status`
- `memory_list`
- `memory_review`
- `memory_approve`
- `memory_reject`
- `memory_delete`

Ask your MCP client: "Use Memory Lane to check my status." The client can call `memory_status` to inspect counts, project scope, semantic status, storage/config paths, and integration diagnostics without modifying memory.

Use `memory_review` to list pending memories, then `memory_approve` or `memory_reject` with a memory `id` to finish the review loop. Use `memory_delete` with a memory `id` to soft-delete an existing memory.

Each tool accepts optional `projectPath` where project-scoped behavior should be resolved from a specific directory. If omitted, Memory Lane uses the MCP server process current working directory.
