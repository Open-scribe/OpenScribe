import type { NextRequest } from "next/server"
import { toPipelineError } from "@pipeline-errors"
import { parseWavHeader, resolveTranscriptionProvider, transcribeWithResolvedProvider } from "@transcription"
import { transcriptionSessionStore } from "@transcript-assembly"
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

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser()
    if (!auth.ok) return auth.response
    const terms = await requireAcceptedTerms(auth.userId, req)
    if (!terms.ok) return terms.response

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
      return jsonError(400, "validation_error", "Missing required metadata or file", false)
    }

    const arrayBuffer = await file.arrayBuffer()
    let wavInfo
    try {
      wavInfo = parseWavHeader(arrayBuffer)
    } catch (error) {
      return jsonError(400, "validation_error", error instanceof Error ? error.message : "Invalid WAV file", true)
    }

    if (wavInfo.sampleRate !== 16000 || wavInfo.numChannels !== 1 || wavInfo.bitDepth !== 16) {
      return jsonError(400, "validation_error", "Segments must be 16kHz mono 16-bit PCM WAV", true)
    }

    if (wavInfo.durationMs < 8000 || wavInfo.durationMs > 12000) {
      return jsonError(400, "validation_error", "Segment duration must be between 8s and 12s", true)
    }
    if (isLikelySilentPcm16(arrayBuffer)) {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: true,
          reason: "blank_audio",
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    try {
      const resolvedProvider = resolveTranscriptionProvider()
      const startedAtMs = Date.now()
      const transcript = await transcribeWithResolvedProvider(Buffer.from(arrayBuffer), `segment-${seqNo}.wav`, resolvedProvider)
      const latencyMs = Date.now() - startedAtMs
      transcriptionSessionStore.addSegment(sessionId, {
        seqNo,
        startMs,
        endMs,
        durationMs,
        overlapMs,
        transcript,
      }, auth.userId)

      // Audit log: segment transcribed successfully
      await writeAuditEntry({
        event_type: "transcription.segment_uploaded",
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
      logServer("error", "Segment audio processing failed", {
        code: error instanceof Error ? error.name : "unknown_error",
      })
      const resolvedProvider = resolveTranscriptionProvider()
      const pipelineError = toPipelineError(error, {
        code: "api_error",
        message: "Transcription API failure",
        recoverable: true,
      })
      transcriptionSessionStore.emitError(sessionId, pipelineError, auth.userId)

      // Audit log: segment transcription failed
      await writeAuditEntry({
        event_type: "transcription.failed",
        resource_id: sessionId,
        success: false,
        error_message: error instanceof Error ? error.message : "Transcription API failed",
        metadata: {
          seq_no: seqNo,
          transcription_provider: resolvedProvider.provider,
          transcription_model: resolvedProvider.model,
        },
      })

      return jsonError(502, pipelineError.code, pipelineError.message, pipelineError.recoverable)
    }
  } catch (error) {
    logServer("error", "Segment ingestion failed", {
      code: error instanceof Error ? error.name : "unknown_error",
    })
    return jsonError(500, "storage_error", "Failed to process audio segment", false)
  }
}
