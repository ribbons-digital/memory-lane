# Memory Lane Integration for Claude Code CLI

## Setup

1. Build the CLI: `cd ~/projects/ribbons-digital/memory-lane && pnpm build`
2. Link globally: `cd packages/cli && pnpm link --global`
3. Add to your `~/.claude/CLAUDE.md`:

```markdown
## Memory
Use the memory-lane CLI to remember important project information:
- When I say "remember that X" or "save this to memory: X", run: `memory-lane save "X" --status approved`
- When I ask to recall something, run: `memory-lane recall "query"`
- To list memories: `memory-lane list`
- To search: `memory-lane search "keyword"`
- To save current progress: `memory-lane save "Current progress: <summary>" --category project --kind project_checkpoint`
- To review suggestions: `memory-lane review`
```

## Environment

Set `MEMORY_LANE_FILE` and `MEMORY_LANE_CONFIG` in your shell profile for consistent paths:
```bash
export MEMORY_LANE_CONFIG="$HOME/.memory-lane/config.json"
export MEMORY_LANE_FILE="$HOME/.memory-lane/memory.jsonl"
export MEMORY_LANE_EMBEDDINGS_FILE="$HOME/.memory-lane/embeddings.jsonl"
```

## Project Scoping

In a project directory, optionally create `.memory-lane-scope`:
```bash
echo '{"id":"my-project-uuid"}' > .memory-lane-scope
```

Memories saved with `--scope project` will be scoped to this project.
