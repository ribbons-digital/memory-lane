# Memory Lane vs Memory-as-a-Tool: Write → Consolidate → Recall → Apply

## Status

Parked analysis. This document records a review of Memory Lane against the four-step loop shown in the screenshot and described in Víctor Gallego's paper, **“Distilling Feedback into Memory-as-a-Tool”** (`arXiv:2601.05960`).

The screenshot summarized the loop as:

> **Write → Consolidate → Recall → Apply**
>
> - **Write:** after every attempt, the agent records what it tried and what happened.
> - **Consolidate:** it distills raw attempts into reusable lessons, not transcript dumps.
> - **Recall:** before the next task, it reads those lessons first.
> - **Apply:** it skips dead ends it already learned, even on a new problem.

Memory Lane already covers parts of this loop, but with a different philosophy: **local-first, review-governed, cross-harness continuity without silent autonomy**. The paper's loop is more agent-driven and immediate; Memory Lane's version should remain bounded, review-first, and harness-neutral.

## Paper summary

The paper proposes a **Memory-as-a-Tool** framework that amortizes expensive inference-time critique/refinement. Instead of repeatedly doing self-critique on every new task, the agent converts feedback into persistent, retrievable guidelines.

Key mechanisms from the paper:

1. **Feedback arrives** after a generated response.
2. The model **abstracts** that feedback into a reusable rule.
3. The model writes or edits memory through tools such as `write_file` / `edit_file`.
4. Before later tasks, the model lists available memories, chooses relevant ones, reads them, and uses them to generate a better first answer.

Important paper details:

- Memory is not treated as raw transcript storage.
- Memory entries are human-readable, inspectable documents.
- The model decides whether to create a new memory or update an existing one.
- Consolidation includes deduplication and contradiction/conflict resolution.
- Retrieval is agent-controlled in the paper: `ls()` to inspect memory filenames, then `read_file()` for relevant files.
- The core benefit is amortization: pay the cost of feedback/critique once, then reuse the distilled lesson later.

## Overall verdict

| Step | Paper goal | Memory Lane today | Verdict |
|---|---|---|---|
| Write | Record attempts/feedback as durable learning | Captures explicit saves, corrections, checkpoints, procedures, postmortems, and session summaries | Partial / strong in high-signal cases |
| Consolidate | Distill raw episodes into reusable principles and resolve conflicts | Has dedup keys, roles, operating agreements, freshness, revisions, and summaries, but no cross-memory synthesis | Main gap |
| Recall | Read relevant lessons before future tasks | Has semantic/lexical recall, continuity read model, workstream discovery, lifecycle injection, and MCP/CLI/Pi surfaces | Strong |
| Apply | Use lessons to avoid repeated dead ends | Injects bounded context/guidance and steers harnesses to continuity/agreement/status tools | Strong but mostly passive |

The clearest future opportunity is **review-first consolidation proposals**: detect overlapping or conflicting memories and propose manual `replace` / `supersede` / `update` actions without auto-merging or auto-approving anything.

---

## 1. Write — capture what happened

### What Memory Lane does today

Memory Lane has multiple write/capture paths:

| Path | Current behavior | Representative code |
|---|---|---|
| Explicit save/suggest | User or agent explicitly saves/suggests a memory | `packages/core/src/engine.ts`, CLI/MCP/Pi adapters |
| Stop candidates | Captures explicit memory requests and durable statements | `packages/lifecycle/src/candidates.ts`, `packages/lifecycle/src/handlers.ts` |
| Correction capture | Queues pending `correction` memories from explicit workflow corrections | `packages/lifecycle/src/correction-capture.ts` |
| Procedure capture | Queues pending `procedure` memories from failed-then-recovered tool workflows | `packages/lifecycle/src/tool-outcomes.ts` |
| Postmortem learning | Queues correction/procedure candidates from symptom + cause + prevention + verification evidence | `packages/lifecycle/src/postmortem-learning.ts` |
| Checkpoint capture | Queues progress/checkpoint candidates for releases, merges, verification, doc syncs | `packages/lifecycle/src/checkpoint-capture.ts` |
| Session summaries | Confirmed LLM-generated pending `session_summary` memories that await review/approval | `packages/lifecycle/src/session-end.ts` |

The capture style is intentionally conservative:

- pending by default for inferred learning;
- no raw transcript persistence;
- no auto-approval;
- secret filtering;
- meta-task prompt filtering;
- project scoping;
- duplicate/same-turn suppression.

### Fit against the paper

Memory Lane matches the paper's intent in high-signal situations: durable corrections, procedures, checkpoints, and summaries can be written once and reused later.

But Memory Lane differs from the paper in two major ways:

1. **It is not “after every attempt.”** Memory Lane intentionally avoids logging every attempt because that would create noisy memory and context pollution.
2. **It is not fully agent-driven.** Most write decisions come from deterministic lifecycle rules and explicit commands/tools, not from an LLM deciding what should be learned.

### Assessment

This is mostly the right tradeoff for Memory Lane. A literal “write after every attempt” loop conflicts with the product goal of bounded, review-governed memory. The better adaptation is:

> Write only after explicit user request, high-signal correction, failed-then-recovered procedure, checkpoint evidence, or explicit/confirmed session summary.

---

## 2. Consolidate — distill reusable lessons

### What Memory Lane does today

Memory Lane has several consolidation-like mechanisms:

| Mechanism | Current behavior | Representative code |
|---|---|---|
| Dedup keys | Avoids repeated correction/procedure/postmortem candidates | `correctionKeyFromText`, `postmortemLearningKeyFromText`, procedure keys |
| Continuity roles | Separates progress from corrections/procedures/workflow guidance | `packages/core/src/continuity-roles.ts` |
| Continuity read model | Builds `latestProgress`, `operatingGuidance`, `pendingContinuity`, `workstreamDiscovery` | `packages/core/src/continuity-read-model.ts` |
| Operating agreements | Selects workflow/process memories by area | `packages/core/src/operating-agreements.ts` |
| Freshness/hints | Surfaces stale/expired/superseded/overlap/scope-hygiene signals | `packages/core/src/freshness.ts`, `packages/core/src/continuity-hints.ts` |
| Revision primitives | Manual `update`, `replace`, `supersede`, `rescope` flows | `packages/core/src/engine.ts`, CLI commands |
| Session summary generation | Compresses session context into pending summaries | `packages/lifecycle/src/session-end.ts` |

### Gap against the paper

This is the weakest match.

The paper's consolidation does three things Memory Lane does not yet do as a product loop:

1. **Abstract specific feedback into a reusable principle.**
   - Memory Lane often uses deterministic templates rather than LLM-synthesized principles.

2. **Merge related lessons into existing memory.**
   - Memory Lane can manually `update`, `replace`, or `supersede`, but it does not proactively propose a consolidated replacement for related memories.

3. **Resolve contradictions/conflicts.**
   - Memory Lane has hints for overlap and freshness, but no explicit “these two lessons conflict; here is a proposed resolution” surface.

### Recommended future adaptation

The best next adaptation is not auto-consolidation. It is:

> **Review-first consolidation proposals.**

A future read-only surface could detect groups of related correction/procedure/workflow memories and propose manual actions:

- “These three procedure memories overlap.”
- “This older workflow correction appears superseded by a newer one.”
- “These could become one operating agreement.”
- Suggested dry-run commands:
  - `memory-lane replace ... --dry-run`
  - `memory-lane supersede ... --dry-run`
  - `memory-lane update ... --dry-run`

Constraints for that future slice:

- no auto-consolidation;
- no auto-approval;
- no raw transcript capture;
- no recall ranking change;
- no harness-specific behavior;
- text-free diagnostics where possible;
- bounded previews only on explicit continuity/review surfaces.

---

## 3. Recall — read lessons before future work

### What Memory Lane does today

Memory Lane's recall stack is stronger and more structured than the paper's simple `ls()` / `read_file()` loop:

| Surface | Current behavior | Representative code |
|---|---|---|
| Semantic + lexical recall | Embedding similarity + lexical + recency + kind boosts | `packages/core/src/retrieval.ts` |
| Project-scoped visibility | Defaults to current project plus global memories | `packages/core/src/search.ts`, project scope helpers |
| Continuity read model | Canonical broad project-status surface | `packages/core/src/continuity-read-model.ts` |
| Workstream discovery | Topic-specific continuity lookup | `packages/core/src/workstream-discovery.ts` |
| Operating agreements | Explicit workflow/process recall | `packages/core/src/operating-agreements.ts` |
| Lifecycle injection | Budgeted selected memory context | `packages/lifecycle/src/injection.ts` |
| MCP tools | `memory_recall`, `memory_continuity`, `memory_status`, etc. | `packages/mcp-server` |
| CLI tools | `memory-lane recall`, `continuity`, `status`, `review`, etc. | `packages/cli` |
| Pi adapter | `memory_continuity`, `memory_recall`, `/memory continuity` | `packages/pi-adapter` |

### Difference from the paper

The paper relies on agent-controlled file browsing:

1. list memory files;
2. infer relevance from filenames;
3. read relevant files.

Memory Lane instead uses purpose-built structured surfaces:

- broad continuity → `memory_continuity` / `memory-lane continuity`;
- targeted facts → `memory_recall` / `memory-lane recall`;
- workflow rules → `memory-lane agreements`;
- health/freshness/scope → `memory_status` / `memory-lane status`.

### Assessment

Memory Lane should keep this structured approach. It is more scalable, safer, and more harness-neutral than exposing raw file browsing as the main memory API.

One useful adaptation from the paper is the **habit** it teaches the agent:

> Before generating, inspect relevant memory intentionally.

Memory Lane already does this for broad continuity prompts and through skills/guidance, but future adapter prompts could make this protocol more explicit across harnesses.

---

## 4. Apply — use lessons to avoid repeated dead ends

### What Memory Lane does today

Memory Lane applies memory through steering and context:

| Mechanism | Current behavior | Representative code |
|---|---|---|
| Selective injection | Injects bounded approved memories in `<memory-context>` | `packages/lifecycle/src/injection.ts` |
| Policy-only mode | Injects tool-use guidance without memory bodies | `packages/lifecycle/src/injection.ts` |
| Continuity intent guidance | Tells agents to inspect continuity before answering broad project questions | `packages/lifecycle/src/injection.ts` |
| SessionStart continuity notices | Surfaces newer approved state, operating agreements, superseded/overlap hints | `packages/lifecycle/src/handlers.ts`, `injection.ts` |
| Continuity read model guidance | `answerGuidance` and `harnessGuidance` tell harnesses what to inspect | `packages/core/src/continuity-read-model.ts` |
| Skill docs | Instruct agents to use continuity before recall and prefer `latestProgress` | `skills/memory-lane/SKILL.md` |
| Pi adapter | Routes broad Pi prompts to continuity before recall | `packages/pi-adapter/src/index.ts` |
| Generated bridge | Provides release-style Pi continuity routing | `packages/cli/src/installer/config.ts` |

### Fit against the paper

Memory Lane strongly supports the “apply” phase when the harness follows the protocol. It can surface approved memories and guidance before the model answers.

The limitation is that Memory Lane often gives **inspection guidance** rather than direct imperatives. For example:

- “Use continuity before answering.”
- “Treat pending as review candidates.”
- “Verify against repository state.”

The paper's memory files are often more directly behavioral:

- “Avoid standard movie review structure.”
- “Use synesthetic blending.”
- “Do not default to consequentialist language.”

Memory Lane can support direct behavioral rules through `workflow_rule`, `procedure`, and operating agreements, but it does not yet systematically distill corrections into those direct principle-style rules.

---

## Harness-neutral steering protocol

Regardless of harness, Memory Lane should steer agents through the same protocol.

### Broad project/status questions

Use continuity first:

```bash
memory-lane continuity --query "<user question>" --json
```

or MCP:

```ts
memory_continuity({ projectPath, query })
```

Agents should interpret the response as:

- `latestProgress`: primary answer for “where are we?” / “what were we last working on?”;
- `operatingGuidance`: workflow corrections/procedures to apply while working;
- `pendingContinuity`: review candidates, not facts;
- `workstreamDiscovery`: topic-specific pointers;
- `warnings`: inspect before relying on stale/superseded/ambiguous state.

### Process-sensitive work

Inspect operating agreements and status:

```bash
memory-lane agreements --json
memory-lane status --json
```

or MCP:

```ts
memory_status({ projectPath })
memory_continuity({ projectPath })
```

### After high-signal failure or correction

Suggest a pending memory rather than auto-approving:

```bash
memory-lane suggest "<generalized lesson>" --category project
```

or MCP:

```ts
memory_suggest({ text, category: "project" })
```

### Session end / handoff

Use summaries/checkpoints and review:

```bash
memory-lane review --json
memory-lane continuity --json
```

Pending summaries/checkpoints should become durable continuity only after approval.

### Future consolidation

A future read-only consolidation surface could add:

```bash
memory-lane continuity --json
# includes consolidationHints
```

or:

```bash
memory-lane status --json
# includes text-free consolidation diagnostics
```

---

## Concrete observations from current code/docs

1. **Write is intentionally high-signal, not exhaustive.**
   - This matches Memory Lane's “avoid context pollution” goal better than the screenshot's “after every attempt” wording.

2. **Postmortem learning is the closest current feature to the paper.**
   - It requires symptom, cause, prevention, and verification evidence before queueing a pending lesson.

3. **Procedure memories already have the right shape.**
   - `Procedure / When / Steps / Pitfall / Verify` is close to the paper's structured guideline examples.

4. **Continuity read model is a good Memory Lane-native recall/apply surface.**
   - `latestProgress`, `operatingGuidance`, `workstreamDiscovery`, `warnings`, and `answerGuidance` give agents a better structured path than raw recall alone.

5. **Consolidation remains mostly manual.**
   - Revision primitives exist, but Memory Lane does not yet propose synthesized replacements or conflict resolutions.

6. **A generated Pi parity detail was found during review.**
   - Repo-local Pi and the generated/native Pi bridge should keep operating-guidance rendering aligned with the shared model and CLI caps when future adapter parity work happens.

---

## Recommended future slice: review-first consolidation proposals

This is the most direct adaptation of the paper while preserving Memory Lane's architecture.

### Proposed scope

Add deterministic, read-only consolidation hints that identify:

- duplicate or near-duplicate corrections/procedures;
- multiple procedure memories with the same workflow area;
- older correction/procedure memories likely superseded by newer ones;
- pending session summaries that primarily summarize Memory Lane review-management chatter;
- memories that could be promoted into a clearer `workflow_rule` / operating agreement.

### Non-goals

- no automatic consolidation;
- no automatic approval/rejection/deletion;
- no LLM classifier in the first slice;
- no recall ranking changes;
- no lifecycle injection changes;
- no raw transcript indexing;
- no harness-specific behavior.

### Likely surfaces

- `memory-lane continuity --json` as a bounded read model extension;
- `memory-lane status --json` / `doctor --json` as text-free counts and ids;
- optional human `dashboard` summary;
- suggested dry-run commands only.

### Why this is high value

It addresses the largest gap against the paper: consolidation. It also builds on Memory Lane's existing strengths:

- review-first workflow;
- revision primitives;
- continuity hints;
- operating agreement selection;
- text-free diagnostics;
- harness-neutral CLI/MCP surfaces.

---

## Parked conclusion

Memory Lane should not become a raw agent notebook that writes after every attempt. The useful lesson from the paper is narrower:

> Turn feedback into reusable, inspectable principles, retrieve them before similar work, and apply them with bounded context.

Memory Lane already has the skeleton for this. The next improvement should be to make consolidation more explicit and reviewable, not automatic.
