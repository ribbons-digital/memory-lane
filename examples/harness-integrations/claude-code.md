# Memory Lane Integration for Claude Code CLI

This integration is for **Claude Code CLI hooks and slash commands only**. It does **not** apply to the Claude Desktop app, which uses MCP.

## Recommended setup: run `memory-lane init`

The easiest way to configure Claude Code CLI is to run:

```bash
memory-lane init
```

This detects Claude Code CLI and installs:
- Lifecycle hooks in `~/.claude/settings.json`
- A personal skill at `~/.claude/skills/memory-lane/SKILL.md` so `/memory-lane` is available as a slash command

Use `memory-lane init --yes` to auto-accept all detected harnesses.

## Manual setup: Claude Code hooks

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane claude session-start",
            "timeout": 10,
            "statusMessage": "Loading memory context"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane claude user-prompt-submit",
            "timeout": 10,
            "statusMessage": "Retrieving relevant memory"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane claude stop",
            "timeout": 10,
            "statusMessage": "Saving useful memory"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane claude session-end",
            "timeout": 20,
            "statusMessage": "Summarizing session memory"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane claude post-tool-use",
            "timeout": 10,
            "statusMessage": "Capturing useful tool outcome"
          }
        ]
      }
    ]
  }
}
```

Use `/hooks` in Claude Code to inspect active hooks and verify the settings file they came from.

## Real-world `SessionEnd` smoke test

A real Claude Code CLI smoke test in Sitewright confirmed that `SessionEnd` fires and can save a pending session summary when configured with an OpenAI-compatible provider and `memory.sessionEndSummary.requireConfirmation: false` for the test run. The debug log entry had:

```json
{
  "adapter": "claude",
  "event": "session-end",
  "cwd": "/Users/shiang/projects/ribbons-digital/sitewright",
  "status": "ok",
  "saved": 1
}
```

The saved memory was pending, scoped to the Sitewright project, and included:

```json
{
  "source": "session-summary",
  "kind": "session_summary",
  "provenance": {
    "adapter": "claude",
    "lifecycleEvent": "session_end"
  }
}
```

For isolated testing, prefer absolute temp paths in hook commands, for example `MEMORY_LANE_FILE=/tmp/ml-claude-sitewright.xxxxxx/memory.jsonl`. Do not use shell variables such as `$tmp` inside `settings.local.json`; Claude runs hook commands in its own shell and will not inherit your interactive variable.

## What each hook does

`SessionStart` injects compact session-opening context when a new Claude Code session begins. In `selective` mode, it can include tiny always-on memory bodies plus `Memory Index` descriptor cards that point to exact `memory-lane show|get <id>` inspection; descriptor cards use stored metadata when present and generated previews otherwise. It uses a stricter budget than `UserPromptSubmit` and does not dump the full project history. It is safe to leave enabled alongside `UserPromptSubmit`.

`UserPromptSubmit` uses the shared prompt route decision before Claude processes the prompt. Low-signal prompts inject nothing, memory-management prompts get list/status/review guidance, broad project-position or next-work prompts get continuity guidance without ordinary recall bodies, and eligible ordinary or topic-specific prompts can receive relevant approved memories via `hookSpecificOutput.additionalContext`.

`Stop` does not inject context. It can save durable turn-level memories after Claude finishes responding.

`SessionEnd` is supported by Claude Code and can generate pending `session_summary` memories when `memory.sessionEndSummary.enabled` is configured. By default, Memory Lane still requires confirmation; a bare hook will not save unless `memory.sessionEndSummary.requireConfirmation` is set to `false` or the payload is invoked with `confirmed: true` for manual testing.

`PostToolUse` does not inject context. It can save durable tool-outcome memories, such as successful test commands or package-manager workflow rules.

## Sandboxed storage

Memory Lane prefers global storage at `~/.memory-lane/`. If Claude Code asks for permission to write there, approving it keeps memories global across projects.

If home storage is not writable and no explicit `MEMORY_LANE_*` paths are set, Memory Lane automatically initializes `.memory-lane/` inside the project and continues with project-local storage. You can also initialize it explicitly:

```bash
memory-lane init --project-local --project /path/to/project
```

Explicit `MEMORY_LANE_FILE`, `MEMORY_LANE_EMBEDDINGS_FILE`, and `MEMORY_LANE_CONFIG` paths always win and never auto-fallback.

## Privacy and review

Memory Lane inspects prompts, bounded transcript tails, and bounded tool-output previews locally. It does not save raw transcripts, hook payloads, prompts, tool inputs, or full tool outputs. Secret detection runs before save and before injection.

Review pending inferred memories with:

```bash
memory-lane review
```

## Debugging

Enable concise hook diagnostics with:

```bash
MEMORY_LANE_HOOK_DEBUG=1
```

Debug output uses Claude Code `systemMessage` responses and also appends persistent records to `~/.memory-lane/hooks-log.jsonl`. The log contains counts and metadata only, not prompts, transcripts, or tool output.

## Fallback: prompt instructions

If your Claude Code version does not support hooks, add CLI-use instructions to your Claude instructions and call `memory-lane save`, `memory-lane recall`, and `memory-lane review` manually or through model-invoked shell commands.

```markdown
## Memory
Use the memory-lane CLI for persistent memory:
- Save approved durable decisions/facts: `memory-lane save "X" --status approved`
- Recall relevant memory: `memory-lane recall "query"`
- Review pending suggestions: `memory-lane review`
```
