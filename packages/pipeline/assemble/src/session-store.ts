type TranscriptionStatus = "recording" | "finalizing" | "completed" | "error"

export interface SegmentMetadata {
  seqNo: number
  startMs: number
  endMs: number
  durationMs: number
  overlapMs: number
  transcript: string
}

export interface TranscriptionEvent {
  event: "segment" | "final" | "error" | "status"
  data: Record<string, unknown>
}

interface SessionRecord {
  id: string
  segments: Map<number, SegmentMetadata>
  stitchedText: string
  status: TranscriptionStatus
  finalTranscript?: string
  listeners: Set<(event: TranscriptionEvent) => void>
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/^[^A-Za-z0-9]+/g, "")
    .replace(/[^A-Za-z0-9]+$/g, "")
}

function trimOverlapText(previousText: string, nextText: string): string {
  if (!previousText) {
    return nextText
  }

  const previousTokens = previousText.split(/\s+/).filter(Boolean)
  const nextTokens = nextText.split(/\s+/).filter(Boolean)

  const maxComparable = Math.min(20, previousTokens.length, nextTokens.length)

  for (let overlap = maxComparable; overlap > 0; overlap--) {
    const prevSlice = previousTokens.slice(-overlap).map(normalizeToken)
    const nextSlice = nextTokens.slice(0, overlap).map(normalizeToken)
    const matches = prevSlice.every((token, idx) => token && token === nextSlice[idx])
    if (matches) {
      return nextTokens.slice(overlap).join(" ")
    }
  }

  return nextText
}

class TranscriptionSessionStore {
  private sessions: Map<string, SessionRecord> = new Map()
  private cleanupInterval: NodeJS.Timeout | null = null
  private readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
  private sessionTimestamps: Map<string, number> = new Map()

  constructor() {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanupOldSessions(), 5 * 60 * 1000)
  }

  private cleanupOldSessions() {
    const now = Date.now()
    const sessionsToDelete: string[] = []

    for (const [sessionId, timestamp] of this.sessionTimestamps.entries()) {
      const session = this.sessions.get(sessionId)
      
      // Clean up if:
      // 1. Session is older than timeout
      // 2. Session is completed or error
      // 3. No active listeners
      if (
        now - timestamp > this.SESSION_TIMEOUT_MS &&
        session &&
        (session.status === 'completed' || session.status === 'error') &&
        session.listeners.size === 0
      ) {
        sessionsToDelete.push(sessionId)
      }
    }

    for (const sessionId of sessionsToDelete) {
      console.log(`[SessionStore] Cleaning up old session: ${sessionId}`)
      this.sessions.delete(sessionId)
      this.sessionTimestamps.delete(sessionId)
    }

    if (sessionsToDelete.length > 0) {
      console.log(`[SessionStore] Cleaned up ${sessionsToDelete.length} sessions. Active sessions: ${this.sessions.size}`)
    }
  }

  getSession(sessionId: string): SessionRecord {
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = {
        id: sessionId,
        segments: new Map(),
        stitchedText: "",
        status: "recording",
        listeners: new Set(),
      }
      this.sessions.set(sessionId, session)
      this.sessionTimestamps.set(sessionId, Date.now())
      console.log(`[SessionStore] Created new session: ${sessionId}. Total sessions: ${this.sessions.size}`)
    }
    return session
  }

  subscribe(sessionId: string, listener: (event: TranscriptionEvent) => void): () => void {
    const session = this.getSession(sessionId)
    session.listeners.add(listener)
    console.log(`[SessionStore] Subscriber added to session ${sessionId}. Total listeners: ${session.listeners.size}`)

    // Emit the current status immediately
    listener({
      event: "status",
      data: {
        session_id: sessionId,
        status: session.status,
        stitched_text: session.stitchedText,
        final_transcript: session.finalTranscript ?? null,
      },
    })

    return () => {
      session.listeners.delete(listener)
      console.log(`[SessionStore] Subscriber removed from session ${sessionId}. Remaining listeners: ${session.listeners.size}`)
    }
  }

  private emit(session: SessionRecord, event: TranscriptionEvent) {
    session.listeners.forEach((listener) => {
      try {
        listener(event)
      } catch (error) {
        console.error("Failed to notify SSE listener", error)
      }
    })
  }

  addSegment(sessionId: string, segment: Omit<SegmentMetadata, "transcript"> & { transcript: string }) {
    const session = this.getSession(sessionId)
    session.segments.set(segment.seqNo, segment)

    const orderedSegments = Array.from(session.segments.values()).sort((a, b) => a.seqNo - b.seqNo)
    let stitched = ""
    for (const seg of orderedSegments) {
      const text = trimOverlapText(stitched, seg.transcript)
      stitched = stitched ? `${stitched} ${text}` : text
    }
    session.stitchedText = stitched.trim()

    this.emit(session, {
      event: "segment",
      data: {
        session_id: sessionId,
        seq_no: segment.seqNo,
        start_ms: segment.startMs,
        end_ms: segment.endMs,
        duration_ms: segment.durationMs,
        overlap_ms: segment.overlapMs,
        transcript: segment.transcript,
        stitched_text: session.stitchedText,
      },
    })
  }

  setStatus(sessionId: string, status: TranscriptionStatus) {
    const session = this.getSession(sessionId)
    session.status = status
    this.emit(session, {
      event: "status",
      data: {
        session_id: sessionId,
        status,
        stitched_text: session.stitchedText,
        final_transcript: session.finalTranscript ?? null,
      },
    })
  }

  setFinalTranscript(sessionId: string, transcript: string) {
    const session = this.getSession(sessionId)
    session.finalTranscript = transcript
    session.status = "completed"
    this.sessionTimestamps.set(sessionId, Date.now()) // Update timestamp on completion
    console.log(`[SessionStore] Session ${sessionId} completed with ${transcript.length} chars`)
    this.emit(session, {
      event: "final",
      data: {
        session_id: sessionId,
        final_transcript: transcript,
      },
    })
  }

  emitError(sessionId: string, code: string, message: string) {
    const session = this.getSession(sessionId)
    session.status = "error"
    this.emit(session, {
      event: "error",
      data: {
        session_id: sessionId,
        code,
        message,
      },
    })
  }
}

declare global {
  var _transcriptionSessionStore: TranscriptionSessionStore | undefined
}

const globalStore = globalThis as typeof globalThis & {
  _transcriptionSessionStore?: TranscriptionSessionStore
}

if (!globalStore._transcriptionSessionStore) {
  globalStore._transcriptionSessionStore = new TranscriptionSessionStore()
}

export const transcriptionSessionStore = globalStore._transcriptionSessionStore
