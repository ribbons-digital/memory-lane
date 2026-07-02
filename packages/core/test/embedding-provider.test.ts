import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createOpenAIEmbeddingProvider } from "../src/embedding-provider.js"

function response(ok: boolean, status: number, body: unknown) {
  const raw = typeof body === "string" ? body : JSON.stringify(body)
  return { ok, status, async text() { return raw } }
}

describe("createOpenAIEmbeddingProvider", () => {
  it("returns no vectors for empty input", async () => {
    const provider = createOpenAIEmbeddingProvider(
      { provider: "openai-compatible-embeddings", baseUrl: "http://localhost/", model: "test" },
      {},
      async () => { throw new Error("fetch should not be called") },
    )
    assert.deepEqual(await provider.embed([]), [])
  })

  it("posts batches and returns vectors", async () => {
    const requests: any[] = []
    const provider = createOpenAIEmbeddingProvider(
      { provider: "openai-compatible-embeddings", baseUrl: "http://localhost/", model: "test", batchSize: 2 },
      {},
      async (url, init) => {
        requests.push({ url, init })
        return response(true, 200, { data: [{ embedding: [1, 0] }, { embedding: [0, 1] }].slice(0, JSON.parse((init as any).body).input.length) })
      },
    )

    const vectors = await provider.embed(["a", "b", "c"])
    assert.deepEqual(vectors, [[1, 0], [0, 1], [1, 0]])
    assert.equal(requests.length, 2)
    assert.equal(requests[0].url, "http://localhost/embeddings")
  })

  it("adds authorization header when configured", async () => {
    let headers: Record<string, string> | undefined
    const provider = createOpenAIEmbeddingProvider(
      { provider: "openai-compatible-embeddings", baseUrl: "http://localhost", model: "test", apiKeyEnv: "EMBED_KEY" },
      { EMBED_KEY: "secret" },
      async (_url, init) => {
        headers = (init as any).headers
        return response(true, 200, { data: [{ embedding: [1] }] })
      },
    )
    await provider.embed(["a"])
    assert.equal(headers?.Authorization, "Bearer secret")
  })

  it("throws for HTTP errors and invalid vectors", async () => {
    const failing = createOpenAIEmbeddingProvider(
      { provider: "openai-compatible-embeddings", baseUrl: "http://localhost", model: "test" },
      {},
      async () => response(false, 500, "nope"),
    )
    await assert.rejects(() => failing.embed(["a"]), /HTTP 500/)

    const invalid = createOpenAIEmbeddingProvider(
      { provider: "openai-compatible-embeddings", baseUrl: "http://localhost", model: "test" },
      {},
      async () => response(true, 200, { data: [{ embedding: [Number.NaN] }] }),
    )
    await assert.rejects(() => invalid.embed(["a"]), /Invalid vector/)
  })

  it("times out embedding requests even when a caller signal is provided", async () => {
    const caller = new AbortController()
    const provider = createOpenAIEmbeddingProvider(
      { provider: "openai-compatible-embeddings", baseUrl: "http://localhost", model: "test", timeoutMs: 1 },
      {},
      (_url, init) => new Promise((resolve, reject) => {
        const signal = (init as { signal?: AbortSignal }).signal
        signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))
      }),
    )

    await assert.rejects(() => provider.embed(["a"], caller.signal), /timed out after 1ms/)
  })
})
