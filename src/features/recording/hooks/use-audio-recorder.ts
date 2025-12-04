"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const TARGET_SAMPLE_RATE = 16000
const DEFAULT_SEGMENT_MS = 10000
const DEFAULT_OVERLAP_MS = 250
const MIN_FINAL_SEGMENT_MS = 8000

class StreamingResampler {
  private readonly ratio: number
  private buffer: Float32Array

  constructor(private readonly sourceRate: number, private readonly targetRate: number) {
    const baseRatio = sourceRate / targetRate
    this.ratio = baseRatio > 0 ? baseRatio : 1
    this.buffer = new Float32Array(0)
  }

  process(input: Float32Array): Float32Array {
    if (input.length === 0) {
      return new Float32Array(0)
    }
    const combined = new Float32Array(this.buffer.length + input.length)
    combined.set(this.buffer)
    combined.set(input, this.buffer.length)

    const outputLength = Math.floor(combined.length / this.ratio)
    if (outputLength <= 0) {
      this.buffer = combined
      return new Float32Array(0)
    }

    const output = new Float32Array(outputLength)
    for (let i = 0; i < outputLength; i++) {
      const index = i * this.ratio
      const left = Math.floor(index)
      const right = Math.min(left + 1, combined.length - 1)
      const frac = index - left
      const leftSample = combined[left]
      const rightSample = combined[right]
      output[i] = leftSample + (rightSample - leftSample) * frac
    }

    const consumed = Math.floor(outputLength * this.ratio)
    const remaining = combined.length - consumed
    this.buffer = remaining > 0 ? combined.slice(consumed) : new Float32Array(0)
    return output
  }

  flush(): Float32Array {
    const remaining = this.buffer
    this.buffer = new Float32Array(0)
    return remaining
  }
}

class SampleBuffer {
  private chunks: { data: Float32Array; offset: number }[] = []
  private totalLength = 0

  push(data: Float32Array) {
    if (data.length === 0) return
    this.chunks.push({ data, offset: 0 })
    this.totalLength += data.length
  }

  prepend(data: Float32Array) {
    if (data.length === 0) return
    this.chunks.unshift({ data, offset: 0 })
    this.totalLength += data.length
  }

  consume(count: number): Float32Array {
    if (count > this.totalLength) {
      throw new Error("Insufficient samples")
    }
    const result = new Float32Array(count)
    let copied = 0
    while (copied < count && this.chunks.length > 0) {
      const chunk = this.chunks[0]
      const available = chunk.data.length - chunk.offset
      const toCopy = Math.min(available, count - copied)
      if (toCopy > 0) {
        result.set(chunk.data.subarray(chunk.offset, chunk.offset + toCopy), copied)
        chunk.offset += toCopy
        copied += toCopy
        if (chunk.offset >= chunk.data.length) {
          this.chunks.shift()
        }
      } else {
        this.chunks.shift()
      }
    }
    this.totalLength -= count
    return result
  }

  drain(): Float32Array {
    if (this.totalLength === 0) {
      return new Float32Array(0)
    }
    const result = new Float32Array(this.totalLength)
    let offset = 0
    for (const chunk of this.chunks) {
      const slice = chunk.data.subarray(chunk.offset)
      result.set(slice, offset)
      offset += slice.length
    }
    this.chunks = []
    this.totalLength = 0
    return result
  }

  clear() {
    this.chunks = []
    this.totalLength = 0
  }

  get length() {
    return this.totalLength
  }
}

export interface RecordedSegment {
  blob: Blob
  seqNo: number
  startMs: number
  endMs: number
  durationMs: number
  overlapMs: number
}

interface UseAudioRecorderOptions {
  onSegmentReady?: (segment: RecordedSegment) => void
  segmentDurationMs?: number
  overlapMs?: number
}

interface UseAudioRecorderReturn {
  isRecording: boolean
  isPaused: boolean
  duration: number
  startRecording: () => Promise<void>
  stopRecording: () => Promise<Blob | null>
  pauseRecording: () => void
  resumeRecording: () => void
  error: string | null
  errorCode: "capture_error" | "processing_error" | null
}

function createWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2
  const blockAlign = bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
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
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeString(36, "data")
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return new Blob([buffer], { type: "audio/wav" })
}

export function useAudioRecorder(options: UseAudioRecorderOptions = {}): UseAudioRecorderReturn {
  const { onSegmentReady, segmentDurationMs = DEFAULT_SEGMENT_MS, overlapMs = DEFAULT_OVERLAP_MS } = options
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<"capture_error" | "processing_error" | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null)
  const resamplerRef = useRef<StreamingResampler | null>(null)
  const bufferRef = useRef(new SampleBuffer())
  const allSamplesRef = useRef<Float32Array[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const seqRef = useRef(0)
  const pausedRef = useRef(false)
  const isRecordingRef = useRef(false)
  const segmentAdvanceSamples = Math.round((segmentDurationMs / 1000) * TARGET_SAMPLE_RATE) - Math.round((overlapMs / 1000) * TARGET_SAMPLE_RATE)
  const segmentSamples = Math.round((segmentDurationMs / 1000) * TARGET_SAMPLE_RATE)
  const overlapSamples = Math.round((overlapMs / 1000) * TARGET_SAMPLE_RATE)
  const onSegmentRef = useRef(onSegmentReady)

  useEffect(() => {
    onSegmentRef.current = onSegmentReady
  }, [onSegmentReady])

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      setDuration((prev) => prev + 1)
    }, 1000)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const cleanupAudio = useCallback(async () => {
    processorRef.current?.disconnect()
    processorRef.current = null

    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => undefined)
    }
    audioContextRef.current = null

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    resamplerRef.current = null
  }, [])

  const emitSegment = useCallback(
    (samples: Float32Array) => {
      if (!onSegmentRef.current) return
      const seqNo = seqRef.current
      const startSamples = seqNo * segmentAdvanceSamples
      const startMs = Math.round((startSamples / TARGET_SAMPLE_RATE) * 1000)
      const endMs = startMs + segmentDurationMs
      const blob = createWavBlob(samples, TARGET_SAMPLE_RATE)
      onSegmentRef.current({
        blob,
        seqNo,
        startMs,
        endMs,
        durationMs: segmentDurationMs,
        overlapMs,
      })
      seqRef.current += 1
    },
    [overlapMs, segmentAdvanceSamples, segmentDurationMs],
  )

  const processSegments = useCallback(() => {
    const buffer = bufferRef.current
    while (buffer.length >= segmentSamples) {
      const samples = buffer.consume(segmentSamples)
      if (overlapSamples > 0) {
        const overlapCopy = samples.slice(segmentSamples - overlapSamples)
        buffer.prepend(overlapCopy)
      }
      emitSegment(samples)
    }
  }, [emitSegment, overlapSamples, segmentSamples])

  const handleSamples = useCallback(
    (chunk: Float32Array) => {
      if (pausedRef.current || !isRecordingRef.current) {
        return
      }
      const resampler = resamplerRef.current
      if (!resampler) return
      const resampled = resampler.process(chunk)
      if (resampled.length === 0) return
      allSamplesRef.current.push(resampled)
      bufferRef.current.push(resampled)
      processSegments()
    },
    [processSegments],
  )

  const setupProcessor = useCallback(async (audioContext: AudioContext, source: MediaStreamAudioSourceNode) => {
    try {
      await audioContext.audioWorklet.addModule("/worklets/pcm-processor.js")
      const node = new AudioWorkletNode(audioContext, "pcm-processor")
      node.port.onmessage = (event: MessageEvent<Float32Array>) => handleSamples(event.data)
      const gain = audioContext.createGain()
      gain.gain.value = 0
      source.connect(node)
      node.connect(gain)
      gain.connect(audioContext.destination)
      processorRef.current = node
    } catch (error) {
      console.warn("AudioWorklet unavailable, falling back to ScriptProcessor", error)
      const scriptNode = audioContext.createScriptProcessor(4096, 1, 1)
      scriptNode.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        const copy = new Float32Array(input.length)
        copy.set(input)
        handleSamples(copy)
      }
      source.connect(scriptNode)
      scriptNode.connect(audioContext.destination)
      processorRef.current = scriptNode
    }
  }, [handleSamples])

  const startRecording = useCallback(async () => {
    try {
      setError(null)
      setErrorCode(null)
      setDuration(0)
      bufferRef.current.clear()
      allSamplesRef.current = []
      seqRef.current = 0

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      })

      streamRef.current = stream
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      resamplerRef.current = new StreamingResampler(audioContext.sampleRate, TARGET_SAMPLE_RATE)

      const source = audioContext.createMediaStreamSource(stream)
      await setupProcessor(audioContext, source)

      setIsRecording(true)
      isRecordingRef.current = true
      pausedRef.current = false
      setIsPaused(false)
      startTimer()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start capture"
      setError(message)
      setErrorCode("capture_error")
      await cleanupAudio()
      throw err
    }
  }, [cleanupAudio, setupProcessor, startTimer])

  const finalizeRecording = useCallback(async (): Promise<Blob | null> => {
    try {
      const remaining = bufferRef.current.drain()
      const minSamples = Math.round((MIN_FINAL_SEGMENT_MS / 1000) * TARGET_SAMPLE_RATE)
      if (remaining.length >= minSamples) {
        const padded = new Float32Array(segmentSamples)
        padded.set(remaining.subarray(0, Math.min(segmentSamples, remaining.length)))
        emitSegment(padded)
      }

      const allChunks = allSamplesRef.current
      const totalSamples = allChunks.reduce((sum, chunk) => sum + chunk.length, 0)
      if (totalSamples === 0) {
        return null
      }
      const merged = new Float32Array(totalSamples)
      let offset = 0
      for (const chunk of allChunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      return createWavBlob(merged, TARGET_SAMPLE_RATE)
    } catch (err) {
      console.error("Failed to finalize recording", err)
      setError("Failed to finalize recording")
      setErrorCode("processing_error")
      return null
    } finally {
      await cleanupAudio()
    }
  }, [cleanupAudio, emitSegment, segmentSamples])

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    if (!isRecordingRef.current) {
      return null
    }
    isRecordingRef.current = false
    setIsRecording(false)
    setIsPaused(false)
    pausedRef.current = false
    stopTimer()
    return finalizeRecording()
  }, [finalizeRecording, stopTimer])

  const pauseRecording = useCallback(() => {
    if (!isRecordingRef.current || pausedRef.current) {
      return
    }
    pausedRef.current = true
    setIsPaused(true)
    stopTimer()
    audioContextRef.current?.suspend().catch(() => undefined)
  }, [stopTimer])

  const resumeRecording = useCallback(() => {
    if (!isRecordingRef.current || !pausedRef.current) {
      return
    }
    pausedRef.current = false
    setIsPaused(false)
    startTimer()
    audioContextRef.current?.resume().catch(() => undefined)
  }, [startTimer])

  useEffect(() => {
    return () => {
      void cleanupAudio()
      stopTimer()
    }
  }, [cleanupAudio, stopTimer])

  return {
    isRecording,
    isPaused,
    duration,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    error,
    errorCode,
  }
}
