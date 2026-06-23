# Phase 21 Slice 6e — Installer Skill Destination Hardening Design

## Status

Design/spec slice. Implementation should begin only after this spec is reviewed and approved.

## Context

Phase 21 Slice 6d validated the Slice 6c read-only continuity CLI fix after release. During that dogfood, running:

```bash
memory-lane upgrade --yes
```

from the Memory Lane main checkout rewrote the tracked repository file:

```text
skills/memory-lane/SKILL.md
```

with the short installer-generated skill template. The file was restored immediately with `git restore`, and no release artifact was changed. The incident revealed an installer/configuration safety issue: generated harness skill writes can follow symlinks into the source tree.

## Verified root cause

Inspection after the incident showed:

```text
~/.agents/skills/memory-lane -> /Users/shiang/projects/ribbons-digital/memory-lane/skills/memory-lane
```

Therefore this write in `packages/cli/src/installer/config.ts`:

```ts
const skillPath = path.join(options.homeDir, ".agents/skills/memory-lane/SKILL.md")
fs.writeFileSync(skillPath, skillContent(options.binaryPath), "utf8")
```

followed the symlink and overwrote the repository source skill file. The Claude skill destination was a real directory and did not point into the repository:

```text
~/.claude/skills/memory-lane/SKILL.md realpath remained under ~/.claude/skills/memory-lane/SKILL.md
```

The release `install.sh` / `install.ps1` do not write `skills/memory-lane/SKILL.md`; they install binaries. The unsafe write is in init/upgrade reconfiguration.

## Domain terms

`CONTEXT.md` now distinguishes:

- **Source skill file**: a skill document that belongs to the repository source tree, such as `skills/memory-lane/SKILL.md`. Installer/upgrade flows must not overwrite it.
- **Installed skill file**: a generated harness skill document under a user harness directory, such as `~/.claude/skills/memory-lane/SKILL.md` or `~/.agents/skills/memory-lane/SKILL.md`. Its nominal destination can be symlinked, so writes must validate the resolved path.

## Goals

1. Prevent `memory-lane init` and upgrade reconfiguration from overwriting Memory Lane source skill files through symlinked installed skill destinations.
2. Keep normal end-user setup working: writing generated skills under real `~/.claude/skills/...` and `~/.agents/skills/...` should remain unchanged.
3. Preserve project-mode behavior: `--project` already skips writing global skill files and should continue to do so.
4. Make guarded skips visible enough for users/developers to diagnose, without aborting unrelated integrations.
5. Keep the implementation narrow: skill destination safety only.

## Non-goals

- No changes to MCP tools or MCP server behavior.
- No lifecycle hook behavior changes.
- No retrieval, recall, continuity, or workstream-discovery changes.
- No new installer wizard UX beyond warning text needed for this guard.
- No broad dotfiles management system.
- No attempt to own or rewrite user symlinks.
- No automatic repair of `~/.agents/skills/memory-lane` symlinks.
- No migration from short generated skill content to the full repository source skill content in this slice.

## Existing behavior

`installClaudeCodeCli(options)` writes:

```text
$HOME/.claude/skills/memory-lane/SKILL.md
```

`installCodexCli(options)` writes:

```text
$HOME/.agents/skills/memory-lane/SKILL.md
```

Both use the inline `skillContent(binaryPath)` generated template. Both write only when `!options.projectMode`.

`memory-lane upgrade` downloads/runs the installer, reads the install manifest, then calls `installHarness(...)` for previously configured integrations with `projectMode: false`. That reuses the same skill-write paths.

## Design options considered

### Option A — Source-tree realpath guard for skill writes

Before writing a generated skill file, resolve the destination's real path (or nearest existing parent real path) and skip the skill write if it lands inside a Memory Lane source checkout at `skills/memory-lane/SKILL.md` or under a Memory Lane repository root.

Pros:

- Directly prevents the observed symlink overwrite.
- Smallest behavior change.
- Does not affect normal end-user paths.
- Core path-safety logic can live in `packages/cli/src/installer/config.ts`; command-layer output in init/upgrade must also change so partial-success warnings are visible.

Cons:

- Needs careful path handling for missing files/parents.
- A pure “inside any git repo” guard would break dotfiles users, so the guard must be Memory Lane source-specific or package-identity-specific.

### Option B — Generated-skill provenance marker and skip non-generated files

Add a marker such as `memory_lane_generated: true` to generated skill files, then refuse to overwrite existing skill files without that marker.

Pros:

- Cleanly distinguishes generated files from authored files.
- Could protect any hand-authored user skill, not only source-tree symlinks.

Cons:

- Existing installed skills do not have the marker, so the first upgrade after this change would skip many legitimate generated skills.
- Needs migration/adoption behavior or a compatibility exception.
- Larger product decision than needed for the observed source overwrite.

### Option C — Manifest-owned skill destinations

Record skill paths in the install manifest and reapply exactly those paths on upgrade instead of recomputing from `$HOME`.

Pros:

- Improves transparency of what upgrade owns.
- Could support future uninstall/repair diagnostics.

Cons:

- Does not solve symlink target safety by itself.
- Requires manifest format evolution.
- Larger than necessary for this slice.

## Recommended approach

Implement **Option A** as the first slice: a narrow source-tree realpath guard for generated skill writes.

Recommended behavior:

1. Introduce a helper in `packages/cli/src/installer/config.ts`, for example:

```ts
function writeGeneratedSkill(skillPath: string, content: string): { written: boolean; warning?: string }
```

2. The helper should:
   - resolve the destination path through symlinks using `fs.realpathSync.native` where possible;
   - if the leaf file does not exist, resolve the nearest existing parent directory and append the remaining path;
   - specifically handle the real incident shape where `~/.agents/skills/memory-lane` is itself a symlinked directory and `SKILL.md` is the leaf below it;
   - detect whether the resolved target is inside a Memory Lane source checkout;
   - if unsafe, skip the write and return a warning;
   - otherwise, create parent directories and write as today.

3. Treat a destination as unsafe when the resolved path is inside a repository/package root that appears to be the Memory Lane source checkout. A practical first-slice detector can walk up from the resolved destination and look for:
   - a `package.json` with `name: "memory-lane"`; and
   - a `skills/memory-lane/SKILL.md` source path under that same root.

4. Do not reject arbitrary git-tracked dotfiles directories. A user may intentionally version-control `~/.agents` or `~/.claude`; that should continue to work unless the resolved target is the Memory Lane source skill area.

5. Apply the helper to both `installClaudeCodeCli` and `installCodexCli`. Guarding only Codex would fix the observed machine but leave the same symlink class open for Claude.

6. Detection-only code such as `hasExistingMemoryLaneConfig` may keep reading existing skill files through symlinks. The guard is for generated skill writes only.

7. The warning must be visible to the user. If using `IntegrationResult.message`, then both `handleInit` and `reapplyInstallManifest`/upgrade output must print `message` even when `configured: true`. Today success paths print only `✓ ... configured` / `✓ ... reconfigured`, so an implementation that only sets `message` would silently drop the warning and fail this design.

8. Mark the harness as configured if hooks/config were written successfully and only the generated skill write was skipped. Use a message such as:

```text
Configured hooks; skipped generated skill because destination resolves into Memory Lane source checkout: <path>
```

9. Do not abort unrelated harnesses. Hooks/MCP config can still be configured if only the generated skill write was skipped.

## User-facing behavior

Normal end-user install/init/upgrade:

```text
✓ Codex CLI configured
```

Symlink-to-source case:

```text
✓ Codex CLI configured
  Warning: skipped Memory Lane skill write because /Users/.../.agents/skills/memory-lane/SKILL.md resolves into the Memory Lane source checkout. Remove or repoint the symlink if you want init/upgrade to manage the installed skill.
```

Exact formatting can follow existing CLI output patterns, but the warning must name the skipped path and explain that hooks/config were still applied.

## Test strategy

### Red test: symlinked Codex skill destination into source checkout

In `packages/cli/test/init.test.ts` or a focused installer test:

1. Create a fake Memory Lane source root with:
   - `package.json` containing `{ "name": "memory-lane" }`
   - `skills/memory-lane/SKILL.md` containing sentinel text.
2. Create temp `$HOME/.agents/skills/memory-lane` as a symlink to that source `skills/memory-lane` directory.
3. Run `memory-lane init --yes` with fake Codex detected.
4. Assert the source `SKILL.md` sentinel remains unchanged.
5. Assert stdout mentions the skipped skill write or destination safety. This requires the implementation to print partial-success messages on configured integrations; `init.test.ts` runs the built CLI as a subprocess and cannot inspect `IntegrationResult` directly.

### Regression: normal Codex skill install still writes

Existing test `installs Codex skill for slash command access` should continue to pass. It should still assert:

- `~/.agents/skills/memory-lane/SKILL.md` exists
- content includes `name: memory-lane`
- content includes the configured binary path

### Regression: dotfiles-style git directory is allowed

Create a temp `$HOME/.agents` or `$HOME/.agents/skills` inside a fake git repository that is **not** a Memory Lane source checkout. Run `init --yes` and assert on disk/stdout that the generated skill is written. This prevents an over-broad “inside any git repo” guard.

### Upgrade reapply path

In `packages/cli/test/upgrade.test.ts`, construct a manifest with `codex-cli`, make `$HOME/.agents/skills/memory-lane` symlink to a fake Memory Lane source skill directory, call `reapplyInstallManifest(...)`, and assert:

- hook config is still reapplied;
- source `SKILL.md` is unchanged;
- result message reports the skipped skill write.

## Documentation updates

Update as needed:

- `README.md` development setup section: warn that developers may symlink installed harness skills to source skill files, and `init`/`upgrade` will not overwrite Memory Lane source skill destinations.
- `HANDOFF.md` and `ROADMAP.md`: record Slice 6e design and its boundaries.
- No user-facing docs are needed for MCP, lifecycle, or continuity behavior.

## Verification for implementation slice

The implementation slice should run at minimum:

```bash
pnpm build
pnpm --filter @memory-lane/cli build
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/cli test -- test/init.test.ts test/upgrade.test.ts
git diff --check
```

If the implementation only touches CLI installer code/tests/docs, full `pnpm test` is optional but preferred before release.

## Open questions for implementation planning

1. Should `IntegrationResult` gain a `warnings?: string[]` field, or should skipped-skill warnings use the existing optional `message` string?
   - Recommendation: use `message` for the first slice if that avoids schema churn, but update init/upgrade success output to print configured-result messages. Add `warnings` later only if multiple partial-success warnings become common.
2. Should a skipped generated skill mark the harness as configured?
   - Recommendation: yes, if hooks/config were written successfully. The generated skill is a convenience layer, not the entire integration.
3. Should the guard also protect `~/.claude/skills/memory-lane` symlinks?
   - Resolved in this spec: yes. Apply the same helper to both Claude and Codex generated skill writes.

## Out-of-scope follow-ups

- Broader read-only CLI taxonomy for `recall`, `list`, and version-like commands.
- Replacing the short generated skill template with the full repository skill document.
- Adding generated-file provenance markers and migration logic.
- Manifest format changes for owned skill destinations.
- Automatic symlink repair or deletion.
