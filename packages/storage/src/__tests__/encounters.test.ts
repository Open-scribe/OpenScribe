import assert from "node:assert/strict"
import test from "node:test"
import { saveEncounters, getEncounters, createEncounter } from "../encounters.js"
import type { Encounter } from "../types.js"

/**
 * Encounter Persistence Security Tests
 * 
 * HIPAA Compliance: Verify that audio blobs (which contain PHI) are never
 * persisted to storage, following the Minimum Necessary principle.
 * Audio is processed in memory only for transcription, then discarded.
 */

// Mock localStorage for Node.js environment
const mockStorage: Record<string, string> = {}
global.localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value
  },
  removeItem: (key: string) => {
    delete mockStorage[key]
  },
  clear: () => {
    Object.keys(mockStorage).forEach(key => delete mockStorage[key])
  },
  key: (index: number) => Object.keys(mockStorage)[index] || null,
  length: Object.keys(mockStorage).length,
} as Storage

// Mock crypto.randomUUID for testing
if (!global.crypto) {
  global.crypto = {} as Crypto
}
if (!global.crypto.randomUUID) {
  let counter = 0
  // @ts-ignore - Mock for testing
  global.crypto.randomUUID = () => `test-uuid-${++counter}`
}

// Mock secure storage for testing
// Note: In real app this would use AES-GCM encryption
// @ts-ignore - mocking module
await import("../secure-storage.js").then(module => {
  const original = { ...module }
  // @ts-ignore
  module.loadSecureItem = async (key: string) => {
    const data = localStorage.getItem(key)
    return data ? JSON.parse(data) : null
  }
  // @ts-ignore
  module.saveSecureItem = async (key: string, value: any) => {
    localStorage.setItem(key, JSON.stringify(value))
  }
})

test("saveEncounters strips audio_blob before persistence", async () => {
  // Clear storage
  localStorage.clear()

  // Create an encounter with an audio blob
  const audioBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" })
  const encounter: Encounter = {
    id: "test-1",
    patient_name: "Test Patient",
    patient_id: "P12345",
    visit_reason: "Test visit",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    transcript_text: "Test transcript",
    note_text: "Test note",
    status: "completed",
    language: "en",
    audio_blob: audioBlob, // This should be stripped
  }

  // Save the encounter
  await saveEncounters([encounter])

  // Retrieve the saved data
  const savedEncounters = await getEncounters()

  // Verify encounter was saved
  assert.equal(savedEncounters.length, 1, "Should save one encounter")
  assert.equal(savedEncounters[0].id, "test-1", "Should save encounter ID")
  assert.equal(savedEncounters[0].patient_name, "Test Patient", "Should save patient name")

  // CRITICAL: Verify audio_blob was stripped
  assert.equal(
    savedEncounters[0].audio_blob,
    undefined,
    "audio_blob MUST be undefined after persistence (HIPAA compliance)"
  )

  // Double-check raw localStorage doesn't contain audio data
  const rawData = localStorage.getItem("openscribe_encounters")
  assert.ok(rawData, "Should have saved data")
  assert.ok(
    !rawData.includes("audio"),
    "Raw storage should not contain 'audio' key"
  )
  assert.ok(
    !rawData.includes("blob"),
    "Raw storage should not contain 'blob' references"
  )
})

test("saveEncounters handles multiple encounters with audio blobs", async () => {
  localStorage.clear()

  const encounters: Encounter[] = [
    {
      ...createEncounter({
        patient_name: "Patient 1",
        patient_id: "P001",
        visit_reason: "Visit 1",
      }),
      audio_blob: new Blob([new Uint8Array([1, 2])], { type: "audio/wav" }),
    },
    {
      ...createEncounter({
        patient_name: "Patient 2",
        patient_id: "P002",
        visit_reason: "Visit 2",
      }),
      audio_blob: new Blob([new Uint8Array([3, 4])], { type: "audio/wav" }),
    },
  ]

  await saveEncounters(encounters)
  const savedEncounters = await getEncounters()

  assert.equal(savedEncounters.length, 2, "Should save two encounters")
  
  // Verify both encounters have audio_blob stripped
  for (const encounter of savedEncounters) {
    assert.equal(
      encounter.audio_blob,
      undefined,
      `Encounter ${encounter.id} must have audio_blob stripped`
    )
  }
})

test("saveEncounters preserves all other encounter data", async () => {
  localStorage.clear()

  const encounter: Encounter = {
    id: "test-preserve",
    patient_name: "Jane Doe",
    patient_id: "P99999",
    visit_reason: "Annual checkup",
    session_id: "session-123",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    transcript_text: "Patient reports no issues.",
    note_text: "## Assessment\nPatient is healthy.",
    status: "completed",
    language: "en",
    recording_duration: 180,
    audio_blob: new Blob([new Uint8Array([5, 6, 7])], { type: "audio/wav" }),
  }

  await saveEncounters([encounter])
  const savedEncounters = await getEncounters()

  assert.equal(savedEncounters.length, 1)
  const saved = savedEncounters[0]

  // Verify all fields are preserved except audio_blob
  assert.equal(saved.id, encounter.id)
  assert.equal(saved.patient_name, encounter.patient_name)
  assert.equal(saved.patient_id, encounter.patient_id)
  assert.equal(saved.visit_reason, encounter.visit_reason)
  assert.equal(saved.session_id, encounter.session_id)
  assert.equal(saved.created_at, encounter.created_at)
  assert.equal(saved.updated_at, encounter.updated_at)
  assert.equal(saved.transcript_text, encounter.transcript_text)
  assert.equal(saved.note_text, encounter.note_text)
  assert.equal(saved.status, encounter.status)
  assert.equal(saved.language, encounter.language)
  assert.equal(saved.recording_duration, encounter.recording_duration)
  
  // Critical: audio_blob must be undefined
  assert.equal(saved.audio_blob, undefined)
})

test("Encounter without audio_blob saves normally", async () => {
  localStorage.clear()

  const encounter: Encounter = {
    ...createEncounter({
      patient_name: "No Audio Patient",
      patient_id: "P00000",
      visit_reason: "Text-only visit",
    }),
    transcript_text: "Imported transcript",
  }

  // Explicitly no audio_blob
  assert.equal(encounter.audio_blob, undefined)

  await saveEncounters([encounter])
  const savedEncounters = await getEncounters()

  assert.equal(savedEncounters.length, 1)
  assert.equal(savedEncounters[0].transcript_text, "Imported transcript")
  assert.equal(savedEncounters[0].audio_blob, undefined)
})
