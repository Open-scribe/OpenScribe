/**
 * User preferences storage
 * Uses localStorage for simple key-value preferences
 */

import { writeAuditEntry } from "./audit-log"

export type NoteLength = "short" | "long"

export interface UserPreferences {
  noteLength: NoteLength
  recordingConsent: boolean // GDPR consent for audio recording
}

const PREFERENCES_KEY = "openscribe_preferences"

const DEFAULT_PREFERENCES: UserPreferences = {
  noteLength: "long",
  recordingConsent: false,
}

export function getPreferences(): UserPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERENCES
  }

  try {
    const stored = window.localStorage.getItem(PREFERENCES_KEY)
    if (!stored) {
      return DEFAULT_PREFERENCES
    }
    const parsed = JSON.parse(stored) as Partial<UserPreferences>
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export async function setPreferences(preferences: Partial<UserPreferences>): Promise<void> {
  if (typeof window === "undefined") {
    return
  }

  try {
    const current = getPreferences()
    const updated = {
      ...current,
      ...preferences,
    }
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(updated))

    // Audit log: preferences updated
    await writeAuditEntry({
      event_type: "settings.preferences_updated",
      success: true,
      metadata: {
        fields_updated: Object.keys(preferences),
      },
    })
  } catch (error) {
    console.error("Failed to save preferences:", error)

    // Audit log: preferences update failed
    await writeAuditEntry({
      event_type: "settings.preferences_updated",
      success: false,
      error_message: error instanceof Error ? error.message : String(error),
    })

    throw error
  }
}
