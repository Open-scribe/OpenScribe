const DEFAULT_LOCATION = 'us-central1'
const DEFAULT_LANGUAGE_CODE = 'en-US'
const DEFAULT_MODEL = 'chirp_2'
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_RETRIES = 2

interface GcpRecognizeResponse {
  results?: Array<{
    alternatives?: Array<{ transcript?: string }>
  }>
}

interface GcpApiErrorEnvelope {
  error?: {
    message?: string
    status?: string
    code?: number
  }
}

function resolvePositiveInteger(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) return fallback
  const parsed = Number.parseInt(rawValue, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function getGoogleAccessToken(): Promise<string> {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    return process.env.GOOGLE_OAUTH_ACCESS_TOKEN
  }

  const metadataUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
  const response = await fetch(metadataUrl, {
    headers: { 'Metadata-Flavor': 'Google' },
  })

  if (!response.ok) {
    throw new Error(`Unable to retrieve Google access token from metadata service (${response.status})`)
  }

  const payload = (await response.json()) as { access_token?: string }
  if (!payload.access_token) {
    throw new Error('Metadata service token response did not include access_token')
  }

  return payload.access_token
}

function resolveProjectId(): string {
  const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
  if (!projectId) {
    throw new Error('Missing GCP project id. Set GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT for gcp_stt_v2 provider.')
  }
  return projectId
}

export async function transcribeWavBuffer(buffer: Buffer, filename: string): Promise<string> {
  void filename
  const projectId = resolveProjectId()
  const location = process.env.GCP_STT_LOCATION || DEFAULT_LOCATION
  const languageCode = process.env.GCP_STT_LANGUAGE_CODE || DEFAULT_LANGUAGE_CODE
  const model = process.env.GCP_STT_MODEL || DEFAULT_MODEL
  const recognizer = process.env.GCP_STT_RECOGNIZER || '_'

  const token = await getGoogleAccessToken()
  const endpoint = `https://speech.googleapis.com/v2/projects/${projectId}/locations/${location}/recognizers/${recognizer}:recognize`
  const timeoutMs = resolvePositiveInteger(process.env.GCP_STT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  const maxRetries = resolvePositiveInteger(process.env.GCP_STT_MAX_RETRIES, DEFAULT_MAX_RETRIES)

  const body = {
    config: {
      autoDecodingConfig: {},
      languageCodes: [languageCode],
      model,
      features: {
        enableAutomaticPunctuation: true,
      },
    },
    content: buffer.toString('base64'),
  }

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
      )

      if (!response.ok) {
        const errorText = await response.text()
        let message = errorText
        try {
          const parsed = JSON.parse(errorText) as GcpApiErrorEnvelope
          if (parsed.error?.message) {
            message = parsed.error.message
          }
        } catch {
          // ignore json parsing for non-json bodies
        }

        const retryable = shouldRetryStatus(response.status) && attempt <= maxRetries
        if (retryable) {
          await wait(250 * attempt)
          continue
        }

        throw new Error(`GCP STT recognize failed (${response.status}): ${message}`)
      }

      const data = (await response.json()) as GcpRecognizeResponse
      const transcript = data.results
        ?.flatMap((result) => result.alternatives || [])
        .map((alt) => alt.transcript?.trim() || '')
        .filter(Boolean)
        .join(' ')
        .trim()

      return transcript || ''
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === 'AbortError'
      const isNetwork = error instanceof TypeError && error.message.toLowerCase().includes('fetch')
      const shouldRetry = (isTimeout || isNetwork) && attempt <= maxRetries
      if (shouldRetry) {
        await wait(250 * attempt)
        continue
      }
      if (isTimeout) {
        throw new Error(`GCP STT recognize request timed out after ${timeoutMs}ms`)
      }
      throw error
    }
  }

  throw new Error('GCP STT recognize failed after retries')
}
