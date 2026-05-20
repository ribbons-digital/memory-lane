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
