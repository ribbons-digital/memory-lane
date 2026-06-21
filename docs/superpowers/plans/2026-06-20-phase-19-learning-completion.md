# Phase 19 Learning Completion Plan

## Scope

Implement the approved Phase 19 completion design:

- Conservative recovery-backed post-tool learning.
- Procedure-memory text conventions.
- No new CLI command, MCP tool, LLM classifier, prompt-time write, raw transcript capture, or raw tool-output capture.

Design: `docs/superpowers/specs/2026-06-20-phase-19-learning-completion-design.md`

## Tasks

### 1. Add bounded prior tool context type

Files:

- `packages/lifecycle/src/types.ts`

Steps:

1. Add a small exported interface for prior tool outcomes, e.g. `RecentToolUse`.
2. Add optional `recentToolUses?: RecentToolUse[]` to `PostToolUseInput`.
3. Keep this non-breaking and adapter-agnostic.

### 2. Extend tool outcome summarization

Files:

- `packages/lifecycle/src/tool-outcomes.ts`

Steps:

1. Reuse existing shell-tool detection, command extraction, preview bounds, success detection, and secret filtering.
2. Add deterministic procedure keys for known recovery patterns:
   - test recovery: failed npm/generic test → successful `pnpm test`.
   - build recovery: failed npm/generic build → successful `pnpm build`.
   - package-manager recovery: failed `npm install`/`npm i` → successful `pnpm install` or pnpm evidence.
3. Generate compact pending `kind: "procedure"` project candidates from safe templates only.
4. Ensure raw tool output is never included in candidate text.
5. Preserve existing single-command workflow-rule outputs unchanged.

### 3. Add dedupe helpers

Files:

- `packages/lifecycle/src/tool-outcomes.ts`
- `packages/lifecycle/src/handlers.ts`

Steps:

1. Export a procedure-key helper, similar to correction/checkpoint keys.
2. Add duplicate filtering against pending/approved project memories of kind `procedure`, `workflow_rule`, and `correction`.
3. Add same-turn filtering so recovery-backed procedure candidates and generic same-turn workflow-rule candidates do not both capture the same convention; prefer the richer pending procedure when recovery evidence exists, while preserving existing no-history workflow-rule behavior.
4. Integrate filtering in `handlePostToolUse`.

### 4. Add tests

Files:

- `packages/lifecycle/test/handlers.test.ts`
- Add or extend direct unit tests if a suitable `tool-outcomes` test file exists or is needed.

Test cases:

1. No recent tool history preserves existing behavior.
2. Failed `npm test` followed by successful `pnpm test` creates one pending project `procedure` memory.
3. Failed build command followed by successful `pnpm build` creates one pending project `procedure` memory.
4. Failed `npm install` followed by successful `pnpm install` creates one pending project `procedure` memory.
5. Recovery-backed procedure text contains `Procedure:`, `When:`, `Steps:`, `Pitfall:`, and `Verify:`.
6. Procedure text does not include raw stderr/stdout snippets from failed tool output.
7. Secret-like command or response suppresses candidate creation.
8. Existing pending/approved matching procedure/workflow/correction memory suppresses duplicate candidate creation.
9. Existing approved single-command workflow-rule behavior remains unchanged when there is no recovery-backed procedure evidence.
10. Recovery-backed same-turn events emit a pending procedure instead of both a generic workflow rule and a procedure for the same convention.

### 5. Update docs

Files:

- `README.md`
- `CONTEXT.md`
- `ROADMAP.md`
- `HANDOFF.md`

Steps:

1. Document that Phase 19 now supports review-first correction capture and conservative recovery-backed procedure candidates.
2. Mark remaining Phase 19 roadmap items complete or explicitly deferred.
3. Preserve Phase 20 as the next planned phase, but do not start it.

### 6. Verify

Commands:

```bash
pnpm build
pnpm test
git diff --check
```

### 7. Review and PR

1. Request implementation review before PR if changes are non-trivial.
2. Commit on `feature/phase-19-learning-completion`.
3. Push branch and open PR.
4. Stop for user merge under the PR-protected workflow.

## Risks and mitigations

- **Noise from inferred failures**: require a later successful recovery in bounded recent context.
- **Privacy leakage**: never include raw output; reuse secret filtering on commands and previews.
- **Schema churn**: use text conventions rather than new required fields.
- **Harness coupling**: `recentToolUses` is optional plain lifecycle input, not adapter-specific state.
