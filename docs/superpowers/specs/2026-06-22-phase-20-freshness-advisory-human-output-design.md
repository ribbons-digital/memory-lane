# Phase 20 Slice 6 — Freshness Advisory Human-Output Polish Design

## Status

Approved after Opus 4.8 review on 2026-06-21. Implementation completed locally on `feature/phase-20-human-output-polish`.

## Context

Phase 20 Slices 1–5 established the freshness foundation:

1. Optional `freshness` metadata on memory records.
2. Debounced pending continuity candidates.
3. Temporal `freshness.capturedAt` for generated session summaries when trustworthy source timestamps exist.
4. Read-only freshness advisories that classify approved visible memories as `current`, `stale`, `expired`, or `none`.
5. Text-free dry-run revision suggestions for stale/expired freshness advisories through existing JSON/read-model surfaces.

The current JSON/MCP/read-model contract is authoritative and already includes the important data. Human CLI output still underuses it:

- `memory-lane status --since ...` uses `formatFreshnessSummary()` only when `--since` is present.
- `memory-lane doctor --since ...` uses `formatDoctor()`, which maps the `freshness` field through `formatFreshnessSummary()`.
- `memory-lane continuity` renders warnings and a flattened suggested-action list, but does not label freshness actions as manual dry-run revision options.
- `memory-lane dashboard` already receives freshness actions through continuity hints, but also renders them as generic suggested actions. Dashboard polish is optional in this slice.

Before considering a dedicated `memory-lane refresh` workflow or Phase 21 handoff-free behavior, Memory Lane should make the existing read-only advisory signals easier to notice and dogfood in human CLI output.

## Problem

Users can now obtain stale/expired counts and dry-run revision suggestions from JSON, but human output does not clearly answer:

- Are there stale or expired approved memories I should inspect?
- Which existing dry-run commands should I consider first?
- Are these commands advisory/manual, or is Memory Lane recommending or performing mutation?

Without a focused human-output polish pass, the read-only freshness advisory work is harder to validate in daily use. That makes it premature to add broader refresh, recall/injection filtering, or handoff-free automation.

## Goals

1. Make stale/expired freshness advisories visible in human CLI output without requiring `--json`.
2. Render existing dry-run revision suggestions clearly as manual, advisory actions.
3. Keep all freshness advisory human output text-free with respect to memory bodies/previews.
4. Preserve the existing JSON/read-model contract shape.
5. Keep this slice read-only and presentation-only.

## Non-goals

- No `memory-lane refresh` command.
- No new CLI command, MCP tool, config flag, lifecycle event, or adapter payload.
- No mutation, apply, approval, rejection, deletion, cleanup, consolidation, update, replace, or supersede execution.
- No `reject` or `delete` suggestions in freshness advisory output.
- No recall, semantic ranking, context selection, or lifecycle injection behavior changes.
- No LLM stale classifier or additional freshness classification.
- No memory text, preview, or snippet in freshness advisory human output.
- No JSON contract shape change; JSON remains authoritative and backward-compatible.
- No broad dashboard redesign or interactive UI.
- No `CONTEXT.md` glossary change expected; the existing `Freshness advisory` entry already covers bounded dry-run revision suggestions and destructive-action guardrails.

## Data model facts this spec relies on

`FreshnessStatus` contains:

- `freshness.advisory.expiredCount`, `staleCount`, and `currentCount` aggregate counts.
- `freshness.advisory.expired[]` and `freshness.advisory.stale[]` bounded metadata arrays.
- Per-memory actions at `memory.freshness?.suggestedActions`, where each metadata item is a `FreshnessMemoryMetadata` entry.

There is no top-level `freshness.suggestedActions` field.

The `expired[]` and `stale[]` arrays are already capped by core freshness metadata limits. Therefore, human formatter omitted counts must be derived from aggregate counts, not from hidden full arrays:

```text
omittedRecords = expiredCount + staleCount - numberOfDistinctAdvisoryRecordsRepresentedInRenderedActions
```

If the formatter cannot safely compute represented records from actions, it should use the count of rendered distinct metadata entries before flattening their actions.

## Existing surfaces to use

### Human `status --since`

`handleStatus()` builds a doctor report and, for human output, calls `formatFreshnessSummary(r.freshness)` only when `--since` is provided. Slice 6 should preserve that command behavior and enhance the freshness summary path.

### Human `doctor --since`

`formatDoctor()` maps the report's `freshness` field through `formatFreshnessSummary()`. Slice 6 should make the same freshness advisory block available through doctor output.

### Human `continuity`

`formatContinuityReadModel()` has access to the full read model, including `model.freshness.advisory` and `model.warnings`. It should source freshness advisory action lines from `model.freshness.advisory.expired[]` and `model.freshness.advisory.stale[]`, not by substring-matching `--dry-run` in the flattened `model.suggestedActions` array.

### Dashboard

Dashboard already receives freshness advisory actions through `continuityHints.suggestedActions` and renders them generically. This slice may label them if the shared helper makes that trivial, but dashboard changes are optional and must not expand the slice.

## Proposed behavior

### 1. Keep the compact freshness summary

Keep the existing count summary, including the advisory counts:

```text
Freshness: 0 newer approved memories (visible approved: 12; project: 0; global: 0; global preferences: 0; advisory: 1 expired, 2 stale, 4 current with freshness)
```

If `expiredCount + staleCount === 0`, no advisory action block is rendered.

### 2. Add bounded freshness advisory action lines for human `status --since` and `doctor --since`

When `expiredCount + staleCount > 0`, render a small block immediately after the freshness summary:

```text
Freshness advisory actions (manual dry-run):
  › memory-lane update stale1 --text <updated-memory-text> --dry-run
  › memory-lane update expired1 --text <updated-memory-text> --dry-run
  › memory-lane replace expired1 --text <new-memory-text> --dry-run
  › memory-lane supersede <new-id> expired1 --dry-run
  … 2 more stale/expired advisory records omitted; use memory-lane status --json for full ids.
```

Rules:

- Source actions only from:
  - `freshness.advisory.expired[].freshness?.suggestedActions`
  - `freshness.advisory.stale[].freshness?.suggestedActions`
- Preserve group order from the core metadata arrays: expired group first, then stale group, matching Slice 5 continuity hint order. Do not imply a global timestamp sort across both groups.
- Deduplicate actions while preserving order.
- Bound human output to at most 6 command lines by default.
- Keep all actions for a represented metadata record together; do not split an expired record's update/replace/supersede suggestions across the command-line cap.
- Track how many distinct stale/expired metadata records are represented before flattening actions.
- Compute omitted record count from aggregate counts minus represented records.
- If omitted count is positive, show one text-free omitted note pointing to `memory-lane status --json` for the full metadata.
- Do not include memory text, previews, snippets, or current memory body.
- Do not invent actions not already present in freshness metadata.

### 3. Make formatter contract explicit

`formatFreshnessSummary()` currently returns `string | undefined`. To support multi-line output without ambiguity, implementation should choose one of these small approaches:

Preferred:

```ts
function formatFreshnessSummaryLines(value: unknown): string[]
```

Then keep `formatFreshnessSummary(value)` as a compatibility wrapper that joins lines with `\n`, or update call sites to use the line helper.

Acceptable alternative:

```ts
function formatFreshnessAdvisoryActionLines(value: unknown, options?: { maxActions?: number }): string[]
```

Then `handleStatus()` and `formatDoctor()` append those lines after the existing summary.

The implementation must make both `status --since` and `doctor --since` render the same freshness advisory action block.

### 4. Label freshness advisory actions in human `continuity`

Human `continuity` should not infer freshness actions by matching `--dry-run` strings. Instead, it should derive a freshness advisory action block from `model.freshness.advisory.expired[]` and `model.freshness.advisory.stale[]` using the same helper as status/doctor where practical.

Preferred output shape:

```text
Warnings
  ⚠ freshness-advisory: approved memories have expired or stale freshness metadata; inspect before relying on time-sensitive guidance.

Freshness advisory actions (manual dry-run):
  › memory-lane update stale1 --text <updated-memory-text> --dry-run

Suggested actions
  › memory-lane review --json
  › memory-lane continuity --json
  › memory-lane status --json
```

Rules:

- Keep existing warning rendering.
- Keep existing generic `Suggested actions` rendering.
- Either remove duplicate freshness commands from the generic suggested-actions list when a freshness-specific block is rendered, or keep them only if tests prove the output remains clear and compact. Preferred behavior is to avoid duplicate command lines.
- Do not label unrelated `--dry-run` suggested actions as freshness actions.
- Do not include memory text/previews.

### 5. Dashboard is optional

If implementation extracts a helper and dashboard can reuse it with minimal changes, dashboard may receive the same label. Otherwise leave dashboard as-is and document that Slice 6 required surfaces are `status`, `doctor`, and `continuity`.

## Privacy and safety requirements

- Human freshness advisory output must not include `memory.text` or previews.
- Human freshness advisory output may include ids, classifications/counts, omitted counts, and dry-run command strings only.
- Commands must be labeled as manual/dry-run/advisory, not as automatic recommendations.
- The output must not mention `reject` or `delete` as freshness actions.
- Stale/expired memories remain approved and visible.
- Recall/injection behavior remains unchanged.

## Tests

Add or update CLI tests for:

1. `status --since <timestamp>` human output with stale/expired freshness metadata:
   - shows compact freshness summary;
   - shows a `Freshness advisory actions (manual dry-run)`-style label;
   - includes valid dry-run `update`, `replace`, and/or `supersede` command strings from per-memory metadata;
   - does not include memory text or pending memory text;
   - does not include `memory-lane reject` or `memory-lane delete` as freshness actions.
2. `doctor --since <timestamp>` human output uses the same freshness advisory action rendering.
3. `continuity` human output with a stale/expired approved memory:
   - keeps existing continuity warnings;
   - includes freshness dry-run action(s) in a dedicated advisory/manual block;
   - does not leak the stale/expired memory body;
   - does not duplicate freshness command lines in the generic suggested-actions section if de-duplication is implemented.
4. Bounding behavior:
   - with more stale/expired records than the human cap can represent, output is bounded;
   - omitted note uses aggregate counts minus represented records;
   - output points to `memory-lane status --json` for full ids;
   - JSON output remains full/unchanged within the existing core metadata caps.
5. Non-freshness dry-run guard:
   - if a future/read-model suggested action contains `--dry-run` but does not come from `model.freshness.advisory`, continuity formatting must not label it as a freshness advisory action.
6. JSON regression:
   - `status --json`, `doctor --json`, and `continuity --json` shapes are unchanged by this human-output slice.

Existing full verification remains:

```bash
pnpm --filter @memory-lane/cli test
pnpm build
pnpm test
git diff --check
```

## Documentation updates

Update:

- `README.md` freshness status / continuity hints sections:
  - human `status --since`, `doctor --since`, and `continuity` now show compact manual dry-run advisory actions;
  - JSON remains authoritative for full metadata;
  - no refresh/apply behavior exists.
- `ROADMAP.md` Phase 20 status/todo list to mark Slice 6 as the final read-only dogfooding/polish slice before deciding whether to leave Phase 20.
- `HANDOFF.md` with branch/status/verification summary after implementation.

No `CONTEXT.md` update is expected unless implementation reveals a terminology gap.

## Acceptance criteria

- Human `status --since` and `doctor --since` make non-zero stale/expired advisories visible and actionable without `--json`.
- Human `continuity` shows freshness dry-run actions in a clearly manual/advisory way.
- Freshness advisory human output is bounded and text-free.
- Omitted notes are computed from aggregate counts, not from unavailable hidden arrays.
- JSON contracts remain stable.
- No new command/tool/config/mutation/recall/injection behavior is introduced.
- Tests cover human output, text non-leakage, destructive-action absence, non-freshness dry-run mislabel prevention, and bounding.

## Resolved design questions

1. Should human `status`/`doctor` render only commands, or also per-id classification labels like `[expired] abc123`?
   - Decision: render only commands plus aggregate counts in this slice. Per-id classification tables risk becoming a new inspection UI and can be deferred.
2. Should dashboard receive the same polish?
   - Decision: optional only if helper reuse makes it trivial. Required surfaces are `status`, `doctor`, and `continuity`.
3. Should human output include all actions per expired memory?
   - Decision: yes, but bounded globally. Expired entries deliberately expose multiple possible revision paths; users choose manually.
4. Should omitted notes count omitted actions or omitted records?
   - Decision: omitted records, derived from aggregate counts minus represented metadata records.
