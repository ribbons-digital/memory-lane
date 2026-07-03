import { test } from "node:test"
import assert from "node:assert"
import { MemoryEngine } from "@memory-lane/core"
import { handlePreCompact, handleSessionEnd } from "../src/session-end.js"
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
  }, { provider, adapter: "codex" })
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
  }, { provider, adapter: "codex" })
  assert.deepStrictEqual(result, [])
})

test("uses pre-compact trigger as provenance fallback when turn id is absent", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = { complete: async () => "- Decisions made: fallback key." }
  const result = await handlePreCompact(engine, {
    cwd: "/tmp",
    sessionId: "s-trigger",
    trigger: "manual",
    messages: [{ role: "user", content: "summarize before compact" }],
  }, { provider, adapter: "claude" })
  assert.strictEqual(result.length, 1)
  assert.strictEqual(result[0].provenance.turnId, "manual")
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

test("keeps durable Memory Lane review work while removing review-management instructions", async () => {
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
  assert.strictEqual(result.length, 1)
  assert.match(result[0].text, /Fixed memory-lane review duplicate display/u)
  assert.doesNotMatch(result[0].text, /approve memory IDs/u)
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

test("uses project scope when available", async () => {
  const engine = makeEngine()
  const provider: LLMProvider = { complete: async () => "- Done." }
  const result = await handleSessionEnd(engine, {
    cwd: process.cwd(),
    messages: [{ role: "user", content: "hello" }],
  }, { requireConfirmation: false, provider })
  assert.strictEqual(result[0].scopeType, "project")
})
