/**
 * Audit Logging for HIPAA and GDPR Compliance
 * 
 * This module provides local-only, encrypted audit logging for all operations
 * that create, read, update, or delete PHI (Protected Health Information).
 * 
 * "He who saves a single life, it is as if he saved the entire world" - Talmud Bavli Sanhedrin 37a
 * Ensuring accountability in healthcare data handling.
 * 
 * Key requirements:
 * - All entries stored encrypted using secure-storage.ts patterns
 * - No PHI content in audit logs (only resource IDs and metadata)
 * - Configurable retention policy (default 90 days)
 * - Export capability for compliance reviews
 * - Automatic cleanup of expired entries
 * 
 * Storage strategy:
 * - Browser/Web: Encrypted localStorage via secure-storage.ts
 * - Electron: Recent logs in localStorage, archived to filesystem via IPC
 */

import { saveSecureItem, loadSecureItem } from "./secure-storage"
import type {
  AuditLogEntry,
  AuditEventType,
  AuditLogFilter,
  AuditExportFormat,
} from "./types"
import { debugLog } from "./debug-logger"

// Storage keys
const AUDIT_LOGS_KEY = "openscribe_audit_logs"
const AUDIT_RETENTION_KEY = "openscribe_audit_retention_days"

// Default retention period (90 days per HIPAA guidance)
const DEFAULT_RETENTION_DAYS = 90

// Batch write queue for performance
let auditQueue: AuditLogEntry[] = []
let flushTimer: NodeJS.Timeout | null = null
const FLUSH_INTERVAL_MS = 2000 // Flush every 2 seconds

/**
 * Generate a unique audit log entry
 * CRITICAL: Never include PHI content (patient names, transcripts, notes)
 */
function createAuditEntry(params: {
  event_type: AuditEventType
  resource_id?: string
  success: boolean
  error_message?: string
  metadata?: Record<string, unknown>
  user_id?: string
}): AuditLogEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    event_type: params.event_type,
    resource_id: params.resource_id,
    success: params.success,
    error_message: params.error_message,
    metadata: params.metadata,
    user_id: params.user_id || "local-user",
  }
}

/**
 * Queue an audit entry for batch writing
 * Entries are automatically flushed every 2 seconds or on explicit flush
 */
export async function writeAuditEntry(params: {
  event_type: AuditEventType
  resource_id?: string
  success: boolean
  error_message?: string
  metadata?: Record<string, unknown>
  user_id?: string
}): Promise<AuditLogEntry> {
  const entry = createAuditEntry(params)

  debugLog("audit", `Queueing audit entry: ${entry.event_type}`, {
    id: entry.id,
    resource_id: entry.resource_id,
    success: entry.success,
  })

  auditQueue.push(entry)

  // Schedule flush if not already scheduled
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushAuditQueue().catch((error) => {
        console.error("Failed to flush audit queue:", error)
      })
    }, FLUSH_INTERVAL_MS)
  }

  return entry
}

/**
 * Flush all queued audit entries to encrypted storage
 */
export async function flushAuditQueue(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }

  if (auditQueue.length === 0) {
    return
  }

  const entriesToFlush = [...auditQueue]
  auditQueue = []

  debugLog("audit", `Flushing ${entriesToFlush.length} audit entries`)

  try {
    // Load existing logs
    const existingLogs = (await loadSecureItem<AuditLogEntry[]>(AUDIT_LOGS_KEY)) || []

    // Append new entries
    const updatedLogs = [...existingLogs, ...entriesToFlush]

    // Save encrypted
    await saveSecureItem(AUDIT_LOGS_KEY, updatedLogs)

    debugLog("audit", `Successfully flushed ${entriesToFlush.length} entries`)
  } catch (error) {
    console.error("Failed to flush audit queue:", error)
    // Re-queue failed entries
    auditQueue = [...entriesToFlush, ...auditQueue]
    throw error
  }
}

/**
 * Get audit log entries with optional filtering
 */
export async function getAuditEntries(
  filter?: AuditLogFilter
): Promise<AuditLogEntry[]> {
  try {
    const logs = (await loadSecureItem<AuditLogEntry[]>(AUDIT_LOGS_KEY)) || []

    let filtered = logs

    // Apply filters
    if (filter) {
      if (filter.startDate) {
        filtered = filtered.filter((entry) => entry.timestamp >= filter.startDate!)
      }
      if (filter.endDate) {
        filtered = filtered.filter((entry) => entry.timestamp <= filter.endDate!)
      }
      if (filter.eventTypes && filter.eventTypes.length > 0) {
        filtered = filtered.filter((entry) =>
          filter.eventTypes!.includes(entry.event_type)
        )
      }
      if (filter.resourceId) {
        filtered = filtered.filter((entry) => entry.resource_id === filter.resourceId)
      }
      if (filter.success !== undefined) {
        filtered = filtered.filter((entry) => entry.success === filter.success)
      }
      if (filter.limit && filter.limit > 0) {
        filtered = filtered.slice(0, filter.limit)
      }
    }

    // Sort by timestamp descending (most recent first)
    filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    return filtered
  } catch (error) {
    console.error("Failed to load audit entries:", error)
    return []
  }
}

/**
 * Export audit logs in specified format
 * Returns a Blob suitable for download
 */
export async function exportAuditLog(
  format: AuditExportFormat = "csv",
  filter?: AuditLogFilter
): Promise<Blob> {
  const entries = await getAuditEntries(filter)

  // Log the export action itself
  await writeAuditEntry({
    event_type: "audit.exported",
    success: true,
    metadata: {
      format,
      entry_count: entries.length,
      filter_applied: !!filter,
    },
  })

  if (format === "json") {
    const json = JSON.stringify(entries, null, 2)
    return new Blob([json], { type: "application/json" })
  }

  // CSV format
  const headers = [
    "ID",
    "Timestamp",
    "Event Type",
    "Resource ID",
    "Success",
    "Error Message",
    "User ID",
    "Metadata",
  ]

  const rows = entries.map((entry) => [
    entry.id,
    entry.timestamp,
    entry.event_type,
    entry.resource_id || "",
    entry.success.toString(),
    entry.error_message || "",
    entry.user_id || "",
    entry.metadata ? JSON.stringify(entry.metadata) : "",
  ])

  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n")

  return new Blob([csvContent], { type: "text/csv" })
}

/**
 * Get current retention policy (in days)
 */
export function getAuditRetentionDays(): number {
  try {
    const stored = localStorage.getItem(AUDIT_RETENTION_KEY)
    if (stored) {
      const days = parseInt(stored, 10)
      if (!isNaN(days) && days > 0) {
        return days
      }
    }
  } catch (error) {
    console.error("Failed to load audit retention policy:", error)
  }
  return DEFAULT_RETENTION_DAYS
}

/**
 * Set retention policy (in days)
 * Common values: 30, 90, 365, 2555 (7 years for HIPAA)
 */
export function setAuditRetentionDays(days: number): void {
  if (days <= 0) {
    throw new Error("Retention days must be positive")
  }
  localStorage.setItem(AUDIT_RETENTION_KEY, days.toString())
  debugLog("audit", `Updated retention policy to ${days} days`)
}

/**
 * Clean up audit entries older than retention policy
 * Should be called on app startup and periodically
 */
export async function cleanupOldAuditEntries(): Promise<number> {
  const retentionDays = getAuditRetentionDays()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
  const cutoffISO = cutoffDate.toISOString()

  debugLog("audit", `Cleaning up audit entries older than ${cutoffISO}`)

  try {
    const allLogs = (await loadSecureItem<AuditLogEntry[]>(AUDIT_LOGS_KEY)) || []
    const beforeCount = allLogs.length

    // Keep only entries within retention period
    const kept = allLogs.filter((entry) => entry.timestamp >= cutoffISO)
    const removedCount = beforeCount - kept.length

    if (removedCount > 0) {
      await saveSecureItem(AUDIT_LOGS_KEY, kept)
      debugLog("audit", `Cleaned up ${removedCount} old audit entries`)

      // Log the cleanup action
      await writeAuditEntry({
        event_type: "audit.purged",
        success: true,
        metadata: {
          entries_removed: removedCount,
          retention_days: retentionDays,
          cutoff_date: cutoffISO,
        },
      })
    }

    return removedCount
  } catch (error) {
    console.error("Failed to cleanup old audit entries:", error)
    return 0
  }
}

/**
 * Purge ALL audit logs (manual action for compliance)
 * Requires explicit user confirmation in UI
 */
export async function purgeAllAuditLogs(): Promise<void> {
  debugLog("audit", "Purging all audit logs")

  try {
    const allLogs = (await loadSecureItem<AuditLogEntry[]>(AUDIT_LOGS_KEY)) || []
    const count = allLogs.length

    // Log the purge before deleting
    await writeAuditEntry({
      event_type: "audit.purged",
      success: true,
      metadata: {
        entries_removed: count,
        manual_purge: true,
      },
    })

    // Flush the purge entry
    await flushAuditQueue()

    // Now clear all logs except the purge entry
    const purgeEntry = auditQueue.length > 0 ? auditQueue : []
    await saveSecureItem(AUDIT_LOGS_KEY, purgeEntry)

    debugLog("audit", `Purged ${count} audit entries`)
  } catch (error) {
    console.error("Failed to purge audit logs:", error)
    throw error
  }
}

/**
 * Wrapper for auditing async operations
 * Automatically logs success or failure
 * 
 * Example usage:
 * ```typescript
 * const encounter = await withAudit(
 *   async () => createEncounter({ patient_name: "John Doe" }),
 *   {
 *     event_type: "encounter.created",
 *     metadata: { source: "manual" }
 *   }
 * )
 * ```
 */
export async function withAudit<T>(
  operation: () => Promise<T>,
  params: {
    event_type: AuditEventType
    resource_id?: string
    metadata?: Record<string, unknown>
    user_id?: string
  }
): Promise<T> {
  const startTime = Date.now()

  try {
    const result = await operation()

    // Extract resource_id from result if not provided
    let resourceId = params.resource_id
    if (!resourceId && result && typeof result === "object" && "id" in result) {
      resourceId = (result as { id: string }).id
    }

    await writeAuditEntry({
      event_type: params.event_type,
      resource_id: resourceId,
      success: true,
      metadata: {
        ...params.metadata,
        duration_ms: Date.now() - startTime,
      },
      user_id: params.user_id,
    })

    return result
  } catch (error) {
    await writeAuditEntry({
      event_type: params.event_type,
      resource_id: params.resource_id,
      success: false,
      error_message: error instanceof Error ? error.message : String(error),
      metadata: {
        ...params.metadata,
        duration_ms: Date.now() - startTime,
      },
      user_id: params.user_id,
    })

    throw error
  }
}

/**
 * Initialize audit logging system
 * - Cleans up old entries based on retention policy
 * - Sets up periodic cleanup
 * - Should be called on app startup
 */
export async function initializeAuditLog(): Promise<void> {
  debugLog("audit", "Initializing audit logging system")

  // Clean up old entries on startup
  await cleanupOldAuditEntries()

  // Schedule daily cleanup
  setInterval(
    () => {
      cleanupOldAuditEntries().catch((error) => {
        console.error("Scheduled audit cleanup failed:", error)
      })
    },
    24 * 60 * 60 * 1000
  ) // 24 hours
}
