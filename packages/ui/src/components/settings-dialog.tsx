"use client"

import { useState, useEffect } from "react"
import { X } from "lucide-react"
import { Button } from "@ui/lib/ui/button"
import { Label } from "@ui/lib/ui/label"
import type { NoteLength, ProcessingMode } from "@storage/preferences"
import { getAuditRetentionDays, setAuditRetentionDays, purgeAllAuditLogs } from "@storage/audit-log"
import { AuditLogViewer } from "./audit-log-viewer"

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  noteLength: NoteLength
  onNoteLengthChange: (length: NoteLength) => void
  processingMode: ProcessingMode
  onProcessingModeChange: (mode: ProcessingMode) => void
  localBackendAvailable: boolean
}

export function SettingsDialog({
  isOpen,
  onClose,
  noteLength,
  onNoteLengthChange,
  processingMode,
  onProcessingModeChange,
  localBackendAvailable,
}: SettingsDialogProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState("")
  const [retentionDays, setRetentionDays] = useState(90)
  const [showAuditViewer, setShowAuditViewer] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setRetentionDays(getAuditRetentionDays())
    }
  }, [isOpen])

  const handleSave = async () => {
    setIsSaving(true)
    setSaveMessage("")

    try {
      // Save retention policy
      setAuditRetentionDays(retentionDays)

      setSaveMessage("Settings saved successfully")
      setTimeout(() => {
        setSaveMessage("")
        onClose()
      }, 1500)
    } catch (error) {
      console.error("Failed to save settings:", error)
      setSaveMessage("Failed to save settings")
    } finally {
      setIsSaving(false)
    }
  }

  const handlePurgeAuditLogs = async () => {
    if (!confirm("Are you sure you want to delete ALL audit logs? This action cannot be undone.")) {
      return
    }

    try {
      await purgeAllAuditLogs()
      setSaveMessage("Audit logs purged successfully")
      setTimeout(() => setSaveMessage(""), 2000)
    } catch (error) {
      console.error("Failed to purge audit logs:", error)
      setSaveMessage("Failed to purge audit logs")
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-background p-8 shadow-2xl border border-border max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">Settings</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-9 w-9 rounded-full p-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </Button>
        </div>

        {/* Settings Content */}
        <div className="space-y-6">
          {/* Note Length Setting */}
          <div className="space-y-3">
            <Label className="text-base font-medium text-foreground">Note Length</Label>
            <p className="text-sm text-muted-foreground">
              Choose between concise or detailed clinical notes
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => onNoteLengthChange("short")}
                className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
                  noteLength === "short"
                    ? "border-foreground bg-accent"
                    : "border-border hover:border-muted-foreground"
                }`}
              >
                <div className="font-medium text-foreground">Short</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Brief, focused documentation
                </div>
              </button>
              <button
                onClick={() => onNoteLengthChange("long")}
                className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
                  noteLength === "long"
                    ? "border-foreground bg-accent"
                    : "border-border hover:border-muted-foreground"
                }`}
              >
                <div className="font-medium text-foreground">Long</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Comprehensive, detailed notes
                </div>
              </button>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Processing Mode */}
          <div className="space-y-3">
            <Label className="text-base font-medium text-foreground">Processing Mode</Label>
            <p className="text-sm text-muted-foreground">
              Choose the default desktop pipeline for transcription and note generation.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => onProcessingModeChange("mixed")}
                className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
                  processingMode === "mixed"
                    ? "border-foreground bg-accent"
                    : "border-border hover:border-muted-foreground"
                }`}
              >
                <div className="font-medium text-foreground">Mixed (Default)</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Local Whisper transcription + Claude note generation
                </div>
              </button>
              <button
                onClick={() => onProcessingModeChange("local")}
                disabled={!localBackendAvailable}
                className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
                  processingMode === "local"
                    ? "border-foreground bg-accent"
                    : "border-border hover:border-muted-foreground"
                } ${!localBackendAvailable ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <div className="font-medium text-foreground">Local-only</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Local Whisper + local Ollama note generation
                </div>
              </button>
            </div>
            {!localBackendAvailable && (
              <p className="text-xs text-muted-foreground">
                Local-only mode requires the desktop backend runtime to be available.
              </p>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Audit Logs Section */}
          <div className="space-y-3">
            <Label className="text-base font-medium text-foreground">Audit Logs</Label>
            <p className="text-sm text-muted-foreground">
              View and export HIPAA-compliant audit logs for all system operations
            </p>

            {/* Retention Policy */}
            <div className="space-y-2">
              <Label htmlFor="retention-days" className="text-sm font-medium text-foreground">
                Log Retention Period
              </Label>
              <select
                id="retention-days"
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="30">30 days</option>
                <option value="90">90 days (recommended)</option>
                <option value="365">1 year</option>
                <option value="2555">7 years (HIPAA maximum)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Logs older than this period will be automatically deleted
              </p>
            </div>

            {/* View/Export Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowAuditViewer(true)}
                className="flex-1"
              >
                View Audit Log
              </Button>
              <Button
                variant="outline"
                onClick={handlePurgeAuditLogs}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
              >
                Purge All Logs
              </Button>
            </div>
          </div>
        </div>

        {/* Save Message */}
        {saveMessage && (
          <div className={`mt-4 text-sm text-center ${saveMessage.includes("success") ? "text-green-600" : "text-red-600"}`}>
            {saveMessage}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="rounded-full"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-full bg-foreground text-background hover:bg-foreground/90"
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Audit Log Viewer Modal */}
      {showAuditViewer && <AuditLogViewer onClose={() => setShowAuditViewer(false)} />}
    </div>
  )
}
