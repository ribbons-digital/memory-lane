# Memory Lane Integration for Cursor

## Setup

1. Build and link the CLI: see `claude-code.md`.
2. Add to your `~/.cursor/rules` or project's `.cursor/rules`:

```
# Memory
Use the memory-lane CLI to persist important information across sessions:
- Save: `memory-lane save "X" --status approved`
- Recall: `memory-lane recall "query"`
- List: `memory-lane list`
- Project scope: `memory-lane save "X" --scope project --category project`
```
