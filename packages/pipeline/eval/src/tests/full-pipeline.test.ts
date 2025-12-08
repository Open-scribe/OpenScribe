import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

type TranscriptionEvent = {
  event: "segment" | "final" | "error" | "status"
  data: Record<string, unknown>
}

interface PipelineSegment {
  seqNo: number
  startMs: number
  endMs: number
  durationMs: number
  overlapMs: number
  blob: Blob
}

function convertMp3BytesToSamples(buffer: Buffer): Float32Array {
  const samples = new Float32Array(buffer.length)
  for (let i = 0; i < buffer.length; i++) {
    samples[i] = (buffer[i] - 128) / 128
  }
  return samples
}

test("sample MP3 flows through the pipeline checkpoints", { timeout: 60_000 }, async (t) => {
  const progress: string[] = []

  const audioPath = path.resolve(
    process.cwd(),
    "packages/pipeline/eval/src/cases/encounter/Sample Problem-Focused Standardized Patient Encounter.mp3",
  )
  let mp3Buffer: Buffer
  try {
    mp3Buffer = await readFile(audioPath)
  } catch {
    t.skip(`Sample audio missing at ${audioPath}`)
    return
  }

  assert(mp3Buffer.byteLength > 0, "sample audio file should not be empty")
  const audioProcessing = (await import("../../../audio-ingest/src/capture/audio-processing.js")) as typeof import("../../../audio-ingest/src/capture/audio-processing")
  const {
    DEFAULT_OVERLAP_MS,
    DEFAULT_SEGMENT_MS,
    MIN_FINAL_SEGMENT_MS,
    SampleBuffer,
    StreamingResampler,
    TARGET_SAMPLE_RATE,
    createFinalSegmentFromRemaining,
    createWavBlob,
    drainSegments,
  } = audioProcessing
  const transcribeCore = (await import("../../../transcribe/src/core/wav.js")) as typeof import("../../../transcribe/src/core/wav")
  const { parseWavHeader } = transcribeCore
  const whisperProvider = (await import("../../../transcribe/src/providers/whisper-transcriber.js")) as typeof import("../../../transcribe/src/providers/whisper-transcriber")
  const { transcribeWavBuffer } = whisperProvider
  const assemblyModule = (await import("../../../assemble/src/session-store.js")) as typeof import("../../../assemble/src/session-store")
  const { transcriptionSessionStore } = assemblyModule
  const noteCoreModule = (await import("../../../note-core/src/clinical-models/clinical-note.js")) as typeof import("../../../note-core/src/clinical-models/clinical-note")
  const { serializeNote, parseNoteText } = noteCoreModule
  const segmentDurationMs = DEFAULT_SEGMENT_MS
  const overlapMs = DEFAULT_OVERLAP_MS
  const segmentSamples = Math.round((segmentDurationMs / 1000) * TARGET_SAMPLE_RATE)
  const overlapSamples = Math.round((overlapMs / 1000) * TARGET_SAMPLE_RATE)
  const segmentAdvanceSamples = segmentSamples - overlapSamples
  const minFinalSamples = Math.round((MIN_FINAL_SEGMENT_MS / 1000) * TARGET_SAMPLE_RATE)
  const fakeSourceRate = 44100
  const resampler = new StreamingResampler(fakeSourceRate, TARGET_SAMPLE_RATE)
  const buffer = new SampleBuffer()
  const recordedSegments: PipelineSegment[] = []
  let seqNo = 0

  const collectSegment = (samples: Float32Array) => {
    const blob = createWavBlob(samples, TARGET_SAMPLE_RATE)
    const startSamples = seqNo * segmentAdvanceSamples
    const startMs = Math.round((startSamples / TARGET_SAMPLE_RATE) * 1000)
    recordedSegments.push({
      blob,
      seqNo,
      startMs,
      endMs: startMs + segmentDurationMs,
      durationMs: segmentDurationMs,
      overlapMs,
    })
    seqNo += 1
  }

  const pcmSamples = convertMp3BytesToSamples(mp3Buffer)
  const chunkSize = fakeSourceRate
  for (let offset = 0; offset < pcmSamples.length; offset += chunkSize) {
    const chunk = pcmSamples.subarray(offset, Math.min(offset + chunkSize, pcmSamples.length))
    const resampled = resampler.process(chunk)
    if (resampled.length > 0) {
      buffer.push(resampled)
      drainSegments(buffer, segmentSamples, overlapSamples, collectSegment)
    }
  }

  const remainder = resampler.flush()
  if (remainder.length > 0) {
    buffer.push(remainder)
    drainSegments(buffer, segmentSamples, overlapSamples, collectSegment)
  }
  const leftover = buffer.drain()
  const tail = createFinalSegmentFromRemaining(leftover, minFinalSamples, segmentSamples)
  if (tail) {
    collectSegment(tail)
  }

  assert(recordedSegments.length > 0, "audio ingest stage should emit at least one segment")
  progress.push(`audio-ingest:${recordedSegments.length}`)

  const transcripts: {
    seqNo: number
    startMs: number
    endMs: number
    text: string
  }[] = []
  const originalFetch = globalThis.fetch
  const originalKey = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = "pipeline-test-key"
  let callCount = 0
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ text: `transcript-${callCount++}` }), { status: 200 })) as typeof fetch

  try {
    for (const segment of recordedSegments) {
      const wavBuffer = Buffer.from(await segment.blob.arrayBuffer())
      const arrayBuffer = wavBuffer.buffer.slice(
        wavBuffer.byteOffset,
        wavBuffer.byteOffset + wavBuffer.byteLength,
      ) as ArrayBuffer
      const info = parseWavHeader(arrayBuffer)
      assert.equal(info.sampleRate, TARGET_SAMPLE_RATE, "transcribe stage should preserve target sample rate")
      const transcriptText = await transcribeWavBuffer(wavBuffer, `segment-${segment.seqNo}.wav`)
      transcripts.push({
        seqNo: segment.seqNo,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: transcriptText,
      })
    }
  } finally {
    process.env.OPENAI_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }

  assert.equal(transcripts.length, recordedSegments.length, "every audio segment should generate a transcript entry")
  progress.push(`transcribe:${transcripts.length}`)

  const sessionId = `pipeline-test-${Date.now()}`
  const stitchedSnapshots: string[] = []
  let finalTranscriptFromEvents: string | null = null
  const unsubscribe = transcriptionSessionStore.subscribe(sessionId, (event: TranscriptionEvent) => {
    if (event.event === "segment") {
      stitchedSnapshots.push(String(event.data.stitched_text ?? ""))
    }
    if (event.event === "final") {
      finalTranscriptFromEvents = String(event.data.final_transcript ?? "")
    }
  })

  transcripts.forEach((entry) => {
    transcriptionSessionStore.addSegment(sessionId, {
      seqNo: entry.seqNo,
      startMs: entry.startMs,
      endMs: entry.endMs,
      durationMs: segmentDurationMs,
      overlapMs,
      transcript: entry.text,
    })
  })
  const combinedTranscript = transcripts.map((entry) => entry.text).join(" ").trim()
  transcriptionSessionStore.setFinalTranscript(sessionId, combinedTranscript)
  unsubscribe()

  assert.equal(
    finalTranscriptFromEvents,
    combinedTranscript,
    "assembly stage should emit the stitched final transcript",
  )
  assert(stitchedSnapshots.length >= transcripts.length, "assembly should publish stitched updates per segment")
  progress.push(`assemble:${combinedTranscript.length}`)

  const noteText = serializeNote({
    chief_complaint: transcripts[0]?.text ?? "",
    hpi: combinedTranscript,
    ros: "",
    physical_exam: "",
    assessment: `Segments processed: ${transcripts.length}`,
    plan: "Review generated draft with clinician",
  })
  const parsedNote = parseNoteText(noteText)
  assert.equal(parsedNote.hpi, combinedTranscript)
  assert.equal(parsedNote.chief_complaint, transcripts[0]?.text ?? "")
  progress.push(`note-core:${noteText.length}`)

  assert.deepEqual(
    progress.map((entry) => entry.split(":")[0]),
    ["audio-ingest", "transcribe", "assemble", "note-core"],
    "every pipeline checkpoint should be recorded in order",
  )
})
