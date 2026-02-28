const DEFAULT_WHISPER_LOCAL_URL = "http://127.0.0.1:8002/v1/audio/transcriptions"
const DEFAULT_WHISPER_LOCAL_MODEL = "tiny.en"
const DEFAULT_WHISPER_LANGUAGE = "auto"
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RETRIES = 2

export interface WhisperLocalTranscriberOptions {
  baseUrl?: string
  model?: string
  language?: string
  timeoutMs?: number
  maxRetries?: number
  fetchFn?: typeof fetch
  waitFn?: (ms: number) => Promise<void>
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * For localhost connections, HTTPS is not required since data never leaves the machine.
 * Only validate HTTPS for remote endpoints.
 */
function validateLocalOrHttpsUrl(url: string, serviceName: string): void {
  try {
    const parsed = new URL(url)
    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1"
    const trustedHosts = (process.env.WHISPER_LOCAL_TRUSTED_HOSTS || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
    const isTrustedHost = trustedHosts.includes(parsed.hostname.toLowerCase())

    if (!isLocalhost && !isTrustedHost && parsed.protocol !== "https:") {
      throw new Error(
        `SECURITY ERROR: ${serviceName} endpoint must use HTTPS, localhost, or a host listed in WHISPER_LOCAL_TRUSTED_HOSTS. ` +
          `Received: ${parsed.protocol}//${parsed.host}`,
      )
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Invalid ${serviceName} URL: ${url}`)
    }
    throw error
  }
}

function resolvePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function fetchWithTimeout(fetchFn: typeof fetch, timeoutMs: number, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchFn(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

export async function transcribeWavBuffer(
  buffer: Buffer,
  filename: string,
  options?: WhisperLocalTranscriberOptions,
): Promise<string> {
  const url = options?.baseUrl || process.env.WHISPER_LOCAL_URL || DEFAULT_WHISPER_LOCAL_URL
  const model = options?.model || process.env.WHISPER_LOCAL_MODEL || DEFAULT_WHISPER_LOCAL_MODEL
  const language = model.endsWith(".en") ? "en" : options?.language || process.env.WHISPER_LANGUAGE || DEFAULT_WHISPER_LANGUAGE
  const timeoutMs = options?.timeoutMs ?? resolvePositiveInteger(process.env.WHISPER_LOCAL_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  const maxRetries = options?.maxRetries ?? resolvePositiveInteger(process.env.WHISPER_LOCAL_MAX_RETRIES, DEFAULT_MAX_RETRIES)
  const fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis)
  const waitFn = options?.waitFn ?? wait

  if (model.endsWith(".en") && process.env.WHISPER_LANGUAGE != "en" && process.env.WHISPER_LANGUAGE != "auto") {
    console.warn(`⚠️  Warning: WHISPER_LANGUAGE setting ignored since model '${model}' can only transcribe language 'en'.`)
  }

  validateLocalOrHttpsUrl(url, "Whisper local API")

  const formData = new FormData()
  const blob = new Blob([new Uint8Array(buffer)], { type: "audio/wav" })
  formData.append("file", blob, filename)
  formData.append("model", model)
  if (language != "auto") {
    formData.append("language", language)
  }
  formData.append("response_format", "json")

  const totalAttempts = maxRetries + 1
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchFn, timeoutMs, url, {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const errorText = await response.text()
        const retryable = shouldRetryStatus(response.status) && attempt < totalAttempts
        if (retryable) {
          await waitFn(250 * attempt)
          continue
        }

        if (response.status === 503) {
          throw new Error(
            "Whisper local server is not ready. Please ensure the server is running:\n" +
              "  pnpm whisper:server\n" +
              "Or start both servers together:\n" +
              "  pnpm dev:local",
          )
        }

        throw new Error(`Whisper local transcription failed (${response.status}): ${errorText}`)
      }

      const result = (await response.json()) as { text?: string }
      return result.text?.trim() ?? ""
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError"
      const isNetworkFetch = error instanceof TypeError && error.message.toLowerCase().includes("fetch")
      const shouldRetry = (isAbort || isNetworkFetch) && attempt < totalAttempts
      if (shouldRetry) {
        await waitFn(250 * attempt)
        continue
      }

      if (isAbort) {
        throw new Error(`Whisper local transcription timed out after ${timeoutMs}ms (attempt ${attempt}/${totalAttempts}).`)
      }

      if (isNetworkFetch) {
        throw new Error(
          `Cannot connect to Whisper local server at ${url}.\n` +
            "Please start the Whisper local server:\n" +
            "  pnpm whisper:server\n" +
            "Or start both servers together:\n" +
            "  pnpm dev:local",
        )
      }

      throw error
    }
  }

  throw new Error("Whisper local transcription failed after retries")
}
