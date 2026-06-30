# SessionStart Descriptor Index Release/Dogfood Validation

## Scope

Validate SessionStart descriptor index Slice A after PR #71 merged and was released as `v0.2.39`.

Slice A goals under validation:

- SessionStart should become a compact index rather than a full-body memory dump.
- Output must stay under configured SessionStart char budget.
- Descriptor cards must include stable ids plus fetch-by-id guidance.
- `policy-only` and `off` modes must not inject memory bodies or descriptors.
- Full details must remain available through explicit `memory-lane show <id>` / `memory_get`.

## Release

- Tag: `v0.2.39`
- Commit: `9021435 docs: sync post-pr-71 status`
- Release workflow: `28410566489`
- Result: passed.
- Assets published: `install.sh`, `install.ps1`, `SHA256SUMS`, and macOS/Linux/Windows binaries.

Local pre-release verification on `main` passed:

```bash
pnpm build
pnpm test
git diff --check
```

Installed upgrade passed:

```bash
memory-lane upgrade --yes
```

The installer downloaded `memory-lane-darwin-arm64.tar.gz`, verified checksum, installed to `/Users/shiang/.local/bin/memory-lane`, and reconfigured Pi from the upgrade manifest.

## Installed real-project SessionStart smoke

Command shape:

```bash
printf '%s' '{"hook_event_name":"SessionStart","session_id":"dogfood-session-start-descriptor","cwd":"/Users/shiang/projects/ribbons-digital/memory-lane"}' \
  | memory-lane codex session-start
```

Observed metrics from `hookSpecificOutput.additionalContext`:

- chars: `1494`
- configured `contextPolicySessionStartMaxChars`: `1600`
- `## Memory Index`: present
- `## Always-on Memory`: present
- `## Relevant Memory`: absent
- descriptor cards: `2`
- full-body bullets: `2`
- fetch guidance: present (`memory_get <id>` and `memory-lane show <id>`)

Observed shape:

- Continuity notice rendered first.
- Two small current-project preferences rendered in `## Always-on Memory`.
- Descriptor cards rendered in `## Memory Index`, including ids such as `33428846` and `56d78d21`.
- No old `## Relevant Memory` full-body baseline section appeared.

Assessment: passes the real-project smoke. The operating-agreement notice and two always-on preferences consume much of the 1600-char budget, so the real project produced only two descriptor cards. This is still within Slice A's expected prioritization and demonstrates the new index shape without exceeding budget.

## Installed breadth fixture smoke

An isolated temp memory/config fixture set `maxChars.sessionStart = 3000` and `maxItems.sessionStart = 1`, then saved eight approved project checkpoint-like memories.

Observed metrics:

- chars: `1302`
- descriptor cards: `8`
- `## Memory Index`: present
- `## Relevant Memory`: absent
- `## Always-on Memory`: absent

Assessment: passes the descriptor-breadth benchmark. The descriptor index can surface more than the old body-oriented 4-item cap while staying compact and avoiding full-body dumping.

## Policy-mode smokes

Isolated temp config with `memory.contextPolicy.mode = "policy-only"`:

- emitted continuity/policy guidance;
- did not emit `## Memory Index`;
- did not emit `## Always-on Memory`.

Isolated temp config with `memory.contextPolicy.mode = "off"`:

- emitted `{}` with no additional context.

Assessment: passes policy-mode safety checks.

## Fetch-loop smoke

Descriptor id from the real-project SessionStart output:

```bash
memory-lane show 56d78d21 --json
```

Result:

- returned memory id `56d78d21`;
- returned full text with `465` chars;
- confirmed descriptor ids can be used to fetch full details on demand.

## Benchmark result

Satisfactory for Slice A:

- release and installed upgrade succeeded;
- installed SessionStart output is bounded and uses the new descriptor/index sections;
- real-project output stayed under `1600` chars;
- isolated fixture proved descriptor breadth beyond the old 4-body cap;
- policy modes prevented descriptor/body leakage;
- fetch-by-id loop works.

## Caveats / follow-up decisions

- Real-project descriptor count is currently small under the default `1600` char budget because continuity notice plus always-on preferences consume most of the budget. This is acceptable for Slice A but should be considered when deciding whether Slice D token/char policy refinement is needed.
- Descriptor previews are generated from memory text in Slice A. If dogfooding finds them too vague, proceed to Slice B structured descriptor metadata.
- No fresh UI harness session was manually inspected in Codex Desktop/Claude Desktop/Pi. Terminal hook-level validation confirms the lifecycle payload shape consumed by hooks.
