# Codex Hook Adapter for Natural Memory Lane

## Summary

Memory Lane will support Codex hooks through a harness-neutral lifecycle layer and a Codex-specific adapter. The user-facing command surface will be `memory-lane codex ...`, while shared autosave, recall, context-budget, and provenance policy live outside the Codex adapter so future harnesses can reuse the same behavior.

Phase 1 implements the three hooks that create the strongest natural-memory loop without creating a standing context tax:

- `UserPromptSubmit` → recall approved, relevant memories and inject a small context block.
- `Stop` → extract durable memory candidates after the turn and save or queue them.
- `PostToolUse` → capture useful shell-like tool outcomes as concise memories.

Phase 1 does not add session scope, checkpoint creation, `SessionStart`, `PreCompact`, `PreToolUse`, Codex hook auto-installation, dry-run mode, Codex doctor commands, LLM-based extraction, or pi adapter migration.

## Goals

- Make Memory Lane feel automatic inside Codex by using Codex hooks as lifecycle triggers.
- Keep `@memory-lane/core` harness-neutral.
- Share memory lifecycle policy across future harness adapters.
- Autosave high-confidence durable memories while keeping inferred or ambiguous memories reviewable.
- Prevent automatic memory injection from bloating Codex context.
- Preserve enough harness-neutral provenance to debug autosaved memories.

## Non-Goals

- No true `session` scope in Phase 1.
- No checkpoint creation in Phase 1.
- No LLM classifier implementation in Phase 1.
- No hook installer that edits Codex config automatically.
- No blocking or continuation behavior from `Stop` hooks.
- No raw transcript, prompt, hook payload, or tool output storage.
- No migration of the existing pi adapter onto the lifecycle layer in Phase 1.

## Package Architecture

Add two workspace packages:

```text
packages/
  core/             # existing storage/search/recall/save engine
  cli/              # existing user-facing CLI
  lifecycle/        # shared harness-neutral memory automation logic
  codex-adapter/    # Codex hook stdin/stdout adapter
  pi-adapter/       # existing adapter; migration deferred
```

Data flow:

```text
Codex hook JSON on stdin
→ @memory-lane/codex-adapter
→ @memory-lane/lifecycle
→ @memory-lane/core
→ JSONL memory store and optional embedding sidecar
```

`@memory-lane/core` remains responsible for storage, project scope, save/suggest/recall, semantic retrieval, dedupe, compaction, and secret detection.

`@memory-lane/lifecycle` owns shared automation policy: context selection, injection budgets, memory block rendering, candidate extraction, candidate decisions, and shell outcome summarization.

`@memory-lane/codex-adapter` owns Codex-specific hook parsing, bounded transcript tail parsing, event normalization, and Codex-compatible JSON output rendering.

`@memory-lane/cli` owns engine creation and exposes the user-facing commands:

```bash
memory-lane codex user-prompt-submit
memory-lane codex stop
memory-lane codex post-tool-use
```

The CLI passes a `MemoryEngine` into the Codex adapter. Hook payload `cwd` wins for scope resolution; `--project` remains useful for tests or manual invocation when no payload `cwd` is available.

## Memory Provenance

Phase 1 adds optional inline provenance to `MemoryRecord` and `SaveInput`:

```ts
type MemoryLifecycleEvent =
  | "user_prompt"
  | "turn_stop"
  | "post_tool_use"
  | "session_start"
  | "pre_compact"

interface MemoryProvenance {
  adapter: string
  lifecycleEvent: MemoryLifecycleEvent
  sessionId?: string
  turnId?: string
  toolName?: string
}
```

Rules:

- `adapter` is a non-empty free-form string. Codex uses `"codex"`.
- `lifecycleEvent` is a strict harness-neutral enum.
- `sessionId` and `turnId` are optional opaque correlation IDs.
- `toolName` is the only tool-related provenance field.
- Do not store transcript paths, raw prompts, raw assistant messages, raw hook payloads, raw tool input, or raw tool output.
- Provenance is optional; old records remain valid and require no migration.
- Validation accepts missing provenance and rejects malformed provenance when present.
- Status changes preserve provenance.
- Duplicate detection ignores provenance.
- Pending duplicate upgrades preserve existing provenance unless the existing record has none.
- Human-readable `list` and `review` output does not show provenance by default; JSON output includes it as part of the record.

`source` and provenance remain separate. `source` says whether the memory was manual, user-suggested, or agent-suggested. Provenance says which adapter lifecycle produced it.

## Hook Behavior

### `UserPromptSubmit`

Purpose: recall approved memories relevant to the current prompt and inject a small context block before Codex answers.

Flow:

```text
Codex UserPromptSubmit payload
→ normalize prompt + cwd
→ skip generic/no-content prompts
→ MemoryEngine.recall(prompt)
→ lifecycle applies automatic-injection relevance gate
→ lifecycle enforces budget
→ Codex adapter emits additionalContext only when useful
```

Output with relevant memory:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "## Relevant Memory\n\n- This repo uses pnpm, not npm."
  }
}
```

No relevant memory returns a valid no-op output such as `{}`.

`UserPromptSubmit` is recall-only. It does not save explicit “remember this” requests; saving happens in `Stop` after the assistant has handled the turn.

### `Stop`

Purpose: extract durable memory candidates after a turn.

Flow:

```text
Codex Stop payload
→ use structured fields where available
→ bounded best-effort transcript tail parse for latest user/assistant turn
→ lifecycle extracts candidates with deterministic heuristics
→ approved/pending/discard decision
→ save or suggest through MemoryEngine
→ return no-op output by default
```

`Stop` never blocks or continues the Codex conversation in Phase 1. It never injects context. Debug mode may emit a concise `systemMessage`, but never raw transcript or prompt text.

### `PostToolUse`

Purpose: capture useful shell-like tool outcomes as concise memories.

Flow:

```text
Codex PostToolUse payload
→ ignore non-shell-like tools in Phase 1
→ inspect bounded tool response preview
→ summarize only durable workflow/gotcha candidates
→ save approved objective workflow facts or queue pending ambiguous failures
→ return no-op output by default
```

Phase 1 uses an extensible summarizer registry but only ships a shell-like summarizer.

Save examples:

- Approved: `` `pnpm test` is the test command for this repo. ``
- Approved: `` `pnpm build` completed successfully in this repo. ``
- Pending: a non-obvious unresolved failure that may be useful but is not proven durable.

Ignore examples:

- `ls`, `pwd`, `rg`, `find`, `cat` successes.
- Ordinary successful commands with no durable insight.
- Raw logs.
- Repeated noise.
- Temporary paths.
- Secrets.

Phase 1 does not correlate a failure with a later success to infer a causal fix.

## Context Budget and Injection Policy

Core principle:

> Store more than you inject.

Only `UserPromptSubmit` injects memory. `Stop` and `PostToolUse` write externally only.

Default internal limits:

```ts
const CODEX_MEMORY_INJECTION_LIMITS = {
  maxItems: 6,
  targetChars: 1800,
  hardMaxChars: 3000,
  absoluteMaxChars: 6000,
}
```

Phase 1 keeps these as internal lifecycle defaults with test/adapter overrides. Persisted config knobs are deferred until there is usage data.

Automatic injection applies an extra lifecycle-level relevance gate because `MemoryEngine.recall()` is also used for manual recall and may return fallback memories:

- Never inject for an empty prompt.
- Never inject for generic acknowledgements such as `ok`, `okay`, `yes`, `yep`, `yeah`, `sure`, `sounds good`, `go ahead`, `continue`, `proceed`, `approved`, `looks good`, `thanks`, or `thank you`.
- Never inject if the prompt has no meaningful tokens after stop-word removal.
- Re-score returned memories with `lexicalScore(prompt, memory.text)`.
- If semantic retrieval was not used, require lexical overlap above zero.
- If semantic retrieval reports fallback due to no semantic matches, require lexical overlap above zero.
- Skip likely secrets before rendering.
- Deduplicate rendered memories by normalized text.
- Drop overlong memories where possible; for a single long relevant memory, truncate deterministically at a sentence boundary if possible and add an ellipsis.
- Render plain bullet text only: no memory IDs, provenance, source labels, or category labels.

Rendered block:

```md
## Relevant Memory

- This repo uses pnpm, not npm.
- User prefers concise implementation plans.
```

## Candidate Decision Policy

Phase 1 extraction is heuristics-only. It defines interfaces that can accept a future classifier, but does not implement LLM classification.

Candidate decisions:

```ts
type CandidateDecision = "save-approved" | "save-pending" | "discard"
```

Rules:

- Explicit user “remember this” request → approved.
- High-confidence objective project/workflow fact → approved.
- Medium-confidence inferred project fact → pending.
- Explicit user preference → approved.
- Inferred user preference → pending unless extremely obvious or repeated.
- Personal fact → approved only when explicit; otherwise discard or pending very conservatively.
- Tool outcome → approved only for stable objective workflow facts; unresolved failures/gotchas are pending or discarded.
- Low-confidence, generic, temporary, duplicate, or sensitive candidates → discard.
- Secrets → always discard.

Autosaved hook memories use existing `source` values:

- explicit user request detected from prompt/transcript → `source: "user-suggested"`, `status: "approved"`
- inferred durable memory from `Stop` → `source: "agent-suggested"`, status by confidence
- useful tool outcome from `PostToolUse` → `source: "agent-suggested"`, status by confidence
- direct `memory-lane save` remains `source: "manual"`

Scoping:

- explicit user preferences and personal facts → global scope
- project conventions, project decisions, and tool outcomes → project scope
- `PostToolUse` is project-scoped in Phase 1
- if project scope is unavailable, use existing core fallback behavior

## Transcript and Tool Payload Handling

Codex transcript parsing lives in `@memory-lane/codex-adapter`, not lifecycle. Lifecycle receives normalized `lastUserMessage` and `lastAssistantMessage`.

Transcript rules:

- Use structured hook fields first.
- Read `transcript_path` only as a bounded best-effort fallback.
- Read only a tail of the file, e.g. last 100–200 KB.
- Extract only the latest user/assistant turn.
- Treat transcript format as unstable and parse defensively.
- If parsing fails, continue with available structured fields.
- Never store or inject raw transcript content.

Tool rules:

- Inspect bounded previews only, e.g. `maxToolResponseChars: 12000`.
- Saved candidate text should be concise, e.g. `maxSavedMemoryChars: 500`.
- Never save raw full tool output.
- Run secret detection before saving and before injection.

Lifecycle may perform minimal read-only project inspection through explicit helpers, such as checking lockfile existence in `cwd`. It must not recursively scan, read file contents, or write files.

## Error Handling and Debug Mode

Memory hooks should not make Codex feel broken.

Inside Codex hook commands, expected/runtime failures return exit-zero no-op JSON where possible:

- malformed hook payload
- event mismatch
- recall error
- transcript parse failure
- candidate extraction failure
- individual save failure

CLI misuse can still be nonzero before hook execution, such as an unknown `memory-lane codex <event>` command.

Default hook output is silent. Debug mode is enabled with:

```bash
MEMORY_LANE_HOOK_DEBUG=1
```

Debug diagnostics may emit concise `systemMessage` text, for example:

- `Memory Lane: injected 3 memories.`
- `Memory Lane: saved 1 memory, queued 1 pending, discarded 2.`

Diagnostics must not include raw prompts, transcripts, tool inputs, or tool outputs.

Mismatched commands and payloads are tolerant no-ops. For example, if `memory-lane codex user-prompt-submit` receives a `Stop` payload, the adapter returns no-op output and only reports the mismatch in debug mode.

## Codex Hook Configuration

Phase 1 documents hook setup but does not edit Codex config automatically.

Use project-level `.codex/hooks.json` first for development/testing, then user-level `~/.codex/hooks.json` once trusted.

Examples should use current Codex-style `timeoutSec`, not `timeout`:

```json
{
  "hooks": {
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

Docs must explain that hook matcher names can vary by Codex version and users may need to adjust the matcher for their shell tool name.

## Privacy and Security

Docs must state explicitly:

- Hooks inspect prompts, bounded transcript tails, and bounded tool-output previews locally.
- Raw transcripts, prompts, hook payloads, tool inputs, and full tool outputs are not saved.
- Secret detection runs before save and before injection.
- Only concise candidate memories are stored.
- `Stop` and `PostToolUse` do not inject context.
- Pending memories can be reviewed with `memory-lane review`.

## Phases

### Phase 1 — Codex natural memory MVP

- Add `@memory-lane/lifecycle`.
- Add `@memory-lane/codex-adapter`.
- Add optional inline `provenance` to `MemoryRecord` and `SaveInput`.
- Add `memory-lane codex user-prompt-submit`.
- Add `memory-lane codex stop`.
- Add `memory-lane codex post-tool-use`.
- Add bounded Codex transcript tail parsing.
- Add context-budgeted automatic injection.
- Add heuristics-only candidate extraction and shell outcome summarization.
- Update README architecture table.
- Update `examples/harness-integrations/codex-cli.md`.
- Include Codex fixture payloads and tests.
- Run build and include generated `dist/` artifacts for new packages, matching existing repo style.

### Phase 2 — SessionStart baseline injection

Add `SessionStart` support with strict budgeted baseline injection. This should stay smaller than prompt-specific recall and should not dump project history.

### Phase 3 — PreCompact context checkpointing

Add `PreCompact` support for context checkpointing. First try existing `project_checkpoint` kind. Introduce true `session` scope only if a concrete retrieval and deletion lifecycle proves necessary.

Later note: the 2026-07-03 pre-compact session-summary slice is separate from this checkpointing idea. It saves pending `session_summary` memories with `pre_compact` provenance and does not implement `project_checkpoint` context checkpointing.

### Phase 4 — Classifier and richer recall scoring

Add optional LLM classifier support and richer scored recall output if heuristic autosave or automatic injection needs better precision. Remote or hosted model use must remain opt-in.

## Testing

Use existing repo style: ESM packages, `build: tsc`, and tests with `node --test --import tsx`.

`@memory-lane/lifecycle` tests:

- selects at most six memories
- enforces hard and absolute character budgets
- injects nothing for empty/generic prompts
- injects nothing when lexical fallback has no overlap
- skips likely secrets before rendering
- deduplicates normalized rendered memories
- renders plain bullet text without IDs or labels
- explicit remember request becomes approved
- inferred preference becomes pending
- low-confidence candidate is discarded
- ordinary shell command success is ignored
- useful package-manager/test/build outcomes are summarized

Core tests:

- `provenance` is optional and old records remain valid
- malformed provenance is rejected when present
- provenance is copied from `SaveInput`
- provenance survives approve/reject/delete
- pending duplicate upgrades preserve existing provenance unless absent
- duplicate detection ignores provenance

`@memory-lane/codex-adapter` tests:

- parses `UserPromptSubmit` fixture
- emits Codex `hookSpecificOutput.additionalContext` with correct `hookEventName`
- emits no-op output when no memories match
- parses `Stop` fixture and bounded transcript tail fixture
- parses shell success and failure `PostToolUse` fixtures
- tolerates malformed JSON without crashing
- treats event mismatch as no-op
- emits debug `systemMessage` only when `MEMORY_LANE_HOOK_DEBUG=1`

CLI tests:

- `memory-lane codex user-prompt-submit`
- `memory-lane codex stop`
- `memory-lane codex post-tool-use`
- unknown Codex event returns usage/error before hook execution

End-to-end fixture tests:

- seed a temp memory store
- feed sample Codex hook payload on stdin
- assert bounded additional context output
- assert saved memories include harness-neutral provenance

## Verification

Before completion, run:

```bash
pnpm build
pnpm test
```

Avoid new dependencies. If a package install becomes necessary, use:

```bash
sfw pnpm install <package>
```
