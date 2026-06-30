# SessionStart Descriptor Metadata Dogfood

## Status

Passed on 2026-06-30 for `v0.2.40`.

## Scope

Validate the released Slice B artifact after PR #72:

- release workflow publishes assets;
- installed upgrade succeeds;
- exact `show` surfaces structured descriptor metadata;
- exact `show --json` includes descriptor metadata;
- SessionStart descriptor cards prefer structured metadata and compact fetch hints;
- SessionStart does not inject the full memory body for descriptor cards;
- fallback generated descriptor previews still work for memories without structured metadata.

## Release evidence

Tag: `v0.2.40`

Release workflow: `28419273491`

Workflow result: passed.

Release assets: 8

- `install.ps1`
- `install.sh`
- `memory-lane-darwin-arm64.tar.gz`
- `memory-lane-darwin-x64.tar.gz`
- `memory-lane-linux-arm64.tar.gz`
- `memory-lane-linux-x64.tar.gz`
- `memory-lane-windows-x64.exe.zip`
- `SHA256SUMS`

Installed upgrade command:

```bash
memory-lane upgrade --yes
```

Result: passed.

The installer downloaded `memory-lane-darwin-arm64.tar.gz`, verified checksum, installed to `/Users/shiang/.local/bin/memory-lane`, and reconfigured Pi.

Smoke check:

```bash
memory-lane --smoke-test
```

Result: `memory-lane ok`.

## Fixture

Dogfood used an isolated temporary Memory Lane store via `MEMORY_LANE_FILE`, `MEMORY_LANE_EMBEDDINGS_FILE`, and `MEMORY_LANE_CONFIG`.

The fixture contained:

1. `structured1`, an approved current-project memory with `descriptor.description`, `descriptor.fetchHint`, and `descriptor.keywords`.
2. `fallback1`, an approved current-project memory without descriptor metadata.

The structured memory body intentionally contained the sentinel text `FULL BODY SHOULD NOT APPEAR IN SESSION START`.

## Exact show validation

Command:

```bash
memory-lane show structured1 --all
```

Observed descriptor section:

```text
Descriptor:
  Description: Structured descriptor summary for Slice B persistence
  Fetch hint: working on descriptor metadata, SessionStart cards, or exact memory inspection
  Keywords: descriptor, session-start
```

Command:

```bash
memory-lane show structured1 --all --json | jq '.data.memory.descriptor'
```

Observed JSON:

```json
{
  "description": "Structured descriptor summary for Slice B persistence",
  "fetchHint": "working on descriptor metadata, SessionStart cards, or exact memory inspection",
  "keywords": [
    "descriptor",
    "session-start"
  ]
}
```

## SessionStart validation

Command:

```bash
printf '%s' '<codex SessionStart payload>' | memory-lane codex session-start
```

Observed context excerpt:

```text
<memory-context mode="selective" event="sessionStart">
## Memory Index

Memory Lane selected compact descriptors for this session. Fetch the full body only when needed with `memory_get <id>` or `memory-lane show <id>` before relying on details not shown.

### Current project

- [structured1] Project fact - Structured descriptor summary for Slice B persistence Fetch when: working on descriptor metadata, SessionStart cards, or exact memory inspection
- [fallback1] Project fact - Fallback descriptor memory proves generated previews still work when structured metadata is absent.
</memory-context>
```

Assertions:

- `Structured descriptor summary for Slice B persistence` was present.
- `Fetch when: working on descriptor metadata` was present.
- `FULL BODY SHOULD NOT APPEAR` was absent.
- `Fallback descriptor memory proves generated previews` was present.
- Fetch guidance with `memory-lane show <id>` was present.

## Conclusion

Slice B release dogfood passed.

Structured descriptor metadata is persisted and inspectable, SessionStart prefers structured descriptor metadata where present, generated fallback descriptors still work, and descriptor-card full-body leakage was not observed in the released artifact.
