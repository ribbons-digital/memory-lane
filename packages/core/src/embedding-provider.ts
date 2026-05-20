import type { EmbeddingProvider, EmbeddingProfileConfig } from "./types.js"

type FetchLike = (url: string, init?: unknown) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "")
}

function validateVectors(body: unknown, count: number): number[][] {
  const o = body as any
  if (!o || typeof o !== "object" || !Array.isArray(o.data)) {
    throw new Error("Invalid embedding response: expected { data: [...] }")
  }
  if (o.data.length !== count) {
    throw new Error(`Expected ${count} vectors, got ${o.data.length}`)
  }
  return o.data.map((entry: any) => {
    const v = entry?.embedding
    if (!Array.isArray(v) || v.length === 0 || !v.every((n: unknown) => typeof n === "number" && Number.isFinite(n))) {
      throw new Error("Invalid vector in embedding response")
    }
    return v as number[]
  })
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

  return {
    async embed(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
      if (!inputs.length) return []

      const apiKey = profile.apiKeyEnv ? env[profile.apiKeyEnv] : undefined
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`

      const results: number[][] = []
      for (let i = 0; i < inputs.length; i += batchSize) {
        const batch = inputs.slice(i, i + batchSize)

        const controller = new AbortController()
        const combined = signal ?? controller.signal
        let timer: NodeJS.Timeout | undefined
        if (!signal) {
          timer = setTimeout(() => controller.abort(), timeoutMs)
        }

        try {
          const res = await fetchImpl(`${baseUrl}/embeddings`, {
            method: "POST",
            headers,
            body: JSON.stringify({ model, input: batch }),
            signal: combined,
          })
          const raw = await res.text()
          let body: unknown
          try { body = JSON.parse(raw) } catch { /* empty */ }
          if (!res.ok) throw new Error(`Embedding provider HTTP ${res.status}: ${raw}`)
          const vectors = validateVectors(body ?? {}, batch.length)
          results.push(...vectors)
        } finally {
          if (timer) clearTimeout(timer)
        }
      }
      return results
    },
  }
}
