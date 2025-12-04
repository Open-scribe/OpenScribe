import type { Encounter } from "../core/types"

const STORAGE_KEY = "openscribe_encounters"

export function generateId(): string {
  return crypto.randomUUID()
}

export function getEncounters(): Encounter[] {
  if (typeof window === "undefined") return []
  const data = localStorage.getItem(STORAGE_KEY)
  if (!data) return []
  try {
    return JSON.parse(data) as Encounter[]
  } catch {
    return []
  }
}

export function saveEncounters(encounters: Encounter[]): void {
  if (typeof window === "undefined") return
  // Remove audio blobs before saving (can't serialize Blob to JSON)
  const sanitized = encounters.map((e) => ({ ...e, audio_blob: undefined }))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
}

export function createEncounter(data: Partial<Encounter>): Encounter {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    patient_name: data.patient_name || "",
    patient_id: data.patient_id || "",
    visit_reason: data.visit_reason || "",
    session_id: data.session_id,
    created_at: now,
    updated_at: now,
    transcript_text: "",
    note_text: "",
    status: "idle",
    language: "en",
    ...data,
  }
}

export function updateEncounter(encounters: Encounter[], id: string, updates: Partial<Encounter>): Encounter[] {
  return encounters.map((e) => (e.id === id ? { ...e, ...updates, updated_at: new Date().toISOString() } : e))
}

export function deleteEncounter(encounters: Encounter[], id: string): Encounter[] {
  return encounters.filter((e) => e.id !== id)
}
