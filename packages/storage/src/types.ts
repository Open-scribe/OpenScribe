export type EncounterStatus =
  | "idle"
  | "recording"
  | "processing"
  | "transcription_failed"
  | "note_generation_failed"
  | "completed"

export interface Encounter {
  id: string
  patient_name: string
  patient_id: string
  visit_reason: string
  session_id?: string
  created_at: string
  updated_at: string
  audio_blob?: Blob
  transcript_text: string
  /**
   * Clinical note in markdown format
   * This is the primary storage format for notes
   */
  note_text: string
  status: EncounterStatus
  language: string
  recording_duration?: number
}

/**
 * Audit event types for HIPAA compliance tracking
 * Tracks all operations that create, read, update, or delete PHI
 */
export type AuditEventType =
  | "encounter.created"
  | "encounter.updated"
  | "encounter.deleted"
  | "transcription.segment_uploaded"
  | "transcription.completed"
  | "transcription.failed"
  | "note.generation_started"
  | "note.generated"
  | "note.generation_failed"
  | "settings.api_key_configured"
  | "settings.preferences_updated"
  | "audit.exported"
  | "audit.purged"

/**
 * Audit log entry for HIPAA compliance
 * Stored encrypted in localStorage or filesystem
 * CRITICAL: No PHI content allowed (patient names, transcripts, notes)
 */
export interface AuditLogEntry {
  /** Unique identifier for this audit entry */
  id: string
  /** ISO 8601 timestamp when event occurred */
  timestamp: string
  /** Type of event being audited */
  event_type: AuditEventType
  /** Resource identifier (e.g., encounter ID) - NOT patient identifiers */
  resource_id?: string
  /** Operation success status */
  success: boolean
  /** Error message if operation failed (sanitized, no PHI) */
  error_message?: string
  /** Additional non-PHI metadata (durations, counts, settings changed) */
  metadata?: Record<string, unknown>
  /** User identifier for future multi-user support */
  user_id?: string
}

/**
 * Filter options for querying audit logs
 */
export interface AuditLogFilter {
  /** Start date (ISO 8601) */
  startDate?: string
  /** End date (ISO 8601) */
  endDate?: string
  /** Filter by event types */
  eventTypes?: AuditEventType[]
  /** Filter by resource ID */
  resourceId?: string
  /** Filter by success status */
  success?: boolean
  /** Maximum number of entries to return */
  limit?: number
}

/**
 * Export format options for audit logs
 */
export type AuditExportFormat = "csv" | "json"
