import assert from "node:assert/strict"
import test from "node:test"
import { parseWavHeader } from "../core/wav.js"
import {
  SegmentUploadController,
  type PendingSegment,
  type UploadError,
} from "../hooks/segment-upload-controller.js"
import { transcribeWavBuffer } from "../providers/whisper-transcriber.js"

function createTestWavBuffer({
  sampleRate,
  numChannels,
  numSamples,
  bitDepth = 16,
}: {
  sampleRate: number
  numChannels: number
  numSamples: number
  bitDepth?: number
}): ArrayBuffer {
  const bytesPerSample = bitDepth / 8
  const dataSize = numSamples * numChannels * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeString(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  view.setUint16(32, numChannels * bytesPerSample, true)
  view.setUint16(34, bitDepth, true)
  writeString(36, "data")
  view.setUint32(40, dataSize, true)

  return buffer
}

function createSegment(seqNo: number): PendingSegment {
  return {
    seqNo,
    startMs: seqNo * 1000,
    endMs: seqNo * 1000 + 1000,
    durationMs: 1000,
    overlapMs: 250,
    blob: new Blob([new Uint8Array([seqNo])], { type: "audio/wav" }),
  }
}

test("parseWavHeader returns accurate metadata", () => {
  const buffer = createTestWavBuffer({ sampleRate: 16000, numChannels: 2, numSamples: 16000 })
  const info = parseWavHeader(buffer)

  assert.equal(info.sampleRate, 16000)
  assert.equal(info.numChannels, 2)
  assert.equal(info.bitDepth, 16)
  assert.equal(info.durationMs, 1000, "32000 samples at 16kHz stereo should equal 1 second")
})

test("parseWavHeader rejects short buffers", () => {
  const tiny = new ArrayBuffer(10)
  try {
    parseWavHeader(tiny)
    assert.fail("Expected parseWavHeader to throw")
  } catch (error) {
    assert.equal(typeof error, "object")
    assert.equal((error as { code?: string }).code, "validation_error")
    assert.equal((error as { message?: string }).message, "WAV buffer too small")
    assert.equal((error as { recoverable?: boolean }).recoverable, true)
  }
})

test("SegmentUploadController enforces concurrency limits", async () => {
  const totalSegments = 5
  let completed = 0
  let maxInFlight = 0
  let currentInFlight = 0
  let completionResolve: (() => void) | null = null
  const completionPromise = new Promise<void>((resolve) => {
    completionResolve = resolve
  })

  const fetchStub: typeof fetch = async () => {
    currentInFlight++
    maxInFlight = Math.max(maxInFlight, currentInFlight)
    await new Promise((resolve) => setImmediate(resolve))
    currentInFlight--
    completed += 1
    if (completed === totalSegments) {
      completionResolve?.()
    }
    return new Response("{}", { status: 200 })
  }

  const controller = new SegmentUploadController("session-1", undefined, { fetchFn: fetchStub })

  for (let i = 0; i < totalSegments; i++) {
    controller.enqueueSegment(createSegment(i))
  }

  await completionPromise
  controller.dispose()

  assert.equal(completed, totalSegments)
  assert.equal(maxInFlight, 2, "No more than two uploads should be in flight simultaneously")
  assert.equal(currentInFlight, 0)
})

test("SegmentUploadController retries transient errors and surfaces final failures", async () => {
  const waitCalls: number[] = []
  const errors: UploadError[] = []
  let attempt = 0
  let completionResolve: (() => void) | null = null
  const completionPromise = new Promise<void>((resolve) => {
    completionResolve = resolve
  })

  const fetchStub: typeof fetch = async () => {
    attempt += 1
    if (attempt < 3) {
      return new Response(JSON.stringify({ error: { code: "api_error", message: "server tired" } }), { status: 500 })
    }
    completionResolve?.()
    return new Response("{}", { status: 200 })
  }

  const controller = new SegmentUploadController(
    "session-1",
    {
      onError: (error) => errors.push(error),
    },
    {
      fetchFn: fetchStub,
      waitFn: async (ms) => {
        waitCalls.push(ms)
      },
    },
  )

  controller.enqueueSegment(createSegment(1))
  await completionPromise
  controller.dispose()

  assert.deepEqual(waitCalls, [250, 500], "Should wait with incremental backoff for retries")
  assert.equal(errors.length, 0, "Successful retry should not surface an error")

  const failingFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({ error: { code: "validation_error", message: "bad segment" } }), { status: 400 })
  }

  const failureController = new SegmentUploadController(
    "session-2",
    {
      onError: (error) => errors.push(error),
    },
    {
      fetchFn: failingFetch,
      waitFn: async () => {
        /* no-op */
      },
    },
  )

  failureController.enqueueSegment(createSegment(2))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(errors.at(-1)?.code, "validation_error")
  assert.match(errors.at(-1)?.message ?? "", /bad segment/)

  failureController.setSessionId(null)
  failureController.enqueueSegment(createSegment(3))
  assert.equal(errors.at(-1)?.code, "capture_error", "Missing session should surface capture_error")

  failureController.dispose()
})

test("transcribeWavBuffer validates API keys and forwards payloads", async () => {
  const originalKey = process.env.OPENAI_API_KEY
  const originalFetch = globalThis.fetch

  process.env.OPENAI_API_KEY = ""
  await assert.rejects(() => transcribeWavBuffer(Buffer.from([0, 1, 2]), "sample.wav"), /OPENAI_API_KEY/)

  const seen: { url?: string; headers?: HeadersInit; form?: FormData } = {}
  process.env.OPENAI_API_KEY = "test-key"
  globalThis.fetch = (async (url, init) => {
    seen.url = url as string
    seen.headers = init?.headers
    seen.form = init?.body as FormData
    return new Response(JSON.stringify({ text: " hi " }), { status: 200 })
  }) as typeof fetch

  try {
    const text = await transcribeWavBuffer(Buffer.from([1, 2, 3]), "clip.wav")
    assert.equal(text, "hi")
    assert.equal(seen.url, "https://api.openai.com/v1/audio/transcriptions")
    const authHeader = (seen.headers as Record<string, string>)?.Authorization
    assert.equal(authHeader, "Bearer test-key")
    assert(seen.form instanceof FormData)
  } finally {
    process.env.OPENAI_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})

test("transcribeWavBuffer enforces HTTPS for HIPAA compliance", async () => {
  // Test that the hardcoded URL is HTTPS
  const originalKey = process.env.OPENAI_API_KEY
  const originalFetch = globalThis.fetch

  process.env.OPENAI_API_KEY = "test-key"
  let capturedUrl: string | undefined
  
  globalThis.fetch = (async (url) => {
    capturedUrl = url as string
    return new Response(JSON.stringify({ text: "test" }), { status: 200 })
  }) as typeof fetch

  try {
    await transcribeWavBuffer(Buffer.from([1, 2, 3]), "test.wav")
    assert(capturedUrl?.startsWith("https://"), "Whisper API URL must use HTTPS")
  } finally {
    process.env.OPENAI_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})
