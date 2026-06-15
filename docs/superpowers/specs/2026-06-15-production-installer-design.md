# Production Installer & First-Run Onboarding Design

**Date:** 2026-06-15  
**Status:** Design approved — pending implementation plan  
**Related:** `docs/superpowers/specs/2026-05-26-codex-hook-adapter-design.md`

## Goal

Make Memory Lane installable and configurable by first-time users with a single command and a short interactive wizard, suitable for open-source distribution. Remove the current requirement to clone the repo, install pnpm dependencies, build from source, and manually paste hook/MCP JSON.

## Non-Goals

- Replace the existing source-based development workflow.
- Support package managers (npm/Homebrew) in the first version.
- Add telemetry, account creation, or cloud storage.

## Constraints

- Must work without Node.js, pnpm, or build tools installed on the user's machine.
- Must support uninstallation with one command.
- Must not require `sudo` for typical installations.
- Must keep existing `memory-lane` CLI interface backward-compatible.

## Decision: Distribution Model

Use a **shell installer + standalone binary** model.

```bash
curl -fsSL https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh | sh
```

The installer downloads a prebuilt binary from GitHub Releases, verifies its checksum, places it on the user's PATH, and creates the data directory. It does **not** run `memory-lane init`; instead it prints:

```
Next: Run 'memory-lane init' to get started.
      Or 'memory-lane init --yes' to auto-configure detected harnesses.
```

This separates installation from configuration and matches the pattern used by tools like Claude Code. Users then run `memory-lane init` when they are ready to wire up harnesses.

We chose this over npm/global install because it avoids forcing a Node toolchain on end users and gives us full control over the installation layout.

## Decision: Binary Build Tool

Use **Bun `--compile`** to produce the standalone binary. Memory Lane has no native modules, dynamic `require()`, deep Node internals, or browser engines, so Bun's bundler can package the entire monorepo into a single file with minimal risk.

If we later add native dependencies, we will re-evaluate `tsup` + Node SEA.

## Architecture Components

| Component | Responsibility |
|---|---|
| `install.sh` | Platform/arch detection, download, checksum verification, binary placement, PATH update, data directory creation, install manifest write. |
| `memory-lane init` | Interactive first-run wizard. Detects harnesses, asks user which to enable, writes config files, installs pi extension. |
| `memory-lane uninstall` | Reads install manifest, removes binary, reverts hook/MCP/pi configs, optionally deletes data. |
| `memory-lane mcp` | Single stdio MCP server entrypoint used by Claude/Codex Desktop configs. |
| GitHub Releases | Publishes prebuilt binaries + checksums for macOS (arm64/x64), Linux (arm64/x64), and Windows (x64). |

## User Journey

### Installation

```bash
curl -fsSL https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh | sh
```

The installer downloads the binary, verifies its checksum, places it on PATH, and prints a prompt to run `memory-lane init`.

### First-Run Wizard

1. **Welcome** — one-line explanation of Memory Lane.
2. **Storage setup** — confirm default `~/.memory-lane/` location or override.
3. **Integration menu** — detected harnesses shown with checkboxes; undetected ones grayed out with install-guide links.
4. **Per-integration setup** — wizard writes the required config for each selected harness.
5. **Project scope (optional)** — offer to run project-local initialization in the current directory.
6. **Summary** — list configured files and a "try it" command.

### Uninstallation

```bash
memory-lane uninstall
```

Prompts:
- Remove hook/MCP/pi configs? `[Y/n]`
- Remove memory data? `[y/N]` (default no)

Then removes only what the installer/manifest recorded.

## Installer Script Details

### Platform Detection

```bash
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
```

Supported matrix:

| OS | Arch | Asset name |
|---|---|---|
| Darwin | arm64 | `memory-lane-darwin-arm64.tar.gz` |
| Darwin | x86_64 | `memory-lane-darwin-x64.tar.gz` |
| Linux | aarch64 | `memory-lane-linux-arm64.tar.gz` |
| Linux | x86_64 | `memory-lane-linux-x64.tar.gz` |

Windows is supported via a separate PowerShell installer (`install.ps1`) that downloads the `memory-lane-windows-x64.zip` asset and places it in a user-local directory on PATH.

### Binary Placement

Primary target: `~/.local/bin/memory-lane`

If `~/.local/bin` does not exist, create it. If it is not writable, fall back to `~/.memory-lane/bin/memory-lane` and add that directory to the user's shell PATH.

### PATH Update

The installer appends a single line to the detected shell configuration file:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Detected shells: `zsh`, `bash`, `fish`. The installer updates only the primary shell's config and avoids duplicate entries.

### Install Manifest

After installation, write `~/.memory-lane/install.json`:

```json
{
  "version": "0.1.0",
  "installedAt": "2026-06-15T...",
  "binaryPath": "/Users/me/.local/bin/memory-lane",
  "dataDir": "/Users/me/.memory-lane",
  "shellConfig": "/Users/me/.zshrc",
  "integrations": []
}
```

The wizard later appends each configured integration to `integrations`.

## Wizard Implementation

### Harness Detection

| Harness | Detection Method |
|---|---|
| Claude Code CLI | `claude` command exists on PATH |
| Codex CLI | `codex` command exists on PATH |
| Claude Desktop | `~/Library/Application Support/Claude/settings.json` or `~/.config/claude/settings.json` exists |
| Codex Desktop | `~/.codex/config.toml` exists or Codex app bundle exists in `/Applications` |
| pi | `~/.pi/agent` directory exists |

### Hook Config Auto-Generation

For Claude Code CLI and Codex CLI, the wizard writes the full hook JSON to the appropriate settings file, using the absolute path to the installed `memory-lane` binary. Example for Claude Code:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/me/.local/bin/memory-lane claude session-start",
            "timeout": 10,
            "statusMessage": "Loading baseline memory"
          }
        ]
      }
    ],
    "UserPromptSubmit": [...],
    "Stop": [...],
    "PostToolUse": [...]
  }
}
```

If the settings file already exists, the wizard merges Memory Lane's hooks into it without overwriting unrelated settings.

### MCP Desktop Config

For Claude Desktop and Codex Desktop, the wizard writes an MCP server entry that points at the same binary:

```json
{
  "mcpServers": {
    "memory-lane": {
      "command": "/Users/me/.local/bin/memory-lane",
      "args": ["mcp"]
    }
  }
}
```

### pi Extension

For pi, the wizard writes `~/.pi/agent/extensions/memory-lane/index.ts` that dynamically imports the bundled pi adapter from the binary. Because the binary bundles all adapters, the extension can use the absolute binary path with a `file://` URL and a cache-busting query string.

## Uninstall Command

`memory-lane uninstall` performs the following:

1. Read `~/.memory-lane/install.json`.
2. Ask whether to remove configured integrations (default yes).
3. Ask whether to remove memory data (default no).
4. Reverse each integration:
   - Remove Memory Lane hooks from `.claude/settings.local.json` and `.codex/settings.local.json`.
   - Remove the `memory-lane` MCP server entry from Claude/Codex Desktop configs.
   - Remove `~/.pi/agent/extensions/memory-lane/`.
5. Remove the binary at the recorded `binaryPath`.
6. Optionally remove the data directory at the recorded `dataDir`.
7. Print a summary of what was removed.

## Release Workflow

1. Maintainer tags a release: `git tag v0.1.0 && git push origin v0.1.0`.
2. CI runs the full test suite.
3. CI builds binaries for all supported platforms using `bun build --compile`.
4. CI packages each binary into a `.tar.gz` and computes SHA-256 checksums.
5. CI creates a GitHub Release and uploads assets + `SHA256SUMS`.
6. The `install.sh` script hosted at `https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh` fetches the `latest` release by default, or a specific `VERSION` if set.

## Testing Strategy

- **Unit tests** for wizard logic using a temporary `$HOME` and mocked PATH.
- **CI smoke test** that runs `install.sh` in a clean container and asserts `memory-lane --version` works.
- **CI config test** that runs `memory-lane init --yes` in a fixture home and verifies expected config files are created.
- **Uninstall test** that installs, runs `memory-lane uninstall`, and verifies the manifest and binary are gone while data remains by default.
- **Checksum verification test** that ensures every release asset has a matching checksum.

## Security Considerations

- `install.sh` must verify the downloaded binary against the published SHA-256 checksum before execution.
- The installer must never run with elevated privileges; if `~/.local/bin` is not writable, it falls back to a user-owned directory.
- Hook and MCP configs use absolute paths to the binary so injected commands cannot be hijacked by a malicious PATH.

## Open Questions — Resolved

1. **`memory-lane init` should support `--yes`**: Yes. In `--yes` mode the wizard auto-selects all detected integrations, accepts defaults, and does not prompt. This is required for CI and automated testing.
2. **Prompt before overwriting existing configs**: Yes. If a target settings file already contains Memory Lane hooks or an MCP server entry, the wizard shows a diff summary and asks for confirmation before modifying it.
3. **Windows support**: Yes. Complexity is moderate: we need a PowerShell installer (`install.ps1`), Windows-specific config paths, and a CI build target. It does not change the core architecture. We will ship `install.ps1` alongside `install.sh` and add a Windows x64 binary to the release matrix.

## Approval

This design is approved by project owner. Next step is to write an implementation plan.
