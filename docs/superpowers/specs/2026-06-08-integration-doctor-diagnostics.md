# Integration Doctor Diagnostics Spec

## Goal

Add read-only integration diagnostics to `memory-lane doctor` so users can understand which Memory Lane integrations appear configured locally and how MCP and lifecycle hooks differ.

This is Phase 8 Slice 1: MCP + Hooks Coordination observability. It should improve setup confidence without adding new automation.

## User problem

Memory Lane can now be used through several surfaces:

- CLI commands;
- Claude Desktop or Cursor through MCP tools;
- Codex hooks;
- Claude Code CLI hooks;
- pi extension tools and read-only lifecycle recall.

A user can reasonably ask: "Is Memory Lane active here, and which integration is responsible for what?" Today `memory-lane doctor` reports storage, semantic, hook debug log, and Obsidian diagnostics, but not whether local app integrations appear configured.

## Requirements

### Doctor output

`memory-lane doctor` and `memory-lane doctor --json` must include a new read-only integration diagnostics section.

The diagnostics must report:

1. Claude Desktop MCP config:
   - config path checked: `~/Library/Application Support/Claude/claude_desktop_config.json`;
   - whether the file exists;
   - whether `mcpServers.memory-lane` is configured;
   - whether that server has a command and args array.
2. Codex hook config:
   - user config path checked: `~/.codex/hooks.json`;
   - project config path checked: `<project cwd>/.codex/hooks.json` when a project cwd is known;
   - whether each config exists;
   - whether each config contains command strings for `memory-lane codex user-prompt-submit`, `memory-lane codex stop`, and `memory-lane codex post-tool-use`.
3. Claude Code hook config:
   - user config paths checked: `~/.claude/settings.json` and `~/.claude/settings.local.json`;
   - project config path checked: `<project cwd>/.claude/settings.local.json` when a project cwd is known;
   - whether each config exists;
   - whether each config contains command strings for `memory-lane claude user-prompt-submit`, `memory-lane claude stop`, and `memory-lane claude post-tool-use`.
4. pi extension:
   - extension path checked: `~/.pi/agent/extensions/memory-lane/index.ts`;
   - whether the file exists;
   - whether the file appears to reference Memory Lane.
5. A concise note explaining the boundary:
   - MCP provides explicit tools.
   - Hooks provide automatic lifecycle recall/save where supported.
   - pi currently has manual tools and read-only lifecycle recall; pi autosave/tool capture remains deferred.

### Privacy and safety

The diagnostics must be read-only and non-mutating.

They must not read or report:

- prompts;
- transcripts;
- tool inputs;
- tool outputs;
- memory text;
- MCP traffic;
- hook debug log contents.

It is acceptable to read config files and extension entrypoint text in order to detect Memory Lane command strings. Human output should avoid dumping raw config contents. JSON output should expose booleans, checked paths, and warnings, not raw config bodies.

### Error handling

Missing config files are not warnings. They should report `exists: false` and `configured: false`.

Invalid JSON config files should not make `doctor` fail. They should report `configured: false` plus a warning naming the unreadable config path and reason category, without echoing file contents.

Unreadable files should not make `doctor` fail. They should report a warning and continue.

### Project path behavior

`memory-lane doctor --project <path>` should use that path when checking project-level hook config files.

Without `--project`, doctor should use the engine's current project scope cwd when available. If no project cwd is available, project-level checks should report a `checkedPath` of `null` and `exists: false`.

### Output shape

JSON output should include a nested object:

```json
{
  "integrations": {
    "summary": {
      "mcpExplicitToolsOnly": true,
      "hooksAutomaticLifecycle": true,
      "piAutosaveEnabled": false
    },
    "claudeDesktopMcp": {
      "checkedPath": "/Users/example/Library/Application Support/Claude/claude_desktop_config.json",
      "exists": true,
      "configured": true,
      "hasCommand": true,
      "hasArgs": true,
      "warnings": []
    },
    "codexHooks": {
      "user": {
        "checkedPath": "/Users/example/.codex/hooks.json",
        "exists": true,
        "configured": true,
        "commands": {
          "userPromptSubmit": true,
          "stop": true,
          "postToolUse": true
        },
        "warnings": []
      },
      "project": {
        "checkedPath": "/Users/example/project/.codex/hooks.json",
        "exists": false,
        "configured": false,
        "commands": {
          "userPromptSubmit": false,
          "stop": false,
          "postToolUse": false
        },
        "warnings": []
      }
    },
    "claudeCodeHooks": {
      "user": {
        "checkedPaths": ["/Users/example/.claude/settings.json", "/Users/example/.claude/settings.local.json"],
        "exists": false,
        "configured": false,
        "commands": {
          "userPromptSubmit": false,
          "stop": false,
          "postToolUse": false
        },
        "warnings": []
      },
      "project": {
        "checkedPath": null,
        "exists": false,
        "configured": false,
        "commands": {
          "userPromptSubmit": false,
          "stop": false,
          "postToolUse": false
        },
        "warnings": []
      }
    },
    "piExtension": {
      "checkedPath": "/Users/example/.pi/agent/extensions/memory-lane/index.ts",
      "exists": true,
      "detected": true,
      "warnings": []
    },
    "notes": [
      "MCP provides explicit Memory Lane tools only; it does not run lifecycle hooks.",
      "Codex and Claude Code hooks provide automatic lifecycle recall/save where configured.",
      "pi currently supports manual Memory Lane tools and read-only lifecycle recall; pi autosave/tool capture is deferred."
    ]
  }
}
```

Human output may keep the existing flat `key: value` doctor formatter for this slice, but nested objects must remain readable enough when stringified. If a focused formatting improvement is needed to avoid `[object Object]`, it should be limited to doctor output only.

## Implementation notes

Add a focused diagnostics module rather than placing all filesystem scanning inside `MemoryEngine.doctor()`.

Suggested module:

```text
packages/core/src/integration-diagnostics.ts
```

The module should accept injected paths and filesystem helpers where useful so tests do not depend on the developer's real home directory.

`MemoryEngine.doctor()` should call the diagnostics module with:

- `cwd`: the active project scope cwd if available;
- `env`: the engine environment;
- default home-derived paths when no test overrides are supplied.

If constructor options are needed for testability, add a narrow optional `integrationPaths` or `integrationDiagnostics` option to `MemoryEngineConfig` rather than broad global state.

## Tests

Use TDD.

Core tests should cover:

1. Claude Desktop MCP configured and missing cases.
2. Codex user/project hook command detection.
3. Claude Code user/project hook command detection across the two user config files.
4. pi extension detection.
5. invalid JSON warnings without throwing.
6. doctor remains read-only: missing config parent folders are not created.

CLI tests should cover:

1. `memory-lane doctor --json` includes `integrations`.
2. human `memory-lane doctor` includes the integration section or readable integration fields.

## Non-goals

This slice will not:

- modify any integration config;
- install or repair integrations;
- validate whether Claude Desktop, Cursor, Codex, Claude Code, or pi are running;
- inspect MCP sessions or hook runtime events;
- read hook debug log contents;
- add MCP resources or prompts;
- add HTTP/SSE transport;
- add Codex `SessionStart` baseline injection;
- add pi autosave or tool-outcome capture;
- add Obsidian MCP status.

## Success criteria

A user can run `memory-lane doctor` and see whether common Memory Lane integrations appear configured locally, plus clear notes explaining MCP versus hook responsibilities.

The command remains read-only, privacy-safe, and resilient to missing or malformed integration config files.
