"use client"

import type { Encounter } from "../core/types"
import { cn } from "@/lib/utils"
import { Input } from "@/lib/ui/input"
import { Button } from "@/lib/ui/button"
import { ScrollArea } from "@/lib/ui/scroll-area"
import { Search, FileText, Clock, Plus } from "lucide-react"
import { useState, useMemo } from "react"
import { formatDistanceToNow } from "date-fns"
interface EncounterListProps {
  encounters: Encounter[]
  selectedId: string | null
  onSelect: (encounter: Encounter) => void
  onNewEncounter: () => void
  disabled?: boolean
}

export function EncounterList({ encounters, selectedId, onSelect, onNewEncounter, disabled }: EncounterListProps) {
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!search.trim()) return encounters
    const q = search.toLowerCase()
    return encounters.filter(
      (e) =>
        e.patient_name.toLowerCase().includes(q) ||
        e.visit_reason.toLowerCase().includes(q) ||
        e.patient_id.toLowerCase().includes(q),
    )
  }, [encounters, search])

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border p-4">
        <Button
          onClick={onNewEncounter}
          disabled={disabled}
          className="w-full justify-start gap-2 rounded-xl bg-foreground text-background hover:bg-foreground/90"
        >
          <Plus className="h-4 w-4" />
          New Encounter
        </Button>
      </div>

      <div className="border-b border-sidebar-border p-5">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">Encounters</h2>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-full border-border bg-background pl-10 text-foreground placeholder:text-muted-foreground"
            disabled={disabled}
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <FileText className="mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {encounters.length === 0 ? "No encounters yet" : "No matching encounters"}
            </p>
          </div>
        ) : (
          <div className="p-3">
            {filtered.map((encounter) => (
              <button
                key={encounter.id}
                onClick={() => onSelect(encounter)}
                disabled={disabled}
                className={cn(
                  "mb-1 w-full rounded-xl p-3 text-left transition-colors",
                  "hover:bg-sidebar-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                  selectedId === encounter.id && "bg-sidebar-accent",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {encounter.patient_name || "Unknown patient"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {encounter.visit_reason || "No reason specified"}
                    </p>
                  </div>
                  <StatusIndicator status={encounter.status} />
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>
                    {formatDistanceToNow(new Date(encounter.created_at), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

    </div>
  )
}

function StatusIndicator({ status }: { status: Encounter["status"] }) {
  const config = {
    idle: { color: "bg-muted-foreground/30" },
    recording: { color: "bg-foreground animate-pulse" },
    processing: { color: "bg-muted-foreground animate-pulse" },
    transcription_failed: { color: "bg-destructive" },
    note_generation_failed: { color: "bg-destructive" },
    completed: { color: "bg-foreground" },
  }

  const { color } = config[status]

  return <div className={cn("h-2 w-2 shrink-0 rounded-full", color)} />
}
