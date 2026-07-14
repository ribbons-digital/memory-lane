# Internal maintainer notes

This directory contains maintainer-only planning and agent-workflow scaffolding.
Nothing here is required reading for Memory Lane users or contributors, and contributor pull requests are not expected to update these files.

## Contents

- `HANDOFF.md` - compact current-state status card for maintainer sessions: recent merges, current decision, and next work.
- `ROADMAP.md` - active planning index: current status, next tracks, and roadmap maintenance rules.
- `CONTEXT.md` - parked analysis mapping Memory Lane against the "Distilling Feedback into Memory-as-a-Tool" loop (arXiv:2601.05960).
- `MEMORY_AS_TOOL_REVIEW.md` - parked companion review of the same paper.
- `subagents/` - archived review-agent output artifacts from past implementation slices.

## Related root-level tool configs

- `.coderabbit.yaml` stays at the repository root because CodeRabbit, which reviews every pull request in this repository, reads its configuration from the repository root of the PR branch.

## Status docs sync guardrail

When completing a Memory Lane milestone, merging a PR, cutting a release, or recommending the next work item, update status docs before calling the work complete.
Start with compact current-state sections in `internal/HANDOFF.md` and the relevant current roadmap section, then check `README.md`, `docs/`, and `skills/memory-lane/SKILL.md` only when their status, commands, or workflow guidance changed.
Do not rely only on Memory Lane checkpoint memories; future sessions and users must be able to recover current project state from the repository docs without reading archived chronology by default.
