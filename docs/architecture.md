# Architecture

Eleven packages in a monorepo:

| Package | Purpose |
|---|---|
| `@memory-lane/core` | Pure Node.js library. Zero harness dependencies. |
| `@memory-lane/lifecycle` | Shared harness-neutral memory automation policy for recall, autosave, context budgets, and tool outcomes. |
| `@memory-lane/cli` | CLI wrapper. Works with any harness that can shell out. |
| `@memory-lane/mcp-server` | Local stdio MCP server exposing explicit Memory Lane tools. |
| `@memory-lane/obsidian-mirror` | Optional one-way JSONL → Obsidian Markdown mirror. |
| `@memory-lane/obsidian-import` | Standalone parser/planner for explicit Obsidian Markdown → JSONL imports. |
| `@memory-lane/plugin-api` | Lightweight plugin API for first-party and custom extensions. |
| `@memory-lane/plugin-obsidian-wiki` | Optional Obsidian/Garden knowledge-base search and read plugin. |
| `@memory-lane/claude-adapter` | Claude Code hook adapter exposed through `memory-lane claude ...`. |
| `@memory-lane/codex-adapter` | Codex hook adapter exposed through `memory-lane codex ...`. |
| `@memory-lane/pi-adapter` | pi extension adapter. |

## Memory lifecycle

```
user/agent → suggest() → pending  → approve() → approved
                                  → reject()  → rejected → approve() → approved
approved   → delete()            → deleted
approved   → replace()/supersede() → approved historical record with revision links
```

Compaction removes deleted + rejected tombstones and stale embeddings while preserving malformed or schema-invalid JSONL rows for diagnostics.
Trigger: `memory-lane compact` or startup auto-check (>30% dead weight + >100 valid records).

## Programmatic use

```typescript
import {
  MemoryEngine,
  createSingleStoreEngineStorage,
  createTwoTierEngineStorage,
  memoryDescriptorPreview,
  classifyWorkflowArea,
  resolveEngineStoragePaths,
  type MemoryEngineStorage,
} from "@memory-lane/core"
import { createLearningEventSink } from "@memory-lane/lifecycle"

const engine = new MemoryEngine({
  learningEventSink: createLearningEventSink({ configPath: process.env.MEMORY_LANE_CONFIG, env: process.env }),
})

// Existing memoryPath and embeddingsPath options build the legacy single-store facade.
const testEngine = new MemoryEngine({ memoryPath: "/tmp/memory.jsonl", embeddingsPath: "/tmp/embeddings.jsonl" })

// Advanced tests or integrations can inject a MemoryEngineStorage facade.
const storage: MemoryEngineStorage = createSingleStoreEngineStorage("/tmp/memory.jsonl", "/tmp/embeddings.jsonl")
const engineWithStorage = new MemoryEngine({ storage })

// Programmatic integrations that want CLI-style default two-tier storage should wire the resolver and facade explicitly.
const paths = resolveEngineStoragePaths({ cwd: process.cwd(), env: process.env })
if (paths.kind === "default-two-tier") {
  const tieredStorage = createTwoTierEngineStorage(paths.home, paths.project, paths.projectScopeKey, { producerVersion: "my-integration/1.0.0" })
  const tieredEngine = new MemoryEngine({ storage: tieredStorage, autoCompact: false, configPath: paths.configPath })

  // Review-first legacy project migration APIs mirror the CLI plan/apply flow.
  // They require the two-tier facade with an active project scope.
  const plan = tieredEngine.createLegacyProjectMigrationPlan()
  // Persist and review the plan before applying it with explicit user confirmation.
  const result = tieredEngine.applyLegacyProjectMigrationPlan(plan)
} else {
  const singleStoreStorage = createSingleStoreEngineStorage(paths.home.memoryPath, paths.home.embeddingsPath)
  const singleStoreEngine = new MemoryEngine({ storage: singleStoreStorage, autoCompact: false, configPath: paths.configPath })
}

// Save
engine.save({ text: "use pnpm for all installs", status: "approved" })
engine.save({
  text: "Use pnpm for package management in this repo.",
  status: "approved",
  descriptor: {
    description: "Package manager convention for this project.",
    fetchHint: "working on installs, scripts, or dependency changes",
    keywords: ["pnpm", "dependencies"],
  },
})
engine.suggest(
  "Use pnpm for package management in this repo.",
  "preference",
  "project",
  "preference",
  "pending",
  undefined,
  { description: "Package manager convention for this project." },
)

// Descriptor strings are trimmed and bounded; keywords are lowercased and
// deduplicated before enforcing the 12-keyword limit. Secret-looking
// descriptor fields are rejected. Use memoryDescriptorPreview() when rendering
// bounded continuity-style previews that should prefer safe descriptor text.
const firstMemory = engine.list()[0]
const descriptorPreview = firstMemory ? memoryDescriptorPreview(firstMemory, 160) : undefined
const workflowArea = classifyWorkflowArea("Project workflow loop: review before merge.")

// If your process may exit soon after approved writes, wait for background embeddings.
await engine.settle()

// On shutdown timeouts, cancel outstanding embedding work before exiting.
engine.cancelPendingEmbeddings()

// Recall (semantic or lexical). topK is a positive per-call limit override.
const result = await engine.recall("package manager")
const limitedResult = await engine.recall("package manager", { topK: 3 })

// Search (lexical, returns approved only in current project scope)
const memories = engine.search("pnpm")

// List
const all = engine.list()
const pending = engine.list("pending")

// Optional content-free local learning exposure events for custom review UIs.
engine.recordSuggestionsShown(pending, "manual")
engine.recordAgreementRecommendationsShown(engine.operatingAgreements(), "manual")
```
