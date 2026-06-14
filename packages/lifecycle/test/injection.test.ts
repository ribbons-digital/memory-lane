import test from "node:test"
import assert from "node:assert/strict"
import type { MemoryRecord, RecallResult } from "@memory-lane/core"
import {
  shouldSkipAutomaticInjection,
  selectMemoriesForInjection,
  selectBaselineMemories,
  renderMemoryBlock,
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

function recall(memories: MemoryRecord[], used = false, fallbackReason?: string): RecallResult {
  return {
    memories,
    semantic: { enabled: used, used, fallbackReason },
  }
}

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

test("renders plain memory block without ids or labels", () => {
  const rendered = renderMemoryBlock([memory("abc123", "This repo uses pnpm")])
  assert.equal(rendered, "## Relevant Memory\n\n- This repo uses pnpm")
})

function memoryWithUpdatedAt(id: string, text: string, updatedAt: string): MemoryRecord {
  return { ...memory(id, text), updatedAt }
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
