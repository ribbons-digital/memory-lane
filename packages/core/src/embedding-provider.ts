import type { EmbeddingProvider, EmbeddingProfileConfig } from "./types.js"

type FetchLike = (url: string, init?: unknown) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "")
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === "number" && Number.isFinite(n))
}

function validateVectorEntry(entry: unknown): number[] {
  const vector = (entry as { embedding?: unknown } | undefined)?.embedding
  if (!isFiniteNumberArray(vector)) throw new Error("Invalid vector in embedding response")
  return vector
}

function responseData(body: unknown): unknown[] {
  const data = (body as { data?: unknown } | undefined)?.data
  if (!Array.isArray(data)) throw new Error("Invalid embedding response: expected { data: [...] }")
  return data
}

function validateVectors(body: unknown, count: number): number[][] {
  const data = responseData(body)
  if (data.length !== count) throw new Error(`Expected ${count} vectors, got ${data.length}`)
  return data.map(validateVectorEntry)
}

function parseBody(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return {} }
}

function authHeaders(profile: EmbeddingProfileConfig, env: NodeJS.ProcessEnv): Record<string, string> {
  const apiKey = profile.apiKeyEnv ? env[profile.apiKeyEnv] : undefined
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

function composeAbortSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController()
  let didTimeout = false
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(() => {
    didTimeout = true
    controller.abort()
  }, timeoutMs)
  timer.unref?.()
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
    },
  }
}

export function createOpenAIEmbeddingProvider(
  profile: EmbeddingProfileConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): EmbeddingProvider {
  const baseUrl = normalizeUrl(profile.baseUrl)
  const model = profile.model
  const batchSize = profile.batchSize ?? 16
  const timeoutMs = profile.timeoutMs ?? 30000
  const headers = authHeaders(profile, env)

  async function fetchBatch(batch: string[], signal?: AbortSignal): Promise<number[][]> {
    const combined = composeAbortSignal(signal, timeoutMs)
    try {
      const res = await fetchImpl(`${baseUrl}/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: batch }),
        signal: combined.signal,
      })
      const raw = await res.text()
      if (!res.ok) throw new Error(`Embedding provider HTTP ${res.status}: ${raw}`)
      return validateVectors(parseBody(raw), batch.length)
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError" && combined.timedOut()) throw new Error(`Embedding provider timed out after ${timeoutMs}ms`)
      throw error
    } finally {
      combined.dispose()
    }
  }

  return {
    async embed(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
      if (!inputs.length) return []
      const results = await Promise.all(batches(inputs, batchSize).map((batch) => fetchBatch(batch, signal)))
      return results.flat()
    },
  }
}
