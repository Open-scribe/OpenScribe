import type { NextRequest } from 'next/server'
import { ensureHostedUserBootstrap } from '@storage/firestore-metadata'
import { isHostedMode } from '@storage/hosted-mode'
import { writeServerAuditEntry, logSanitizedServerError } from '@storage/server-audit'
import { createSessionCookieHeader, verifyRequestIdentity } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  if (!isHostedMode()) {
    return new Response(JSON.stringify({ ok: true, mode: 'local' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const identity = await verifyRequestIdentity(req)
  if (!identity) {
    return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Authentication required' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const user = await ensureHostedUserBootstrap({ userId: identity.userId, email: identity.email })

    await writeServerAuditEntry({
      event_type: 'auth.success',
      success: true,
      user_id: user.userId,
      org_id: user.orgId,
      metadata: { bootstrap: true, role: user.role },
    })

    return new Response(
      JSON.stringify({
        ok: true,
        user: {
          user_id: user.userId,
          org_id: user.orgId,
          role: user.role,
          email: user.email,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': createSessionCookieHeader({ userId: user.userId, email: user.email }),
        },
      },
    )
  } catch (error) {
    logSanitizedServerError('auth.bootstrap', error)
    await writeServerAuditEntry({
      event_type: 'auth.failed',
      success: false,
      user_id: identity.userId,
      error_code: 'bootstrap_failed',
      error_message: error instanceof Error ? error.message : String(error),
    })
    return new Response(JSON.stringify({ error: { code: 'bootstrap_failed', message: 'Failed to bootstrap user account' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
