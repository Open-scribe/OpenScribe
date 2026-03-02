import type { NextRequest } from "next/server"
import { parseWavHeader, resolveTranscriptionProvider, transcribeWithResolvedProvider } from "@transcription"
import { transcriptionSessionStore } from "@transcript-assembly"
import { writeServerAuditEntry, logSanitizedServerError } from "@storage/server-audit"
import { requireAuth } from "@/lib/auth"

export const runtime = "nodejs"

function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth) {
    return jsonError(401, "unauthorized", "Authentication required")
  }

  try {
    const formData = await req.formData()
    const sessionId = formData.get("session_id")
    const file = formData.get("file")

    if (typeof sessionId !== "string" || !(file instanceof Blob)) {
      return jsonError(400, "validation_error", "Missing session_id or file")
    }

    await transcriptionSessionStore.setStatus(sessionId, "finalizing")

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
      await transcriptionSessionStore.setFinalTranscript(sessionId, transcript)

      // Audit log: final transcription completed
      await writeServerAuditEntry({
        event_type: "transcription.completed",
        org_id: auth.orgId,
        user_id: auth.userId,
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
      logSanitizedServerError("transcription.final", error)
      const resolvedProvider = resolveTranscriptionProvider()
      await transcriptionSessionStore.emitError(
        sessionId,
        "api_error",
        error instanceof Error ? error.message : "Transcription API failure",
      )

      // Audit log: final transcription failed
      await writeServerAuditEntry({
        event_type: "transcription.failed",
        org_id: auth.orgId,
        user_id: auth.userId,
        resource_id: sessionId,
        success: false,
        error_code: "transcription_failed",
        error_message: error instanceof Error ? error.message : "Transcription API failed",
        metadata: {
          transcription_provider: resolvedProvider.provider,
          transcription_model: resolvedProvider.model,
        },
      })

      return jsonError(502, "api_error", "Transcription API failed")
    }
  } catch (error) {
    logSanitizedServerError("transcription.final.ingest", error)
    return jsonError(500, "storage_error", "Failed to process final recording")
  }
}
