"use client"

import { useCallback, useEffect, useRef } from "react"

export interface PendingSegment {
  seqNo: number
  startMs: number
  endMs: number
  durationMs: number
  overlapMs: number
  blob: Blob
}

export interface UploadError {
  code: "capture_error" | "validation_error" | "api_error" | "storage_error" | "network_error"
  message: string
}

interface UseSegmentUploadOptions {
  onError?: (error: UploadError) => void
}

const MAX_IN_FLIGHT = 2
const MAX_RETRIES = 3

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function useSegmentUpload(sessionId: string | null, options?: UseSegmentUploadOptions) {
  const queueRef = useRef<PendingSegment[]>([])
  const inFlightRef = useRef(0)
  const sessionIdRef = useRef<string | null>(sessionId)
  const abortedRef = useRef(false)

  useEffect(() => {
    sessionIdRef.current = sessionId
    queueRef.current = []
    inFlightRef.current = 0
  }, [sessionId])

  useEffect(() => {
    abortedRef.current = false
    return () => {
      abortedRef.current = true
    }
  }, [])

  const uploadSegment = useCallback(async (session: string, segment: PendingSegment, attempt = 1): Promise<void> => {
    const formData = new FormData()
    formData.append("session_id", session)
    formData.append("seq_no", segment.seqNo.toString())
    formData.append("start_ms", segment.startMs.toString())
    formData.append("end_ms", segment.endMs.toString())
    formData.append("duration_ms", segment.durationMs.toString())
    formData.append("overlap_ms", segment.overlapMs.toString())
    formData.append("file", segment.blob, `segment-${segment.seqNo}.wav`)

    try {
      const response = await fetch("/api/transcription/segment", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        let errorBody: { error?: UploadError } | null = null
        try {
          errorBody = (await response.json()) as { error?: UploadError }
        } catch {
          // ignore json parse errors
        }

        const errorCode = errorBody?.error?.code || (response.status >= 500 ? "api_error" : "validation_error")
        const message = errorBody?.error?.message || `Upload failed with status ${response.status}`
        const shouldRetry = (response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES

        if (shouldRetry) {
          await wait(250 * attempt)
          return uploadSegment(session, segment, attempt + 1)
        }

        const error = new Error(message) as UploadError & Error
        error.code = errorCode as UploadError["code"]
        throw error
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return
      }
      if (error instanceof Error && !(error as UploadError).code && attempt < MAX_RETRIES) {
        await wait(250 * attempt)
        return uploadSegment(session, segment, attempt + 1)
      }
      throw error
    }
  }, [])

  const drainQueue = useCallback(() => {
    if (abortedRef.current) return
    if (!sessionIdRef.current) return

    while (inFlightRef.current < MAX_IN_FLIGHT && queueRef.current.length > 0) {
      const segment = queueRef.current.shift()
      if (!segment) break
      inFlightRef.current += 1

      void (async () => {
        try {
          await uploadSegment(sessionIdRef.current!, segment)
        } catch (error) {
          const uploadError: UploadError =
            error instanceof Error && "code" in error
              ? { code: (error as UploadError).code, message: error.message }
              : { code: "network_error", message: error instanceof Error ? error.message : "Upload failed" }

          options?.onError?.(uploadError)
        } finally {
          inFlightRef.current = Math.max(0, inFlightRef.current - 1)
          if (!abortedRef.current) {
            drainQueue()
          }
        }
      })()
    }
  }, [options, uploadSegment])

  const enqueueSegment = useCallback(
    (segment: PendingSegment) => {
      if (!sessionIdRef.current) {
        const error = { code: "capture_error", message: "Session not initialized" } satisfies UploadError
        options?.onError?.(error)
        return
      }
      queueRef.current.push(segment)
      drainQueue()
    },
    [drainQueue, options],
  )

  const reset = useCallback(() => {
    queueRef.current = []
    inFlightRef.current = 0
  }, [])

  return {
    enqueueSegment,
    resetQueue: reset,
  }
}
