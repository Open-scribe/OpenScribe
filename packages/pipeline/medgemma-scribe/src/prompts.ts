import type { DraftNoteSections, EncounterState } from "./types"

const JSON_SCHEMA = `{
  "encounter_state": {
    "problems": [],
    "medications": [],
    "allergies": [],
    "ros_positive": [],
    "ros_negative": [],
    "timeline": []
  },
  "draft_note": {
    "hpi": "",
    "ros": "",
    "assessment": "",
    "plan": ""
  },
  "recent_transcript_window": "",
  "warnings": []
}`

export const SCRIBE_SYSTEM_PROMPT = `You are a medical scribe. Use ONLY facts explicitly stated in the transcript.
Do NOT invent vitals, labs, diagnoses, or medications.
If information is missing, write "not documented".
Return VALID JSON only. No markdown. No prose.
The JSON must match this schema exactly:\n${JSON_SCHEMA}`

export function buildScribePrompt(params: {
  transcriptChunk: string
  recentTranscriptWindow: string
  encounterState: EncounterState
  draftNote: DraftNoteSections
}): string {
  const { transcriptChunk, recentTranscriptWindow, encounterState, draftNote } = params
  return [
    "You are updating an existing encounter state and draft note.",
    "Only update fields affected by the new transcript chunk.",
    "If a field is unchanged, keep it identical.",
    "",
    "NEW TRANSCRIPT CHUNK:",
    transcriptChunk || "(empty)",
    "",
    "RECENT TRANSCRIPT WINDOW:",
    recentTranscriptWindow || "(empty)",
    "",
    "CURRENT ENCOUNTER STATE (JSON):",
    JSON.stringify(encounterState, null, 2),
    "",
    "CURRENT DRAFT NOTE (JSON):",
    JSON.stringify(draftNote, null, 2),
    "",
    "Return updated JSON now.",
  ].join("\n")
}
