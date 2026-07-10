# Memory Lane vs Paper/Screenshot Loop: Write → Consolidate → Recall → Apply

## Overview

This review maps Memory Lane's current codebase against the four-stage loop from the
paper ("Distilling Feedback into Memory-as-a-Tool", arXiv:2601.05960, ICLR 2026 MemAgents Workshop).
Each stage is evaluated for: what exists today, gaps, and harness-neutral steering mechanisms.

---

## Stage 1 — Write (Capture feedback/outcomes as memories)

### What exists

Memory Lane has **multiple capture pathways**, all harness-triggered through lifecycle events:

| Lifecycle event | File(s) | What it captures |
|---|---|---|
| `Stop` (last user msg) | `packages/lifecycle/src/candidates.ts` | Explicit memory requests, checkpoint save requests, durable project statements |
| `Stop` (corrections) | `packages/lifecycle/src/correction-capture.ts` | Workflow corrections from user challenge signals (e.g., "you forgot to...") |
| `Stop` (postmortems) | `packages/lifecycle/src/postmortem-learning.ts` | Debugging postmortems with symptom + cause + prevention + verification evidence |
| `Stop` (checkpoints) | `packages/lifecycle/src/checkpoint-capture.ts` | Strong checkpoint evidence (release, merge, verification statements) |
| `PostToolUse` | `packages/lifecycle/src/tool-outcomes.ts` | Recovery procedures (pnpm test/build/install recovery), tool outcome evidence |
| `PostToolUse` (checkpoints) | `packages/lifecycle/src/checkpoint-capture.ts` | Successful release/merge commands |
| `SessionEnd` | `packages/lifecycle/src/session-end.ts` | LLM-generated structured session summaries → pending `session_summary` |
| Direct save/suggest | `packages/core/src/engine.ts` (`save()`, `suggest()`) | Explicit CLI/MCP tool saves, pi adapter `input`/`memory_save`/`memory_suggest` |

All capture pathways write to **JSONL file storage** via `MemoryEngine.save()` /
`suggest()`. Candidates are prefixed to text (e.g., `"Workflow correction: ..."`,
`"Procedure: ..."`). Deduplication uses content keys in `correctionKeyFromText()`,
`postmortemLearningKeyFromText()`, etc.

### Paper correspondence

The paper's Write phase: agent receives feedback → LLM abstracts it into general rules →
agent calls `write_file`/`edit_file` to persist. **This is agent-driven and LLM-synthesized.**

Memory Lane's Write phase: lifecycle hook fires → deterministic pattern-matching code
extracts evidence → templated text is persisted as a pending memory. **This is
harness-driven and rule-based.**

### Gaps

1. **No agent-driven write.** The agent never decides "this feedback is worth remembering."
   Capture rules are hardcoded in lifecycle handlers. If a pattern doesn't match, nothing
   is captured — even if the agent or user would find it useful.

2. **No LLM abstraction step.** Raw correction/postmortem text is template-fitted, not
   LLM-synthesized. `postmortem-learning.ts` `candidateText()` maps input patterns to
   one of ~4 hardcoded procedure/correction templates. The paper's abstraction step
   (episodic → semantic) is absent.

3. **No `write_file`/`edit_file` tool.** The paper's agent calls explicit file tools.
   Memory Lane uses `memory_save` / `memory_suggest` — but these are opaque to the
   agent (no `write_file` tool exists). The generated Pi bridge has `memory_save` and
   `memory_suggest`, not a generic write tool.

---

## Stage 2 — Consolidate (Distill raw experiences into structured, reusable knowledge)

### What exists

Memory Lane has **several deterministic consolidation surfaces**:

| Surface | File | What it does |
|---|---|---|
| Continuity role classification | `packages/core/src/continuity-roles.ts` | Classifies approved memories as `progress`, `correction`, `procedure`, `operating_agreement`, `global_workflow`, `other` |
| Continuity read model | `packages/core/src/continuity-read-model.ts` | Builds `latestProgress`, `operatingGuidance`, `latestApproved`, `pendingContinuity`, `workstreamDiscovery` - the canonical consolidated view; selected slots omit superseded memories and prefer safe descriptor previews |
| Operating agreements | `packages/core/src/operating-agreements.ts` | Selects workflow-like approved memories by area (`project-loop`, `review-gate`, `pr-process`, etc.) with primary/related structure |
| Continuity hints | `packages/core/src/continuity-hints.ts` | Detects superseded-visible, operating-agreement overlaps, scope hygiene candidates, freshness advisories |
| Freshness classification | `packages/core/src/freshness.ts` | Classifies memories as `current`, `stale`, `expired`, or `none` based on advisory freshness metadata |
| Session-end summarization | `packages/lifecycle/src/session-end.ts` | LLM-generated structured session summaries (decisions, blockers, next steps, key facts) — the only LLM-driven consolidation |
| Checkpoint candidates | `packages/core/src/checkpoint-candidates.ts` | Classifies pending memories as release/merge/verification milestone types |
| Revision system | `packages/core/src/engine.ts` (`update`, `rescope`, `replace`, `supersede`) | Explicit memory revision with append-only history, same-id scope correction, successor/superseded relationships, and scoped maintenance visibility unless `--all` is explicit |

### Paper correspondence

Paper's Consolidation: LLM receives feedback → abstracts → writes structured principles
file with sections (Core Principles, Specific Techniques, etc.) → resolves conflicts
between old and new feedback.

Memory Lane's Consolidation: deterministic classifiers and selectors build structured
read models from approved/pending memories. The only LLM-driven consolidation is
`session-end.ts`.

### Gaps

1. **No LLM synthesis for cross-memory consolidation.** The paper has the LLM actively
   synthesize abstract rules across multiple experiences. Memory Lane treats each memory
   independently; there is no cross-memory abstraction step.

2. **No conflict resolution.** The paper's LLM decides whether to create a new file or
   update an existing one based on whether old and new feedback contradict. Memory Lane
   has content-key dedup (skip if same key exists) but no contradiction detection.

3. **No structured "principles" document.** The paper produces organized memory files
   with sections. Memory Lane stores compact template text — no principles/techniques/
   pitfall sections exist for corrections (though `tool-outcomes.ts` procedures do have
   a `Procedure`/`When`/`Steps`/`Pitfall`/`Verify` template).

4. **`operatingGuidance` is bounded by workflow area.** The read model caps guidance to
   one preview per workflow area, so additional same-area rules require explicit agreement
   or exact-memory inspection.

---

## Stage 3 — Recall (Retrieve relevant memories when needed)

### What exists

Memory Lane has **multiple recall pathways** for different use cases:

| Surface | File | What it does |
|---|---|---|
| Semantic retrieval | `packages/core/src/retrieval.ts` | Cosine similarity + lexical + recency weighted scoring, configurable embedding provider |
| Lexical retrieval | `packages/core/src/search.ts` | Basic text matching with token scoring |
| Workstream discovery | `packages/core/src/workstream-discovery.ts` | Query-specific topic discovery across approved continuity memories with scoring/references |
| Continuity read model | `packages/core/src/continuity-read-model.ts` | The full continuity surface (latest progress, operating guidance, pending items) |
| Lifecycle injection | `packages/lifecycle/src/injection.ts` (`selectMemoriesForInjection`, `selectBaselineMemories`) | Layered memory selection for lifecycle context (current-project, global preferences, etc.) |
| Continuity prompt routing | `packages/lifecycle/src/injection.ts` (`classifyPromptRoute`) | Classifies prompt as continuity/ordinary/low-signal/memory-management, with resume/lookup/project-position/next-work intent details for continuity routes |
| CLI recall tool | `packages/cli/src/index.ts` | `memory-lane recall <query> --json` |
| MCP recall tool | `packages/mcp-server/src/handlers.ts` | `memory_recall({ query })` |
| Pi recall | `packages/pi-adapter/src/index.ts` | `memory_recall` tool, `/memory use <query>` |

**Retrieval selection logic** in `injection.ts`:
1. Layered groups: current-project preferences → current-project content → global preferences → global memory → other
2. Each layer budgeted by `maxItems`/`maxChars` from `memory.contextPolicy`
3. Secrets filtered, dedup by text key, lexical overlap required when semantic misses

### Paper correspondence

Paper's Recall: agent calls `ls("/memories/")` → reads filenames → reasons about
relevance → calls `read_file(path)` to get content. **Agent-driven, filename-based,
explicit read.**

Memory Lane's Recall: automatic lifecycle injection (layered, filtered, budgeted) +
explicit `memory_recall` tool (query → scored results). **Hybrid: automatic for lifecycle,
tool-based for explicit queries.**

### Gaps

1. **No agent-navigated filesystem.** The agent cannot `ls` available memories or
   browse by filename — it can only query. The paper argues filename semantics force
   the agent to actively reason about what exists.

2. **No explicit "check memory before generating" prompt.** The paper's system prompt
   instructs "Before generating...check your ./memories/ directory." Memory Lane's
   SKILL.md has similar guidance ("Use continuity first for broad handoff-style
   questions") but this is external documentation, not an embedded prompt instruction.

3. **Lifecycle injection is invisible to the agent.** Injected `<memory-context>` blocks
   appear automatically — the agent doesn't know it should look. This works but doesn't
   teach the agent to proactively check memory.

4. **No hierarchical or categorized memory listing.** The paper mentions hierarchical
   file structures as future work. Memory Lane has flat memory with project scope,
   but no agent-facing browse/categorize surface beyond `list --kind --status --source`.

---

## Stage 4 — Apply (Use retrieved knowledge to guide behavior)

### What exists

Memory Lane **applies memories through context injection and guidance surfaces**:

| Surface | File | What it does |
|---|---|---|
| Lifecycle context injection | `packages/lifecycle/src/injection.ts` (`renderMemoryContext`, `composePromptContext`, `composeSessionStartContext`) | Injects `<memory-context>` blocks into lifecycle events with grouped/rendered memories |
| Continuity intent guidance | `packages/lifecycle/src/injection.ts` (`renderContinuityIntentGuidance`) | Injects inspection-first guidance text when a continuity intent is detected |
| Policy-only guidance | `packages/lifecycle/src/injection.ts` (`renderMemoryContext` in policy-only mode) | Route-aware guidance to use Memory Lane continuity, recall, list, status, or review surfaces without memory bodies |
| Continuity read model answerGuidance | `packages/core/src/continuity-read-model.ts` | Structured guidance: "Use this continuity read model before answering..." |
| Continuity read model harnessGuidance | Same file | Per-harness guidance (CLI commands, MCP tools) |
| Notification/continuity guidance | Same file | "Continuity is read-only; no mutation is performed" |
| Skill file guidance | `skills/memory-lane/SKILL.md` | Agent-facing instructions for using Memory Lane tools/commands |
| Pi adapter rendering | `packages/pi-adapter/src/index.ts` | `renderPiContinuityContext` — human-readable continuity summary |
| Generated bridge rendering | `packages/cli/src/installer/config.ts` | `renderContinuityContext` — same shape for native binary installs |
| CLI formatters | `packages/cli/src/formatters.ts` | Human-readable continuity/dashboard/status output |

**Policy modes** in `memory.contextPolicy`:
- `selective`: Injects bounded selected approved memories in `<memory-context>` block
- `policy-only`: Injects route-aware "use Memory Lane tools" guidance, no memory bodies
- `off`: No automatic context injection

### Paper correspondence

Paper's Apply: agent reads memory file content → it directly primes the model's response
generation. The memory content is prepended to context and influences output distribution.

Memory Lane's Apply: memory content is injected as `<memory-context>` blocks, continuity
guidance text, or explicit tool output. The agent reading the injected context is
expected to use it.

### Gaps

1. **No agent self-reminder step.** The paper trains the agent to pro-actively "check
   ./memories/" before each generation. Memory Lane relies on automatic injection or
   external skill guidance — the agent doesn't have an ingrained habit.

2. **Continuity read model is a summary, not raw access.** The read model provides
   bounded previews and derived guidance — not the full memory text. This is a
   deliberate privacy/safety choice, but it means the agent gets a curated report
   rather than the raw material it might need to reason about.

3. **No agent-controlled "apply this rule" mechanism.** In the paper, if the agent reads
   a principle like "Use synesthetic blending," it can actively apply it. Memory Lane's
   guidance is passive: "Inspect continuity before answering" — it doesn't directly
   embed usable rules.

---

## Harness-Neutral Steering Mechanisms

Memory Lane already has several mechanisms that work **harness-neutrally**:

| Mechanism | Where | How it steers |
|---|---|---|
| `memory.contextPolicy` | lifecycle config | `selective`/`policy-only`/`off` — works for any harness |
| `memory.handoffMode` | lifecycle config | `manual`/`review`/`automatic` — harness-neutral handoff behavior |
| Continuity read model | `packages/core/src/continuity-read-model.ts` | Same JSON shape for CLI, MCP, Pi, generated bridge |
| `harnessGuidance` | Same file | Per-harness CLI/MCP command suggestions from shared core |
| `answerGuidance` | Same file | Generic guidance that works regardless of harness |
| SKILL.md | `skills/memory-lane/SKILL.md` | Agent-facing instructions, harness-agnostic |
| Generated bridge template | `packages/cli/src/installer/config.ts` | Same continuity rendering for all native-binary installs; uses `memory-lane route --prompt <text> --json` for shared route-decision parity |
| Core exports | `packages/core/src/index.ts` | All continuity/retrieval/classification functions available to any adapter |

**Steering directions** (what Memory Lane tells harnesses):

1. **"Use continuity before recall"** — broad project-position questions should go to
   `memory_continuity` first, not `memory_recall`.

2. **"Prefer `latestProgress` for broad answers"** — treatments guide the agent to
   distinguish progress from corrections.

3. **"Treat pending as review candidates, not approved facts"** — safety boundary.

4. **"Inspect Memory Lane state before relying on older context"** — freshness notice.

5. **"Use authoritative surfaces for memory management"** — `list`, `review`, `status`
   rather than injected context.

---

## Summary Table

| Phase | Paper approach | Memory Lane approach | Key gap |
|---|---|---|---|
| **Write** | Agent calls `write_file`/`edit_file` after LLM abstracts feedback | Lifecycle hooks trigger deterministic capture to JSONL | No agent-driven write; no LLM abstraction step |
| **Consolidate** | LLM synthesizes abstract rules from multiple experiences, resolves conflicts | Deterministic role classification + read model construction; only session-end uses LLM | No cross-memory synthesis; no conflict resolution; no structured principles doc |
| **Recall** | Agent calls `ls()` → reads filenames → reasons → calls `read_file()` | Automatic lifecycle injection + explicit `memory_recall` query tool | No agent-navigated filesystem; no "check before generating" habit |
| **Apply** | Agent reads memory content, it directly primes generation | `<memory-context>` blocks injected automatically; continuity guidance text | No agent self-reminder step; read model is curated summary not raw access |
