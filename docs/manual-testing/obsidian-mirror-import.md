# Manual Testing Guide — Obsidian Mirror and Import

This guide tests the completed Obsidian mirror/import work, including generated mirror indexes and doctor diagnostics.

## Scope

Covered:

- Basic CLI/storage sanity
- Optional Obsidian mirror setup
- Mirror sync dry-run/apply behavior
- Generated mirror indexes, links, and lightweight tags
- Cheap Obsidian doctor diagnostics
- Explicit Obsidian import dry-run/apply behavior
- Import update behavior with `memory_lane_id`
- Generated-file skip behavior
- Source-note preservation
- Warning/partial-success behavior

Not covered:

- Future MCP server
- Future Obsidian-backed storage
- Automatic/bidirectional sync, which intentionally does not exist

## Prerequisites

From the repo root:

```bash
sfw pnpm install
pnpm build
pnpm test
```

Use a disposable test directory so the test does not touch real memories or a real Obsidian vault:

```bash
export ML_TEST_ROOT="$(mktemp -d)"
export MEMORY_LANE_FILE="$ML_TEST_ROOT/memory.jsonl"
export MEMORY_LANE_EMBEDDINGS_FILE="$ML_TEST_ROOT/embeddings.jsonl"
export MEMORY_LANE_CONFIG="$ML_TEST_ROOT/config.json"
export ML_TEST_VAULT="$ML_TEST_ROOT/TestVault"
mkdir -p "$ML_TEST_VAULT"
```

If using the local repo during development, build first and run the generated local CLI directly:

```bash
pnpm build
node packages/cli/dist/index.js <args>
```

If the package is built/linked globally, replace that prefix with:

```bash
memory-lane <args>
```

The examples below use a helper variable for the local repo CLI:

```bash
ML="node packages/cli/dist/index.js"
```

## 1. Baseline CLI sanity

```bash
$ML doctor
$ML save "Manual test memory: use pnpm for installs" --category project --status approved
$ML list
$ML recall "pnpm installs"
```

Expected:

- `doctor` prints storage/config information.
- `save` reports a saved memory id.
- `list` shows the saved memory.
- `recall` finds the saved memory.

## 2. Obsidian status before setup

```bash
$ML obsidian status
```

Expected:

- Reports that the Obsidian mirror is not configured or disabled.
- No vault files are created.

## 3. Initialize Obsidian mirror

```bash
$ML obsidian init --vault "$ML_TEST_VAULT"
find "$ML_TEST_VAULT" -maxdepth 4 -type f -o -type d | sort
```

Expected:

- Config is updated with an enabled Obsidian mirror.
- Mirror folder exists at:

```text
$ML_TEST_VAULT/Memory Lane/
```

- Generated index files exist at:

```text
$ML_TEST_VAULT/Memory Lane/index.md
$ML_TEST_VAULT/Memory Lane/indexes/pending.md
$ML_TEST_VAULT/Memory Lane/indexes/approved.md
$ML_TEST_VAULT/Memory Lane/indexes/project.md
$ML_TEST_VAULT/Memory Lane/indexes/recent.md
```

- Generated memory files live under:

```text
$ML_TEST_VAULT/Memory Lane/memories/
```

- Import area exists at:

```text
$ML_TEST_VAULT/Memory Lane/imports/
```

## 4. Inspect generated mirror indexes

```bash
find "$ML_TEST_VAULT/Memory Lane" -maxdepth 2 -type f | sort
sed -n '1,80p' "$ML_TEST_VAULT/Memory Lane/index.md"
sed -n '1,80p' "$ML_TEST_VAULT/Memory Lane/indexes/recent.md"
sed -n '1,80p' "$ML_TEST_VAULT/Memory Lane/indexes/approved.md"
```

Expected:

- `index.md` and `indexes/*.md` exist.
- Index frontmatter includes:

```yaml
memory_lane_mirror: true
memory_lane_index: true
tags:
  - memory-lane
  - memory-lane/index
```

- Index entries use standard Markdown links to generated memory files, for example `](../memories/<id>.md)` from `indexes/*.md`.
- Index files are generated/read-only mirror artifacts, may be overwritten by sync, and are not user-authored import notes.

## 5. Inspect generated mirror file

```bash
ls "$ML_TEST_VAULT/Memory Lane/memories"
first_file="$(find "$ML_TEST_VAULT/Memory Lane/memories" -name '*.md' | head -n 1)"
printf '%s\n' "$first_file"
sed -n '1,80p' "$first_file"
```

Expected:

- The file has frontmatter including:

```yaml
memory_lane_mirror: true
tags:
  - memory-lane
  - memory-lane/memory
```

- The file also includes status/category/kind tags such as `memory-lane/status/approved`, `memory-lane/category/project`, and `memory-lane/kind/memory` or a more specific kind.
- The file is generated from JSONL. Do not edit it as a source of truth.

## 6. Check Obsidian doctor diagnostics

```bash
$ML doctor | grep '^obsidian' || true
```

Expected:

- Doctor output includes cheap Obsidian fields such as `obsidianEnabled`, `obsidianVaultPath`, `obsidianFolder`, `obsidianMirrorRoot`, `obsidianMirrorFolderExists`, `obsidianMemoriesFolderExists`, `obsidianImportsFolderExists`, and `obsidianWarnings`.
- Doctor does not repair, sync, or write Obsidian files.

## 7. Mirror sync dry-run writes nothing

```bash
before="$(find "$ML_TEST_VAULT" -type f | sort | xargs shasum 2>/dev/null || true)"
$ML obsidian sync --dry-run
after="$(find "$ML_TEST_VAULT" -type f | sort | xargs shasum 2>/dev/null || true)"
test "$before" = "$after" && echo "dry-run did not modify files"
```

Expected:

- Dry-run summarizes planned mirror work.
- File checksums remain unchanged.

## 8. Mirror sync apply

```bash
$ML obsidian sync
```

Expected:

- Mirror files and indexes are reconciled.
- Import folder still exists.
- Generated indexes remain generated/read-only mirror artifacts, not import sources.

## 9. Re-inspect generated indexes after sync

```bash
sed -n '1,80p' "$ML_TEST_VAULT/Memory Lane/index.md"
sed -n '1,80p' "$ML_TEST_VAULT/Memory Lane/indexes/recent.md"
```

Expected:

- `index.md` links to `indexes/pending.md`, `indexes/approved.md`, `indexes/project.md`, and `indexes/recent.md`.
- `indexes/recent.md` links to memory notes with standard Markdown links like `](../memories/<id>.md)`.
- Index frontmatter still includes `memory_lane_index: true` and `memory-lane/index`.

## 10. Create import notes

Create valid import note:

```bash
cat > "$ML_TEST_VAULT/Memory Lane/imports/pnpm-note.md" <<'EOF'
---
memory_lane: true
category: project
scope: global
status: pending
---
Manual imported note: prefer pnpm for package installation.
EOF
```

Create ignored note without marker:

```bash
cat > "$ML_TEST_VAULT/Memory Lane/imports/not-marked.md" <<'EOF'
---
category: personal
---
This note should be ignored because it has no memory_lane marker.
EOF
```

Create invalid note:

```bash
cat > "$ML_TEST_VAULT/Memory Lane/imports/invalid-status.md" <<'EOF'
---
memory_lane: true
status: deleted
---
This note should be skipped because deleted is not importable.
EOF
```

## 11. Import dry-run

```bash
$ML obsidian import --dry-run
$ML obsidian import --json --dry-run
```

Expected:

- Valid note is listed as would-create.
- Note without `memory_lane: true` is ignored.
- Invalid note is skipped with a warning.
- No new memory is written yet:

```bash
$ML list --status pending
```

Should not include the import note until apply.

## 12. Apply import

```bash
$ML obsidian import
$ML list --status pending
```

Expected:

- Valid note is imported.
- Invalid note remains skipped with warning.
- Source note remains unchanged:

```bash
sed -n '1,80p' "$ML_TEST_VAULT/Memory Lane/imports/pnpm-note.md"
```

The file should not have a generated id inserted, should not move, and should not be archived/deleted.

## 13. Verify mirror after import

```bash
find "$ML_TEST_VAULT/Memory Lane/memories" -name '*.md' -print -exec sed -n '1,60p' {} \;
```

Expected:

- Imported active memory may appear as a generated mirror file.
- Generated mirror file has `memory_lane_mirror: true`.
- This generated file is not an import source.

## 14. Generated mirror files and indexes are skipped by import

Copy a generated mirror memory file and a generated index file into imports:

```bash
mirror_file="$(find "$ML_TEST_VAULT/Memory Lane/memories" -name '*.md' | head -n 1)"
cp "$mirror_file" "$ML_TEST_VAULT/Memory Lane/imports/generated-copy.md"
cp "$ML_TEST_VAULT/Memory Lane/index.md" "$ML_TEST_VAULT/Memory Lane/imports/generated-index-copy.md"
$ML obsidian import --dry-run
```

Expected:

- `generated-copy.md` is skipped because it has `memory_lane_mirror: true`.
- `generated-index-copy.md` is skipped because generated indexes have `memory_lane_mirror: true` and `memory_lane_index: true`.
- Import should not treat generated indexes as user-authored notes.

## 15. Update an existing memory by id

Get an existing memory id:

```bash
$ML list --json > "$ML_TEST_ROOT/list.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(data.data.memories[0].id)' "$ML_TEST_ROOT/list.json"
```

Set it:

```bash
export ML_EXISTING_ID="<paste-id-here>"
```

Create an update note:

```bash
cat > "$ML_TEST_VAULT/Memory Lane/imports/update-existing.md" <<EOF
---
memory_lane: true
memory_lane_id: $ML_EXISTING_ID
category: project
status: approved
---
Manual imported update: pnpm remains the required package manager.
EOF
```

Preview and apply:

```bash
$ML obsidian import --dry-run
$ML obsidian import
$ML list --json | node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); for (const m of data.data.memories) console.log(m.id, m.status, m.text)'
```

Expected:

- Dry-run shows would-update for the target id.
- Apply updates the active memory through append-only JSONL.
- The memory id is preserved.

## 16. Duplicate conflict behavior

Create two create notes with identical body text:

```bash
cat > "$ML_TEST_VAULT/Memory Lane/imports/dup-a.md" <<'EOF'
---
memory_lane: true
---
Duplicate body text for conflict testing.
EOF

cat > "$ML_TEST_VAULT/Memory Lane/imports/dup-b.md" <<'EOF'
---
memory_lane: true
---
Duplicate body text for conflict testing.
EOF

$ML obsidian import --dry-run
```

Expected:

- Both duplicate create notes are skipped with conflict warnings.

## 17. Soft delete and mirror removal

Delete a memory and sync:

```bash
$ML list --json > "$ML_TEST_ROOT/list-delete.json"
export ML_DELETE_ID="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(data.data.memories[0].id)' "$ML_TEST_ROOT/list-delete.json")"
$ML delete "$ML_DELETE_ID"
$ML obsidian sync
find "$ML_TEST_VAULT/Memory Lane/memories" -name "$ML_DELETE_ID.md" -print
```

Expected:

- Deleted memory is no longer mirrored.
- Sync removes generated mirror memory files marked `memory_lane_mirror: true`; stale generated-index deletion is additionally gated by `memory_lane_index: true`.

## 18. Cleanup

```bash
rm -rf "$ML_TEST_ROOT"
unset MEMORY_LANE_FILE MEMORY_LANE_EMBEDDINGS_FILE MEMORY_LANE_CONFIG ML_TEST_ROOT ML_TEST_VAULT ML ML_EXISTING_ID ML_DELETE_ID
```

## Quick gotcha checklist

- Obsidian import is explicit; it never runs automatically.
- Import is not bidirectional sync.
- JSONL remains source of truth.
- Import reads only `<vault>/<folder>/imports/`.
- Import notes require top-of-file `memory_lane: true`.
- Generated mirror memory files and generated index files are read-only artifacts and may be overwritten.
- Generated files with `memory_lane_mirror: true` are skipped; generated indexes also have `memory_lane_index: true`.
- Generated memory files have `memory-lane`, `memory-lane/memory`, and status/category/kind tags; generated index files have `memory-lane` and `memory-lane/index`.
- `memory-lane doctor` reports cheap Obsidian diagnostics but does not repair, sync, or write files.
- Source import notes are never rewritten or moved.
- Dry-run must not write JSONL or mirror files.
- Apply can partially succeed; warnings are expected for invalid notes.
- `status: rejected` and `status: deleted` are invalid for import.
- Project-scoped imports require project identity.
