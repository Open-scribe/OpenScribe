"use client"

import { Cpu, Cloud } from "lucide-react"
import type { ProcessingMode } from "@storage/preferences"

interface ModelIndicatorProps {
  processingMode: ProcessingMode
}

/**
 * Displays the current AI models in use for transcription and note generation.
 * Placed in the sidebar between the encounter list and settings bar.
 */
export function ModelIndicator({ processingMode }: ModelIndicatorProps) {
  const noteModel = processingMode === "local" ? "Ollama (Local)" : "Claude (Cloud)"
  const noteIcon = processingMode === "local" ? Cpu : Cloud

  const NoteIcon = noteIcon

  return (
    <div className="shrink-0 border-t border-sidebar-border bg-sidebar px-4 py-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
        Models
      </p>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Cpu className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Whisper (Local)</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <NoteIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{noteModel}</span>
        </div>
      </div>
    </div>
  )
}
