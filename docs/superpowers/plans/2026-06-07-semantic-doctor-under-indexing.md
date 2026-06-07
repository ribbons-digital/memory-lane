# Semantic Doctor Under-Indexing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only `memory-lane doctor` diagnostics that warn when semantic search is enabled but approved memories lack current embeddings.

**Architecture:** Implement the diagnostic in `MemoryEngine.doctor()` by comparing approved memories against folded embedding records for the active profile and model. Keep the CLI generic doctor formatter unchanged unless tests show warnings are hidden. Update docs to tell users that `doctor` is advisory and `memory-lane reindex` is the explicit repair command.

**Tech Stack:** TypeScript, Node.js built-in test runner, pnpm workspace, append-only JSONL storage.

---

## File Structure

- Modify `packages/core/src/engine.ts`
  - Add a private semantic doctor helper near `obsidianDoctor()`.
  - Reuse `contentHash()` and `createEmbeddingStore()`.
  - Merge semantic diagnostic fields into the existing `doctor()` report.
- Modify `packages/core/test/engine.test.ts`
  - Add TDD tests beside existing doctor tests.
  - Append embedding records directly to the temporary embedding JSONL file.
- Modify `README.md`
  - Document semantic under-indexing warnings and `memory-lane reindex` as the repair command.
- Modify `skills/memory-lane/SKILL.md`
  - Tell agents to treat doctor semantic warnings as advisory and ask before running reindex.

---

### Task 1: Add failing core doctor tests

**Files:**
- Modify: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Inspect existing test helpers**

Run:

```bash
sed -n '1,90p' packages/core/test/engine.test.ts
```

Expected: The file defines a temporary `dir`, an `engine()` helper, and imports from `node:test`, `node:assert/strict`, `node:fs`, and `node:path`.

- [ ] **Step 2: Add an import for `contentHash` if not already available**

At the top of `packages/core/test/engine.test.ts`, add:

```ts
import { contentHash } from "../src/engine-helpers.js"
```

Keep existing imports unchanged.

- [ ] **Step 3: Add these failing tests after `doctor returns stats`**

Insert the following tests immediately after the existing `it("doctor returns stats", ...)` block:

```ts
  it("doctor does not warn about semantic under-indexing when semantic search is disabled", () => {
    const configPath = path.join(dir, "cfg-disabled-semantic.json")
    fs.writeFileSync(configPath, JSON.stringify({ semantic: { enabled: false } }), "utf8")
    const e = new MemoryEngine({
      memoryPath: path.join(dir, "mem-disabled-semantic.jsonl"),
      embeddingsPath: path.join(dir, "emb-disabled-semantic.jsonl"),
      configPath,
    })
    e.save({ text: "approved text", status: "approved" })

    const report = e.doctor()

    assert.equal(report.semanticApprovedMemories, 1)
    assert.equal(report.semanticEmbeddedApprovedMemories, 0)
    assert.equal(report.semanticEmbeddingCoverage, 1)
    assert.deepEqual(report.semanticWarnings, [])
  })

  it("doctor warns when semantic search is enabled and approved memories are under-indexed", () => {
    const e = engine()
    e.save({ text: "first approved memory", status: "approved" })
    e.save({ text: "second approved memory", status: "approved" })

    const report = e.doctor()

    assert.equal(report.semanticApprovedMemories, 2)
    assert.equal(report.semanticEmbeddedApprovedMemories, 0)
    assert.equal(report.semanticEmbeddingCoverage, 0)
    assert.match((report.semanticWarnings as string[]).join("\n"), /only 0\/2 approved memories have current embeddings/)
    assert.match((report.semanticWarnings as string[]).join("\n"), /memory-lane reindex/)
  })

  it("doctor does not warn when every approved memory has a current embedding", () => {
    const e = engine()
    const saved = e.save({ text: "fully indexed memory", status: "approved" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    fs.appendFileSync(path.join(dir, "emb.jsonl"), JSON.stringify({
      memoryId: saved.memory.id,
      memoryUpdatedAt: saved.memory.updatedAt,
      contentHash: contentHash(saved.memory.text),
      profileName: "default",
      model: "text-embedding-3-small",
      dimensions: 2,
      vector: [1, 0],
      createdAt: new Date().toISOString(),
    }) + "\n", "utf8")

    const report = e.doctor()

    assert.equal(report.semanticApprovedMemories, 1)
    assert.equal(report.semanticEmbeddedApprovedMemories, 1)
    assert.equal(report.semanticEmbeddingCoverage, 1)
    assert.deepEqual(report.semanticWarnings, [])
  })

  it("doctor ignores stale embeddings with mismatched content hash model or profile", () => {
    const e = engine()
    const saved = e.save({ text: "current indexed text", status: "approved" })
    assert.equal(saved.status, "saved")
    if (saved.status !== "saved") return

    const embPath = path.join(dir, "emb.jsonl")
    const base = {
      memoryId: saved.memory.id,
      memoryUpdatedAt: saved.memory.updatedAt,
      dimensions: 2,
      vector: [1, 0],
      createdAt: new Date().toISOString(),
    }
    fs.appendFileSync(embPath, JSON.stringify({
      ...base,
      contentHash: contentHash("old indexed text"),
      profileName: "default",
      model: "text-embedding-3-small",
    }) + "\n", "utf8")
    fs.appendFileSync(embPath, JSON.stringify({
      ...base,
      contentHash: contentHash(saved.memory.text),
      profileName: "default",
      model: "other-model",
    }) + "\n", "utf8")
    fs.appendFileSync(embPath, JSON.stringify({
      ...base,
      contentHash: contentHash(saved.memory.text),
      profileName: "other-profile",
      model: "text-embedding-3-small",
    }) + "\n", "utf8")

    const report = e.doctor()

    assert.equal(report.semanticApprovedMemories, 1)
    assert.equal(report.semanticEmbeddedApprovedMemories, 0)
    assert.equal(report.semanticEmbeddingCoverage, 0)
    assert.match((report.semanticWarnings as string[]).join("\n"), /only 0\/1 approved memories have current embeddings/)
  })
```

- [ ] **Step 4: Run the targeted core test and verify it fails**

Run:

```bash
pnpm --filter @memory-lane/core test -- --test-name-pattern "doctor"
```

Expected: FAIL because `semanticApprovedMemories`, `semanticEmbeddedApprovedMemories`, `semanticEmbeddingCoverage`, and `semanticWarnings` are not implemented yet.

---

### Task 2: Implement semantic doctor diagnostics

**Files:**
- Modify: `packages/core/src/engine.ts`

- [ ] **Step 1: Add a private helper above `obsidianDoctor()`**

Add this method inside the `MemoryEngine` class, immediately before the existing `private obsidianDoctor()` method:

```ts
  private semanticDoctor(memories: MemoryRecord[]): Record<string, unknown> {
    const config = this.config.semantic
    const approved = memories.filter((m) => m.status === "approved")
    const semanticApprovedMemories = approved.length
    const profileName = config.activeEmbeddingProfile
    const profile = config.embeddings.profiles[profileName]
    const model = profile?.model
    const warnings: string[] = []

    let semanticEmbeddedApprovedMemories = 0
    if (model) {
      const embeddings = createEmbeddingStore(this.embPath).listEmbeddings()
      const currentKeys = new Set(
        embeddings
          .filter((embedding) => embedding.profileName === profileName && embedding.model === model)
          .map((embedding) => [embedding.memoryId, embedding.contentHash].join("\0")),
      )
      semanticEmbeddedApprovedMemories = approved.filter((memory) => (
        currentKeys.has([memory.id, contentHash(memory.text)].join("\0"))
      )).length
    }

    const semanticEmbeddingCoverage = config.enabled && semanticApprovedMemories > 0
      ? Math.round((semanticEmbeddedApprovedMemories / semanticApprovedMemories) * 1000) / 1000
      : 1

    if (config.enabled && semanticApprovedMemories > 0 && semanticEmbeddingCoverage < 0.8) {
      warnings.push(
        `Semantic search is enabled, but only ${semanticEmbeddedApprovedMemories}/${semanticApprovedMemories} approved memories have current embeddings. Run \`memory-lane reindex\`.`,
      )
    }

    return {
      semanticApprovedMemories,
      semanticEmbeddedApprovedMemories,
      semanticEmbeddingCoverage,
      semanticWarnings: warnings,
    }
  }
```

- [ ] **Step 2: Merge helper output into `doctor()`**

Change the return object in `doctor()` from:

```ts
      activeProfileName: config.activeEmbeddingProfile,
      projectScope: this.scope?.key ?? "none",
      ...this.obsidianDoctor(),
```

to:

```ts
      activeProfileName: config.activeEmbeddingProfile,
      projectScope: this.scope?.key ?? "none",
      ...this.semanticDoctor(mems),
      ...this.obsidianDoctor(),
```

- [ ] **Step 3: Run the targeted core doctor tests**

Run:

```bash
pnpm --filter @memory-lane/core test -- --test-name-pattern "doctor"
```

Expected: PASS for all doctor tests.

- [ ] **Step 4: Run all core tests**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: PASS.

- [ ] **Step 5: Commit the core implementation**

Run:

```bash
git add packages/core/src/engine.ts packages/core/test/engine.test.ts
git commit -m "feat(core): warn on semantic under-indexing"
```

Expected: Commit succeeds.

---

### Task 3: Document semantic doctor warnings

**Files:**
- Modify: `README.md`
- Modify: `skills/memory-lane/SKILL.md`

- [ ] **Step 1: Find current doctor/reindex documentation**

Run:

```bash
rg -n "doctor|reindex|semantic" README.md skills/memory-lane/SKILL.md
```

Expected: Existing references identify where to add short docs.

- [ ] **Step 2: Update `README.md`**

Add this paragraph near the existing `doctor`/semantic search documentation:

```md
`memory-lane doctor` is read-only. When semantic search is enabled, it reports how many approved memories have current embeddings for the active profile/model. If coverage is low, doctor prints a semantic warning such as “Run `memory-lane reindex`.” Reindexing is an explicit repair step and is not run automatically by doctor or hooks.
```

- [ ] **Step 3: Update `skills/memory-lane/SKILL.md`**

Add this guidance near CLI usage or diagnostics guidance:

```md
When `memory-lane doctor` reports `semanticWarnings`, treat them as advisory diagnostics. Do not run `memory-lane reindex` automatically from a hook or without user approval; offer it as an explicit repair command because it writes the embedding sidecar and may call the configured embedding provider.
```

- [ ] **Step 4: Run documentation grep to confirm wording**

Run:

```bash
rg -n "semantic warning|semanticWarnings|memory-lane reindex|read-only" README.md skills/memory-lane/SKILL.md
```

Expected: Both files mention explicit reindex repair and read-only/advisory doctor behavior.

- [ ] **Step 5: Commit docs**

Run:

```bash
git add README.md skills/memory-lane/SKILL.md
git commit -m "docs: explain semantic doctor warnings"
```

Expected: Commit succeeds.

---

### Task 4: Final verification and merge prep

**Files:**
- No direct edits expected.

- [ ] **Step 1: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Inspect doctor output manually**

Run:

```bash
MEMORY_LANE_FILE="$(mktemp -t memory-lane-doctor.XXXXXX.jsonl)" \
MEMORY_LANE_EMBEDDINGS_FILE="$(mktemp -t memory-lane-emb.XXXXXX.jsonl)" \
node packages/cli/dist/index.js save "manual semantic doctor smoke memory" --status approved --json >/tmp/memory-lane-save.json
MEMORY_LANE_FILE="$(jq -r '.data.saved.id as $id | empty' /tmp/memory-lane-save.json 2>/dev/null; echo /dev/null)" true
```

If the command above is too awkward for the shell, instead use this clearer sequence:

```bash
MEM_FILE="$(mktemp -t memory-lane-doctor.XXXXXX.jsonl)"
EMB_FILE="$(mktemp -t memory-lane-emb.XXXXXX.jsonl)"
MEMORY_LANE_FILE="$MEM_FILE" MEMORY_LANE_EMBEDDINGS_FILE="$EMB_FILE" node packages/cli/dist/index.js save "manual semantic doctor smoke memory" --status approved --json
MEMORY_LANE_FILE="$MEM_FILE" MEMORY_LANE_EMBEDDINGS_FILE="$EMB_FILE" node packages/cli/dist/index.js doctor
```

Expected: Human doctor output includes `semanticWarnings` with `memory-lane reindex` when semantic search is enabled by default and no embedding exists.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: Clean worktree.

- [ ] **Step 5: Report verification evidence**

Report:

```text
Changed files:
- packages/core/src/engine.ts
- packages/core/test/engine.test.ts
- README.md
- skills/memory-lane/SKILL.md

Verification:
- pnpm test: PASS
- pnpm build: PASS
- manual doctor smoke: semanticWarnings visible
```

---

## Self-Review

- Spec coverage: Tasks add stable fields, warning threshold, current embedding matching by id/profile/model/hash, tests for disabled/no embeddings/current/stale, and docs about explicit `reindex`.
- Placeholder scan: No `TBD`, `TODO`, or deferred implementation placeholders remain.
- Type consistency: Field names match the approved spec: `semanticApprovedMemories`, `semanticEmbeddedApprovedMemories`, `semanticEmbeddingCoverage`, and `semanticWarnings`.
