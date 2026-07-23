import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import assert from "node:assert"
import { MemoryEngine } from "@memory-lane/core"
import { handlePreCompact, handleSessionEnd, saveSessionSummaryCandidates } from "../src/session-end.js"
import type { LLMProvider } from "../src/types.js"

function makeEngine(): MemoryEngine {
  return new MemoryEngine({
    memoryPath: `/tmp/ml-session-end-${Date.now()}.jsonl`,
    embeddingsPath: `/tmp/ml-session-end-${Date.now()}-embeddings.jsonl`,
    configPath: `/tmp/ml-session-end-${Date.now()}-config.json`,
  })
}

test("returns empty when requireConfirmation is true and not confirmed", async () => {
  const engine = makeEngine()
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    messages: [{ role: "user", content: "hello" }],
  }, { requireConfirmation: true, confirmed: false })
  assert.deepStrictEqual(result, [])
})

test("pre-compact returns empty when requireConfirmation is true and not confirmed", async () => {
  const engine = makeEngine()
  let called = false
  const provider: LLMProvider = {
    async complete() {
      called = true
      return "- Should not be generated."
    },
  }
  const result = await handlePreCompact(engine, {
    cwd: "/tmp",
    sessionId: "s-pre-consent",
    trigger: "auto",
    messages: [{ role: "user", content: "hello" }],
  }, { requireConfirmation: true, confirmed: false, provider })
  assert.deepStrictEqual(result, [])
  assert.equal(called, false)
})

test("returns empty when LLM reports NO_DURABLE_MEMORY", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = { complete: async () => "NO_DURABLE_MEMORY" }
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    messages: [{ role: "user", content: "hello" }],
  }, { requireConfirmation: false, provider })
  assert.deepStrictEqual(result, [])
})

test("returns empty when LLM reports lowercase no durable memory with punctuation", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = { complete: async () => "no_durable_memory." }
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    messages: [{ role: "user", content: "hello" }],
  }, { requireConfirmation: false, provider })
  assert.deepStrictEqual(result, [])
})

test("returns a pending session-summary candidate", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = { complete: async () => "- Decided to use pnpm.\n- Next: update docs." }
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    sessionId: "s1",
    messages: [
      { role: "user", content: "Use pnpm" },
      { role: "assistant", content: "OK, switched to pnpm." },
    ],
  }, { requireConfirmation: false, provider })
  assert.strictEqual(result.length, 1)
  const candidate = result[0]
  assert.ok(candidate.text.startsWith("## Session Summary"))
  assert.ok(candidate.text.includes("Decided to use pnpm"))
  assert.strictEqual(candidate.source, "session-summary")
  assert.strictEqual(candidate.kind, "session_summary")
  assert.strictEqual(candidate.status, "pending")
  assert.equal(candidate.freshness, undefined)
  assert.strictEqual(candidate.provenance.lifecycleEvent, "session_end")
  assert.strictEqual(candidate.provenance.sessionId, "s1")
})

test("pre-compact preserves an unrepresented bare merge as session narrative", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = { complete: async () => "- PR #201 merged." }

  const result = await handlePreCompact(engine, {
    cwd: "/tmp",
    sessionId: "s-bare-narrative",
    turnId: "t-bare-narrative",
    messages: [{ role: "assistant", content: "Merge completed." }],
  }, { provider, adapter: "codex", requireConfirmation: false })

  assert.equal(result.length, 1)
  assert.ok(result[0].text.split("\n").includes("- PR #201 merged."))
})

test("pre-compact coalesces equivalent checkpoint bullets within one summary", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = {
    complete: async () => [
      "- PR #201 merged.",
      "- Pull request 201 was merged.",
      "- Next steps: validate summary deduplication.",
    ].join("\n"),
  }

  const result = await handlePreCompact(engine, {
    cwd: "/tmp",
    sessionId: "s-summary-dedupe",
    turnId: "t-summary-dedupe",
    messages: [{ role: "assistant", content: "Merge completed." }],
  }, { provider, adapter: "codex", requireConfirmation: false })

  assert.equal(result.length, 1)
  assert.ok(result[0].text.split("\n").includes("- PR #201 merged."))
  assert.doesNotMatch(result[0].text, /Pull request 201/iu)
  assert.equal(result[0].text.match(/\bmerged\b/giu)?.length, 1)
  assert.match(result[0].text, /validate summary deduplication/iu)
})

test("pre-compact removes a canonical merge already represented by a checkpoint", async () => {
  const engine = makeEngine()
  engine.refreshScope("/tmp")
  engine.save({
    text: "PR #201 merged with canonical checkpoint identity and regression coverage.",
    category: "project",
    scopeType: "project",
    status: "pending",
    source: "agent-suggested",
    kind: "project_checkpoint",
  })
  const provider: LLMProvider = {
    complete: async () => [
      "- Pull request 201 was merged with canonical checkpoint identity and regression coverage.",
      "- Next steps: validate the lifecycle package.",
    ].join("\n"),
  }

  const result = await handlePreCompact(engine, {
    cwd: "/tmp",
    sessionId: "s-cross-lifecycle",
    turnId: "t-cross-lifecycle",
    messages: [{ role: "assistant", content: "Implementation and tests completed." }],
  }, { provider, adapter: "codex", requireConfirmation: false })

  assert.deepStrictEqual(result, [])
})

test("pre-compact checkpoint filtering is pure and does not enrich pending storage", async () => {
  const engine = makeEngine()
  engine.refreshScope("/tmp")
  const provisional = engine.save({
    text: "PR #201 merged.",
    category: "project",
    scopeType: "project",
    status: "pending",
    source: "agent-suggested",
    kind: "project_checkpoint",
  })
  if (provisional.status !== "saved") throw new Error("expected checkpoint")
  const provider: LLMProvider = {
    complete: async () => [
      "- PR #201 merged with canonical checkpoint identity and regression coverage.",
      "- Next steps: validate summary filtering.",
    ].join("\n"),
  }

  const result = await handlePreCompact(engine, {
    cwd: "/tmp",
    sessionId: "s-pure-filter",
    turnId: "t-pure-filter",
    messages: [{ role: "assistant", content: "Implementation completed." }],
  }, { provider, adapter: "codex", requireConfirmation: false })

  assert.deepStrictEqual(result, [])
  const stored = engine.list({ status: "pending" }).find((memory) => memory.id === provisional.memory.id)
  assert.equal(stored?.text, provisional.memory.text)
  assert.equal(stored?.updatedAt, provisional.memory.updatedAt)
})

test("pre-compact preserves a novel compound event while removing its duplicate identity", async () => {
  const engine = makeEngine()
  engine.refreshScope("/tmp")
  engine.save({
    text: "PR #201 merged with canonical checkpoint identity.",
    category: "project",
    scopeType: "project",
    status: "approved",
    source: "agent-suggested",
    kind: "project_checkpoint",
  })
  const provider: LLMProvider = {
    complete: async () => "- PR #201 merged with canonical checkpoint identity and released v0.9.1.",
  }

  const result = await handlePreCompact(engine, {
    cwd: "/tmp",
    sessionId: "s-compound",
    turnId: "t-compound",
    messages: [{ role: "assistant", content: "Release completed." }],
  }, { provider, adapter: "codex", requireConfirmation: false })

  assert.equal(result.length, 1)
  assert.doesNotMatch(result[0].text, /PR #201/iu)
  assert.ok(result[0].text.split("\n").includes("- Released v0.9.1."))
})

test("pre-compact does not recreate a rejected canonical merge event", async () => {
  const engine = makeEngine()
  engine.refreshScope("/tmp")
  const saved = engine.save({
    text: "PR #201 merged with canonical checkpoint identity and regression coverage.",
    category: "project",
    scopeType: "project",
    status: "pending",
    source: "agent-suggested",
    kind: "project_checkpoint",
  })
  if (saved.status !== "saved") throw new Error("expected checkpoint")
  engine.reject(saved.memory.id)
  const provider: LLMProvider = {
    complete: async () => "- PR #201 merged with canonical checkpoint identity and regression coverage.",
  }

  const result = await handlePreCompact(engine, {
    cwd: "/tmp",
    sessionId: "s-rejected",
    turnId: "t-rejected",
    messages: [{ role: "assistant", content: "Implementation completed." }],
  }, { provider, adapter: "codex", requireConfirmation: false })

  assert.deepStrictEqual(result, [])
  assert.equal(engine.list({ status: "pending" }).length, 0)
})

test("returns a pending pre-compact session-summary candidate", async () => {
  const engine = makeEngine()
  let captured = ""
  const provider: LLMProvider = {
    async complete(prompt) {
      captured = prompt
      return "- Decisions made: keep pre-compact continuity."
    },
  }
  const result = await handlePreCompact(engine, {
    cwd: "/tmp",
    sessionId: "s-pre",
    turnId: "t-pre",
    trigger: "auto",
    messages: [{ role: "user", content: "continue after compaction" }],
  }, { provider, adapter: "codex", requireConfirmation: true, confirmed: true })
  assert.strictEqual(result.length, 1)
  assert.match(captured, /before the host compacts/u)
  assert.match(captured, /continue after compaction/u)
  assert.strictEqual(result[0].kind, "session_summary")
  assert.strictEqual(result[0].status, "pending")
  assert.strictEqual(result[0].provenance.adapter, "codex")
  assert.strictEqual(result[0].provenance.lifecycleEvent, "pre_compact")
  assert.strictEqual(result[0].provenance.sessionId, "s-pre")
  assert.strictEqual(result[0].provenance.turnId, "t-pre")
})

test("skips duplicate pre-compact summary for same adapter session and turn", async () => {
  const engine = makeEngine()
  engine.save({
    text: "## Session Summary (2026-06-20)\n\n- Decisions made: previous content.",
    category: "project",
    scopeType: "global",
    status: "pending",
    source: "session-summary",
    kind: "session_summary",
    provenance: { adapter: "codex", lifecycleEvent: "pre_compact", sessionId: "s1", turnId: "t1" },
  })
  const provider: LLMProvider = { complete: async () => "- Decisions made: new content that would otherwise be distinct." }
  const result = await handlePreCompact(engine, {
    cwd: "/tmp",
    sessionId: "s1",
    turnId: "t1",
    trigger: "auto",
    messages: [{ role: "user", content: "summarize before compact" }],
  }, { provider, adapter: "codex", requireConfirmation: false })
  assert.deepStrictEqual(result, [])
})

test("uses message digest as pre-compact provenance fallback when turn id is absent", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = { complete: async () => "- Decisions made: fallback key." }
  const result = await handlePreCompact(engine, {
    cwd: "/tmp",
    sessionId: "s-trigger",
    trigger: "manual",
    messages: [{ role: "user", content: "summarize before compact" }],
  }, { provider, adapter: "claude", requireConfirmation: false })
  assert.strictEqual(result.length, 1)
  assert.match(result[0].provenance.turnId ?? "", /^messages-[a-f0-9]{16}$/u)
})

test("keeps distinct pre-compact summaries without turn ids", async () => {
  const engine = makeEngine()
  engine.save({
    text: "## Session Summary (2026-06-20)\n\n- Decisions made: first compact.",
    category: "project",
    scopeType: "global",
    status: "pending",
    source: "session-summary",
    kind: "session_summary",
    provenance: { adapter: "codex", lifecycleEvent: "pre_compact", sessionId: "s1", turnId: "messages-0eaf8bb3a48a6e9a" },
  })
  const provider: LLMProvider = { complete: async () => "- Decisions made: second compact." }
  const result = await handlePreCompact(engine, {
    cwd: "/tmp",
    sessionId: "s1",
    trigger: "auto",
    messages: [{ role: "user", content: "second pre-compact context" }],
  }, { provider, adapter: "codex", requireConfirmation: false })
  assert.strictEqual(result.length, 1)
  assert.match(result[0].provenance.turnId ?? "", /^messages-[a-f0-9]{16}$/u)
  assert.notEqual(result[0].provenance.turnId, "messages-0eaf8bb3a48a6e9a")
})

test("sets capturedAt from the latest valid message timestamp", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = { complete: async () => "- Captured temporal context." }
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    messages: [
      { role: "user", content: "Start", timestamp: "2026-06-20T10:00:00.000Z" },
      { role: "assistant", content: "Middle", timestamp: "not-a-date" },
      { role: "user", content: "End", timestamp: "2026-06-20T11:30:00.000Z" },
    ],
  }, { requireConfirmation: false, provider })
  assert.strictEqual(result.length, 1)
  assert.deepStrictEqual(result[0].freshness, { capturedAt: "2026-06-20T11:30:00.000Z" })
})

test("omits capturedAt when messages have no valid ISO timestamps", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = { complete: async () => "- No trustworthy source timestamp." }
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    messages: [
      { role: "user", content: "Start", timestamp: "2026-06-20" },
      { role: "assistant", content: "Done", timestamp: "not-a-date" },
    ],
  }, { requireConfirmation: false, provider })
  assert.strictEqual(result.length, 1)
  assert.equal(result[0].freshness, undefined)
})

test("duplicate session summary detection still works when candidate has freshness", async () => {
  const engine = makeEngine()
  engine.save({
    text: "## Session Summary (2026-06-20)\n\n- Decisions made: keep summaries explicit.",
    category: "project",
    scopeType: "global",
    status: "pending",
    source: "session-summary",
    kind: "session_summary",
  })
  const provider: LLMProvider = { complete: async () => "- Decisions made: keep summaries explicit." }
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    messages: [{ role: "user", content: "summarize", timestamp: "2026-06-20T11:30:00.000Z" }],
  }, { requireConfirmation: false, provider })
  assert.deepStrictEqual(result, [])
})

test("skips duplicate session summary for same adapter and session id", async () => {
  const engine = makeEngine()
  engine.save({
    text: "## Session Summary (2026-06-20)\n\n- Decided to use pnpm.",
    category: "project",
    scopeType: "global",
    status: "pending",
    source: "session-summary",
    kind: "session_summary",
    provenance: { adapter: "codex", lifecycleEvent: "session_end", sessionId: "s1" },
  })
  const provider: LLMProvider = { complete: async () => "- Decided to use pnpm.\n- Next: update docs." }
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    sessionId: "s1",
    messages: [{ role: "user", content: "summarize this session" }],
  }, { requireConfirmation: false, provider, adapter: "codex" })
  assert.deepStrictEqual(result, [])
})

test("structured session summaries short-circuit repeated session-end and pre-compact runs", async () => {
  for (const lifecycleEvent of ["session_end", "pre_compact"] as const) {
    const engine = makeEngine()
    let calls = 0
    const provider: LLMProvider = {
      async complete() {
        calls += 1
        return "## Decisions made\n- Structured summaries must be deduplicated before provider invocation."
      },
    }
    const sessionId = `structured-${lifecycleEvent}`
    const input = {
      cwd: "/tmp",
      sessionId,
      messages: [{ role: "assistant" as const, content: "Structured summary source." }],
    }
    const first = lifecycleEvent === "pre_compact"
      ? await handlePreCompact(engine, { ...input, turnId: "turn-1" }, { requireConfirmation: false, provider, adapter: "test" })
      : await handleSessionEnd(engine, input, { requireConfirmation: false, provider, adapter: "test" })
    assert.ok(first.length > 0)
    saveSessionSummaryCandidates(engine, first)

    const repeated = lifecycleEvent === "pre_compact"
      ? await handlePreCompact(engine, { ...input, turnId: "turn-1" }, { requireConfirmation: false, provider, adapter: "test" })
      : await handleSessionEnd(engine, input, { requireConfirmation: false, provider, adapter: "test" })
    assert.deepStrictEqual(repeated, [])
    assert.equal(calls, 1, `${lifecycleEvent} should return before invoking the provider again`)
  }
})

test("superseded session summaries do not block replacement capture", async () => {
  const engine = makeEngine()
  engine.refreshScope("/tmp")
  const obsolete = engine.save({
    text: "Windows recovery must preserve quoted arguments.",
    category: "project",
    scopeType: "project",
    status: "pending",
    source: "session-summary",
    kind: "session_summary",
    provenance: { adapter: "test", lifecycleEvent: "session_end", sessionId: "replacement-session" },
  })
  const successor = engine.save({
    text: "Issue #215 completed.",
    category: "project",
    scopeType: "project",
    status: "pending",
    source: "session-summary",
    kind: "project_checkpoint",
    provenance: { adapter: "test", lifecycleEvent: "session_end", sessionId: "completion-session" },
  })
  assert.equal(obsolete.status, "saved")
  assert.equal(successor.status, "saved")
  if (obsolete.status !== "saved" || successor.status !== "saved") return
  engine.supersedePendingHandoffs(successor.memory.id, [obsolete.memory.id], "Issue completed")

  let calls = 0
  const provider: LLMProvider = {
    async complete() {
      calls += 1
      return "## Decisions made\n- Windows recovery must preserve quoted arguments."
    },
  }
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    sessionId: "replacement-session",
    messages: [{ role: "assistant", content: "A new handoff was captured." }],
  }, { requireConfirmation: false, provider, adapter: "test" })

  assert.equal(calls, 1)
  assert.equal(result.length, 1)
  assert.equal(result[0].kind, "decision")
})

test("skips duplicate session summary with equivalent durable content despite heading date", async () => {
  const engine = makeEngine()
  engine.save({
    text: "## Session Summary (2026-06-20)\n\n- Decisions made: keep summaries explicit.\n- Next steps: update docs.",
    category: "project",
    scopeType: "global",
    status: "approved",
    source: "session-summary",
    kind: "session_summary",
  })
  const provider: LLMProvider = { complete: async () => "- Decisions made: keep summaries explicit.\n- Next steps: update docs." }
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    sessionId: "different-session",
    messages: [{ role: "user", content: "summarize this session" }],
  }, { requireConfirmation: false, provider, adapter: "pi" })
  assert.deepStrictEqual(result, [])
})

test("keeps distinct session summary with different session id and content", async () => {
  const engine = makeEngine()
  engine.save({
    text: "## Session Summary (2026-06-20)\n\n- Decisions made: keep summaries explicit.",
    category: "project",
    scopeType: "global",
    status: "pending",
    source: "session-summary",
    kind: "session_summary",
    provenance: { adapter: "codex", lifecycleEvent: "session_end", sessionId: "s1" },
  })
  const provider: LLMProvider = { complete: async () => "- Decisions made: add debounce.\n- Next steps: test it." }
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    sessionId: "s2",
    messages: [{ role: "user", content: "summarize this session" }],
  }, { requireConfirmation: false, provider, adapter: "codex" })
  assert.strictEqual(result.length, 1)
  assert.match(result[0].text, /add debounce/u)
})

test("session-end suppresses operational-only subagent summary", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = { complete: async () => `## Session Summary

- Delegated subagent completed task 3 only.
- Acceptance finalization compared the current work to the acceptance contract.
- Reviewer returned APPROVED.` }

  const candidates = await handleSessionEnd(engine, {
    cwd: "/tmp",
    sessionId: "session-subagent-only",
    messages: [{ role: "user", content: "remember this session" }, { role: "assistant", content: "Subagent review completed." }],
  }, { provider, confirmed: true, requireConfirmation: true, adapter: "test" })

  assert.deepStrictEqual(candidates, [])
})

test("session-end keeps subagent summary with durable project outcome", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = { complete: async () => `## Session Summary

- Subagent reviewed the implementation.
- Merged PR #62 and released v0.2.33 after tests passed.
- Next step: design Phase 21 Slice 7 summary hygiene.` }

  const candidates = await handleSessionEnd(engine, {
    cwd: "/tmp",
    sessionId: "session-subagent-durable",
    messages: [{ role: "user", content: "remember this session" }, { role: "assistant", content: "Release completed." }],
  }, { provider, confirmed: true, requireConfirmation: true, adapter: "test" })

  assert.strictEqual(candidates.length, 1)
  assert.match(candidates[0].text, /released v0\.2\.33/iu)
})

test("removes obvious Memory Lane review-management chatter from generated summaries", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = {
    complete: async () => [
      "- Decisions made: Phase 20 debounce was designed.",
      "- Run memory-lane review to approve memory IDs.",
      "- Next steps: implement tests.",
    ].join("\n"),
  }
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    messages: [{ role: "user", content: "summarize this session" }],
  }, { requireConfirmation: false, provider })
  assert.strictEqual(result.length, 1)
  assert.match(result[0].text, /Phase 20 debounce/u)
  assert.doesNotMatch(result[0].text, /memory-lane review/u)
  assert.doesNotMatch(result[0].text, /memory IDs/u)
})

test("does not let a broad fixed keyword preserve Memory Lane review-management instructions", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = {
    complete: async () => [
      "- Fixed memory-lane review duplicate display for pending summaries.",
      "- Run memory-lane review to approve memory IDs.",
    ].join("\n"),
  }
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    messages: [{ role: "user", content: "summarize this session" }],
  }, { requireConfirmation: false, provider })
  assert.deepStrictEqual(result, [])
})

test("returns empty when generated summary is only review-management chatter", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = { complete: async () => "Run memory-lane review to approve memory IDs." }
  const result = await handleSessionEnd(engine, {
    cwd: "/tmp",
    messages: [{ role: "user", content: "summarize this session" }],
  }, { requireConfirmation: false, provider })
  assert.deepStrictEqual(result, [])
})

test("redacts secret lines from transcript", async () => {
  const engine = makeEngine()
  let captured = ""
  const provider: LLMProvider = {
    async complete(prompt) {
      captured = prompt
      return "NO_DURABLE_MEMORY"
    },
  }
  await handleSessionEnd(engine, {
    cwd: "/tmp",
    messages: [{ role: "user", content: "Key is sk-abcdefghijklmnopqrstuvwxyz1234\nRun tests" }],
  }, { requireConfirmation: false, provider })
  assert.ok(captured.includes("[redacted]"))
  assert.ok(!captured.includes("sk-abcdefghijklmnopqrstuvwxyz1234"))
})

test("excludes tool messages when includeToolOutputs is false", async () => {
  const engine = makeEngine()
  let captured = ""
  const provider: LLMProvider = {
    async complete(prompt) {
      captured = prompt
      return "NO_DURABLE_MEMORY"
    },
  }
  await handleSessionEnd(engine, {
    cwd: "/tmp",
    messages: [
      { role: "user", content: "run tests" },
      { role: "tool", toolName: "Bash", content: "ok" },
    ],
  }, { requireConfirmation: false, provider })
  assert.ok(!captured.includes("Tool (Bash)"))
})

test("includes tool messages when includeToolOutputs is true", async () => {
  const engine = makeEngine()
  let captured = ""
  const provider: LLMProvider = {
    async complete(prompt) {
      captured = prompt
      return "NO_DURABLE_MEMORY"
    },
  }
  await handleSessionEnd(engine, {
    cwd: "/tmp",
    messages: [
      { role: "user", content: "run tests" },
      { role: "tool", toolName: "Bash", content: "ok" },
    ],
  }, { requireConfirmation: false, provider, includeToolOutputs: true })
  assert.ok(captured.includes("Tool (Bash)"))
})

test("throws when no provider is configured", async () => {
  const engine = makeEngine()
  await assert.rejects(
    () => handleSessionEnd(engine, {
      cwd: "/tmp",
      messages: [{ role: "user", content: "hello" }],
    }, { requireConfirmation: false }),
    /no LLM provider is configured/,
  )
})

test("extracts reviewed Windows summaries into atomic durable candidates and expiring handoff state", async () => {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/issue-215-session-summaries.json", import.meta.url), "utf8")) as Record<string, string>
  const engine = makeEngine()

  for (const [name, summary] of Object.entries(fixtures)) {
    const provider: LLMProvider = { complete: async () => summary }
    const candidates = await handleSessionEnd(engine, {
      cwd: "/tmp",
      sessionId: `fixture-${name}`,
      messages: [{ role: "assistant", content: "Sanitized source session." }],
    }, { requireConfirmation: false, provider, adapter: "test" })

    const durable = candidates.filter((candidate) => candidate.kind !== "session_summary")
    assert.ok(durable.length > 0, `${name} should retain durable claims`)
    assert.ok(durable.every((candidate) => candidate.text.length <= 600))
    assert.ok(durable.every((candidate) => candidate.provenance.sourceSummaryId))
    assert.ok(durable.every((candidate) => candidate.provenance.sourceSummaryId === candidates[0].provenance.sourceSummaryId))
    assert.ok(candidates.filter((candidate) => candidate.kind === "session_summary").every((candidate) => candidate.freshness?.expiresAt))
    assert.doesNotMatch(durable.map((candidate) => candidate.text).join("\n"), /branch|next turn|reviewer|uncommitted|awaiting merge|in progress/iu)
  }
})

test("temporary handoff claims are separate pending candidates with explicit expiry", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = {
    complete: async () => [
      "## Decisions made",
      "- Windows recovery must preserve quoted arguments.",
      "## Temporary handoff state",
      "- Windows ARM verification is blocked on access to a test device.",
    ].join("\n"),
  }
  const candidates = await handleSessionEnd(engine, {
    cwd: "/tmp",
    sessionId: "expiring-handoff",
    messages: [{ role: "assistant", content: "Sanitized source session.", timestamp: "2026-07-18T00:00:00.000Z" }],
  }, { requireConfirmation: false, provider })

  assert.equal(candidates.length, 2)
  const handoff = candidates.find((candidate) => candidate.kind === "session_summary")
  assert.deepEqual(handoff?.freshness, {
    capturedAt: "2026-07-18T00:00:00.000Z",
    expiresAt: "2026-07-25T00:00:00.000Z",
  })
  assert.equal(handoff?.provenance.sourceSummaryId, candidates[0].provenance.sourceSummaryId)
})

test("completed PR checkpoints suppress corresponding pre-merge handoff state", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = {
    complete: async () => [
      "## Checkpoints",
      "- PR #212 merged with Windows recovery verification.",
      "## Temporary handoff state",
      "- PR #212 is awaiting merge and branch fix/windows must be preserved.",
    ].join("\n"),
  }
  const candidates = await handleSessionEnd(engine, {
    cwd: "/tmp",
    sessionId: "completion-supersession",
    messages: [{ role: "assistant", content: "Sanitized source session." }],
  }, { requireConfirmation: false, provider })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].kind, "project_checkpoint")
  assert.match(candidates[0].text, /PR #212 merged/u)
})

test("saving a completion checkpoint supersedes matching pending pre-merge handoff state", async () => {
  const engine = makeEngine()
  engine.refreshScope("/tmp")
  const old = engine.save({
    text: "PR #210 is awaiting merge on branch fix/windows-recovery.",
    category: "project",
    scopeType: "global",
    status: "pending",
    source: "session-summary",
    kind: "session_summary",
    provenance: { adapter: "test", lifecycleEvent: "pre_compact", sessionId: "older", turnId: "turn-1" },
    freshness: { expiresAt: "2099-01-01T00:00:00.000Z" },
  })
  assert.equal(old.status, "saved")
  if (old.status !== "saved") return

  const provider: LLMProvider = { complete: async () => "## Checkpoints\n- PR #210 merged after Windows recovery verification passed." }
  const candidates = await handleSessionEnd(engine, {
    cwd: "/tmp",
    sessionId: "completion",
    messages: [{ role: "assistant", content: "Completion." }],
  }, { requireConfirmation: false, provider, adapter: "test" })
  const saved = saveSessionSummaryCandidates(engine, candidates)
  assert.equal(saved.filter((result) => result.status === "saved").length, 1)

  const superseded = engine.list({ all: true }).find((memory) => memory.id === old.memory.id)
  assert.ok(superseded?.revision?.supersededBy)
  assert.equal(superseded?.revision?.revisedBy, "lifecycle")
})

test("completion supersession survives persistence text trimming", () => {
  const engine = makeEngine()
  engine.refreshScope("/tmp")
  const old = engine.save({
    text: "PR #215 is awaiting merge on branch fix/trimmed-completion.",
    category: "project",
    scopeType: "global",
    status: "pending",
    source: "session-summary",
    kind: "session_summary",
  })
  assert.equal(old.status, "saved")
  if (old.status !== "saved") return

  const saved = saveSessionSummaryCandidates(engine, [{
    text: "  PR #215 merged after verification completed.  ",
    category: "project",
    scopeType: "global",
    status: "pending",
    source: "session-summary",
    kind: "project_checkpoint",
    provenance: { adapter: "test", lifecycleEvent: "session_end", sessionId: "trimmed-completion" },
  }])

  assert.equal(saved[0]?.status, "saved")
  const memories = engine.list({ all: true })
  assert.equal(memories.find((memory) => memory.id === old.memory.id)?.revision?.supersededBy, saved[0]?.status === "saved" ? saved[0].memory.id : undefined)
})

test("governed persistence keeps the first original for duplicate candidates", () => {
  const engine = makeEngine()
  engine.refreshScope("/tmp")
  const text = "PR #216 merged after duplicate candidate verification completed."

  const saved = saveSessionSummaryCandidates(engine, [
    {
      text,
      category: "project",
      scopeType: "global",
      status: "pending",
      source: "session-summary",
      kind: "project_checkpoint",
      provenance: { adapter: "test", lifecycleEvent: "session_end", sessionId: "first-original" },
    },
    {
      text,
      category: "project",
      scopeType: "global",
      status: "pending",
      source: "session-summary",
      kind: "project_checkpoint",
      provenance: { adapter: "test", lifecycleEvent: "session_end", sessionId: "duplicate-original" },
    },
  ])

  assert.equal(saved.length, 1)
  assert.equal(saved[0]?.status, "saved")
  if (saved[0]?.status !== "saved") return
  assert.equal(saved[0].memory.provenance?.sessionId, "first-original")
})

test("completion supersession ignores matching handoffs outside the current project scope", () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-lane-cross-scope-"))
  try {
    const projectA = join(dir, "project-a")
    const projectB = join(dir, "project-b")
    mkdirSync(projectA, { recursive: true })
    mkdirSync(projectB, { recursive: true })
    writeFileSync(join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "project-a" }), "utf8")
    writeFileSync(join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "project-b" }), "utf8")
    const engine = new MemoryEngine({
      memoryPath: join(dir, "memory.jsonl"),
      embeddingsPath: join(dir, "embeddings.jsonl"),
      configPath: join(dir, "config.json"),
    })

    engine.refreshScope(projectA)
    const outOfScope = engine.save({
      text: "PR #214 is awaiting merge on branch project-a-work.",
      category: "project",
      scopeType: "project",
      status: "pending",
      source: "session-summary",
      kind: "session_summary",
    })
    engine.refreshScope(projectB)
    const inScope = engine.save({
      text: "PR #214 is awaiting review on branch project-b-work.",
      category: "project",
      scopeType: "project",
      status: "pending",
      source: "session-summary",
      kind: "session_summary",
    })
    assert.equal(outOfScope.status, "saved")
    assert.equal(inScope.status, "saved")
    if (outOfScope.status !== "saved" || inScope.status !== "saved") return

    const saved = saveSessionSummaryCandidates(engine, [{
      text: "PR #214 merged after review completed.",
      category: "project",
      scopeType: "project",
      status: "pending",
      source: "session-summary",
      kind: "project_checkpoint",
      provenance: { adapter: "test", lifecycleEvent: "session_end", sessionId: "completion" },
    }])

    assert.equal(saved[0]?.status, "saved")
    const memories = engine.list({ all: true })
    assert.equal(memories.find((memory) => memory.id === inScope.memory.id)?.revision?.supersededBy, saved[0]?.status === "saved" ? saved[0].memory.id : undefined)
    assert.equal(memories.find((memory) => memory.id === outOfScope.memory.id)?.revision, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("pending summary review units have bounded sections, bullets, and characters", async () => {
  const engine = makeEngine()
  const oversized = "x".repeat(900)
  const provider: LLMProvider = {
    complete: async () => `## Decisions made\n${Array.from({ length: 20 }, (_, index) => `- Decision ${index}: ${oversized}`).join("\n")}`,
  }
  const candidates = await handleSessionEnd(engine, {
    cwd: "/tmp",
    sessionId: "bounded-summary",
    messages: [{ role: "assistant", content: "Sanitized source session." }],
  }, { requireConfirmation: false, provider })

  assert.ok(candidates.length <= 8)
  for (const candidate of candidates) {
    assert.ok(candidate.text.length <= 600)
    assert.ok((candidate.text.match(/^#{1,6}\s/gmu)?.length ?? 0) <= 1)
    assert.ok((candidate.text.match(/^\s*[-*]\s/gmu)?.length ?? 0) <= 1)
  }
})

test("uses project scope when available", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = { complete: async () => "- Done." }
  const result = await handleSessionEnd(engine, {
    cwd: process.cwd(),
    messages: [{ role: "user", content: "hello" }],
  }, { requireConfirmation: false, provider })
  assert.strictEqual(result[0].scopeType, "project")
})
