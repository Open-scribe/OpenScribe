import { isHostedMode } from './hosted-mode'

export type ServerAuditEventType =
  | 'auth.success'
  | 'auth.failed'
  | 'authz.denied'
  | 'transcription.segment_uploaded'
  | 'transcription.completed'
  | 'transcription.failed'
  | 'note.generation_started'
  | 'note.generated'
  | 'note.generation_failed'
  | 'settings.api_key_configured'

export interface ServerAuditEntry {
  event_type: ServerAuditEventType
  success: boolean
  org_id?: string
  user_id?: string
  resource_id?: string
  request_id?: string
  error_code?: string
  error_message?: string
  metadata?: Record<string, unknown>
}

const PHI_KEY_PATTERNS = [/patient/i, /transcript/i, /note(_text)?/i, /audio/i, /visit_reason/i]

export function sanitizeAuditMetadata(input?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!input) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (PHI_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      continue
    }
    if (typeof value === 'string' && value.length > 256) {
      out[key] = `${value.slice(0, 256)}...[truncated]`
      continue
    }
    out[key] = value
  }
  return out
}

export function sanitizeAuditErrorMessage(message?: string): string | undefined {
  if (!message) return undefined
  return message
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .slice(0, 512)
}

export async function writeServerAuditEntry(entry: ServerAuditEntry): Promise<void> {
  const payload = {
    severity: entry.success ? 'INFO' : 'WARNING',
    component: 'openscribe-server-audit',
    hosted_mode: isHostedMode(),
    timestamp: new Date().toISOString(),
    event_type: entry.event_type,
    success: entry.success,
    org_id: entry.org_id,
    user_id: entry.user_id,
    resource_id: entry.resource_id,
    request_id: entry.request_id,
    error_code: entry.error_code,
    error_message: sanitizeAuditErrorMessage(entry.error_message),
    metadata: sanitizeAuditMetadata(entry.metadata),
  }

  // Structured JSON logging for Cloud Logging ingestion.
  if (entry.success) {
    console.info(JSON.stringify(payload))
  } else {
    console.warn(JSON.stringify(payload))
  }
}

export function logSanitizedServerError(context: string, error: unknown): void {
  const message = error instanceof Error ? sanitizeAuditErrorMessage(error.message) : String(error)
  console.error(`[${context}] ${message}`)
}
