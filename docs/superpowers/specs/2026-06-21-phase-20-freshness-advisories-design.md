# Phase 20 Slice 4 — Read-only Freshness Advisories Design

## Status

Approved for implementation after Opus 4.8 planning review on 2026-06-21.

## Problem

Phase 20 added advisory `MemoryFreshness` metadata (`expiresAt`, `staleAfterDays`, `capturedAt`) and then began populating `capturedAt` for generated session summaries when trustworthy session timestamps exist. That metadata is currently mostly inert in read models: users and MCP clients can inspect raw metadata on listed records, but Memory Lane does not derive compact freshness advisory signals for continuity/status surfaces.

This leaves an unfinished continuity loop: Memory Lane can store time-awareness but cannot yet tell the user, in a text-free/read-only way, that approved visible memories explicitly marked with freshness metadata are expired or stale.

## Goals

1. Derive deterministic read-only freshness classifications for approved visible memories with existing `freshness` metadata.
2. Surface compact text-free freshness advisory counts and bounded metadata through existing status/doctor/MCP status and continuity read-model paths.
3. Add a `freshness-advisory` continuity hint/warning when expired or stale approved visible memories exist.
4. Keep all output advisory: no mutation, cleanup, recall ranking, injection filtering, or automatic refresh behavior.
5. Preserve privacy by exposing ids/timestamps/classification metadata, not memory text.

## Non-goals

- No refresh command.
- No consolidation command.
- No automatic cleanup, deletion, rejection, approval, rescope, or supersede behavior.
- No recall, semantic ranking, lifecycle injection, or context-selection behavior changes.
- No LLM stale classifier or text-derived staleness inference.
- No adapter payload expansion.
- No auto-population or migration of missing freshness fields.
- No `aging` classification in this slice.
- No new CLI commands or MCP tools.

## Domain semantics

Freshness advisory classification is a deterministic read-only interpretation of explicit stored metadata.

For each approved memory visible to the current project scope:

- `none`: no stored `freshness` fields.
- `expired`: `freshness.expiresAt` is present and is at or before the reference time.
- `stale`: not expired, `freshness.staleAfterDays` is present, and the stale window has elapsed from `freshness.capturedAt` when present, otherwise `updatedAt`.
- `current`: at least one `freshness` field exists, but the memory is neither expired nor stale.

`capturedAt` remains source/session-as-of time. `updatedAt` fallback is used only because many existing records and checkpoint candidates do not have trustworthy captured timestamps yet.

## Reference time

The read model uses a reference time for deterministic comparison:

- Production/default: current wall-clock time, produced by Memory Lane at read time.
- Tests: injectable `referenceNow` ISO timestamp.

Invalid `referenceNow` values must be rejected with the same strict canonical ISO timestamp semantics used for `since`.

## Data model/API changes

Add:

```ts
export type FreshnessClassification = "none" | "current" | "stale" | "expired"
```

Extend `FreshnessMemoryMetadata` with optional text-free advisory freshness metadata:

```ts
freshness?: {
  classification: FreshnessClassification
  expiresAt?: string
  staleAfterDays?: number
  capturedAt?: string
  staleAnchor?: string
}
```

Extend `FreshnessStatus` with:

```ts
advisory: {
  referenceNow: string
  withFreshnessCount: number
  currentCount: number
  staleCount: number
  expiredCount: number
  stale: FreshnessMemoryMetadata[]
  expired: FreshnessMemoryMetadata[]
}
```

Extend `FreshnessStatusOptions` with optional `referenceNow?: string`.

Extend `ContinuityHintCode` and `ContinuityWarningCode` with `freshness-advisory`.

## Surfaces

Use existing read-only surfaces only:

- `MemoryEngine.doctor()` / core status data already containing `freshness`.
- CLI `status` and `doctor`, including JSON and compact human output as appropriate.
- MCP `memory_status`, through existing status serialization.
- Continuity read model / CLI `continuity` / MCP `memory_continuity`, via `continuityHints` and `warnings`.

No new commands, tools, flags, or lifecycle payload fields are introduced.

## Behavior

- Expired/stale memories remain approved and visible.
- Recall and injection continue to include memories exactly as before.
- Continuity warnings advise inspection only.
- Metadata lists are bounded by the existing `maxNewerMetadata`/`maxIds` style cap.
- Memory text is never included in freshness advisory metadata.

## Tests

Add or update tests for:

1. Classification of expired, stale, current, and none using injected `referenceNow`.
2. `capturedAt` preferred over `updatedAt` for stale-window calculation.
3. `updatedAt` fallback when `capturedAt` is absent.
4. Invalid `referenceNow` rejected.
5. Advisory counts and bounded stale/expired metadata lists respect approved/visible filtering.
6. Serialized freshness advisory output does not include memory text.
7. Continuity hints/warnings include `freshness-advisory` only when expired/stale visible approved memories exist.

## Documentation

Update README/CONTEXT/ROADMAP/HANDOFF to explain:

- Freshness metadata is now surfaced as advisory read-only status.
- Expired/stale does not mean hidden, deleted, rejected, ignored, or down-ranked.
- Recall/injection behavior is unchanged.

## Risks and mitigations

- **Users may mistake expired/stale for enforcement.** Mitigate through wording: advisory/read-only/no behavior change.
- **Signal noise from many records.** Mitigate with counts plus bounded id metadata.
- **Timestamp ambiguity.** Mitigate with strict ISO validation and explicit `capturedAt` then `updatedAt` stale-anchor rule.
