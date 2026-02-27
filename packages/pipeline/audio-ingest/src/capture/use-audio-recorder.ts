"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { PipelineStageError, type PipelineError } from "../../../shared/src/error"
import { requestSystemAudioStream } from "../devices/system-audio"
import { toAudioIngestError } from "../errors"
import {
  DEFAULT_OVERLAP_MS,
  DEFAULT_SEGMENT_MS,
  MIN_FINAL_SEGMENT_MS,
  SampleBuffer,
  StreamingResampler,
  TARGET_SAMPLE_RATE,
  createFinalSegmentFromRemaining,
  createWavBlob,
  drainSegments,
} from "./audio-processing"

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
  error: PipelineError | null
  errorCode: string | null
}

export function useAudioRecorder(options: UseAudioRecorderOptions = {}): UseAudioRecorderReturn {
  const { onSegmentReady, segmentDurationMs = DEFAULT_SEGMENT_MS, overlapMs = DEFAULT_OVERLAP_MS } = options
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<PipelineError | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const micStreamRef = useRef<MediaStream | null>(null)
  const systemStreamRef = useRef<MediaStream | null>(null)
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

    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current = null
    systemStreamRef.current?.getTracks().forEach((track) => track.stop())
    systemStreamRef.current = null
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
    drainSegments(bufferRef.current, segmentSamples, overlapSamples, emitSegment)
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

  const setupProcessor = useCallback(async (audioContext: AudioContext, sourceNode: AudioNode) => {
    try {
      await audioContext.audioWorklet.addModule("/worklets/pcm-processor.js")
      const node = new AudioWorkletNode(audioContext, "pcm-processor")
      node.port.onmessage = (event: MessageEvent<Float32Array>) => handleSamples(event.data)
      const gain = audioContext.createGain()
      gain.gain.value = 0
      sourceNode.connect(node)
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
      sourceNode.connect(scriptNode)
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

      const microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      })

      micStreamRef.current = microphoneStream

      const systemCapture = await requestSystemAudioStream()
      const systemStream =
        systemCapture && systemCapture.stream.getAudioTracks().length > 0 ? systemCapture.stream : null
      systemStreamRef.current = systemStream

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      resamplerRef.current = new StreamingResampler(audioContext.sampleRate, TARGET_SAMPLE_RATE)

      const mixNode = audioContext.createGain()
      mixNode.gain.value = 1

      const micSource = audioContext.createMediaStreamSource(microphoneStream)
      micSource.connect(mixNode)

      if (systemStream) {
        try {
          const systemSource = audioContext.createMediaStreamSource(systemStream)
          systemSource.connect(mixNode)
          systemStream.getVideoTracks().forEach((track) => track.stop())
        } catch (error) {
          console.warn("Failed to add system audio source", error)
        }
      } else if (typeof window !== "undefined" && window.desktop) {
        console.warn("System audio capture unavailable; falling back to microphone only")
      }

      await setupProcessor(audioContext, mixNode)

      setIsRecording(true)
      isRecordingRef.current = true
      pausedRef.current = false
      setIsPaused(false)
      startTimer()
    } catch (err) {
      const pipelineError = toAudioIngestError(err, "capture_error")
      setError(pipelineError)
      setErrorCode(pipelineError.code)
      await cleanupAudio()
      throw new PipelineStageError(
        pipelineError.code,
        pipelineError.message,
        pipelineError.recoverable,
        pipelineError.details,
      )
    }
  }, [cleanupAudio, setupProcessor, startTimer])

  const finalizeRecording = useCallback(async (): Promise<Blob | null> => {
    try {
      const remaining = bufferRef.current.drain()
      const minSamples = Math.round((MIN_FINAL_SEGMENT_MS / 1000) * TARGET_SAMPLE_RATE)
      const finalSegment = createFinalSegmentFromRemaining(remaining, minSamples, segmentSamples)
      if (finalSegment) {
        emitSegment(finalSegment)
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
      const pipelineError = toAudioIngestError(err, "processing_error")
      setError(pipelineError)
      setErrorCode(pipelineError.code)
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
