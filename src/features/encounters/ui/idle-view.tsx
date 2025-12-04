"use client"
import { Mic } from "lucide-react"

interface IdleViewProps {
  onStartNew: () => void
}

export function IdleView({ onStartNew }: IdleViewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <button
        onClick={onStartNew}
        className="group mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-foreground transition-transform hover:scale-105 active:scale-95"
      >
        <Mic className="h-8 w-8 text-background" />
      </button>

      <h2 className="text-xl font-medium text-foreground mb-2">Start a new interview</h2>

      <p className="text-muted-foreground text-center max-w-xs text-sm">
        Record, transcribe, and generate clinical notes automatically.
      </p>
    </div>
  )
}
