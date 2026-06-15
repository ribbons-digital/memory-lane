# Production Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Add a single-command installer, standalone binary, first-run wizard, and uninstall so first-time users can install and configure Memory Lane without building from source.

**Architecture:** Bun `--compile` produces one portable binary. New CLI commands: `memory-lane mcp`, `memory-lane init`, `memory-lane uninstall`. `install.sh` and `install.ps1` download the binary from GitHub Releases, verify checksums, place it on PATH, and run the wizard. `~/.memory-lane/install.json` tracks what was changed for clean uninstall.

**Tech Stack:** TypeScript, Bun compile, MCP stdio, shell/PowerShell, GitHub Actions.

---

## Task 1: Add `memory-lane mcp` command

**Files:**
- Create: `packages/cli/src/commands/mcp.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] Write failing test for `memory-lane mcp` command registration.
- [ ] Create `mcp.ts` that runs `@memory-lane/mcp-server` in stdio mode.
- [ ] Wire subcommand in `index.ts`.
- [ ] Run tests and commit.

## Task 2: Set up Bun compile for binaries

**Files:**
- Create: `scripts/build-binaries.ts`
- Modify: root `package.json`

- [ ] Add Bun dev dependency.
- [ ] Create build script that compiles for darwin-arm64, darwin-x64, linux-arm64, linux-x64, windows-x64.
- [ ] Add `build:binary` script to root `package.json`.
- [ ] Run local smoke and commit.

## Task 3: Implement `memory-lane init` wizard

**Files:**
- Create: `packages/cli/src/commands/init.ts`, `packages/cli/src/installer/detect.ts`, `packages/cli/src/installer/write-config.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/test/init.test.ts`

- [ ] Write failing tests for harness detection and config writing.
- [ ] Implement detection for Claude Code CLI, Codex CLI, Claude Desktop, Codex Desktop, pi.
- [ ] Implement config merging for hooks, MCP, and pi extension with overwrite prompts.
- [ ] Implement interactive menu and `--yes` non-interactive mode.
- [ ] Run tests and commit.

## Task 4: Implement `memory-lane uninstall` and installer scripts

**Files:**
- Create: `packages/cli/src/commands/uninstall.ts`, `packages/cli/test/uninstall.test.ts`, `install.sh`, `install.ps1`
- Modify: `packages/cli/src/index.ts`

- [ ] Write failing tests for uninstall manifest reading and config removal.
- [ ] Implement `uninstall` command.
- [ ] Write `install.sh` with platform detection, checksum verification, PATH update, and manifest creation.
- [ ] Write `install.ps1` for Windows x64.
- [ ] Run tests, manually smoke installers, and commit.

## Task 5: Add CI release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] Create workflow triggered on tags.
- [ ] Build binaries across platforms.
- [ ] Compute SHA256SUMS and create GitHub Release with assets.
- [ ] Commit.

## Verification

- `pnpm test` passes.
- `pnpm build:binary` produces a working single-file binary.
- `memory-lane init --yes` writes expected configs in a temp home.
- `memory-lane uninstall` removes configs while preserving data by default.
- `install.sh` runs in a clean container and installs successfully.
