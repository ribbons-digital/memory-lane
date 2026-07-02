# Worktree-Aware Project Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make linked Git worktrees resolve to the same Memory Lane project key as the main checkout by default.

**Architecture:** Keep project identity resolution centralized in `packages/core/src/project-scope.ts`. Preserve `.memory-lane-scope` as the first-priority override, then use Git metadata (`show-toplevel`, `git-common-dir`) to derive a canonical key for linked worktrees. No storage path or memory-record migration behavior changes.

**Tech Stack:** TypeScript, Node.js `node:test`, Git CLI via `execFileSync`, pnpm workspace.

---

## File Structure

- Modify `packages/core/test/project-scope.test.ts`
  - Add real Git worktree tests proving a linked worktree key matches the main checkout key.
  - Preserve existing scope-file, normal Git repo, and non-Git tests.
- Modify `packages/core/src/project-scope.ts`
  - Add small helpers for Git command execution, path resolution, and canonical key derivation.
  - Keep public `resolveProjectScope(cwd?: string): ProjectScope | null` signature unchanged.
- Modify `README.md`
  - Update Project Scoping section to describe worktree-aware defaults and `.memory-lane-scope` override.
- Modify `CONTEXT.md`
  - Update Project identity definition to include Git worktree canonicalization.

---

### Task 1: Add failing worktree-aware project-scope tests

**Files:**
- Modify: `packages/core/test/project-scope.test.ts`

- [ ] **Step 1: Add Git author helper and worktree test**

Edit `packages/core/test/project-scope.test.ts`. Add this helper near the imports or before `describe`:

```ts
function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

function configureGitRepo(cwd: string): void {
  execFileSync("git", ["init"], { cwd, stdio: "ignore" })
  execFileSync("git", ["config", "user.email", "memory-lane@example.invalid"], { cwd, stdio: "ignore" })
  execFileSync("git", ["config", "user.name", "Memory Lane Tests"], { cwd, stdio: "ignore" })
  fs.writeFileSync(path.join(cwd, "README.md"), "# test repo\n", "utf8")
  execFileSync("git", ["add", "README.md"], { cwd, stdio: "ignore" })
  execFileSync("git", ["commit", "-m", "initial"], { cwd, stdio: "ignore" })
}
```

Replace existing direct `git init` calls in tests with `configureGitRepo(dir)` only where a commit or worktree is needed. Keep the simple git-root fallback test minimal if preferred.

Add this test inside `describe("resolveProjectScope", ...)`:

```ts
  it("uses the main checkout key for linked git worktrees", () => {
    configureGitRepo(dir)
    const linked = path.join(path.dirname(dir), `${path.basename(dir)}-linked`)
    git(["worktree", "add", linked, "-b", "feature-memory-lane-test"], dir)

    const mainScope = resolveProjectScope(dir)
    const linkedScope = resolveProjectScope(linked)

    assert.notEqual(mainScope, null)
    assert.notEqual(linkedScope, null)
    assert.equal(fs.realpathSync(mainScope!.key), fs.realpathSync(dir))
    assert.equal(fs.realpathSync(linkedScope!.key), fs.realpathSync(dir))
    assert.equal(fs.realpathSync(linkedScope!.root), fs.realpathSync(linked))
  })
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/project-scope.test.ts
```

If the package script does not pass file arguments through, run:

```bash
cd packages/core
node --test --import tsx test/project-scope.test.ts
```

Expected: FAIL. The new linked worktree assertion should show the linked worktree key is currently the linked worktree path, not the main checkout path.

- [ ] **Step 3: Commit failing test**

```bash
git add packages/core/test/project-scope.test.ts
git commit -m "test(core): cover worktree project scope"
```

---

### Task 2: Implement worktree-aware Git canonical key resolution

**Files:**
- Modify: `packages/core/src/project-scope.ts`
- Test: `packages/core/test/project-scope.test.ts`

- [ ] **Step 1: Refactor Git command helper in project-scope**

In `packages/core/src/project-scope.ts`, replace `findGitRoot` with reusable helpers:

```ts
function runGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null
  } catch {
    return null
  }
}

function realpathOrResolved(inputPath: string): string {
  try {
    return fs.realpathSync(inputPath)
  } catch {
    return path.resolve(inputPath)
  }
}

function resolveGitPath(rawPath: string, cwd: string): string {
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath)
}
```

- [ ] **Step 2: Add Git project scope resolver**

Still in `packages/core/src/project-scope.ts`, add:

```ts
function canonicalKeyFromGitCommonDir(showTopLevel: string, gitCommonDirRaw: string): string {
  const commonDir = realpathOrResolved(resolveGitPath(gitCommonDirRaw, showTopLevel))
  if (path.basename(commonDir) === ".git") return path.dirname(commonDir)
  return realpathOrResolved(showTopLevel)
}

function resolveGitScope(cwd: string): ProjectScope | null {
  const showTopLevelRaw = runGit(cwd, ["rev-parse", "--show-toplevel"])
  if (!showTopLevelRaw) return null

  const root = realpathOrResolved(showTopLevelRaw)
  const gitCommonDirRaw = runGit(cwd, ["rev-parse", "--git-common-dir"])
  const key = gitCommonDirRaw ? canonicalKeyFromGitCommonDir(root, gitCommonDirRaw) : root

  return { cwd, root, key }
}
```

- [ ] **Step 3: Update resolveProjectScope to use resolveGitScope**

Change the bottom of `resolveProjectScope` to:

```ts
export function resolveProjectScope(cwd?: string): ProjectScope | null {
  const resolvedCwd = path.resolve(cwd ?? process.cwd())
  const scope = findScopeFile(resolvedCwd)
  if (scope) return { cwd: resolvedCwd, root: scope.root, key: scope.id }
  return resolveGitScope(resolvedCwd)
}
```

Remove the old `findGitRoot` function.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run:

```bash
cd packages/core
node --test --import tsx test/project-scope.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all core tests**

Run from repo root:

```bash
pnpm --filter @memory-lane/core test
```

Expected: PASS.

- [ ] **Step 6: Commit implementation**

```bash
git add packages/core/src/project-scope.ts
git commit -m "feat(core): resolve git worktree project scope"
```

---

### Task 3: Document worktree-aware scoping

**Files:**
- Modify: `README.md`
- Modify: `CONTEXT.md`

- [ ] **Step 1: Update README Project Scoping section**

Replace the current Project Scoping text in `README.md` with:

```md
## Project Scoping

Project identity is resolved in order:

1. `.memory-lane-scope` file (walks up from cwd) — `{ "id": "your-project-id" }`
2. Git identity — normal repos use the repo root; linked Git worktrees use the main checkout/common Git directory as the project key so worktrees share memories by default
3. Global scope (fallback — memories are visible everywhere)

Read-only scope resolution never creates scope files.
Project-local initialization and first project-scoped writes may create `.memory-lane-scope` as part of initializing `.memory-lane/`.
Create one manually in a project root when you want an explicit stable identity or need to override Git-derived identity:

```bash
echo '{"id":"my-project-uuid"}' > .memory-lane-scope
```

Existing memories saved under old worktree path keys are not migrated automatically. Use `memory-lane list --all` and existing review/delete/save commands if you want to clean up fragmented historical records.
```

- [ ] **Step 2: Update CONTEXT Project identity definition**

In `CONTEXT.md`, replace the **Project identity** definition with:

```md
**Project identity**:
Determined by checking for a `.memory-lane-scope` file (walking up from cwd) first.
If none exists, Memory Lane uses Git metadata: normal repos use the repo root, while linked Git worktrees use the common Git directory's main checkout path as the project key so worktrees share project memories by default.
If neither a scope file nor Git identity is available, project scope is unavailable unless the caller supplied an explicit project path.
Read-only scope resolution never creates scope files, but project-local initialization and first project-scoped writes may create `.memory-lane-scope` as part of initializing `.memory-lane/`.
Scope files remain the explicit override for custom/stable identities.
```

- [ ] **Step 3: Verify docs mention worktrees and no migration**

Run:

```bash
rg -n "worktree|worktrees|Project identity|Project Scoping|not migrated|scope file" README.md CONTEXT.md
```

Expected: README and CONTEXT both mention worktree-aware scoping; README mentions existing fragmented memories are not migrated automatically.

- [ ] **Step 4: Commit docs**

```bash
git add README.md CONTEXT.md
git commit -m "docs: explain worktree-aware project scope"
```

---

### Task 4: Final verification and review

**Files:**
- No edits expected unless verification reveals an issue.

- [ ] **Step 1: Run full build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Manual real-worktree smoke**

From the main checkout and linked worktree, compare project keys:

```bash
cd /Users/shiang/projects/ribbons-digital/memory-lane
node -e 'import("./packages/core/dist/index.js").then(({resolveProjectScope}) => console.log(resolveProjectScope(process.cwd())))'

cd /Users/shiang/.config/superpowers/worktrees/memory-lane/worktree-aware-scope
node -e 'import("./packages/core/dist/index.js").then(({resolveProjectScope}) => console.log(resolveProjectScope(process.cwd())))'
```

Expected: both outputs have the same `key`; the linked worktree output has `root` equal to the linked worktree path.

- [ ] **Step 4: Inspect git state**

Run:

```bash
git status --short --branch
git log --oneline --decorate --max-count=8
```

Expected: clean worktree; branch contains spec, plan, test, implementation, and docs commits.

- [ ] **Step 5: Request final review**

Ask reviewer to verify:

- Worktree behavior is default and zero-config.
- `.memory-lane-scope` remains authoritative.
- Normal Git and non-Git behavior are preserved.
- No storage path behavior changed.
- Docs set correct expectations about no automatic migration.
