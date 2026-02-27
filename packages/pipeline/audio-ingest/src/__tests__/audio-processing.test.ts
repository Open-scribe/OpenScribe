import assert from "node:assert/strict"
import test from "node:test"
import {
  SampleBuffer,
  StreamingResampler,
  TARGET_SAMPLE_RATE,
  createFinalSegmentFromRemaining,
  createWavBlob,
  drainSegments,
} from "../capture/audio-processing.js"
import { toAudioIngestError } from "../errors.js"

test("StreamingResampler accumulates until enough samples are available", () => {
  const resampler = new StreamingResampler(48000, TARGET_SAMPLE_RATE)
  const firstChunk = Float32Array.from({ length: 2 }, (_, i) => i / 10)
  const secondChunk = Float32Array.from({ length: 200 }, (_, i) => (i + 2) / 200)

  const firstOutput = resampler.process(firstChunk)
  assert.equal(firstOutput.length, 0, "Initial chunk should not emit output when insufficient samples")

  const secondOutput = resampler.process(secondChunk)
  const expectedLength = Math.floor((firstChunk.length + secondChunk.length) / 3)
  assert.equal(secondOutput.length, expectedLength, "Output length should follow the resampling ratio (48k->16k)")
  assert.ok(
    secondOutput[1] > secondOutput[0],
    "Resampled output should preserve the general shape of the input ramp",
  )

  const flushRemainder = resampler.flush()
  assert.equal(
    flushRemainder.length,
    (firstChunk.length + secondChunk.length) % 3,
    "Flush should emit the fractional leftover samples",
  )
})

test("SampleBuffer with drainSegments enforces overlaps correctly", () => {
  const buffer = new SampleBuffer()
  const segmentSamples = 160
  const overlapSamples = 32
  const segmentAdvance = segmentSamples - overlapSamples
  const totalSamples = segmentSamples + segmentAdvance + 20
  buffer.push(Float32Array.from({ length: totalSamples }, (_, i) => i))

  const emitted: Float32Array[] = []
  drainSegments(buffer, segmentSamples, overlapSamples, (segment) => emitted.push(segment))

  assert.equal(emitted.length, 2, "Should emit two full segments from the buffer")
  assert.equal(
    emitted[1][0],
    emitted[0][segmentAdvance],
    "Second segment should start at the non-overlapped portion of the first",
  )
  assert.equal(
    buffer.length,
    totalSamples - segmentAdvance * emitted.length,
    "Buffer should retain the partial samples needed for the next slice",
  )
})

test("createFinalSegmentFromRemaining pads when minimum samples are met", () => {
  const minSamples = 800
  const segmentSamples = 1600
  const shortTail = Float32Array.from({ length: minSamples - 1 }, () => 0.1)
  const longTail = Float32Array.from({ length: minSamples + 50 }, (_, i) => i / 100)

  const shortResult = createFinalSegmentFromRemaining(shortTail, minSamples, segmentSamples)
  assert.equal(shortResult, null, "Remaining audio shorter than the minimum should not create a segment")

  const finalSegment = createFinalSegmentFromRemaining(longTail, minSamples, segmentSamples)
  assert(finalSegment, "Remaining audio passing the threshold should create a padded segment")
  assert.equal(finalSegment!.length, segmentSamples)
  assert.equal(finalSegment![minSamples + 10], longTail[minSamples + 10])
})

test("createWavBlob produces a valid PCM header and payload", async () => {
  const sampleRate = 16000
  const samples = Float32Array.from([0, 0.5, -0.5, 0.25])
  const blob = createWavBlob(samples, sampleRate)
  const buffer = await blob.arrayBuffer()
  const view = new DataView(buffer)

  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))
  assert.equal(riff, "RIFF")
  assert.equal(wave, "WAVE")

  const dataSize = view.getUint32(40, true)
  assert.equal(dataSize, samples.length * 2, "Data chunk size should match 16-bit PCM payload")

  const firstSample = view.getInt16(44, true)
  const secondSample = view.getInt16(46, true)
  assert.equal(firstSample, 0)
  assert.equal(secondSample, 16383)
})

test("audio-ingest normalizes recorder failures to shared pipeline error shape", () => {
  const error = toAudioIngestError(new Error("Microphone denied"), "capture_error")
  assert.equal(error.code, "capture_error")
  assert.equal(error.message, "Microphone denied")
  assert.equal(error.recoverable, true)
})
