# Worktree-Aware Project Scope Design

## Goal

Make Memory Lane treat Git worktrees for the same repository as the same logical project by default, while preserving explicit `.memory-lane-scope` as the highest-priority user override.

This reduces project-memory fragmentation for users who work in multiple Git worktrees without requiring setup or alias configuration.

## Problem

Memory Lane currently resolves project identity as:

1. nearest `.memory-lane-scope` file walking up from `cwd`
2. Git working tree root path from `git rev-parse --show-toplevel`
3. no project scope

That means a main checkout and a linked worktree are treated as different projects because their working tree roots differ:

```text
/Users/alice/projects/app
/Users/alice/.config/superpowers/worktrees/app/feature-a
/tmp/app-bugfix
```

For users, these are usually the same logical project. Memories saved from one worktree must be visible from the others by default after this change.

## Design Principles

1. Easy defaults: common Git worktree use works with no Memory Lane setup.
2. Explicit control: `.memory-lane-scope` remains authoritative and can override all Git-derived identity.
3. Deterministic and local: identity is derived from local Git metadata only; no network calls.
4. Privacy-preserving: no remote URL is required for the first slice.
5. Backward compatible: non-worktree Git repos keep their existing path-based key.
6. Minimal scope: no migration command, alias editor, or config UI in this slice.

## Proposed Behavior

`resolveProjectScope(cwd)` will resolve identity in this order:

1. If `.memory-lane-scope` exists, use its `id` exactly as today.
2. Otherwise, if `cwd` is inside a Git repo:
   - read `git rev-parse --show-toplevel` for the current working tree root;
   - read `git rev-parse --git-common-dir`;
   - if the common dir identifies a linked-worktree group, use the common dir's owner working tree path as the project key;
   - otherwise, keep using the current working tree root path as the project key.
3. Otherwise return `null`.

For a normal repo:

```text
cwd:        /repo
show-top:   /repo
git-common: .git
projectKey: /repo
```

For a linked worktree:

```text
cwd:        /worktrees/app/feature-a
show-top:   /worktrees/app/feature-a
git-common: /repo/.git
projectKey: /repo
```

## Canonical Key Derivation

The first slice will derive the linked-worktree canonical key from `git rev-parse --git-common-dir` when possible.

Algorithm:

1. Resolve `showTopLevel = realpath(git rev-parse --show-toplevel)`.
2. Resolve `gitCommonDirRaw = git rev-parse --git-common-dir` relative to `showTopLevel` when it is not absolute.
3. Resolve `gitCommonDir = realpath(gitCommonDirRaw)`.
4. If `gitCommonDir` basename is `.git`, use `dirname(gitCommonDir)` as the canonical project key.
5. Otherwise use `showTopLevel` as the project key.

This preserves normal non-worktree behavior because a normal repository's common dir is usually `<repo>/.git`, whose dirname is the repo path.

For bare repositories, submodules, or unusual Git layouts where the above assumptions do not hold, `.memory-lane-scope` remains the supported override.

## Project Scope Shape

`ProjectScope` remains unchanged:

```ts
interface ProjectScope {
  cwd: string
  root: string
  key: string
}
```

For linked worktrees:

- `cwd`: current resolved cwd
- `root`: current working tree root (`show-toplevel`)
- `key`: canonical project key derived from common Git dir owner

This keeps diagnostics able to show the actual current worktree root while matching memories by the canonical key.

## Non-Goals

1. No automatic rewrite of existing memory records.
2. No remote URL based identity in this slice.
3. No alias glob support in this slice.
4. No new CLI commands for alias management.
5. No changes to storage location resolution.
6. No changes to Obsidian mirror layout beyond whatever naturally follows from project key display.

## Existing Memories

Existing memories saved under individual worktree path keys will remain as-is. They may not automatically become visible under the new canonical key.

Users can clean up or migrate old fragmented memories manually with existing commands (`list --all`, `delete`, `save`) until a future migration/audit command exists.

This is acceptable for the first slice because the main value is preventing new fragmentation.

## Error Handling

Git commands can fail or return paths that cannot be realpathed. In those cases, `resolveProjectScope` must fall back to current behavior:

- if `show-toplevel` exists, use it as the key;
- if Git scope cannot be resolved, return `null`.

Resolution must not throw for ordinary non-Git directories.

## Tests

Add tests in `packages/core/test/project-scope.test.ts` for:

1. Existing `.memory-lane-scope` priority over Git identity.
2. Existing normal Git repo behavior: key remains the repo root path.
3. Linked worktree behavior: key resolves to the main/common repository path while root remains the current worktree root.
4. Non-Git directories still return `null`.

Tests must create real temporary Git repositories and linked worktrees using `git worktree add`. The existing test suite already depends on Git for project-scope tests.

## Documentation

Update:

- `README.md` Project Scoping section.
- `CONTEXT.md` Project identity definition.

Docs must explain:

1. `.memory-lane-scope` is still the explicit override.
2. Git worktrees are recognized as the same project by default when their common Git directory points back to the main repo.
3. Existing fragmented memories are not migrated automatically.
4. Users can still use `.memory-lane-scope` for custom stable identities.

## Acceptance Criteria

1. Linked Git worktrees for the same repo resolve to the same project key by default.
2. `.memory-lane-scope` still overrides Git-derived identity.
3. Normal Git repos keep their existing repo-root key.
4. Non-Git directories still return `null`.
5. No storage path behavior changes.
6. Core tests pass.
7. Full build and test pass before merge.
