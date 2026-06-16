import { test } from "node:test"
import assert from "node:assert"
import { MemoryEngine } from "@memory-lane/core"
import { handleSessionEnd } from "../src/session-end.js"
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
  assert.strictEqual(candidate.provenance.lifecycleEvent, "session_end")
  assert.strictEqual(candidate.provenance.sessionId, "s1")
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
