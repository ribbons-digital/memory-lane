# Obsidian Import Contract

## Goal

Define the explicit Obsidian import workflow before implementation. Obsidian import reads user-authored Markdown notes into the JSONL memory store; it is separate from the Obsidian mirror, does not scan the whole vault, does not rewrite source notes, and does not make Obsidian the source of truth.

## Non-goals

- No bidirectional sync.
- No Obsidian-backed storage.
- No whole-vault scanning.
- No importing generated mirror files.
- No deleting or rejecting memories through import.
- No source-note rewriting, archiving, moving, or deletion.
- No `--vault`, `--folder`, or `--path` override in the first implementation slice.
- No multiple memories per Markdown file.
- No title/filename import metadata.

## Discovery

Import uses the configured Obsidian mirror settings and scans only:

```text
<vault>/<folder>/imports/
```

Rules:

- Only `.md` files are candidates.
- Discovery recurses under `imports/`.
- Dotfiles and dotfolders are skipped.
- Symlinks are not followed.
- Files are processed in deterministic normalized relative-path order.
- Missing `imports/` is not an error; dry-run and apply report zero candidates with a hint.
- Whole-vault scan is not supported in the first implementation.
- Future advanced support may add explicit `--path <file-or-folder>` after the base contract proves useful.

## Import marker

A note is importable only when top-of-file frontmatter contains:

```yaml
memory_lane: true
```

Rules:

- Files without top-of-file frontmatter are ignored silently.
- Files with no `memory_lane: true` are ignored silently, not counted as skipped.
- Files with `memory_lane: false` are ignored silently.
- Files with `memory_lane_mirror: true` are skipped with a warning, even if they also contain `memory_lane: true`.

## Frontmatter format

The first implementation supports a constrained scalar subset of standard YAML frontmatter.

Rules:

- Frontmatter must start at the first character of the file and be delimited by `---`.
- Only the first top-of-file frontmatter block is parsed.
- Later `---` blocks are body text.
- Recognized scalar fields:
  ```yaml
  memory_lane: true
  memory_lane_id: "abc12345"
  category: project
  scope: project
  status: pending
  kind: project_fact
  ```
- Unknown fields are ignored silently so Obsidian plugin metadata is not noisy.
- Invalid recognized field values cause the note to be skipped with a warning.
- Arrays and nested objects are not needed in the first implementation.
- Empty frontmatter means no import marker and is ignored silently.

## Memory text

The Markdown body after frontmatter is the memory text.

Rules:

- Frontmatter is metadata only.
- Body text is preserved as Markdown exactly except for leading/trailing whitespace trim.
- Empty body after trim is skipped with a warning.
- Headings are not parsed specially.
- Filename and Obsidian note title are ignored.
- Existing secret detection is reused; likely secrets are skipped with a warning that does not print the secret value.

## Create schema and defaults

For notes without `memory_lane_id`, import creates a new memory through Memory Lane validation.

Required:

```yaml
memory_lane: true
```

Optional:

```yaml
category: project      # preference | personal | project
scope: project         # global | project
status: pending        # pending | approved
kind: project_fact     # existing MemoryKind
```

Defaults for creates:

```yaml
category: personal
scope: global
status: pending
```

Rules:

- `status: rejected` and `status: deleted` are invalid for import and skip with warning.
- `source` is not user-configurable; created imports use `source: "manual"`.
- Import does not set lifecycle provenance in the first implementation because current provenance terms describe harness lifecycle events.
- Project-scoped creates require project identity. If unavailable, skip with warning rather than falling back to global.

## Update schema

For notes with `memory_lane_id`, import updates an existing active memory.

Rules:

- If `memory_lane_id` matches an existing `approved` or `pending` memory, import may update it.
- If it matches a `rejected` or `deleted` memory, skip with warning.
- If it does not match any memory, skip with warning; do not create a record with a user-provided ID.
- Always update text from the Markdown body.
- Explicit valid `category` and `kind` may update those fields.
- Omitted metadata preserves existing values; create defaults are never applied to updates.
- Preserve `id` and `createdAt`.
- Preserve existing `source`; do not change it to `manual` on update.
- Scope changes are forbidden in the first implementation:
  - omitted `scope` preserves existing scope;
  - explicit `scope` must match the existing scope type;
  - existing project scope must match current project identity if project context is needed;
  - mismatches skip with warning.
- Status changes:
  - pending + omitted status => pending;
  - pending + `status: approved` => approved;
  - approved + omitted status => approved;
  - approved + `status: approved` => approved;
  - approved + `status: pending` => skip with warning.

## Duplicate and conflict semantics

Rules:

- Notes without `memory_lane_id` create through existing duplicate detection.
- Existing duplicate text/category/scope creates are skipped with duplicate warning.
- Two create candidates in the same run with duplicate body text are all skipped with warnings.
- Two notes in the same run targeting the same `memory_lane_id` are all skipped with warnings.
- Notes targeting existing IDs are not part of the duplicate-create text check.
- Import supports partial success: valid notes apply, invalid notes skip, and there is no transaction/rollback in the first implementation.

## Dry-run behavior

Dry-run performs discovery, parsing, validation, conflict checks, and planning, but performs zero writes to JSONL or mirror files.

Rules:

- Dry-run must not call write-capable `MemoryEngine` methods.
- Dry-run output is deterministic by sorted relative path.
- Command-level success returns `ok: true` even when notes are skipped with warnings.

Human dry-run shape:

```text
Would import: 3
Would update: 1
Would skip: 2
Warnings:
- Memory Lane/imports/bad.md: missing memory body
- Memory Lane/imports/old.md: memory_lane_id points to deleted memory
```

JSON dry-run shape:

```json
{
  "ok": true,
  "data": {
    "summary": {
      "wouldCreate": 3,
      "wouldUpdate": 1,
      "skipped": 2
    },
    "results": [
      {
        "path": "Memory Lane/imports/foo.md",
        "action": "create",
        "status": "pending",
        "warnings": []
      }
    ]
  }
}
```

## Apply behavior

Apply uses the same planner as dry-run, then applies valid planned creates/updates.

Rules:

- Creates and updates go through Memory Lane core APIs, not direct storage mutation.
- Import should add a small explicit core update API in the implementation slice, e.g. `engine.update(id, patch)`, so append-only update semantics, validation, and best-effort mirroring remain centralized.
- If Obsidian mirror is enabled, normal best-effort mirror sync may create/update generated files under `memories/`.
- Source notes under `imports/` remain untouched.
- Mirror warnings from core writes are included in import result warnings.
- Command-level `ok: true` means the import command completed, even with per-note skips.
- Command-level `ok: false` is reserved for command failures such as missing configured Obsidian mirror, unreadable config, or filesystem failure that prevents discovery.

Human apply shape:

```text
Imported: 3
Updated: 1
Skipped: 2
Warnings:
- Memory Lane/imports/bad.md: missing memory body
- Memory Lane/imports/foo.md: Obsidian mirror update failed: ...
```

JSON apply shape:

```json
{
  "ok": true,
  "data": {
    "summary": {
      "created": 3,
      "updated": 1,
      "skipped": 2
    },
    "results": [
      {
        "path": "Memory Lane/imports/foo.md",
        "action": "created",
        "memoryId": "abc12345",
        "status": "pending",
        "warnings": []
      }
    ]
  }
}
```

## CLI contract

First implementation commands:

```bash
memory-lane obsidian import --dry-run
memory-lane obsidian import
memory-lane obsidian import --json --dry-run
memory-lane obsidian import --json
```

Rules:

- Import requires configured Obsidian mirror settings from `memory-lane obsidian init --vault <path>`.
- No `--vault`, `--folder`, or `--path` in the first implementation.
- Existing CLI `--project <path>` may be used to establish project identity for project-scoped imports.

## Package boundary

Add parser/planner logic in a new package:

```text
@memory-lane/obsidian-import
```

Responsibilities:

- discover importable Markdown files;
- parse constrained frontmatter and body text;
- validate import fields;
- produce dry-run/apply plans and warnings.

Non-responsibilities:

- no JSONL writes;
- no mirror writes;
- no dependency on `@memory-lane/core`.

CLI/core integration applies planned creates/updates through `MemoryEngine`.

## Implementation slice after this contract

Keep the next implementation slice to five todos:

1. Add `@memory-lane/obsidian-import` parser/planner package with tests for discovery, frontmatter/body parsing, marker rules, invalid fields, and deterministic ordering.
2. Add explicit core update API for active-memory updates with validation and best-effort mirror warnings.
3. Add `memory-lane obsidian import --dry-run` and `memory-lane obsidian import` CLI integration using configured Obsidian settings.
4. Add import apply tests for create/update/duplicate/conflict/partial-success/mirror-warning behavior.
5. Update README, CLI help, and `skills/memory-lane/SKILL.md`, including `obsidian init` creating or documenting the `imports/` folder.
