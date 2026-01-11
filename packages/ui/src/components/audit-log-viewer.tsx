"use client"

import { useState, useEffect } from "react"
import { Button } from "@ui/lib/ui/button"
import { Label } from "@ui/lib/ui/label"
import type { AuditLogEntry, AuditLogFilter, AuditEventType } from "@storage/types"
import { getAuditEntries, exportAuditLog, flushAuditQueue } from "@storage/audit-log"
import { debugLog } from "@storage/debug-logger"

interface AuditLogViewerProps {
  onClose: () => void
}

export function AuditLogViewer({ onClose }: AuditLogViewerProps) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<AuditLogFilter>({})
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    loadEntries()
  }, [filter])

  async function loadEntries() {
    setLoading(true)
    try {
      // Flush any pending entries first
      await flushAuditQueue()

      const logs = await getAuditEntries(filter)
      setEntries(logs)
    } catch (error) {
      console.error("Failed to load audit entries:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleExport(format: "csv" | "json") {
    setExporting(true)
    try {
      await flushAuditQueue()
      const blob = await exportAuditLog(format, filter)
      const filename = `audit-log-${new Date().toISOString().split("T")[0]}.${format}`

      // Check if running in Electron
      if (window.desktop?.auditLog?.exportLog) {
        // Use Electron save dialog
        const text = await blob.text()
        const result = await window.desktop.auditLog.exportLog({
          data: text,
          filename,
        })

        if (result.success && !result.canceled) {
          debugLog("audit", `Exported audit log to ${result.filePath}`)
        }
      } else {
        // Browser download
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      console.error("Failed to export audit log:", error)
    } finally {
      setExporting(false)
    }
  }

  function formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleString()
  }

  function getEventTypeDisplay(eventType: AuditEventType): string {
    return eventType.replace(/\./g, " › ").replace(/_/g, " ")
  }

  function getStatusBadge(success: boolean) {
    if (success) {
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400">
          Success
        </span>
      )
    }
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-900/20 dark:text-red-400">
        Failed
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-6xl rounded-lg border border-border bg-background shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-6">
          <div>
            <h2 className="text-2xl font-semibold">Audit Log</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              HIPAA compliance tracking for all system operations
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>

        {/* Filters */}
        <div className="border-b border-border bg-muted/30 p-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <Label className="text-xs">Date Range</Label>
              <div className="mt-1 flex gap-2">
                <input
                  type="date"
                  className="rounded-md border border-input bg-background px-3 py-1 text-sm"
                  onChange={(e) =>
                    setFilter((f) => ({ ...f, startDate: e.target.value + "T00:00:00Z" }))
                  }
                />
                <span className="self-center text-sm text-muted-foreground">to</span>
                <input
                  type="date"
                  className="rounded-md border border-input bg-background px-3 py-1 text-sm"
                  onChange={(e) =>
                    setFilter((f) => ({ ...f, endDate: e.target.value + "T23:59:59Z" }))
                  }
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <select
                className="mt-1 rounded-md border border-input bg-background px-3 py-1 text-sm"
                onChange={(e) =>
                  setFilter((f) => ({
                    ...f,
                    success: e.target.value === "" ? undefined : e.target.value === "true",
                  }))
                }
              >
                <option value="">All</option>
                <option value="true">Success</option>
                <option value="false">Failed</option>
              </select>
            </div>
            <div className="self-end">
              <Button variant="outline" size="sm" onClick={loadEntries}>
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Entries List */}
        <div className="max-h-[500px] overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-sm text-muted-foreground">Loading audit logs...</div>
          ) : entries.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground">No audit entries found</div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-border bg-card p-4 hover:bg-muted/20"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{getEventTypeDisplay(entry.event_type)}</span>
                        {getStatusBadge(entry.success)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatTimestamp(entry.timestamp)}
                        {entry.resource_id && <> • Resource: {entry.resource_id}</>}
                      </div>
                      {entry.error_message && (
                        <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
                          Error: {entry.error_message}
                        </div>
                      )}
                      {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                            View metadata
                          </summary>
                          <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                            {JSON.stringify(entry.metadata, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border p-6">
          <div className="text-sm text-muted-foreground">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleExport("json")} disabled={exporting}>
              {exporting ? "Exporting..." : "Export JSON"}
            </Button>
            <Button variant="outline" onClick={() => handleExport("csv")} disabled={exporting}>
              {exporting ? "Exporting..." : "Export CSV"}
            </Button>
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
