export interface MedGemmaRequest {
  system: string
  prompt: string
  model?: string
  baseUrl?: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  stop?: string[]
  timeoutMs?: number
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8080"
const DEFAULT_MODEL = "medgemma-1.5-4b-it"
const DEFAULT_TIMEOUT_MS = 60_000

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
}

function assertNonEmpty(value: string | undefined, label: string): asserts value is string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${label} is required`)
  }
}

export async function runMedGemmaRequest(request: MedGemmaRequest): Promise<string> {
  const {
    system,
    prompt,
    model = process.env.MEDGEMMA_MODEL || DEFAULT_MODEL,
    baseUrl = process.env.MEDGEMMA_BASE_URL || DEFAULT_BASE_URL,
    apiKey = process.env.MEDGEMMA_API_KEY,
    temperature = 0.2,
    maxTokens = 800,
    topP = 0.9,
    stop,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = request

  assertNonEmpty(system, "system")
  assertNonEmpty(prompt, "prompt")

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  const url = `${normalizeBaseUrl(baseUrl)}/v1/chat/completions`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
        stop,
        stream: false,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      throw new Error(`MedGemma request failed (${response.status}): ${errorText || response.statusText}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; text?: string }>
    }

    const content = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text
    if (!content) {
      throw new Error("No content returned from MedGemma response")
    }

    return content
  } finally {
    clearTimeout(timeout)
  }
}
