import test from "node:test"
import assert from "node:assert/strict"
import type { ContinuityHintSummary, MemoryRecord, OperatingAgreementSummary, RecallResult } from "@memory-lane/core"
import {
  shouldSkipAutomaticInjection,
  selectMemoriesForInjection,
  selectBaselineMemories,
  renderMemoryBlock,
  renderMemoryContext,
  renderContinuityNotice,
  detectContinuityIntent,
  renderContinuityIntentGuidance,
  CODEX_MEMORY_INJECTION_LIMITS,
} from "../src/injection.ts"

function memory(id: string, text: string): MemoryRecord {
  return {
    id,
    status: "approved",
    text,
    category: "project",
    scope: { type: "project", key: "repo" },
    source: "manual",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    kind: "project_fact",
  }
}

function globalMemory(id: string, text: string, kind: MemoryRecord["kind"] = "preference"): MemoryRecord {
  return {
    id,
    status: "approved",
    text,
    category: "preference",
    scope: { type: "global" },
    source: "manual",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    kind,
  }
}

function projectMemory(id: string, project: string, text: string, kind: MemoryRecord["kind"] = "project_fact"): MemoryRecord {
  return {
    id,
    status: "approved",
    text,
    category: "project",
    scope: { type: "project", key: project },
    source: "manual",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    kind,
  }
}

function recall(memories: MemoryRecord[], used = false, fallbackReason?: string): RecallResult {
  return {
    memories,
    semantic: { enabled: used, used, fallbackReason },
  }
}

function continuityHints(overrides: Partial<ContinuityHintSummary> = {}): ContinuityHintSummary {
  return {
    projectScope: "repo",
    hintCount: 2,
    hints: [
      {
        code: "newer-approved",
        severity: "info",
        message: "PRIVATE MESSAGE SHOULD NOT RENDER",
        count: 2,
        memoryIds: ["newer-secret-id"],
        suggestedActions: ["memory-lane status --json --since 2026-06-18T00:00:00.000Z"],
      },
      {
        code: "superseded-visible",
        severity: "review",
        message: "PRIVATE SUPERSEDED MESSAGE SHOULD NOT RENDER",
        count: 1,
        memoryIds: ["old-secret-id"],
        suggestedActions: ["memory-lane dashboard"],
      },
    ],
    supersededVisible: [{
      id: "old-secret-id",
      status: "approved",
      category: "project",
      scope: { type: "project", key: "repo" },
      source: "manual",
      createdAt: "2026-06-17T00:00:00.000Z",
      updatedAt: "2026-06-17T00:00:00.000Z",
      kind: "workflow_rule",
      supersededBy: "new-secret-id",
    }],
    scopeHygieneCandidates: [],
    operatingAgreementOverlaps: [],
    projectGlobalPreferenceOverlaps: [],
    newerApproved: {
      referenceTime: "2026-06-18T00:00:00.000Z",
      count: 2,
      newestIds: ["newer-secret-id"],
    },
    suggestedActions: [
      "memory-lane status --json --since 2026-06-18T00:00:00.000Z",
      "memory-lane dashboard",
    ],
    notes: ["PRIVATE NOTE SHOULD NOT RENDER"],
    ...overrides,
  }
}

function operatingAgreements(overrides: Partial<OperatingAgreementSummary> = {}): OperatingAgreementSummary {
  return {
    projectScope: "repo",
    primaryCount: 1,
    relatedCandidateCount: 0,
    omittedPrimaryCount: 0,
    omittedRelatedCandidateCount: 0,
    workflowAreas: ["project-loop"],
    primary: [{
      id: "agreement-secret-id",
      category: "project",
      scope: { type: "project", key: "repo" },
      source: "manual",
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
      kind: "workflow_rule",
      workflowArea: "project-loop",
      matchReason: "explicit-kind",
    }],
    relatedCandidates: [],
    notes: [],
    ...overrides,
  }
}

test("detects resume/build continuity intents with topic", () => {
  assert.deepEqual(detectContinuityIntent("Let's resume building prompt continuity intents"), {
    detected: true,
    family: "resume",
    topic: "prompt continuity intents",
  })
  assert.deepEqual(detectContinuityIntent("continue working on lifecycle notices"), {
    detected: true,
    family: "resume",
    topic: "lifecycle notices",
  })
  assert.deepEqual(detectContinuityIntent("Pick up the dashboard slice again!"), {
    detected: true,
    family: "resume",
    topic: "dashboard slice",
  })
})

test("detects prior-work lookup continuity intents with topic", () => {
  assert.deepEqual(detectContinuityIntent("Where was lifecycle continuity implemented?"), {
    detected: true,
    family: "lookup",
    topic: "lifecycle continuity",
  })
  assert.deepEqual(detectContinuityIntent("Find the session where prompt intents happened"), {
    detected: true,
    family: "lookup",
    topic: "prompt intents",
  })
  assert.deepEqual(detectContinuityIntent("Find the thread where we built prompt continuity"), {
    detected: true,
    family: "lookup",
    topic: "prompt continuity",
  })
})

test("detects project-position and next-work continuity intents", () => {
  assert.deepEqual(detectContinuityIntent("Where are we in the project?"), {
    detected: true,
    family: "project-position",
  })
  assert.deepEqual(detectContinuityIntent("What's the latest progress?"), {
    detected: true,
    family: "project-position",
  })
  assert.deepEqual(detectContinuityIntent("What should we work on next?"), {
    detected: true,
    family: "next-work",
  })
  assert.deepEqual(detectContinuityIntent("What's the next slice?"), {
    detected: true,
    family: "next-work",
  })
})

test("does not detect ordinary prompts as continuity intents", () => {
  assert.deepEqual(detectContinuityIntent("How do I run tests?"), { detected: false })
  assert.deepEqual(detectContinuityIntent("Use pnpm for installs"), { detected: false })
})

test("renders text-free continuity intent guidance", () => {
  const guidance = renderContinuityIntentGuidance({
    detected: true,
    family: "lookup",
    topic: "lifecycle continuity",
  })

  assert.match(guidance, /Memory Lane continuity guidance/u)
  assert.match(guidance, /prior or ongoing project work/u)
  assert.match(guidance, /memory-lane continuity --json/u)
  assert.match(guidance, /memory_continuity\(\{ projectPath \}\)/u)
  assert.match(guidance, /Do not answer from memory_recall alone/u)
  assert.match(guidance, /memory-lane status --json/u)
  assert.match(guidance, /memory-lane dashboard/u)
  assert.match(guidance, /memory-lane recall 'lifecycle continuity'/u)
  assert.doesNotMatch(guidance, /operating agreement/u)
  assert.doesNotMatch(guidance, /continuity hint/u)
  assert.doesNotMatch(guidance, /raw transcript|tool output/iu)
})

test("shell-quotes continuity recall topics with shell metacharacters", () => {
  const topic = 'release $(touch /tmp/pwn) `whoami` \\tmp\\pwn "quoted" user\'s slice'
  const guidance = renderContinuityIntentGuidance({
    detected: true,
    family: "lookup",
    topic,
  })
  const expectedRecall = "- memory-lane recall 'release $(touch /tmp/pwn) `whoami` \\tmp\\pwn \"quoted\" user'\\''s slice'"

  assert.ok(guidance.split("\n").includes(expectedRecall), guidance)
  assert.doesNotMatch(guidance, /memory-lane recall "/u)
  assert.doesNotMatch(guidance, /memory-lane recall ".*\$\(/u)
  assert.doesNotMatch(guidance, /memory-lane recall ".*`whoami`/u)
})

test("renders broad continuity guidance without topic recall", () => {
  const guidance = renderContinuityIntentGuidance({
    detected: true,
    family: "next-work",
  })

  assert.match(guidance, /memory-lane continuity --json/u)
  assert.match(guidance, /memory_continuity\(\{ projectPath \}\)/u)
  assert.match(guidance, /Do not answer from memory_recall alone/u)
  assert.match(guidance, /memory-lane status --json/u)
  assert.match(guidance, /memory-lane dashboard/u)
  assert.match(guidance, /review current plan, roadmap, and review queue/u)
  assert.doesNotMatch(guidance, /memory-lane recall/u)
})

test("skips generic prompts", () => {
  for (const prompt of ["", "   ", "ok", "okay", "yes", "continue", "sounds good", "thank you"]) {
    assert.equal(shouldSkipAutomaticInjection(prompt), true, prompt)
  }
  assert.equal(shouldSkipAutomaticInjection("how do we run tests in this repo"), false)
})

test("selects at most maxItems and enforces budget", () => {
  const memories = Array.from({ length: 10 }, (_, i) => memory(String(i), `This repo uses pnpm for tests ${i}`))
  const selected = selectMemoriesForInjection("pnpm tests", recall(memories), {
    ...CODEX_MEMORY_INJECTION_LIMITS,
    maxItems: 3,
    hardMaxChars: 120,
  })
  assert.equal(selected.length, 3)
  assert.ok(selected.reduce((sum, m) => sum + m.text.length, 0) <= 120)
})

test("caps configured hard budget at absolute maximum", () => {
  const longText = `This repo uses pnpm. ${"More pnpm details. ".repeat(500)}`
  const selected = selectMemoriesForInjection("pnpm", recall([memory("1", longText)], true), {
    maxItems: 1,
    targetChars: 10_000,
    hardMaxChars: 10_000,
    absoluteMaxChars: 10_000,
  })
  assert.equal(selected.length, 1)
  assert.ok(selected[0].text.length <= CODEX_MEMORY_INJECTION_LIMITS.absoluteMaxChars)
})

test("does not inject lexical fallback memories with no overlap", () => {
  const selected = selectMemoriesForInjection(
    "deploy workers",
    recall([memory("1", "This repo uses pnpm for tests")], false),
  )
  assert.deepEqual(selected, [])
})

test("requires lexical overlap when semantic fallback reports no matches", () => {
  const selected = selectMemoriesForInjection(
    "deploy workers",
    recall([memory("1", "This repo uses pnpm for tests")], true, "No semantic matches"),
  )
  assert.deepEqual(selected, [])
})

test("deduplicates normalized text and skips likely secrets", () => {
  const selected = selectMemoriesForInjection("pnpm", recall([
    memory("1", "This repo uses pnpm"),
    memory("2", "This repo uses pnpm."),
    memory("3", "API key is sk-1234567890abcdef1234567890abcdef"),
  ], true))
  assert.deepEqual(selected.map((m) => m.id), ["1"])
})

test("renderMemoryBlock groups current project and global memories with readable labels", () => {
  const rendered = renderMemoryBlock([
    projectMemory("p1", "repo", "Latest Sitewright checkpoint", "project_checkpoint"),
    globalMemory("g1", "Always keep HANDOFF.md synced", "workflow_rule"),
  ], { projectScope: "repo" })

  assert.match(rendered, /## Relevant Memory/u)
  assert.match(rendered, /Memory Lane selected these approved memories/u)
  assert.match(rendered, /### Current project/u)
  assert.match(rendered, /\*\*Project checkpoint\*\*/u)
  assert.match(rendered, /Latest Sitewright checkpoint/u)
  assert.match(rendered, /### Global preferences and workflow rules/u)
  assert.match(rendered, /\*\*Workflow rule\*\*/u)
  assert.match(rendered, /Always keep HANDOFF\.md synced/u)
  assert.doesNotMatch(rendered, /\[global\/preference\/workflow_rule\]/u)
})

test("renderMemoryBlock labels project memories when current project scope is unknown", () => {
  const rendered = renderMemoryBlock([
    projectMemory("p1", "/tmp/sitewright", "This repo uses pnpm", "project_fact"),
  ])

  assert.match(rendered, /### Project-specific memory/u)
  assert.match(rendered, /\*\*Project fact\*\*/u)
  assert.match(rendered, /This repo uses pnpm/u)
})

test("renderMemoryBlock separates other visible project memories", () => {
  const rendered = renderMemoryBlock([
    projectMemory("p1", "/tmp/other", "Memory system design intent", "project_fact"),
  ], { projectScope: "/tmp/sitewright" })

  assert.match(rendered, /### Other visible project memory/u)
  assert.match(rendered, /\*\*Project fact\*\*/u)
  assert.match(rendered, /Memory system design intent/u)
})

test("renderContinuityNotice renders plain-language notice without ids or private text", () => {
  const result = renderContinuityNotice({
    hints: continuityHints(),
    operatingAgreements: operatingAgreements(),
    since: "2026-06-18T00:00:00.000Z",
    maxChars: 900,
  })

  assert.equal(result.generated, true)
  assert.equal(result.injected, true)
  assert.match(result.text, /^Continuity notice:/u)
  assert.match(result.text, /There is newer approved Memory Lane state/u)
  assert.match(result.text, /Current workflow agreements are available/u)
  assert.match(result.text, /Some approved memories are superseded historical guidance/u)
  assert.match(result.text, /If relevant, inspect before proceeding:/u)
  assert.match(result.text, /memory-lane dashboard/u)
  assert.match(result.text, /memory-lane agreements/u)
  assert.doesNotMatch(result.text, /secret-id|PRIVATE/u)
  assert.deepEqual(result.suggestedActions, [
    "memory-lane status --json --since 2026-06-18T00:00:00.000Z",
    "memory-lane dashboard",
    "memory-lane agreements",
  ])
})

test("renderContinuityNotice omits unsafe suggested action text", () => {
  const result = renderContinuityNotice({
    hints: continuityHints({
      suggestedActions: [
        "memory-lane dashboard --note PRIVATE SHOULD NOT RENDER",
        "memory-lane status --json --since 2026-06-18T00:00:00.000Z newer-secret-id",
        "memory-lane dashboard",
      ],
    }),
    since: "2026-06-18T00:00:00.000Z",
    maxChars: 900,
  })

  assert.equal(result.injected, true)
  assert.match(result.text, /memory-lane dashboard/u)
  assert.doesNotMatch(result.text, /PRIVATE|secret-id/u)
  assert.deepEqual(result.suggestedActions, [
    "memory-lane status --json --since 2026-06-18T00:00:00.000Z",
    "memory-lane dashboard",
  ])
})

test("renderContinuityNotice renders project/global preference overlap from hint code", () => {
  const result = renderContinuityNotice({
    hints: continuityHints({
      hintCount: 1,
      hints: [{
        code: "project-global-overlap",
        severity: "info",
        message: "PRIVATE PROJECT/GLOBAL OVERLAP MESSAGE SHOULD NOT RENDER",
        count: 2,
        memoryIds: ["project-pref-secret-id", "global-pref-secret-id"],
        workflowArea: "pr-process",
        suggestedActions: ["memory-lane dashboard"],
      }],
      supersededVisible: [],
      operatingAgreementOverlaps: [],
      projectGlobalPreferenceOverlaps: [{
        workflowArea: "pr-process",
        projectIds: ["project-pref-secret-id"],
        globalIds: ["global-pref-secret-id"],
      }],
      newerApproved: undefined,
      suggestedActions: [],
      notes: ["PRIVATE NOTE SHOULD NOT RENDER"],
    }),
    operatingAgreements: operatingAgreements({ primaryCount: 0, workflowAreas: [], primary: [] }),
    maxChars: 900,
  })

  assert.equal(result.generated, true)
  assert.equal(result.injected, true)
  assert.equal(result.operatingAgreementPrimaryCount, 0)
  assert.deepEqual(result.hintCodes, ["project-global-overlap"])
  assert.match(result.text, /Project and global preferences may overlap/u)
  assert.match(result.text, /Inspect Memory Lane before choosing which preference applies/u)
  assert.match(result.text, /memory-lane dashboard/u)
  assert.doesNotMatch(result.text, /Current workflow agreements are available/u)
  assert.doesNotMatch(result.text, /project-pref-secret-id|global-pref-secret-id|PRIVATE/u)
})

test("renderContinuityNotice returns not generated when there are no signals", () => {
  const result = renderContinuityNotice({
    hints: continuityHints({ hintCount: 0, hints: [], supersededVisible: [], newerApproved: undefined, suggestedActions: [] }),
    operatingAgreements: operatingAgreements({ primaryCount: 0, workflowAreas: [], primary: [] }),
    maxChars: 900,
  })

  assert.equal(result.generated, false)
  assert.equal(result.injected, false)
  assert.equal(result.text, "")
})

test("renderContinuityNotice respects tight budget", () => {
  const result = renderContinuityNotice({
    hints: continuityHints(),
    operatingAgreements: operatingAgreements(),
    since: "2026-06-18T00:00:00.000Z",
    maxChars: 40,
  })

  assert.equal(result.generated, true)
  assert.equal(result.injected, false)
  assert.equal(result.text, "")
  assert.deepEqual(result.omittedReasons, ["continuity-budget"])
})

test("renderMemoryContext wraps grouped readable memories in guarded context", () => {
  const rendered = renderMemoryContext({
    event: "prompt",
    memories: [
      projectMemory("p1", "repo", "Latest Sitewright checkpoint", "project_checkpoint"),
      globalMemory("g1", "Keep next steps constrained", "preference"),
    ],
    projectScope: "repo",
  })

  assert.match(rendered, /^<memory-context mode="selective" event="prompt">/u)
  assert.match(rendered, /### Current project/u)
  assert.match(rendered, /\*\*Project checkpoint\*\*/u)
  assert.match(rendered, /### Global preferences and workflow rules/u)
  assert.match(rendered, /\*\*Preference\*\*/u)
  assert.match(rendered, /<\/memory-context>$/u)
})

test("renderMemoryContext policy-only injects guidance without memory bodies", () => {
  const rendered = renderMemoryContext({
    event: "sessionStart",
    memories: [memory("abc123", "This repo uses pnpm")],
    policy: { mode: "policy-only", maxItems: { sessionStart: 4, prompt: 6 }, maxChars: { sessionStart: 1600, prompt: 3000 }, includePending: false, fallbackToSearch: true },
  })
  assert.match(rendered, /mode="policy-only"/u)
  assert.match(rendered, /Use Memory Lane recall\/list tools/u)
  assert.doesNotMatch(rendered, /This repo uses pnpm/u)
})

test("renderMemoryContext off returns empty context", () => {
  const rendered = renderMemoryContext({
    event: "prompt",
    memories: [memory("abc123", "This repo uses pnpm")],
    policy: { mode: "off", maxItems: { sessionStart: 4, prompt: 6 }, maxChars: { sessionStart: 1600, prompt: 3000 }, includePending: false, fallbackToSearch: true },
  })
  assert.equal(rendered, "")
})

function memoryWithUpdatedAt(id: string, text: string, updatedAt: string): MemoryRecord {
  return { ...memory(id, text), updatedAt }
}

function globalMemoryWithUpdatedAt(id: string, text: string, updatedAt: string): MemoryRecord {
  return { ...globalMemory(id, text), updatedAt }
}

function projectMemoryWithUpdatedAt(id: string, project: string, text: string, updatedAt: string): MemoryRecord {
  return { ...projectMemory(id, project, text), updatedAt }
}

test("selectBaselineMemories picks recent approved memories within budget", () => {
  const memories = [
    memoryWithUpdatedAt("1", "This repo uses pnpm for package management.", "2026-06-10T00:00:00.000Z"),
    memoryWithUpdatedAt("2", "Run tests with `pnpm test`.", "2026-06-14T00:00:00.000Z"),
    memoryWithUpdatedAt("3", "User prefers concise plans.", "2026-06-13T00:00:00.000Z"),
    memoryWithUpdatedAt("4", "Build with `pnpm build`.", "2026-06-12T00:00:00.000Z"),
    memoryWithUpdatedAt("5", "Legacy memory that should not appear.", "2026-06-01T00:00:00.000Z"),
  ]

  const selected = selectBaselineMemories(memories, {
    maxItems: 3,
    targetChars: 200,
    hardMaxChars: 300,
    absoluteMaxChars: 500,
  })

  assert.deepEqual(selected.map((m) => m.id), ["2", "3", "4"])
})

test("selectBaselineMemories prefers current project memories before newer globals", () => {
  const memories = [
    globalMemoryWithUpdatedAt("global-newest", "Global preference newest", "2026-06-19T00:00:00.000Z"),
    globalMemoryWithUpdatedAt("global-newer", "Global preference newer", "2026-06-18T00:00:00.000Z"),
    projectMemoryWithUpdatedAt("project-checkpoint", "/repo/sitewright", "Latest Sitewright checkpoint", "2026-06-16T00:00:00.000Z"),
    projectMemoryWithUpdatedAt("project-fact", "/repo/sitewright", "Sitewright uses pnpm", "2026-06-15T00:00:00.000Z"),
  ]

  const selected = selectBaselineMemories(memories, {
    projectScope: "/repo/sitewright",
    maxItems: 3,
    targetChars: 500,
    hardMaxChars: 1000,
    absoluteMaxChars: 1000,
  })

  assert.deepEqual(selected.map((m) => m.id), ["project-checkpoint", "project-fact", "global-newest"])
})

test("selectBaselineMemories keeps recency order within project and global tiers", () => {
  const memories = [
    projectMemoryWithUpdatedAt("project-old", "/repo/sitewright", "Older project fact", "2026-06-12T00:00:00.000Z"),
    globalMemoryWithUpdatedAt("global-new", "New global preference", "2026-06-19T00:00:00.000Z"),
    projectMemoryWithUpdatedAt("project-new", "/repo/sitewright", "Newer project fact", "2026-06-18T00:00:00.000Z"),
    globalMemoryWithUpdatedAt("global-old", "Old global preference", "2026-06-10T00:00:00.000Z"),
    projectMemoryWithUpdatedAt("other-project", "/repo/other", "Other project fact", "2026-06-20T00:00:00.000Z"),
  ]

  const selected = selectBaselineMemories(memories, {
    projectScope: "/repo/sitewright",
    maxItems: 5,
    targetChars: 500,
    hardMaxChars: 1000,
    absoluteMaxChars: 1000,
  })

  assert.deepEqual(selected.map((m) => m.id), ["project-new", "project-old", "global-new", "global-old", "other-project"])
})

test("selectBaselineMemories skips secrets and deduplicates", () => {
  const memories = [
    memoryWithUpdatedAt("1", "API key is sk-1234567890abcdef1234567890abcdef", "2026-06-14T00:00:00.000Z"),
    memoryWithUpdatedAt("2", "This repo uses pnpm.", "2026-06-13T00:00:00.000Z"),
    memoryWithUpdatedAt("3", "This repo uses pnpm.", "2026-06-12T00:00:00.000Z"),
  ]

  const selected = selectBaselineMemories(memories, {
    maxItems: 4,
    targetChars: 500,
    hardMaxChars: 1000,
    absoluteMaxChars: 1000,
  })

  assert.deepEqual(selected.map((m) => m.id), ["2"])
})
