# MCP Status Tool Spec

## Goal

Add a read-only `memory_status` MCP tool so MCP clients such as Claude Desktop can answer basic Memory Lane setup/status questions without requiring the user to switch to a terminal and run `memory-lane doctor`.

This is Phase 8 Slice 2: MCP status/config visibility.

## User problem

After configuring Claude Desktop MCP, users can save, recall, list, review, approve, reject, and delete memories from the app. They still cannot easily ask the app, "What is my Memory Lane status?" The terminal has `memory-lane doctor`, but MCP clients need a conversational read-only status surface.

## Tool

Add one MCP tool:

```text
memory_status
```

Input schema:

```ts
{
  projectPath?: string
}
```

`projectPath` has the same meaning as existing MCP tools: when present, the handler refreshes project scope from that directory before reading status.

## Output

The tool returns the existing MCP JSON envelope shape:

```json
{
  "ok": true,
  "data": {
    "status": {
      "configFile": "/Users/example/.memory-lane/config.json",
      "configExists": true,
      "semanticEnabled": false,
      "memoryFile": "/Users/example/.memory-lane/memory.jsonl",
      "embeddingFile": "/Users/example/.memory-lane/embeddings.jsonl",
      "totalMemories": 12,
      "approvedMemories": 10,
      "pendingMemories": 2,
      "deletedMemories": 0,
      "embeddingCount": 0,
      "activeProfileName": "local",
      "projectScope": "memory-lane-project-key",
      "integrations": {
        "summary": {
          "mcpExplicitToolsOnly": true,
          "hooksAutomaticLifecycle": true,
          "piAutosaveEnabled": false
        }
      }
    },
    "notes": [
      "MCP provides explicit Memory Lane tools only; it does not run lifecycle hooks.",
      "Use memory-lane doctor in a terminal for the same read-only diagnostics outside MCP."
    ]
  },
  "meta": {
    "projectScope": "memory-lane-project-key"
  }
}
```

The `status` object should be based on `MemoryEngine.doctor()` so CLI and MCP diagnostics stay consistent. The tool may include all doctor fields, including semantic warnings, hook debug metadata, Obsidian mirror diagnostics, and integration diagnostics, because doctor is already read-only and privacy constrained.

## UX requirements

Claude Desktop should be able to call `memory_status` when the user asks questions like:

- "Use Memory Lane to check my status."
- "How many pending memories do I have?"
- "Is semantic search enabled?"
- "What project scope is Memory Lane using here?"

The tool should not include raw memory text. It should expose counts, paths, booleans, warnings, and integration/status metadata only.

## Safety and privacy

`memory_status` is read-only.

It must not:

- save, suggest, approve, reject, delete, update, or compact memories;
- read prompts;
- read transcripts;
- read tool inputs or outputs;
- inspect MCP traffic;
- read hook debug log contents;
- create config folders or repair configs;
- run `reindex`;
- add lifecycle automation.

It may call `MemoryEngine.doctor()`, which performs read-only diagnostics.

## Registration

Add `memory_status` to:

- `MEMORY_LANE_TOOL_NAMES`;
- MCP server tool registration;
- README MCP tool list;
- `examples/harness-integrations/mcp.md` tool list.

## Tests

Use TDD.

Required tests:

1. Handler test: `memory_status` returns doctor counts and status metadata without memory text.
2. Handler test: `projectPath` updates project scope, matching other MCP tools.
3. Server test: `MEMORY_LANE_TOOL_NAMES` includes `memory_status`.
4. Server test: MCP server registers `memory_status`.
5. Docs/reference check for the new tool in README and MCP example docs.

## Non-goals

This slice will not add:

- MCP resources;
- MCP prompts;
- HTTP/SSE transport;
- separate Obsidian MCP status beyond existing doctor fields;
- automatic lifecycle behavior;
- Codex `SessionStart` baseline injection;
- pi autosave or tool-outcome capture;
- config repair/install commands.

## Success criteria

A user can ask Claude Desktop to check Memory Lane status and get read-only counts/config/project/integration information through MCP.

The implementation stays small, uses existing doctor data, preserves the MCP JSON envelope style, and does not expose memory text or add automation.
