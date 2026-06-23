# Phase 21 Slice 6b — Desktop Continuity Routing Validation

## Status

Validation-only slice in progress. No runtime behavior changes.

## Purpose

Validate how desktop/CLI clients route natural continuity prompts after `v0.2.22`, especially whether they choose Memory Lane continuity surfaces for prompts such as:

```text
what were we last working on?
```

This slice follows Phase 21 Slice 6a, which added read-only `workstreamDiscovery` to existing continuity surfaces.

## Non-goals

- No code changes.
- No new CLI commands or MCP tools.
- No lifecycle injection changes.
- No retrieval/ranking changes.
- No auto-approval, cleanup, or mutation behavior.
- No claim that CLI behavior exactly matches Desktop behavior.

## User-reported desktop observation

User tested the same prompt in Claude Desktop and Codex Desktop. Both apps had Memory Lane MCP configured, but the screenshot evidence for Codex Desktop shows shell/CLI command execution rather than direct MCP tool-call names:

```text
what were we last working on?
```

Observed behavior:

- Claude Desktop did not use Memory Lane MCP; it inspected git history only.
- Codex Desktop used Memory Lane-style inspection through visible shell/CLI commands. Screenshot evidence showed commands including:
  - read Memory Lane skill guidance
  - `memory-lane continuity --json`
  - `memory-lane status --json`
  - `memory-lane continuity --query "what were we last working on" --json`
  - `memory-lane recall "current progress"`
  - `memory-lane review --json`
  - git log/status checks
- Codex Desktop also reported sandbox friction: Memory Lane's home-directory write check was blocked and it reran read-only continuity commands with approval.

Approved Memory Lane checkpoint for this observation: `dc60aa12`. The source screenshot was provided in-session from a temporary pi clipboard path and is not committed to this repository.

## CLI eval environment

Repository:

```text
/Users/shiang/projects/ribbons-digital/memory-lane
```

Validation worktree:

```text
/Users/shiang/.config/superpowers/worktrees/memory-lane/phase-21-desktop-routing-validation
```

Baseline setup:

```bash
sfw pnpm install
pnpm build
```

Result: build passed.

MCP config used for Claude CLI evals. This points at a local build from the validation worktree, not a downloaded release artifact:

```json
{
  "mcpServers": {
    "memory-lane": {
      "command": "node",
      "args": [
        "/Users/shiang/.config/superpowers/worktrees/memory-lane/phase-21-desktop-routing-validation/packages/mcp-server/dist/index.js"
      ],
      "cwd": "/Users/shiang/projects/ribbons-digital/memory-lane"
    }
  }
}
```

Claude CLI version path:

```text
/Users/shiang/.npm-global/bin/claude
```

Codex CLI versions observed:

```text
/opt/homebrew/bin/codex -> codex-cli 0.42.0
/Applications/Codex.app/Contents/Resources/codex -> codex-cli 0.142.0-alpha.6
```

The Homebrew CLI remained on `0.42.0` after the user upgraded Codex Desktop. The app-bundled CLI was needed for `gpt-5.5`.

Codex MCP config included a global `memory-lane` server pointing at:

```text
/Users/shiang/projects/ribbons-digital/memory-lane/packages/mcp-server/dist/index.js
```

## Eval prompts and results

Each CLI prompt below was run once. Treat these as routing observations, not deterministic model behavior. The Claude CLI evals also used a restricted `--allowedTools` set containing Memory Lane MCP tools plus selected git commands, so they do not exactly reproduce Claude Desktop's broader tool/context environment.

### Claude CLI / Opus 4.8 — broad continuity prompt

Command shape:

```bash
claude --verbose \
  --model claude-opus-4-8 \
  --mcp-config /tmp/memory-lane-mcp-eval.json \
  --allowedTools 'mcp__memory-lane__memory_continuity,mcp__memory-lane__memory_status,mcp__memory-lane__memory_recall,mcp__memory-lane__memory_review,Bash(git status:*),Bash(git log:*)' \
  --output-format stream-json \
  -p 'what were we last working on?'
```

Observed tool calls:

1. `mcp__memory-lane__memory_continuity({ projectPath: "/Users/shiang/projects/ribbons-digital/memory-lane" })`
2. `Bash(git log --oneline -8 && git status)`

Finding:

- Claude CLI with Opus 4.8 chose Memory Lane continuity for this single broad continuity prompt under a restricted tool set.
- This suggests the Claude Desktop miss is not caused by Memory Lane MCP being unusable or the `memory_continuity` description being completely ineffective in Claude-family models.
- Because the CLI run constrained available tools and differs from Desktop, the remaining difference may be Desktop-specific routing, broader tool/context availability, permissions, projectPath/cwd availability, or tool-choice heuristics.

### Claude CLI / Opus 4.8 — pending review prompt

Prompt:

```text
what pending memories need review?
```

Observed tool call:

```text
mcp__memory-lane__memory_review({ projectPath: "/Users/shiang/projects/ribbons-digital/memory-lane" })
```

Finding:

- Claude CLI selected the authoritative review surface correctly.

### Claude CLI / Opus 4.8 — preference prompt

Prompt:

```text
what package manager do I prefer?
```

Observed tool call:

```text
mcp__memory-lane__memory_recall({ query: "package manager preference" })
```

Finding:

- Claude CLI selected recall rather than continuity, which is the expected distinction for preference lookup.

### Claude CLI / Opus 4.8 — implementation-location prompt

Prompt:

```text
where was workstream discovery implemented?
```

Observed behavior:

- Claude CLI used repository/code inspection (`Grep`) instead of Memory Lane continuity.

Finding:

- This is ambiguous rather than clearly wrong: “where was X implemented?” can mean code location, not continuity provenance.
- If the desired answer is PR/branch/history provenance, prompt wording may need to say “what happened with” or “where did the work land.”

### Claude CLI / Opus 4.8 — PR history prompt

Prompt:

```text
what happened with PR #40?
```

Observed behavior:

- Claude CLI requested `gh pr view 40` rather than using Memory Lane continuity.

Finding:

- For PR-specific prompts, Claude CLI may prefer live GitHub/git tools over Memory Lane if available.
- This may be acceptable because Memory Lane pointers are not authoritative final answers; however, when GitHub is unavailable or disallowed, `memory_continuity({ query })` should be a useful fallback.

### Codex CLI / gpt-5.5 via app-bundled CLI

Homebrew `codex-cli 0.42.0` could not run `gpt-5.5`:

```text
unexpected status 400 Bad Request: {"detail":"The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}
```

After the user upgraded Codex Desktop, the app-bundled CLI was available at `/Applications/Codex.app/Contents/Resources/codex` with version `0.142.0-alpha.6`. Command shape:

```bash
/Applications/Codex.app/Contents/Resources/codex exec --experimental-json \
  --model gpt-5.5 \
  --sandbox read-only \
  -C /Users/shiang/projects/ribbons-digital/memory-lane \
  'what were we last working on?'
```

Observed behavior:

1. Read `skills/memory-lane/SKILL.md` from the repository.
2. Tried `RTK.md`; file did not exist.
3. Ran shell/CLI commands rather than direct MCP tool calls:
   - `memory-lane status --json`
   - `memory-lane continuity --query "what were we last working on" --json`
   - `memory-lane dashboard`
4. All three Memory Lane CLI commands failed in read-only sandbox due the home-directory writability probe:

```text
Error: EPERM: operation not permitted, open '/Users/shiang/.memory-lane/.write-test-...'
```

5. Fell back to `ROADMAP.md`, `HANDOFF.md`, grep, `git log`, `git status`, and `git show`.
6. Final answer correctly identified Phase 21 Slice 6a / workstream discovery as the last major work, but it got there after Memory Lane CLI failures and repo fallback.

Finding:

- Codex `gpt-5.5` chose Memory Lane-style continuity inspection, but through shell/CLI commands, not direct MCP tool calls.
- The read-only sandbox failure is reproducible and confirms the user-reported friction: read-only commands still perform a home-directory write probe before reading.
- The local skill file also contains inconsistent guidance near the top: “User asks \"what were we working on?\" → use `memory_recall` with that query,” while later sections say continuity is canonical. Codex read the skill first, so this inconsistency may affect routing and should be fixed in a docs/skill hardening follow-up.

## Preliminary diagnosis

1. **Claude Desktop miss is likely client/tool-routing-specific, but this remains a hypothesis.**
   Claude CLI with the same Memory Lane MCP server, Opus 4.8, and a restricted tool set used `memory_continuity` for the broad continuity prompt.

2. **Tool descriptions appear usable in at least one Claude CLI setup, but the evidence is single-run and tool-constrained.**
   Claude CLI distinguished continuity, review, and preference prompts in this eval. It did not use Memory Lane for code-location or PR-history prompts when repo/GitHub-style tools were available.

3. **Prompt ambiguity matters.**
   “Where was X implemented?” may mean code location. “What happened with X?” or “resume X” more clearly signals continuity.

4. **Desktop clients need explicit projectPath/cwd validation.**
   This is a hypothesis for follow-up testing. Claude Desktop often has no project cwd. If it does not pass `projectPath`, Memory Lane can return `projectScope: none`, which may make the model prefer git or other context when available.

5. **Codex Desktop/CLI behavior is closer to desired routing, but uses shell/CLI and exposes read-only friction.**
   The screenshot and app-bundled Codex CLI eval both show Memory Lane-style CLI inspection rather than direct MCP tool calls. That is useful but noisy, and the CLI eval confirms sandbox write-check friction on read-only Memory Lane commands.

6. **Skill guidance has an internal inconsistency.**
   The top-level “When to Use” section still says “User asks \"what were we working on?\" → use `memory_recall` with that query,” while later continuity guidance says to use `memory-lane continuity --query` / MCP `memory_continuity`. This should be fixed before relying on skill-based routing in Codex.

## Recommended next actions

For validation-only Slice 6b:

1. Reproduce Claude Desktop with an explicit instruction that says: for “what were we last working on?”, call `memory_continuity({ projectPath })` before git.
2. Reproduce Claude Desktop with and without a projectPath/cwd-bearing MCP setup if possible.
3. Update Memory Lane skill guidance so broad continuity prompts consistently point to continuity, not recall.
4. Capture whether Codex Desktop can be made to use MCP tools directly or whether its preferred path is shell/CLI commands; current screenshot and app-bundled CLI eval both show CLI-style commands.
5. File a follow-up hardening slice for read-only command sandbox friction: `status`, `continuity`, and `dashboard` should not fail merely because the default home storage path cannot accept a write-test file when the operation is read-only.
6. Consider documenting that Homebrew Codex and app-bundled Codex can have different versions; `gpt-5.5` required the app-bundled CLI in this environment.

## Verdict

Proceed with validation, not runtime changes yet.

The strongest current evidence is that Memory Lane MCP and Claude-family models can route a broad continuity prompt to `memory_continuity` in Claude CLI when the same MCP server is available and the tool set is restricted, while the user-reported Claude Desktop run did not. This points toward desktop client configuration/instructions/tool heuristics as a likely area to validate next, but it does not rule out broader tool-surface effects or projectPath/cwd differences.
