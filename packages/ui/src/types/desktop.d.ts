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

  interface SecureStorageAPI {
    isAvailable: () => Promise<boolean>
    encrypt: (plaintext: string) => Promise<string>
    decrypt: (encryptedBase64: string) => Promise<string>
    generateKey: () => Promise<string>
  }

  interface DesktopAPI {
    versions: NodeJS.ProcessVersions
    requestMediaPermissions?: () => Promise<{ microphoneGranted: boolean; screenStatus: MediaAccessStatus }>
    getMediaAccessStatus?: (mediaType: "microphone" | "camera" | "screen") => Promise<MediaAccessStatus>
    openMicrophonePermissionSettings?: () => Promise<boolean> | boolean
    openScreenPermissionSettings?: () => Promise<boolean> | boolean
    getPrimaryScreenSource?: () => Promise<DesktopScreenSource | null>
    secureStorage?: SecureStorageAPI
    checkMicrophoneReadiness?: (preferredDeviceId?: string) => Promise<MicrophoneReadinessResult>
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
