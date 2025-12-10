"use client"

import { X } from "lucide-react"
import { Button } from "@ui/lib/ui/button"
import { Label } from "@ui/lib/ui/label"
import type { NoteLength } from "@storage/preferences"

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  noteLength: NoteLength
  onNoteLengthChange: (length: NoteLength) => void
}

export function SettingsDialog({ isOpen, onClose, noteLength, onNoteLengthChange }: SettingsDialogProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-background p-8 shadow-2xl border border-border">
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
        </div>

        {/* Footer */}
        <div className="mt-8 flex justify-end">
          <Button
            onClick={onClose}
            className="rounded-full bg-foreground text-background hover:bg-foreground/90"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
