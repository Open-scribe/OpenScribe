import { PipelineStageError, toPipelineStageError } from "../../../shared/src/error"

/**
 * MedASR Local Transcriber
 *
 * Transcribes audio using a local MedASR server instead of OpenAI Whisper.
 * Compatible with the existing transcription pipeline.
 *
 * Requires: MedASR server running locally (scripts/medasr_server.py)
 */

const DEFAULT_MEDASR_URL = "http://127.0.0.1:8001/v1/audio/transcriptions"

/**
 * For localhost connections, HTTPS is not required since data never leaves the machine.
 * Only validate HTTPS for remote endpoints.
 */
function validateLocalOrHttpsUrl(url: string, serviceName: string): void {
  try {
    const parsed = new URL(url)
    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1"

    if (!isLocalhost && parsed.protocol !== "https:") {
      throw new PipelineStageError(
        "configuration_error",
        `SECURITY ERROR: ${serviceName} endpoint must use HTTPS or localhost. ` + `Received: ${parsed.protocol}//${parsed.host}`,
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

export async function transcribeWavBuffer(buffer: Buffer, filename: string, baseUrl?: string): Promise<string> {
  const url = baseUrl || process.env.MEDASR_URL || DEFAULT_MEDASR_URL

  // Validate URL (localhost is OK, remote must be HTTPS)
  validateLocalOrHttpsUrl(url, "MedASR API")

  const formData = new FormData()
  const blob = new Blob([new Uint8Array(buffer)], { type: "audio/wav" })
  formData.append("file", blob, filename)
  formData.append("model", "medasr")
  formData.append("response_format", "json")

  try {
    const response = await fetch(url, {
      method: "POST",
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()

      if (response.status === 503) {
        throw new PipelineStageError(
          "service_unavailable",
          "MedASR server is not ready. Please ensure the server is running:\n" +
            "  pnpm medasr:server\n" +
            "Or start both servers together:\n" +
            "  pnpm dev:local:medasr",
          true,
          { status: response.status, provider: "medasr" },
        )
      }

      throw new PipelineStageError(
        "api_error",
        `MedASR transcription failed (${response.status}): ${errorText}`,
        response.status >= 500,
        { status: response.status, provider: "medasr" },
      )
    }

    const result = (await response.json()) as { text?: string }
    return result.text?.trim() ?? ""
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new PipelineStageError(
        "network_error",
        `Cannot connect to MedASR server at ${url}.\n` +
          "Please start the MedASR server:\n" +
          "  pnpm medasr:server\n" +
          "Or start both servers together:\n" +
          "  pnpm dev:local:medasr",
        true,
        { provider: "medasr", url },
      )
    }
    throw toPipelineStageError(error, {
      code: "transcription_error",
      message: "MedASR transcription failed",
      recoverable: true,
      details: { provider: "medasr" },
    })
  }
}
