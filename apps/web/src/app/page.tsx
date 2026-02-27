"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { createPipelineError, toPipelineError, type PipelineError } from "@pipeline-errors"
import type { Encounter } from "@storage/types"
import { useEncounters, EncounterList, IdleView, NewEncounterForm, RecordingView, ProcessingView, ErrorBoundary, PermissionsDialog, SettingsDialog, SettingsBar, ModelIndicator, useHttpsWarning } from "@ui"
import { NoteEditor } from "@note-rendering"
import { useAudioRecorder, type RecordedSegment, warmupMicrophonePermission, warmupSystemAudioPermission } from "@audio"
import { useSegmentUpload, type UploadError } from "@transcription";
import { WorkflowErrorDisplay } from "./workflow-error-display"
import { generateClinicalNote } from "@/app/actions"
import {
  getPreferences,
  setPreferences,
  type NoteLength,
  type ProcessingMode,
  debugLog,
  debugLogPHI,
  debugError,
  debugWarn,
  initializeAuditLog,
} from "@storage"

type ViewState =
  | { type: "idle" }
  | { type: "new-form" }
  | { type: "recording"; encounterId: string }
  | { type: "processing"; encounterId: string }
  | { type: "viewing"; encounterId: string }

type StepStatus = "pending" | "in-progress" | "done" | "failed"
type ProcessingMetrics = {
  processingStartedAt?: number
  processingEndedAt?: number
  transcriptionStartedAt?: number
  transcriptionEndedAt?: number
  noteGenerationStartedAt?: number
  noteGenerationEndedAt?: number
}

const SEGMENT_DURATION_MS = 10000
const OVERLAP_MS = 250

type BackendProcessingEvent = {
  success?: boolean
  sessionName?: string
  message?: string
  error?: string
  meetingData?: {
    session_info?: {
      name?: string
      summary_file?: string
      transcript_file?: string
      duration_seconds?: number
      duration_minutes?: number
      note_type?: string
    }
    summary?: string
    participants?: string[]
    key_points?: string[]
    action_items?: string[]
    clinical_note?: string
    transcript?: string
  }
}

function templateForVisitReason(visitReason?: string): "default" | "soap" {
  if (!visitReason) return "default"
  const normalized = visitReason.toLowerCase()
  if (normalized === "problem_visit" || normalized === "soap") return "soap"
  return "default"
}

function resolveApiBaseUrl(): string {
  if (typeof window === "undefined") return ""
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim()
  if (configured) {
    return configured.replace(/\/+$/, "")
  }
  const origin = window.location?.origin
  if (origin && origin !== "null") {
    return origin
  }
  return "http://localhost:3001"
}

function HomePageContent() {
  const { encounters, addEncounter, updateEncounter, deleteEncounter: removeEncounter, refresh } = useEncounters()
  
  // HIPAA Compliance: Warn if production build is served over HTTP
  const httpsWarning = useHttpsWarning()

  const [view, setView] = useState<ViewState>({ type: "idle" })
  const [transcriptionStatus, setTranscriptionStatus] = useState<StepStatus>("pending")
  const [noteGenerationStatus, setNoteGenerationStatus] = useState<StepStatus>("pending")
  const [, setProcessingMetrics] = useState<ProcessingMetrics>({})
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [workflowError, setWorkflowError] = useState<PipelineError | null>(null)

  const currentEncounterIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const finalTranscriptRef = useRef<string>("")
  const finalRecordingRef = useRef<Blob | null>(null)
  const apiBaseUrlRef = useRef<string>(resolveApiBaseUrl())
  const lastMeetingDataRef = useRef<BackendProcessingEvent["meetingData"] | null>(null)

  const [showPermissionsDialog, setShowPermissionsDialog] = useState(false)
  const permissionCheckInProgressRef = useRef(false)

  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [noteLength, setNoteLengthState] = useState<NoteLength>("long")
  const [processingMode, setProcessingModeState] = useState<ProcessingMode>("mixed")
  const [localBackendAvailable, setLocalBackendAvailable] = useState(false)
  const [localDurationMs, setLocalDurationMs] = useState(0)
  const [localPaused, setLocalPaused] = useState(false)
  const localSessionNameRef = useRef<string | null>(null)
  const localBackendRef = useRef<Window["desktop"]["openscribeBackend"] | null>(null)
  const localLastTickRef = useRef<number | null>(null)

  useEffect(() => {
    const prefs = getPreferences()
    setNoteLengthState(prefs.noteLength)
    setProcessingModeState(prefs.processingMode)

    // Initialize audit logging system (cleanup old entries, setup periodic cleanup)
    void initializeAuditLog()
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const backend = window.desktop?.openscribeBackend
    localBackendRef.current = backend ?? null
    setLocalBackendAvailable(!!backend)
  }, [])

  useEffect(() => {
    if (processingMode !== "local") return
    if (localBackendAvailable) return
    debugWarn("Local-only mode selected but desktop backend is unavailable; falling back to mixed mode")
    setProcessingModeState("mixed")
    void setPreferences({ processingMode: "mixed" })
  }, [localBackendAvailable, processingMode])

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

  const handleProcessingModeChange = (mode: ProcessingMode) => {
    setProcessingModeState(mode)
    setPreferences({ processingMode: mode })
  }

  const useLocalBackend = processingMode === "local" && localBackendAvailable

  const handleUploadError = useCallback((error: UploadError) => {
    setWorkflowError(error)
    setTranscriptionStatus("failed")
    setProcessingMetrics((prev) => ({
      ...prev,
      transcriptionEndedAt: prev.transcriptionEndedAt ?? Date.now(),
      processingEndedAt: Date.now(),
    }))
    debugError("Segment upload failed:", error.code, "-", error.message);
  }, []);

  const { enqueueSegment, resetQueue } = useSegmentUpload(sessionId, {
    onError: handleUploadError,
    apiBaseUrl: apiBaseUrlRef.current || undefined,
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

  const buildNoteFromMeeting = useCallback((meeting: BackendProcessingEvent["meetingData"], visitReason?: string) => {
    if (!meeting) return ""
    if (meeting.clinical_note && meeting.clinical_note.trim()) return meeting.clinical_note

    const summary = meeting.summary || ""
    const keyPoints = meeting.key_points || []
    const actionItems = meeting.action_items || []
    const templateName = templateForVisitReason(visitReason || meeting.session_info?.note_type)

    if (templateName === "soap") {
      return [
        "# SOAP Note",
        "",
        "## Subjective",
        "### Chief Complaint",
        "",
        "### History of Present Illness",
        summary || "",
        "",
        "### Review of Systems",
        "",
        "## Objective",
        "### Physical Examination",
        "",
        "## Assessment",
        keyPoints.length ? keyPoints.map((p) => `- ${p}`).join("\n") : "",
        "",
        "## Plan",
        actionItems.length ? actionItems.map((p) => `- ${p}`).join("\n") : "",
      ].join("\n")
    }

    return [
      "# Clinical Note",
      "",
      "## Chief Complaint",
      "",
      "## History of Present Illness",
      summary || "",
      "",
      "## Review of Systems",
      "",
      "## Physical Exam",
      "",
      "## Assessment",
      keyPoints.length ? keyPoints.map((p) => `- ${p}`).join("\n") : "",
      "",
      "## Plan",
      actionItems.length ? actionItems.map((p) => `- ${p}`).join("\n") : "",
    ].join("\n")
  }, [])

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
      setWorkflowError(recordingError)
      debugError("Recording error:", recordingError.message)
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
      const template = templateForVisitReason(visitReason)

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
      setProcessingMetrics((prev) => ({
        ...prev,
        transcriptionEndedAt: prev.transcriptionEndedAt ?? Date.now(),
        noteGenerationStartedAt: prev.noteGenerationStartedAt ?? Date.now(),
      }))
      try {
        const note = await generateClinicalNote({
          transcript,
          patient_name: patientName,
          visit_reason: visitReason,
          noteLength: noteLengthRef.current,
          template,
        })
        await updateEncounterRef.current(encounterId, {
          note_text: note,
          status: "completed",
        })
        await refreshRef.current()
        setNoteGenerationStatus("done")
        setWorkflowError(null)
        setProcessingMetrics((prev) => ({
          ...prev,
          noteGenerationEndedAt: Date.now(),
          processingEndedAt: Date.now(),
        }))
        debugLog("✅ Clinical note saved to encounter")
        debugLog("\n" + "=".repeat(80))
        debugLog("ENCOUNTER PROCESSING COMPLETE")
        debugLog("=".repeat(80) + "\n")
        setView({ type: "viewing", encounterId })
      } catch (err) {
        debugError("❌ Note generation failed:", err)
        setWorkflowError(
          toPipelineError(err, {
            code: "note_generation_error",
            message: "Failed to generate clinical note",
            recoverable: true,
          }),
        )
        setNoteGenerationStatus("failed")
        setProcessingMetrics((prev) => ({
          ...prev,
          noteGenerationEndedAt: Date.now(),
          processingEndedAt: Date.now(),
        }))
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
        setProcessingMetrics((prev) => ({
          ...prev,
          transcriptionEndedAt: prev.transcriptionEndedAt ?? Date.now(),
        }))
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
    const readyState = eventSourceRef.current?.readyState
    debugError("Transcription stream error", { event, readyState, apiBaseUrl: apiBaseUrlRef.current })
    setWorkflowError(
      createPipelineError("network_error", "Lost connection to transcription stream", true, {
        readyState,
      }),
    )
    setTranscriptionStatus("failed")
    setProcessingMetrics((prev) => ({
      ...prev,
      transcriptionEndedAt: prev.transcriptionEndedAt ?? Date.now(),
      processingEndedAt: Date.now(),
    }))
  }, [])

  useEffect(() => {
    if (!sessionId || useLocalBackend) return
    
    debugLog('[EventSource] Connecting to session:', sessionId)
    const baseUrl = apiBaseUrlRef.current
    const streamUrl = baseUrl
      ? `${baseUrl.replace(/\/+$/, "")}/api/transcription/stream/${sessionId}`
      : `/api/transcription/stream/${sessionId}`
    const source = new EventSource(streamUrl)
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
  }, [handleFinalEvent, handleSegmentEvent, handleStreamError, sessionId, useLocalBackend])
  
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
      if (!useLocalBackend) {
        cleanupSession()
      }
      finalTranscriptRef.current = ""
      finalRecordingRef.current = null
      setTranscriptionStatus("pending")
      setNoteGenerationStatus("pending")
      setProcessingMetrics({})

      const session = crypto.randomUUID()
      if (!useLocalBackend) {
        startNewSession(session)
      }

      const encounter = await addEncounter({
        ...data,
        status: "recording",
        transcript_text: "",
        session_id: session,
      })

      currentEncounterIdRef.current = encounter.id
      // Optimistically flip to recording immediately for responsive UI.
      setView({ type: "recording", encounterId: encounter.id })
      setTranscriptionStatus("in-progress")
      setWorkflowError(null)
      if (!useLocalBackend && localBackendRef.current) {
        const whisperReady = await localBackendRef.current.invoke("ensure-whisper-service")
        if (!(whisperReady as { success?: boolean }).success) {
          throw new Error((whisperReady as { error?: string }).error || "Whisper service unavailable")
        }
      }

      if (useLocalBackend && localBackendRef.current) {
        const sessionName = `OpenScribe ${encounter.id}`
        localSessionNameRef.current = sessionName
        setLocalDurationMs(0)
        setLocalPaused(false)
        localLastTickRef.current = Date.now()
        await localBackendRef.current.invoke("start-recording-ui", sessionName, data.visit_reason)
      } else {
        await startRecording()
      }
    } catch (err) {
      debugError("Failed to start recording:", err)
      setWorkflowError(
        toPipelineError(err, {
          code: "capture_error",
          message: "Failed to start recording",
          recoverable: true,
        }),
      )
      setTranscriptionStatus("failed")
      setView({ type: "idle" })
    }
  }

  const uploadFinalRecording = useCallback(async (activeSessionId: string, blob: Blob, attempt = 1): Promise<void> => {
    try {
      const formData = new FormData()
      formData.append("session_id", activeSessionId)
      formData.append("file", blob, `${activeSessionId}-full.wav`)
      const baseUrl = apiBaseUrlRef.current
      const url = baseUrl
        ? `${baseUrl.replace(/\/+$/, "")}/api/transcription/final`
        : "/api/transcription/final"
      const response = await fetch(url, {
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
          const body = (await response.json()) as { error?: PipelineError }
          if (body?.error?.message) {
            message = body.error.message
          }
          if (body?.error) {
            setWorkflowError(body.error)
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
      setWorkflowError(
        toPipelineError(error, {
          code: "api_error",
          message: "Failed to upload final recording",
          recoverable: true,
        }),
      )
      setTranscriptionStatus("failed")
      throw error
    }
  }, [])

  const handleStopRecording = async () => {
    const encounter = currentEncounter
    if (!encounter) return

    await updateEncounter(encounter.id, {
      status: "processing",
      recording_duration: duration,
    })

    setView({ type: "processing", encounterId: encounter.id })
    setProcessingMetrics({
      processingStartedAt: Date.now(),
      transcriptionStartedAt: Date.now(),
    })

    if (useLocalBackend && localBackendRef.current) {
      // Local backend processes in sequence (transcription -> note generation).
      // Keep note generation pending until backend emits stage updates.
      setTranscriptionStatus("in-progress")
      setNoteGenerationStatus("pending")
      await localBackendRef.current.invoke("stop-recording-ui")
      localLastTickRef.current = null
      setLocalPaused(false)
      return
    }

    const audioBlob = await stopRecording()
    if (!audioBlob) {
      setWorkflowError(
        createPipelineError("processing_error", "Failed to finalize recording", true, { stage: "audio-ingest" }),
      )
      setTranscriptionStatus("failed")
      return
    }

    finalRecordingRef.current = audioBlob

    const activeSessionId = sessionIdRef.current
    if (activeSessionId) {
      void uploadFinalRecording(activeSessionId, audioBlob)
    } else {
      debugError("Missing session identifier for final upload")
      setWorkflowError(createPipelineError("capture_error", "Missing session identifier for final upload", true))
      setTranscriptionStatus("failed")
    }
  }

  const handlePauseRecording = async () => {
    if (useLocalBackend && localBackendRef.current) {
      await localBackendRef.current.invoke("pause-recording-ui")
      setLocalPaused(true)
      return
    }
    await pauseRecording()
  }

  const handleResumeRecording = async () => {
    if (useLocalBackend && localBackendRef.current) {
      await localBackendRef.current.invoke("resume-recording-ui")
      setLocalPaused(false)
      localLastTickRef.current = Date.now()
      return
    }
    await resumeRecording()
  }

  const handleRetryTranscription = async () => {
    if (useLocalBackend && localBackendRef.current) {
      const meeting = lastMeetingDataRef.current
      const summaryFile = meeting?.session_info?.summary_file as string | undefined
      if (!summaryFile) {
        setWorkflowError(createPipelineError("storage_error", "Unable to find meeting summary for retry", false))
        setTranscriptionStatus("failed")
        return
      }
      setWorkflowError(null)
      setTranscriptionStatus("in-progress")
      setNoteGenerationStatus("pending")
      setProcessingMetrics({
        processingStartedAt: Date.now(),
        transcriptionStartedAt: Date.now(),
      })
      try {
        await localBackendRef.current.invoke("reprocess-meeting", summaryFile)
        const result = await localBackendRef.current.invoke("list-meetings")
        const parsed = result as { success?: boolean; meetings?: BackendProcessingEvent["meetingData"][] }
        const refreshed = parsed?.meetings?.find((m) => m?.session_info?.summary_file === summaryFile)
        if (refreshed && currentEncounterIdRef.current) {
          lastMeetingDataRef.current = refreshed
          const transcript = refreshed.transcript || ""
          const encounter = encountersRef.current.find((e: Encounter) => e.id === currentEncounterIdRef.current)
          const noteText = buildNoteFromMeeting(refreshed, encounter?.visit_reason)
          await updateEncounterRef.current(currentEncounterIdRef.current, {
            status: "completed",
            transcript_text: transcript,
            note_text: noteText,
          })
          setTranscriptionStatus("done")
          setNoteGenerationStatus("done")
          setProcessingMetrics((prev) => ({
            ...prev,
            transcriptionEndedAt: prev.transcriptionEndedAt ?? Date.now(),
            noteGenerationStartedAt: prev.noteGenerationStartedAt ?? Date.now(),
            noteGenerationEndedAt: Date.now(),
            processingEndedAt: Date.now(),
          }))
          setView({ type: "viewing", encounterId: currentEncounterIdRef.current })
        } else {
          setTranscriptionStatus("failed")
          setNoteGenerationStatus("failed")
          setProcessingMetrics((prev) => ({
            ...prev,
            transcriptionEndedAt: prev.transcriptionEndedAt ?? Date.now(),
            processingEndedAt: Date.now(),
          }))
        }
      } catch (error) {
        setWorkflowError(
          toPipelineError(error, {
            code: "transcription_error",
            message: "Failed to retry transcription",
            recoverable: true,
          }),
        )
        setTranscriptionStatus("failed")
        setNoteGenerationStatus("failed")
        setProcessingMetrics((prev) => ({
          ...prev,
          transcriptionEndedAt: prev.transcriptionEndedAt ?? Date.now(),
          processingEndedAt: Date.now(),
        }))
      }
      return
    }

    const blob = finalRecordingRef.current
    const activeSessionId = sessionIdRef.current
    if (!blob || !activeSessionId) return
    setTranscriptionStatus("in-progress")
    setWorkflowError(null)
    try {
      await uploadFinalRecording(activeSessionId, blob)
    } catch {
      // handled in uploadFinalRecording
    }
  }

  const handleRetryNoteGeneration = async () => {
    if (useLocalBackend) {
      return
    }
    const transcript = finalTranscriptRef.current
    const encounterId = currentEncounter?.id
    if (!encounterId || !transcript) return
    setWorkflowError(null)
    setProcessingMetrics((prev) => ({
      ...prev,
      noteGenerationStartedAt: Date.now(),
      noteGenerationEndedAt: undefined,
      processingEndedAt: undefined,
    }))
    await processEncounterForNoteGeneration(encounterId, transcript)
  }

  useEffect(() => {
    if (!useLocalBackend || !localBackendRef.current) return

    const backend = localBackendRef.current
    const stageHandler = (_event: unknown, payload: unknown) => {
      const data = payload as {
        stage?: string
        status?: StepStatus
        startedAtMs?: number
        endedAtMs?: number
        durationMs?: number
      }
      const stageTs = data?.startedAtMs || Date.now()
      if (data?.stage === "transcription" && data.status === "in-progress") {
        setTranscriptionStatus("in-progress")
        setNoteGenerationStatus("pending")
        setProcessingMetrics((prev) => ({
          ...prev,
          processingStartedAt: prev.processingStartedAt ?? stageTs,
          transcriptionStartedAt: prev.transcriptionStartedAt ?? stageTs,
        }))
        return
      }
      if (data?.stage === "transcription" && data.status === "done") {
        const endedAt = data.endedAtMs || Date.now()
        const duration = typeof data.durationMs === "number" ? data.durationMs : undefined
        setTranscriptionStatus("done")
        setProcessingMetrics((prev) => ({
          ...prev,
          processingStartedAt: prev.processingStartedAt ?? (duration ? endedAt - duration : endedAt),
          transcriptionStartedAt: prev.transcriptionStartedAt ?? (duration ? endedAt - duration : endedAt),
          transcriptionEndedAt: endedAt,
        }))
        return
      }
      if (data?.stage === "note_generation" && data.status === "in-progress") {
        setTranscriptionStatus("done")
        setNoteGenerationStatus("in-progress")
        setProcessingMetrics((prev) => ({
          ...prev,
          transcriptionEndedAt: prev.transcriptionEndedAt ?? stageTs,
          noteGenerationStartedAt: prev.noteGenerationStartedAt ?? stageTs,
        }))
        return
      }
      if (data?.stage === "note_generation" && data.status === "done") {
        const endedAt = data.endedAtMs || Date.now()
        const duration = typeof data.durationMs === "number" ? data.durationMs : undefined
        setNoteGenerationStatus("done")
        setProcessingMetrics((prev) => ({
          ...prev,
          noteGenerationStartedAt: prev.noteGenerationStartedAt ?? (duration ? endedAt - duration : endedAt),
          noteGenerationEndedAt: endedAt,
        }))
      }
    }

    const handler = async (_event: unknown, payload: unknown) => {
      const data = payload as BackendProcessingEvent
      const encounterId = currentEncounterIdRef.current
      if (!encounterId) return

      if (!data.success) {
        setWorkflowError(
          createPipelineError("transcription_error", data.error || "Transcription failed", true, {
            stage: "transcription",
          }),
        )
        setTranscriptionStatus("failed")
        setNoteGenerationStatus("failed")
        setProcessingMetrics((prev) => ({
          ...prev,
          transcriptionEndedAt: prev.transcriptionEndedAt ?? Date.now(),
          processingEndedAt: Date.now(),
        }))
        await updateEncounterRef.current(encounterId, { status: "transcription_failed" })
        return
      }

      const meeting = data.meetingData
      lastMeetingDataRef.current = meeting ?? null
      const transcript = meeting?.transcript || ""
      const encounter = encountersRef.current.find((e: Encounter) => e.id === encounterId)
      const noteText = buildNoteFromMeeting(meeting, encounter?.visit_reason)
      const durationSeconds = meeting?.session_info?.duration_seconds

      finalTranscriptRef.current = transcript

      await updateEncounterRef.current(encounterId, {
        status: "completed",
        transcript_text: transcript,
        note_text: noteText,
        recording_duration: durationSeconds ? Math.round(durationSeconds / 1000) : duration,
      })

      setTranscriptionStatus("done")
      setNoteGenerationStatus("done")
      setWorkflowError(null)
      setProcessingMetrics((prev) => ({
        ...prev,
        transcriptionEndedAt: prev.transcriptionEndedAt ?? Date.now(),
        noteGenerationStartedAt: prev.noteGenerationStartedAt ?? Date.now(),
        noteGenerationEndedAt: Date.now(),
        processingEndedAt: Date.now(),
      }))
      setView({ type: "viewing", encounterId })
    }

    backend.on("processing-stage", stageHandler)
    backend.on("processing-complete", handler)
    return () => {
      backend.removeAllListeners("processing-stage")
      backend.removeAllListeners("processing-complete")
    }
  }, [buildNoteFromMeeting, duration, useLocalBackend])

  useEffect(() => {
    if (!useLocalBackend || view.type !== "recording") return
    const tick = () => {
      const now = Date.now()
      if (localLastTickRef.current && !localPaused) {
        setLocalDurationMs((prev) => prev + (now - localLastTickRef.current!))
      }
      localLastTickRef.current = now
    }
    tick()
    const interval = window.setInterval(tick, 250)
    return () => window.clearInterval(interval)
  }, [useLocalBackend, localPaused, view.type])

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
              duration={useLocalBackend ? Math.floor(localDurationMs / 1000) : duration}
              isPaused={useLocalBackend ? localPaused : isPaused}
              onStop={handleStopRecording}
              onPause={handlePauseRecording}
              onResume={handleResumeRecording}
            />
          </div>
        )
      case "processing": {
        const retryAction = noteGenerationStatus === "failed" ? handleRetryNoteGeneration : handleRetryTranscription
        return (
          <div className="flex h-full items-center justify-center p-8">
            <div className="flex w-full flex-col items-center">
              {workflowError && <WorkflowErrorDisplay error={workflowError} onRetry={workflowError.recoverable ? retryAction : undefined} />}
              <ProcessingView
                patientName={currentEncounter?.patient_name || ""}
                transcriptionStatus={transcriptionStatus}
                noteGenerationStatus={noteGenerationStatus}
                onRetryTranscription={handleRetryTranscription}
                onRetryNoteGeneration={handleRetryNoteGeneration}
              />
            </div>
          </div>
        )
      }
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
        processingMode={processingMode}
        onProcessingModeChange={handleProcessingModeChange}
        localBackendAvailable={localBackendAvailable}
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
          <ModelIndicator processingMode={processingMode} />
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
