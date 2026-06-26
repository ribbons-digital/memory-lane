# Phase 21 Slice 8 — Cross-Harness Context Pollution Hardening Design

## Background

After `v0.2.34`, dogfooding showed two context-pollution problems:

1. **Generated pi native bridge** injects raw `memory-lane recall` results for non-continuity prompts. This bypasses the shared lifecycle selector and can inject a full oversized approved memory such as `4df383a1` (~13k chars), despite `memory.contextPolicy.maxChars.prompt` being 3000.
2. **Shared Claude/Codex/pi repo-local lifecycle injection** is bounded, but too eager: trivial greetings such as `hi` still trigger `UserPromptSubmit` recall and inject several thousand characters. In Codex/Claude, this can stack with `SessionStart` baseline context for one simple first prompt.

The fix must reduce low-signal automatic injection while preserving useful recall quality for real prompts such as “how do I run tests”, “pnpm package manager”, or continuity prompts.

## Goals

- Keep Memory Lane automatic context bounded across supported lifecycle integrations.
- Suppress automatic prompt-time memory injection for greetings and very low-signal prompts.
- Keep high-value prompt-time recall working for meaningful project questions.
- Align generated pi native bridge behavior with the repo-local/shared lifecycle behavior.
- Add regression coverage for oversized memory injection and trivial prompts.
- Clean the approved oversized memory `4df383a1` into a compact durable checkpoint using existing revision primitives.

## Non-goals

- No retrieval/ranking rewrite.
- No MCP mutation or new MCP tools.
- No schema expansion.
- No silent deletion of memories.
- No disabling SessionStart baseline context globally. SessionStart + first prompt can still stack bounded context; this slice suppresses trivial prompt-time injection and keeps SessionStart tuning as a separate evidence-backed follow-up if needed.
- No changing explicit `memory_recall`/`memory_get` tool semantics in this slice; explicit recall/get can still return full records because they are user/agent initiated, not automatic lifecycle injection. This includes MCP tools and the generated pi bridge explicit tools. The generated bridge budget helper applies only to automatic `before_agent_start` context injection.

## Design

### 1. Shared lifecycle low-signal prompt gate

Extend `shouldSkipAutomaticInjection(prompt)` in `packages/lifecycle/src/injection.ts` so automatic prompt injection skips:

- greetings: `hi`, `hello`, `hey`, `hiya`, `yo`, `good morning`, `good afternoon`, `good evening`
- short greeting variants with punctuation/case: `Hi!`, `hello there`, `hey there`
- prompts with no meaningful tokens after stop-word removal, preserving the existing generic-prompt behavior

The greeting gate is an explicit allowlist extending the existing generic prompt gate, not a blanket one-token ban. This preserves recall quality for concrete one-token technical queries such as `pnpm`, `docker`, or `wrangler`, and for meaningful prompts such as `how do I run tests` and `pnpm package manager`.

### 2. Generated pi bridge budget enforcement

Modify the generated native pi CLI bridge in `packages/cli/src/installer/config.ts`:

- Add compact helpers mirroring the shared lifecycle safety envelope for automatic `before_agent_start` only:
  - low-signal prompt skip for generated bridge before calling `recall`
  - `fitMemoriesWithinBudget(memories, maxItems, maxChars)` using `contextPolicyPromptMaxItems` and `contextPolicyPromptMaxChars`
  - default `maxItems` to the existing prompt item fallback and default `maxChars` to 3000 when older/mocked `status --json` output omits `contextPolicyPromptMaxChars`
  - simple boundary truncation per memory
- For non-continuity automatic prompt injection, render only fitted memories.
- Return `undefined` if no fitted memory remains.
- Leave explicit bridge tools (`memory_recall`, `memory_get`) full-fidelity and unchanged.

This is intentionally a small bridge-local safeguard, not a full shared-library import, because generated native pi bridge must stay self-contained and execute the installed binary.

### 3. Tests

Add failing tests first:

- `packages/lifecycle/test/injection.test.ts`: greetings and greeting variants skip automatic injection; meaningful technical prompts (`how do I run tests`, `pnpm package manager`, `pnpm`) still do not skip.
- `packages/lifecycle/test/handlers.test.ts`: `handleUserPromptSubmit` returns no `additionalContext` and no continuity guidance for `hi` even when approved memories exist.
- `packages/pi-adapter/test/extension.test.ts`: repo-local pi `before_agent_start` returns no message for `hi`, proving the adapter path inherits shared lifecycle suppression.
- `packages/cli/test/init.test.ts`: generated pi bridge:
  - returns no message for `hi` and does not call `recall`
  - truncates/omits oversized raw recall memory so rendered automatic context stays within prompt max chars
  - uses the 3000-char fallback when `status --json` omits `contextPolicyPromptMaxChars`
  - keeps explicit `memory_recall` full-fidelity
- Codex/Claude hook behavior is covered through shared lifecycle handler tests; installed hook smoke verifies the packaged command output.

### 4. Memory cleanup for `4df383a1`

Use existing review-governed revision primitives, not direct JSONL editing:

```bash
memory-lane replace 4df383a1 --text "<compact checkpoint>" --yes
```

The compact checkpoint should preserve the durable facts:

- Cross-harness review found old pending installer/onboarding preferences and pi-hermes-memory research memories.
- Recommendation was to approve installer/onboarding preferences and the non-breaking/token-aware/future-harness preference, reject/ignore truncated duplicate `7d2a32a9`, and address duplicate session summaries as a debounce/hygiene issue.
- The durable product lesson: Memory Lane should avoid context pollution and support bounded cross-harness continuity.

## Validation

Run:

```bash
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/cli test
pnpm test
pnpm build
git diff --check
```

Manual installed-hook smoke after build:

```bash
printf '{"hook_event_name":"UserPromptSubmit","cwd":"'$PWD'","prompt":"hi"}' | memory-lane codex user-prompt-submit
printf '{"hook_event_name":"UserPromptSubmit","cwd":"'$PWD'","prompt":"hi"}' | memory-lane claude user-prompt-submit
```

Expected for both: `{}` or no `hookSpecificOutput.additionalContext`.

## Risks

- Over-skipping could reduce useful recall quality. Mitigation: do not blanket-skip all one-token prompts; keep technical one-token prompts eligible.
- Generated bridge helper drift from shared lifecycle. Mitigation: add focused generated-bridge tests for the required guarantees.
- `SessionStart` still injects bounded context. This is expected and outside this slice; the issue is prompt-time injection for trivial prompts and uncapped generated pi recall.
