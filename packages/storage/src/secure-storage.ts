const ENCODER = new TextEncoder()
const DECODER = new TextDecoder()
const KEY_ENV = (process.env.NEXT_PUBLIC_SECURE_STORAGE_KEY ?? "").trim()
const CURRENT_VERSION = "v2"
const LEGACY_VERSION = "v1"
const PREFIX_BASE = "enc"

let keyPromise: Promise<CryptoKey> | null = null
let electronKeyPromise: Promise<string | null> | null = null

/**
 * Get or generate the encryption key for this device.
 * Priority order:
 * 1. Electron safeStorage (HIPAA-compliant, OS keychain)
 * 2. localStorage (for migration from v1)
 * 3. Generate new key and store via safeStorage
 */
async function getOrGenerateDeviceKey(): Promise<string> {
  // In Electron context, use safeStorage
  if (typeof window !== "undefined" && window.desktop?.secureStorage) {
    if (!electronKeyPromise) {
      electronKeyPromise = (async () => {
        const STORAGE_KEY = "openscribe_encryption_key"
        
        // Check if safeStorage is available
        const isAvailable = await window.desktop!.secureStorage!.isAvailable()
        if (!isAvailable) {
          console.warn("Electron safeStorage not available, falling back to env key")
          return null
        }
        
        // Try to load existing key from localStorage (stored encrypted via safeStorage)
        const stored = window.localStorage.getItem(STORAGE_KEY)
        if (stored) {
          try {
            // Decrypt the key using Electron's safeStorage
            const decrypted = await window.desktop!.secureStorage!.decrypt(stored)
            return decrypted
          } catch (error) {
            console.error("Failed to decrypt stored key, generating new one", error)
          }
        }
        
        // Generate new key
        const newKey = await window.desktop!.secureStorage!.generateKey()
        
        // Encrypt and store it
        try {
          const encrypted = await window.desktop!.secureStorage!.encrypt(newKey)
          window.localStorage.setItem(STORAGE_KEY, encrypted)
        } catch (error) {
          console.error("Failed to store encrypted key", error)
        }
        
        return newKey
      })()
    }
    
    const deviceKey = await electronKeyPromise
    if (deviceKey) {
      return deviceKey
    }
  }
  
  // Fallback to environment variable (legacy browser mode)
  if (!KEY_ENV) {
    throw new Error("NEXT_PUBLIC_SECURE_STORAGE_KEY must be configured in non-Electron environments.")
  }
  return KEY_ENV
}

function getCrypto(): Crypto {
  const cryptoRef = (typeof globalThis !== "undefined" ? (globalThis as unknown as { crypto?: Crypto }).crypto : undefined) ?? null
  if (!cryptoRef || !cryptoRef.subtle) {
    throw new Error("Web Crypto API is not available in this environment.")
  }
  return cryptoRef
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof window === "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"))
  }
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof window === "undefined") {
    return Buffer.from(bytes).toString("base64")
  }
  let binary = ""
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

async function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const keyBase64 = await getOrGenerateDeviceKey()
      const keyBytes = base64ToBytes(keyBase64)
      if (keyBytes.byteLength !== 32) {
        throw new Error("Encryption key must be a base64 encoded 256-bit key.")
      }
      return getCrypto().subtle.importKey("raw", keyBytes.buffer as ArrayBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
    })().catch((error) => {
      keyPromise = null
      throw error
    })
  }
  return keyPromise
}

function parsePayload(value: string) {
  const parts = value.split(".")
  if (parts.length !== 4) return null
  if (parts[0] !== PREFIX_BASE) return null
  
  const version = parts[1]
  // Support both v1 and v2
  if (version !== CURRENT_VERSION && version !== LEGACY_VERSION) return null
  
  return { 
    version,
    iv: base64ToBytes(parts[2]), 
    data: base64ToBytes(parts[3]) 
  }
}

function formatPayload(iv: Uint8Array, ciphertext: Uint8Array, version: string = CURRENT_VERSION): string {
  return `${PREFIX_BASE}.${version}.${bytesToBase64(iv)}.${bytesToBase64(ciphertext)}`
}

export async function saveSecureItem<T>(key: string, value: T): Promise<void> {
  if (typeof window === "undefined") return
  const cryptoRef = getCrypto()
  const iv = cryptoRef.getRandomValues(new Uint8Array(12))
  const data = ENCODER.encode(JSON.stringify(value))
  const cryptoKey = await getKey()
  const encrypted = await cryptoRef.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, data)
  window.localStorage.setItem(key, formatPayload(iv, new Uint8Array(encrypted), CURRENT_VERSION))
}

export async function loadSecureItem<T>(key: string): Promise<T | null> {
  if (typeof window === "undefined") return null
  const stored = window.localStorage.getItem(key)
  if (!stored) return null
  
  const payload = parsePayload(stored)
  if (!payload) {
    // Try to parse as unencrypted JSON (legacy data)
    try {
      const parsed = JSON.parse(stored) as T
      // Auto-migrate to encrypted format
      try {
        await saveSecureItem(key, parsed)
      } catch {
        // Ignore migration failures but still return the readable value
      }
      return parsed
    } catch {
      // Invalid data, remove it
      window.localStorage.removeItem(key)
      return null
    }
  }
  
  // Decrypt with current key (works for both v1 and v2 if using same key)
  const cryptoKey = await getKey()
  const decrypted = await getCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: payload.iv.buffer as ArrayBuffer },
    cryptoKey,
    payload.data.buffer as ArrayBuffer
  )
  
  try {
    const parsed = JSON.parse(DECODER.decode(decrypted)) as T
    
    // Auto-migrate v1 to v2 format
    if (payload.version === LEGACY_VERSION) {
      try {
        await saveSecureItem(key, parsed)
      } catch {
        // Migration failed but data is still readable
      }
    }
    
    return parsed
  } catch {
    // Decryption succeeded but JSON parsing failed
    window.localStorage.removeItem(key)
    return null
  }
}

/**
 * Rotate encryption key by generating a new key and re-encrypting all data.
 * This is a manual operation for HIPAA compliance.
 * 
 * @returns Array of keys that were successfully rotated
 */
export async function rotateEncryptionKey(): Promise<string[]> {
  if (typeof window === "undefined") {
    throw new Error("Key rotation is only available in browser environment")
  }
  
  if (!window.desktop?.secureStorage) {
    throw new Error("Key rotation requires Electron environment with safeStorage")
  }
  
  // Get all localStorage keys
  const allKeys: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (key) allKeys.push(key)
  }
  
  // Load all encrypted data with old key
  const dataMap = new Map<string, unknown>()
  for (const key of allKeys) {
    try {
      const data = await loadSecureItem(key)
      if (data !== null) {
        dataMap.set(key, data)
      }
    } catch {
      // Skip items that can't be decrypted
      continue
    }
  }
  
  // Clear the old key cache
  keyPromise = null
  electronKeyPromise = null
  
  // Force generation of new key
  const STORAGE_KEY = "openscribe_encryption_key"
  window.localStorage.removeItem(STORAGE_KEY)
  
  // Generate and store new key
  await getOrGenerateDeviceKey()
  
  // Re-encrypt all data with new key
  const rotated: string[] = []
  for (const [key, value] of dataMap.entries()) {
    try {
      await saveSecureItem(key, value)
      rotated.push(key)
    } catch (error) {
      console.error(`Failed to re-encrypt ${key}:`, error)
    }
  }
  
  return rotated
}
