/**
 * User preferences storage
 * Uses localStorage for simple key-value preferences
 */

export type NoteLength = "short" | "long"

export interface UserPreferences {
  noteLength: NoteLength
}

const PREFERENCES_KEY = "openscribe_preferences"

const DEFAULT_PREFERENCES: UserPreferences = {
  noteLength: "long",
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

export function setPreferences(preferences: Partial<UserPreferences>): void {
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
  } catch (error) {
    console.error("Failed to save preferences:", error)
  }
}
