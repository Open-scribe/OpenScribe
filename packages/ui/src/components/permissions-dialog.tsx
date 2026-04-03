"use client"

import { useEffect, useState } from "react"
import { Mic, Monitor, Check } from "lucide-react"
import { Button } from "@ui/lib/ui/button"

interface PermissionsDialogProps {
  onComplete: () => void
  preferredInputDeviceId?: string
}

export function PermissionsDialog({ onComplete, preferredInputDeviceId }: PermissionsDialogProps) {
  const [microphoneGranted, setMicrophoneGranted] = useState(false)
  const [screenGranted, setScreenGranted] = useState(false)
  const [microphoneStatusMessage, setMicrophoneStatusMessage] = useState("")
  const [initialCheckDone, setInitialCheckDone] = useState(false)

  useEffect(() => {
    const checkPermissions = async () => {
      try {
        let micGranted = false
        let screenGranted = false
        let micMessage = ""
        
        const desktop = window.desktop
        console.log("Desktop object available:", !!desktop)
        console.log("Desktop API methods:", desktop ? Object.keys(desktop) : "none")
        
        if (desktop?.getMediaAccessStatus) {
          try {
            console.log("Calling getMediaAccessStatus for microphone...")
            const micStatus = await desktop.getMediaAccessStatus("microphone")
            console.log("Microphone status result:", micStatus)
            
            // System audio permission is implicitly granted when we can access the primary screen source
            // This is checked at capture time, not through system permissions
            console.log("Checking system audio capability...")
            const screenSource = await desktop.getPrimaryScreenSource?.()
            const systemAudioAvailable = screenSource !== null
            console.log("System audio available:", systemAudioAvailable, "Source:", screenSource)
            
            console.log("Desktop permissions:", { microphone: micStatus, systemAudio: systemAudioAvailable })
            screenGranted = systemAudioAvailable
            if (desktop.checkMicrophoneReadiness) {
              const readiness = await desktop.checkMicrophoneReadiness(preferredInputDeviceId || "")
              micGranted = !!readiness?.success
              micMessage = readiness?.userMessage || ""
            } else {
              micGranted = micStatus === "granted"
            }
          } catch (error) {
            console.error("Desktop API permission check failed:", error)
          }
        } else {
          console.log("Desktop API not available, window.desktop:", window.desktop)
        }

        console.log("Final permission states:", { microphone: micGranted, screen: screenGranted })
        setMicrophoneGranted(micGranted)
        setScreenGranted(screenGranted)
        setMicrophoneStatusMessage(micMessage)
        setInitialCheckDone(true)
      } catch (error) {
        console.error("Failed to check permissions", error)
        setInitialCheckDone(true)
      }
    }
    
    // Wait a bit for Electron to fully initialize before first check
    const initialTimeout = setTimeout(() => {
      void checkPermissions()
    }, 500)
    
    // Set up interval to periodically re-check permissions
    const intervalId = setInterval(() => {
      void checkPermissions()
    }, 2000)
    
    return () => {
      clearTimeout(initialTimeout)
      clearInterval(intervalId)
    }
  }, [preferredInputDeviceId])

  const handleEnableMicrophone = async () => {
    try {
      // First try to request permissions through the desktop API
      const desktop = window.desktop
      if (desktop?.requestMediaPermissions) {
        const result = await desktop.requestMediaPermissions()
        if (result.microphoneGranted && desktop.checkMicrophoneReadiness) {
          const readiness = await desktop.checkMicrophoneReadiness(preferredInputDeviceId || "")
          setMicrophoneGranted(!!readiness?.success)
          setMicrophoneStatusMessage(readiness?.userMessage || "")
          if (readiness?.success) return
        }
      }
      
      // If that doesn't work, try browser permissions
      try {
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: preferredInputDeviceId ? { deviceId: { exact: preferredInputDeviceId } } : true,
          })
        } catch (firstError) {
          const errorName = firstError instanceof Error ? firstError.name : ""
          if ((errorName === "NotFoundError" || errorName === "OverconstrainedError") && preferredInputDeviceId) {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          } else {
            throw firstError
          }
        }
        stream.getTracks().forEach((track) => track.stop())
        const readiness = await desktop?.checkMicrophoneReadiness?.(preferredInputDeviceId || "")
        setMicrophoneGranted(!!readiness?.success)
        setMicrophoneStatusMessage(readiness?.userMessage || "")
      } catch {
        // If browser permission fails, open microphone settings
        if (window.desktop?.openMicrophonePermissionSettings) {
          await window.desktop.openMicrophonePermissionSettings()
        }
      }
    } catch (error) {
      console.error("Failed to enable microphone", error)
    }
  }

  const handleEnableScreenRecording = async () => {
    try {
      const desktop = window.desktop
      if (desktop?.openScreenPermissionSettings) {
        await desktop.openScreenPermissionSettings()
      }
    } catch (error) {
      console.error("Failed to open screen recording settings", error)
    }
  }

  const canContinue = microphoneGranted

  if (!initialCheckDone) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="w-full max-w-xl rounded-2xl bg-background p-8 shadow-2xl border border-border">
          <div className="text-center">
            <p className="text-muted-foreground">Checking permissions...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl bg-background p-8 shadow-2xl border border-border">
        <div className="mb-6">
          <p className="mb-2 text-sm font-medium uppercase tracking-wide text-emerald-600">PERMISSIONS</p>
          <h2 className="text-2xl font-bold text-foreground">
            Allow the OpenScribe to capture clinical encounters
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            The scribe records audio directly from your device. Activation only when you enable it.
          </p>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          {/* Microphone Permission */}
          <div className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-accent/50">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <Mic className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="font-medium text-foreground">Transcribe my voice</span>
            </div>
            {microphoneGranted ? (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleEnableMicrophone}
                  className="rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                  size="sm"
                >
                  <Mic className="mr-2 h-4 w-4" />
                  Enable microphone
                </Button>
                <Button
                  onClick={() => window.desktop?.openMicrophonePermissionSettings?.()}
                  className="rounded-full"
                  size="sm"
                  variant="outline"
                >
                  Open Mic Settings
                </Button>
              </div>
            )}
          </div>
          {!microphoneGranted && microphoneStatusMessage && (
            <p className="px-3 text-xs text-muted-foreground">{microphoneStatusMessage}</p>
          )}

          {/* Screen Recording Permission */}
          <div className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-accent/50">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <Monitor className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="font-medium text-foreground">Transcribe other people&apos;s voices (optional)</span>
            </div>
            {screenGranted ? (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
            ) : (
              <Button
                onClick={handleEnableScreenRecording}
                className="rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                size="sm"
              >
                <Monitor className="mr-2 h-4 w-4" />
                Enable system audio
              </Button>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button
            onClick={onComplete}
            disabled={!canContinue}
            className="rounded-full bg-foreground px-6 text-background hover:bg-foreground/90 disabled:opacity-40"
          >
            Continue
          </Button>
        </div>
        {!screenGranted && (
          <p className="mt-2 text-xs text-muted-foreground">
            You can continue without system audio and enable it later for richer multi-speaker capture.
          </p>
        )}
      </div>
    </div>
  )
}
