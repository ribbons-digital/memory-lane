# Configuration

Default config path: `~/.memory-lane/config.json`

For `memory-lane mcp`, `~` resolves from `HOME` when it is defined, otherwise from the operating system home directory.
This keeps the MCP server on the normal Windows user profile when clients start it without `HOME`.

Override via env variable: `MEMORY_LANE_CONFIG=/path/to/config.json`

## Minimal config (semantic disabled - default)

No config file needed.
Lexical search works out of the box.

## Handoff mode

`memory.handoffMode` declares how proactive Memory Lane should be about cross-session handoff continuity.
It defaults to `manual` and is separate from `memory.contextPolicy`: handoff mode describes continuity posture, while context policy controls lifecycle context selection and injection budgets.

```json
{
  "memory": {
    "handoffMode": "manual"
  }
}
```

Values:

- `manual` - current inspection-first behavior.
  Use explicit CLI/MCP surfaces such as `memory-lane continuity`, `memory-lane status --json`, `memory-lane review`, `memory_list`, `memory_review`, `memory_status`, and `memory_continuity({ projectPath })`.
- `review` - review-first handoff proposal behavior.
  Existing pending project-scoped continuity candidates, such as pending session summaries or checkpoint/progress candidates, are assembled into a read-only `handoffProposal` on `memory-lane continuity`, `memory-lane continuity --json`, and MCP `memory_continuity`.
  Review mode does not generate new summaries, approve pending records, or inject handoff bodies into lifecycle context; approve with existing `memory-lane review` / `memory-lane approve <id>` flows before relying on proposals as handoff state.
- `automatic` - opt-in SessionStart continuity behavior.
  When `memory.contextPolicy.mode` is `selective`, Memory Lane reserves part of the existing SessionStart budget for at most one latest approved current-project handoff pointer (`session_summary` or `project_checkpoint`) so it is not crowded out by generic recency selection.
  When context policy is `policy-only`, it emits text-free guidance that an approved handoff pointer is available, without memory bodies.
  When context policy is `off`, automatic handoff mode is inactive.
  Automatic mode uses approved records only; it does not approve pending records, generate summaries, mutate storage, add new MCP/CLI surfaces, capture transcripts/tool output, or increase budgets.

`memory-lane doctor`, `memory-lane doctor --json`, `memory-lane status --json`, and MCP `memory_status` report `handoffMode`, `handoffModeBehaviorActive`, `handoffModeNote`, and text-free `automaticHandoffDiagnostics` without memory bodies or proposal previews.
Human `memory-lane status` stays compact; use `status --json` for the full handoff-mode diagnostic fields.

## Lifecycle capture governance

`memory.lifecycleCapture` controls automatic candidates from lifecycle write hooks independently from explicit `save`, `memory_save`, explicit remember requests, and `memory_suggest`.
The default mode is `conservative`.

```json
{
  "memory": {
    "lifecycleCapture": {
      "mode": "conservative"
    }
  }
}
```

- `off` disables automatic lifecycle candidates while leaving explicit memory operations unchanged.
- `conservative` applies all deterministic quality blockers and admits at most 2 automatic candidates per turn, 8 per session, and 20 automatic pending candidates per project.
- `aggressive` is an explicit opt-in that keeps hard bare-checkpoint and rejected-equivalent blockers while admitting at most 5 candidates per turn, 30 per session, and 100 automatic pending candidates per project.

The optional positive integer fields `limits.perTurn`, `limits.perSession`, and `limits.pendingBacklog` override the selected mode's limits.
Corrections and procedures are admitted before generic project facts and checkpoints when a budget applies.
Automatic lifecycle evidence is always stored as pending and never approved by admission.
Bare release and merge events, rejected equivalents, and other deterministic conservative-mode quality blockers are suppressed before persistence.
Context-rich checkpoints remain eligible when they include a durable outcome, decision, invariant, correction, procedure, or next action.
At the project backlog ceiling, automatic capture pauses and returns one advisory directing the user to `memory-lane review`.

## Local learning capture

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

## Semantic search config

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

`semantic.retrieval.topK` is the default recall result bound.
Use `memory-lane recall --top-k <n>` or the programmatic `engine.recall(query, { topK })` option when one call needs a positive temporary override without mutating config.

After configuring, run `memory-lane reindex` to embed approved memories that do not already have a current vector for the active profile, model, and content hash.
Use `memory-lane reindex --force` to recompute embeddings even when current vectors already exist.
Embedding provider calls honor optional per-profile `timeoutMs` and default to 30000 ms.

`memory-lane doctor` is read-only.
When semantic search is enabled, it reports how many approved memories have current embeddings for the active profile/model.
If coverage is low, doctor prints a semantic warning such as “Run `memory-lane reindex`.” Reindexing is an explicit repair step and is not run automatically by doctor or hooks.

`memory-lane doctor` also reports hook debug log diagnostics: `hookDebugEnabledInCurrentEnv`, `hookDebugLogPath`, `hookDebugLogExists`, `hookDebugLogSizeBytes`, `hookDebugLogLastModified`, and `hookDebugWarnings`.
These fields help confirm where `~/.memory-lane/hooks-log.jsonl` is, whether it exists, and its size/mtime.
Doctor only stats the path; it does not create, read, rotate, truncate, or modify hook debug logs.

`memory-lane doctor` / `memory_status` also report the active context policy knobs: `contextPolicyMode`, prompt/session-start item and rendered-character budgets, `contextPolicyIncludePending`, and `contextPolicyFallbackToSearch`.

When `MEMORY_LANE_HOOK_DEBUG=1`, Claude/Codex hook debug records include privacy-safe context decision metadata for injection events: `contextPolicyMode`, `contextEvent`, `contextSelected`, `contextOmitted`, `contextMaxItems`, `contextMaxChars`, and `contextOmittedReasons`.
They never include raw prompts, transcripts, tool output, memory text, or injected context text.

`memory-lane doctor` also reports read-only integration diagnostics.
It checks whether common local config files appear to contain Memory Lane setup for Claude Desktop MCP, Codex hooks, Claude Code hooks, and the pi and OMP extensions.
These checks inspect config/entrypoint files only; they do not read prompts, transcripts, tool outputs, memory text, MCP traffic, or hook debug log contents.
MCP provides explicit tools; hooks, pi, and OMP provide automatic lifecycle recall/save where supported.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MEMORY_LANE_CONFIG` | `~/.memory-lane/config.json` | Config file path; explicit value wins, and MCP resolves home from `HOME` then the operating system |
| `MEMORY_LANE_FILE` | `~/.memory-lane/memory.jsonl` | Memory store path |
| `MEMORY_LANE_EMBEDDINGS_FILE` | `~/.memory-lane/embeddings.jsonl` | Embeddings store path |
| `MEMORY_LANE_TRACES_DIR` | `~/.memory-lane/traces` | Local learning trace and event data root |

Explicit environment paths always win, keep Memory Lane in single-store mode, and never auto-fallback.
When no explicit paths are set, the default engine uses home storage plus the resolved project store when a project scope is known; an existing parent `.memory-lane/` does not make every memory category project-local.
If home storage is not writable, writable commands and hooks may auto-initialize fallback storage at the resolved project root.
Read-only inspection commands do not create fallback storage just to inspect memory state.
