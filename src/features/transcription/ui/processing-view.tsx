"use client"

import { Button } from "@/lib/ui/button"
import { Check, Loader2, X, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"

type StepStatus = "pending" | "in-progress" | "done" | "failed"

interface ProcessingViewProps {
  patientName: string
  transcriptionStatus: StepStatus
  noteGenerationStatus: StepStatus
  onRetryTranscription?: () => void
  onRetryNoteGeneration?: () => void
}

export function ProcessingView({
  patientName,
  transcriptionStatus,
  noteGenerationStatus,
  onRetryTranscription,
  onRetryNoteGeneration,
}: ProcessingViewProps) {
  return (
    <div className="flex flex-col items-center">
      <div className="mb-10 text-center">
        <p className="text-lg font-medium text-foreground">{patientName || "Unknown Patient"}</p>
        <p className="mt-1 text-sm text-muted-foreground">Processing interview...</p>
      </div>

      <div className="w-full max-w-xs space-y-3">
        <ProcessingStep label="Transcribing audio" status={transcriptionStatus} onRetry={onRetryTranscription} />
        <ProcessingStep
          label="Generating clinical note"
          status={noteGenerationStatus}
          onRetry={onRetryNoteGeneration}
        />
      </div>
    </div>
  )
}

function ProcessingStep({
  label,
  status,
  onRetry,
}: {
  label: string
  status: StepStatus
  onRetry?: () => void
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border p-4",
        status === "failed" && "border-destructive/30 bg-destructive/5",
        status === "done" && "border-border bg-secondary",
        status === "in-progress" && "border-border bg-secondary",
        status === "pending" && "border-border bg-transparent",
      )}
    >
      <StepIcon status={status} />
      <div className="flex-1">
        <p
          className={cn(
            "text-sm font-medium",
            status === "pending" && "text-muted-foreground",
            status === "in-progress" && "text-foreground",
            status === "done" && "text-foreground",
            status === "failed" && "text-destructive",
          )}
        >
          {label}
        </p>
        {status === "failed" && <p className="mt-0.5 text-xs text-muted-foreground">An error occurred</p>}
      </div>
      {status === "failed" && onRetry && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "pending") {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full border border-border">
        <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
      </div>
    )
  }

  if (status === "in-progress") {
    return (
      <div className="flex h-6 w-6 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-foreground" />
      </div>
    )
  }

  if (status === "done") {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground">
        <Check className="h-3.5 w-3.5 text-background" />
      </div>
    )
  }

  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive">
      <X className="h-3.5 w-3.5 text-destructive-foreground" />
    </div>
  )
}
