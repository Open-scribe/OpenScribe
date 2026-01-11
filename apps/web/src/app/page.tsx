"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import type { Encounter } from "@storage/types"
import { useEncounters, EncounterList, IdleView, NewEncounterForm, RecordingView, ProcessingView, ErrorBoundary, PermissionsDialog, SettingsDialog, SettingsBar, useHttpsWarning } from "@ui"
import { NoteEditor } from "@note-rendering"
import { useAudioRecorder, type RecordedSegment, warmupMicrophonePermission, warmupSystemAudioPermission } from "@audio"
import { useSegmentUpload } from "@transcription"
import { generateClinicalNote } from "@/app/actions"
import { getPreferences, setPreferences, type NoteLength, debugLog, debugLogPHI, debugError, debugWarn, initializeAuditLog } from "@storage"

type ViewState =
  | { type: "idle" }
  | { type: "new-form" }
  | { type: "recording"; encounterId: string }
  | { type: "processing"; encounterId: string }
  | { type: "viewing"; encounterId: string }

type StepStatus = "pending" | "in-progress" | "done" | "failed"

const SEGMENT_DURATION_MS = 10000
const OVERLAP_MS = 250

function HomePageContent() {
  const { encounters, addEncounter, updateEncounter, deleteEncounter: removeEncounter, refresh } = useEncounters()
  
  // HIPAA Compliance: Warn if production build is served over HTTP
  const httpsWarning = useHttpsWarning()

  const [view, setView] = useState<ViewState>({ type: "idle" })
  const [transcriptionStatus, setTranscriptionStatus] = useState<StepStatus>("pending")
  const [noteGenerationStatus, setNoteGenerationStatus] = useState<StepStatus>("pending")
  const [sessionId, setSessionId] = useState<string | null>(null)

  const currentEncounterIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const finalTranscriptRef = useRef<string>("")
  const finalRecordingRef = useRef<Blob | null>(null)

  const [showPermissionsDialog, setShowPermissionsDialog] = useState(false)
  const permissionCheckInProgressRef = useRef(false)

  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [noteLength, setNoteLengthState] = useState<NoteLength>("long")

  useEffect(() => {
    const prefs = getPreferences()
    setNoteLengthState(prefs.noteLength)

    // Initialize audit logging system (cleanup old entries, setup periodic cleanup)
    void initializeAuditLog()
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.__openscribePermissionsPrimed) return
    if (permissionCheckInProgressRef.current) return
    
    window.__openscribePermissionsPrimed = true
    permissionCheckInProgressRef.current = true

    const checkPermissions = async () => {
      try {
        const desktop = window.desktop
        debugLog("[Main Page] Desktop object available:", !!desktop)
        debugLog("[Main Page] Desktop API methods:", desktop ? Object.keys(desktop) : "none")
        
        if (!desktop?.getMediaAccessStatus) {
          // Not in desktop environment, just warmup browser permissions
          debugLog("[Main Page] Not in desktop environment, skipping permission dialog")
          void warmupMicrophonePermission()
          return
        }

        debugLog("[Main Page] Checking microphone permission...")
        const micStatus = await desktop.getMediaAccessStatus("microphone")
        debugLog("[Main Page] Microphone status:", micStatus)
        
        if (micStatus !== "granted") {
          debugLog("[Main Page] Missing microphone permission, showing dialog")
          setShowPermissionsDialog(true)
        } else {
          debugLog("[Main Page] All permissions granted, warmup only")
          // Warmup permissions in background
          void warmupMicrophonePermission()
          void warmupSystemAudioPermission()
        }
      } catch (error) {
        debugError("[Main Page] Permission check failed:", error)
      } finally {
        permissionCheckInProgressRef.current = false
      }
    }

    void checkPermissions()
  }, [])

  const handlePermissionsComplete = async () => {
    setShowPermissionsDialog(false)
    // Warmup permissions after dialog is complete
    void warmupMicrophonePermission()
    void warmupSystemAudioPermission()
  }

  const handleOpenSettings = () => {
    setShowSettingsDialog(true)
  }

  const handleCloseSettings = () => {
    setShowSettingsDialog(false)
  }

  const handleNoteLengthChange = (length: NoteLength) => {
    setNoteLengthState(length)
    setPreferences({ noteLength: length })
  }

  const handleUploadError = useCallback((error: any) => {
    debugError("Segment upload failed:", error?.code, "-", error?.message)
  }, [])

  const { enqueueSegment, resetQueue } = useSegmentUpload(sessionId, {
    onError: handleUploadError,
  })

  const cleanupSession = useCallback(() => {
    debugLog('[Cleanup] Closing EventSource connection')
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    sessionIdRef.current = null
    setSessionId(null)
    resetQueue()
  }, [resetQueue])

  const handleSegmentReady = useCallback(
    (segment: RecordedSegment) => {
      if (!sessionIdRef.current) return
      enqueueSegment({
        seqNo: segment.seqNo,
        startMs: segment.startMs,
        endMs: segment.endMs,
        durationMs: segment.durationMs,
        overlapMs: segment.overlapMs,
        blob: segment.blob,
      })
    },
    [enqueueSegment],
  )

  const {
    isPaused,
    duration,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    error: recordingError,
  } = useAudioRecorder({
    onSegmentReady: handleSegmentReady,
    segmentDurationMs: SEGMENT_DURATION_MS,
    overlapMs: OVERLAP_MS,
  })

  useEffect(() => {
    if (recordingError) {
      debugError("Recording error:", recordingError)
      setTranscriptionStatus("failed")
    }
  }, [recordingError])

  // Stable ref for updateEncounter to avoid EventSource recreation
  const updateEncounterRef = useRef(updateEncounter)
  useEffect(() => {
    updateEncounterRef.current = updateEncounter
  }, [updateEncounter])

  const handleSegmentEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          stitched_text?: string
          transcript?: string
        }
        const transcript = data.stitched_text || data.transcript || ""
        if (!transcript) return
        const encounterId = currentEncounterIdRef.current
        if (encounterId) {
          void updateEncounterRef.current(encounterId, { transcript_text: transcript })
        }
      } catch (error) {
        debugError("Failed to parse segment event", error)
      }
    },
    [], // No dependencies - uses refs instead
  )

  // Stable refs to avoid EventSource recreation
  const encountersRef = useRef(encounters)
  const noteLengthRef = useRef(noteLength)
  const refreshRef = useRef(refresh)
  
  useEffect(() => {
    encountersRef.current = encounters
    noteLengthRef.current = noteLength
    refreshRef.current = refresh
  }, [encounters, noteLength, refresh])

  const processEncounterForNoteGeneration = useCallback(
    async (encounterId: string, transcript: string) => {
      const enc = encountersRef.current.find((e: Encounter) => e.id === encounterId)
      const patientName = enc?.patient_name || ""
      const visitReason = enc?.visit_reason || ""

      debugLog("\n" + "=".repeat(80))
      debugLog("GENERATING CLINICAL NOTE")
      debugLog("=".repeat(80))
      debugLog(`Encounter ID: ${encounterId}`)
      debugLogPHI(`Patient: ${patientName || "Unknown"}`)
      debugLogPHI(`Visit Reason: ${visitReason || "Not provided"}`)
      debugLog(`Note Length: ${noteLengthRef.current}`)
      debugLog(`Transcript length: ${transcript.length} characters`)
      debugLog("=".repeat(80) + "\n")

      setNoteGenerationStatus("in-progress")
      try {
        const note = await generateClinicalNote({
          transcript,
          patient_name: patientName,
          visit_reason: visitReason,
          noteLength: noteLengthRef.current,
        })
        await updateEncounterRef.current(encounterId, {
          note_text: note,
          status: "completed",
        })
        await refreshRef.current()
        setNoteGenerationStatus("done")
        debugLog("✅ Clinical note saved to encounter")
        debugLog("\n" + "=".repeat(80))
        debugLog("ENCOUNTER PROCESSING COMPLETE")
        debugLog("=".repeat(80) + "\n")
        setView({ type: "viewing", encounterId })
      } catch (err) {
        debugError("❌ Note generation failed:", err)
        setNoteGenerationStatus("failed")
        await updateEncounterRef.current(encounterId, { status: "note_generation_failed" })
        await refreshRef.current()
      }
    },
    [], // No dependencies - uses refs instead
  )

  const handleFinalEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { final_transcript?: string }
        const transcript = data.final_transcript || ""
        if (!transcript) return
        finalTranscriptRef.current = transcript
        setTranscriptionStatus("done")
        const encounterId = currentEncounterIdRef.current
        if (encounterId) {
          void (async () => {
            await updateEncounterRef.current(encounterId, { transcript_text: transcript })
            await refreshRef.current()
            await processEncounterForNoteGeneration(encounterId, transcript)
          })()
        }
        cleanupSession()
      } catch (error) {
        debugError("Failed to parse final transcript event", error)
      }
    },
    [cleanupSession, processEncounterForNoteGeneration], // Minimal stable dependencies
  )

  const handleStreamError = useCallback((event: MessageEvent | Event) => {
    debugError("Transcription stream error", event)
    setTranscriptionStatus("failed")
  }, [])

  useEffect(() => {
    if (!sessionId) return
    
    debugLog('[EventSource] Connecting to session:', sessionId)
    const source = new EventSource(`/api/transcription/stream/${sessionId}`)
    eventSourceRef.current = source

    const segmentListener = (event: Event) => handleSegmentEvent(event as MessageEvent)
    const finalListener = (event: Event) => handleFinalEvent(event as MessageEvent)
    const errorListener = (event: Event) => handleStreamError(event)

    source.addEventListener("segment", segmentListener)
    source.addEventListener("final", finalListener)
    source.addEventListener("error", errorListener)

    return () => {
      debugLog('[EventSource] Cleanup: closing connection for session:', sessionId)
      source.removeEventListener("segment", segmentListener)
      source.removeEventListener("final", finalListener)
      source.removeEventListener("error", errorListener)
      source.close()
      if (eventSourceRef.current === source) {
        eventSourceRef.current = null
      }
    }
  }, [handleFinalEvent, handleSegmentEvent, handleStreamError, sessionId])
  
  // Cleanup EventSource on page unload/refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      debugLog('[BeforeUnload] Cleaning up EventSource')
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
    
    const handleVisibilityChange = () => {
      // If page becomes hidden and we're not actively recording, cleanup
      if (document.hidden && view.type !== 'recording') {
        debugLog('[VisibilityChange] Page hidden, cleaning up EventSource')
        if (eventSourceRef.current) {
          eventSourceRef.current.close()
          eventSourceRef.current = null
        }
      }
    }
    
    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [view.type])

  const startNewSession = useCallback((id: string) => {
    sessionIdRef.current = id
    setSessionId(id)
    resetQueue()
  }, [resetQueue])

  const handleStartNew = () => {
    setView({ type: "new-form" })
  }

  const handleCancelNew = () => {
    setView({ type: "idle" })
  }

  const handleStartRecording = async (data: {
    patient_name: string
    patient_id: string
    visit_reason: string
  }) => {
    try {
      cleanupSession()
      finalTranscriptRef.current = ""
      finalRecordingRef.current = null
      setTranscriptionStatus("pending")
      setNoteGenerationStatus("pending")

      const session = crypto.randomUUID()
      startNewSession(session)

      const encounter = await addEncounter({
        ...data,
        status: "recording",
        transcript_text: "",
        session_id: session,
      })

      currentEncounterIdRef.current = encounter.id
      await startRecording()
      setView({ type: "recording", encounterId: encounter.id })
      setTranscriptionStatus("in-progress")
    } catch (err) {
      debugError("Failed to start recording:", err)
      setTranscriptionStatus("failed")
    }
  }

  const uploadFinalRecording = useCallback(async (activeSessionId: string, blob: Blob, attempt = 1): Promise<void> => {
    try {
      const formData = new FormData()
      formData.append("session_id", activeSessionId)
      formData.append("file", blob, `${activeSessionId}-full.wav`)
      const response = await fetch("/api/transcription/final", {
        method: "POST",
        body: formData,
      })
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500
        if (retryable && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
          return uploadFinalRecording(activeSessionId, blob, attempt + 1)
        }
        let message = `Final upload failed (${response.status})`
        try {
          const body = (await response.json()) as { error?: { message?: string } }
          if (body?.error?.message) {
            message = body.error.message
          }
        } catch {
          // ignore
        }
        throw new Error(message)
      }
    } catch (error) {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
        return uploadFinalRecording(activeSessionId, blob, attempt + 1)
      }
      debugError("Failed to upload final recording:", error)
      setTranscriptionStatus("failed")
      throw error
    }
  }, [])

  const handleStopRecording = async () => {
    const encounter = currentEncounter
    if (!encounter) return

    const audioBlob = await stopRecording()
    if (!audioBlob) {
      setTranscriptionStatus("failed")
      return
    }

    finalRecordingRef.current = audioBlob

    await updateEncounter(encounter.id, {
      status: "processing",
      recording_duration: duration,
    })

    setView({ type: "processing", encounterId: encounter.id })

    const activeSessionId = sessionIdRef.current
    if (activeSessionId) {
      void uploadFinalRecording(activeSessionId, audioBlob)
    } else {
      debugError("Missing session identifier for final upload")
      setTranscriptionStatus("failed")
    }
  }

  const handleRetryTranscription = async () => {
    const blob = finalRecordingRef.current
    const activeSessionId = sessionIdRef.current
    if (!blob || !activeSessionId) return
    setTranscriptionStatus("in-progress")
    try {
      await uploadFinalRecording(activeSessionId, blob)
    } catch {
      // handled in uploadFinalRecording
    }
  }

  const handleRetryNoteGeneration = async () => {
    const transcript = finalTranscriptRef.current
    const encounterId = currentEncounter?.id
    if (!encounterId || !transcript) return
    await processEncounterForNoteGeneration(encounterId, transcript)
  }

  const currentEncounter = encounters.find((e: Encounter) => "encounterId" in view && e.id === view.encounterId)
  const selectedEncounter = view.type === "viewing" ? encounters.find((e: Encounter) => e.id === view.encounterId) : null

  const handleSelectEncounter = (encounter: Encounter) => {
    if (view.type === "recording") return
    setView({ type: "viewing", encounterId: encounter.id })
  }

  const handleSaveNote = async (noteText: string) => {
    if (!selectedEncounter) return
    await updateEncounter(selectedEncounter.id, { note_text: noteText })
  }

  const handleDeleteEncounter = async (encounterId: string) => {
    await removeEncounter(encounterId)
    if (currentEncounterIdRef.current === encounterId) {
      currentEncounterIdRef.current = null
    }
    setView((prev) => {
      if (
        (prev.type === "recording" || prev.type === "processing" || prev.type === "viewing") &&
        prev.encounterId === encounterId
      ) {
        return { type: "idle" }
      }
      return prev
    })
  }

  const renderMainContent = () => {
    switch (view.type) {
      case "idle":
        return <IdleView onStartNew={handleStartNew} />
      case "new-form":
        return (
          <div className="flex h-full items-center justify-center p-8">
            <NewEncounterForm onStart={handleStartRecording} onCancel={handleCancelNew} />
          </div>
        )
      case "recording":
        return (
          <div className="flex h-full items-center justify-center p-8">
            <RecordingView
              patientName={currentEncounter?.patient_name || ""}
              patientId={currentEncounter?.patient_id || ""}
              duration={duration}
              isPaused={isPaused}
              onStop={handleStopRecording}
              onPause={pauseRecording}
              onResume={resumeRecording}
            />
          </div>
        )
      case "processing":
        return (
          <div className="flex h-full items-center justify-center p-8">
            <ProcessingView
              patientName={currentEncounter?.patient_name || ""}
              transcriptionStatus={transcriptionStatus}
              noteGenerationStatus={noteGenerationStatus}
              onRetryTranscription={handleRetryTranscription}
              onRetryNoteGeneration={handleRetryNoteGeneration}
            />
          </div>
        )
      case "viewing":
        return selectedEncounter ? (
          <NoteEditor encounter={selectedEncounter} onSave={handleSaveNote} />
        ) : (
          <IdleView onStartNew={handleStartNew} />
        )
      default:
        return <IdleView onStartNew={handleStartNew} />
    }
  }

  return (
    <>
      {showPermissionsDialog && <PermissionsDialog onComplete={handlePermissionsComplete} />}
      <SettingsDialog
        isOpen={showSettingsDialog}
        onClose={handleCloseSettings}
        noteLength={noteLength}
        onNoteLengthChange={handleNoteLengthChange}
      />
      {httpsWarning && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-destructive px-4 py-2 text-center text-sm font-semibold text-destructive-foreground">
          {httpsWarning}
        </div>
      )}
      <div className="flex h-screen w-screen overflow-hidden bg-background">
        <div className="flex h-full w-72 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar">
          <EncounterList
            encounters={encounters}
            selectedId={view.type === "viewing" ? view.encounterId : null}
            onSelect={handleSelectEncounter}
            onNewEncounter={handleStartNew}
            onDeleteEncounter={handleDeleteEncounter}
            disabled={view.type === "recording"}
          />
          <SettingsBar onOpenSettings={handleOpenSettings} />
        </div>
        <main className="flex flex-1 flex-col overflow-hidden bg-background">
          {renderMainContent()}
        </main>
      </div>
    </>
  )
}

export default function HomePage() {
  return (
    <ErrorBoundary>
      <HomePageContent />
    </ErrorBoundary>
  )
}
