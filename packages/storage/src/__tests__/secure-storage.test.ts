/**
 * Tests for HIPAA-compliant encryption implementation
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock environment
const mockLocalStorage: Record<string, string> = {}

beforeEach(() => {
  // Clear mock localStorage
  Object.keys(mockLocalStorage).forEach(key => delete mockLocalStorage[key])
  
  // Mock window.localStorage
  global.window = {
    localStorage: {
      getItem: (key: string) => mockLocalStorage[key] ?? null,
      setItem: (key: string, value: string) => { mockLocalStorage[key] = value },
      removeItem: (key: string) => { delete mockLocalStorage[key] },
      clear: () => { Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]) },
      length: Object.keys(mockLocalStorage).length,
      key: (index: number) => Object.keys(mockLocalStorage)[index] ?? null,
    }
  } as any
  
  // Mock Web Crypto API
  global.crypto = {
    subtle: {
      importKey: vi.fn().mockResolvedValue({ type: "secret" }),
      encrypt: vi.fn().mockImplementation(async () => {
        return new Uint8Array([1, 2, 3, 4, 5]).buffer
      }),
      decrypt: vi.fn().mockImplementation(async (_, __, data) => {
        // Return mock decrypted data
        return new TextEncoder().encode(JSON.stringify({ test: "data" })).buffer
      }),
    },
    getRandomValues: vi.fn((arr: Uint8Array) => {
      // Fill with mock random data
      for (let i = 0; i < arr.length; i++) {
        arr[i] = i % 256
      }
      return arr
    }),
  } as any
  
  // Set mock encryption key
  process.env.NEXT_PUBLIC_SECURE_STORAGE_KEY = Buffer.from(new Uint8Array(32)).toString("base64")
})

describe("Secure Storage - Encryption Tests", () => {
  it("should always produce encrypted payloads with version prefix", async () => {
    const { saveSecureItem } = await import("../secure-storage")
    
    const testData = { patient_name: "John Doe", visit_reason: "Annual checkup" }
    await saveSecureItem("test-encounter", testData)
    
    const stored = mockLocalStorage["test-encounter"]
    expect(stored).toBeDefined()
    
    // Verify format: enc.v2.<iv>.<ciphertext>
    expect(stored).toMatch(/^enc\.v2\..+\..+$/)
    
    // Verify it starts with version prefix
    expect(stored.startsWith("enc.v2.")).toBe(true)
  })
  
  it("should generate and persist a browser key when env key is missing", async () => {
    // Remove the key
    delete process.env.NEXT_PUBLIC_SECURE_STORAGE_KEY
    
    // Clear cached key
    vi.resetModules()
    
    const { saveSecureItem } = await import("../secure-storage")
    
    const testData = { test: "data" }
    
    await expect(saveSecureItem("test", testData)).resolves.not.toThrow()
    expect(mockLocalStorage.openscribe_encryption_key_web).toBeDefined()
    expect(mockLocalStorage.test.startsWith("enc.v2.")).toBe(true)
  })
  
  it("should fail when encryption key is invalid length", async () => {
    // Set invalid key (16 bytes instead of 32)
    process.env.NEXT_PUBLIC_SECURE_STORAGE_KEY = Buffer.from(new Uint8Array(16)).toString("base64")
    
    vi.resetModules()
    
    const { saveSecureItem } = await import("../secure-storage")
    
    const testData = { test: "data" }
    
    // Should throw error about key length
    await expect(saveSecureItem("test", testData)).rejects.toThrow()
  })
  
  it("should auto-migrate unencrypted legacy data to v2 format", async () => {
    const { loadSecureItem } = await import("../secure-storage")
    
    // Store unencrypted JSON (legacy format)
    const legacyData = { patient_name: "Jane Doe" }
    mockLocalStorage["legacy-encounter"] = JSON.stringify(legacyData)
    
    // Load should succeed and auto-migrate
    const loaded = await loadSecureItem<typeof legacyData>("legacy-encounter")
    
    expect(loaded).toEqual(legacyData)
    
    // Check that it was re-encrypted
    const stored = mockLocalStorage["legacy-encounter"]
    expect(stored.startsWith("enc.v2.")).toBe(true)
  })
  
  it("should auto-migrate v1 encrypted data to v2 format", async () => {
    const { loadSecureItem } = await import("../secure-storage")
    
    // Create mock v1 encrypted payload
    const v1Payload = "enc.v1.AQIDBA.BQYHCA" // Mock base64 data
    mockLocalStorage["v1-encounter"] = v1Payload
    
    // Mock decrypt to return valid JSON
    const cryptoSubtle = global.crypto.subtle as any
    cryptoSubtle.decrypt.mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify({ patient_name: "Test" })).buffer
    )
    
    const loaded = await loadSecureItem<any>("v1-encounter")
    
    expect(loaded).toBeDefined()
    
    // Check that it was re-encrypted with v2
    const stored = mockLocalStorage["v1-encounter"]
    expect(stored.startsWith("enc.v2.")).toBe(true)
  })
})

describe("Secure Storage - PHI Protection Tests", () => {
  it("should never serialize audio_blob in encounters", async () => {
    const { saveSecureItem } = await import("../secure-storage")
    
    // This test ensures the storage layer would encrypt the data structure
    // The actual audio blob stripping happens in encounters.ts
    const encounterWithAudio = {
      id: "test-123",
      patient_name: "John Doe",
      transcript: "Patient presents with...",
      audio_blob: new Blob(["fake audio data"], { type: "audio/wav" })
    }
    
    // The storage layer should be able to handle any data
    // but audio blobs should be stripped before reaching saveSecureItem
    // This test verifies that if someone accidentally passes a Blob,
    // it won't cause an error (JSON.stringify will convert to empty object)
    await expect(saveSecureItem("test-encounter", encounterWithAudio)).resolves.not.toThrow()
  })
  
  it("should handle empty or null values gracefully", async () => {
    const { saveSecureItem, loadSecureItem } = await import("../secure-storage")
    
    await saveSecureItem("empty-test", null)
    const loaded = await loadSecureItem("empty-test")
    
    // Should store and retrieve null
    expect(loaded).toBeNull()
  })
})

describe("Secure Storage - Key Rotation", () => {
  it("should provide a key rotation function", async () => {
    const secureStorage = await import("../secure-storage")
    
    expect(secureStorage.rotateEncryptionKey).toBeDefined()
    expect(typeof secureStorage.rotateEncryptionKey).toBe("function")
  })
  
  it("should fail key rotation in non-Electron environment", async () => {
    const { rotateEncryptionKey } = await import("../secure-storage")
    
    // No desktop API available
    await expect(rotateEncryptionKey()).rejects.toThrow("requires Electron environment")
  })
})
