import { PipelineStageError } from "../../../shared/src/error"

const DEFAULT_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions"
const DEFAULT_WHISPER_MODEL = "whisper-1"

/**
 * HIPAA Compliance: Validate that external endpoints use HTTPS to ensure PHI is encrypted in transit.
 * This prevents accidental misconfiguration that could expose sensitive data.
 */
function validateHttpsUrl(url: string, serviceName: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") {
      throw new PipelineStageError(
        "configuration_error",
        `SECURITY ERROR: ${serviceName} endpoint must use HTTPS for HIPAA compliance. ` +
        `Received: ${parsed.protocol}//${parsed.host}`,
        false,
      )
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new PipelineStageError("configuration_error", `Invalid ${serviceName} URL: ${url}`, false)
    }
    throw error
  }
}

export async function transcribeWavBuffer(buffer: Buffer, filename: string, apiKey?: string): Promise<string> {
  const whisperUrl = process.env.WHISPER_OPENAI_URL || DEFAULT_WHISPER_URL
  const whisperModel = process.env.WHISPER_OPENAI_MODEL || DEFAULT_WHISPER_MODEL

  // Validate HTTPS before sending any PHI
  validateHttpsUrl(whisperUrl, "Whisper API")
  
  const key = apiKey || process.env.OPENAI_API_KEY
  if (!key) {
    throw new PipelineStageError(
      "configuration_error",
      "Missing OPENAI_API_KEY. Please configure your API key in Settings.",
      false,
    )
  }
  const formData = new FormData()
  const blob = new Blob([new Uint8Array(buffer)], { type: "audio/wav" })
  formData.append("file", blob, filename)
  formData.append("model", whisperModel)

  const response = await fetch(whisperUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new PipelineStageError("api_error", `Transcription failed: ${response.status} ${errorText}`, true, {
      status: response.status,
      provider: "whisper_openai",
    })
  }

  const result = (await response.json()) as { text?: string }
  return result.text?.trim() ?? ""
}
