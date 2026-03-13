import type { PipelineError } from "@pipeline-errors"
import { transcriptionSessionStore, type TranscriptionEvent } from "@transcript-assembly"
import { toPipelineError } from "@pipeline-errors"
import { getRedisClient, ensureRedisConnection } from "./redis"
import { isHipaaHostedMode } from "./hipaa-config"

type TranscriptionStatus = "recording" | "finalizing" | "completed" | "error"

type SegmentInput = {
  seqNo: number
  startMs: number
  endMs: number
  durationMs: number
  overlapMs: number
  transcript: string
}

type SessionSnapshot = {
  status: TranscriptionStatus
  stitchedText: string
  finalTranscript: string | null
}

const SESSION_TTL_SECONDS = 60 * 60

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/^[^A-Za-z0-9]+/g, "")
    .replace(/[^A-Za-z0-9]+$/g, "")
}

function trimOverlapText(previousText: string, nextText: string): string {
  if (!previousText) return nextText

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

function keys(sessionId: string) {
  return {
    meta: `openscribe:tx:${sessionId}:meta`,
    segments: `openscribe:tx:${sessionId}:segments`,
    channel: `openscribe:tx:${sessionId}:events`,
  }
}

async function ensureOwner(sessionId: string, userId?: string): Promise<void> {
  if (!isHipaaHostedMode()) return
  if (!userId) throw new Error("Missing user owner")

  const redis = getRedisClient()
  await ensureRedisConnection(redis)
  const { meta } = keys(sessionId)

  const currentOwner = await redis.hget(meta, "ownerUserId")
  if (!currentOwner) {
    const tx = redis.multi()
    tx.hsetnx(meta, "ownerUserId", userId)
    tx.hsetnx(meta, "status", "recording")
    tx.hsetnx(meta, "stitchedText", "")
    tx.expire(meta, SESSION_TTL_SECONDS)
    await tx.exec()
    return
  }
  if (currentOwner !== userId) {
    throw new Error("Unauthorized session access")
  }
  await redis.expire(meta, SESSION_TTL_SECONDS)
}

async function getSnapshot(sessionId: string): Promise<SessionSnapshot> {
  const redis = getRedisClient()
  await ensureRedisConnection(redis)
  const { meta } = keys(sessionId)
  const data = await redis.hgetall(meta)
  return {
    status: ((data.status as TranscriptionStatus) || "recording") as TranscriptionStatus,
    stitchedText: data.stitchedText || "",
    finalTranscript: data.finalTranscript || null,
  }
}

async function publishEvent(sessionId: string, event: TranscriptionEvent): Promise<void> {
  const redis = getRedisClient()
  await ensureRedisConnection(redis)
  const { channel } = keys(sessionId)
  await redis.publish(channel, JSON.stringify(event))
}

async function addSegmentDistributed(sessionId: string, segment: SegmentInput, userId?: string): Promise<void> {
  await ensureOwner(sessionId, userId)
  const redis = getRedisClient()
  await ensureRedisConnection(redis)
  const { meta, segments } = keys(sessionId)

  await redis.hset(segments, String(segment.seqNo), JSON.stringify(segment))

  const rawSegments = await redis.hgetall(segments)
  const ordered = Object.values(rawSegments)
    .map((raw) => JSON.parse(raw) as SegmentInput)
    .sort((a, b) => a.seqNo - b.seqNo)

  let stitched = ""
  for (const seg of ordered) {
    const text = trimOverlapText(stitched, seg.transcript)
    stitched = stitched ? `${stitched} ${text}` : text
  }
  stitched = stitched.trim()

  const tx = redis.multi()
  tx.hset(meta, "status", "recording", "stitchedText", stitched)
  tx.expire(meta, SESSION_TTL_SECONDS)
  tx.expire(segments, SESSION_TTL_SECONDS)
  await tx.exec()

  await publishEvent(sessionId, {
    event: "segment",
    data: {
      session_id: sessionId,
      seq_no: segment.seqNo,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      duration_ms: segment.durationMs,
      overlap_ms: segment.overlapMs,
      transcript: segment.transcript,
      stitched_text: stitched,
    },
  })
}

async function setStatusDistributed(sessionId: string, status: TranscriptionStatus, userId?: string): Promise<void> {
  await ensureOwner(sessionId, userId)
  const redis = getRedisClient()
  await ensureRedisConnection(redis)
  const { meta } = keys(sessionId)

  await redis.hset(meta, "status", status)
  await redis.expire(meta, SESSION_TTL_SECONDS)
  const snapshot = await getSnapshot(sessionId)

  await publishEvent(sessionId, {
    event: "status",
    data: {
      session_id: sessionId,
      status,
      stitched_text: snapshot.stitchedText,
      final_transcript: snapshot.finalTranscript,
    },
  })
}

async function setFinalTranscriptDistributed(sessionId: string, transcript: string, userId?: string): Promise<void> {
  await ensureOwner(sessionId, userId)
  const redis = getRedisClient()
  await ensureRedisConnection(redis)
  const { meta, segments } = keys(sessionId)

  const tx = redis.multi()
  tx.hset(meta, "status", "completed", "finalTranscript", transcript)
  tx.expire(meta, SESSION_TTL_SECONDS)
  tx.expire(segments, SESSION_TTL_SECONDS)
  await tx.exec()

  await publishEvent(sessionId, {
    event: "final",
    data: {
      session_id: sessionId,
      final_transcript: transcript,
    },
  })
}

async function emitErrorDistributed(sessionId: string, error: PipelineError | Error | unknown, userId?: string): Promise<void> {
  await ensureOwner(sessionId, userId)
  const redis = getRedisClient()
  await ensureRedisConnection(redis)
  const { meta } = keys(sessionId)

  const normalizedError = toPipelineError(error, {
    code: "assembly_error",
    message: "Failed to assemble transcript",
    recoverable: true,
  })

  await redis.hset(meta, "status", "error")
  await redis.expire(meta, SESSION_TTL_SECONDS)

  await publishEvent(sessionId, {
    event: "error",
    data: {
      session_id: sessionId,
      code: normalizedError.code,
      message: normalizedError.message,
      recoverable: normalizedError.recoverable,
      details: normalizedError.details,
    },
  })
}

async function subscribeDistributed(
  sessionId: string,
  userId: string | undefined,
  listener: (event: TranscriptionEvent) => void,
): Promise<() => void> {
  await ensureOwner(sessionId, userId)
  const snapshot = await getSnapshot(sessionId)

  listener({
    event: "status",
    data: {
      session_id: sessionId,
      status: snapshot.status,
      stitched_text: snapshot.stitchedText,
      final_transcript: snapshot.finalTranscript,
    },
  })

  const redis = getRedisClient()
  await ensureRedisConnection(redis)
  const subscriber = redis.duplicate()
  await ensureRedisConnection(subscriber)
  const { channel } = keys(sessionId)

  await subscriber.subscribe(channel)
  subscriber.on("message", (_channel, payload) => {
    try {
      listener(JSON.parse(payload) as TranscriptionEvent)
    } catch {
      // ignore malformed events
    }
  })

  return () => {
    void subscriber.unsubscribe(channel)
    void subscriber.quit()
  }
}

export async function addTranscriptionSegment(sessionId: string, segment: SegmentInput, userId?: string): Promise<void> {
  if (!isHipaaHostedMode()) {
    transcriptionSessionStore.addSegment(sessionId, segment, userId)
    return
  }
  await addSegmentDistributed(sessionId, segment, userId)
}

export async function setTranscriptionStatus(sessionId: string, status: TranscriptionStatus, userId?: string): Promise<void> {
  if (!isHipaaHostedMode()) {
    transcriptionSessionStore.setStatus(sessionId, status, userId)
    return
  }
  await setStatusDistributed(sessionId, status, userId)
}

export async function setTranscriptionFinal(sessionId: string, transcript: string, userId?: string): Promise<void> {
  if (!isHipaaHostedMode()) {
    transcriptionSessionStore.setFinalTranscript(sessionId, transcript, userId)
    return
  }
  await setFinalTranscriptDistributed(sessionId, transcript, userId)
}

export async function emitTranscriptionError(sessionId: string, error: PipelineError | Error | unknown, userId?: string): Promise<void> {
  if (!isHipaaHostedMode()) {
    transcriptionSessionStore.emitError(sessionId, error, userId)
    return
  }
  await emitErrorDistributed(sessionId, error, userId)
}

export async function subscribeTranscriptionEvents(
  sessionId: string,
  userId: string | undefined,
  listener: (event: TranscriptionEvent) => void,
): Promise<() => void> {
  if (!isHipaaHostedMode()) {
    return transcriptionSessionStore.subscribe(sessionId, listener, userId)
  }
  return subscribeDistributed(sessionId, userId, listener)
}
