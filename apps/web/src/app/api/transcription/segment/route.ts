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
    const seqNo = Number(formData.get("seq_no"))
    const startMs = Number(formData.get("start_ms"))
    const endMs = Number(formData.get("end_ms"))
    const durationMs = Number(formData.get("duration_ms"))
    const overlapMs = Number(formData.get("overlap_ms"))
    const file = formData.get("file")

    if (
      typeof sessionId !== "string" ||
      Number.isNaN(seqNo) ||
      Number.isNaN(startMs) ||
      Number.isNaN(endMs) ||
      Number.isNaN(durationMs) ||
      Number.isNaN(overlapMs) ||
      !(file instanceof Blob)
    ) {
      return jsonError(400, "validation_error", "Missing required metadata or file")
    }

    const arrayBuffer = await file.arrayBuffer()
    let wavInfo
    try {
      wavInfo = parseWavHeader(arrayBuffer)
    } catch (error) {
      return jsonError(400, "validation_error", error instanceof Error ? error.message : "Invalid WAV file")
    }

    if (wavInfo.sampleRate !== 16000 || wavInfo.numChannels !== 1 || wavInfo.bitDepth !== 16) {
      return jsonError(400, "validation_error", "Segments must be 16kHz mono 16-bit PCM WAV")
    }

    if (wavInfo.durationMs < 8000 || wavInfo.durationMs > 12000) {
      return jsonError(400, "validation_error", "Segment duration must be between 8s and 12s")
    }

    try {
      const resolvedProvider = resolveTranscriptionProvider()
      const startedAtMs = Date.now()
      const transcript = await transcribeWithResolvedProvider(Buffer.from(arrayBuffer), `segment-${seqNo}.wav`, resolvedProvider)
      const latencyMs = Date.now() - startedAtMs
      await transcriptionSessionStore.addSegment(sessionId, {
        seqNo,
        startMs,
        endMs,
        durationMs,
        overlapMs,
        transcript,
      })

      // Audit log: segment transcribed successfully
      await writeServerAuditEntry({
        event_type: "transcription.segment_uploaded",
        org_id: auth.orgId,
        user_id: auth.userId,
        resource_id: sessionId,
        success: true,
        metadata: {
          seq_no: seqNo,
          duration_ms: durationMs,
          transcription_provider: resolvedProvider.provider,
          transcription_model: resolvedProvider.model,
          transcription_latency_ms: latencyMs,
        },
      })

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      })
    } catch (error) {
      logSanitizedServerError("transcription.segment", error)
      const resolvedProvider = resolveTranscriptionProvider()
      await transcriptionSessionStore.emitError(
        sessionId,
        "api_error",
        error instanceof Error ? error.message : "Transcription API failure",
      )

      // Audit log: segment transcription failed
      await writeServerAuditEntry({
        event_type: "transcription.failed",
        org_id: auth.orgId,
        user_id: auth.userId,
        resource_id: sessionId,
        success: false,
        error_code: "transcription_failed",
        error_message: error instanceof Error ? error.message : "Transcription API failed",
        metadata: {
          seq_no: seqNo,
          transcription_provider: resolvedProvider.provider,
          transcription_model: resolvedProvider.model,
        },
      })

      return jsonError(502, "api_error", "Transcription API failed")
    }
  } catch (error) {
    logSanitizedServerError("transcription.segment.ingest", error)
    return jsonError(500, "storage_error", "Failed to process audio segment")
  }
}
