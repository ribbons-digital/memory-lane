# Phase 21 Slice 6d — Post-6c Read-only Continuity Dogfood Validation

## Status

Validation-only slice. Runtime behavior changes landed previously in PR #42 / Slice 6c.

## Purpose

Validate the evidence-backed Slice 6c fix after merge and release:

- `memory-lane status --json`
- `memory-lane continuity --query "what were we last working on?" --json`
- `memory-lane dashboard --json`

These read-only commands should work in unwritable-home / read-only-sandbox-like conditions without hitting the prior `.write-test-*` EPERM path.

## Non-goals

- No new runtime code changes.
- No new CLI commands or MCP tools.
- No direct-MCP requirement for Codex; CLI-based continuity remains acceptable.
- No retrieval rewrite, lifecycle injection, raw transcript indexing, persisted workstream ids/schema, or mutation behavior.
- No claim that single CLI runs deterministically predict all Desktop behavior.

## Environment

Repository main after PR #42:

```text
/Users/shiang/projects/ribbons-digital/memory-lane
main commit: 062c8c8 fix: harden read-only continuity CLI commands (#42)
```

Validation worktree:

```text
/Users/shiang/.config/superpowers/worktrees/memory-lane/phase-21-post-6c-dogfood-validation
branch: docs/phase-21-post-6c-dogfood-validation
base: origin/main at 062c8c8
```

Setup:

```bash
sfw pnpm install
pnpm build
```

Result: build passed.

## Release

Because the first Codex exec dogfood used the installed `memory-lane` binary from PATH rather than the local build, the merged fix had to be released and installed before end-user-style dogfooding could validate it.

Release performed from clean `main`:

```bash
git tag v0.2.23
git push origin v0.2.23
gh run watch 27995237667 --exit-status
```

Release workflow result:

```text
v0.2.23 Release · 27995237667 · success
```

Published assets verified with `gh release view v0.2.23`:

```text
install.ps1
install.sh
memory-lane-darwin-arm64.tar.gz
memory-lane-darwin-x64.tar.gz
memory-lane-linux-arm64.tar.gz
memory-lane-linux-x64.tar.gz
memory-lane-windows-x64.exe.zip
SHA256SUMS
```

Approved release checkpoint memory: `9df18e21`.

## Direct local-build read-only smoke

A temporary fixture created:

- temp `HOME`
- temp project with `.memory-lane-scope`
- home storage at `$HOME/.memory-lane`
- one approved project checkpoint
- `chmod 555 $HOME/.memory-lane`
- no `MEMORY_LANE_FILE`, `MEMORY_LANE_EMBEDDINGS_FILE`, or `MEMORY_LANE_CONFIG` env overrides

The smoke invoked the local build:

```bash
node packages/cli/dist/index.js status --json
node packages/cli/dist/index.js continuity --query "what were we last working on?" --json
node packages/cli/dist/index.js dashboard --json
```

Observed output:

```json
{"command":"status","status":0,"ok":true,"containsWriteProbeError":false,"stdoutSummary":"json-ok","stderr":""}
{"command":"continuity","status":0,"ok":true,"containsWriteProbeError":false,"stdoutSummary":"json-ok","stderr":""}
{"command":"dashboard","status":0,"ok":true,"containsWriteProbeError":false,"stdoutSummary":"json-ok","stderr":""}
```

Finding: local merged build satisfies the Slice 6c acceptance behavior.

## Codex exec before release/install

Command shape:

```bash
/Applications/Codex.app/Contents/Resources/codex exec \
  --ephemeral \
  --sandbox read-only \
  --json \
  -m gpt-5.5 \
  -C /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-21-post-6c-dogfood-validation \
  'Validation prompt for Memory Lane: what were we last working on? Please inspect Memory Lane continuity if available. Use read-only commands only; do not edit files.'
```

Observed behavior:

- Codex inspected repo docs/git state and identified the post-6c dogfood validation branch.
- It reported that installed CLI commands still hit the old `.write-test-*` EPERM path.
- This was expected after diagnosis because the installed binary had not yet been upgraded to a release containing PR #42.

Finding: local build was fixed, but end-user-style Codex needed a released/upgraded binary before the fix could be validated through PATH.

## Installed-binary smoke after v0.2.23 upgrade

Upgrade command:

```bash
memory-lane upgrade --yes
```

Then the same unwritable-home fixture was tested through the installed `memory-lane` command:

```bash
memory-lane status --json
memory-lane continuity --query "what were we last working on?" --json
memory-lane dashboard --json
```

Observed output:

```text
PASS status
PASS continuity
PASS dashboard
```

The smoke harness marked each command as `PASS` only if the command exited 0 and combined stdout/stderr did not match `write-test|EPERM`.

Finding: the released/installed `v0.2.23` binary satisfies the Slice 6c read-only command behavior in this fixture.

## Codex exec after v0.2.23 upgrade

Command shape:

```bash
/Applications/Codex.app/Contents/Resources/codex exec \
  --ephemeral \
  --sandbox read-only \
  --json \
  -m gpt-5.5 \
  -C /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-21-post-6c-dogfood-validation \
  'Validation prompt for Memory Lane after v0.2.23 upgrade: what were we last working on? Please inspect Memory Lane continuity if available. Use read-only commands only; do not edit files.'
```

Observed behavior:

- Codex read `skills/memory-lane/SKILL.md` from the validation worktree and saw the corrected continuity-first guidance. The later skill-overwrite caveat affected the main checkout where `memory-lane upgrade --yes` was run, not this validation worktree.
- Codex ran the canonical command:

```bash
/Users/shiang/.local/bin/memory-lane continuity --query "what were we last working on?" --json --project "$PWD"
```

- The command exited successfully and returned `ok: true`.
- No `.write-test-*` or EPERM failure occurred on that continuity path.
- Final answer identified the latest continuity state as `v0.2.23` / PR #42 and the current dogfood validation branch.

Finding: in this single post-upgrade run, Codex reached Memory Lane continuity through CLI in read-only sandbox mode without the prior Slice 6b friction. This supports the decision that correct CLI-based Memory Lane behavior is acceptable even without direct MCP use.

## Claude CLI MCP routing check

MCP config used installed `memory-lane mcp`:

```json
{
  "mcpServers": {
    "memory-lane": {
      "command": "memory-lane",
      "args": ["mcp"],
      "cwd": "/Users/shiang/projects/ribbons-digital/memory-lane"
    }
  }
}
```

Command shape:

```bash
claude --verbose \
  --model claude-opus-4-8 \
  --mcp-config /tmp/memory-lane-slice6d-claude-mcp.json \
  --allowedTools 'mcp__memory-lane__memory_continuity,mcp__memory-lane__memory_status,mcp__memory-lane__memory_recall,mcp__memory-lane__memory_review,Bash(git status:*),Bash(git log:*)' \
  --output-format stream-json \
  -p 'what were we last working on?'
```

Observed behavior:

- MCP server connected.
- Claude first called:

```text
mcp__memory-lane__memory_continuity({ projectPath: "/Users/shiang/projects/ribbons-digital/memory-lane" })
```

- It then inspected git history/status and used recall for extra context.
- Final answer identified the latest work as `v0.2.23` / PR #42 and the continuity/workstream feature arc.

Finding: in this single run, Claude CLI + Opus 4.8 routed the broad continuity prompt to `memory_continuity` when the MCP tool was available.

## Caveats and follow-ups

### Installed skill overwrite caveat

Running `memory-lane upgrade --yes` from the main repository checkout caused local `skills/memory-lane/SKILL.md` in that checkout to be overwritten with a short installer skill template. This was not part of the validation branch and was immediately restored with:

```bash
git restore skills/memory-lane/SKILL.md
```

This is separate from the Slice 6c read-only command fix. It may be worth a future installer/configuration hardening slice: `init`/`upgrade` should avoid overwriting repository-local source skill files when run from the Memory Lane repo, or should distinguish installed user skill destinations from package source files.

### Remaining read-only breadth

Slice 6c intentionally hardened only `status`, `continuity`, and `dashboard`. Codex observed that broader commands such as `recall`, `list`, and version-like inspection can still encounter write-probe friction in a strict read-only sandbox. That is in-scope behavior for current Slice 6c boundaries, but it is useful evidence for a future read-only CLI taxonomy if the product wants more commands to work without writable storage.

### Codex sandbox subcommand profile

`codex sandbox` could not be used directly because this local Codex setup requires a named permissions profile and the obvious `read-only`/`default` attempts failed with:

```text
Error: default_permissions requires a `[permissions]` table
```

The Codex validation instead used `codex exec --sandbox read-only`, which is the same path used in Slice 6b.

## Verdict

**Slice 6c passes post-merge/release dogfood validation for its intended scope.**

Evidence:

- Local merged build read-only smoke passed for `status`, `continuity --query`, and `dashboard`.
- Release `v0.2.23` succeeded and published expected assets.
- Installed `v0.2.23` read-only smoke passed for the same three commands.
- Codex `gpt-5.5` in one read-only-mode run reached `memory-lane continuity --query` successfully after upgrade.
- Claude CLI + Opus 4.8 in one run routed the broad prompt to `memory_continuity` through MCP.

Recommended next item: **Phase 21 Slice 6e — installer/skill destination hardening design**, if we want to address the observed `memory-lane upgrade --yes` repository-local skill overwrite. This is a correctness/safety issue because it silently mutated a tracked source file. An alternative evidence-led follow-up would be a broader read-only CLI taxonomy for commands such as `recall` and `list`, but the scoped Slice 6c continuity friction is resolved for `status`, `continuity`, and `dashboard`. If neither follow-up is compelling now, continue to the next Phase 21 roadmap item.
