import type { NextRequest } from "next/server"
import {
  parseWavHeader,
  transcribeWavBuffer,
  transcriptionSessionStore,
} from "@/features/transcription"

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
      const transcript = await transcribeWavBuffer(Buffer.from(arrayBuffer), `${sessionId}-final.wav`)
      transcriptionSessionStore.setFinalTranscript(sessionId, transcript)
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      })
    } catch (error) {
      console.error("Final transcription failed", error)
      transcriptionSessionStore.emitError(
        sessionId,
        "api_error",
        error instanceof Error ? error.message : "Transcription API failure",
      )
      return jsonError(502, "api_error", "Transcription API failed")
    }
  } catch (error) {
    console.error("Final recording ingestion failed", error)
    return jsonError(500, "storage_error", "Failed to process final recording")
  }
}
