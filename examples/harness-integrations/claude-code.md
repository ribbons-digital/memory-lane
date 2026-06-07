# Memory Lane Integration for Claude Code CLI

This integration is for **Claude Code CLI hooks only**. It does **not** apply to the Claude Desktop app, which would need a separate MCP-style integration.

## Recommended setup: Claude Code hooks

Start with project-level `.claude/settings.local.json` while testing Memory Lane in one repository. Move equivalent hooks to `~/.claude/settings.json` after you trust the behavior globally.

```json
{
  "hooks": {
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

## What each hook does

`UserPromptSubmit` recalls relevant approved memories and injects them via `hookSpecificOutput.additionalContext` before Claude processes the prompt.

`Stop` does not inject context. It can save durable turn-level memories after Claude finishes responding.

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
