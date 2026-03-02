import type { NextRequest } from 'next/server'
import { createClinicalNoteText, type ClinicalNoteRequest } from '@note-core'
import { getAnthropicApiKey } from '@storage/server-api-keys'
import { writeServerAuditEntry, logSanitizedServerError } from '@storage/server-audit'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'

function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function isClinicalNoteRequest(value: unknown): value is ClinicalNoteRequest {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return typeof payload.transcript === 'string'
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth) {
    return jsonError(401, 'unauthorized', 'Authentication required')
  }

  try {
    const body = await req.json()
    if (!isClinicalNoteRequest(body)) {
      return jsonError(400, 'validation_error', 'Invalid clinical note request payload')
    }

    const apiKey = getAnthropicApiKey()

    await writeServerAuditEntry({
      event_type: 'note.generation_started',
      success: true,
      org_id: auth.orgId,
      user_id: auth.userId,
      metadata: {
        template: body.template || 'default',
        transcript_length: body.transcript.length,
      },
    })

    const note = await createClinicalNoteText({
      ...body,
      apiKey,
    })

    await writeServerAuditEntry({
      event_type: 'note.generated',
      success: true,
      org_id: auth.orgId,
      user_id: auth.userId,
      metadata: {
        template: body.template || 'default',
        note_length: note.length,
      },
    })

    return new Response(JSON.stringify({ note }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logSanitizedServerError('notes.generate', error)

    await writeServerAuditEntry({
      event_type: 'note.generation_failed',
      success: false,
      org_id: auth.orgId,
      user_id: auth.userId,
      error_code: 'note_generation_failed',
      error_message: error instanceof Error ? error.message : String(error),
    })

    return jsonError(500, 'note_generation_failed', 'Failed to generate clinical note')
  }
}
