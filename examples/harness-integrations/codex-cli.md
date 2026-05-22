# Memory Lane Integration for OpenAI Codex CLI

## Setup

1. Build and link: see `../claude-code.md` setup steps.
2. Add to your Codex system prompt (`~/.codex/instructions.md`):

```markdown
## Memory
Use the memory-lane CLI for persistent memory:
- Save decisions/facts: `memory-lane save "X" --status approved`
- Recall: `memory-lane recall "query"`
- List: `memory-lane list`
- Progress checkpoint: `memory-lane save "Current progress: X" --category project`
```

## Auto-trigger via system prompt

Codex doesn't have a programmatic event hook like pi's `on("input")`. The way to
enable automatic memory saving is through **system prompt instructions** that tell
the LLM to invoke the CLI when it detects memory-worthy content:

```markdown
## Memory (auto-save)
When the user explicitly asks you to remember something, or when you identify a
durable fact/decision/preference worth preserving across sessions, run:
  memory-lane save "<the fact>" --category <preference|personal|project> --status approved
```

This relies on the LLM's pattern recognition rather than regex matching. The pi
adapter uses `on("input")` + regex/LLM intent classification for the same purpose.

## Semantic search

To enable vector-based retrieval:

```bash
memory-lane config enable-semantic
memory-lane reindex
```

With an OpenAI-compatible embedding provider configured in `~/.memory-lane/config.json`,
newly saved approved memories are automatically embedded — no manual reindex needed
for incremental saves.
