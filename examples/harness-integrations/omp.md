# Memory Lane Integration for OMP (Oh My Pi)

## Recommended setup: run `memory-lane init`

The easiest way to configure OMP is to run:

```bash
memory-lane init --only omp
```

Use `memory-lane init --yes` if you want Memory Lane to configure every detected harness, including OMP.
OMP is detected when its resolved agent directory exists or when the `omp` command is available.

By default, init writes the Memory Lane extension to:

```text
~/.omp/agent/extensions/memory-lane/index.ts
```

If `PI_CODING_AGENT_DIR` is set to an absolute path, init writes to that agent directory instead:

```bash
PI_CODING_AGENT_DIR=/absolute/path/to/agent memory-lane init --only omp
```

OMP and pi are separate integrations.
Installing or removing OMP does not remove the pi extension.

## Named profiles

Memory Lane does not auto-discover named OMP profiles because their active agent directory cannot be derived safely outside OMP.
For a named profile, set `PI_CODING_AGENT_DIR` to that profile's agent directory before running init, or add the installed extension path to that profile's `extensions:` list manually.

## Maintenance

After init records OMP in `~/.memory-lane/install.json`, doctor, upgrade, and uninstall use the manifest-recorded extension path instead of re-resolving the current environment.
This keeps upgrades stable if `PI_CODING_AGENT_DIR` is later unset or changed.

Upgrade the binary and reapply recorded integrations with:

```bash
memory-lane upgrade --yes
```

Remove only OMP while preserving pi, the Memory Lane binary, memory data, unrelated OMP extensions, and OMP configuration with:

```bash
memory-lane uninstall --only omp --yes
```

Unsafe manifest-recorded OMP paths make doctor report a warning without inspecting a default path.
Doctor also reports the pinned OMP lifecycle contract's tested version, test date, and aggregate pass status.
Malformed or unsafe manifest paths stop upgrade or uninstall instead of falling back to a default path.

## Local checkout development

The source-checkout workflow is verified with the compiled OMP `17.1.0` macOS arm64 release.
Build the checkout and run its CLI entrypoint so init records `packages/cli/dist/index.js` and generates the OMP-specific bridge:

```bash
cd /absolute/path/to/memory-lane
pnpm build
chmod +x packages/cli/dist/index.js
MEMORY_LANE_INSTALL_BINARY="$PWD/packages/cli/dist/index.js" \
  node packages/cli/dist/index.js init --only omp --yes
```

Confirm the local OMP binary reports `omp/17.1.0`, then start it from the project you want to use.
After rebuilding Memory Lane, exit and restart OMP because `/reload-plugins` does not reload an already loaded extension module.
Use `omp --continue` from the same project to resume after the restart.
Do not replace the generated OMP bridge with a shim that imports `packages/pi-adapter/dist/index.js`.
Compiled OMP uses the bridge to launch the JavaScript CLI through Node, so `node` must be available on OMP's `PATH`.

See [OMP: install and restart a local checkout](../../docs/development.md#omp-install-and-restart-a-local-checkout) for the exact verified build, init, load, and restart commands.
The adjacent development-docs section records the OMP-only APIs that Memory Lane intentionally does not use.
