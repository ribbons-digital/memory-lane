import type {
  EmbeddingFailureClass,
  EmbeddingProvider,
  EmbeddingProviderDiagnostic,
  EmbeddingProfileConfig,
} from "./types.js"

type FetchLike = (url: string, init?: unknown) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "")
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === "number" && Number.isFinite(n))
}

function incompatibleResponse(message: string): EmbeddingProviderRequestError {
  return new EmbeddingProviderRequestError("incompatible-response", message)
}

function validateVectorEntry(entry: unknown): number[] {
  const vector = (entry as { embedding?: unknown } | undefined)?.embedding
  if (!isFiniteNumberArray(vector)) throw incompatibleResponse("Invalid vector in embedding provider response")
  return vector
}

function responseData(body: unknown): unknown[] {
  const data = (body as { data?: unknown } | undefined)?.data
  if (!Array.isArray(data)) throw incompatibleResponse("Embedding provider returned an incompatible response")
  return data
}

function validateVectors(body: unknown, count: number): number[][] {
  const data = responseData(body)
  if (data.length !== count) throw incompatibleResponse(`Embedding provider returned ${data.length} vectors; expected ${count}`)
  return data.map(validateVectorEntry)
}

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw incompatibleResponse("Embedding provider returned invalid JSON")
  }
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

function nestedErrorCodes(error: unknown): string[] {
  const codes: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current)
    const code = (current as { code?: unknown }).code
    if (typeof code === "string") codes.push(code)
    current = (current as { cause?: unknown }).cause
  }
  return codes
}

function nestedErrorMessages(error: unknown): string {
  const messages: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current)
    const message = (current as { message?: unknown }).message
    if (typeof message === "string") messages.push(message)
    current = (current as { cause?: unknown }).cause
  }
  return messages.join("\n")
}

function transportFailureClass(error: unknown): EmbeddingFailureClass {
  const codes = nestedErrorCodes(error)
  if (codes.some((code) => code === "ECONNREFUSED")) return "connection-refused"
  if (codes.some((code) => code === "ENOTFOUND" || code === "EAI_AGAIN")) return "dns-failure"
  if (codes.some((code) => code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT")) return "timeout"

  const messages = nestedErrorMessages(error)
  if (/ECONNREFUSED|connection refused|Unable to connect\. Is the computer able to access the url\?/iu.test(messages)) return "connection-refused"
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|DNS (?:lookup|resolution)|hostname (?:could not be resolved|not found)/iu.test(messages)) return "dns-failure"
  if (/ETIMEDOUT|timed? out|timeout/iu.test(messages)) return "timeout"
  return "connection-failure"
}

function transportFailure(error: unknown): EmbeddingProviderRequestError {
  const failureClass = transportFailureClass(error)
  const messages: Record<EmbeddingFailureClass, string> = {
    "connection-refused": "Embedding provider refused the connection",
    "dns-failure": "Embedding provider hostname could not be resolved",
    timeout: "Embedding provider request timed out",
    "authentication-failure": "Embedding provider authentication failed",
    "incompatible-response": "Embedding provider returned an incompatible response",
    "http-error": "Embedding provider returned a non-success HTTP status",
    "connection-failure": "Embedding provider connection failed",
  }
  return new EmbeddingProviderRequestError(failureClass, messages[failureClass])
}

export class EmbeddingProviderRequestError extends Error {
  readonly failureClass: EmbeddingFailureClass
  readonly httpStatus?: number

  constructor(failureClass: EmbeddingFailureClass, message: string, httpStatus?: number) {
    super(message)
    this.name = "EmbeddingProviderRequestError"
    this.failureClass = failureClass
    this.httpStatus = httpStatus
  }
}

export class EmbeddingProviderDiagnosticError extends Error {
  readonly diagnostic: EmbeddingProviderDiagnostic

  constructor(diagnostic: EmbeddingProviderDiagnostic) {
    const failure = diagnostic.failure?.class.replace(/-/gu, " ") ?? "failure"
    super(`Embedding provider ${failure} for profile "${diagnostic.profileName}" at ${diagnostic.endpoint} (model "${diagnostic.model}"). ${diagnostic.recoveryAction ?? "Check the provider configuration and retry."}`)
    this.name = "EmbeddingProviderDiagnosticError"
    this.diagnostic = diagnostic
  }
}

export function sanitizeEmbeddingEndpoint(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/u, "")
    return `${url.origin}${pathname}`
  } catch {
    return "[invalid endpoint]"
  }
}

export function embeddingRecoveryAction(failureClass: EmbeddingFailureClass, endpoint: string): string {
  const local = (() => {
    try {
      const hostname = new URL(endpoint).hostname.toLowerCase()
      return hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || hostname.startsWith("127.")
    } catch {
      return false
    }
  })()
  if (failureClass === "connection-refused" && local) return "Start the configured local embedding service, then rerun `memory-lane reindex`."
  if (failureClass === "connection-refused") return "Check that the embedding service is running and reachable, then rerun `memory-lane reindex`."
  if (failureClass === "dns-failure") return "Check the configured hostname and DNS/network access, then rerun `memory-lane reindex`."
  if (failureClass === "timeout") return "Check that the embedding service is responsive or increase its timeout, then rerun `memory-lane reindex`."
  if (failureClass === "authentication-failure") return "Check the configured credential environment variable and provider access, then rerun `memory-lane reindex`."
  if (failureClass === "incompatible-response") return "Check that the endpoint supports OpenAI-compatible embeddings for the configured model, then rerun `memory-lane reindex`."
  if (failureClass === "http-error") return "Check the embedding service and model configuration, then rerun `memory-lane reindex`."
  return "Check the embedding service configuration and network access, then rerun `memory-lane reindex`."
}

export function embeddingFailure(error: unknown): { class: EmbeddingFailureClass; httpStatus?: number; message: string } {
  const requestError = error instanceof EmbeddingProviderRequestError ? error : transportFailure(error)
  return {
    class: requestError.failureClass,
    ...(requestError.httpStatus === undefined ? {} : { httpStatus: requestError.httpStatus }),
    message: requestError.message,
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
      if (!res.ok) {
        const failureClass = res.status === 401 || res.status === 403 ? "authentication-failure" : "http-error"
        const message = failureClass === "authentication-failure"
          ? `Embedding provider authentication failed (HTTP ${res.status})`
          : `Embedding provider returned HTTP ${res.status}`
        throw new EmbeddingProviderRequestError(failureClass, message, res.status)
      }
      return validateVectors(parseBody(raw), batch.length)
    } catch (error) {
      if (error instanceof EmbeddingProviderRequestError) throw error
      if ((error as { name?: string }).name === "AbortError" && combined.timedOut()) {
        throw new EmbeddingProviderRequestError("timeout", `Embedding provider timed out after ${timeoutMs}ms`)
      }
      if ((error as { name?: string }).name === "AbortError") throw error
      throw transportFailure(error)
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
