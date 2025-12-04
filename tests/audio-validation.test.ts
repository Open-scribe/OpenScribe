import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { parseWavHeader } from "../src/features/transcription/core/wav.js"

const SAMPLE_MP3 = path.resolve(
  process.cwd(),
  "testMP3",
  "Sample Problem-Focused Standardized Patient Encounter.mp3",
)

test("MP3 snippet is rejected by WAV validator", async () => {
  const mp3Buffer = await readFile(SAMPLE_MP3)
  // Only use the first ~64KB to keep the test fast while still reading real audio data.
  const slice = mp3Buffer.subarray(0, 64 * 1024)
  const arrayBuffer = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)

  assert.throws(
    () => parseWavHeader(arrayBuffer),
    /WAV/i,
    "Expected MP3 data to be rejected by WAV header parser",
  )
})
