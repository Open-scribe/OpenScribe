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

export function NewEncounterForm({ onStart, onCancel }: NewEncounterFormProps) {
  const [patientName, setPatientName] = useState("")
  const [patientId, setPatientId] = useState("")
  const [patientIdError, setPatientIdError] = useState("")
  const [visitType, setVisitType] = useState(VISIT_TYPE_OPTIONS[0]?.value ?? "")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (OPENEMR_ENABLED && !patientId.trim()) {
      setPatientIdError("OpenEMR Patient ID is required")
      return
    }

    onStart({
      patient_name: patientName,
      patient_id: OPENEMR_ENABLED ? patientId.trim() : "",
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

        {OPENEMR_ENABLED && (
          <div className="space-y-2">
            <Label htmlFor="patient-id" className="text-sm text-muted-foreground">
              OpenEMR Patient ID
            </Label>
            <Input
              id="patient-id"
              placeholder="Enter OpenEMR patient ID"
              value={patientId}
              onChange={(e) => {
                setPatientId(e.target.value)
                if (patientIdError) setPatientIdError("")
              }}
              className={`rounded-xl border-border bg-secondary${patientIdError ? " border-destructive" : ""}`}
            />
            {patientIdError && (
              <p className="text-xs text-destructive">{patientIdError}</p>
            )}
          </div>
        )}

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
