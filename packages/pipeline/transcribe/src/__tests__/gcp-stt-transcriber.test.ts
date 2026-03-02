import assert from 'node:assert/strict'
import test from 'node:test'
import { transcribeWavBuffer } from '../providers/gcp-stt-transcriber.js'

const originalFetch = globalThis.fetch

test('gcp stt transcriber returns joined transcript text', async () => {
  const previousEnv = { ...process.env }
  process.env.GCP_PROJECT_ID = 'demo-project'
  process.env.GOOGLE_OAUTH_ACCESS_TOKEN = 'token'

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('speech.googleapis.com')) {
      return new Response(
        JSON.stringify({
          results: [
            { alternatives: [{ transcript: 'hello' }] },
            { alternatives: [{ transcript: 'world' }] },
          ],
        }),
        { status: 200 },
      )
    }
    return new Response(JSON.stringify({ access_token: 'metadata-token' }), { status: 200 })
  }) as typeof fetch

  const transcript = await transcribeWavBuffer(Buffer.from([1, 2, 3]), 'segment.wav')
  assert.equal(transcript, 'hello world')

  process.env = previousEnv
  globalThis.fetch = originalFetch
})

test('gcp stt transcriber retries retryable HTTP failures', async () => {
  const previousEnv = { ...process.env }
  process.env.GCP_PROJECT_ID = 'demo-project'
  process.env.GOOGLE_OAUTH_ACCESS_TOKEN = 'token'
  process.env.GCP_STT_MAX_RETRIES = '2'

  let attempts = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!url.includes('speech.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'metadata-token' }), { status: 200 })
    }

    attempts += 1
    if (attempts < 3) {
      return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 })
    }
    return new Response(JSON.stringify({ results: [{ alternatives: [{ transcript: 'ok' }] }] }), { status: 200 })
  }) as typeof fetch

  const transcript = await transcribeWavBuffer(Buffer.from([1, 2, 3]), 'segment.wav')
  assert.equal(transcript, 'ok')
  assert.equal(attempts, 3)

  process.env = previousEnv
  globalThis.fetch = originalFetch
})

test('gcp stt transcriber throws when project id is missing', async () => {
  const previousEnv = { ...process.env }
  delete process.env.GCP_PROJECT_ID
  delete process.env.GOOGLE_CLOUD_PROJECT
  delete process.env.GCLOUD_PROJECT

  await assert.rejects(
    () => transcribeWavBuffer(Buffer.from([1, 2, 3]), 'segment.wav'),
    /Missing GCP project id/,
  )

  process.env = previousEnv
})
