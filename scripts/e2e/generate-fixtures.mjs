#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

function createWavTone(seconds = 1, sampleRate = 16000, frequency = 440) {
  const numSamples = seconds * sampleRate
  const data = Buffer.alloc(numSamples * 2)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const sample = Math.round(Math.sin(2 * Math.PI * frequency * t) * 0.2 * 32767)
    data.writeInt16LE(sample, i * 2)
  }
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const wavPath = resolve(process.cwd(), "build", "e2e", "fixtures", "tone-1s.wav")
const expectedPath = resolve(process.cwd(), "build", "e2e", "fixtures", "expected.json")
mkdirSync(dirname(wavPath), { recursive: true })
writeFileSync(wavPath, createWavTone())
writeFileSync(
  expectedPath,
  JSON.stringify(
    {
      fixture: "tone-1s.wav",
      expected: {
        setup_status: "available",
        coarse_output_present: true,
      },
    },
    null,
    2,
  ),
)
console.log(`Created fixture: ${wavPath}`)
console.log(`Created expectation: ${expectedPath}`)
