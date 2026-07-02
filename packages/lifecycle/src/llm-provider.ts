import type { LLMProvider, LLMProviderConfig } from "./types.js"

type FetchLike = (url: string, init?: unknown) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "")
}

function authHeaders(apiKeyEnv: string | undefined | null, env: NodeJS.ProcessEnv): Record<string, string> {
  const apiKey = apiKeyEnv ? env[apiKeyEnv] : undefined
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

function parseBody(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return {} }
}

function abortSignalTimeout(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { signal: controller.signal, dispose: () => clearTimeout(timer) }
}

export function createOpenAICompatibleProvider(
  config: LLMProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): LLMProvider {
  const baseUrl = normalizeUrl(config.baseUrl)
  const model = config.model
  const headers = authHeaders(config.apiKeyEnv, env)
  const timeoutMs = config.timeoutMs ?? 30_000

  return {
    async complete(prompt, options): Promise<string> {
      const timeout = abortSignalTimeout(timeoutMs)
      try {
        const res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: options?.maxTokens,
          }),
          signal: timeout.signal,
        })
        const raw = await res.text()
        if (!res.ok) throw new Error(`LLM provider HTTP ${res.status}: ${raw}`)
        const body = parseBody(raw) as { choices?: Array<{ message?: { content?: string } }> }
        const content = body.choices?.[0]?.message?.content
        if (typeof content !== "string") throw new Error("Invalid LLM response: missing choices[0].message.content")
        return content.trim()
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") throw new Error(`LLM provider timed out after ${timeoutMs}ms`)
        throw error
      } finally {
        timeout.dispose()
      }
    },
  }
}
