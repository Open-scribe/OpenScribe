"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Mic } from "lucide-react"

interface NewEncounterFormProps {
  onStart: (data: { patient_name: string; patient_id: string; visit_reason: string }) => void
  onCancel: () => void
}

export function NewEncounterForm({ onStart, onCancel }: NewEncounterFormProps) {
  const [patientName, setPatientName] = useState("")
  const [patientId, setPatientId] = useState("")
  const [visitReason, setVisitReason] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onStart({
      patient_name: patientName,
      patient_id: patientId,
      visit_reason: visitReason,
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
          <Label htmlFor="patient-id" className="text-sm text-muted-foreground">
            Patient ID / MRN
          </Label>
          <Input
            id="patient-id"
            placeholder="Enter patient ID (optional)"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            className="rounded-xl border-border bg-secondary"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="visit-reason" className="text-sm text-muted-foreground">
            Visit Reason
          </Label>
          <Textarea
            id="visit-reason"
            placeholder="Brief reason for visit (optional)"
            value={visitReason}
            onChange={(e) => setVisitReason(e.target.value)}
            className="min-h-[80px] resize-none rounded-xl border-border bg-secondary"
          />
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
