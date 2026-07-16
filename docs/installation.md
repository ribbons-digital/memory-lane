# Installation and maintenance

Deep reference for installing, upgrading, and uninstalling the Memory Lane binary and its harness integrations.
For the short version, see the [Quick Start](../README.md#quick-start).

## One-line installer (recommended)

macOS / Linux:

```bash
curl -fsSL https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.ps1 | iex
```

The installer downloads a prebuilt binary, verifies its SHA-256 checksum, and places it on your PATH.
On Windows, it also smoke-tests the installed executable and restores an existing binary if replacement or verification fails.
After installation, run `memory-lane init` to configure Claude Code, Codex, Claude Desktop, Codex Desktop, pi, and OMP (Oh My Pi).
Use `memory-lane init --yes` to auto-configure all detected harnesses without prompting, or `memory-lane init --only omp` to configure OMP explicitly.

If you are an end user, this installer plus `memory-lane init` path is the recommended setup.
If you are developing Memory Lane and also using it on the same machine, prefer the [development setup](./development.md#development-setup-local-checkout--manual-harness-config) so release-style init does not replace local shims or hand-edited harness config.

If you prefer to review the script first, save it and run locally:

```bash
curl -fsSL -o install.sh https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh
sh install.sh
```

```powershell
irm https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.ps1 -OutFile install.ps1
.\install.ps1
```

After installing, run `memory-lane init` again any time to reconfigure or add new integrations.
`init` records the running CLI version, binary path, data directory, and configured integrations in `~/.memory-lane/install.json` so future upgrades can refresh the manifest with the newly installed release version.
Re-running `init` preserves unrelated existing manifest integrations and updates only the integrations configured in that run.
If an existing install manifest is malformed or missing its integrations array, `init` stops instead of replacing it.
When `init` writes JSON harness configs, it preserves unrelated settings and hooks, replaces older Memory Lane hook entries, and creates a one-time `<config>.memory-lane.bak` backup before the first successful write.
If an existing JSON config is malformed, `init` leaves it untouched and reports the parse error instead of overwriting it.

OMP installs the same verified extension source used by pi at `~/.omp/agent/extensions/memory-lane/index.ts` by default.
If `PI_CODING_AGENT_DIR` is set, OMP installation uses `<PI_CODING_AGENT_DIR>/extensions/memory-lane/index.ts` instead.
Use an absolute `PI_CODING_AGENT_DIR`; environment values do not shell-expand `~`.
Pi and OMP remain independent and may be installed side by side.
Named OMP profiles are not auto-discovered because their active directory cannot be derived safely outside OMP.
For a named profile, set `PI_CODING_AGENT_DIR` to that profile's agent directory before running init, or add the installed extension path to that profile's `extensions:` list manually.

## Upgrading

Run the built-in upgrade command to download the latest binary and re-apply only the harness configs you already had installed:

```bash
memory-lane upgrade
```

Use `memory-lane upgrade --yes` to run non-interactively.
On macOS and Linux this re-runs the installer and then refreshes your existing configs.
On Windows, upgrade serializes maintenance for the installation, renames the running executable to a backup, installs and smoke-tests its replacement, and then reapplies every manifest-recorded harness configuration with the new binary.
The replacement and updated install manifest are committed only after every required reconfiguration succeeds.
Any installer, smoke-test, or reconfiguration failure restores the previous executable and install manifest.
After a successful commit, a detached recovery helper waits for the original process to exit before removing the backup and transaction artifacts.
An active upgrade blocks another upgrade from modifying the same installation; abandoned locks are reclaimed only after their recorded process identities are confirmed inactive.
`memory-lane init --yes` is only the fallback when no manifest exists.
When existing configs are refreshed, the install manifest version is updated to the version embedded in the new binary.
Upgrade treats the manifest `binaryPath` and each OMP integration `configPath` as durable installation facts.
Custom release directories are preserved, and a manifest-recorded OMP extension is refreshed at its recorded path even when `PI_CODING_AGENT_DIR` is later absent or changed.
Present but malformed or unsafe manifest paths stop upgrade instead of redirecting configuration to a default path.
Upgrade also refuses a manifest `dataDir` that does not match the active `~/.memory-lane` directory.

Your memory data in `~/.memory-lane/` is preserved.

You can also upgrade manually by re-running the installer and then `memory-lane init --yes`:

```bash
curl -fsSL https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh | sh
memory-lane init --yes
```

## Uninstalling OMP without removing Pi

Remove only the manifest-recorded OMP integration with:

```bash
memory-lane uninstall --only omp --yes
```

Selective OMP uninstall preserves Pi, other integrations, the Memory Lane binary, memory data, unrelated OMP extensions, and OMP configuration.
It uses the manifest-recorded OMP path and does not redirect to the current `PI_CODING_AGENT_DIR` or default root.
Malformed or unsafe manifest paths stop uninstall rather than falling back to a default path.

## Full uninstall

Run `memory-lane uninstall` to choose whether to remove all configured integrations and whether to remove memory data.
Memory data is preserved by default.
`memory-lane uninstall --yes` removes all manifest-recorded integrations and the installed binary without prompting, but still preserves memory data in `~/.memory-lane/`.
On Windows, full uninstall renames the running executable and schedules its deletion after the command exits; if the cleanup helper cannot start, the executable is restored and uninstall fails rather than reporting a removal that was not scheduled.
If deferred deletion cannot finish, the renamed executable and its recovery record are retained, and a later upgrade or full uninstall retries cleanup only after confirming the original process identity is inactive.
