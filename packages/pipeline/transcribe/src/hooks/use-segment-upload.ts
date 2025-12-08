"use client"

import { useCallback, useEffect, useRef } from "react"
import {
  type PendingSegment,
  SegmentUploadController,
  type SegmentUploadControllerOptions,
} from "./segment-upload-controller"

type UseSegmentUploadOptions = SegmentUploadControllerOptions

export function useSegmentUpload(sessionId: string | null, options?: UseSegmentUploadOptions) {
  const controllerRef = useRef<SegmentUploadController | null>(null)
  const onErrorRef = useRef(options?.onError)

  useEffect(() => {
    onErrorRef.current = options?.onError
  }, [options?.onError])

  if (!controllerRef.current) {
    controllerRef.current = new SegmentUploadController(sessionId, {
      onError: (error) => onErrorRef.current?.(error),
    })
  }

  useEffect(() => {
    controllerRef.current?.setSessionId(sessionId)
  }, [sessionId])

  useEffect(() => {
    return () => {
      controllerRef.current?.dispose()
    }
  }, [])

  const enqueueSegment = useCallback((segment: PendingSegment) => {
    controllerRef.current?.enqueueSegment(segment)
  }, [])

  const reset = useCallback(() => {
    controllerRef.current?.resetQueue()
  }, [])

  return {
    enqueueSegment,
    resetQueue: reset,
  }
}

export type { PendingSegment, UploadError } from "./segment-upload-controller"
