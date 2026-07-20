import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  EmbeddingProviderRequestError,
  createOpenAIEmbeddingProvider,
  sanitizeEmbeddingEndpoint,
} from "../src/embedding-provider.js"

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

  it("classifies connection refusal and DNS failures without exposing transport details", async () => {
    for (const fixture of [
      { code: "ECONNREFUSED", expected: "connection-refused" },
      { code: "ENOTFOUND", expected: "dns-failure" },
    ] as const) {
      const provider = createOpenAIEmbeddingProvider(
        { provider: "openai-compatible-embeddings", baseUrl: "http://localhost", model: "test" },
        {},
        async () => {
          throw Object.assign(new TypeError("fetch failed with secret detail"), {
            cause: Object.assign(new Error("sensitive socket detail"), { code: fixture.code }),
          })
        },
      )
      await assert.rejects(() => provider.embed(["a"]), (error: unknown) => {
        assert.ok(error instanceof EmbeddingProviderRequestError)
        assert.equal(error.failureClass, fixture.expected)
        assert.doesNotMatch(error.message, /secret|sensitive/u)
        return true
      })
    }

    const bunStyleProvider = createOpenAIEmbeddingProvider(
      { provider: "openai-compatible-embeddings", baseUrl: "http://localhost", model: "test" },
      {},
      async () => { throw new Error("Unable to connect. Is the computer able to access the url?") },
    )
    await assert.rejects(() => bunStyleProvider.embed(["a"]), (error: unknown) => {
      assert.ok(error instanceof EmbeddingProviderRequestError)
      assert.equal(error.failureClass, "connection-refused")
      return true
    })
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

    await assert.rejects(() => provider.embed(["a"], caller.signal), (error: unknown) => {
      assert.ok(error instanceof EmbeddingProviderRequestError)
      assert.equal(error.failureClass, "timeout")
      assert.match(error.message, /timed out after 1ms/u)
      return true
    })
  })

  it("preserves caller-triggered cancellation as AbortError", async () => {
    const caller = new AbortController()
    const provider = createOpenAIEmbeddingProvider(
      { provider: "openai-compatible-embeddings", baseUrl: "http://localhost", model: "test" },
      {},
      (_url, init) => new Promise((resolve, reject) => {
        const signal = (init as { signal?: AbortSignal }).signal
        const rejectAbort = () => reject(Object.assign(new Error("cancelled by caller"), { name: "AbortError" }))
        if (signal?.aborted) rejectAbort()
        else signal?.addEventListener("abort", rejectAbort, { once: true })
      }),
    )

    const request = provider.embed(["a"], caller.signal)
    caller.abort()
    await assert.rejects(() => request, (error: unknown) => {
      assert.equal((error as { name?: string }).name, "AbortError")
      assert.equal(error instanceof EmbeddingProviderRequestError, false)
      return true
    })
  })

  it("classifies authentication, incompatible responses, and other HTTP failures without response bodies", async () => {
    const fixtures = [
      { status: 401, body: "SECRET auth body", expected: "authentication-failure" },
      { status: 503, body: "SECRET provider body", expected: "http-error" },
    ] as const
    for (const fixture of fixtures) {
      const provider = createOpenAIEmbeddingProvider(
        { provider: "openai-compatible-embeddings", baseUrl: "http://localhost", model: "test" },
        {},
        async () => response(false, fixture.status, fixture.body),
      )
      await assert.rejects(() => provider.embed(["a"]), (error: unknown) => {
        assert.ok(error instanceof EmbeddingProviderRequestError)
        assert.equal(error.failureClass, fixture.expected)
        assert.equal(error.httpStatus, fixture.status)
        assert.doesNotMatch(error.message, /SECRET|body/u)
        return true
      })
    }

    const incompatible = createOpenAIEmbeddingProvider(
      { provider: "openai-compatible-embeddings", baseUrl: "http://localhost", model: "test" },
      {},
      async () => response(true, 200, "SECRET not-json response"),
    )
    await assert.rejects(() => incompatible.embed(["a"]), (error: unknown) => {
      assert.ok(error instanceof EmbeddingProviderRequestError)
      assert.equal(error.failureClass, "incompatible-response")
      assert.doesNotMatch(error.message, /SECRET|not-json/u)
      return true
    })
  })

  it("sanitizes endpoint credentials query parameters and fragments", () => {
    assert.equal(
      sanitizeEmbeddingEndpoint("https://user:password@example.com/v1/?api_key=SECRET#private"),
      "https://example.com/v1",
    )
  })
})
