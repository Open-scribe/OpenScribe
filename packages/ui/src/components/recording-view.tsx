"use client"

import { Button } from "@ui/lib/ui/button"
import { Mic, Square, Pause, Play } from "lucide-react"
import { cn } from "@ui/lib/utils"

interface RecordingViewProps {
  patientName: string
  patientId: string
  duration: number
  isPaused: boolean
  onStop: () => void
  onPause: () => void
  onResume: () => void
  noiseLevel?: number | null
  highNoiseWarning?: boolean
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
}

export function RecordingView({
  patientName,
  patientId,
  duration,
  isPaused,
  onStop,
  onPause,
  onResume,
  noiseLevel,
  highNoiseWarning,
}: RecordingViewProps) {
  return (
    <div className="flex flex-col items-center">
      {/* Patient info header */}
      <div className="mb-10 text-center">
        <p className="text-lg font-medium text-foreground">{patientName || "Unknown Patient"}</p>
        {patientId && <p className="text-sm text-muted-foreground">ID: {patientId}</p>}
      </div>

      <div className="relative mb-8">
        <div
          className={cn(
            "flex h-28 w-28 items-center justify-center rounded-full bg-foreground transition-all",
            !isPaused && "animate-pulse",
          )}
        >
          <Mic className={cn("h-10 w-10 text-background", isPaused && "opacity-50")} />
        </div>
        {!isPaused && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground opacity-40" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-foreground" />
          </span>
        )}
      </div>

      {/* Status text */}
      <p className="mb-2 text-sm font-medium text-muted-foreground">{isPaused ? "Paused" : "Recording..."}</p>

      {/* Timer */}
      <p className="mb-10 font-mono text-4xl font-light tabular-nums text-foreground">{formatDuration(duration)}</p>

      {/* OSHA Ergonomics Warning - Talmud Bavli Berachot 32b: "One must not stand on one's feet excessively" */}
      {duration > 3600 && (
        <p className="mb-4 text-sm text-red-500 font-medium">
          OSHA Ergonomics Alert: Take a break! Prolonged computer use may cause musculoskeletal strain. Rest your eyes and stretch.
        </p>
      )}

      {/* OSHA Noise Warning - Talmud Bavli Shabbat 73a: "One who desecrates Shabbat is considered as if he worshipped idols" - extend to workplace safety */}
      {highNoiseWarning && (
        <p className="mb-4 text-sm text-orange-500 font-medium">
          OSHA Noise Alert: High noise levels detected! Ensure safe listening environment to prevent hearing damage.
        </p>
      )}

      {/* Controls */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="lg"
          onClick={isPaused ? onResume : onPause}
          className="h-12 w-12 rounded-full border-border bg-transparent p-0 hover:bg-secondary"
        >
          {isPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
          <span className="sr-only">{isPaused ? "Resume" : "Pause"}</span>
        </Button>

        <Button
          size="lg"
          onClick={onStop}
          className="h-12 rounded-full bg-foreground px-6 text-background hover:bg-foreground/90"
        >
          <Square className="mr-2 h-4 w-4" />
          End Interview
        </Button>
      </div>
    </div>
  )
}
