import { transcribeWavBuffer as transcribeWithMedASR } from "./medasr-transcriber"
import { transcribeWavBuffer as transcribeWithWhisperLocal } from "./whisper-local-transcriber"
import { transcribeWavBuffer as transcribeWithWhisperOpenAI } from "./whisper-transcriber"
import { transcribeWavBuffer as transcribeWithGcpStt } from "./gcp-stt-transcriber"

export type TranscriptionProvider = "whisper_local" | "whisper_openai" | "medasr" | "gcp_stt_v2"

export interface ResolvedTranscriptionProvider {
  provider: TranscriptionProvider
  model: string
}

type EnvLike = Record<string, string | undefined>

const DEFAULT_WHISPER_LOCAL_MODEL = "tiny.en"
const DEFAULT_WHISPER_OPENAI_MODEL = "whisper-1"
const DEFAULT_MEDASR_MODEL = "medasr"
const DEFAULT_GCP_STT_MODEL = "chirp_2"

function normalizeProvider(rawProvider: string | undefined): string {
  return rawProvider?.trim().toLowerCase() || ""
}

export function resolveTranscriptionProvider(env: EnvLike = process.env): ResolvedTranscriptionProvider {
  const provider = normalizeProvider(env.TRANSCRIPTION_PROVIDER)

  if (provider === "medasr" || provider === "med_asr") {
    return {
      provider: "medasr",
      model: env.MEDASR_MODEL?.trim() || DEFAULT_MEDASR_MODEL,
    }
  }

  if (provider === "gcp_stt_v2" || provider === "gcp-stt-v2" || provider === "google_stt" || provider === "gcp_stt") {
    return {
      provider: "gcp_stt_v2",
      model: env.GCP_STT_MODEL?.trim() || DEFAULT_GCP_STT_MODEL,
    }
  }

  if (provider === "whisper_openai" || provider === "whisper-openai" || provider === "openai" || provider === "whisper") {
    return {
      provider: "whisper_openai",
      model: env.WHISPER_OPENAI_MODEL?.trim() || DEFAULT_WHISPER_OPENAI_MODEL,
    }
  }

  return {
    provider: "whisper_local",
    model: env.WHISPER_LOCAL_MODEL?.trim() || DEFAULT_WHISPER_LOCAL_MODEL,
  }
}

export async function transcribeWithResolvedProvider(
  buffer: Buffer,
  filename: string,
  resolved: ResolvedTranscriptionProvider = resolveTranscriptionProvider(),
): Promise<string> {
  switch (resolved.provider) {
    case "gcp_stt_v2":
      return transcribeWithGcpStt(buffer, filename)
    case "medasr":
      return transcribeWithMedASR(buffer, filename)
    case "whisper_openai":
      return transcribeWithWhisperOpenAI(buffer, filename)
    case "whisper_local":
    default:
      return transcribeWithWhisperLocal(buffer, filename)
  }
}
