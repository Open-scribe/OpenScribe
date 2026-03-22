import type { NextRequest } from "next/server"
import { toPipelineError } from "@pipeline-errors"
import { parseWavHeader, resolveTranscriptionProvider, transcribeWithResolvedProvider } from "@transcription"
import {
  emitTranscriptionError,
  setTranscriptionFinal,
  setTranscriptionStatus,
} from "@/lib/transcription-store"
import { writeAuditEntry } from "@storage/audit-log"
import { requireAuthenticatedUser, requireAcceptedTerms } from "@/lib/auth-guard"
import { logServer } from "@/lib/server-logger"

export const runtime = "nodejs"

function jsonError(status: number, code: string, message: string, recoverable: boolean) {
  return new Response(JSON.stringify({ error: { code, message, recoverable } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function getWavDataChunk(buffer: ArrayBuffer): { offset: number; size: number } | null {
  if (buffer.byteLength < 44) return null
  const view = new DataView(buffer)
  let offset = 12
  while (offset + 8 <= buffer.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    )
    const chunkSize = view.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    if (chunkId === "data") {
      return { offset: chunkStart, size: Math.min(chunkSize, buffer.byteLength - chunkStart) }
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }
  return null
}

function isLikelySilentPcm16(buffer: ArrayBuffer): boolean {
  const data = getWavDataChunk(buffer)
  if (!data || data.size < 2) return true
  const view = new DataView(buffer, data.offset, data.size)
  const sampleCount = Math.floor(data.size / 2)
  if (sampleCount === 0) return true

  let sumSquares = 0
  let peak = 0
  let nonTrivial = 0
  for (let i = 0; i < sampleCount; i += 1) {
    const raw = view.getInt16(i * 2, true)
    const normalized = raw / 32768
    const abs = Math.abs(normalized)
    if (abs > peak) peak = abs
    if (abs > 0.001) nonTrivial += 1
    sumSquares += normalized * normalized
  }
  const rms = Math.sqrt(sumSquares / sampleCount)
  const nonTrivialRatio = nonTrivial / sampleCount
  return rms < 0.001 && peak < 0.005 && nonTrivialRatio < 0.02
}

function isBlankTranscript(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  return (
    normalized.length === 0 ||
    normalized === "[blank_audio]" ||
    normalized === "no speech detected in audio" ||
    normalized === "audio file too small or empty" ||
    normalized === "none"
  )
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser()
    if (!auth.ok) return auth.response
    const terms = await requireAcceptedTerms(auth.userId)
    if (!terms.ok) return terms.response

    const formData = await req.formData()
    const sessionId = formData.get("session_id")
    const file = formData.get("file")

    if (typeof sessionId !== "string" || !(file instanceof Blob)) {
      return jsonError(400, "validation_error", "Missing session_id or file", false)
    }

    await setTranscriptionStatus(sessionId, "finalizing", auth.userId)

    const arrayBuffer = await file.arrayBuffer()
    let wavInfo
    try {
      wavInfo = parseWavHeader(arrayBuffer)
    } catch (error) {
      return jsonError(400, "validation_error", error instanceof Error ? error.message : "Invalid WAV file", true)
    }

    if (wavInfo.sampleRate !== 16000 || wavInfo.numChannels !== 1 || wavInfo.bitDepth !== 16) {
      return jsonError(400, "validation_error", "Final recording must be 16kHz mono 16-bit PCM WAV", true)
    }
    // Do not fail final transcription based on amplitude alone.
    // Quiet speech can still produce a valid transcript.
    const likelySilentAudio = isLikelySilentPcm16(arrayBuffer)

    try {
      const resolvedProvider = resolveTranscriptionProvider()
      const startedAtMs = Date.now()
      const transcript = await transcribeWithResolvedProvider(
        Buffer.from(arrayBuffer),
        `${sessionId}-final.wav`,
        resolvedProvider,
      )
      const latencyMs = Date.now() - startedAtMs
      if (isBlankTranscript(transcript)) {
        await emitTranscriptionError(
          sessionId,
          toPipelineError(
            new Error("No detectable speech signal in the recording. Check microphone input/device and retry."),
            { code: "blank_audio", message: "No detectable speech signal in the recording. Check microphone input/device and retry.", recoverable: true },
          ),
          auth.userId,
        )
        return jsonError(
          422,
          "blank_audio",
          "No detectable speech signal in the recording. Check microphone input/device and retry.",
        )
      }
      if (likelySilentAudio) {
        logServer("warn", "Low-energy capture produced transcript", {
          sessionId,
          durationMs: wavInfo.durationMs,
        })
      }
      await setTranscriptionFinal(sessionId, transcript, auth.userId)

      // Audit log: final transcription completed
      await writeAuditEntry({
        event_type: "transcription.completed",
        resource_id: sessionId,
        success: true,
        metadata: {
          duration_ms: wavInfo.durationMs,
          file_size_bytes: arrayBuffer.byteLength,
          transcription_provider: resolvedProvider.provider,
          transcription_model: resolvedProvider.model,
          transcription_latency_ms: latencyMs,
        },
      })

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      })
    } catch (error) {
      logServer("error", "Final audio processing failed", {
        code: error instanceof Error ? error.name : "unknown_error",
      })
      const resolvedProvider = resolveTranscriptionProvider()
      const pipelineError = toPipelineError(error, {
        code: "api_error",
        message: "Transcription API failure",
        recoverable: true,
      })
      await emitTranscriptionError(sessionId, pipelineError, auth.userId)

      // Audit log: final transcription failed
      await writeAuditEntry({
        event_type: "transcription.failed",
        resource_id: sessionId,
        success: false,
        error_message: error instanceof Error ? error.message : "Transcription API failed",
        metadata: {
          transcription_provider: resolvedProvider.provider,
          transcription_model: resolvedProvider.model,
        },
      })

      return jsonError(502, pipelineError.code, pipelineError.message, pipelineError.recoverable)
    }
  } catch (error) {
    logServer("error", "Final recording ingestion failed", {
      code: error instanceof Error ? error.name : "unknown_error",
    })
    return jsonError(500, "storage_error", "Failed to process final recording", false)
  }
}
