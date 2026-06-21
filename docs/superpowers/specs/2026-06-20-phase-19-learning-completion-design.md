# Phase 19 Learning Completion Design

## Goal

Finish Phase 19 by making Memory Lane's automatic learning more useful without making it noisier or more harness-specific.

This slice completes the remaining Phase 19 roadmap items after workflow correction capture:

1. Conservative post-tool-use failure/tool-quirk learning when a failed action and safe recovery evidence are both available.
2. Structured procedure-memory conventions for `kind: "procedure"` without adding native skill export, new commands, new MCP tools, or schema-breaking fields.

## Non-goals

- No UserPromptSubmit or prompt-time writes.
- No LLM classifier.
- No automatic approvals for new failure/tool-quirk/procedure candidates.
- No raw transcript capture.
- No raw tool-output capture.
- No new CLI commands or MCP tools.
- No native export to Pi/Claude/Codex/Cursor/Hermes rules or skills.
- No broad taxonomy expansion beyond already-added `correction` and `procedure` kinds.
- No persistent schema migration or new required fields on memory records.

## Current behavior

`@memory-lane/lifecycle` already has `summarizeToolOutcome(input)` for `PostToolUse` events. It can learn a few package/test/build conventions from individual shell commands:

- Successful `pnpm test` → approved workflow rule.
- Successful `pnpm build` → approved workflow rule.
- Successful `pnpm install` → approved workflow rule.
- Failed `npm install` with pnpm evidence → pending workflow rule.

This is useful but narrow. It does not learn from two-step failure/recovery patterns like:

- Running `npm test` fails or is unavailable, then `pnpm test` succeeds.
- Running `npm run build` fails or is unavailable, then `pnpm build` succeeds.
- Running the wrong package-manager command fails, then the repo's known package-manager command succeeds.

The lifecycle handler currently sees one `PostToolUse` event at a time, so this slice must remain conservative unless bounded prior tool context is available.

## Proposed model

### 1. Optional bounded tool outcome history

Extend `PostToolUseInput` with an optional `recentToolUses` array of bounded prior tool outcomes.

Adapters may provide this if they already have local context, but existing callers continue to work unchanged.

Each recent entry should contain only:

- `toolName`
- `toolInput`
- `toolResponse`

The lifecycle package will still apply its existing bounds and secret filtering before deriving candidates. It must not persist raw entries.

### 2. Recovery-backed learning only

Failure/tool-quirk candidates should only be created when the current successful tool outcome safely explains a prior failed shell command in the same bounded context.

A candidate is eligible only when all are true:

- Both failed and successful entries are shell-like tools.
- The failed command is not secret-like.
- The failed response preview is not secret-like.
- The successful command is not secret-like.
- The current outcome is successful.
- The failed command and successful command are in the same intent family.
- The successful command is one of Memory Lane's conservative known commands or has strong repository evidence.

Intent families for this slice:

- `test-command`: failed `npm test`, `npm run test`, or generic unavailable test command; recovered by successful `pnpm test`.
- `build-command`: failed `npm run build`, `npm build`, or generic unavailable build command; recovered by successful `pnpm build`.
- `package-manager`: failed `npm install` or `npm i`; recovered by successful `pnpm install` or repo pnpm evidence.

### 3. Candidate kind and status

New recovery-backed candidates should be:

- `category: "project"`
- `scopeType: "project"`
- `kind: "procedure"`
- `status: pending` via `decision: "save-pending"`
- `source: "agent-suggested"`

This keeps automated learning review-first and avoids silently promoting inferred habits into operating agreements.

### 4. Procedure text convention

Because MemoryRecord has no structured metadata field and this slice should not add schema-breaking fields, procedure structure lives in compact text conventions.

Recommended text format:

```text
Procedure: <short title>. When: <trigger/context>. Steps: <bounded action>. Pitfall: <what failed>. Verify: <successful command/evidence>.
```

Examples:

```text
Procedure: Use pnpm for tests in this repo. When: verifying changes. Steps: run `pnpm test`. Pitfall: `npm test` failed or was unavailable. Verify: `pnpm test` succeeded.
```

```text
Procedure: Use pnpm for package installation in this repo. When: installing dependencies. Steps: run `pnpm install`. Pitfall: `npm install` conflicted with the repo package-manager convention. Verify: pnpm evidence was present or `pnpm install` succeeded.
```

Text must be compact, normalized, and derived from a safe template rather than copied from raw tool output.

### 5. Dedupe

Deduplicate against pending and approved project memories with kind `procedure`, `workflow_rule`, or `correction` where the procedure key matches.

Procedure keys should be deterministic, e.g.:

- `procedure:test-command:pnpm-test`
- `procedure:build-command:pnpm-build`
- `procedure:package-manager:pnpm-install`

Same-turn duplicate prevention should avoid emitting both a generic workflow-rule candidate and a richer recovery-backed procedure for the same package/test/build convention. When recovery evidence exists, prefer the pending procedure candidate; when no recovery evidence exists, keep the existing successful-command workflow-rule behavior unchanged.

### 6. Review and continuity surfacing

No new review surfaces are needed. Existing review/continuity list formatting already includes `kind`, and Phase 19 Slice 1 already made `procedure` visible through continuity and operating-agreement discovery.

Procedure memories should remain pending until reviewed.

### 7. Privacy and noise controls

- Never save raw command output.
- Never save raw transcript text.
- Never save exact user correction quotes.
- Reject candidates if command or bounded preview looks secret-like.
- Keep generated text under existing saved-memory limits.
- Prefer no candidate over low-confidence candidate.

## Acceptance criteria

- `PostToolUseInput` accepts optional bounded prior tool outcomes without breaking existing callers.
- Successful recovery after a relevant failed prior command creates a pending project `procedure` memory.
- Single-command package/test/build workflow-rule behavior remains unchanged.
- Procedure text follows the compact `Procedure/When/Steps/Pitfall/Verify` convention.
- Recovery-backed candidates do not include raw tool output.
- Recovery-backed candidates are deduplicated against existing project procedure/workflow/correction memories.
- Tests cover positive and negative cases for test, build, package-manager recovery, secret filtering, no-history behavior, and dedupe.
- `pnpm build`, `pnpm test`, and `git diff --check` pass.
