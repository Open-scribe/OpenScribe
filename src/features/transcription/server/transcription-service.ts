const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions"

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY")
  }
  return key
}

export async function transcribeWavBuffer(buffer: Buffer, filename: string): Promise<string> {
  const apiKey = getApiKey()
  const formData = new FormData()
  const blob = new Blob([buffer], { type: "audio/wav" })
  formData.append("file", blob, filename)
  formData.append("model", "whisper-1")

  const response = await fetch(WHISPER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
