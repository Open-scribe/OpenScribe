export interface WavInfo {
  sampleRate: number
  numChannels: number
  bitDepth: number
  durationMs: number
  dataBytes: number
}

function readString(view: DataView, offset: number, length: number): string {
  let value = ""
  for (let i = 0; i < length; i++) {
    value += String.fromCharCode(view.getUint8(offset + i))
  }
  return value
}

export function parseWavHeader(buffer: ArrayBuffer): WavInfo {
  if (buffer.byteLength < 44) {
    throw new Error("WAV buffer too small")
  }

  const view = new DataView(buffer)
  const riff = readString(view, 0, 4)
  const wave = readString(view, 8, 4)
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("Invalid WAV header")
  }

  let offset = 12
  let sampleRate = 0
  let numChannels = 0
  let bitDepth = 0
  let dataBytes = 0

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = readString(view, offset, 4)
    const chunkSize = view.getUint32(offset + 4, true)
    const chunkStart = offset + 8

    if (chunkId === "fmt ") {
      const audioFormat = view.getUint16(chunkStart, true)
      if (audioFormat !== 1) {
        throw new Error("Only PCM WAV files are supported")
      }
      numChannels = view.getUint16(chunkStart + 2, true)
      sampleRate = view.getUint32(chunkStart + 4, true)
      bitDepth = view.getUint16(chunkStart + 14, true)
    } else if (chunkId === "data") {
      dataBytes = chunkSize
      break
    }

    offset = chunkStart + chunkSize
  }

  if (!sampleRate || !numChannels || !bitDepth || !dataBytes) {
    throw new Error("Incomplete WAV data")
  }

  const bytesPerSample = bitDepth / 8
  const totalSamples = dataBytes / bytesPerSample / numChannels
  const durationMs = (totalSamples / sampleRate) * 1000

  return {
    sampleRate,
    numChannels,
    bitDepth,
    durationMs,
    dataBytes,
  }
}
