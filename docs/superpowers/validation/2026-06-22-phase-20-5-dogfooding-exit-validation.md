# Phase 20.5 Dogfooding and Exit Validation

## Environment

- Memory Lane commit under test: `f0fc7bc6115a6b55dc870ce50ac29952e34076cc`
- Product baseline under validation: `v0.2.20` plus approved Phase 20.5 spec/plan docs on `docs/phase-20-5-validation-spec`
- CLI metadata version reported by JSON responses: `0.1.0`
- Validation date: `2026-06-22`
- Project path/scope: worktree path `/Users/shiang/.config/superpowers/worktrees/memory-lane/phase-20-5-validation-spec`, resolved project scope `/Users/shiang/projects/ribbons-digital/memory-lane`
- Summarization provider configured: not exercised; validation used inspection-only surfaces and did not generate a new summary
- Harnesses/surfaces tested:
  - CLI: yes
  - Claude Code hooks: not exercised; user-level Claude Code hook diagnostics reported not configured in this checkout, and no live Claude Code lifecycle event was available in this validation session
  - Codex hooks: not exercised; user-level Codex hook diagnostics reported configured, but no live Codex lifecycle event was available in this validation session
  - pi: not exercised; pi extension diagnostics reported detected, but no live pi UI/session context was available in this validation session
  - MCP: not exercised through a live MCP client; Claude Desktop MCP diagnostics reported configured, but this validation session had no live MCP client invocation channel
- `--since` timestamp used: `2026-06-22T00:53:10.000Z`
- Timestamp rationale: this is the `v0.2.20` release publish time, a real completed-release continuity boundary before Phase 20.5 validation. The first attempt without milliseconds was rejected by CLI validation, so the timestamp was normalized to the accepted ISO shape with `.000Z`.

## Commands and Surfaces Exercised

| Surface | Command/tool | Result | Notes |
| --- | --- | --- | --- |
| Git | `git status --short` | passed | Clean before validation note creation. |
| Git | `git rev-parse HEAD` | passed | Returned `f0fc7bc6115a6b55dc870ce50ac29952e34076cc`. |
| Git | `git log --oneline -5` | passed | Confirmed branch contains approved spec and plan commits on top of PR #31 merge. |
| CLI status | `memory-lane status --json` | passed | Returned valid JSON: 117 total memories, 77 approved, 20 pending, 12 deleted, semantic enabled, project scope resolved to main Memory Lane repo. |
| CLI dashboard | `memory-lane dashboard` | passed | Human output was bounded: 1,742 bytes. |
| CLI dashboard | `memory-lane dashboard --json` | passed | Returned structured counts/review/recent/continuity-hint metadata. |
| CLI review | `memory-lane review` | passed | Human output was bounded but substantial: 11,603 bytes for 20 pending records grouped by project/source/kind/provenance. |
| CLI review | `memory-lane review --json` | passed | Returned 20 pending records and 3 groups. Validation note records metadata only. |
| CLI review filter | `memory-lane review --kind session_summary --json` | passed | Returned 1 pending session summary id: `9a926726`. |
| CLI review filter | `memory-lane review --kind project_checkpoint --json` | passed | Returned 3 pending project checkpoint ids: `43fa3726`, `0903ee39`, `e3ac09a2`. |
| CLI review filter | `memory-lane review --kind correction --json` | passed | Returned clean empty state. |
| CLI review filter | `memory-lane review --kind procedure --json` | passed | Returned clean empty state. |
| CLI continuity | `memory-lane continuity` | passed | Human output was bounded: 3,114 bytes. |
| CLI continuity | `memory-lane continuity --json` | passed | Returned continuity status, pending continuity, freshness, operating agreement warnings, and suggested inspection actions. |
| CLI freshness/status | `memory-lane status --since 2026-06-22T00:53:10Z` | failed as expected | Strict ISO validation rejected missing milliseconds. Re-run used `.000Z`. |
| CLI freshness/status | `memory-lane status --since 2026-06-22T00:53:10.000Z` | passed | Human output was text-free and bounded: 397 bytes. |
| CLI freshness/status | `memory-lane status --json --since 2026-06-22T00:53:10.000Z` | passed | Returned freshness and context-policy metadata. |
| CLI doctor | `memory-lane doctor --since 2026-06-22T00:53:10.000Z` | passed | Human output was bounded and diagnostic: 4,577 bytes. |
| CLI doctor | `memory-lane doctor --json --since 2026-06-22T00:53:10.000Z` | passed | Returned the same status/doctor diagnostic shape for the fields relevant to this validation. |
| CLI scoped inspection | `memory-lane status --json --project <worktree>` | passed | Worktree correctly resolved to main Memory Lane project scope. |
| CLI scoped inspection | `memory-lane review --json --project <worktree>` | passed | Returned same 20 pending records, grouped by project; this confirms review is global/grouped rather than a narrow current-project-only queue. |
| CLI scoped inspection | `memory-lane list --json --project <worktree>` | passed | Returned 81 visible records; used only for counts/kind/source metadata, not memory bodies. |
| MCP | `memory_status`, `memory_review`, `memory_continuity` | not tested | No live MCP client invocation channel was available in this validation session. CLI diagnostics showed Claude Desktop MCP configured. |
| Lifecycle | Claude/Codex/pi lifecycle events | not tested | No live harness lifecycle event was available; synthetic hook payloads were not used because they would create fabricated evidence and could mutate pending candidates. |

## Review Queue Health

### Counts

| Dimension | Count summary |
| --- | --- |
| Status | `memory-lane status --json`: 117 total, 77 approved, 20 pending, 12 deleted. |
| Kind | Pending review: 16 `project_fact`, 3 `project_checkpoint`, 1 `session_summary`, 0 `correction`, 0 `procedure`. |
| Source | Pending review: 19 `user-suggested`, 1 `session-summary`. |
| Provenance | Pending review: 19 with no provenance, 1 `claude/session_end`. |
| Project grouping | Pending review groups: 16 Memory Lane project records, 4 Sitewright project records. |

### Findings

- Duplicates or near-duplicates: No exact duplicate ids were observed in metadata. The Memory Lane pending queue contains several older release/merge/checkpoint-like items, but they are grouped and identifiable rather than silently merged. Some likely represent review backlog rather than newly generated product noise.
- False positives: No clear false-positive correction/procedure candidates were present because both filtered queues were empty. Project checkpoint/session-summary records looked like plausible continuity candidates from metadata, but full approval quality still requires human review of bodies outside this validation note.
- False negatives: No obvious missing generated candidate was detectable from current metadata-only surfaces. Freshness advisories were absent because no visible approved memories currently carry explicit freshness metadata.
- Candidate understandability: Review grouping by project/source/kind/provenance is useful. The unfiltered human review output is readable but substantial at 11.6 KB for 20 pending records; for repeated work, targeted filters or dashboard/continuity are easier starting points.
- Validation-generated candidates: None. This validation did not exercise lifecycle hooks or session-summary generation, and did not approve/reject/delete memories.
- Scope observation: `memory-lane review --json --project <worktree>` still returned all pending groups rather than narrowing to only current-project pending records. Group labels made the cross-project state understandable, so this did not block validation, but it is worth remembering for users who expect `--project` to narrow review output.

## Continuity Usefulness

- Last-work/current-status quality: `memory-lane continuity --json` reported 53 visible approved memories, 16 pending review items for the current project status count, latest approved project/global metadata, and pending continuity candidates. This is enough to answer high-level state/resumption questions before topic-specific recall.
- Next-step quality: Suggested actions were inspection-first and concrete: `memory-lane review --json`, `memory-lane continuity --json`, `memory-lane list --json`, `memory-lane agreements --json`, `memory-lane status --json`, plus targeted `agreements --area` commands. No mutation command was suggested as the default next step.
- Pending continuity visibility: Pending continuity was visible but bounded. JSON status reported `pendingContinuityCount: 7`; the rendered pending continuity list was bounded to 5 records, which is appropriate for avoiding dumps while still surfacing the review backlog.
- Warnings: Continuity produced two useful review-severity warnings: scope hygiene candidates and overlapping operating agreement candidates. These warnings point to inspection surfaces rather than cleanup.
- MCP `projectPath` guidance: Not tested through a live MCP client. CLI diagnostics still show MCP is explicit-tools-only and Claude Desktop MCP is configured. Existing guidance to pass `projectPath` remains important, especially because desktop clients may not have a useful cwd.

## Freshness Advisory Usefulness

- Stale advisory count basis: `0` stale advisories across 53 visible approved memories; `withFreshnessCount: 0`.
- Expired advisory count basis: `0` expired advisories across 53 visible approved memories; `withFreshnessCount: 0`.
- Human output visibility: `status --since` human output stayed bounded and text-free. Because no stale/expired advisories existed, the Phase 20 Slice 6 action block was not exercised by live data in this validation.
- Dry-run command usefulness: Not exercised by current memory data because there were no stale/expired advisory actions. Prior Slice 6 tests/release verification covered rendering, but this dogfood run does not provide new evidence that refresh workflow demand exists.
- Refresh workflow justification: No. Current evidence does not justify `memory-lane refresh`; there are no live stale/expired advisory records to batch or streamline. Keep refresh deferred until real advisory data appears and manual dry-run actions prove insufficient.

## Context Policy Observations

- Context policy mode: `selective`.
- Item/character budgets:
  - SessionStart: 4 items, 1600 chars.
  - Prompt: 6 items, 3000 chars.
  - SessionStart preference cap: 2 items, 600 chars.
  - Prompt preference cap: 2 items, 900 chars.
  - Pending inclusion: `false`.
  - Fallback to search: `true`.
- Selected/omitted counts: Preference diagnostics reported 17 visible preference-like memories, 4 current-project, 13 global, 2 workflow-rule preference records. SessionStart baseline preference diagnostics showed 0 selected and 17 omitted under the current baseline diagnostic snapshot.
- Evidence for token-accounting follow-up: Not enough to prioritize token-accounting as the immediate next code slice. Character/item budgets and selected/omitted counts are visible and no context overflow was observed in this inspection-only run. Token accounting remains a good future follow-up, but this validation did not show it is more urgent than starting Phase 21 design.

## Exit Verdict

- `Exit Phase 20`

Evidence:

- Review-first generated state is visible and inspectable: 20 pending records are grouped by project/source/kind/provenance; correction/procedure filtered queues are clean empty states; no validation-generated mutations occurred.
- Continuity is useful enough as the canonical first surface: it reports approved state, pending continuity, warnings, and inspection-first suggested actions without relying on recall alone or suggesting destructive cleanup.
- Freshness advisories are not noisy: current live data has 0 stale/expired advisories across 53 visible approved memories, so there is no evidence to justify refresh, recall filtering, or consolidation work before Phase 21.
- Context policy diagnostics are visible and conservative: selective mode, item/character budgets, pending exclusion, fallback-to-search, and preference-cap diagnostics are all inspectable without memory-body dumps.
- No blocker was found that requires Phase 20 product-code follow-up before beginning a Phase 21 design slice. MCP and lifecycle should still be rechecked when live clients are available, but their absence in this validation session did not reveal a product defect.

## Recommended Next Slice

- Recommendation: Start **Phase 21 Slice 1 — Handoff Mode Contract and Review-Mode Design**.
- Why next: Phase 20's read-only/review-first surfaces are useful enough to proceed, while the validation evidence does not justify refresh, recall filtering, consolidation, retrieval rewrites, token retuning, or viewer work as the immediate next slice.
- Explicitly out of scope: automatic handoff mode implementation, new lifecycle injection behavior, raw transcript capture, refresh/consolidation commands, recall/injection filtering, token-budget retuning, retrieval rewrites, MCP tool expansion, and automatic approval/cleanup.

## Not Tested

- MCP live tool calls: Not tested because this validation session did not have a live MCP client invocation channel. CLI diagnostics reported Claude Desktop MCP configured, and the validation used equivalent CLI status/review/continuity surfaces.
- Claude Code lifecycle: Not tested because user-level Claude Code hook diagnostics reported not configured in this checkout and no live Claude Code event was available.
- Codex lifecycle: Not tested despite user-level Codex hook diagnostics reporting configured, because no live Codex event was available in this validation session. Synthetic hook payloads were intentionally avoided.
- pi lifecycle/UI: Not tested because no live pi UI/session context was available. CLI diagnostics reported the pi extension detected.
- Summarization provider/session-summary generation: Not tested because this validation was inspection-only and did not create new pending candidates.
