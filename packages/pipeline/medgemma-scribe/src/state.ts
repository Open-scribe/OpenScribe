import type { DraftNoteSections, EncounterState, ScribeArtifacts } from "./types"

export const DEFAULT_WINDOW_CHARS = 2400

export function createEmptyEncounterState(): EncounterState {
  return {
    problems: [],
    medications: [],
    allergies: [],
    ros_positive: [],
    ros_negative: [],
    timeline: [],
  }
}

export function createEmptyDraftNote(): DraftNoteSections {
  return {
    hpi: "not documented",
    ros: "not documented",
    assessment: "not documented",
    plan: "not documented",
  }
}

export function createEmptyArtifacts(): ScribeArtifacts {
  return {
    encounterState: createEmptyEncounterState(),
    draftNote: createEmptyDraftNote(),
    recentTranscriptWindow: "",
  }
}

export function updateRecentTranscriptWindow(previous: string, chunk: string, maxChars = DEFAULT_WINDOW_CHARS): string {
  const combined = [previous, chunk].filter((value) => value && value.trim().length > 0).join("\n")
  if (combined.length <= maxChars) {
    return combined
  }
  return combined.slice(combined.length - maxChars)
}
