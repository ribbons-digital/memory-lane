import { test } from "node:test"
import assert from "node:assert"
import { createOpenAICompatibleProvider } from "../src/llm-provider.js"

test("complete sends chat completion request and returns content", async () => {
  const fetchCalls: unknown[] = []
  const fetchImpl = async (url: string, init?: unknown) => {
    fetchCalls.push({ url, init })
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "summary" } }] }),
    }
  }
  const provider = createOpenAICompatibleProvider(
    { provider: "openai-compatible", baseUrl: "http://localhost:1234/v1", model: "m" },
    {},
    fetchImpl as any,
  )
  const result = await provider.complete("prompt", { maxTokens: 100 })
  assert.strictEqual(result, "summary")
  assert.strictEqual(fetchCalls.length, 1)
  const call = fetchCalls[0] as { init?: { body: string } }
  const body = JSON.parse(call.init!.body)
  assert.strictEqual(body.max_tokens, 100)
  assert.deepStrictEqual(body.messages, [{ role: "user", content: "prompt" }])
})

test("complete throws on HTTP error", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "boom" })
  const provider = createOpenAICompatibleProvider(
    { provider: "openai-compatible", baseUrl: "http://localhost:1234/v1", model: "m" },
    {},
    fetchImpl as any,
  )
  await assert.rejects(() => provider.complete("prompt"), /HTTP 500/)
})

test("complete adds authorization header from env", async () => {
  const fetchCalls: unknown[] = []
  const fetchImpl = async (url: string, init?: unknown) => {
    fetchCalls.push({ url, init })
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "" } }] }),
    }
  }
  createOpenAICompatibleProvider(
    { provider: "openai-compatible", baseUrl: "http://localhost:1234/v1", model: "m", apiKeyEnv: "TEST_API_KEY" },
    { TEST_API_KEY: "secret123" },
    fetchImpl as any,
  ).complete("prompt")
  const call = fetchCalls[0] as { init?: { headers: Record<string, string> } }
  assert.strictEqual(call.init?.headers.Authorization, "Bearer secret123")
})
