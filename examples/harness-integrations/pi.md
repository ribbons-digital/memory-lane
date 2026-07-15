# Memory Lane Integration for pi

## Recommended setup: run `memory-lane init`

The easiest way to configure pi is to run:

```bash
memory-lane init --only pi
```

Use `memory-lane init --yes` if you want Memory Lane to configure every detected harness, including pi.
pi is detected when `~/.pi/agent` exists.

Init writes a release-style Memory Lane extension to:

```text
~/.pi/agent/extensions/memory-lane/index.ts
```

The installed extension is a self-contained CLI bridge around the installed `memory-lane` binary, so pi never tries to import the native `memory-lane` binary as TypeScript.
pi and OMP are separate integrations that may be installed side by side; installing or removing one does not affect the other.

## What the extension provides

Manual tools and commands:

- `memory_save`, `memory_suggest`, `memory_continuity`, and `memory_recall` tools;
- `/memory ...` commands, including `/memory continuity [query]`, `/memory review`, `/memory delete <id>`, and `/memory session-summary`.

Automatic lifecycle behavior through shared CLI lifecycle policy:

- `input` saves explicit memory requests only ("Remember that ..."); ordinary prompt submissions are not auto-saved.
- `before_agent_start` injects bounded read-only context: broad continuity prompts route to canonical Memory Lane continuity, memory-management prompts route to list/status/review guidance, and other relevant approved memories may be injected as hidden context within the configured prompt item and character budgets.
- `turn_end` evaluates the last user and assistant messages for memory-worthy candidates and strong completed-progress checkpoint evidence.
- `tool_result` captures successful shell workflow commands (such as `pnpm test`, `pnpm build`, `pnpm install`) as project workflow rules and may queue pending checkpoint candidates from release/merge commands.
- `session_before_compact` can save a pending pre-compact `session_summary` when `memory.sessionEndSummary.enabled` is configured, `memory.sessionEndSummary.requireConfirmation` is `false`, and `memory.preCompactSummary.enabled` is omitted or not `false`.

Inferred captures stay pending until review; use `/memory review` in pi or the normal CLI/MCP review surfaces.
`/memory review` and `/memory delete <id>` respect current-project visibility by default and require `--all` for deliberate cross-project maintenance.

Set `MEMORY_LANE_DEBUG=1` to append privacy-safe debug records to `~/.memory-lane/pi-debug.jsonl` (no prompts or tool outputs are logged).

## Maintenance

After init records pi in `~/.memory-lane/install.json`, upgrade reapplies the recorded integration:

```bash
memory-lane upgrade --yes
```

`memory-lane doctor` reports the pi extension separately from OMP.
Full `memory-lane uninstall --yes` removes the pi extension along with other integrations while preserving memory data; selective `--only` uninstall currently supports only OMP.

## Local development

For local adapter development with a source checkout, see [pi: load the local adapter](../../docs/development.md#pi-load-the-local-adapter).
See [Harness integrations](../../docs/harness-integrations.md#pi-adapter) for full pi adapter behavior details.
