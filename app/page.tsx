"use client"

import { useState } from "react"
import { useEncounters } from "@/hooks/use-encounters"
import { useAudioRecorder } from "@/hooks/use-audio-recorder"
import { useApiKey } from "@/lib/api-key-context"
import type { Encounter } from "@/lib/types"
import { EncounterList } from "@/components/encounter-list"
import { IdleView } from "@/components/idle-view"
import { NewEncounterForm } from "@/components/new-encounter-form"
import { RecordingView } from "@/components/recording-view"
import { ProcessingView } from "@/components/processing-view"
import { NoteEditor } from "@/components/note-editor"
import { transcribeAudio, generateClinicalNote } from "@/app/actions"

type ViewState =
  | { type: "idle" }
  | { type: "new-form" }
  | { type: "recording"; encounterId: string }
  | { type: "processing"; encounterId: string }
  | { type: "viewing"; encounterId: string }

type StepStatus = "pending" | "in-progress" | "done" | "failed"

export default function HomePage() {
  const { encounters, addEncounter, updateEncounter } = useEncounters()
  const { apiKey, isConfigured } = useApiKey()
  const {
    isRecording,
    isPaused,
    duration,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    error: recordingError,
  } = useAudioRecorder()

  const [view, setView] = useState<ViewState>({ type: "idle" })
  const [transcriptionStatus, setTranscriptionStatus] = useState<StepStatus>("pending")
  const [noteGenerationStatus, setNoteGenerationStatus] = useState<StepStatus>("pending")

  const currentEncounter = encounters.find((e) => "encounterId" in view && e.id === view.encounterId)

  const selectedEncounter = view.type === "viewing" ? encounters.find((e) => e.id === view.encounterId) : null

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
      const encounter = await addEncounter({
        ...data,
        status: "recording",
      })
      await startRecording()
      setView({ type: "recording", encounterId: encounter.id })
    } catch (err) {
      console.error("Failed to start recording:", err)
    }
  }

  const handleStopRecording = async () => {
    if (!currentEncounter) return

    const audioBlob = await stopRecording()
    if (!audioBlob) return

    await updateEncounter(currentEncounter.id, {
      status: "processing",
      recording_duration: duration,
      audio_blob: audioBlob,
    })

    setView({ type: "processing", encounterId: currentEncounter.id })
    setTranscriptionStatus("pending")
    setNoteGenerationStatus("pending")

    // Start processing
    await processEncounter(currentEncounter.id, audioBlob)
  }

  const processEncounter = async (encounterId: string, audioBlob: Blob) => {
    const enc = encounters.find((e) => e.id === encounterId)

    // Transcription
    setTranscriptionStatus("in-progress")
    let transcript: string
    try {
      transcript = await transcribeAudio(audioBlob, apiKey)
      await updateEncounter(encounterId, { transcript_text: transcript })
      setTranscriptionStatus("done")
    } catch (err) {
      console.error("Transcription failed:", err)
      setTranscriptionStatus("failed")
      await updateEncounter(encounterId, { status: "transcription_failed" })
      return
    }

    // Note generation
    setNoteGenerationStatus("in-progress")
    try {
      const note = await generateClinicalNote({
        transcript,
        patient_name: enc?.patient_name || "",
        visit_reason: enc?.visit_reason || "",
        apiKey,
      })
      await updateEncounter(encounterId, {
        note_text: note,
        status: "completed",
      })
      setNoteGenerationStatus("done")

      // Switch to viewing mode after short delay
      setTimeout(() => {
        setView({ type: "viewing", encounterId })
      }, 1000)
    } catch (err) {
      console.error("Note generation failed:", err)
      setNoteGenerationStatus("failed")
      await updateEncounter(encounterId, { status: "note_generation_failed" })
    }
  }

  const handleSelectEncounter = (encounter: Encounter) => {
    if (view.type === "recording") return
    setView({ type: "viewing", encounterId: encounter.id })
  }

  const handleSaveNote = async (noteText: string) => {
    if (!selectedEncounter) return
    await updateEncounter(selectedEncounter.id, { note_text: noteText })
  }

  const handleRetryTranscription = async () => {
    if (!currentEncounter?.audio_blob) return
    await processEncounter(currentEncounter.id, currentEncounter.audio_blob)
  }

  const renderMainContent = () => {
    switch (view.type) {
      case "idle":
        return <IdleView onStartNew={handleStartNew} isApiKeyConfigured={isConfigured} />

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
            />
          </div>
        )

      case "viewing":
        return selectedEncounter ? (
          <NoteEditor encounter={selectedEncounter} onSave={handleSaveNote} />
        ) : (
          <IdleView onStartNew={handleStartNew} isApiKeyConfigured={isConfigured} />
        )

      default:
        return <IdleView onStartNew={handleStartNew} isApiKeyConfigured={isConfigured} />
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Left sidebar - encounter list */}
      <div className="w-72 shrink-0 border-r border-sidebar-border bg-sidebar">
        <EncounterList
          encounters={encounters}
          selectedId={view.type === "viewing" ? view.encounterId : null}
          onSelect={handleSelectEncounter}
          onNewEncounter={handleStartNew}
          disabled={view.type === "recording"}
        />
      </div>

      {/* Right side - main content */}
      <main className="flex flex-1 flex-col overflow-hidden bg-background">{renderMainContent()}</main>
    </div>
  )
}
