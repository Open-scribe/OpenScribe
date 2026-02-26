"use client"

declare global {
  interface DesktopScreenSource {
    id: string
    name: string
    displayId?: string
  }

  interface DesktopAPI {
    getPrimaryScreenSource?: () => Promise<DesktopScreenSource | null>
  }
}

type ChromeDesktopCaptureConstraints = MediaTrackConstraints & {
  mandatory?: {
    chromeMediaSource: "desktop"
    chromeMediaSourceId?: string
    maxWidth?: number
    maxHeight?: number
    [key: string]: string | number | boolean | undefined
  }
}

function buildDesktopCaptureConstraints(sourceId: string) {
  const baseConstraints: ChromeDesktopCaptureConstraints = {
    mandatory: {
      chromeMediaSource: "desktop",
      chromeMediaSourceId: sourceId,
    },
  }

  return {
    audio: baseConstraints,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxWidth: 160,
        maxHeight: 90,
      },
    } as ChromeDesktopCaptureConstraints,
  }
}

export async function getPrimaryDesktopSource(): Promise<DesktopScreenSource | null> {
  if (typeof window === "undefined") return null
  try {
    const source = await window.desktop?.getPrimaryScreenSource?.()
    return source ?? null
  } catch (error) {
    console.error("Failed to get desktop capture source", error)
    return null
  }
}

export async function requestSystemAudioStream(): Promise<{ stream: MediaStream; source: DesktopScreenSource } | null> {
  if (typeof navigator === "undefined" || typeof window === "undefined") return null
  if (!navigator.mediaDevices?.getUserMedia) return null
  const source = await getPrimaryDesktopSource()
  if (!source) return null
  const constraints = buildDesktopCaptureConstraints(source.id)
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints)
    return { stream, source }
  } catch (error) {
    console.warn("System audio capture unavailable", error)
    return null
  }
}

export async function warmupSystemAudioPermission(): Promise<boolean> {
  const capture = await requestSystemAudioStream()
  if (!capture) return false
  capture.stream.getTracks().forEach((track) => track.stop())
  return true
}

export async function warmupMicrophonePermission(): Promise<boolean> {
  if (typeof navigator === "undefined") return false
  if (!navigator.mediaDevices?.getUserMedia) return false
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
    return true
  } catch (error) {
    console.warn("Microphone permission request failed", error)
    return false
  }
}
