---
name: memory-lane
description: Persistent project-specific memory with semantic retrieval. Use when you need to save, recall, search, or manage durable memories across sessions. Supports approved (immediate) and suggested (pending review) workflows.
---

# Memory Lane

Local-first persistent memory system with semantic retrieval for coding agents.

## When to Use

- **User explicitly asks you to remember something** → use `save`
- **You proactively identify something worth remembering** → use `suggest` (user reviews later)
- **You need to recall past context** → use `recall`
- **User asks "what were we working on?"** → use `recall` with that query

## CLI Commands

All commands support `--json` for machine-readable output.

### Save (approved immediately)

```bash
memory-lane save "Use pnpm for package management" --category project
memory-lane save "I prefer dark mode" --category preference
memory-lane save "Project uses TypeScript 5.4" --category project
```

Categories: `preference`, `personal`, `project`

### Suggest (pending review, or approved directly)

```bash
# Pending review (default)
memory-lane suggest "Consider adding CI pipeline for linting" --category project

# Approved directly (when user explicitly asked to remember)
memory-lane suggest "User prefers pnpm" --category preference --status approved
```

### Recall (semantic + lexical search of approved memories)

```bash
memory-lane recall "package manager"
memory-lane recall "what were we working on"
```

### Other commands

```bash
memory-lane list                  # list all memories
memory-lane list --status pending # list pending only
memory-lane list --status approved
memory-lane search "pnpm"         # lexical search
memory-lane review                # list pending for review
memory-lane approve <id>          # approve a pending memory
memory-lane reject <id>           # reject a pending memory
memory-lane delete <id>           # soft-delete a memory
memory-lane status                # quick stats
memory-lane doctor                # full diagnostic report
memory-lane compact               # remove deleted/rejected entries
```

### Project scope

```bash
memory-lane save "test command is pnpm test" --project /path/to/project
```

## API (for direct library use)

```typescript
import { MemoryEngine } from "@memory-lane/core"

const engine = new MemoryEngine()

// Save approved (no review needed)
engine.save({ text: "...", status: "approved", category: "project" })

// Suggest (pending review)
engine.suggest("...")

// Recall (semantic + lexical)
const result = await engine.recall("query")
```
