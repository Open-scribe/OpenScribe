"use client"

import { useEffect, useState } from "react"
import { Mic, Monitor, Check } from "lucide-react"
import { Button } from "@ui/lib/ui/button"

interface PermissionsDialogProps {
  onComplete: () => void
}

export function PermissionsDialog({ onComplete }: PermissionsDialogProps) {
  const [microphoneGranted, setMicrophoneGranted] = useState(false)
  const [screenGranted, setScreenGranted] = useState(false)
  const [initialCheckDone, setInitialCheckDone] = useState(false)

  useEffect(() => {
    const checkPermissions = async () => {
      try {
        let micGranted = false
        let screenGranted = false
        
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
            micGranted = micStatus === "granted"
            screenGranted = systemAudioAvailable
          } catch (error) {
            console.error("Desktop API permission check failed:", error)
          }
        } else {
          console.log("Desktop API not available, window.desktop:", window.desktop)
        }
        
        // Always check browser permissions as fallback for microphone
        if (!micGranted) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices()
            const hasAudioInput = devices.some((device) => device.kind === "audioinput")
            if (hasAudioInput) {
              // Try to get actual permission status
              const result = await navigator.permissions.query({ name: "microphone" as PermissionName })
              console.log("Browser microphone permission:", result.state)
              micGranted = result.state === "granted"
            }
          } catch (err) {
            // Permissions API not available, will need user interaction
            console.log("Browser permissions API not available:", err)
          }
        }
        
        console.log("Final permission states:", { microphone: micGranted, screen: screenGranted })
        setMicrophoneGranted(micGranted)
        setScreenGranted(screenGranted)
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
  }, [])

  const handleEnableMicrophone = async () => {
    try {
      // First try to request permissions through the desktop API
      const desktop = window.desktop
      if (desktop?.requestMediaPermissions) {
        const result = await desktop.requestMediaPermissions()
        if (result.microphoneGranted) {
          setMicrophoneGranted(true)
          return
        }
      }
      
      // If that doesn't work, try browser permissions
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true })
        setMicrophoneGranted(true)
      } catch {
        // If browser permission fails, open system settings
        if (window.desktop?.openScreenPermissionSettings) {
          await window.desktop.openScreenPermissionSettings()
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
              <Button
                onClick={handleEnableMicrophone}
                className="rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                size="sm"
              >
                <Mic className="mr-2 h-4 w-4" />
                Enable microphone
              </Button>
            )}
          </div>

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
