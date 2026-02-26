import type { NextRequest } from "next/server"
import { parseWavHeader, resolveTranscriptionProvider, transcribeWithResolvedProvider } from "@transcription"
import { transcriptionSessionStore } from "@transcript-assembly"
import { writeAuditEntry } from "@storage/audit-log"

export const runtime = "nodejs"

function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const sessionId = formData.get("session_id")
    const file = formData.get("file")

    if (typeof sessionId !== "string" || !(file instanceof Blob)) {
      return jsonError(400, "validation_error", "Missing session_id or file")
    }

    transcriptionSessionStore.setStatus(sessionId, "finalizing")

    const arrayBuffer = await file.arrayBuffer()
    let wavInfo
    try {
      wavInfo = parseWavHeader(arrayBuffer)
    } catch (error) {
      return jsonError(400, "validation_error", error instanceof Error ? error.message : "Invalid WAV file")
    }

    if (wavInfo.sampleRate !== 16000 || wavInfo.numChannels !== 1 || wavInfo.bitDepth !== 16) {
      return jsonError(400, "validation_error", "Final recording must be 16kHz mono 16-bit PCM WAV")
    }

    try {
      const resolvedProvider = resolveTranscriptionProvider()
      const startedAtMs = Date.now()
      const transcript = await transcribeWithResolvedProvider(
        Buffer.from(arrayBuffer),
        `${sessionId}-final.wav`,
        resolvedProvider,
      )
      const latencyMs = Date.now() - startedAtMs
      transcriptionSessionStore.setFinalTranscript(sessionId, transcript)

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
      console.error("Final transcription failed", error)
      const resolvedProvider = resolveTranscriptionProvider()
      transcriptionSessionStore.emitError(
        sessionId,
        "api_error",
        error instanceof Error ? error.message : "Transcription API failure",
      )

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

      return jsonError(502, "api_error", "Transcription API failed")
    }
  } catch (error) {
    console.error("Final recording ingestion failed", error)
    return jsonError(500, "storage_error", "Failed to process final recording")
  }
}
