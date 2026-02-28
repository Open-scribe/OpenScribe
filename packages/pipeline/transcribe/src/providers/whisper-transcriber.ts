const DEFAULT_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions"
const DEFAULT_WHISPER_MODEL = "whisper-1"
const DEFAULT_WHISPER_LANGUAGE = "auto"

/**
 * HIPAA Compliance: Validate that external endpoints use HTTPS to ensure PHI is encrypted in transit.
 * This prevents accidental misconfiguration that could expose sensitive data.
 */
function validateHttpsUrl(url: string, serviceName: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") {
      throw new Error(
        `SECURITY ERROR: ${serviceName} endpoint must use HTTPS for HIPAA compliance. ` +
        `Received: ${parsed.protocol}//${parsed.host}`
      )
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Invalid ${serviceName} URL: ${url}`)
    }
    throw error
  }
}

export async function transcribeWavBuffer(buffer: Buffer, filename: string, apiKey?: string): Promise<string> {
  const whisperUrl = process.env.WHISPER_OPENAI_URL || DEFAULT_WHISPER_URL
  const whisperModel = process.env.WHISPER_OPENAI_MODEL || DEFAULT_WHISPER_MODEL
  const whisperLanguage = process.env.WHISPER_LANGUAGE || DEFAULT_WHISPER_LANGUAGE

  // Validate HTTPS before sending any PHI
  validateHttpsUrl(whisperUrl, "Whisper API")
  
  const key = apiKey || process.env.OPENAI_API_KEY
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY. Please configure your API key in Settings.")
  }
  const formData = new FormData()
  const blob = new Blob([new Uint8Array(buffer)], { type: "audio/wav" })
  formData.append("file", blob, filename)
  formData.append("model", whisperModel)
  if (whisperLanguage != "auto") {
    formData.append("language", whisperLanguage)
  }

  const response = await fetch(whisperUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Transcription failed: ${response.status} ${errorText}`)
  }

  const result = (await response.json()) as { text?: string }
  return result.text?.trim() ?? ""
}
