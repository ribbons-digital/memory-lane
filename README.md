# Memory Lane

Memory Lane gives AI coding agents a local, review-governed memory they can share across Claude Code, Codex, MCP clients, pi, and any harness that can shell out.
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

## Contents

- [Quick Start](#quick-start)
- [What Memory Lane stores](#what-memory-lane-stores)
- [Everyday commands](#everyday-commands)
- [Installation](#installation)
- [Architecture](#architecture)
- [Storage](#storage)
- [Project Scoping](#project-scoping)
- [CLI Commands](#cli-commands)
- [Plugins](#plugins)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Programmatic Use](#programmatic-use)
- [MCP Server](#mcp-server)
- [Memory Lifecycle](#memory-lifecycle)
- [Harness Integrations](#harness-integrations)
- [License](#license)

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
Everything else in this README is reference material for optional integrations and advanced workflows.

## What Memory Lane stores

Memory Lane stores reviewed memories: project facts, preferences, decisions, corrections, procedures, and checkpoints.
Each memory has status and scope metadata so agents can distinguish active project guidance from pending suggestions or unrelated global preferences.
Records live in local files, not a hosted service.
Rejected and deleted records can be compacted, but normal edits are append-only so history is auditable.

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

## Installation

### One-line installer (recommended)

macOS / Linux:

```bash
curl -fsSL https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.ps1 | iex
```

The installer downloads a prebuilt binary, verifies its SHA-256 checksum, and places it on your PATH.
After installation, run `memory-lane init` to configure Claude Code, Codex, Claude Desktop, Codex Desktop, and pi.
Use `memory-lane init --yes` to auto-configure all detected harnesses without prompting.

If you are an end user, this installer plus `memory-lane init` path is the recommended setup.
If you are developing Memory Lane and also using it on the same machine, prefer the [development setup](#development-setup-local-checkout--manual-harness-config) below so release-style init does not replace local shims or hand-edited harness config.

If you prefer to review the script first, save it and run locally:

```bash
curl -fsSL -o install.sh https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh
sh install.sh
```

```powershell
irm https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.ps1 -OutFile install.ps1
.\install.ps1
```

After installing, run `memory-lane init` again any time to reconfigure or add new integrations.
`init` records the running CLI version in `~/.memory-lane/install.json` so future upgrades can refresh the manifest with the newly installed release version.
When `init` writes JSON harness configs, it preserves unrelated settings and hooks, replaces older Memory Lane hook entries, and creates a one-time `<config>.memory-lane.bak` backup before the first successful write.
If an existing JSON config is malformed, `init` leaves it untouched and reports the parse error instead of overwriting it.

### Upgrading

Run the built-in upgrade command to download the latest binary and re-apply only the harness configs you already had installed:

```bash
memory-lane upgrade
```

Use `memory-lane upgrade --yes` to run non-interactively.
On macOS and Linux this re-runs the installer and then refreshes your existing configs.
On Windows, when an install manifest is present, the upgrade downloads the new binary and reapplies the existing harness configs automatically.
`memory-lane init --yes` is only the fallback when no manifest exists.
When existing configs are refreshed, the install manifest version is updated to the version embedded in the new binary.

Your memory data in `~/.memory-lane/` is preserved.

You can also upgrade manually by re-running the installer and then `memory-lane init --yes`:

```bash
curl -fsSL https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh | sh
memory-lane init --yes
```

### Build from source

For development or custom builds:

```bash
git clone <repo>
cd memory-lane
pnpm install
pnpm build
```

For local binary builds, run `pnpm build:binary` after `pnpm build`.
Compiled binaries embed release metadata from `MEMORY_LANE_VERSION`, an exact Git tag, or a short commit fallback; development builds without that metadata report `0.0.0-dev`.

### Link the CLI globally

```bash
cd packages/cli
pnpm link --global
```

After linking, `memory-lane` is available as a shell command:

```bash
memory-lane doctor
```

### Development setup: local checkout + manual harness config

If you are developing Memory Lane and using it on the same machine, avoid `memory-lane init --yes` unless you intentionally want release-style harness config. The init wizard is safe for end users, but on a development machine it can overwrite local shims or hand-edited settings that point at your checkout. `init` and `upgrade` now skip generated Claude/Codex skill writes when the destination resolves through a symlink into the Memory Lane source checkout, printing a warning while preserving other hook/config writes. JSON hook/config writes preserve unrelated entries, replace older Memory Lane hook entries, create a one-time `.memory-lane.bak` backup before the first successful write, and refuse to overwrite malformed JSON. Release-style pi init writes a CLI bridge around the installed binary; for full local pi adapter behavior while developing, use the manual shim below. Prefer manual config so each harness loads the code you just built.

Recommended development loop:

```bash
cd /absolute/path/to/memory-lane
pnpm install
pnpm build
cd packages/cli
pnpm link --global
```

After source changes, run `pnpm build` again and reload/restart the harness you are testing.

#### Project status docs sync guardrail

When completing a Memory Lane milestone, merging a PR, cutting a release, or recommending the next work item, update status docs before calling the work complete.
Start with compact current-state sections in `HANDOFF.md` and the relevant current roadmap section, then check `README.md` and `skills/memory-lane/SKILL.md` only when their status, commands, or workflow guidance changed.
Do not rely only on Memory Lane checkpoint memories; future sessions and users must be able to recover current project state from the repository docs without reading archived chronology by default.

#### Harness adapter/template release guardrail

When changing generated harness adapters, installer templates, or release-style bridges, do not rely on registration-only smoke tests or reviewer inspection. Before release:

1. Add contract-level tests, not just extension load or registration tests.
2. Invoke every generated lifecycle hook, command, and tool branch with realistic fake harness inputs.
3. Assert exact host API return shapes against the host docs/source.
4. Compare generated release/native behavior with repo-local adapter behavior when both paths exist.
5. Dogfood the actual generated installed artifact through the lifecycle event users trigger, not only startup/load.

For pi specifically, `before_agent_start` must return a custom message object such as `{ message: { customType, content, display, details? } }`; returning a raw string is invalid even if the extension loads successfully.

For OMP compatibility work, run the real-runtime contract gate against the repository-pinned OMP version before releasing changes to the pi adapter, generated extension sources, or future OMP installer support:

```bash
pnpm --filter @memory-lane/pi-adapter build
pnpm --filter @memory-lane/cli build
pnpm --filter @memory-lane/cli eval:omp-contract -- --as-of YYYY-MM-DD --out test/fixtures/omp-contract-16.4.5.json
```

The gate requires OMP `16.4.5`, an authenticated model, and `expect` for the interactive TUI probe.
It loads both production extension forms through a real `omp --extension` scratch profile, records sanitized per-event evidence, and exits non-zero when any expected registration is missing, any lifecycle event remains unverified, or any lifecycle event fails.
The tested version and date live in `packages/cli/test/fixtures/omp-contract-16.4.5.json`.
Do not claim first-class OMP lifecycle parity while that report has `overallPass: false`.

#### Optional local evals

Memory Lane eval runners are developer commands and stay outside default CI unless a specific task says otherwise.
Core retrieval evals live in `@memory-lane/core`:

```bash
pnpm --filter @memory-lane/core eval:retrieval
pnpm --filter @memory-lane/core eval:conflict-update
```

The optional external long-memory smoke adapter also lives in `@memory-lane/core` and requires an explicit local dataset path:

```bash
pnpm --filter @memory-lane/core eval:long-memory-smoke -- --dataset /path/to/longmemeval-smoke.json --limit 20 --k 5
```

You can also set `MEMORY_LANE_LONG_MEMORY_SMOKE_DATASET=/path/to/longmemeval-smoke.json` instead of passing `--dataset`.
The adapter accepts a tiny LongMemEval-compatible smoke subset with `question_id`, `haystack_session_ids`, `haystack_sessions`, optional `haystack_dates`, `answer_session_ids`, and `_abs` abstention records; it does not download data, call a model, use a judge, commit external datasets, or change production retrieval/lifecycle behavior.
Its stable JSON report uses deterministic retrieval session-id recall, maps categories into the test-only benchmark taxonomy, skips `_abs` abstention records into `abstentionResults`, reports recall misses as metrics, and treats malformed evidence-session mappings as zero-tolerance adapter failures.

The capture-outcome dataset exporter is a maintainer eval tool for local learning events.
It requires explicit `--events`, canonical `--as-of`, and `--out` paths, where `--events` points at one direct events directory such as `~/.memory-lane/traces/<project-hash>/events`, not the trace root.
It accepts optional `--home-store`, `--project-store`, and `--traces` supporting inputs, writes atomically, rejects symlinked or overlapping input/output paths, emits no raw content, distinguishes unresolved and 30-day expired-unacted agreement recommendations, and reports right-censored suggestion survival metrics instead of inferring inactivity as intent.

Lifecycle evals live in `@memory-lane/lifecycle`:

```bash
pnpm --filter @memory-lane/lifecycle eval:lifecycle-injection
pnpm --filter @memory-lane/lifecycle eval:prompt-routing
pnpm --filter @memory-lane/lifecycle eval:long-session-synthetic
pnpm --filter @memory-lane/lifecycle eval:trace-dataset-converter -- --traces /path/to/project-traces --out /tmp/memory-lane-trace-smoke.json
pnpm --filter @memory-lane/lifecycle eval:capture-outcome-dataset -- --events /path/to/events --as-of 2026-08-01T00:00:00.000Z --out /path/to/capture-outcomes.json
```

The trace dataset converter is a maintainer-only local runner for opt-in Slice A trace files.
It requires explicit `--traces <dir>` and `--out <file>` paths, where `--traces` points at one hashed per-project trace directory under the local trace root, not the trace root itself.
It rejects outputs that physically resolve inside the selected trace directory, including through symlinked parents, writes a deterministic `schemaVersion: 1` LongMemEval-compatible smoke dataset, and fails without writing output when no usable trace contains a user question.
The emitted dataset preserves session messages, capture dates, trace fidelity, thin-data metadata, and content-derived stable IDs so the result can be passed to the core smoke adapter with `pnpm --filter @memory-lane/core eval:long-memory-smoke -- --dataset /tmp/memory-lane-trace-smoke.json`.
It is a local self-retrieval transport smoke only, not ranking-quality evidence, and it does not call a network, model, embeddings path, or judge.

#### pi: load the local adapter

Create or replace `~/.pi/agent/extensions/memory-lane/index.ts` with a shim that imports your checkout:

```bash
mkdir -p ~/.pi/agent/extensions/memory-lane
cat > ~/.pi/agent/extensions/memory-lane/index.ts <<'EOF'
export default async function memoryLaneExtension(pi: any) {
  const mod = await import("file:///absolute/path/to/memory-lane/packages/pi-adapter/dist/index.js?reload=" + Date.now());
  return mod.default(pi);
}
EOF
```

Replace `/absolute/path/to/memory-lane` with your checkout path, then run `/reload` in pi. The timestamp query avoids stale module caches while iterating locally. Re-run `pnpm build` after changing Memory Lane source, then `/reload` pi again.

The local checkout pi adapter provides manual `memory_save`, `memory_suggest`, `memory_continuity`, and `memory_recall` tools plus `/memory ...` commands, including `/memory continuity [query]`.
Repo-local pi `/memory review` and `/memory delete <id>` stay scoped to the active project plus globals by default; add `--all` only for explicit cross-project maintenance.
Release-style generated pi bridges expose the same continuity tool, proxy `/memory continuity ...` through the CLI, and use `memory-lane route --prompt <text> --json` for shared prompt-routing parity.
They also inject project context through pi's `before_agent_start` event.
Broad continuity prompts such as “what were we last working on?”, “where did we leave off?”, and “what's next?” route to canonical Memory Lane continuity (`memory-lane continuity --json`, or `memory-lane continuity --query ...` for topic-specific workstreams) before topic-specific recall, while ordinary targeted prompts continue to use bounded recall.
Both repo-local and generated pi continuity rendering de-duplicate repeated continuity ids and promote actionable warning inspection commands before operating guidance.
To reduce memory noise, repo-local pi `input` only saves explicit memory requests such as “Remember that ...”; ordinary prompt submissions are not auto-saved.
Repo-local pi `turn_end` and `tool_result` still capture higher-signal lifecycle evidence such as completed durable project statements, successful workflow commands (e.g., `pnpm test`, `pnpm build`, `pnpm install`), and strong checkpoint evidence such as completed releases or merged PRs through the shared lifecycle policy.
Release-style generated pi bridges currently do not register `input`, `turn_end`, or `tool_result`; keep OMP installer work gated until the pinned OMP contract report passes.
Inferred checkpoint captures are pending by default and require review before they affect approved continuity.
For session summaries, pi uses the explicit `/memory session-summary` command: it reads the current branch through pi's session manager, asks for interactive confirmation, and saves any generated summary as a pending `session_summary` memory with pi `session_end` provenance.
The native pi adapter and release-style generated pi bridge also listen to `session_before_compact` and can save a pending pre-compact `session_summary` with pi `pre_compact` provenance when `memory.sessionEndSummary.enabled` is configured, `memory.sessionEndSummary.requireConfirmation` is `false`, and `memory.preCompactSummary.enabled` is omitted or not `false`; they do not override pi's own compaction summary.
It does not automatically summarize on `agent_end` or `session_shutdown`.
The release-style generated pi extension is intentionally a self-contained CLI bridge so pi never tries to import the native `memory-lane` binary as TypeScript.

#### Claude Code CLI: paste hooks manually

For local development, paste hooks into `~/.claude/settings.json` or a project-local `.claude/settings.local.json` instead of letting init own the file. Merge this `hooks` object into any existing settings:

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
    "PreCompact": [
      {
        "matcher": "manual|auto",
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane claude pre-compact",
            "timeout": 30,
            "statusMessage": "Saving compaction summary"
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

Use `/hooks` in Claude Code to verify which settings file supplied the hooks. `SessionEnd` only saves summaries when `memory.sessionEndSummary` is enabled and provider-configured; by default it still requires confirmation unless `requireConfirmation` is set to `false`. `PreCompact` uses the same provider config and saves pending summaries before context compaction only when `memory.sessionEndSummary.requireConfirmation` is `false` and `memory.preCompactSummary.enabled` is omitted or not `false`; set `memory.preCompactSummary.enabled` to `false` to opt out.

#### Codex CLI: paste supported hooks manually

For Codex CLI, paste hooks into a project-level `.codex/hooks.json` while testing, then move them to `~/.codex/hooks.json` if you want global behavior. Do **not** add a Codex `SessionEnd` hook; current Codex hooks do not support that event.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane codex session-start",
            "timeoutSec": 10,
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
    "PreCompact": [
      {
        "matcher": "manual|auto",
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane codex pre-compact",
            "timeoutSec": 30,
            "statusMessage": "Saving compaction summary"
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

Codex `PreCompact` can save a pending session summary before context compaction when `memory.sessionEndSummary.enabled` is configured, `memory.sessionEndSummary.requireConfirmation` is `false`, and `memory.preCompactSummary.enabled` is omitted or not `false`; set `memory.preCompactSummary.enabled` to `false` to opt out. Codex `Stop` can produce a session summary only when the latest user message explicitly asks for it, such as "remember this session" or "summarize this session to memory".

#### MCP clients: point at the local server

For Claude Desktop, Codex Desktop, and other MCP clients, point the MCP server at your built checkout with absolute paths. Do not use `~` in client config fields that expect paths. A typical command is:

```text
/Users/you/.nvm/versions/node/v22.22.3/bin/node
```

with argument:

```text
/absolute/path/to/memory-lane/packages/mcp-server/dist/index.js
```

Set the working directory to the project you want Memory Lane to use as the startup project scope, for example `/absolute/path/to/your/project`.
Explicit MCP `projectPath` calls are scoped only to that request and do not change the startup scope used by later omitted-path calls.

End users do not need these manual development shims - `memory-lane init` installs release-style integrations automatically.

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

## Architecture

Eleven packages in a monorepo:

| Package | Purpose |
|---|---|
| `@memory-lane/core` | Pure Node.js library. Zero harness dependencies. |
| `@memory-lane/lifecycle` | Shared harness-neutral memory automation policy for recall, autosave, context budgets, and tool outcomes. |
| `@memory-lane/cli` | CLI wrapper. Works with any harness that can shell out. |
| `@memory-lane/mcp-server` | Local stdio MCP server exposing explicit Memory Lane tools. |
| `@memory-lane/obsidian-mirror` | Optional one-way JSONL → Obsidian Markdown mirror. |
| `@memory-lane/obsidian-import` | Standalone parser/planner for explicit Obsidian Markdown → JSONL imports. |
| `@memory-lane/plugin-api` | Lightweight plugin API for first-party and custom extensions. |
| `@memory-lane/plugin-obsidian-wiki` | Optional Obsidian/Garden knowledge-base search and read plugin. |
| `@memory-lane/claude-adapter` | Claude Code hook adapter exposed through `memory-lane claude ...`. |
| `@memory-lane/codex-adapter` | Codex hook adapter exposed through `memory-lane codex ...`. |
| `@memory-lane/pi-adapter` | pi extension adapter. |

## Storage

By default, Memory Lane uses two storage tiers when no explicit `MEMORY_LANE_*` paths are set:

- global-scope memories, including default preferences and personal memories, live in `~/.memory-lane/memory.jsonl`;
- new memories whose final scope is the current project live in `<project-root>/.memory-lane/memory.jsonl` when a project scope is known.

Each write appends a record; reads fold duplicates by id with the newest revision winning.
New records created by Memory Lane receive 32-character lowercase hexadecimal ids; existing legacy ids are loaded unchanged.
Atomic memory, embedding, continuity-baseline, and compaction writes use short file locks plus `.tmp` + `rename`, and batch memory writes are atomic per underlying store.
Compaction removes folded deleted/rejected records and stale embeddings, but it preserves malformed or schema-invalid JSONL rows so diagnostics remain available instead of silently erasing corrupt input.
The internal storage facade merges the active project store with the home store for recall, list, review, continuity, and status surfaces.
Existing records keep their origin store for normal edits/review actions so one logical memory id is not split across files.
Advanced `@memory-lane/core` consumers can import `MemoryEngineStorage`, `createSingleStoreEngineStorage`, and `createTwoTierEngineStorage` when they need to inject storage that owns memory, embedding, compaction, diagnostics, legacy project-memory diagnostics, legacy project migration planning/apply, and continuity-baseline paths.
Custom facade implementations can also import `EmbeddingLine` for `appendEmbedding()` inputs, should return `LegacyProjectMemoryDiagnostics` from `legacyProjectMemoryDiagnostics()`, and should implement explicit reviewed migration plan methods when project-local migration is applicable.

Embeddings (when configured) are paired with the owning memory store: home memories use `~/.memory-lane/embeddings.jsonl`, and project-local memories use `<project-root>/.memory-lane/embeddings.jsonl`. When a memory changes, recall ignores only embeddings created before that memory's latest invalidation; newer embeddings for the same memory id can be used without a full reindex.

For sandboxed harnesses, writable Memory Lane commands and hooks first try global storage at `~/.memory-lane`.
If that home storage is not writable and no explicit `MEMORY_LANE_*` paths are set, writable commands/hooks automatically initialize project-local single-store fallback storage at `.memory-lane/` and continue there.
Read-only inspection commands use read-only storage resolution and should not create fallback storage just to inspect memory state.

You can also initialize project-local storage explicitly:

```bash
memory-lane init --project-local --project /path/to/project
```

Project-local initialization creates `.memory-lane/` in the project, adds `.memory-lane/` to `.gitignore`, and creates `.memory-lane-scope`.
Treat `.memory-lane-scope` as a local identity file too; keep it untracked unless you intentionally want to share one stable scope id across collaborators.
In the default two-tier model, commands and hooks run with `--project /path/to/project` use this project store for project-scoped writes while keeping global-scope preferences home-side unless explicit `MEMORY_LANE_*` paths are set.

## Project Scoping

Project identity is resolved in order:
1. `.memory-lane-scope` file (walks up from cwd) - `{ "id": "your-project-id" }`
2. Git identity - normal repos use the repo root; linked Git worktrees use the main checkout/common Git directory as the project key so worktrees share memories by default
3. Global scope (fallback - memories are visible everywhere)

Read-only scope resolution never creates scope files.
Project-local initialization and first project-scoped writes may create `.memory-lane-scope` as part of initializing `.memory-lane/`.
Create one manually in a project root when you want an explicit stable identity or need to override Git-derived identity:
```bash
echo '{"id":"my-project-uuid"}' > .memory-lane-scope
```
If you do this in a Git repository, add `.memory-lane-scope` to `.gitignore` unless the shared id is deliberate.

Existing memories saved under old worktree path keys are not migrated automatically.
Use `memory-lane list --all` and `memory-lane show <id> --all` to find them, then pass `--all` to `review`, `approve`, `reject`, `delete`, `update`, `rescope`, `supersede`, or `replace` when deliberately maintaining records outside the active project scope.

Review, by-id mutation, and revision commands are scoped by default: they can access global memories plus memories owned by the active project.
When no project scope is active, the default is global-only.
Cross-project maintenance requires explicit `--all`; denied lookups return not-found behavior without exposing memory text.

For legacy project-scoped memories that still live in the home store from before project-local defaults, use `memory-lane status --json`, `memory-lane doctor --json`, MCP `memory_status`, or `memory-lane migrate project-local --dry-run`.
These surfaces are read-only for legacy diagnostics and do not move records or create project-local storage.
When legacy candidates exist, the diagnostics include counts, hazard counters, and at most 10 bounded sample previews capped at 160 characters.
To migrate legacy candidates, first write and review an explicit plan with `memory-lane migrate project-local --dry-run --write-plan <path> --project <project>`.
Plan files may contain memory text and should not be committed.
After review, apply the plan with `memory-lane migrate project-local --apply-plan <path> --yes`.

## CLI Commands

```
memory-lane save <text> [--kind <kind>]
                                  Save an approved memory with optional explicit kind
memory-lane suggest <text>        Queue a pending suggestion for review
memory-lane recall [query]        Recall memories (semantic or lexical)
memory-lane show|get <id> [--all] Show one memory by exact id, including descriptor metadata when present
memory-lane list [--status ...]   List memories
memory-lane search <query>        Lexical text search
memory-lane approve <id> [--all]  Approve pending or reactivate rejected memory
memory-lane reject <id> [--all]   Reject a memory
memory-lane delete <id> [--all]   Soft-delete a memory
memory-lane review [--all]        Show pending memories
memory-lane review --kind session_summary Filter pending review by memory kind
memory-lane review --source session-summary Filter pending review by source
memory-lane review --provenance pi/session_end Filter pending review by adapter/event provenance, e.g. pi/session_end or codex/pre_compact
memory-lane review --suspect-meta Show likely old pending operational prompt pollution only
memory-lane review --suspect-meta --include-approved [--all] Show pending+approved suspect pollution; --all includes other projects
memory-lane dashboard [--all]     Compact continuity/review overview without long memory bodies
memory-lane continuity [--json] [--query <text>]
                                  Canonical continuity read model, with optional workstream discovery
memory-lane route --prompt <text> Internal prompt routing decision for harness adapters
memory-lane agreements [--area <area>] [--json]
                                  Show approved operating agreements for the current project/global scope
memory-lane update <id> [--all]   Revise an active memory with the same id
memory-lane rescope|move <id> --scope global|project [--dry-run|--yes] [--all]
                                  Correct memory scope with the same id
memory-lane supersede <new-id> <old-id...> [--reason <reason>] [--dry-run] [--yes] [--all]
                                  Link approved old memories to an approved successor
memory-lane replace <old-id...> --text <text>|--stdin [--category <category>] [--kind <kind>] [--status pending|approved] [--reason <reason>] [--dry-run] [--yes] [--all]
                                  Create a successor memory for approved old memories
memory-lane compact               Remove deleted/rejected tombstones while preserving invalid rows
memory-lane doctor                Diagnostic report
memory-lane status                Quick stats
memory-lane migrate project-local --dry-run [--write-plan <path>]
                                  Preview legacy home-stored project memories and optionally write a review plan
memory-lane migrate project-local --apply-plan <path> --yes
                                  Apply a reviewed project-local migration plan
memory-lane reindex [--force]     Embed approved memories missing current vectors; --force recomputes
memory-lane init --project-local  Initialize sandbox-friendly project-local storage
memory-lane upgrade [--yes]       Download the latest binary and re-apply existing harness configs
memory-lane tuneup [purge]        Inspect or purge local learning capture data
memory-lane session-end --confirm Generate a pending session summary from stdin JSON
memory-lane obsidian ...          Manage optional Obsidian mirror/import workflows
```

All commands support `--json` for machine-readable output and `--project <path>` to set the project scope.
`memory-lane save` accepts `--kind` to override text-based kind inference; valid values are `preference`, `personal_context`, `project_fact`, `project_checkpoint`, `workflow_rule`, `decision`, `correction`, `procedure`, `session_summary`, and `misc`.

### Freshness metadata

`memory-lane save` and `memory-lane suggest` accept optional time-awareness metadata:

```bash
memory-lane save "Temporary project status" --expires-at 2026-07-01T00:00:00.000Z
memory-lane suggest "Recheck this after launch" --stale-after-days 30
memory-lane save "Release note" --captured-at 2026-06-21T00:00:00.000Z
```

Freshness metadata is advisory.
Memory Lane stores, validates, displays, and classifies it for status/continuity inspection, but does not automatically delete, hide, refresh, consolidate, deprioritize, or filter memories.
Stale and expired advisory metadata may include existing dry-run revision commands so users can inspect a safe next action per memory id.
Generated session summaries can also carry `freshness.capturedAt` when the source messages include canonical ISO timestamps; this captured time is the session as-of/source timestamp and may differ from the summary heading/write date.

### Checkpoint candidates and review-first capture

`memory-lane review`, `memory-lane review --json`, and MCP `memory_review` label pending memories that look like high-value project progress, such as merged PRs, releases, verification milestones, docs syncs, major fixes, or roadmap decisions. These labels are review-first: approve a checkpoint candidate only if it should become durable project continuity.

Memory Lane can also suggest pending checkpoint candidates from strong lifecycle evidence, such as a successful release command, merged PR command, or explicit completed-progress statement. These inferred checkpoints are pending by default, deduplicated against nearby pending/approved project checkpoints, and do not affect approved continuity until reviewed. Repeated recognized checkpoint events, such as the same release, PR merge, or verification checkpoint, are skipped before writing another pending review item. When a hook saves a pending checkpoint candidate, Memory Lane emits the existing compact pending-review reminder where the hook transport supports it; Claude/Codex hook output uses the count-only reminder, while pi uses the same shared lifecycle capture policy and renders lifecycle-save notifications through the pi UI. MCP clients do not run lifecycle hooks, but they see the same pending state through `memory_review`, `memory_status`, and `memory_continuity`.

No new command, MCP tool, config flag, or explicit memory API is required for checkpoint capture. Review with `memory-lane review` or MCP `memory_review`, approve/reject through the existing review flow, and inspect continuity with `memory-lane continuity` or MCP `memory_continuity`. Checkpoint capture does not automatically approve memories, dump transcripts, change recall ranking, or perform exact thread/workstream lookup.

### Workflow correction candidates

Memory Lane can also suggest pending `correction` candidates when a user explicitly points out that an agent violated, forgot, skipped, or ignored an expected workflow or operating agreement, such as “you forgot our PR-protected workflow” or “you skipped the review gate.”
Correction capture runs only from bounded Stop context, saves compact normalized project-scoped text, and remains pending by default.

Correction capture is review-first learning, not automatic rule rewriting. It does not add commands or MCP tools, does not run an LLM classifier, does not capture raw transcripts or tool output, and does not auto-approve or change recall ranking. Inspect candidates with `memory-lane review`, MCP `memory_review`, `memory-lane continuity`, or MCP `memory_continuity`; approve only corrections that should become durable project workflow guidance.

### Recovery-backed procedure candidates

Memory Lane can suggest pending `procedure` candidates from bounded tool evidence when a failed shell action is followed by a safe successful recovery, such as `npm test` failing before `pnpm test` succeeds, or `npm install` failing before pnpm evidence succeeds. These candidates use compact templates such as `Procedure: ... When: ... Steps: ... Pitfall: ... Verify: ...` and never include raw stdout, stderr, transcripts, or secrets.

Procedure learning is conservative and review-first. It requires optional bounded recent tool context from a harness, stores candidates as normal project-scoped Memory Lane records with `kind: "procedure"`, deduplicates against existing procedure/workflow/correction memories, and does not export native harness skills or rules. Review and approve through the existing CLI/MCP review flow before relying on a procedure for durable continuity.

### Memory revision commands

Use explicit revision commands when an approved memory needs correction or replacement. These commands are append-only: they write newer rows instead of silently deleting history.

```bash
memory-lane update <id> --text "refined memory" --reason "clarified wording"
cat refined.md | memory-lane update <id> --stdin --kind workflow_rule --dry-run

memory-lane supersede <new-id> <old-id> --reason "newer workflow agreement"
memory-lane supersede <new-id> <old1> <old2> --reason "merged duplicates" --yes
memory-lane supersede <new-id> <old-id> --all --dry-run

memory-lane replace <old-id> --text "new successor memory" --kind workflow_rule
cat replacement.md | memory-lane replace <old1> <old2> --stdin --yes
memory-lane replace <old-id> --text "cross-project successor" --all --dry-run
```

`update` keeps the same memory id and can change text, category, kind, or approved/pending status. `replace` creates a new successor memory. `supersede` links an existing approved successor to approved older memories. Superseded memories remain approved historical records; Memory Lane does not delete them automatically. Active continuity slots and workstream discovery omit superseded records, while list/show/recall and continuity hints can still expose them for explicit inspection.

Use `--dry-run` to preview any revision command.
Multi-old `replace` and `supersede` require `--yes` unless `--dry-run` is used.
Revision commands use global plus current-project visibility by default, use global-only visibility when no project scope is active, and require `--all` for cross-project maintenance.
MCP mutation tools are not added for these operations yet.

### Freshness status

`memory-lane status --json --since <ISO timestamp>` and `memory-lane doctor --json --since <ISO timestamp>` include a read-only `freshness` object. It reports counts and metadata for approved memories visible to the current project scope plus global memories that were updated after the timestamp. The same object includes advisory freshness classifications for visible approved memories with explicit freshness metadata: `expired`, `stale`, `current`, or `none`. Stale advisory records suggest `memory-lane update <id> --text <updated-memory-text> --dry-run`; expired advisory records suggest dry-run `update`, `replace`, and `supersede` commands. Human `status --since`, `doctor --since`, and `continuity` output show a bounded `Freshness advisory actions (manual dry-run)` block when stale/expired advisory actions exist; JSON remains the authoritative full metadata surface. These are text-free suggestions using existing revision commands, not a refresh workflow. Expired/stale classifications are inspection signals only; Memory Lane does not hide, delete, reject, down-rank, or skip those memories. Freshness output intentionally excludes memory text; use `memory-lane list --json` or targeted recall when you need the actual memory bodies.

### Operating agreements

Use `memory-lane agreements` to explicitly inspect approved workflow/process memories that should guide the current project. By default it considers the current project plus global scope, returns selected agreement text, and reports related overlap without changing memories.

```bash
memory-lane agreements
memory-lane agreements --json
memory-lane agreements --area project-loop --json
memory-lane agreements --all
```

`memory-lane status --json`, `memory-lane doctor --json`, and MCP `memory_status` include text-free operating agreement metadata so clients can notice that agreements exist without injecting the agreement bodies.

### Continuity read model

Use `memory-lane continuity --json` as the canonical CLI surface for continuity questions such as “what were we last working on?”, “what changed?”, “what did we accomplish?”, “what should we do next?”, and project status/resumption checks.
The read model combines latest progress (`latestProgress`), legacy latest approved project/global continuity (`latestApproved`), bounded operating guidance (`operatingGuidance`), pending continuity review candidates, freshness, operating-agreement metadata, continuity hints, warnings, suggested actions, and harness guidance in one bounded response.
Active selected slots use non-superseded approved memories, collapse operating guidance to one preview per workflow area, de-duplicate the same memory id across the major human-rendered continuity sections, and prefer safe descriptor metadata for previews when available.
Human CLI output promotes warnings that require inspection into an `Action required before applying continuity guidance` block before operating guidance.
For operating-agreement overlap warnings, inspect the per-area `memory-lane agreements --area <area> --json` actions before treating overlapping workflow guidance as authoritative.

For topic-specific workstream questions such as “resume building X” or “where was X implemented?”, pass a query: `memory-lane continuity --query "resume building X" --json`. This adds a bounded `workstreamDiscovery` block derived from non-superseded approved current-project continuity memories, with compact previews, match reasons, provenance/revision metadata, and derived PR/branch/commit/release references when present. Human output includes the same section compactly.

For MCP clients, call `memory_continuity({ projectPath })` first for general continuity questions, or `memory_continuity({ projectPath, query: "resume building X" })` for the workstream discovery variant.
Pass `projectPath` when the desktop/client process is not already scoped to the project.
Do not answer continuity questions from `memory_recall` alone.
Use recall only as a topic-specific follow-up after continuity inspection, for example when the continuity read model points to an area that needs more detail.
Lexical fallback recall keeps lexical score primary; for currentness-like release/status/checkpoint queries, exact lexical-score ties between project checkpoints prefer newer `updatedAt` so older status checkpoints do not outrank equally relevant current checkpoints.

The continuity read model is read-only. It may include bounded previews of selected memory records, including pending checkpoint candidates and approved workstream discovery pointers, but it does not inject additional memory bodies into lifecycle prompts, approve pending memories, mutate records, clean up scopes, rewrite retrieval, index raw transcripts, create workstream ids, or replace the review queue. Pending checkpoint captures become approved continuity only after review approval.

SessionStart cross-session freshness uses an advisory per-project baseline marker at `~/.memory-lane/continuity-baselines.json` by default, or `continuity-baselines.json` next to the configured memory JSONL file. The marker stores only project scope keys and timestamps so a new session can notice approved Memory Lane state newer than the prior baseline. It is not a memory source of truth, is safe to delete, and is ignored when lifecycle context policy is `off`. Marker handling does not write memory records, inject handoff bodies, approve/reject/cleanup memories, capture transcripts/tool output, or activate automatic handoff mode. `memory-lane status --json`, `memory-lane doctor --json`, and MCP `memory_status` expose text-free `continuityBaseline` diagnostics.

### Continuity hints

`memory-lane dashboard`, `memory-lane status --json`, `memory-lane doctor --json`, and MCP `memory_status` include read-only continuity hints. Hints are metadata-only: they may include memory ids, scope, category, kind, source, provenance, timestamps, and revision relationships, but they do not include memory text in status/MCP surfaces. Query-specific natural-language workstream discovery is available on existing continuity surfaces via `memory-lane continuity --query` and MCP `memory_continuity({ query })`; broader transcript/thread search remains out of scope. The human dashboard shows compact hint counts and inspection actions without adding memory text from the hints.

Current hints report:

- approved memories that are marked superseded but remain visible as historical records;
- multiple operating-agreement candidates for the same workflow area;
- project/global preference overlap in the same workflow area;
- scope hygiene candidates: approved global memories that look project-specific because of their category, kind, or path-like content;
- freshness advisories: approved visible memories with explicit freshness metadata that are expired or stale;
- newer approved memories when `--since <ISO timestamp>` is provided.

Scope hygiene hints are text-free inspection signals only.
Memory Lane does not automatically rescope or clean up those memories; use `memory-lane show <id>` or `memory-lane list --json` to inspect them before deciding whether to rescope, update, supersede, or leave them alone.
Use `memory-lane rescope <id> --scope project --project <path> --dry-run` to preview a same-id scope correction, adding `--all` only for deliberate cross-project maintenance, then rerun with `--yes` only after review.

Hints invite inspection with commands such as `memory-lane dashboard`, `memory-lane show <id>`, `memory-lane agreements --area <area> --json`, `memory-lane agreements --all`, and `memory-lane list --json`.
Freshness advisory hints may also include per-id dry-run revision commands already available in the CLI; human `continuity` groups those commands separately as manual dry-run freshness actions.
They do not perform cleanup, remove superseded memories from explicit inspection surfaces, change recall ranking, or suggest destructive reject/delete commands.

### Session-end summarization

Session-end summarization is opt-in and disabled by default.
It sends a compact session transcript to an explicitly configured OpenAI-compatible chat model, then saves the generated summary as a **pending** memory with `source: "session-summary"` and `kind: "session_summary"`.
Manual and session-end hook summaries use `provenance.lifecycleEvent: "session_end"`.
Pre-compact summaries use `provenance.lifecycleEvent: "pre_compact"`.
The transcript itself is not stored in Memory Lane.

Configure it in `~/.memory-lane/config.json`:

```json
{
  "memory": {
    "sessionEndSummary": {
      "enabled": true,
      "provider": "openai-compatible",
      "baseUrl": "http://localhost:11434/v1",
      "apiKeyEnv": "MEMORY_LANE_SUMMARY_API_KEY",
      "model": "gpt-4.1-mini",
      "maxTokens": 800,
      "timeoutMs": 30000,
      "requireConfirmation": true,
      "includeToolOutputs": false
    }
  }
}
```

Pre-compact summarization reuses `memory.sessionEndSummary`, but hook events cannot ask for confirmation.
To let Claude `PreCompact`, Codex `PreCompact`, or the native pi adapter or release-style generated pi bridge `session_before_compact` save pending summaries, set `memory.sessionEndSummary.requireConfirmation` to `false`; keep `memory.preCompactSummary.enabled` omitted or not `false`.
Set `memory.preCompactSummary.enabled` to `false` to opt out of pre-compact summaries while leaving manual/session-end summaries enabled.

Run it manually with explicit confirmation:

```bash
echo '{"messages":[{"role":"user","content":"Switch to pnpm"},{"role":"assistant","content":"Done."}]}' \
  | memory-lane session-end --confirm
memory-lane review
memory-lane review --kind session_summary --source session-summary  # inspect pending session summaries only
memory-lane review --provenance pi/session_end  # inspect candidates from a specific adapter/event
memory-lane review --provenance codex/pre_compact  # inspect pre-compact session summaries
memory-lane review --suspect-meta  # optional: find old pending delegated-task/finalization prompt pollution
memory-lane review --suspect-meta --include-approved  # include approved suspects that may affect recall
memory-lane approve <id>
memory-lane reject <id>            # reject obsolete/suspect pending entries
```

Codex CLI does not currently expose a supported `SessionEnd` hook event. Do not add `SessionEnd` to `.codex/hooks.json`; Codex will ignore it. For Codex today, use the manual `memory-lane session-end --confirm` command, the supported `Stop` hook explicit-intent path, or the supported `PreCompact` hook when confirmation is disabled in config. When the latest user message says something like "remember this session", "save a session summary", or "summarize this session to memory", `memory-lane codex stop` treats that request as confirmation, summarizes a bounded transcript through the configured provider, and saves the result as a pending session-summary memory. Ordinary `Stop` turns keep the existing silent autosave behavior and do not run the summarizer.

Tool messages are excluded unless `includeToolOutputs` is true.
`timeoutMs` is optional and defaults to 30000 ms for OpenAI-compatible session-summary calls.
Lines that look like secrets are redacted before the transcript is sent to the configured model.
Generated summaries are also cleaned of obvious Memory Lane review-management chatter such as “run memory-lane review” or “approve these memory IDs,” unless review decisions are themselves the durable outcome.
A repeated manual/session-end summary for the same adapter and session id, a repeated pre-compact summary for the same adapter, session id, and turn id or fallback message digest, or a summary with the same normalized durable content as an existing visible pending/approved session summary, is skipped before writing another pending memory.
Generated summaries dominated by operational subagent/orchestrator chatter are skipped when they contain no durable project outcome.
Existing pending suspect summaries may show a read-only `review hint` in CLI review output and `reviewHygiene` metadata in JSON/MCP review output.
Summary hygiene removes obvious review-management chatter from generated summaries before they enter the pending review queue.
When transcript/session messages include canonical ISO timestamps, the saved pending summary stores the latest message timestamp as `freshness.capturedAt`.
No current-time fallback is used.
Claude Code supports `memory-lane claude session-end` through its documented `SessionEnd` hook.
By default it still requires confirmation and will not save from a bare hook unless `memory.sessionEndSummary.requireConfirmation` is set to `false` or the payload includes `confirmed: true` for manual testing.
Claude Code, Codex CLI, the native pi adapter, and the release-style generated pi bridge support pre-compact summaries through `PreCompact` / `session_before_compact` when `memory.sessionEndSummary.enabled` is configured, `memory.sessionEndSummary.requireConfirmation` is `false`, and `memory.preCompactSummary.enabled` is omitted or not `false`.
These summaries save pending `session_summary` memories with `pre_compact` provenance and never block or override host compaction.
Set `memory.preCompactSummary.enabled` to `false` to opt out.
pi also supports explicit session summaries through `/memory session-summary`, using pi's session manager plus interactive confirmation.
Automatic pi `agent_end` and `session_shutdown` summarization remain out of scope.

### Obsidian mirror

Obsidian support is opt-in and disabled by default. JSONL remains the source of truth; Memory Lane can mirror active `approved` and `pending` memories into generated Markdown files in an Obsidian-compatible vault. Hooks do not configure or prompt for Obsidian setup.

```bash
memory-lane obsidian init --vault ~/Obsidian/MyVault
memory-lane obsidian status
memory-lane obsidian sync --dry-run
memory-lane obsidian sync
```

Generated mirror files include:

```text
Memory Lane/index.md
Memory Lane/indexes/pending.md
Memory Lane/indexes/approved.md
Memory Lane/indexes/project.md
Memory Lane/indexes/recent.md
Memory Lane/memories/<id>.md
```

Index files are generated, read-only mirror artifacts. They are safe to browse in Obsidian, but they are not user-authored import notes and may be overwritten by `memory-lane obsidian sync`. The index pages use standard Markdown links to `memories/<id>.md` files. Do not edit generated files directly; changes may be overwritten on the next sync or memory mutation. Rejected/deleted memories are removed from the mirror. Stale deletion is constrained to generated files marked with `memory_lane_mirror: true`; generated indexes are additionally marked with `memory_lane_index: true`.

Generated files include lightweight tags for Obsidian browsing, Bases, or Dataview filtering. Memory files include `memory-lane`, `memory-lane/memory`, and status/category/kind tags such as `memory-lane/status/approved`, `memory-lane/category/project`, and `memory-lane/kind/project_fact`. Index files include `memory-lane` and `memory-lane/index`.

`memory-lane doctor` includes cheap Obsidian diagnostics such as configured vault/folder paths, mirror/import folder existence, and warnings. Doctor does not repair, sync, or write Obsidian files.

`obsidian init` and non-dry-run `obsidian sync` also create an `imports/` folder for user-authored import notes; `obsidian sync --dry-run` does not write files.

### Import from Obsidian

Memory Lane can explicitly import user-authored Markdown notes from the configured Obsidian folder. Import is **not** automatic sync, not bidirectional sync, and not Obsidian-backed storage: JSONL remains the source of truth, generated mirror memory files and generated indexes are never imported, and source notes are not rewritten, moved, archived, deleted, or annotated with generated ids.

Only this folder is scanned, recursively:

```text
<vault>/<folder>/imports/
```

The first implementation intentionally does **not** support `--vault`, `--folder`, or `--path` overrides for import. Configure the mirror once with `memory-lane obsidian init --vault <path> [--folder "Memory Lane"]`, then run import against that configured location.

Each importable note must opt in with top-of-file frontmatter:

```md
---
memory_lane: true
category: project
scope: project
status: pending
---
Use pnpm for package installs.
```

The Markdown body after frontmatter, trimmed, becomes the memory text. Frontmatter is metadata only. Unknown frontmatter fields are ignored. Descriptor metadata is not imported from frontmatter yet. Defaults are:

```yaml
category: personal
scope: global
status: pending
```

Preview first; dry-run performs no JSONL writes and no mirror writes:

```bash
memory-lane obsidian import --dry-run
memory-lane obsidian import --json --dry-run
```

Apply imports:

```bash
memory-lane obsidian import
memory-lane obsidian import --json
```

Rules and gotchas:

- Notes without `memory_lane: true` are ignored.
- Notes with `memory_lane_mirror: true` are skipped because they are generated mirror files; generated indexes also have `memory_lane_index: true` and are not user-authored import notes.
- Dotfiles, dotfolders, symlinks, and non-`.md` files are skipped during discovery.
- Discovery order is deterministic by normalized relative path.
- `status` may be `pending` or explicit `approved`; `rejected` and `deleted` are invalid for import.
- `scope: project` requires a project identity from the running command context; otherwise the note is skipped with a warning.
- Add `memory_lane_id: <id>` to update an existing active (`approved` or `pending`) memory. Missing, rejected, or deleted ids are skipped with warnings.
- Updates do not allow status demotion from `approved` to `pending`, scope changes, or project identity changes.
- Duplicate `memory_lane_id` values in the same run skip all conflicting notes. Duplicate create body text in the same run also skips all conflicting notes.
- Import is partial-success: valid notes are applied; invalid notes are skipped with warnings; there is no transaction or rollback.
- Apply writes through normal Memory Lane APIs, so validation, append-only JSONL, embedding invalidation, and best-effort mirror warnings still apply.

## Configuration

Default config path: `~/.memory-lane/config.json`

Override via env variable: `MEMORY_LANE_CONFIG=/path/to/config.json`

### Minimal config (semantic disabled - default)

No config file needed. Lexical search works out of the box.

### Handoff mode

`memory.handoffMode` declares how proactive Memory Lane should be about cross-session handoff continuity. It defaults to `manual` and is separate from `memory.contextPolicy`: handoff mode describes continuity posture, while context policy controls lifecycle context selection and injection budgets.

```json
{
  "memory": {
    "handoffMode": "manual"
  }
}
```

Values:

- `manual` - current inspection-first behavior. Use explicit CLI/MCP surfaces such as `memory-lane continuity`, `memory-lane status --json`, `memory-lane review`, `memory_list`, `memory_review`, `memory_status`, and `memory_continuity({ projectPath })`.
- `review` - review-first handoff proposal behavior. Existing pending project-scoped continuity candidates, such as pending session summaries or checkpoint/progress candidates, are assembled into a read-only `handoffProposal` on `memory-lane continuity`, `memory-lane continuity --json`, and MCP `memory_continuity`. Review mode does not generate new summaries, approve pending records, or inject handoff bodies into lifecycle context; approve with existing `memory-lane review` / `memory-lane approve <id>` flows before relying on proposals as handoff state.
- `automatic` - opt-in SessionStart continuity behavior. When `memory.contextPolicy.mode` is `selective`, Memory Lane reserves part of the existing SessionStart budget for at most one latest approved current-project handoff pointer (`session_summary` or `project_checkpoint`) so it is not crowded out by generic recency selection. When context policy is `policy-only`, it emits text-free guidance that an approved handoff pointer is available, without memory bodies. When context policy is `off`, automatic handoff mode is inactive. Automatic mode uses approved records only; it does not approve pending records, generate summaries, mutate storage, add new MCP/CLI surfaces, capture transcripts/tool output, or increase budgets.

`memory-lane doctor`, `memory-lane doctor --json`, `memory-lane status --json`, and MCP `memory_status` report `handoffMode`, `handoffModeBehaviorActive`, `handoffModeNote`, and text-free `automaticHandoffDiagnostics` without memory bodies or proposal previews. Human `memory-lane status` stays compact; use `status --json` for the full handoff-mode diagnostic fields.

### Local learning capture

Local learning is opt-in and disabled unless `learning.capture` is set to `"on"`.
The init wizard asks for this consent once and writes either `"on"` or `"off"` to the config.
When enabled, Memory Lane records local, content-free learning files under `~/.memory-lane/traces` by default.
Captured lifecycle traces are redacted, and local learning events store only schema versions, timestamps, event enums, hashed ids, digests, source/kind metadata, actor/reason enums, and recommendation metadata.
The hashed fields are suggestion ids, subject refs, project refs, provenance refs, trigger-context digests, reason digests, recommendation ids, and related suggestion ids.
Source, suggestion kind, event type, decision type, actor, reason code, recommended action, and initial review state stay as enums for local analysis.
`initialReviewState` appears only on `suggestion-created` events.
They do not store raw memory text, prompts, transcripts, hook payloads, tool inputs, tool outputs, or secrets.

```json
{
  "learning": {
    "capture": "on",
    "excludedProjects": ["project-scope-key-to-skip"]
  }
}
```

Local capture observes suggestion creation, review exposure, approve, reject, delete, replace, supersede, reactivation, agreement recommendation exposure, and agreement recommendation acceptance.
Events are written below the owning memory scope, with global memories under `_global/events` and project memories under `<project-hash>/events` using a stable hash of the project scope key.
Capture is conservatively skipped when either the owning project or the acting project appears in `learning.excludedProjects`.
Each learning event sink caches config for its lifetime and enforces retention on its first successful write, then at most once every five minutes per sink; if the injected clock moves backward, the next successful write re-checks retention.
Use `memory-lane status --json` or `memory-lane tuneup --json` to inspect counts and paths.
Use `memory-lane tuneup purge` to remove local learning capture files.
Retention and purge use the same local learning data root as trace capture.

### Semantic search config

```json
{
  "semantic": {
    "enabled": true,
    "activeEmbeddingProfile": "local-ollama",
    "embeddings": {
      "profiles": {
        "local-ollama": {
          "provider": "openai-compatible-embeddings",
          "baseUrl": "http://localhost:11434/v1",
          "model": "nomic-embed-text",
          "apiKeyEnv": null,
          "timeoutMs": 30000
        }
      }
    },
    "retrieval": {
      "topK": 8,
      "minSimilarity": 0.25,
      "semanticWeight": 0.65,
      "lexicalWeight": 0.25,
      "recencyWeight": 0.1,
      "fallbackToAllVisibleOnMiss": true
    },
    "privacy": {
      "allowRemoteEmbeddings": false
    }
  }
}
```

After configuring, run `memory-lane reindex` to embed approved memories that do not already have a current vector for the active profile, model, and content hash.
Use `memory-lane reindex --force` to recompute embeddings even when current vectors already exist.
Embedding provider calls honor optional per-profile `timeoutMs` and default to 30000 ms.

`memory-lane doctor` is read-only. When semantic search is enabled, it reports how many approved memories have current embeddings for the active profile/model. If coverage is low, doctor prints a semantic warning such as “Run `memory-lane reindex`.” Reindexing is an explicit repair step and is not run automatically by doctor or hooks.

`memory-lane doctor` also reports hook debug log diagnostics: `hookDebugEnabledInCurrentEnv`, `hookDebugLogPath`, `hookDebugLogExists`, `hookDebugLogSizeBytes`, `hookDebugLogLastModified`, and `hookDebugWarnings`. These fields help confirm where `~/.memory-lane/hooks-log.jsonl` is, whether it exists, and its size/mtime. Doctor only stats the path; it does not create, read, rotate, truncate, or modify hook debug logs.

`memory-lane doctor` / `memory_status` also report the active context policy knobs: `contextPolicyMode`, prompt/session-start item and character budgets, `contextPolicyIncludePending`, and `contextPolicyFallbackToSearch`.

When `MEMORY_LANE_HOOK_DEBUG=1`, Claude/Codex hook debug records include privacy-safe context decision metadata for injection events: `contextPolicyMode`, `contextEvent`, `contextSelected`, `contextOmitted`, `contextMaxItems`, `contextMaxChars`, and `contextOmittedReasons`. They never include raw prompts, transcripts, tool output, memory text, or injected context text.

`memory-lane doctor` also reports read-only integration diagnostics. It checks whether common local config files appear to contain Memory Lane setup for Claude Desktop MCP, Codex hooks, Claude Code hooks, and the pi extension. These checks inspect config/entrypoint files only; they do not read prompts, transcripts, tool outputs, memory text, MCP traffic, or hook debug log contents. MCP provides explicit tools; hooks and pi provide automatic lifecycle recall/save where supported.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MEMORY_LANE_CONFIG` | `~/.memory-lane/config.json` | Config file path |
| `MEMORY_LANE_FILE` | `~/.memory-lane/memory.jsonl` | Memory store path |
| `MEMORY_LANE_EMBEDDINGS_FILE` | `~/.memory-lane/embeddings.jsonl` | Embeddings store path |
| `MEMORY_LANE_TRACES_DIR` | `~/.memory-lane/traces` | Local learning trace and event data root |

Explicit environment paths always win, keep Memory Lane in single-store mode, and never auto-fallback.
When no explicit paths are set, the default engine uses home storage plus the resolved project store when a project scope is known; an existing parent `.memory-lane/` does not make every memory category project-local.
If home storage is not writable, writable commands and hooks may auto-initialize fallback storage at the resolved project root.
Read-only inspection commands do not create fallback storage just to inspect memory state.

## Programmatic Use

```typescript
import {
  MemoryEngine,
  createSingleStoreEngineStorage,
  createTwoTierEngineStorage,
  memoryDescriptorPreview,
  classifyWorkflowArea,
  resolveEngineStoragePaths,
  type MemoryEngineStorage,
} from "@memory-lane/core"
import { createLearningEventSink } from "@memory-lane/lifecycle"

const engine = new MemoryEngine({
  learningEventSink: createLearningEventSink({ configPath: process.env.MEMORY_LANE_CONFIG, env: process.env }),
})

// Existing memoryPath and embeddingsPath options build the legacy single-store facade.
const testEngine = new MemoryEngine({ memoryPath: "/tmp/memory.jsonl", embeddingsPath: "/tmp/embeddings.jsonl" })

// Advanced tests or integrations can inject a MemoryEngineStorage facade.
const storage: MemoryEngineStorage = createSingleStoreEngineStorage("/tmp/memory.jsonl", "/tmp/embeddings.jsonl")
const engineWithStorage = new MemoryEngine({ storage })

// Programmatic integrations that want CLI-style default two-tier storage should wire the resolver and facade explicitly.
const paths = resolveEngineStoragePaths({ cwd: process.cwd(), env: process.env })
if (paths.kind === "default-two-tier") {
  const tieredStorage = createTwoTierEngineStorage(paths.home, paths.project, paths.projectScopeKey, { producerVersion: "my-integration/1.0.0" })
  const tieredEngine = new MemoryEngine({ storage: tieredStorage, autoCompact: false, configPath: paths.configPath })

  // Review-first legacy project migration APIs mirror the CLI plan/apply flow.
  // They require the two-tier facade with an active project scope.
  const plan = tieredEngine.createLegacyProjectMigrationPlan()
  // Persist and review the plan before applying it with explicit user confirmation.
  const result = tieredEngine.applyLegacyProjectMigrationPlan(plan)
} else {
  const singleStoreStorage = createSingleStoreEngineStorage(paths.home.memoryPath, paths.home.embeddingsPath)
  const singleStoreEngine = new MemoryEngine({ storage: singleStoreStorage, autoCompact: false, configPath: paths.configPath })
}

// Save
engine.save({ text: "use pnpm for all installs", status: "approved" })
engine.save({
  text: "Use pnpm for package management in this repo.",
  status: "approved",
  descriptor: {
    description: "Package manager convention for this project.",
    fetchHint: "working on installs, scripts, or dependency changes",
    keywords: ["pnpm", "dependencies"],
  },
})
engine.suggest(
  "Use pnpm for package management in this repo.",
  "preference",
  "project",
  "preference",
  "pending",
  undefined,
  { description: "Package manager convention for this project." },
)

// Descriptor strings are trimmed and bounded; keywords are lowercased and
// deduplicated before enforcing the 12-keyword limit. Secret-looking
// descriptor fields are rejected. Use memoryDescriptorPreview() when rendering
// bounded continuity-style previews that should prefer safe descriptor text.
const firstMemory = engine.list()[0]
const descriptorPreview = firstMemory ? memoryDescriptorPreview(firstMemory, 160) : undefined
const workflowArea = classifyWorkflowArea("Project workflow loop: review before merge.")

// If your process may exit soon after approved writes, wait for background embeddings.
await engine.settle()

// On shutdown timeouts, cancel outstanding embedding work before exiting.
engine.cancelPendingEmbeddings()

// Recall (semantic or lexical)
const result = await engine.recall("package manager")

// Search (lexical, returns approved only in current project scope)
const memories = engine.search("pnpm")

// List
const all = engine.list()
const pending = engine.list("pending")

// Optional content-free local learning exposure events for custom review UIs.
engine.recordSuggestionsShown(pending, "manual")
engine.recordAgreementRecommendationsShown(engine.operatingAgreements(), "manual")
```

## MCP Server

Memory Lane includes a local stdio MCP server for clients that support explicit MCP tools, such as Claude Desktop and Cursor. The workspace package is `@memory-lane/mcp-server`, and its built bin is `memory-lane-mcp`.

The MCP server exposes explicit tools only.
When local learning capture is enabled, `memory_review` records content-free suggestion exposure events and mutation tools record their review outcome events.

- `memory_save` - save an approved memory
- `memory_suggest` - queue a pending suggestion, or save approved when `status: "approved"`
- `memory_recall` - recall relevant memories for a specific topic or fact query
- `memory_continuity` - canonical continuity read model for broad prior-work, project resumption, last-worked-on, accomplished, next-action, project-status, resume, and handoff-style questions; accepts optional `query` for read-only workstream discovery
- `memory_status` - read Memory Lane counts, config paths, project scope, legacy project-memory diagnostics, and integration diagnostics
- `memory_list` - list memories visible to the current project scope by default
- `memory_review` - list pending memories visible to the current project scope by default; supports `kind`, `source`, and `provenance` filters such as `kind: "session_summary"`, `source: "session-summary"`, `provenance: "pi/session_end"`, and `provenance: "codex/pre_compact"`; pass `all: true` only for cross-project maintenance
- `memory_approve` - approve a memory by id within the current project scope; pass `all: true` only for cross-project maintenance
- `memory_reject` - reject a memory by id within the current project scope; pass `all: true` only for cross-project maintenance
- `memory_delete` - soft-delete a memory by id within the current project scope; pass `all: true` only for cross-project maintenance

MCP tools use global plus the requested `projectPath` by default.
When `projectPath` is omitted, they use the project scope captured when the MCP server started; if the server started without an active project scope, omitted-path calls are global-only.
An explicit `projectPath` is scoped to that one tool call and does not change the scope used by later omitted-path reads or mutations.
Explicit `all: true` bypasses this boundary for administrative workflows; a refused cross-project id returns `not_found` without returning the target memory text.

Use `memory_continuity({ projectPath })` from MCP clients before answering continuity questions such as project resumption, last-worked-on, accomplished, next-action, or project-status prompts. Use `memory_continuity({ projectPath, query: "resume building X" })` when the user asks for a specific workstream. Prefer it over `memory_recall` for continuity; `memory_recall` is a topic-specific follow-up after continuity inspection, not an authority by itself.

Use `memory_status` from MCP clients when you want the same kind of read-only setup/status overview that `memory-lane doctor` provides in a terminal.
It reports counts and diagnostics only; it does not return raw memory text or run lifecycle hooks, except that legacy project-memory diagnostics may include bounded sample previews when legacy candidates exist.
Use filtered `memory_review` calls when you want an MCP client to inspect only pending session summaries or continuity candidates from a specific adapter/event before approving or rejecting them.

**Tip for Claude Desktop and Codex Desktop:** if you ask the model to save or recall a memory without mentioning the MCP, it may first try the `memory-lane` CLI, fail because the sandbox cannot write to `~/.memory-lane`, and then fall back to MCP. To skip that error turn, explicitly say "use the Memory Lane MCP" in your request.

MCP does not replace lifecycle hooks. Hooks provide automatic recall/save behavior for supported harnesses; MCP gives the model explicit tool access when the client asks for it. JSONL remains the source of truth, and Obsidian support remains optional.

Example local stdio command after building this workspace:

```bash
pnpm --filter @memory-lane/mcp-server build
node packages/mcp-server/dist/index.js
```

Do not wrap the server with commands that print banners to stdout. MCP stdio reserves stdout for JSON-RPC protocol messages.

When stdin closes, the server waits briefly for background embedding writes from all project-scoped engines, then cancels outstanding embedding work after a bounded timeout so shutdown does not hang.

See `examples/harness-integrations/mcp.md` for client configuration examples.

## Memory Lifecycle

```
user/agent → suggest() → pending  → approve() → approved
                                  → reject()  → rejected → approve() → approved
approved   → delete()            → deleted
approved   → replace()/supersede() → approved historical record with revision links
```

Compaction removes deleted + rejected tombstones and stale embeddings while preserving malformed or schema-invalid JSONL rows for diagnostics. Trigger: `memory-lane compact` or startup auto-check (>30% dead weight + >100 valid records).

## Harness Integrations

Run `memory-lane init` to auto-detect and configure supported harnesses, or see [`examples/harness-integrations/`](./examples/harness-integrations/) for manual snippets for:
- MCP Server
- Claude Code CLI
- OpenAI Codex CLI
- Cursor
- Windsurf
- pi

Lifecycle autosave intentionally filters transient reviewer, subagent, and task prompts such as commit review requests, “do not modify files” review tasks, and delegated status-report instructions. Those operational prompts are not durable memory. Explicit memory requests remain supported and authoritative: use `memory-lane save ...` or phrases like “Remember that ...” for durable workflow rules, preferences, or project facts.

Shared lifecycle handlers can also queue compact `project_checkpoint` candidates from strong Stop/PostToolUse evidence such as completed release statements, successful release commands, or merged PR commands. These inferred captures are pending by default, deduplicated before saving, and never change approved continuity until the existing review flow approves them; no new CLI or MCP command is required. PostToolUse handlers may also queue pending `procedure` candidates when bounded recent tool evidence shows a failed action followed by a successful safe recovery; the saved text is template-derived and omits raw tool output.

### pi adapter

The pi adapter supports manual Memory Lane tools and commands (`memory_save`, `memory_suggest`, `memory_continuity`, `memory_recall`, and `/memory ...`). It performs read-only lifecycle context injection through pi's documented `before_agent_start` event: broad continuity prompts route to canonical Memory Lane continuity, memory-management prompts route to list/status/review guidance, and other relevant approved memories may be injected as hidden `memory-lane` context before the agent starts.

The repo-local pi adapter also writes memories through higher-signal lifecycle events:

- `input` - explicit memory requests only ("Remember that..."); ordinary prompt submissions are ignored to avoid noisy memory queues.
- `turn_end` - the last user and assistant messages are evaluated for memory-worthy candidates and strong completed-progress checkpoint evidence after a turn completes.
- `tool_result` - successful shell workflow commands such as `pnpm test`, `pnpm build`, and `pnpm install` are captured as project workflow rules; successful release/merge commands may queue pending checkpoint candidates.

Automatic writes skip secrets, transient imperatives, reviewer/subagent meta-prompts, and duplicates within a turn.
Inferred checkpoint candidates stay pending until review; use `/memory review` in pi or the normal CLI/MCP review surfaces to approve or reject them.
Repo-local pi `/memory review` and `/memory delete <id>` respect current-project visibility by default, return not-found behavior without memory text for out-of-scope ids, and require `--all` for deliberate cross-project review or delete.
Set `MEMORY_LANE_DEBUG=1` to append privacy-safe debug records to `~/.memory-lane/pi-debug.jsonl` (no prompts or tool outputs are logged).

For session summaries, use `/memory session-summary` in pi.
The command reads the current conversation branch through pi's session manager, asks for interactive confirmation, sends the compact transcript to the configured `memory.sessionEndSummary` provider, and saves any result as a pending `session_summary` memory with pi `session_end` provenance.
The native pi adapter and release-style generated pi bridge can also save pending pre-compact `session_summary` memories with pi `pre_compact` provenance from `session_before_compact` when `memory.sessionEndSummary.enabled` is configured, `memory.sessionEndSummary.requireConfirmation` is `false`, and `memory.preCompactSummary.enabled` is omitted or not `false`; they do not override pi's own compaction summary.
The release-style generated pi bridge currently does not register repo-local `input`, `turn_end`, or `tool_result` lifecycle writes.
Memory Lane does not automatically summarize pi sessions on `agent_end` or `session_shutdown`.

### Context policy

Lifecycle hooks use `memory.contextPolicy` to decide how much context to inject. This is orthogonal to `memory.handoffMode`: handoff mode declares continuity posture, while context policy controls body selection and budgets. Defaults preserve existing behavior with bounded selected memory blocks:

```json
{
  "memory": {
    "contextPolicy": {
      "mode": "selective",
      "maxItems": { "sessionStart": 4, "prompt": 6 },
      "maxChars": { "sessionStart": 1600, "prompt": 3000 },
      "preferenceMaxItems": { "sessionStart": 2, "prompt": 2 },
      "preferenceMaxChars": { "sessionStart": 600, "prompt": 900 },
      "includePending": false,
      "fallbackToSearch": true
    }
  }
}
```

Modes:

- `selective` injects selected approved memories inside a guarded `<memory-context>` block.
- `policy-only` injects compact guidance telling the agent to use the appropriate Memory Lane continuity, recall, list, status, or review surface when needed, without including memory bodies.
- `off` disables automatic context injection while leaving explicit CLI/MCP tools and automatic save hooks unchanged.

When `selective` mode injects memory bodies, the `Relevant Memory` block is grouped for readability. Current-project memories are separated from global preferences/workflow rules and other visible project memories, and each memory shows a plain-language type label such as `Project checkpoint`, `Workflow rule`, `Preference`, or `Project fact`. These labels explain applicability only; they do not change recall ranking or memory status.

Prompt-time automatic injection skips low-signal greetings and acknowledgements such as `hi`, `hello`, `ok`, and `thanks`, while preserving meaningful technical prompts such as `pnpm`, `docker`, `wrangler`, `how do I run tests`, and continuity prompts. Broad project-position/next-work continuity prompts receive inspection-first continuity guidance without ordinary recall bodies; topic-specific continuity prompts can still use bounded recall. The internal `memory-lane route --prompt <text> --json` command exposes the shared deterministic routing decision used by generated bridge adapters. Release-style generated pi bridges also cap automatic prompt recall context using `contextPolicyPromptMaxChars` with a safe fallback, while explicit recall/get tools remain full-fidelity for deliberate inspection.

Global preferences (`category: "preference"`, `kind: "preference"`, or `kind: "workflow_rule"` with `scope: "global"`) are selected in a bounded preference layer so user-wide guidance can travel across projects without crowding out current-project facts, checkpoints, or decisions. Project-scoped preferences render before global preferences for the same project, which lets narrower project guidance take precedence in context without creating an automatic supersede, cleanup, or override relationship.

For `SessionStart`, baseline memory selection is layered when a project scope is available: current-project preferences, then current-project content, then bounded global preferences, then other global memory and other visible project memory if budget remains. In `selective` mode, SessionStart renders tiny always-on preference/workflow-rule bodies first, then fills remaining budget with `Memory Index` descriptor cards that point to exact `memory-lane show|get <id>` inspection. Descriptor cards prefer structured `description` and `fetchHint` metadata when present, otherwise they use generated text previews. If `memory.handoffMode` is `automatic`, one latest approved current-project handoff pointer can be prioritized before generic baseline layers while still consuming the same `sessionStart` character budget; expired or superseded handoff pointers are omitted. Prompt-time `UserPromptSubmit` recall remains relevance-based; global preferences are not injected merely because they are global, but relevant global preferences can appear within the `preferenceMaxItems` and `preferenceMaxChars` caps.

To save a user-wide preference from the CLI:

```bash
memory-lane save "Prefer concise final answers" --category preference --scope global
```

To narrow that preference for one project, save a project-scoped preference from that project or pass `--project` explicitly:

```bash
memory-lane save "In this repo, include full verification output" --category preference --scope project --project /path/to/project
```

For MCP clients, use the existing save tool with the same category/scope idea:

```json
memory_save({ "text": "Prefer concise final answers", "category": "preference", "scope": "global" })
memory_save({ "text": "In this repo, include full verification output", "category": "preference", "scope": "project", "projectPath": "/path/to/project" })
```

Use existing inspection surfaces before changing or relying on preference state:

- CLI: `memory-lane list --json`, `memory-lane review --json`, `memory-lane status --json`, and `memory-lane continuity --json`
- MCP: `memory_list`, `memory_review`, `memory_status`, and `memory_continuity({ projectPath })`

`memory-lane status --json`, `memory-lane doctor --json`, and MCP `memory_status` include text-free `preferenceDiagnostics` counts. These diagnostics show the visible preference pool and SessionStart preference-cap selection counts without returning preference bodies, ids, or previews. Use `memory-lane list --json`, `memory-lane review --json`, targeted recall, or MCP `memory_list`/`memory_recall` when you need the actual preference text.

The optional `preferenceMaxItems` and `preferenceMaxChars` fields are caps, not guarantees. Overall `maxItems` and `maxChars` still cap the full rendered memory block.

### Prompt-time continuity guidance

When lifecycle prompt hooks receive natural continuity questions such as “resume building X,” “where was X implemented,” “where are we in the project,” “what is the next item's scope,” “what were we last working on,” or “what should we work on next,” Memory Lane may add a compact inspection-first guidance block. The guidance leads CLI-capable harnesses to `memory-lane continuity --json` and MCP clients to `memory_continuity({ projectPath })`, then keeps existing status/dashboard and targeted `memory-lane recall "X"` follow-up when a topic is detected. The routing is deterministic and shared by Claude/Codex lifecycle hooks, repo-local Pi, and generated Pi bridges through the CLI route decision.

Do not answer continuity questions from `memory_recall` alone. Recall is useful for topic-specific follow-up after continuity inspection, but canonical continuity state comes from `memory-lane continuity --json` or MCP `memory_continuity({ projectPath })`.

This prompt-time guidance is governed by `memory.contextPolicy.mode`: `off` suppresses it, `policy-only` emits guidance without memory bodies, and `selective` renders guidance without ordinary recall bodies for broad project-position/next-work prompts so stale relevant-memory matches do not compete with canonical continuity. Topic-specific prompts such as “resume building X” or “where was X implemented” can still render guidance before a normal budgeted relevant-memory block. It does not write memories, run cleanup, change recall ranking, inject additional memory bodies beyond the selected prompt context, or require users to know Memory Lane internal terms such as operating agreements or continuity hints.

### Lifecycle continuity notices

SessionStart lifecycle context may include a compact `Continuity notice` section when `memory.contextPolicy.mode` is `policy-only` or `selective`. The notice is plain-language and inspection-first: it may say that newer approved state exists, current workflow agreements are available, or continuity hints should be inspected.

Continuity notices share the existing SessionStart context budget. They do not include memory ids, memory text, transcripts, or tool outputs. They do not mutate memory, clean up superseded records, change recall ranking, or run on every UserPromptSubmit turn. Set `memory.contextPolicy.mode` to `off` to disable all lifecycle context, including continuity notices.

### Claude Code hooks

Claude Code CLI users can wire Memory Lane into lifecycle hooks:

```bash
memory-lane claude session-start
memory-lane claude user-prompt-submit
memory-lane claude stop
memory-lane claude post-tool-use
memory-lane claude session-end
memory-lane claude pre-compact
```

`SessionStart` injects a compact session-opening context when allowed by `memory.contextPolicy.mode`: tiny always-on bodies plus `Memory Index` descriptor cards in `selective` mode, and guidance without memory bodies in `policy-only` mode. `UserPromptSubmit` follows the same context policy: `off` suppresses injection, `policy-only` emits guidance without memory bodies, and `selective` injects a small relevant-memory block for ordinary or topic-specific prompts while suppressing ordinary recall bodies for broad `project-position` and `next-work` continuity prompts. `Stop`, `PreCompact`, and `PostToolUse` save useful memories externally and remain quiet when nothing pending was suggested. When a write hook saves pending memories, Memory Lane may emit a compact count-only system message such as `Memory Lane: suggested 1 pending memory for review. Run memory-lane review to approve or reject it.` The notice does not include memory text, prompts, transcripts, or tool output. Hook commands fail safe: if storage/config/plugin initialization fails, Claude/Codex hook invocations return `{}` and exit successfully so the host session is not blocked; set `MEMORY_LANE_HOOK_DEBUG=1` to also print the initialization failure on stderr. Hook shutdown waits briefly for background embedding writes and cancels outstanding embedding work after a bounded timeout. Claude Code's documented `SessionEnd` hook can run `memory-lane claude session-end` to generate pending `session_summary` memories when `memory.sessionEndSummary.enabled` is configured. By default, Memory Lane still requires confirmation; a bare hook will not save unless `memory.sessionEndSummary.requireConfirmation` is set to `false` or the payload is invoked with `confirmed: true` for manual testing. Claude Code's `PreCompact` hook can run `memory-lane claude pre-compact` to save pending `session_summary` memories with `pre_compact` provenance before context compaction when `memory.sessionEndSummary.requireConfirmation` is `false` and `memory.preCompactSummary.enabled` is omitted or not `false`; set `memory.preCompactSummary.enabled` to `false` to opt out. A real Claude Code CLI smoke test in Sitewright confirmed `SessionEnd` fires with the project cwd and saves a pending `session_summary` with Claude `session_end` provenance when enabled and configured. Set `MEMORY_LANE_HOOK_DEBUG=1` for concise hook diagnostics and persistent metadata/count logs at `~/.memory-lane/hooks-log.jsonl`. The hook debug log does not include prompts, transcripts, or tool output.

These commands are for Claude Code CLI hooks, not the Claude Desktop app. Use the MCP Server setup above for Claude Desktop.

### Codex hooks

Codex CLI users can wire Memory Lane into lifecycle hooks:

```bash
memory-lane codex session-start
memory-lane codex user-prompt-submit
memory-lane codex stop
memory-lane codex post-tool-use
memory-lane codex pre-compact
```

`SessionStart` baseline injection is available for compact session-opening context when allowed by `memory.contextPolicy.mode`: tiny always-on bodies plus `Memory Index` descriptor cards in `selective` mode, and guidance without memory bodies in `policy-only` mode. `UserPromptSubmit` follows the same context policy: `off` suppresses injection, `policy-only` emits guidance without memory bodies, and `selective` injects a small relevant-memory block for ordinary or topic-specific prompts while suppressing ordinary recall bodies for broad `project-position` and `next-work` continuity prompts. `Stop`, `PreCompact`, and `PostToolUse` save useful memories externally and remain quiet when nothing pending was suggested. When a write hook saves pending memories, Memory Lane may emit a compact count-only system message such as `Memory Lane: suggested 1 pending memory for review. Run memory-lane review to approve or reject it.` The notice does not include memory text, prompts, transcripts, or tool output. Hook commands fail safe: if storage/config/plugin initialization fails, Claude/Codex hook invocations return `{}` and exit successfully so the host session is not blocked; set `MEMORY_LANE_HOOK_DEBUG=1` to also print the initialization failure on stderr. Hook shutdown waits briefly for background embedding writes and cancels outstanding embedding work after a bounded timeout. Codex `PreCompact` can run `memory-lane codex pre-compact` to save pending `session_summary` memories with `pre_compact` provenance before context compaction when `memory.sessionEndSummary.requireConfirmation` is `false` and `memory.preCompactSummary.enabled` is omitted or not `false`; set `memory.preCompactSummary.enabled` to `false` to opt out. If the latest user message explicitly asks to summarize the session (for example, "remember this session"), the supported `Stop` hook path uses `memory.sessionEndSummary` to save a pending session summary for review with `memory-lane review`; do not configure an unsupported Codex `SessionEnd` hook. Set `MEMORY_LANE_HOOK_DEBUG=1` for concise hook diagnostics and persistent metadata/count logs at `~/.memory-lane/hooks-log.jsonl`. The hook debug log does not include prompts, transcripts, or tool output.

See `examples/harness-integrations/codex-cli.md` for setup details.

## License

Memory Lane is released under the [MIT License](./LICENSE).
