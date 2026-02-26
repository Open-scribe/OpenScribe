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

export interface SegmentUploadControllerOptions {
  onError?: (error: UploadError) => void
  apiBaseUrl?: string
}

export interface SegmentUploadControllerDeps {
  fetchFn?: typeof fetch
  waitFn?: (ms: number) => Promise<void>
}

const MAX_IN_FLIGHT = 2
const MAX_RETRIES = 3

class UploadException extends Error implements UploadError {
  code: UploadError["code"]

  constructor(code: UploadError["code"], message: string) {
    super(message)
    this.name = "UploadException"
    this.code = code
  }
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class SegmentUploadController {
  private queue: PendingSegment[] = []
  private inFlight = 0
  private sessionId: string | null
  private aborted = false
  private readonly fetchFn: typeof fetch
  private readonly waitFn: (ms: number) => Promise<void>
  private readonly options?: SegmentUploadControllerOptions
  private readonly apiBaseUrl?: string

  constructor(
    sessionId: string | null,
    options?: SegmentUploadControllerOptions,
    deps?: SegmentUploadControllerDeps,
  ) {
    this.sessionId = sessionId
    this.options = options
    this.apiBaseUrl = options?.apiBaseUrl
    this.fetchFn = deps?.fetchFn ?? globalThis.fetch.bind(globalThis)
    if (!this.fetchFn) {
      throw new Error("fetch API is required for SegmentUploadController")
    }
    this.waitFn = deps?.waitFn ?? defaultWait
  }

  setSessionId(sessionId: string | null) {
    this.sessionId = sessionId
    this.resetQueue()
  }

  enqueueSegment(segment: PendingSegment) {
    if (!this.sessionId) {
      console.warn('[SegmentUpload] Segment', segment.seqNo, 'dropped - session not initialized yet')
      this.notifyError({ code: "capture_error", message: "Session not initialized" })
      return
    }
    this.queue.push(segment)
    this.drainQueue()
  }

  resetQueue() {
    this.queue = []
    this.inFlight = 0
  }

  dispose() {
    this.aborted = true
    this.queue = []
  }

  private notifyError(error: UploadError) {
    this.options?.onError?.(error)
  }

  private drainQueue() {
    if (this.aborted) return
    if (!this.sessionId) return

    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length > 0) {
      const segment = this.queue.shift()
      if (!segment) {
        break
      }
      this.inFlight += 1
      void this.uploadSegmentWithHandling(this.sessionId, segment)
    }
  }

  private async uploadSegmentWithHandling(sessionId: string, segment: PendingSegment) {
    try {
      await this.uploadSegment(sessionId, segment)
    } catch (error) {
      // Only report actual failures, not internal retry logic
      if (error) {
        const uploadError: UploadError =
          error instanceof UploadException
            ? { code: error.code, message: error.message }
            : { 
                code: "network_error", 
                message: error instanceof Error ? error.message : String(error) || "Upload failed" 
              }
        console.error('[SegmentUpload] Final upload failure for segment', segment.seqNo, ':', uploadError.code, uploadError.message)
        this.notifyError(uploadError)
      }
    } finally {
      this.inFlight = Math.max(0, this.inFlight - 1)
      if (!this.aborted) {
        this.drainQueue()
      }
    }
  }

  private async uploadSegment(session: string, segment: PendingSegment, attempt = 1): Promise<void> {
    const formData = new FormData()
    formData.append("session_id", session)
    formData.append("seq_no", segment.seqNo.toString())
    formData.append("start_ms", segment.startMs.toString())
    formData.append("end_ms", segment.endMs.toString())
    formData.append("duration_ms", segment.durationMs.toString())
    formData.append("overlap_ms", segment.overlapMs.toString())
    formData.append("file", segment.blob, `segment-${segment.seqNo}.wav`)

    try {
      const url = this.apiBaseUrl
        ? `${this.apiBaseUrl.replace(/\/+$/, "")}/api/transcription/segment`
        : "/api/transcription/segment"
      const response = await this.fetchFn(url, {
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
          await this.waitFn(250 * attempt)
          return this.uploadSegment(session, segment, attempt + 1)
        }

        throw new UploadException(errorCode as UploadError["code"], message)
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return
      }
      if (error instanceof Error && !(error instanceof UploadException) && attempt < MAX_RETRIES) {
        await this.waitFn(250 * attempt)
        return this.uploadSegment(session, segment, attempt + 1)
      }
      throw error
    }
  }
}
