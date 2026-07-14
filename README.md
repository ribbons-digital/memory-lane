# Memory Lane

Memory Lane gives AI coding agents a local, review-governed memory they can share across Claude Code, Codex, MCP clients, pi, OMP, and any harness that can shell out.
It is for the boring but painful problem every agent workflow hits: a new session should know the current project state, durable preferences, decisions, corrections, and procedures without depending on one vendor's chat history.

The default path is small:

1. install the binary;
2. run `memory-lane init`;
3. save useful project facts;
4. ask for continuity or recall from any configured harness.

Memory Lane stores plain JSONL files on your machine.
It does not silently turn every transcript into durable policy.
Most automation is review-first, bounded, and inspectable.
Advanced features such as project-local storage, freshness metadata, session summaries, plugins, and Obsidian integration are optional.
You do not need to understand them to try the core workflow.

## Quick Start

```bash
# Install the binary
curl -fsSL https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh | sh

# Configure your harnesses
memory-lane init

# Save a durable project fact
memory-lane save "always use pnpm for package installation"

# Ask what the project knows
memory-lane recall "package manager"
memory-lane continuity --json
```

That is the whole adoption path.
Everything else lives in the focused reference pages under [`docs/`](./docs/README.md).

## What Memory Lane stores

Memory Lane stores reviewed memories: project facts, preferences, decisions, corrections, procedures, and checkpoints.
Each memory has status and scope metadata so agents can distinguish active project guidance from pending suggestions or unrelated global preferences.
Records live in local files, not a hosted service.
Rejected and deleted records can be compacted, but normal edits are append-only so history is auditable.

By default, global-scope memories live in `~/.memory-lane/memory.jsonl`, and project-scoped memories live in `<project-root>/.memory-lane/memory.jsonl` when a project scope is known.
Project identity comes from an optional `.memory-lane-scope` file or the Git repository root.
See [Storage and project scoping](./docs/storage.md) for the full model, sandbox fallback behavior, and legacy migration.

## Everyday commands

```bash
memory-lane save "Release checklist: run pnpm build before tagging"
memory-lane suggest "Consider documenting the new deploy script"
memory-lane recall "release checklist"
memory-lane continuity
memory-lane review
memory-lane doctor
```

Use `save` when the fact is already approved.
Use `suggest` when something should be reviewed before it becomes durable memory.
Use `continuity` when you want broad project state such as "what changed?", "where did we leave off?", or "what should we do next?".

New memories flow through an explicit lifecycle: suggestions stay `pending` until approved, and approved memories can later be revised, superseded, or soft-deleted with full history preserved.
The [CLI reference](./docs/cli.md) documents every command, including review, revision, freshness, continuity, and Obsidian workflows.

## Installation

macOS / Linux:

```bash
curl -fsSL https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.ps1 | iex
```

The installer downloads a prebuilt binary, verifies its SHA-256 checksum, and places it on your PATH.
After installation, run `memory-lane init` to configure Claude Code, Codex, Claude Desktop, Codex Desktop, pi, and OMP (Oh My Pi).
Use `memory-lane init --yes` to auto-configure all detected harnesses without prompting.

Upgrade later with `memory-lane upgrade`; your memory data in `~/.memory-lane/` is preserved.

See [Installation and maintenance](./docs/installation.md) for script review, install-manifest semantics, OMP install paths, selective uninstall, and upgrade details.
If you are developing Memory Lane on the same machine, prefer the [development setup](./docs/development.md) so release-style init does not replace local shims.

## Harness integrations

Run `memory-lane init` to auto-detect and configure supported harnesses, or see [`examples/harness-integrations/`](./examples/harness-integrations/) for manual snippets:

- [MCP Server](./examples/harness-integrations/mcp.md) (Claude Desktop, Codex Desktop, Cursor, and other MCP clients)
- [Claude Code CLI](./examples/harness-integrations/claude-code.md)
- [OpenAI Codex CLI](./examples/harness-integrations/codex-cli.md)
- [Cursor](./examples/harness-integrations/cursor.md)
- [Windsurf](./examples/harness-integrations/windsurf.md)
- pi
- [OMP (Oh My Pi)](./examples/harness-integrations/omp.md)

Hooks and adapters provide automatic, low-noise lifecycle behavior: bounded context injection at session start and prompt time, plus review-first capture of durable statements, corrections, procedures, and checkpoints.
The MCP server provides explicit tools such as `memory_save`, `memory_recall`, `memory_continuity`, and `memory_review` for clients that ask for them.
See [Harness integrations](./docs/harness-integrations.md) and [MCP server](./docs/mcp.md) for behavior details, and [Configuration](./docs/configuration.md) for context policy and summarization options.

## Plugins

Memory Lane supports lightweight opt-in plugins. Core features stay built-in; optional capabilities ship as separate packages that you activate in `~/.memory-lane/config.json`.

```json
{
  "plugins": ["@memory-lane/plugin-obsidian-wiki"],
  "pluginConfig": {
    "@memory-lane/plugin-obsidian-wiki": {
      "vaultPath": "/Users/alice/Documents/Obsidian",
      "includeFolders": ["Garden"]
    }
  }
}
```

See [`docs/plugins/README.md`](docs/plugins/README.md) for installation methods, plugin development, and distribution options.

### Obsidian Wiki plugin

`@memory-lane/plugin-obsidian-wiki` lets LLM clients search and read selected Obsidian/Garden notes as source-backed knowledge without turning those notes into Memory Lane memories automatically.

- MCP tools: `obsidian_wiki_search`, `obsidian_wiki_read`
- MCP resource: `memory-lane://obsidian-wiki/notes`
- CLI: `memory-lane obsidian-wiki status`

Promotion of wiki-derived facts into Memory Lane remains explicit through the existing `memory_save` tool or `/memory` commands.

**Installing the Obsidian Wiki plugin:**

- If you use the standalone binary: the plugin is bundled in official `v0.2.1+` releases, but you must still enable it by adding `"@memory-lane/plugin-obsidian-wiki"` to `plugins` in `~/.memory-lane/config.json`.
- If you build Memory Lane from source: `pnpm add @memory-lane/plugin-obsidian-wiki` in the repository root, then enable it in `config.json`.
- For a custom checkout: add `@memory-lane/plugin-obsidian-wiki` to `pnpm-workspace.yaml`, enable it in `config.json`, and reference it by name.

## Documentation

- [Installation and maintenance](./docs/installation.md) - installer, upgrade, selective uninstall, and install-manifest semantics.
- [CLI reference](./docs/cli.md) - full command list and command behavior.
- [Configuration](./docs/configuration.md) - config file options and environment variables.
- [Storage and project scoping](./docs/storage.md) - storage tiers, project identity, and migration.
- [Architecture](./docs/architecture.md) - workspace packages, the memory lifecycle, and the programmatic API.
- [MCP server](./docs/mcp.md) - explicit Memory Lane tools for MCP clients.
- [Harness integrations](./docs/harness-integrations.md) - Claude Code, Codex, pi, and OMP integration behavior.
- [Plugins](./docs/plugins/README.md) - plugin installation, development, and distribution.
- [Developing Memory Lane](./docs/development.md) - build from source, local harness shims, release gates, and optional evals.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution workflow and review requirements.
Maintainer-only planning and agent-workflow notes live under [`internal/`](./internal/README.md) and are not required reading for users or contributors.

## License

Memory Lane is released under the [MIT License](./LICENSE).
