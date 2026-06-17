# Contributing to Memory Lane

Thanks for helping improve Memory Lane.

## Contribution workflow

1. Fork or branch from `main`.
2. Make a focused change.
3. Run local verification when possible:
   ```bash
   pnpm test
   pnpm build
   ```
4. Open a pull request against `main`.
5. Wait for CI to pass and for repository-owner review/approval.

Direct pushes to `main` are restricted. Changes should land through pull requests.

## Review requirements

The repository uses GitHub CODEOWNERS and a `main` ruleset:

- all files are owned by `@ribbons-digital`;
- pull requests require at least one approving review;
- code-owner review is required;
- stale approvals are dismissed after new commits;
- review conversations must be resolved;
- CI must pass before merge.

## Project conventions

- Keep changes non-breaking unless the roadmap explicitly calls for a breaking change.
- Keep memory behavior low-noise and review-first by default.
- Do not commit secrets, raw transcripts, private memory stores, or generated local memory data.
- Keep `ROADMAP.md` and `HANDOFF.md` synced when changing project direction, release state, or implementation priorities.
- Use `pnpm` for package management.
