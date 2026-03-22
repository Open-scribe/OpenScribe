"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@ui/lib/ui/button"
import { Input } from "@ui/lib/ui/input"
import { Label } from "@ui/lib/ui/label"
import { Mic } from "lucide-react"

interface NewEncounterFormProps {
  onStart: (data: { patient_name: string; patient_id: string; visit_reason: string }) => void
  onCancel: () => void
}

const VISIT_TYPE_OPTIONS = [
  { label: "History & Physical", value: "history_physical" },
  { label: "Problem Visit", value: "problem_visit" },
  { label: "Consult Note", value: "consult_note" },
]

// Note: this constant is intentionally duplicated from apps/web where
// NEXT_PUBLIC_* vars are inlined at build time. This package can't import
// from apps/web, and the duplication is minimal and explicit.
const OPENEMR_ENABLED = process.env.NEXT_PUBLIC_OPENEMR_ENABLED === "true"
const OPENEMR_PATIENT_ID_PATTERN =
  /^(?:[1-9]\d*|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

export function NewEncounterForm({ onStart, onCancel }: NewEncounterFormProps) {
  const [patientName, setPatientName] = useState("")
  const [patientId, setPatientId] = useState("")
  const [patientIdError, setPatientIdError] = useState("")
  const [pushToOpenEMR, setPushToOpenEMR] = useState(false)
  const [authCheckState, setAuthCheckState] = useState<"idle" | "checking" | "ready" | "failed">("idle")
  const [authCheckMessage, setAuthCheckMessage] = useState("")
  const [visitType, setVisitType] = useState(VISIT_TYPE_OPTIONS[0]?.value ?? "")

  const runOpenEMRAuthCheck = async () => {
    setAuthCheckState("checking")
    setAuthCheckMessage("")
    try {
      const response = await fetch("/api/integrations/openemr/auth/setup", {
        method: "POST",
      })
      const data = (await response.json()) as {
        success?: boolean
        message?: string
        error?: string
      }
      if (data.success) {
        setAuthCheckState("ready")
        setAuthCheckMessage(data.message || "OpenEMR auth is ready.")
      } else {
        setAuthCheckState("failed")
        setAuthCheckMessage(data.error || "OpenEMR auth failed. Reconnect and retry.")
      }
    } catch (error) {
      setAuthCheckState("failed")
      setAuthCheckMessage(error instanceof Error ? error.message : "OpenEMR auth failed. Reconnect and retry.")
    }
  }

  const handleSetPushToOpenEMR = (enabled: boolean) => {
    setPushToOpenEMR(enabled)
    setPatientIdError("")
    if (!enabled) {
      setPatientId("")
      setAuthCheckState("idle")
      setAuthCheckMessage("")
      return
    }
    void runOpenEMRAuthCheck()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (OPENEMR_ENABLED && pushToOpenEMR && !patientId.trim()) {
      setPatientIdError("OpenEMR Patient ID is required")
      return
    }

    if (OPENEMR_ENABLED && pushToOpenEMR && !OPENEMR_PATIENT_ID_PATTERN.test(patientId.trim())) {
      setPatientIdError("OpenEMR Patient ID must be a numeric PID or UUID")
      return
    }

    if (OPENEMR_ENABLED && pushToOpenEMR && authCheckState !== "ready") {
      setPatientIdError("OpenEMR auth is not ready. Click Retry Auth Check.")
      return
    }

    onStart({
      patient_name: patientName,
      patient_id: OPENEMR_ENABLED && pushToOpenEMR ? patientId.trim() : "",
      visit_reason: visitType,
    })
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h2 className="text-xl font-medium text-foreground mb-6 text-center">New Interview</h2>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="patient-name" className="text-sm text-muted-foreground">
            Patient Name
          </Label>
          <Input
            id="patient-name"
            placeholder="Enter patient name (optional)"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            className="rounded-xl border-border bg-secondary"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="visit-type" className="text-sm text-muted-foreground">
            Note Type
          </Label>
          <select
            id="visit-type"
            value={visitType}
            onChange={(e) => setVisitType(e.target.value)}
            className="w-full rounded-xl border border-border bg-secondary px-4 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {VISIT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {OPENEMR_ENABLED && (
          <div className="space-y-3">
            <Label className="text-sm text-muted-foreground">Push to EMR</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={pushToOpenEMR ? "default" : "secondary"}
                onClick={() => handleSetPushToOpenEMR(true)}
                className="rounded-full px-4"
              >
                Yes
              </Button>
              <Button
                type="button"
                variant={!pushToOpenEMR ? "default" : "secondary"}
                onClick={() => handleSetPushToOpenEMR(false)}
                className="rounded-full px-4"
              >
                No
              </Button>
            </div>

            {pushToOpenEMR && (
              <div className="space-y-2">
                <Label htmlFor="patient-id" className="text-sm text-muted-foreground">
                  OpenEMR Patient ID or UUID
                </Label>
                <Input
                  id="patient-id"
                  placeholder="Enter OpenEMR patient ID (e.g., 3) or UUID"
                  value={patientId}
                  onChange={(e) => {
                    setPatientId(e.target.value)
                    if (patientIdError) setPatientIdError("")
                  }}
                  className={`rounded-xl border-border bg-secondary${patientIdError ? " border-destructive" : ""}`}
                />
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={
                      authCheckState === "ready"
                        ? "text-emerald-700"
                        : authCheckState === "failed"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    {authCheckState === "checking"
                      ? "Checking OpenEMR auth..."
                      : authCheckMessage || "OpenEMR auth not checked yet."}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void runOpenEMRAuthCheck()}
                    disabled={authCheckState === "checking"}
                    className="h-7 px-2"
                  >
                    {authCheckState === "checking" ? "Checking..." : "Retry Auth Check"}
                  </Button>
                </div>
                {patientIdError && <p className="text-xs text-destructive">{patientIdError}</p>}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            className="flex-1 rounded-full text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button type="submit" className="flex-1 rounded-full bg-foreground text-background hover:bg-foreground/90">
            <Mic className="mr-2 h-4 w-4" />
            Start Recording
          </Button>
        </div>
      </form>
    </div>
  )
}
