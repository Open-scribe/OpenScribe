export {}

type MediaAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown"
type MicrophoneReadinessResult = {
  success: boolean
  code?: string
  userMessage?: string
  metrics?: {
    rms: number
    peak: number
  }
  activeDeviceId?: string
}

declare global {
  interface DesktopScreenSource {
    id: string
    name: string
    displayId?: string
  }

  interface DesktopAPI {
    versions: NodeJS.ProcessVersions
    requestMediaPermissions?: () => Promise<{ microphoneGranted: boolean; screenStatus: MediaAccessStatus }>
    getMediaAccessStatus?: (mediaType: "microphone" | "camera" | "screen") => Promise<MediaAccessStatus>
    openMicrophonePermissionSettings?: () => Promise<boolean> | boolean
    openScreenPermissionSettings?: () => Promise<boolean> | boolean
    getPrimaryScreenSource?: () => Promise<DesktopScreenSource | null>
    checkMicrophoneReadiness?: (preferredDeviceId?: string) => Promise<MicrophoneReadinessResult>
    secureStorage?: {
      isAvailable: () => Promise<boolean>
      encrypt: (plaintext: string) => Promise<string>
      decrypt: (encryptedBase64: string) => Promise<string>
      generateKey: () => Promise<string>
    }
    auditLog?: {
      writeEntry: (entry: unknown) => Promise<{ success: boolean; error?: string }>
      readEntries: (filter?: unknown) => Promise<unknown[]>
      exportLog: (options: { data: string; filename: string }) => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>
    }
    openscribeBackend?: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, listener: (...args: unknown[]) => void) => void
      removeAllListeners: (channel: string) => void
    }
  }

  interface Window {
    desktop?: DesktopAPI
    __openscribePermissionsPrimed?: boolean
  }
}
