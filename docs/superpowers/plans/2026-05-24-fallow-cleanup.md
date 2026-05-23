# Fallow Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Fallow issues while preserving memory-lane CLI, core, and pi-adapter behavior.

**Architecture:** Treat public APIs and workspace dependencies as intentional, not deletion candidates. Apply minimal cleanup for true unused code, add Fallow configuration for false positives, and reduce CLI complexity through behavior-preserving extraction of command handlers.

**Tech Stack:** TypeScript, Node test runner, pnpm workspace, Fallow.

---

## Completed Tasks

- [x] Removed unused test helper `writeJsonl` from `packages/core/test/helpers.ts`.
- [x] Added `.fallowrc.jsonc` to document and suppress the intentional `@memory-lane/core` workspace dependency false positive.
- [x] Added `fallow-ignore-file unused-class-member` to `packages/core/src/engine.ts` because `MemoryEngine` is a public API consumed by CLI, pi adapter, and package users.
- [x] Refactored `packages/cli/src/index.ts` to extract engine setup, command handlers, config subcommand handlers, and dispatch tables from `main()` while preserving CLI behavior.
- [x] Extracted duplicate semantic test config setup in `packages/core/test/retrieval.test.ts`.
- [x] Verified with build, tests, and Fallow.
