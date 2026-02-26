/**
 * User preferences storage
 * Uses localStorage for simple key-value preferences
 */

import { writeAuditEntry } from "./audit-log"

export type NoteLength = "short" | "long"
export type ProcessingMode = "mixed" | "local"

export interface UserPreferences {
  noteLength: NoteLength
  processingMode: ProcessingMode
}

const PREFERENCES_KEY = "openscribe_preferences"

function resolveDefaultProcessingMode(): ProcessingMode {
  if (typeof window === "undefined") return "mixed"

  const override = process.env.NEXT_PUBLIC_OPENSCRIBE_DESKTOP_DEFAULT_MODE?.trim().toLowerCase()
  if (override === "local" || override === "mixed") {
    return override
  }

  // Desktop default is mixed mode. Browser/web also defaults to mixed.
  return "mixed"
}

const DEFAULT_PREFERENCES: UserPreferences = {
  noteLength: "long",
  processingMode: "mixed",
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
      processingMode: resolveDefaultProcessingMode(),
      ...parsed,
    }
  } catch {
    return {
      ...DEFAULT_PREFERENCES,
      processingMode: resolveDefaultProcessingMode(),
    }
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
