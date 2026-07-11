# Memory Lane Integration for OpenAI Codex CLI

This integration covers the **Codex CLI**. Codex Desktop uses MCP instead.

## Recommended setup: run `memory-lane init`

The easiest way to configure Codex CLI is to run:

```bash
memory-lane init
```

This detects Codex CLI and installs:
- Lifecycle hooks in `~/.codex/hooks.json`
- A user skill at `~/.agents/skills/memory-lane/SKILL.md` so `$memory-lane` is available as a skill mention/slash command in Codex CLI, IDE, and Codex app

Use `memory-lane init --yes` to auto-accept all detected harnesses.
When `init` writes JSON config, it preserves unrelated settings and hooks, replaces older Memory Lane hook entries, creates a one-time `<config>.memory-lane.bak` backup before the first successful write, and leaves malformed JSON untouched with an error.

## Manual setup: Codex hooks

Start with project-level `.codex/hooks.json` while testing Memory Lane in one repository. Move the same hooks to user-level `~/.codex/hooks.json` after you trust the behavior globally.

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

Codex tool matcher names can vary by version. If `PostToolUse` does not fire, adjust the matcher to the shell tool name shown by your Codex installation.

`SessionStart` injects compact session-opening context when a new Codex session begins. In `selective` mode, it can include tiny always-on memory bodies plus `Memory Index` descriptor cards that point to exact `memory-lane show|get <id>` inspection; descriptor cards use stored metadata when present and generated previews otherwise. It uses a stricter budget than `UserPromptSubmit` and does not dump the full project history. It is safe to leave enabled alongside `UserPromptSubmit`.

## Context budget

`UserPromptSubmit` uses the shared prompt route decision before Codex processes the prompt. Low-signal prompts such as `ok` or `thanks` inject nothing, memory-management prompts get list/status/review guidance, broad project-position or next-work prompts get continuity guidance without ordinary recall bodies, and eligible ordinary or topic-specific prompts can receive relevant approved memories within strict item and character limits.

`Stop`, `PreCompact`, and `PostToolUse` do not inject context. They save concise memories externally and are silent by default. `PreCompact` can save a pending session summary immediately before Codex compacts context when `memory.sessionEndSummary.enabled` is configured and `memory.sessionEndSummary.requireConfirmation` is `false`; set `memory.preCompactSummary.enabled` to `false` to opt out. `Stop` only runs session-summary automation when the latest user message explicitly asks for it, such as "remember this session", "save a session summary", or "summarize this session to memory". If hook initialization fails because storage, config, or plugins cannot be loaded, Memory Lane returns `{}` and exits successfully so Codex is not blocked; set `MEMORY_LANE_HOOK_DEBUG=1` to also print the initialization failure on stderr.

## Session-end summarization

Session-end summarization is opt-in, and current Codex CLI hooks do **not** include a supported `SessionEnd` event. Do not add `SessionEnd` to `.codex/hooks.json`; Codex will ignore unsupported hook names.

For Codex today, there are supported options after enabling `memory.sessionEndSummary` in `~/.memory-lane/config.json`:

1. Ask in your latest Codex prompt: "remember this session", "save a session summary", or "summarize this session to memory". The existing `Stop` hook treats that prompt as confirmation, reads a bounded transcript tail, sends it to the configured summary provider, and saves the result as a pending memory. Ordinary `Stop` turns keep the existing autosave behavior and do not summarize sessions.
2. Configure `PreCompact` with `memory.sessionEndSummary.requireConfirmation` set to `false` so Codex can queue a pending pre-compact summary before compaction. Set `memory.preCompactSummary.enabled` to `false` to opt out without disabling manual or explicit-intent summaries.
3. Use the manual command and pass a compact transcript JSON on stdin:

```bash
echo '{"messages":[{"role":"user","content":"Switch to pnpm"},{"role":"assistant","content":"Done."}]}' \
  | memory-lane session-end --confirm
memory-lane review
```

Generated summaries are saved as pending memories. Approve them with `memory-lane approve <id>` before they affect future recall. Raw transcripts are not stored; tool messages are excluded unless `includeToolOutputs` is true, and likely secret lines are redacted before sending content to the configured model.

Memory Lane includes a future-compatible Codex-shaped `session-end` adapter path for tests/manual payload experiments, but it is not wired to any real Codex lifecycle event until OpenAI ships one.

## Sandboxed storage

Memory Lane prefers global storage at `~/.memory-lane/`. If Codex asks for permission to write there, approving it keeps memories global across projects.

If home storage is not writable and no explicit `MEMORY_LANE_*` paths are set, Memory Lane automatically initializes `.memory-lane/` inside the project and continues with project-local storage. You can also initialize it explicitly:

```bash
memory-lane init --project-local --project /path/to/project
```

This creates `.memory-lane/` inside the project and prints environment variables you can add to hook configuration if needed. Commands run with `--project /path/to/project` automatically prefer `.memory-lane/` when it exists.

## Privacy and review

Memory Lane inspects prompts, bounded transcript tails, and bounded tool-output previews locally.
It does not save raw transcripts, hook payloads, prompts, tool inputs, or full tool outputs.
Secret detection runs before save and before injection.
If opt-in local learning is enabled with `learning.capture: "on"`, Memory Lane may also write content-free trace and review outcome files under the local learning data root.
Those files contain redacted traces or hashed ids, digests, timestamps, event enums, and review metadata, not raw memory text or prompt content.

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

With an OpenAI-compatible embedding provider configured in `~/.memory-lane/config.json`, newly saved approved memories queue background embedding work that hooks may wait on briefly before canceling pending work on timeout. Run `memory-lane reindex` to embed approved memories missing current vectors, or `memory-lane reindex --force` to recompute current vectors.
