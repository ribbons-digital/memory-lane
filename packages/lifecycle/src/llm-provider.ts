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

export function createOpenAICompatibleProvider(
  config: LLMProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): LLMProvider {
  const baseUrl = normalizeUrl(config.baseUrl)
  const model = config.model
  const headers = authHeaders(config.apiKeyEnv, env)

  return {
    async complete(prompt, options): Promise<string> {
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: options?.maxTokens,
        }),
      })
      const raw = await res.text()
      if (!res.ok) throw new Error(`LLM provider HTTP ${res.status}: ${raw}`)
      const body = parseBody(raw) as { choices?: Array<{ message?: { content?: string } }> }
      const content = body.choices?.[0]?.message?.content
      if (typeof content !== "string") throw new Error("Invalid LLM response: missing choices[0].message.content")
      return content.trim()
    },
  }
}
