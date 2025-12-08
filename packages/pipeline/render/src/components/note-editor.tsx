"use client"

import { useState, useEffect } from "react"
import type { Encounter } from "@storage/types"
import { type ClinicalNote, parseNoteText, formatNoteText, serializeNote } from "@note-core"
import { Button } from "@ui/lib/ui/button"
import { Textarea } from "@ui/lib/ui/textarea"
import { Badge } from "@ui/lib/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ui/lib/ui/tabs"
import { ScrollArea } from "@ui/lib/ui/scroll-area"
import { Save, Copy, Download, Check, AlertTriangle } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@ui/lib/utils"

interface NoteEditorProps {
  encounter: Encounter
  onSave: (noteText: string) => void
}

const SECTIONS = [
  { key: "chief_complaint", label: "CC" },
  { key: "hpi", label: "HPI" },
  { key: "ros", label: "ROS" },
  { key: "physical_exam", label: "PE" },
  { key: "assessment", label: "Assessment" },
  { key: "plan", label: "Plan" },
] as const

export function NoteEditor({ encounter, onSave }: NoteEditorProps) {
  const [note, setNote] = useState<ClinicalNote>(() => parseNoteText(encounter.note_text))
  const [hasChanges, setHasChanges] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setNote(parseNoteText(encounter.note_text))
    setHasChanges(false)
  }, [encounter.id, encounter.note_text])

  const updateSection = (key: keyof ClinicalNote, value: string) => {
    setNote((prev) => ({ ...prev, [key]: value }))
    setHasChanges(true)
    setSaved(false)
  }

  const handleSave = () => {
    const serialized = serializeNote(note)
    onSave(serialized)
    setHasChanges(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleCopy = async () => {
    const formatted = formatNoteText(note)
    await navigator.clipboard.writeText(formatted)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExport = () => {
    const formatted = formatNoteText(note)
    const blob = new Blob([formatted], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${encounter.patient_name || "encounter"}_${format(new Date(encounter.created_at), "yyyy-MM-dd")}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border bg-background px-8 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-medium text-foreground">{encounter.patient_name || "Unknown Patient"}</h2>
              {encounter.patient_id && (
                <Badge
                  variant="secondary"
                  className="rounded-full font-mono text-xs bg-secondary text-muted-foreground"
                >
                  {encounter.patient_id}
                </Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{format(new Date(encounter.created_at), "MMM d, yyyy 'at' h:mm a")}</span>
              {encounter.visit_reason && (
                <>
                  <span className="text-border">·</span>
                  <span>{encounter.visit_reason}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-9 w-9 rounded-full p-0 text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span className="sr-only">Copy</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExport}
              className="h-9 w-9 rounded-full p-0 text-muted-foreground hover:text-foreground"
            >
              <Download className="h-4 w-4" />
              <span className="sr-only">Export</span>
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges}
              className={cn(
                "ml-2 rounded-full bg-foreground text-background hover:bg-foreground/90",
                saved && "bg-success hover:bg-success",
              )}
            >
              {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              <span className="ml-2">{saved ? "Saved" : "Save"}</span>
            </Button>
          </div>
        </div>

        {/* Draft warning */}
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>AI-generated draft — requires clinician review before use</span>
        </div>
      </div>

      <Tabs defaultValue="complete" className="flex flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border bg-background px-8">
          <TabsList className="h-12 bg-transparent p-0 gap-1">
            <TabsTrigger
              value="complete"
              className="rounded-none border-b-2 border-transparent px-4 text-sm text-muted-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground"
            >
              Complete Note
            </TabsTrigger>
            {SECTIONS.map(({ key, label }) => (
              <TabsTrigger
                key={key}
                value={key}
                className="rounded-none border-b-2 border-transparent px-4 text-sm text-muted-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-8">
            <TabsContent value="complete" className="m-0">
              <Textarea
                value={formatNoteText(note)}
                readOnly
                className="min-h-[300px] resize-none rounded-xl border-border bg-secondary font-mono text-sm leading-relaxed"
              />
            </TabsContent>
            {SECTIONS.map(({ key, label }) => (
              <TabsContent key={key} value={key} className="m-0">
                <Textarea
                  value={note[key]}
                  onChange={(e) => updateSection(key, e.target.value)}
                  placeholder={`Enter ${label.toLowerCase()}...`}
                  className="min-h-[300px] resize-none rounded-xl border-border bg-secondary font-mono text-sm leading-relaxed focus-visible:ring-1 focus-visible:ring-ring"
                />
              </TabsContent>
            ))}
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  )
}
