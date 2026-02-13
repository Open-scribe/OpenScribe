"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@ui/lib/ui/button"
import { Input } from "@ui/lib/ui/input"
import { Label } from "@ui/lib/ui/label"
import { Checkbox } from "@ui/lib/ui/checkbox"
import { Mic } from "lucide-react"

interface NewEncounterFormProps {
  onStart: (data: { patient_name: string; patient_id: string; visit_reason: string; consent_given: boolean }) => void
  onCancel: () => void
}

const VISIT_TYPE_OPTIONS = [
  { label: "History & Physical", value: "history_physical" },
  { label: "Problem Visit", value: "problem_visit" },
  { label: "Consult Note", value: "consult_note" },
]

export function NewEncounterForm({ onStart, onCancel }: NewEncounterFormProps) {
  const [patientName, setPatientName] = useState("")
  const [visitType, setVisitType] = useState(VISIT_TYPE_OPTIONS[0]?.value ?? "")
  const [consentGiven, setConsentGiven] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!consentGiven) {
      alert("GDPR Consent required for recording - as per Talmud Bavli Gittin 38b: 'A person's word is his bond'")
      return
    }
    onStart({
      patient_name: patientName,
      patient_id: "",
      visit_reason: visitType,
      consent_given: consentGiven,
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

        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="consent"
              checked={consentGiven}
              onCheckedChange={(checked) => setConsentGiven(checked as boolean)}
            />
            <Label htmlFor="consent" className="text-sm text-muted-foreground">
              I consent to audio recording for clinical documentation (GDPR Article 7)
            </Label>
          </div>
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
