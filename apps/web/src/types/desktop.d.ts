export {}

type MediaAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown"

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
    openScreenPermissionSettings?: () => Promise<boolean> | boolean
    getPrimaryScreenSource?: () => Promise<DesktopScreenSource | null>
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
  }

  interface Window {
    desktop?: DesktopAPI
    __openscribePermissionsPrimed?: boolean
  }
}
