# Developing Memory Lane

Reference for building Memory Lane from source, loading local builds into each harness, and running the release gates and optional evals.
End users do not need anything on this page; `memory-lane init` installs release-style integrations automatically.

## Build from source

For development or custom builds:

```bash
git clone <repo>
cd memory-lane
pnpm install
pnpm build
```

For local binary builds, run `pnpm build:binary` after `pnpm build`.
Compiled binaries embed release metadata from `MEMORY_LANE_VERSION`, an exact Git tag, or a short commit fallback; development builds without that metadata report `0.0.0-dev`.

## Link the CLI globally

```bash
cd packages/cli
pnpm link --global
```

After linking, `memory-lane` is available as a shell command:

```bash
memory-lane doctor
```

## Development setup: local checkout + manual harness config

If you are developing Memory Lane and using it on the same machine, avoid `memory-lane init --yes` unless you intentionally want release-style harness config.
The init wizard is safe for end users, but on a development machine it can overwrite local shims or hand-edited settings that point at your checkout.
`init` and `upgrade` now skip generated Claude/Codex skill writes when the destination resolves through a symlink into the Memory Lane source checkout, printing a warning while preserving other hook/config writes.
JSON hook/config writes preserve unrelated entries, replace older Memory Lane hook entries, create a one-time `.memory-lane.bak` backup before the first successful write, and refuse to overwrite malformed JSON.
Release-style pi init writes a CLI bridge around the installed binary; for full local pi adapter behavior while developing, use the manual shim below.
Prefer manual config so each harness loads the code you just built.

Recommended development loop:

```bash
cd /absolute/path/to/memory-lane
pnpm install
pnpm build
cd packages/cli
pnpm link --global
```

After source changes, run `pnpm build` again and reload/restart the harness you are testing.

### Harness adapter/template release guardrail

When changing generated harness adapters, installer templates, or release-style bridges, do not rely on registration-only smoke tests or reviewer inspection.
Before release:

1. Add contract-level tests, not just extension load or registration tests.
2. Invoke every generated lifecycle hook, command, and tool branch with realistic fake harness inputs.
3. Assert exact host API return shapes against the host docs/source.
4. Compare generated release/native behavior with repo-local adapter behavior when both paths exist.
5. Dogfood the actual generated installed artifact through the lifecycle event users trigger, not only startup/load.

For pi specifically, `before_agent_start` must return a custom message object such as `{ message: { customType, content, display, details? } }`; returning a raw string is invalid even if the extension loads successfully.

For OMP compatibility work, run both real-runtime gates against the repository-pinned OMP version before releasing changes to the pi adapter, generated extension sources, or OMP installer:

```bash
pnpm --filter @memory-lane/pi-adapter build
pnpm --filter @memory-lane/cli build
pnpm --filter @memory-lane/cli eval:omp-discovery
pnpm --filter @memory-lane/cli eval:omp-contract -- --as-of YYYY-MM-DD --manual-input --out test/fixtures/omp-contract-16.4.8.json
```

Both gates require OMP `16.4.8`; the lifecycle contract additionally requires a genuine interactive terminal for the two prompted `input` submissions.
The discovery gate installs both production source forms into isolated default and `PI_CODING_AGENT_DIR` roots, launches real OMP without `--extension`, and verifies expected commands and tools through OMP's normal loader.
The lifecycle gate uses a credential-free loopback provider for deterministic tool execution, loads both production extension forms through real `omp --extension` scratch profiles, records sanitized per-event evidence, and exits non-zero when any expected registration is missing, any lifecycle event remains unverified, or any lifecycle event fails.
Neither gate needs a network-dependent model call or touches the real user profile or memory store.
The tested lifecycle version and date live in `packages/cli/test/fixtures/omp-contract-16.4.8.json`.
The current committed lifecycle contract was tested against OMP `16.4.8` on `2026-07-13` and reports `overallPass: true`.
The committed report must keep `overallPass: true`.

Windows self-maintenance changes also require the `windows-latest` CI smoke.
It runs the focused deferred-uninstall process-identity test and `scripts/windows-self-maintenance-smoke.ts` against real Windows executable locking to cover failed-upgrade rollback, successful running-executable replacement, post-exit transaction cleanup, self-uninstall, and default memory-data retention.

### Optional local evals

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

### pi: load the local adapter

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

Replace `/absolute/path/to/memory-lane` with your checkout path, then run `/reload` in pi.
The timestamp query avoids stale module caches while iterating locally.
Re-run `pnpm build` after changing Memory Lane source, then `/reload` pi again.

The local checkout pi adapter provides manual `memory_save`, `memory_suggest`, `memory_continuity`, and `memory_recall` tools plus `/memory ...` commands, including `/memory continuity [query]`.
Repo-local pi `/memory review` and `/memory delete <id>` stay scoped to the active project plus globals by default; add `--all` only for explicit cross-project maintenance.
Release-style generated pi bridges expose the same continuity tool, proxy `/memory continuity ...` through the CLI, and use `memory-lane route --prompt <text> --json` for shared prompt-routing parity.
They also inject project context through pi's `before_agent_start` event.
Broad continuity prompts such as “what were we last working on?”, “where did we leave off?”, and “what's next?” route to canonical Memory Lane continuity (`memory-lane continuity --json`, or `memory-lane continuity --query ...` for topic-specific workstreams) before topic-specific recall, while ordinary targeted prompts continue to use bounded recall.
Both repo-local and generated pi continuity rendering de-duplicate repeated continuity ids and promote actionable warning inspection commands before operating guidance.
To reduce memory noise, both the repo-local pi adapter and release-style generated pi bridge save `input` only for explicit memory requests such as “Remember that ...”; ordinary prompt submissions are not auto-saved.
Both production forms route `input`, `turn_end`, and `tool_result` through shared CLI lifecycle policy, preserving explicit-save filtering, durable-statement capture, successful workflow command capture, deduplication, secret filtering, project routing, and pending review status.
On OMP, automatic lifecycle capture is suppressed only when nested session-file ownership and OMP's delegated-worker system role both identify a task session, preventing duplicate task memories while leaving ordinary sessions unchanged.
Inferred checkpoint captures are pending by default and require review before they affect approved continuity.
For session summaries, pi uses the explicit `/memory session-summary` command: it reads the current branch through pi's session manager, asks for interactive confirmation, and saves any generated summary as a pending `session_summary` memory with pi `session_end` provenance.
The native pi adapter and release-style generated pi bridge also listen to `session_before_compact` and can save a pending pre-compact `session_summary` with pi `pre_compact` provenance when `memory.sessionEndSummary.enabled` is configured, `memory.sessionEndSummary.requireConfirmation` is `false`, and `memory.preCompactSummary.enabled` is omitted or not `false`; they do not override pi's own compaction summary.
It does not automatically summarize on `agent_end` or `session_shutdown`.
The release-style generated pi extension is intentionally a self-contained CLI bridge so pi never tries to import the native `memory-lane` binary as TypeScript.

### OMP: load and restart the local adapter

OMP `16.4.8` does not provide an in-session command that reloads an already loaded extension module from source.
An isolated real-OMP smoke confirmed that `ctx.reload()` and `/reload-plugins` preserve existing registrations but do not pick up a rebuilt adapter behind an unchanged extension entrypoint.
The reliable OMP development loop is therefore rebuild, exit OMP, and start or resume OMP again.

Set the extension root to the default OMP agent directory or an explicit profile directory, then create the shim:

```bash
export PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}"
mkdir -p "$PI_CODING_AGENT_DIR/extensions/memory-lane"
cat > "$PI_CODING_AGENT_DIR/extensions/memory-lane/index.ts" <<'EOF'
export default async function memoryLaneDevelopmentExtension(pi: any) {
  const adapter = await import(
    "file:///absolute/path/to/memory-lane/packages/pi-adapter/dist/index.js"
  )
  return adapter.default(pi)
}
EOF
```

Replace `/absolute/path/to/memory-lane` with the absolute checkout path.
Run `pnpm build`, start OMP, and confirm that `/memory`, `/remember`, `memory_save`, `memory_suggest`, `memory_continuity`, and `memory_recall` are available.
After changing Memory Lane source, run `pnpm build` again, exit the active OMP process, and start OMP again.
Use `omp --continue` from the same project when you want to resume the latest session after the restart.
OMP's `/reload-plugins` command refreshes plugin registries and related resources, but it does not reload the active Memory Lane extension source.
Named OMP profiles are not guessed; set `PI_CODING_AGENT_DIR` to the profile's absolute agent directory before starting OMP or configure the profile's `extensions:` list manually.

### OMP: intentionally unused host APIs

Memory Lane's verified OMP production contract uses `input`, `before_agent_start`, `turn_end`, `tool_result`, and `session_before_compact`.
The native adapter and generated bridge route these events through the same cross-harness lifecycle policy.
Other OMP-only APIs remain intentionally unused:

- `session_stop` can request another model-visible continuation before a turn settles.
  Memory Lane records settled evidence through `turn_end`; it does not change OMP control flow or risk duplicate capture by continuing a completed turn.
- `before_provider_request` can replace the raw provider request payload.
  Memory Lane injects bounded context through the host-level `before_agent_start` event instead of coupling memory policy to provider-specific wire formats.
- `message_start`, `message_update`, and `message_end` expose message and token-stream observability.
  Memory Lane waits for complete bounded turn evidence from `turn_end` rather than persisting partial or duplicated streaming state.
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `tool_approval_requested`, `tool_approval_resolved`, and `tool_call` expose execution telemetry, approval state, or pre-execution control.
  Memory Lane consumes the completed normalized `tool_result` and does not mutate tool calls, approval decisions, or streaming execution.
- `ctx.memory` is OMP's optional host-owned structured-memory runtime.
  Memory Lane keeps one cross-harness, review-governed store and CLI/tool surface instead of introducing a second OMP-specific backend or ownership model.

These omissions are deliberate boundaries, not inferred OMP compatibility.
Adding an OMP-only handler requires a separately reviewed behavior need and must not create a second lifecycle-policy implementation.

### Claude Code CLI: paste hooks manually

For local development, paste hooks into `~/.claude/settings.json` or a project-local `.claude/settings.local.json` instead of letting init own the file.
Merge this `hooks` object into any existing settings:

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

Use `/hooks` in Claude Code to verify which settings file supplied the hooks.
`SessionEnd` only saves summaries when `memory.sessionEndSummary` is enabled and provider-configured; by default it still requires confirmation unless `requireConfirmation` is set to `false`.
`PreCompact` uses the same provider config and saves pending summaries before context compaction only when `memory.sessionEndSummary.requireConfirmation` is `false` and `memory.preCompactSummary.enabled` is omitted or not `false`; set `memory.preCompactSummary.enabled` to `false` to opt out.

### Codex CLI: paste supported hooks manually

For Codex CLI, paste hooks into a project-level `.codex/hooks.json` while testing, then move them to `~/.codex/hooks.json` if you want global behavior.
Do **not** add a Codex `SessionEnd` hook; current Codex hooks do not support that event.

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

Codex `PreCompact` can save a pending session summary before context compaction when `memory.sessionEndSummary.enabled` is configured, `memory.sessionEndSummary.requireConfirmation` is `false`, and `memory.preCompactSummary.enabled` is omitted or not `false`; set `memory.preCompactSummary.enabled` to `false` to opt out.
Codex `Stop` can produce a session summary only when the latest user message explicitly asks for it, such as "remember this session" or "summarize this session to memory".

### MCP clients: point at the local server

MCP client settings always use the same shape `memory-lane init` writes: an absolute `memory-lane` command plus `args: ["mcp"]`.
Do not use `~` in client config fields that expect paths, and do not point client settings at a Node executable; desktop clients usually launch MCP servers without your shell PATH.

For a source checkout, build and link the CLI, then resolve the linked absolute path:

```bash
pnpm build
cd packages/cli && pnpm link --global
command -v memory-lane
```

Use that output as the client `command` with `args: ["mcp"]`.
The linked CLI is a Node script, so a GUI-launched client must still be able to resolve `node` through the script's `#!/usr/bin/env node` shebang outside your shell environment; if that fails, install the release binary for client configs and keep the linked CLI for terminal work.
To run or test the built server source directly in a terminal (not as a client setting), use `node packages/mcp-server/dist/index.js`.

Set the working directory to the project you want Memory Lane to use as the startup project scope, for example `/absolute/path/to/your/project`.
Explicit MCP `projectPath` calls are scoped only to that request and do not change the startup scope used by later omitted-path calls.

End users do not need these manual development shims - `memory-lane init` installs release-style integrations automatically.
