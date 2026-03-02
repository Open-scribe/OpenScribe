import net from 'node:net'
import tls from 'node:tls'

type TranscriptionStatus = 'recording' | 'finalizing' | 'completed' | 'error'

export interface SegmentMetadata {
  seqNo: number
  startMs: number
  endMs: number
  durationMs: number
  overlapMs: number
  transcript: string
}

export interface TranscriptionEvent {
  event: 'segment' | 'final' | 'error' | 'status'
  data: Record<string, unknown>
}

export interface SessionStore {
  subscribe(sessionId: string, listener: (event: TranscriptionEvent) => void): () => void
  addSegment(sessionId: string, segment: Omit<SegmentMetadata, 'transcript'> & { transcript: string }): Promise<void>
  setStatus(sessionId: string, status: TranscriptionStatus): Promise<void>
  setFinalTranscript(sessionId: string, transcript: string): Promise<void>
  emitError(sessionId: string, code: string, message: string): Promise<void>
}

interface SessionRecord {
  id: string
  segments: Map<number, SegmentMetadata>
  stitchedText: string
  status: TranscriptionStatus
  finalTranscript?: string
  listeners: Set<(event: TranscriptionEvent) => void>
}

interface PersistedSession {
  id: string
  segments: SegmentMetadata[]
  stitchedText: string
  status: TranscriptionStatus
  finalTranscript?: string
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/^[^A-Za-z0-9]+/g, '')
    .replace(/[^A-Za-z0-9]+$/g, '')
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
      return nextTokens.slice(overlap).join(' ')
    }
  }

  return nextText
}

type RedisValue = string | number | null | RedisValue[]

interface RedisConfig {
  host: string
  port: number
  password?: string
  tls: boolean
}

function getRedisConfig(env: NodeJS.ProcessEnv = process.env): RedisConfig | null {
  if (String(env.SESSION_STORE_BACKEND || '').toLowerCase() !== 'redis') {
    return null
  }

  const host = env.REDIS_HOST
  if (!host) return null

  return {
    host,
    port: Number(env.REDIS_PORT || 6379),
    password: env.REDIS_PASSWORD,
    tls: String(env.REDIS_TLS || '').toLowerCase() === 'true',
  }
}

function encodeRespCommand(parts: string[]): string {
  const chunks = [`*${parts.length}\r\n`]
  for (const part of parts) {
    const bytes = Buffer.byteLength(part)
    chunks.push(`$${bytes}\r\n${part}\r\n`)
  }
  return chunks.join('')
}

function parseRespValue(buffer: Buffer, offset = 0): { value: RedisValue; nextOffset: number } | null {
  if (offset >= buffer.length) return null
  const prefix = String.fromCharCode(buffer[offset])
  const lineEnd = buffer.indexOf('\r\n', offset)
  if (lineEnd === -1) return null

  if (prefix === '+' || prefix === '-' || prefix === ':') {
    const data = buffer.toString('utf8', offset + 1, lineEnd)
    if (prefix === '+') return { value: data, nextOffset: lineEnd + 2 }
    if (prefix === '-') throw new Error(`Redis error: ${data}`)
    return { value: Number(data), nextOffset: lineEnd + 2 }
  }

  if (prefix === '$') {
    const len = Number(buffer.toString('utf8', offset + 1, lineEnd))
    if (len === -1) return { value: null, nextOffset: lineEnd + 2 }
    const start = lineEnd + 2
    const end = start + len
    if (buffer.length < end + 2) return null
    const value = buffer.toString('utf8', start, end)
    return { value, nextOffset: end + 2 }
  }

  if (prefix === '*') {
    const count = Number(buffer.toString('utf8', offset + 1, lineEnd))
    let next = lineEnd + 2
    const items: RedisValue[] = []
    for (let i = 0; i < count; i++) {
      const parsed = parseRespValue(buffer, next)
      if (!parsed) return null
      items.push(parsed.value)
      next = parsed.nextOffset
    }
    return { value: items, nextOffset: next }
  }

  throw new Error('Unsupported Redis RESP type')
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

class LightweightRedisClient {
  constructor(private readonly config: RedisConfig) {}

  private async execute(parts: string[]): Promise<RedisValue> {
    const payload = encodeRespCommand(parts)

    return await new Promise<RedisValue>((resolve, reject) => {
      const socket = this.config.tls
        ? tls.connect({ host: this.config.host, port: this.config.port })
        : net.createConnection({ host: this.config.host, port: this.config.port })

      const chunks: Uint8Array[] = []

      socket.on('error', (error) => {
        reject(error)
      })

      socket.on('data', (chunk) => {
        chunks.push(new Uint8Array(chunk))
        const combined = Buffer.from(concatUint8Arrays(chunks))
        try {
          const parsed = parseRespValue(combined)
          if (!parsed) return
          resolve(parsed.value)
          socket.end()
        } catch (error) {
          reject(error)
          socket.end()
        }
      })

      socket.on('connect', () => {
        if (this.config.password) {
          const authCommand = encodeRespCommand(['AUTH', this.config.password])
          socket.write(authCommand)
        }
        socket.write(payload)
      })
    })
  }

  async get(key: string): Promise<string | null> {
    const value = await this.execute(['GET', key])
    return typeof value === 'string' ? value : null
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    await this.execute(['SETEX', key, String(ttlSeconds), value])
  }

  async rpush(key: string, value: string): Promise<void> {
    await this.execute(['RPUSH', key, value])
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const value = await this.execute(['LRANGE', key, String(start), String(stop)])
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === 'string')
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.execute(['EXPIRE', key, String(ttlSeconds)])
  }
}

class TranscriptionSessionStore implements SessionStore {
  private sessions: Map<string, SessionRecord> = new Map()
  private readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000
  private readonly SESSION_TTL_SECONDS = 60 * 60
  private sessionTimestamps: Map<string, number> = new Map()
  private cleanupInterval: NodeJS.Timeout | null = null
  private redisClient: LightweightRedisClient | null = null

  constructor() {
    const redisConfig = getRedisConfig()
    if (redisConfig) {
      this.redisClient = new LightweightRedisClient(redisConfig)
    }

    if (!this.redisClient) {
      this.cleanupInterval = setInterval(() => this.cleanupOldSessions(), 5 * 60 * 1000)
    }
  }

  private sessionKey(sessionId: string): string {
    return `openscribe:session:${sessionId}`
  }

  private eventKey(sessionId: string): string {
    return `openscribe:session:${sessionId}:events`
  }

  private cleanupOldSessions() {
    const now = Date.now()
    const sessionsToDelete: string[] = []

    for (const [sessionId, timestamp] of this.sessionTimestamps.entries()) {
      const session = this.sessions.get(sessionId)
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
      this.sessions.delete(sessionId)
      this.sessionTimestamps.delete(sessionId)
    }
  }

  private getSession(sessionId: string): SessionRecord {
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = {
        id: sessionId,
        segments: new Map(),
        stitchedText: '',
        status: 'recording',
        listeners: new Set(),
      }
      this.sessions.set(sessionId, session)
      this.sessionTimestamps.set(sessionId, Date.now())
    }
    return session
  }

  private emit(session: SessionRecord, event: TranscriptionEvent) {
    session.listeners.forEach((listener) => {
      try {
        listener(event)
      } catch {
        // Ignore listener failures.
      }
    })
  }

  private toPersisted(session: SessionRecord): PersistedSession {
    return {
      id: session.id,
      segments: Array.from(session.segments.values()).sort((a, b) => a.seqNo - b.seqNo),
      stitchedText: session.stitchedText,
      status: session.status,
      finalTranscript: session.finalTranscript,
    }
  }

  private fromPersisted(data: PersistedSession): SessionRecord {
    return {
      id: data.id,
      segments: new Map(data.segments.map((segment) => [segment.seqNo, segment])),
      stitchedText: data.stitchedText,
      status: data.status,
      finalTranscript: data.finalTranscript,
      listeners: new Set(),
    }
  }

  private async saveRedisSession(session: SessionRecord): Promise<void> {
    if (!this.redisClient) return
    const payload = JSON.stringify(this.toPersisted(session))
    await this.redisClient.setEx(this.sessionKey(session.id), this.SESSION_TTL_SECONDS, payload)
  }

  private async loadRedisSession(sessionId: string): Promise<SessionRecord | null> {
    if (!this.redisClient) return null
    const payload = await this.redisClient.get(this.sessionKey(sessionId))
    if (!payload) return null
    const parsed = JSON.parse(payload) as PersistedSession
    return this.fromPersisted(parsed)
  }

  private async pushRedisEvent(sessionId: string, event: TranscriptionEvent): Promise<void> {
    if (!this.redisClient) return
    await this.redisClient.rpush(this.eventKey(sessionId), JSON.stringify(event))
    await this.redisClient.expire(this.eventKey(sessionId), this.SESSION_TTL_SECONDS)
  }

  subscribe(sessionId: string, listener: (event: TranscriptionEvent) => void): () => void {
    if (!this.redisClient) {
      const session = this.getSession(sessionId)
      session.listeners.add(listener)

      listener({
        event: 'status',
        data: {
          session_id: sessionId,
          status: session.status,
          stitched_text: session.stitchedText,
          final_transcript: session.finalTranscript ?? null,
        },
      })

      return () => {
        session.listeners.delete(listener)
      }
    }

    let closed = false
    let sentCount = 0

    const emitInitial = async () => {
      const session = await this.loadRedisSession(sessionId)
      listener({
        event: 'status',
        data: {
          session_id: sessionId,
          status: session?.status ?? 'recording',
          stitched_text: session?.stitchedText ?? '',
          final_transcript: session?.finalTranscript ?? null,
        },
      })

      const existingEvents = await this.redisClient!.lrange(this.eventKey(sessionId), 0, -1)
      sentCount = existingEvents.length
    }

    void emitInitial()

    const interval = setInterval(async () => {
      if (closed) return
      try {
        const events = await this.redisClient!.lrange(this.eventKey(sessionId), sentCount, -1)
        if (events.length === 0) return
        for (const payload of events) {
          const event = JSON.parse(payload) as TranscriptionEvent
          listener(event)
        }
        sentCount += events.length
      } catch {
        // Ignore transient polling errors.
      }
    }, 1000)

    return () => {
      closed = true
      clearInterval(interval)
    }
  }

  async addSegment(sessionId: string, segment: Omit<SegmentMetadata, 'transcript'> & { transcript: string }): Promise<void> {
    const existing = this.redisClient ? await this.loadRedisSession(sessionId) : null
    const session = existing || this.getSession(sessionId)

    session.segments.set(segment.seqNo, segment)
    const orderedSegments = Array.from(session.segments.values()).sort((a, b) => a.seqNo - b.seqNo)

    let stitched = ''
    for (const seg of orderedSegments) {
      const text = trimOverlapText(stitched, seg.transcript)
      stitched = stitched ? `${stitched} ${text}` : text
    }
    session.stitchedText = stitched.trim()

    const event: TranscriptionEvent = {
      event: 'segment',
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
    }

    if (this.redisClient) {
      await this.saveRedisSession(session)
      await this.pushRedisEvent(sessionId, event)
    } else {
      this.emit(session, event)
    }
  }

  async setStatus(sessionId: string, status: TranscriptionStatus): Promise<void> {
    const existing = this.redisClient ? await this.loadRedisSession(sessionId) : null
    const session = existing || this.getSession(sessionId)
    session.status = status

    const event: TranscriptionEvent = {
      event: 'status',
      data: {
        session_id: sessionId,
        status,
        stitched_text: session.stitchedText,
        final_transcript: session.finalTranscript ?? null,
      },
    }

    if (this.redisClient) {
      await this.saveRedisSession(session)
      await this.pushRedisEvent(sessionId, event)
    } else {
      this.emit(session, event)
    }
  }

  async setFinalTranscript(sessionId: string, transcript: string): Promise<void> {
    const existing = this.redisClient ? await this.loadRedisSession(sessionId) : null
    const session = existing || this.getSession(sessionId)
    session.finalTranscript = transcript
    session.status = 'completed'
    this.sessionTimestamps.set(sessionId, Date.now())

    const event: TranscriptionEvent = {
      event: 'final',
      data: {
        session_id: sessionId,
        final_transcript: transcript,
      },
    }

    if (this.redisClient) {
      await this.saveRedisSession(session)
      await this.pushRedisEvent(sessionId, event)
    } else {
      this.emit(session, event)
    }
  }

  async emitError(sessionId: string, code: string, message: string): Promise<void> {
    const existing = this.redisClient ? await this.loadRedisSession(sessionId) : null
    const session = existing || this.getSession(sessionId)
    session.status = 'error'

    const event: TranscriptionEvent = {
      event: 'error',
      data: {
        session_id: sessionId,
        code,
        message,
      },
    }

    if (this.redisClient) {
      await this.saveRedisSession(session)
      await this.pushRedisEvent(sessionId, event)
    } else {
      this.emit(session, event)
    }
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
