import assert from "node:assert/strict"
import test from "node:test"
import { resolveTranscriptionProvider } from "../providers/provider-resolver.js"
import { transcribeWavBuffer as transcribeWithWhisperLocal } from "../providers/whisper-local-transcriber.js"

test("resolveTranscriptionProvider defaults to whisper_local with tiny.en model", () => {
  const resolved = resolveTranscriptionProvider({})
  assert.equal(resolved.provider, "whisper_local")
  assert.equal(resolved.model, "tiny.en")
})

test("resolveTranscriptionProvider supports explicit provider aliases", () => {
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "medasr" }).provider, "medasr")
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "openai" }).provider, "whisper_openai")
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "whisper_openai" }).provider, "whisper_openai")
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "whisper_local" }).provider, "whisper_local")
})

test("whisper local transcriber retries transient failures and returns text", async () => {
  const waitCalls: number[] = []
  let attempts = 0
  const fetchFn: typeof fetch = (async () => {
    attempts += 1
    if (attempts < 3) {
      return new Response("server busy", { status: 503 })
    }
    return new Response(JSON.stringify({ text: " final transcript " }), { status: 200 })
  }) as typeof fetch

  const text = await transcribeWithWhisperLocal(Buffer.from([1, 2, 3]), "segment.wav", {
    fetchFn,
    waitFn: async (ms) => {
      waitCalls.push(ms)
    },
    timeoutMs: 10_000,
    maxRetries: 3,
    baseUrl: "http://127.0.0.1:8002/v1/audio/transcriptions",
  })

  assert.equal(text, "final transcript")
  assert.equal(attempts, 3)
  assert.deepEqual(waitCalls, [250, 500])
})

test("whisper local transcriber surfaces connection guidance when server is unavailable", async () => {
  const fetchFn: typeof fetch = (async () => {
    throw new TypeError("fetch failed")
  }) as typeof fetch

  await assert.rejects(
    () =>
      transcribeWithWhisperLocal(Buffer.from([1, 2, 3]), "segment.wav", {
        fetchFn,
        waitFn: async () => {
          // no-op
        },
        timeoutMs: 10_000,
        maxRetries: 1,
      }),
    /Cannot connect to Whisper local server/,
  )
})
