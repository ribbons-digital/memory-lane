# Memory Lane Integration for OpenAI Codex CLI

## Recommended setup: Codex hooks

Start with project-level `.codex/hooks.json` while testing Memory Lane in one repository. Move the same hooks to user-level `~/.codex/hooks.json` after you trust the behavior globally.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane codex user-prompt-submit",
            "timeoutSec": 10,
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
            "command": "memory-lane codex stop",
            "timeoutSec": 10,
            "statusMessage": "Saving useful memory"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|shell:*",
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane codex post-tool-use",
            "timeoutSec": 10,
            "statusMessage": "Capturing useful tool outcome"
          }
        ]
      }
    ]
  }
}
```

Codex tool matcher names can vary by version. If `PostToolUse` does not fire, adjust the matcher to the shell tool name shown by your Codex installation.

## Context budget

`UserPromptSubmit` injects only approved memories that are relevant to the current prompt. It has strict item and character limits, and generic prompts such as `ok`, `continue`, or `thanks` inject nothing.

`Stop` and `PostToolUse` do not inject context. They save concise memories externally and are silent by default.

## Sandboxed storage

Memory Lane prefers global storage at `~/.memory-lane/`. If Codex asks for permission to write there, approving it keeps memories global across projects.

If home storage is not writable and no explicit `MEMORY_LANE_*` paths are set, Memory Lane automatically initializes `.memory-lane/` inside the project and continues with project-local storage. You can also initialize it explicitly:

```bash
memory-lane init --project-local --project /path/to/project
```

This creates `.memory-lane/` inside the project and prints environment variables you can add to hook configuration if needed. Commands run with `--project /path/to/project` automatically prefer `.memory-lane/` when it exists.

## Privacy and review

Memory Lane inspects prompts, bounded transcript tails, and bounded tool-output previews locally. It does not save raw transcripts, hook payloads, prompts, tool inputs, or full tool outputs. Secret detection runs before save and before injection.

Review pending inferred memories with:

```bash
memory-lane review
```

Enable concise hook diagnostics and persistent hook debug logging with:

```bash
MEMORY_LANE_HOOK_DEBUG=1
```

Debug records are appended to `~/.memory-lane/hooks-log.jsonl`. They contain counts and metadata only, not prompts, transcripts, or tool output.

## Fallback: prompt instructions

If your Codex version does not support hooks, add CLI-use instructions to your Codex system prompt and call `memory-lane save`, `memory-lane recall`, and `memory-lane review` manually or through model-invoked shell commands.

Example system prompt snippet:

```markdown
## Memory
Use the memory-lane CLI for persistent memory:
- Save approved durable decisions/facts: `memory-lane save "X" --status approved`
- Recall relevant memory: `memory-lane recall "query"`
- Review pending suggestions: `memory-lane review`
```

## Semantic search

To enable vector-based retrieval:

```bash
memory-lane config enable-semantic
memory-lane reindex
```

With an OpenAI-compatible embedding provider configured in `~/.memory-lane/config.json`, newly saved approved memories are automatically embedded on a fire-and-forget path. Run `memory-lane reindex` to rebuild embeddings if needed.
