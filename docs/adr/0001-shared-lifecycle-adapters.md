# Shared Lifecycle Adapters for Harness Integrations

Memory Lane will keep `@memory-lane/core` harness-neutral and introduce a shared lifecycle/policy layer that harness adapters map into. Codex hook support will be implemented as a Codex adapter exposed through the existing `memory-lane codex ...` CLI namespace, rather than embedding Codex-specific policy directly in the CLI or core. This preserves one memory policy across harnesses, keeps context-budget and autosave behavior consistent, and lets memory provenance use harness-neutral lifecycle terms instead of Codex-specific hook names.
