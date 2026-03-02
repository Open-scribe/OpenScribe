import type { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { getHostedUserContext } from '@storage/firestore-metadata'
import { isHostedMode } from '@storage/hosted-mode'
import { writeServerAuditEntry } from '@storage/server-audit'

export type AuthRole = 'org_owner' | 'clinician' | 'staff_viewer'

export interface AuthContext {
  userId: string
  email?: string
  orgId: string
  role: AuthRole
}

export interface VerifiedIdentity {
  userId: string
  email?: string
}

interface TokenInfoResponse {
  sub?: string
  aud?: string
  email?: string
  exp?: string
}

const tokenCache = new Map<string, { expiresAt: number; payload: TokenInfoResponse }>()
const SESSION_COOKIE_NAME = 'openscribe_session'
const SESSION_TTL_SECONDS = 15 * 60

function getBearerToken(req: NextRequest): string | null {
  const value = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!value) return null
  const [scheme, token] = value.split(' ')
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null
  return token.trim()
}

function getCookieValue(req: NextRequest, name: string): string | null {
  const cookieHeader = req.headers.get('cookie')
  if (!cookieHeader) return null
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  if (!cookie) return null
  return decodeURIComponent(cookie.slice(name.length + 1))
}

function getSessionSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new Error('Missing AUTH_SESSION_SECRET for hosted auth session cookies.')
  }
  return secret
}

function signSessionPayload(payloadBase64: string): string {
  const secret = getSessionSecret()
  return crypto
    .createHmac('sha256', secret)
    .update(payloadBase64)
    .digest('base64url')
}

function encodeSessionCookie(identity: VerifiedIdentity): string {
  const payloadBase64 = Buffer.from(
    JSON.stringify({
      sub: identity.userId,
      email: identity.email || '',
      exp: Date.now() + SESSION_TTL_SECONDS * 1000,
    }),
    'utf8',
  ).toString('base64url')
  const signature = signSessionPayload(payloadBase64)
  return `${payloadBase64}.${signature}`
}

function decodeSessionCookie(raw: string): VerifiedIdentity | null {
  const [payloadBase64, signature] = raw.split('.')
  if (!payloadBase64 || !signature) return null
  const expectedSig = signSessionPayload(payloadBase64)
  const actual = Uint8Array.from(Buffer.from(signature))
  const expected = Uint8Array.from(Buffer.from(expectedSig))
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return null
  }

  const payloadRaw = Buffer.from(payloadBase64, 'base64url').toString('utf8')
  const payload = JSON.parse(payloadRaw) as { sub?: string; email?: string; exp?: number }
  if (!payload.sub || !payload.exp || payload.exp < Date.now()) {
    return null
  }

  return { userId: payload.sub, email: payload.email || undefined }
}

async function verifyIdentityPlatformToken(idToken: string): Promise<TokenInfoResponse> {
  const cached = tokenCache.get(idToken)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload
  }

  const endpoint = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  const res = await fetch(endpoint)
  if (!res.ok) {
    throw new Error(`id_token verification failed: ${res.status}`)
  }

  const payload = (await res.json()) as TokenInfoResponse
  if (!payload.sub) {
    throw new Error('id_token payload missing sub')
  }

  const expectedAud = process.env.GCP_IDENTITY_PLATFORM_CLIENT_ID
  if (expectedAud && payload.aud !== expectedAud) {
    throw new Error('id_token audience mismatch')
  }

  const expEpochMs = payload.exp ? Number(payload.exp) * 1000 : Date.now() + 60_000
  tokenCache.set(idToken, {
    expiresAt: expEpochMs,
    payload,
  })

  return payload
}

export function createSessionCookieHeader(identity: VerifiedIdentity, secure = process.env.NODE_ENV === 'production'): string {
  const value = encodeSessionCookie(identity)
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}; ${secure ? 'Secure; ' : ''}`
}

export function clearSessionCookieHeader(secure = process.env.NODE_ENV === 'production'): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; ${secure ? 'Secure; ' : ''}`
}

export async function verifyRequestIdentity(req: NextRequest): Promise<VerifiedIdentity | null> {
  if (!isHostedMode()) {
    return {
      userId: 'local-user',
      email: undefined,
    }
  }

  const sessionValue = getCookieValue(req, SESSION_COOKIE_NAME)
  if (sessionValue) {
    try {
      const identity = decodeSessionCookie(sessionValue)
      if (identity) {
        return identity
      }
    } catch {
      // fallback to bearer token
    }
  }

  const token = getBearerToken(req)
  if (!token) {
    await writeServerAuditEntry({ event_type: 'auth.failed', success: false, error_code: 'missing_token' })
    return null
  }

  try {
    const payload = await verifyIdentityPlatformToken(token)
    return {
      userId: payload.sub as string,
      email: payload.email,
    }
  } catch (error) {
    await writeServerAuditEntry({
      event_type: 'auth.failed',
      success: false,
      error_code: 'verification_failed',
      error_message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function requireAuth(req: NextRequest): Promise<AuthContext | null> {
  if (!isHostedMode()) {
    return {
      userId: 'local-user',
      orgId: 'local-org',
      role: 'org_owner',
    }
  }

  const identity = await verifyRequestIdentity(req)
  if (!identity) {
    return null
  }

  try {
    const context = await getHostedUserContext(identity.userId)

    if (!context?.orgId || !context.role) {
      await writeServerAuditEntry({
        event_type: 'authz.denied',
        success: false,
        user_id: identity.userId,
        error_code: 'missing_membership',
      })
      return null
    }

    await writeServerAuditEntry({
      event_type: 'auth.success',
      success: true,
      user_id: context.userId,
      org_id: context.orgId,
      metadata: { role: context.role },
    })

    return {
      userId: context.userId,
      email: context.email,
      orgId: context.orgId,
      role: context.role,
    }
  } catch (error) {
    await writeServerAuditEntry({
      event_type: 'auth.failed',
      success: false,
      error_code: 'auth_context_failed',
      error_message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
