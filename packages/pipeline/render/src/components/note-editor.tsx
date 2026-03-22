"use client"

import { useState, useEffect, useRef } from "react"
import type { Encounter } from "@storage/types"
import { Button } from "@ui/lib/ui/button"
import { Textarea } from "@ui/lib/ui/textarea"
import { Badge } from "@ui/lib/ui/badge"
import { ScrollArea } from "@ui/lib/ui/scroll-area"
import { Save, Copy, Download, Check, AlertTriangle, Send, X, MessageSquare, Loader2, Upload } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@ui/lib/utils"

const VISIT_TYPE_LABELS: Record<string, string> = {
  history_physical: "History & Physical",
  problem_visit: "Problem Visit",
  consult_note: "Consult Note",
}

interface NoteEditorProps {
  encounter: Encounter
  onSave: (noteText: string) => void
}

// Note: this constant is intentionally duplicated from apps/web where
// NEXT_PUBLIC_* vars are inlined at build time. This package can't import
// from apps/web, and the duplication is minimal and explicit.
const OPENEMR_ENABLED = process.env.NEXT_PUBLIC_OPENEMR_ENABLED === "true"

type TabType = "note" | "transcript"
type OpenClawInitState = "idle" | "sending" | "sent" | "failed"
type OpenEMRPushState = "idle" | "pushing" | "success" | "failed"
type OpenEMRPreflight = {
  configured: boolean
  auth_ok: boolean
  patient_id_valid: boolean
  patient_resolvable: boolean
  note_ok: boolean
  can_push: boolean
  document_verified: boolean | null
  blockers: Array<{ code: string; message: string }>
  token_state: {
    has_token: boolean
    source: "persisted" | "env" | "none"
    last_refresh_attempt: string | null
    last_refresh_error: string | null
  }
}
type OpenEMRPushResponse =
  | {
      success: true
      id: string
      uploadedAt: string
      verifiedPreview: string
      verifiedLength: number
      openEMRDocumentUrl: string | null
    }
  | { success: false; error?: string; code?: string }
type OpenEMRAuthSetupResponse =
  | {
      success: true
      message: string
      mode: "user" | "service"
    }
  | { success: false; error?: string; code?: string }

type OpenClawPayload = {
  source: "openscribe"
  encounterId: string
  patientName: string
  patientId: string
  visitReason: string
  noteMarkdown: string
  transcript: string
  requestedAction: "openemr_apply_note"
}

type OpenClawMessage = {
  id: string
  role: "user" | "assistant" | "system"
  text: string
  createdAt: string
  runId?: string
  status?: string
}

function messageId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function NoteEditor({ encounter, onSave }: NoteEditorProps) {
  const [activeTab, setActiveTab] = useState<TabType>("note")
  const [noteMarkdown, setNoteMarkdown] = useState<string>(encounter.note_text || "")
  const [hasChanges, setHasChanges] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  const [openEMRPushState, setOpenEMRPushState] = useState<OpenEMRPushState>("idle")
  const [openEMRError, setOpenEMRError] = useState("")
  const [openEMRPreflight, setOpenEMRPreflight] = useState<OpenEMRPreflight | null>(null)
  const [openEMRPreflightLoading, setOpenEMRPreflightLoading] = useState(false)
  const [openEMRPreflightError, setOpenEMRPreflightError] = useState("")
  const [openEMRAuthSetupState, setOpenEMRAuthSetupState] = useState<"idle" | "setting_up" | "failed" | "done">("idle")
  const [openEMRAuthSetupMessage, setOpenEMRAuthSetupMessage] = useState("")
  const [openEMRPushResult, setOpenEMRPushResult] = useState<Extract<OpenEMRPushResponse, { success: true }> | null>(
    null,
  )

  const [openClawAvailable, setOpenClawAvailable] = useState(false)
  const [openClawPanelOpen, setOpenClawPanelOpen] = useState(false)
  const [openClawInitState, setOpenClawInitState] = useState<OpenClawInitState>("idle")
  const [openClawSessionId, setOpenClawSessionId] = useState<string>("")
  const [openClawError, setOpenClawError] = useState("")
  const [openClawMessages, setOpenClawMessages] = useState<OpenClawMessage[]>([])
  const [openClawInput, setOpenClawInput] = useState("")
  const [openClawSending, setOpenClawSending] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setNoteMarkdown(encounter.note_text || "")
    setHasChanges(false)
    setOpenClawPanelOpen(false)
    setOpenClawInitState("idle")
    setOpenClawSessionId("")
    setOpenClawError("")
    setOpenClawMessages([])
    setOpenClawInput("")
    setOpenClawSending(false)
    setOpenEMRPushState("idle")
    setOpenEMRError("")
    setOpenEMRPreflight(null)
    setOpenEMRPreflightLoading(false)
    setOpenEMRPreflightError("")
    setOpenEMRAuthSetupState("idle")
    setOpenEMRAuthSetupMessage("")
    setOpenEMRPushResult(null)
  }, [encounter.id, encounter.note_text])

  useEffect(() => {
    if (typeof window === "undefined") return
    const desktop = (window as Window & {
      desktop?: {
        openscribeBackend?: {
          invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
        }
      }
    }).desktop
    setOpenClawAvailable(Boolean(desktop?.openscribeBackend))
  }, [])

  useEffect(() => {
    if (!openClawPanelOpen) return
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [openClawMessages, openClawPanelOpen, openClawSending])

  const handleNoteChange = (value: string) => {
    setNoteMarkdown(value)
    setHasChanges(true)
    setSaved(false)
    if (openEMRPushState === "failed" || openEMRPushState === "success") {
      setOpenEMRPushState("idle")
      setOpenEMRError("")
    }
    if (openEMRPushResult) {
      setOpenEMRPushResult(null)
    }
  }

  const handleSave = () => {
    onSave(noteMarkdown)
    setHasChanges(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleCopy = async () => {
    const textToCopy = activeTab === "note" ? noteMarkdown : encounter.transcript_text
    await navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExport = () => {
    const isNote = activeTab === "note"
    const content = isNote ? noteMarkdown : encounter.transcript_text
    const blob = new Blob([content], { type: isNote ? "text/markdown" : "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const suffix = isNote ? "note" : "transcript"
    const extension = isNote ? "md" : "txt"
    a.download = `${encounter.patient_name || "encounter"}_${suffix}_${format(new Date(encounter.created_at), "yyyy-MM-dd")}.${extension}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const appendMessage = (message: OpenClawMessage) => {
    setOpenClawMessages((prev) => [...prev, message])
  }

  const sendChatTurn = async (message: string, options?: { isInitial?: boolean }) => {
    const desktop = (window as Window & {
      desktop?: {
        openscribeBackend?: {
          invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
        }
      }
    }).desktop

    if (!desktop?.openscribeBackend) {
      setOpenClawError("OpenClaw chat is only available in the desktop app.")
      setOpenClawInitState("failed")
      appendMessage({
        id: messageId(),
        role: "system",
        text: "OpenClaw chat is only available in desktop mode.",
        createdAt: new Date().toISOString(),
      })
      return
    }

    if (!options?.isInitial) {
      appendMessage({
        id: messageId(),
        role: "user",
        text: message,
        createdAt: new Date().toISOString(),
      })
    }

    if (options?.isInitial) {
      setOpenClawInitState("sending")
    }
    setOpenClawSending(true)
    setOpenClawError("")

    try {
      const result = (await desktop.openscribeBackend.invoke("openclaw-chat-turn", {
        encounterId: encounter.id,
        patientName: encounter.patient_name || "",
        patientId: encounter.patient_id || "",
        visitReason: encounter.visit_reason || "",
        noteMarkdown,
        transcript: encounter.transcript_text || "",
        sessionId: openClawSessionId || undefined,
        message,
      })) as {
        success?: boolean
        error?: string
        sessionId?: string
        runId?: string
        status?: string
        responseText?: string
        rawOutput?: string
      }

      if (!result?.success) {
        const errorMessage = result?.error || "OpenClaw did not accept the request."
        if (options?.isInitial) {
          setOpenClawInitState("failed")
        }
        setOpenClawError(errorMessage)
        appendMessage({
          id: messageId(),
          role: "system",
          text: errorMessage,
          createdAt: new Date().toISOString(),
          status: "error",
        })
        return
      }

      if (result.sessionId) {
        setOpenClawSessionId(result.sessionId)
      }

      if (options?.isInitial) {
        setOpenClawInitState("sent")
        appendMessage({
          id: messageId(),
          role: "system",
          text: "Clinical note handoff sent to OpenClaw. Continue here to monitor and chat.",
          createdAt: new Date().toISOString(),
          status: result.status,
        })
      }

      appendMessage({
        id: messageId(),
        role: "assistant",
        text: result.responseText || result.rawOutput || "OpenClaw returned no response text.",
        createdAt: new Date().toISOString(),
        runId: result.runId,
        status: result.status,
      })
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "OpenClaw chat failed."
      if (options?.isInitial) {
        setOpenClawInitState("failed")
      }
      setOpenClawError(messageText)
      appendMessage({
        id: messageId(),
        role: "system",
        text: messageText,
        createdAt: new Date().toISOString(),
        status: "error",
      })
    } finally {
      setOpenClawSending(false)
    }
  }

  const buildInitialHandoffMessage = (): string => {
    const payload = buildOpenClawPayload()

    return [
      "You are receiving a structured handoff from OpenScribe.",
      "Primary objective: execute the OpenEMR action for this encounter now.",
      "Action target: apply the note into OpenEMR for the current patient chart or create/update the current encounter note.",
      "If patient resolution is ambiguous, ask for confirmation before writing data.",
      "Return a concise status after action execution.",
      "",
      `Encounter ID: ${payload.encounterId || "(missing)"}`,
      `Patient Name: ${payload.patientName || "(missing)"}`,
      `Patient ID: ${payload.patientId || "(missing)"}`,
      `Visit Reason: ${payload.visitReason || "(missing)"}`,
      `Requested Action: ${payload.requestedAction}`,
      "",
      "Clinical note markdown:",
      payload.noteMarkdown || "(missing)",
      "",
      "Transcript (optional context):",
      payload.transcript || "(missing)",
    ].join("\n")
  }

  const buildOpenClawPayload = (): OpenClawPayload => {
    return {
      source: "openscribe",
      encounterId: encounter.id,
      patientName: encounter.patient_name || "",
      patientId: encounter.patient_id || "",
      visitReason: encounter.visit_reason || "",
      noteMarkdown,
      transcript: encounter.transcript_text || "",
      requestedAction: "openemr_apply_note",
    }
  }

  const runOpenEMRPreflight = async (documentId?: string) => {
    if (!OPENEMR_ENABLED) return
    setOpenEMRPreflightLoading(true)
    setOpenEMRPreflightError("")
    try {
      const params = new URLSearchParams({
        patientId: encounter.patient_id || "",
        noteMarkdown,
      })
      params.set("_ts", String(Date.now()))
      if (documentId) params.set("documentId", documentId)
      const resp = await fetch(`/api/integrations/openemr/status?${params.toString()}`, { cache: "no-store" })
      const data = (await resp.json()) as OpenEMRPreflight
      setOpenEMRPreflight(data)
    } catch (err) {
      setOpenEMRPreflightError(err instanceof Error ? err.message : "Failed to run OpenEMR preflight.")
    } finally {
      setOpenEMRPreflightLoading(false)
    }
  }

  useEffect(() => {
    if (!OPENEMR_ENABLED || activeTab !== "note") return
    const timer = setTimeout(() => {
      void runOpenEMRPreflight(openEMRPushResult?.id)
    }, 350)
    return () => clearTimeout(timer)
  }, [activeTab, encounter.patient_id, noteMarkdown, openEMRPushResult?.id])

  const handleVerifyOpenEMRUpload = async () => {
    if (!openEMRPushResult?.id) return
    await runOpenEMRPreflight(openEMRPushResult.id)
  }

  const handlePushToOpenEMR = async () => {
    if (!openEMRPreflight?.can_push) {
      setOpenEMRPushState("failed")
      const firstBlocker = openEMRPreflight?.blockers?.[0]?.message
      setOpenEMRError(firstBlocker || "OpenEMR preflight checks are failing. Resolve blockers and retry.")
      return
    }
    setOpenEMRPushState("pushing")
    setOpenEMRError("")
    try {
      const resp = await fetch("/api/integrations/openemr/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encounterId: encounter.id,
          patientId: encounter.patient_id || "",
          noteMarkdown,
          patientName: encounter.patient_name || "",
          visitReason: encounter.visit_reason || "",
        }),
      })
      const data = (await resp.json()) as OpenEMRPushResponse
      if (data.success) {
        setOpenEMRPushState("success")
        setOpenEMRPushResult(data)
        await runOpenEMRPreflight(data.id)
      } else {
        setOpenEMRPushState("failed")
        setOpenEMRError(data.error || "OpenEMR push failed.")
      }
    } catch (err) {
      setOpenEMRPushState("failed")
      setOpenEMRError(err instanceof Error ? err.message : "OpenEMR push failed.")
    }
  }

  const handleSetupOpenEMRAuth = async () => {
    setOpenEMRAuthSetupState("setting_up")
    setOpenEMRAuthSetupMessage("")
    try {
      const resp = await fetch("/api/integrations/openemr/auth/setup", {
        method: "POST",
      })
      const data = (await resp.json()) as OpenEMRAuthSetupResponse
      if (data.success) {
        setOpenEMRAuthSetupState("done")
        setOpenEMRAuthSetupMessage(data.message || "OpenEMR auth is ready.")
        await runOpenEMRPreflight(openEMRPushResult?.id)
      } else {
        setOpenEMRAuthSetupState("failed")
        setOpenEMRAuthSetupMessage(data.error || "OpenEMR auth setup failed.")
      }
    } catch (err) {
      setOpenEMRAuthSetupState("failed")
      setOpenEMRAuthSetupMessage(err instanceof Error ? err.message : "OpenEMR auth setup failed.")
    }
  }

  const handleOpenOpenClawChat = async () => {
    setOpenClawPanelOpen(true)

    if (!openClawAvailable) {
      setOpenClawInitState("failed")
      setOpenClawError("OpenClaw handoff is only available in the desktop app.")
      if (openClawMessages.length === 0) {
        appendMessage({
          id: messageId(),
          role: "system",
          text: "OpenClaw handoff is only available in desktop mode.",
          createdAt: new Date().toISOString(),
          status: "error",
        })
      }
      return
    }

    if (openClawMessages.length === 0 && !openClawSending) {
      const initialMessage = buildInitialHandoffMessage()
      await sendChatTurn(initialMessage, { isInitial: true })
    }
  }

  const firstOpenEMRBlocker = openEMRPreflight?.blockers?.[0]?.message || openEMRPreflightError
  const hasOpenEMRAuthBlocker = Boolean(
    openEMRPreflight?.blockers?.some((blocker) =>
      blocker.code === "OPENEMR_AUTH_INVALID" || blocker.code === "OPENEMR_AUTH_EXPIRED",
    ),
  )

  const handleSendUserMessage = async () => {
    const text = openClawInput.trim()
    if (!text || openClawSending) return
    setOpenClawInput("")
    await sendChatTurn(text)
  }

  return (
    <>
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
                    <span>{VISIT_TYPE_LABELS[encounter.visit_reason] || encounter.visit_reason}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4 border-b border-border">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab("note")}
                className={cn(
                  "px-4 py-2 text-sm font-medium transition-colors",
                  "border-b-2 -mb-px",
                  activeTab === "note"
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                Clinical Note
              </button>
              <button
                onClick={() => setActiveTab("transcript")}
                className={cn(
                  "px-4 py-2 text-sm font-medium transition-colors",
                  "border-b-2 -mb-px",
                  activeTab === "transcript"
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                Transcript
              </button>
            </div>

            <div className="flex items-center gap-1 pb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
              >
                {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
                <span className="text-xs">Copy</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExport}
                className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
              >
                <Download className="h-4 w-4 mr-1.5" />
                <span className="text-xs">Export</span>
              </Button>
              {activeTab === "note" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenOpenClawChat}
                  disabled={!noteMarkdown.trim() || openClawInitState === "sending"}
                  className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
                  title={openClawAvailable ? "Open OpenClaw chat" : "OpenClaw handoff is available in desktop mode"}
                >
                  {openClawInitState === "sending" ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : openClawInitState === "sent" ? (
                    <Check className="h-4 w-4 mr-1.5" />
                  ) : (
                    <MessageSquare className="h-4 w-4 mr-1.5" />
                  )}
                  <span className="text-xs">
                    {openClawInitState === "sending"
                      ? "Opening OpenClaw..."
                      : openClawInitState === "sent"
                        ? "Open OpenClaw Chat"
                        : "Send to OpenClaw"}
                  </span>
                </Button>
              )}
              {activeTab === "note" && OPENEMR_ENABLED && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePushToOpenEMR}
                  disabled={
                    openEMRPushState === "pushing" ||
                    openEMRPreflightLoading ||
                    !openEMRPreflight?.can_push
                  }
                  className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
                  title={!openEMRPreflight?.can_push ? (firstOpenEMRBlocker || "Resolve OpenEMR blockers before pushing.") : undefined}
                >
                  {openEMRPushState === "pushing" || openEMRPreflightLoading ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : openEMRPushState === "success" ? (
                    <Check className="h-4 w-4 mr-1.5" />
                  ) : (
                    <Upload className="h-4 w-4 mr-1.5" />
                  )}
                  <span className="text-xs">
                    {openEMRPushState === "pushing"
                      ? "Pushing..."
                      : openEMRPreflightLoading
                        ? "Checking..."
                      : openEMRPushState === "success"
                        ? "Pushed to OpenEMR"
                        : "Push to OpenEMR"}
                  </span>
                </Button>
              )}
              {activeTab === "note" && (
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!hasChanges}
                  className={cn(
                    "ml-1 h-8 rounded-full px-3 bg-foreground text-background hover:bg-foreground/90",
                    saved && "bg-success hover:bg-success",
                  )}
                >
                  {saved ? <Check className="h-4 w-4 mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
                  <span className="text-xs">{saved ? "Saved" : "Save"}</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-8">
            {activeTab === "note" ? (
              <>
                <Textarea
                  value={noteMarkdown}
                  onChange={(e) => handleNoteChange(e.target.value)}
                  placeholder="Clinical note markdown..."
                  className="min-h-[600px] resize-none rounded-xl border-border bg-secondary font-mono text-sm leading-relaxed focus-visible:ring-1 focus-visible:ring-ring"
                />
                {openClawError && openClawInitState === "failed" && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{openClawError}</span>
                  </div>
                )}
                {openEMRError && openEMRPushState === "failed" && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{openEMRError}</span>
                  </div>
                )}
                {OPENEMR_ENABLED && (openEMRPreflightError || (openEMRPreflight && !openEMRPreflight.can_push)) && (
                  <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p className="font-medium">OpenEMR blockers</p>
                    {openEMRPreflightError ? (
                      <p className="mt-1">{openEMRPreflightError}</p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {openEMRPreflight?.blockers.map((blocker) => (
                          <li key={blocker.code}>
                            <span className="font-mono mr-1">{blocker.code}:</span>
                            {blocker.message}
                          </li>
                        ))}
                      </ul>
                    )}
                    {hasOpenEMRAuthBlocker && (
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleSetupOpenEMRAuth}
                          disabled={openEMRAuthSetupState === "setting_up"}
                          className="h-7 px-2"
                        >
                          {openEMRAuthSetupState === "setting_up" ? "Setting up auth..." : "Set up OpenEMR auth"}
                        </Button>
                        {openEMRAuthSetupMessage && <span>{openEMRAuthSetupMessage}</span>}
                      </div>
                    )}
                  </div>
                )}
                {openEMRPushResult && (
                  <div className="mt-3 rounded-lg border border-emerald-300/50 bg-emerald-50 px-3 py-3 text-xs text-emerald-950">
                    <p className="font-medium">Uploaded to OpenEMR</p>
                    <p className="mt-1">
                      Document ID: <span className="font-mono">{openEMRPushResult.id}</span>
                    </p>
                    <p>
                      Uploaded at: <span className="font-mono">{openEMRPushResult.uploadedAt}</span>
                    </p>
                    <p>Verified length: {openEMRPushResult.verifiedLength} chars</p>
                    <p className="mt-1 whitespace-pre-wrap break-words">
                      Preview: {openEMRPushResult.verifiedPreview || "(empty)"}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={handleVerifyOpenEMRUpload} className="h-7 px-2">
                        Verify Again
                      </Button>
                      {openEMRPushResult.openEMRDocumentUrl && (
                        <a
                          href={openEMRPushResult.openEMRDocumentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          Open in OpenEMR
                        </a>
                      )}
                      {openEMRPreflight?.document_verified !== null && (
                        <span className="font-medium">
                          {openEMRPreflight?.document_verified ? "Verified" : "Not verified"}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="min-h-[600px] rounded-xl border border-border bg-secondary p-6">
                {encounter.transcript_text ? (
                  <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
                    {encounter.transcript_text}
                  </pre>
                ) : (
                  <div className="flex h-full items-center justify-center text-center">
                    <p className="text-sm text-muted-foreground">No transcript available</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {openClawPanelOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpenClawPanelOpen(false)} />
          <aside className="fixed right-0 top-0 z-50 h-screen w-[440px] border-l border-border bg-background shadow-2xl">
            <div className="flex h-full flex-col">
              <div className="border-b border-border px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">OpenClaw Chat</p>
                    <p className="text-xs text-muted-foreground">
                      {openClawSessionId ? `Session: ${openClawSessionId}` : "Preparing session..."}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpenClawPanelOpen(false)}
                    className="h-8 rounded-full px-2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-3">
                  {openClawMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "max-w-[90%] rounded-xl px-3 py-2 text-xs",
                        msg.role === "user" && "ml-auto bg-foreground text-background",
                        msg.role === "assistant" && "mr-auto border border-border bg-secondary text-foreground",
                        msg.role === "system" && "mr-auto border border-amber-300/40 bg-amber-100/20 text-foreground",
                      )}
                    >
                      <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
                      <div className="mt-1 text-[10px] opacity-70">
                        {format(new Date(msg.createdAt), "h:mm:ss a")}
                        {msg.runId ? ` · run ${msg.runId}` : ""}
                        {msg.status ? ` · ${msg.status}` : ""}
                      </div>
                    </div>
                  ))}
                  {openClawSending && (
                    <div className="mr-auto inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Waiting for OpenClaw...</span>
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </div>
              </div>

              <div className="border-t border-border p-3">
                <div className="flex items-end gap-2">
                  <Textarea
                    value={openClawInput}
                    onChange={(e) => setOpenClawInput(e.target.value)}
                    placeholder="Message OpenClaw..."
                    className="min-h-[44px] max-h-[140px] resize-y rounded-xl border-border bg-secondary text-sm"
                    disabled={openClawSending || openClawInitState === "sending"}
                  />
                  <Button
                    size="sm"
                    onClick={handleSendUserMessage}
                    disabled={!openClawInput.trim() || openClawSending || openClawInitState === "sending"}
                    className="h-10 rounded-full px-3"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  )
}
